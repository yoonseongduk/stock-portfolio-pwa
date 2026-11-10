// 기업 현황 브리핑 계산 (순수 함수 모음). 설계: design/12_기업현황브리핑.md
// - 연도별 재무 수치를 종목마다 한 묶음으로 저장·병합하고, 영업이익률·부채비율·ROE·PER·PBR 을 계산한다.
// - 화면·저장소·시간에 의존하지 않는다. 브라우저에서는 window.Fundamentals, node 시험에서는 require() 로 쓴다.
// - 금액은 원래 통화 단위 그대로(국내 원, 미국 달러). 수집 출처가 달라도(자동·직접 입력·CSV) 같은 형식으로 저장한다.
(function (root) {
  "use strict";

  // 연도별 한 묶음(financial_summary)의 금액 필드. 표준 변수명(변수사전)과 같다.
  const AMOUNT_FIELDS = [
    "sales_amount", // 매출액
    "operating_profit_amount", // 영업이익
    "net_income_amount", // 당기순이익
    "total_assets_amount", // 자산총계
    "total_liabilities_amount", // 부채총계
    "total_equity_amount", // 자본총계
    "shares_count", // 발행 주식 수(PER·PBR 계산용)
  ];
  const SOURCE_KINDS = ["datagokr", "twelvedata", "manual", "csv"];
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);

  /** 한 묶음을 표준 형태로 맞춘다. 숫자가 아닌 금액 필드는 뺀다. 연도가 없으면 null. */
  function normalizeSummary(raw) {
    if (!raw) return null;
    const year = Number(raw.fiscal_year);
    if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
    const out = { fiscal_year: year };
    for (const f of AMOUNT_FIELDS) {
      const v = raw[f] === "" || raw[f] === null || raw[f] === undefined ? NaN : Number(raw[f]);
      if (Number.isFinite(v)) out[f] = v;
    }
    if (raw.fiscal_date) out.fiscal_date = String(raw.fiscal_date).slice(0, 10);
    if (raw.statement_kind) out.statement_kind = raw.statement_kind;
    if (raw.currency_kind) out.currency_kind = raw.currency_kind;
    out.source_kind = SOURCE_KINDS.includes(raw.source_kind) ? raw.source_kind : "manual";
    if (raw.collected_at) out.collected_at = raw.collected_at;
    return out;
  }

  /**
   * 한 종목의 연도 묶음을 추가·갱신한다. 같은 연도는 새 값이 있는 필드만 덮어쓰고(없는 필드는 기존 값 유지) 새 연도는 추가한다.
   * @param {Record<string, Record<string, object>>} map holding_key -> fiscal_year -> summary
   * @returns {{map:object, added:boolean, changed:boolean}}
   */
  function upsertYear(map, key, summary) {
    const s = normalizeSummary(summary);
    if (!s) return { map, added: false, changed: false };
    const next = { ...(map || {}) };
    const years = { ...(next[key] || {}) };
    const before = years[s.fiscal_year];
    const merged = { ...(before || {}), ...s };
    const changed = JSON.stringify(merged) !== JSON.stringify(before);
    years[s.fiscal_year] = merged;
    next[key] = years;
    return { map: next, added: !before, changed };
  }

  /** 종목의 연도 묶음을 오래된 해부터 정렬해 돌려준다. */
  function yearsOf(map, key) {
    return Object.values((map || {})[key] || {}).sort((a, b) => a.fiscal_year - b.fiscal_year);
  }

  /** 가장 최근 연도 묶음(없으면 null). */
  function latestSummary(map, key) {
    const list = yearsOf(map, key);
    return list.length ? list[list.length - 1] : null;
  }

  const ratio = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : null);

  /**
   * 재무 묶음에서 바로 나오는 비율(0~1 소수). 자본이 0 이하이면 자본 기준 비율은 null.
   * @returns {{operating_margin_rate:number|null, net_margin_rate:number|null, debt_ratio_rate:number|null, roe_rate:number|null}}
   */
  function deriveMetrics(s) {
    if (!s) return { operating_margin_rate: null, net_margin_rate: null, debt_ratio_rate: null, roe_rate: null };
    const eq = isNum(s.total_equity_amount) && s.total_equity_amount > 0 ? s.total_equity_amount : null;
    return {
      operating_margin_rate: ratio(s.operating_profit_amount, s.sales_amount),
      net_margin_rate: ratio(s.net_income_amount, s.sales_amount),
      debt_ratio_rate: ratio(s.total_liabilities_amount, eq),
      roe_rate: ratio(s.net_income_amount, eq),
    };
  }

  /**
   * 현재가와 최근 연도 묶음으로 시가총액·PER·PBR 을 계산한다. 주식 수가 없으면 모두 null.
   * 순이익이 0 이하(적자)면 PER 은 null, 자본이 0 이하면 PBR 은 null.
   */
  function computeValuation(price, s) {
    const none = { market_cap_amount: null, per_ratio: null, pbr_ratio: null };
    if (!s || !isNum(price) || price <= 0 || !isNum(s.shares_count) || s.shares_count <= 0) return none;
    const cap = price * s.shares_count;
    return {
      market_cap_amount: cap,
      per_ratio: isNum(s.net_income_amount) && s.net_income_amount > 0 ? cap / s.net_income_amount : null,
      pbr_ratio: isNum(s.total_equity_amount) && s.total_equity_amount > 0 ? cap / s.total_equity_amount : null,
    };
  }

  /**
   * Twelve Data 응답(income_statement, balance_sheet, statistics)을 연도 묶음 목록과 가치 지표 스냅샷으로 바꾼다.
   * 없는 응답은 null 로 넘기면 건너뛴다. 연도는 결산일(fiscal_date)의 해로 정한다.
   */
  function parseTwelveData(income, balance, stats, nowIso) {
    const byDate = new Map();
    const currency = (income && income.meta && income.meta.currency) || (balance && balance.meta && balance.meta.currency) || "USD";
    const put = (date, fields) => {
      if (!date) return;
      byDate.set(date, { ...(byDate.get(date) || { fiscal_date: date }), ...fields });
    };
    const list = (res, name) => (res && Array.isArray(res[name]) ? res[name] : []);
    for (const e of list(income, "income_statement")) {
      put(e.fiscal_date, {
        sales_amount: e.sales,
        operating_profit_amount: e.operating_income,
        net_income_amount: e.net_income,
        shares_count: e.basic_shares_outstanding,
      });
    }
    for (const e of list(balance, "balance_sheet")) {
      put(e.fiscal_date, {
        total_assets_amount: e.assets && e.assets.total_assets,
        total_liabilities_amount: e.liabilities && e.liabilities.total_liabilities,
        total_equity_amount: e.shareholders_equity && e.shareholders_equity.total_shareholders_equity,
      });
    }
    const summaries = [...byDate.values()]
      .map((v) =>
        normalizeSummary({
          ...v,
          fiscal_year: Number(String(v.fiscal_date).slice(0, 4)),
          currency_kind: currency,
          statement_kind: "annual",
          source_kind: "twelvedata",
          collected_at: nowIso,
        })
      )
      .filter(Boolean);

    let valuation = null;
    const st = stats && stats.statistics;
    if (st) {
      const vm = st.valuations_metrics || {};
      const fin = st.financials || {};
      const ss = st.stock_statistics || {};
      const div = st.dividends_and_splits || {};
      const num = (v) => (isNum(v) ? v : null);
      valuation = {
        asof_date: (nowIso || "").slice(0, 10),
        per_ratio: num(vm.trailing_pe),
        pbr_ratio: num(vm.price_to_book_mrq),
        roe_rate: num(fin.return_on_equity_ttm),
        operating_margin_rate: num(fin.operating_margin),
        market_cap_amount: num(vm.market_capitalization),
        shares_count: num(ss.shares_outstanding),
        dividend_yield_rate: num(div.trailing_annual_dividend_yield),
        source_kind: "twelvedata",
      };
      // 최근 연도 묶음에 주식 수가 없으면 통계의 발행 주식 수로 채운다(PER·PBR 계산용)
      if (valuation.shares_count && summaries.length) {
        const latest = summaries.reduce((a, b) => (b.fiscal_year > a.fiscal_year ? b : a));
        if (!isNum(latest.shares_count)) latest.shares_count = valuation.shares_count;
      }
    }
    return { summaries, valuation };
  }

  // ----- 국내: 공공데이터포털 금융위원회 기업기본정보·기업재무정보 -----
  // 응답 필드 이름은 공식 문서 페이지에 없어 알려진 이름을 우선으로 하되, 못 찾으면 받은 필드 이름을 사유에 담는다.
  const KR_FIELDS = {
    year: ["bizYear"],
    sales: ["enpSaleAmt"],
    operating: ["enpBzopPft"],
    net: ["enpCrtmNpf"],
    assets: ["enpTastAmt"],
    liabilities: ["enpTdbtAmt"],
    equity: ["enpTcptAmt"],
  };
  const pick = (item, names) => {
    for (const n of names) {
      if (item && item[n] !== undefined && item[n] !== null && item[n] !== "") {
        const v = Number(String(item[n]).replace(/,/g, ""));
        if (Number.isFinite(v)) return v;
      }
    }
    return undefined;
  };

  /**
   * 요약재무제표 조회 결과(여러 연도·연결/별도가 섞여 있을 수 있음)를 연도별 묶음으로 바꾼다.
   * 같은 연도에 연결재무제표가 있으면 연결을, 없으면 그 밖의 첫 값을 쓴다.
   * @returns {{summaries:object[], missing:string[], seen_fields:string[]}}
   */
  function parseDataGoKrSummary(items, nowIso) {
    const list = Array.isArray(items) ? items : [];
    const seen = new Set();
    const byYear = new Map();
    for (const it of list) {
      Object.keys(it || {}).forEach((k) => seen.add(k));
      const year = pick(it, KR_FIELDS.year);
      if (!Number.isInteger(year)) continue;
      const name = String(it.fnclDcdNm || it.fnclDcd || "");
      const consolidated = name.includes("연결");
      const before = byYear.get(year);
      if (!before || (consolidated && !before.consolidated)) byYear.set(year, { item: it, consolidated, name });
    }
    const summaries = [];
    for (const [year, { item, consolidated, name }] of byYear) {
      const s = normalizeSummary({
        fiscal_year: year,
        sales_amount: pick(item, KR_FIELDS.sales),
        operating_profit_amount: pick(item, KR_FIELDS.operating),
        net_income_amount: pick(item, KR_FIELDS.net),
        total_assets_amount: pick(item, KR_FIELDS.assets),
        total_liabilities_amount: pick(item, KR_FIELDS.liabilities),
        total_equity_amount: pick(item, KR_FIELDS.equity),
        statement_kind: consolidated ? "consolidated" : name ? "separate" : "unknown",
        currency_kind: "KRW",
        source_kind: "datagokr",
        collected_at: nowIso,
      });
      if (s && AMOUNT_FIELDS.some((f) => s[f] !== undefined)) summaries.push(s);
    }
    summaries.sort((a, b) => a.fiscal_year - b.fiscal_year);
    const missing = list.length > 0 && summaries.length === 0 ? Object.values(KR_FIELDS).map((n) => n[0]).filter((n) => !seen.has(n)) : [];
    return { summaries, missing, seen_fields: [...seen] };
  }

  /** 법인명 비교용: 괄호 안·(주)·주식회사·공백을 없애고 소문자로. */
  function normalizeCorpName(name) {
    return String(name || "")
      .replace(/\(주\)|㈜|주식회사/g, "")
      .replace(/\s+/g, "")
      .toLowerCase();
  }

  /** 종목명에서 우선주 표기('우', '우B', '2우B')를 뗀 보통주 이름 후보. */
  function commonStockName(stockName) {
    return String(stockName || "").replace(/\s*\d?우[A-C]?$/, "");
  }

  /**
   * 기업기본정보 조회 결과에서 종목명과 같은 법인을 고른다.
   * @returns {{status:'one'|'many'|'none', crno?:string, corp_name?:string, candidates:{crno:string, corp_name:string}[]}}
   */
  function pickCorpMatch(items, stockName) {
    const targets = [normalizeCorpName(stockName), normalizeCorpName(commonStockName(stockName))];
    const all = (Array.isArray(items) ? items : [])
      .filter((it) => it && it.crno && it.corpNm)
      .map((it) => ({ item: it, crno: String(it.crno), corp_name: String(it.corpNm), listed: ["Y", "K", "N"].includes(String(it.corpRegMrktDcd || "")) || String(it.enpPbanYn || "") === "Y" }));
    const same = all.filter((c) => targets.includes(normalizeCorpName(c.corp_name)));
    const pool = same.length > 0 ? same : [];
    const listed = pool.filter((c) => c.listed);
    const use = listed.length > 0 ? listed : pool;
    const uniq = [...new Map(use.map((c) => [c.crno, c])).values()];
    if (uniq.length === 1) return { status: "one", crno: uniq[0].crno, corp_name: uniq[0].corp_name, item: uniq[0].item, candidates: uniq };
    if (uniq.length > 1) return { status: "many", candidates: uniq };
    return { status: "none", candidates: all.slice(0, 5).map(({ crno, corp_name }) => ({ crno, corp_name })) };
  }

  // ----- 기업 소개(무엇을 하는 기업인지, 주요 제품·매출원) -----
  // 자동(auto: 데이터 제공처)과 직접 입력(manual) 두 층으로 저장하고, 화면에서는 항목별로 직접 입력이 자동을 덮는다.
  const PROFILE_FIELDS = ["industry_name", "business_summary", "main_products", "revenue_sources", "website_url"];
  const clean = (v, max) => {
    const t = String(v === undefined || v === null ? "" : v).replace(/\s+/g, " ").trim();
    return t.slice(0, max || 3000);
  };

  /** Twelve Data /profile 응답 → 자동 소개. 설명과 업종이 모두 없으면 null. 설명은 영어이므로 summary_lang 에 en 을 남긴다. */
  function parseTwelveProfile(res, nowIso) {
    if (!res || typeof res !== "object") return null;
    const industry = [res.sector, res.industry].map((x) => clean(x, 80)).filter(Boolean).join(" / ");
    const summary = clean(res.description, 2000);
    if (!industry && !summary) return null;
    const out = { source_kind: "twelvedata", collected_at: nowIso, summary_lang: "en" };
    if (industry) out.industry_name = industry;
    if (summary) out.business_summary = summary;
    if (res.website) out.website_url = clean(res.website, 200);
    if (res.CEO) out.ceo_name = clean(res.CEO, 80);
    if (Number.isFinite(Number(res.employees))) out.employees_count = Number(res.employees);
    return out;
  }

  /** 기업기본정보 한 행 → 자동 소개(업종·홈페이지·대표자·설립일). 읽을 값이 없으면 null. */
  function parseCorpProfile(item, nowIso) {
    if (!item || typeof item !== "object") return null;
    const out = { source_kind: "datagokr", collected_at: nowIso, summary_lang: "ko" };
    const industry = clean(item.sicNm || item.indutyNm || "", 120);
    if (industry) out.industry_name = industry;
    if (item.enpHmpgUrl) out.website_url = clean(item.enpHmpgUrl, 200);
    if (item.enpRprFnm) out.ceo_name = clean(item.enpRprFnm, 80);
    if (item.enpEstbDt) out.established_date = clean(item.enpEstbDt, 20);
    return out.industry_name || out.website_url || out.ceo_name || out.established_date ? out : null;
  }

  /**
   * 소개 한 층을 넣는다. 자동은 통째로 바꾸고(null 이면 그대로), 직접 입력은 넘긴 항목만 바꾼다(빈 문자열은 그 항목 삭제).
   * @param {Record<string, {auto?:object, manual?:object}>} map
   */
  function setProfileLayer(map, key, layer, fields) {
    const next = { ...(map || {}) };
    const entry = { ...(next[key] || {}) };
    if (layer === "auto") {
      if (!fields) return map || {};
      entry.auto = fields;
    } else {
      const manual = { ...(entry.manual || {}) };
      for (const f of PROFILE_FIELDS) {
        if (fields[f] === undefined) continue;
        const v = clean(fields[f], f === "business_summary" || f === "main_products" || f === "revenue_sources" ? 1500 : 200);
        if (v === "") delete manual[f];
        else manual[f] = v;
      }
      if (Object.keys(manual).length) entry.manual = manual;
      else delete entry.manual;
      if (Object.keys(manual).length) entry.manual_at = fields.manual_at || entry.manual_at;
    }
    if (!entry.auto && !entry.manual) delete next[key];
    else next[key] = entry;
    return next;
  }

  /**
   * 화면에 보일 소개: 항목마다 직접 입력이 있으면 그것, 없으면 자동 값. sources 에 항목별 출처(manual/auto)를 담는다.
   * @returns {{industry_name?:string, business_summary?:string, main_products?:string, revenue_sources?:string, website_url?:string, ceo_name?:string, established_date?:string, summary_lang?:string, sources:Record<string,string>, has_any:boolean}}
   */
  function profileView(entry) {
    const view = { sources: {}, has_any: false };
    if (!entry) return view;
    for (const f of PROFILE_FIELDS) {
      if (entry.manual && entry.manual[f]) {
        view[f] = entry.manual[f];
        view.sources[f] = "manual";
      } else if (entry.auto && entry.auto[f]) {
        view[f] = entry.auto[f];
        view.sources[f] = "auto";
      }
    }
    if (entry.auto) {
      ["ceo_name", "established_date"].forEach((f) => {
        if (entry.auto[f]) view[f] = entry.auto[f];
      });
      if (view.sources.business_summary === "auto") view.summary_lang = entry.auto.summary_lang;
      view.auto_source = entry.auto.source_kind;
    }
    view.has_any = PROFILE_FIELDS.some((f) => view[f]);
    return view;
  }

  const PROFILE_CSV_HEADER = ["구분", "종목명", "업종", "한 줄 설명", "주요 제품·서비스", "주요 매출원", "홈페이지"];
  const PROFILE_CSV_FIELDS = ["industry_name", "business_summary", "main_products", "revenue_sources", "website_url"];

  /** 직접 입력한 소개를 CSV 줄 목록(머리글 포함)으로. keys: 내보낼 종목 키(market|name). */
  function toProfileCsvRows(map, keys) {
    const rows = [PROFILE_CSV_HEADER];
    for (const key of keys) {
      const view = profileView((map || {})[key]);
      if (!view.has_any) continue;
      const sep = key.indexOf("|");
      rows.push([key.slice(0, sep) === "us" ? "미국" : "국내", key.slice(sep + 1), ...PROFILE_CSV_FIELDS.map((f) => view[f] || "")]);
    }
    return rows;
  }

  /** CSV 줄(머리글 제외) → 직접 입력 소개. 빈 칸은 그 항목을 건드리지 않는다. */
  function fromProfileCsvRows(rows) {
    const items = [];
    const errors = [];
    rows.forEach((cols, idx) => {
      const lineNo = idx + 2;
      if (cols.every((c) => String(c).trim() === "")) return;
      const [marketLabel, name, ...vals] = cols.map((c) => String(c === undefined ? "" : c).trim());
      const market = MARKET_LABEL_TO_KIND[marketLabel];
      if (!market) return errors.push(`${lineNo}줄: 구분은 "국내" 또는 "미국"`);
      if (!name) return errors.push(`${lineNo}줄: 종목명 없음`);
      const fields = {};
      PROFILE_CSV_FIELDS.forEach((f, i) => {
        if ((vals[i] || "") !== "") fields[f] = vals[i];
      });
      if (Object.keys(fields).length === 0) return errors.push(`${lineNo}줄: 소개 내용이 모두 비어 있습니다`);
      items.push({ key: `${market}|${name}`, fields });
    });
    return { items, errors };
  }

  /**
   * 가치 지표 스냅샷을 history 에 넣는다(같은 날짜는 덮어쓰고 날짜순 정렬). 공식 수치 기록용.
   * @param {Record<string, object[]>} historyMap holding_key -> 스냅샷 목록
   */
  function appendValuation(historyMap, key, snapshot) {
    if (!snapshot || !snapshot.asof_date) return historyMap;
    const next = { ...(historyMap || {}) };
    const list = (next[key] || []).filter((e) => e.asof_date !== snapshot.asof_date);
    list.push(snapshot);
    list.sort((a, b) => (a.asof_date < b.asof_date ? -1 : 1));
    next[key] = list;
    return next;
  }

  /**
   * 화면용 큰 금액 표기. 국내는 조·억, 미국은 T·B·M. 없으면 "-".
   * @param {'kr'|'us'} marketKind
   */
  function formatBigAmount(value, marketKind) {
    if (!isNum(value)) return "-";
    const sign = value < 0 ? "-" : "";
    const v = Math.abs(value);
    if (marketKind === "us") {
      if (v >= 1e12) return `${sign}$${(v / 1e12).toFixed(2)}T`;
      if (v >= 1e9) return `${sign}$${(v / 1e9).toFixed(2)}B`;
      if (v >= 1e6) return `${sign}$${(v / 1e6).toFixed(1)}M`;
      return `${sign}$${Math.round(v).toLocaleString("en-US")}`;
    }
    if (v >= 1e12) return `${sign}${(v / 1e12).toFixed(2)}조원`;
    if (v >= 1e8) return `${sign}${Math.round(v / 1e8).toLocaleString("ko-KR")}억원`;
    return `${sign}${Math.round(v).toLocaleString("ko-KR")}원`;
  }

  // ----- CSV (사용자가 직접 정리한 연도별 재무를 가져오고 내보낸다) -----
  const CSV_HEADER = ["구분", "종목명", "연도", "매출액", "영업이익", "순이익", "자산총계", "부채총계", "자본총계", "발행주식수"];
  const CSV_FIELDS = ["sales_amount", "operating_profit_amount", "net_income_amount", "total_assets_amount", "total_liabilities_amount", "total_equity_amount", "shares_count"];
  const MARKET_LABEL_TO_KIND = { 국내: "kr", 미국: "us" };

  /** 저장된 연도 묶음을 CSV 줄 목록(머리글 포함)으로 만든다. keys: 내보낼 종목 키 목록(market|name). */
  function toCsvRows(map, keys) {
    const rows = [CSV_HEADER];
    for (const key of keys) {
      const sep = key.indexOf("|");
      const market = key.slice(0, sep);
      const name = key.slice(sep + 1);
      for (const s of yearsOf(map, key)) {
        rows.push([market === "us" ? "미국" : "국내", name, s.fiscal_year, ...CSV_FIELDS.map((f) => (isNum(s[f]) ? s[f] : ""))]);
      }
    }
    return rows;
  }

  /**
   * CSV 줄(머리글 제외)을 종목 키와 묶음으로 바꾼다. 잘못된 줄은 errors 에 줄 번호와 이유를 담는다.
   * @returns {{items:{key:string, summary:object}[], errors:string[]}}
   */
  function fromCsvRows(rows, nowIso) {
    const items = [];
    const errors = [];
    rows.forEach((cols, idx) => {
      const lineNo = idx + 2;
      if (cols.every((c) => String(c).trim() === "")) return;
      const [marketLabel, name, year, ...amounts] = cols.map((c) => String(c === undefined ? "" : c).trim());
      const market = MARKET_LABEL_TO_KIND[marketLabel];
      if (!market) return errors.push(`${lineNo}줄: 구분은 "국내" 또는 "미국"`);
      if (!name) return errors.push(`${lineNo}줄: 종목명 없음`);
      const raw = { fiscal_year: Number(year), source_kind: "csv", collected_at: nowIso, currency_kind: market === "us" ? "USD" : "KRW" };
      CSV_FIELDS.forEach((f, i) => {
        const text = (amounts[i] || "").replace(/,/g, "");
        if (text !== "") raw[f] = Number(text);
      });
      const bad = CSV_FIELDS.find((f) => raw[f] !== undefined && !Number.isFinite(raw[f]));
      if (bad) return errors.push(`${lineNo}줄: 숫자가 아닌 값이 있습니다`);
      const s = normalizeSummary(raw);
      if (!s) return errors.push(`${lineNo}줄: 연도(예: 2025)를 확인하세요`);
      items.push({ key: `${market}|${name}`, summary: s });
    });
    return { items, errors };
  }

  const api = {
    AMOUNT_FIELDS,
    CSV_HEADER,
    normalizeSummary,
    upsertYear,
    yearsOf,
    latestSummary,
    deriveMetrics,
    computeValuation,
    parseTwelveData,
    parseDataGoKrSummary,
    normalizeCorpName,
    commonStockName,
    pickCorpMatch,
    PROFILE_FIELDS,
    parseTwelveProfile,
    parseCorpProfile,
    setProfileLayer,
    profileView,
    toProfileCsvRows,
    fromProfileCsvRows,
    appendValuation,
    formatBigAmount,
    toCsvRows,
    fromCsvRows,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Fundamentals = api;
})(typeof window !== "undefined" ? window : globalThis);
