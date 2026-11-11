// 재무 건강 신호·기업 이벤트·종합 판단 (순수 함수 모음). 설계: design/13_재무시그널과기업이벤트.md
// - 연도별 재무 묶음(Fundamentals)과 시세 시그널(Signals)을 조합해 참고용 판정을 만든다. 투자 권유가 아니다.
// - 화면·저장소·시간에 의존하지 않는다. 브라우저에서는 window.FundSignals, node 시험에서는 require() 로 쓴다.
(function (root) {
  "use strict";

  // ===== 수정 영역: 기준값 =====
  const FUND_SIGNAL_DEFAULTS = {
    growth_event_rate: 0.3, // 영업이익이 전년 대비 이 비율 이상 늘거나 줄면 급증·급감
    growth_sales_rate: 0.1, // 매출이 전년 대비 이 비율 이상 늘거나 줄면 성장·감소
    debt_ratio_warn: 2, // 부채비율(부채÷자본) 주의 기준(200%)
    debt_ratio_danger: 4, // 부채비율 위험 기준(400%)
    debt_ratio_low: 1, // 부채비율 낮음 기준(100%)
    debt_jump_rate: 0.5, // 부채비율이 전년보다 이만큼(50%p) 늘면 급증
    roe_good_rate: 0.1, // ROE 양호 기준(10%)
    pbr_low_ratio: 1, // PBR 이 이 값 미만이면 낮은 구간
    per_low_ratio: 10, // PER 이 이 값 미만이면 낮은 구간
    per_high_ratio: 40, // PER 이 이 값 초과이면 높은 구간
    debt_ratio_low_high: 2, // 고부채 업종의 부채비율 낮음 기준(200%)
    debt_ratio_warn_high: 4, // 고부채 업종의 부채비율 주의 기준(400%)
    debt_ratio_danger_high: 8, // 고부채 업종의 부채비율 위험 기준(800%)
  };

  // 재무 업종 구분(design/13 §3-2): 종목명·업종 글자에 이 말이 들어 있으면 자동으로 그 구분으로 본다. 제외어는 먼저 지운 뒤 찾는다.
  const FUND_PROFILE_KEYWORDS = {
    financial: ["은행", "증권", "보험", "카드", "캐피탈", "금융", "저축"],
    high_debt: ["전력", "가스", "통신", "텔레콤", "건설", "이앤씨", "조선", "오션", "중공업", "해운", "항공", "철도", "선박"],
    exclude: ["건설기계"],
  };
  const FUND_PROFILE_KINDS = ["general", "high_debt", "financial"];
  const FUND_PROFILE_LABEL = { general: "일반", high_debt: "고부채 업종", financial: "금융업" };
  // ===== 수정 영역 END =====

  const isNum = (v) => typeof v === "number" && Number.isFinite(v);

  /** 저장된 설정과 기본값을 합친다. 숫자가 아니거나 0 이하이면 기본값. */
  function mergeFundSettings(saved) {
    const out = { ...FUND_SIGNAL_DEFAULTS };
    if (saved && typeof saved === "object") {
      for (const k of Object.keys(FUND_SIGNAL_DEFAULTS)) {
        const v = Number(saved[k]);
        if (Number.isFinite(v) && v > 0) out[k] = v;
      }
    }
    if (out.debt_ratio_danger < out.debt_ratio_warn) out.debt_ratio_danger = out.debt_ratio_warn;
    if (out.debt_ratio_danger_high < out.debt_ratio_warn_high) out.debt_ratio_danger_high = out.debt_ratio_warn_high;
    return out;
  }

  /** 업종 구분에 맞는 부채비율 기준(낮음·주의·위험). 고부채 업종이면 높은 기준을 쓴다. */
  function debtThresholds(settings, profileKind) {
    const s = mergeFundSettings(settings);
    return profileKind === "high_debt" ? { low: s.debt_ratio_low_high, warn: s.debt_ratio_warn_high, danger: s.debt_ratio_danger_high } : { low: s.debt_ratio_low, warn: s.debt_ratio_warn, danger: s.debt_ratio_danger };
  }

  /**
   * 재무 업종 구분을 정한다. 직접 고른 값이 있으면 그것, 없으면 종목명·업종 글자의 키워드로 자동, 못 찾으면 일반.
   * @param {{stock_name?:string, industry_name?:string, override?:string}} input
   * @returns {{kind:'general'|'high_debt'|'financial', source:'manual'|'auto'|'default'}}
   */
  function resolveFundProfile(input) {
    const o = input || {};
    if (FUND_PROFILE_KINDS.includes(o.override)) return { kind: o.override, source: "manual" };
    let text = `${o.stock_name || ""} ${o.industry_name || ""}`;
    FUND_PROFILE_KEYWORDS.exclude.forEach((w) => (text = text.split(w).join(" ")));
    if (FUND_PROFILE_KEYWORDS.financial.some((w) => text.includes(w))) return { kind: "financial", source: "auto" };
    if (FUND_PROFILE_KEYWORDS.high_debt.some((w) => text.includes(w))) return { kind: "high_debt", source: "auto" };
    return { kind: "general", source: "default" };
  }

  const pct = (v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
  const pct0 = (v) => `${(v * 100).toFixed(0)}%`;
  const ratioOf = (a, b) => (isNum(a) && isNum(b) && b > 0 ? a / b : null);
  const growth = (now, before) => (isNum(now) && isNum(before) && before > 0 ? (now - before) / before : null);

  /** 최신 연도와 바로 전 연도(연속한 해일 때만) 묶음을 돌려준다. */
  function latestPair(years) {
    const list = [...(years || [])].sort((a, b) => a.fiscal_year - b.fiscal_year);
    if (list.length === 0) return { latest: null, prev: null };
    const latest = list[list.length - 1];
    const before = list.length > 1 ? list[list.length - 2] : null;
    return { latest, prev: before && before.fiscal_year === latest.fiscal_year - 1 ? before : null };
  }

  const HEALTH_LABEL = { good: "재무 양호", normal: "재무 보통", caution: "재무 주의", danger: "재무 위험", insufficient: "재무 정보 없음", not_applicable: "재무 점검 제외" };

  /**
   * 재무 건강을 판정한다.
   * @param {object[]} years 연도별 재무 묶음(Fundamentals 형식)
   * @param {string} [profileKind] 재무 업종 구분(general·high_debt·financial). financial 이면 판정하지 않는다(not_applicable).
   * @returns {{health_state:string, reasons:{tone:'good'|'warn'|'danger', kind:'profit'|'growth'|'debt'|'capital', text:string}[], latest_year:number|null}}
   */
  function assessHealth(years, settings, profileKind) {
    const s = mergeFundSettings(settings);
    const { latest, prev } = latestPair(years);
    if (profileKind === "financial") return { health_state: "not_applicable", reasons: [], latest_year: latest ? latest.fiscal_year : null };
    if (!latest) return { health_state: "insufficient", reasons: [], latest_year: null };
    const th = debtThresholds(s, profileKind);
    const reasons = [];
    const add = (tone, kind, text) => reasons.push({ tone, kind, text });

    if (isNum(latest.operating_profit_amount)) {
      if (latest.operating_profit_amount > 0) add("good", "profit", `${latest.fiscal_year}년 영업이익 흑자`);
      else if (prev && isNum(prev.operating_profit_amount) && prev.operating_profit_amount <= 0) add("danger", "profit", `영업적자 2년 연속(${prev.fiscal_year}·${latest.fiscal_year}년)`);
      else add("warn", "profit", `${latest.fiscal_year}년 영업적자`);
    }
    if (isNum(latest.net_income_amount) && latest.net_income_amount < 0) add("warn", "profit", `${latest.fiscal_year}년 순적자`);
    if (isNum(latest.total_equity_amount) && latest.total_equity_amount <= 0) add("danger", "capital", "자본잠식(자본총계가 0 이하)");

    const debt = ratioOf(latest.total_liabilities_amount, latest.total_equity_amount);
    if (debt !== null) {
      const tag = profileKind === "high_debt" ? "고부채 업종 기준 " : "";
      if (debt > th.danger) add("danger", "debt", `부채비율 ${pct0(debt)}로 매우 높음(${tag}${pct0(th.danger)} 초과)`);
      else if (debt > th.warn) add("warn", "debt", `부채비율 ${pct0(debt)}로 높음(${tag}${pct0(th.warn)} 초과)`);
      else if (debt <= th.low) add("good", "debt", `부채비율 ${pct0(debt)}로 낮음`);
    }
    const roe = ratioOf(latest.net_income_amount, latest.total_equity_amount);
    if (roe !== null && roe >= s.roe_good_rate) add("good", "profit", `ROE ${pct0(roe)}`);
    else if (isNum(latest.net_income_amount) && isNum(latest.total_equity_amount) && latest.total_equity_amount > 0 && latest.net_income_amount < 0) add("warn", "profit", `ROE 음수(${pct(latest.net_income_amount / latest.total_equity_amount)})`);

    if (prev) {
      const sg = growth(latest.sales_amount, prev.sales_amount);
      if (sg !== null && sg >= s.growth_sales_rate) add("good", "growth", `매출 전년 대비 ${pct(sg)}`);
      else if (sg !== null && sg <= -s.growth_sales_rate) add("warn", "growth", `매출 전년 대비 ${pct(sg)}`);
      const og = growth(latest.operating_profit_amount, prev.operating_profit_amount);
      if (og !== null && isNum(latest.operating_profit_amount) && latest.operating_profit_amount > 0) {
        if (og >= s.growth_event_rate) add("good", "growth", `영업이익 전년 대비 ${pct(og)}`);
        else if (og <= -s.growth_event_rate) add("warn", "growth", `영업이익 전년 대비 ${pct(og)}`);
      }
    }
    const count = (t) => reasons.filter((r) => r.tone === t).length;
    let state = "normal";
    if (count("danger") > 0) state = "danger";
    else if (count("warn") > 0) state = "caution";
    else if (count("good") >= 2) state = "good";
    return { health_state: state, reasons, latest_year: latest.fiscal_year };
  }

  /**
   * 최신 연도와 전 연도(연속한 해)를 비교해 연도 이벤트를 만든다. 번호(id)는 종류와 연도로 정해져 같은 결과면 항상 같다.
   * @returns {{id:string, kind:string, text:string}[]}
   */
  function yearEvents(years, settings, profileKind) {
    const s = mergeFundSettings(settings);
    const th = debtThresholds(s, profileKind);
    const { latest, prev } = latestPair(years);
    if (!latest) return [];
    const fy = latest.fiscal_year;
    const out = [{ id: `new_year:${fy}`, kind: "new_year", text: `${fy}년 결산이 반영되었습니다` }];
    if (isNum(latest.total_equity_amount) && latest.total_equity_amount <= 0) {
      out.push({ id: `impair:${fy}`, kind: "capital_impairment", text: `${fy}년 자본잠식(자본총계가 0 이하)입니다` });
    }
    if (prev) {
      const lo = latest.operating_profit_amount;
      const po = prev.operating_profit_amount;
      if (isNum(lo) && isNum(po)) {
        if (po <= 0 && lo > 0) out.push({ id: `turn_profit:${fy}`, kind: "turned_profit", text: `영업이익 흑자전환 (${prev.fiscal_year}년 적자 → ${fy}년 흑자)` });
        else if (po > 0 && lo <= 0) out.push({ id: `turn_loss:${fy}`, kind: "turned_loss", text: `영업이익 적자전환 (${prev.fiscal_year}년 흑자 → ${fy}년 적자)` });
        else if (po > 0 && lo > 0) {
          const g = (lo - po) / po;
          if (g >= s.growth_event_rate) out.push({ id: `op_surge:${fy}`, kind: "op_surge", text: `영업이익 급증 (전년 대비 ${pct(g)})` });
          else if (g <= -s.growth_event_rate) out.push({ id: `op_plunge:${fy}`, kind: "op_plunge", text: `영업이익 급감 (전년 대비 ${pct(g)})` });
        }
      }
      const d1 = ratioOf(latest.total_liabilities_amount, latest.total_equity_amount);
      const d0 = ratioOf(prev.total_liabilities_amount, prev.total_equity_amount);
      if (profileKind !== "financial" && d1 !== null && d0 !== null && d1 >= th.warn && d1 - d0 >= s.debt_jump_rate) {
        out.push({ id: `debt_jump:${fy}`, kind: "debt_jump", text: `부채비율 급증 (${pct0(d0)} → ${pct0(d1)})` });
      }
    }
    return out;
  }

  const ZONE_TEXT = {
    pbr_lt1: (s) => `PBR이 ${s.pbr_low_ratio}배 미만인 구간에 들어왔습니다`,
    per_low: (s) => `PER이 ${s.per_low_ratio}배 미만인 낮은 구간에 들어왔습니다`,
    per_high: (s) => `PER이 ${s.per_high_ratio}배를 넘는 높은 구간에 들어왔습니다`,
  };

  /** 현재가로 계산한 가치 지표로 가치 구간을 정한다. 해당 없으면 null. @param {{per_ratio:number|null, pbr_ratio:number|null}} val */
  function valuationZone(val, settings) {
    const s = mergeFundSettings(settings);
    if (!val) return null;
    if (isNum(val.pbr_ratio) && val.pbr_ratio > 0 && val.pbr_ratio < s.pbr_low_ratio) return "pbr_lt1";
    if (isNum(val.per_ratio) && val.per_ratio > s.per_high_ratio) return "per_high";
    if (isNum(val.per_ratio) && val.per_ratio > 0 && val.per_ratio < s.per_low_ratio) return "per_low";
    return null;
  }

  /**
   * 종목들의 기업 이벤트 상태를 갱신하고 아직 확인하지 않은 이벤트를 골라낸다.
   * 처음 계산하는 종목, 재무가 처음 들어온 종목은 지금 있는 이벤트를 모두 확인된 것으로 시작한다.
   * @param {Record<string, object>} eventMap holding_key -> 상태
   * @param {{key:string, years:object[], zone:string|null}[]} items
   * @returns {{event_map:Record<string, object>, changed:boolean, pending:{key:string, id:string, kind:string, text:string}[]}}
   */
  function evaluateFundEvents(eventMap, items, settings, nowIso) {
    const s = mergeFundSettings(settings);
    const next = { ...(eventMap || {}) };
    const pending = [];
    let changed = false;
    for (const it of items) {
      const events = yearEvents(it.years, s, it.fund_profile_kind);
      const hasData = events.length > 0;
      const before = next[it.key];
      let entry;
      if (!before || (!before.has_data && hasData)) {
        entry = { has_data: hasData, last_fiscal_year: hasData ? latestPair(it.years).latest.fiscal_year : null, zone_state: it.zone || null, halt_state: !!it.halted, ack_ids: events.map((e) => e.id), open_events: [], updated_at: nowIso };
      } else {
        entry = { ...before, ack_ids: [...(before.ack_ids || [])], open_events: [...(before.open_events || [])] };
        if (hasData) entry.last_fiscal_year = latestPair(it.years).latest.fiscal_year;
        const zone = it.zone || null;
        if (zone !== (entry.zone_state || null)) {
          if (zone && ZONE_TEXT[zone]) {
            const id = `zone:${zone}:${nowIso.slice(0, 10)}`;
            if (!entry.open_events.some((e) => e.id === id) && !entry.ack_ids.includes(id)) entry.open_events.push({ id, kind: "zone", text: ZONE_TEXT[zone](s) });
          }
          entry.zone_state = zone;
        }
        // 거래정지 의심이 바뀌면(시작·재개) 이벤트. 처음 계산한 종목은 위에서 조용히 시작한다.
        const halted = !!it.halted;
        if (halted !== !!entry.halt_state) {
          const id = `${halted ? "halt" : "resume"}:${nowIso.slice(0, 10)}`;
          if (!entry.open_events.some((e) => e.id === id) && !entry.ack_ids.includes(id)) {
            entry.open_events.push({ id, kind: halted ? "halt" : "resume", text: halted ? it.halt_text || "거래정지로 보입니다. 거래소 공시로 확인하세요" : "거래가 재개된 것으로 보입니다" });
          }
          entry.halt_state = halted;
        }
        if (JSON.stringify(entry) !== JSON.stringify(before)) entry.updated_at = nowIso;
      }
      if (JSON.stringify(entry) !== JSON.stringify(before)) {
        next[it.key] = entry;
        changed = true;
      }
      for (const e of [...events, ...entry.open_events]) {
        if (!entry.ack_ids.includes(e.id)) pending.push({ key: it.key, id: e.id, kind: e.kind, text: e.text });
      }
    }
    return { event_map: next, changed, pending };
  }

  /** 이벤트 번호들을 확인 처리한다(열려 있던 상태 변화 이벤트는 닫는다). */
  function acknowledgeEvents(entry, ids) {
    if (!entry) return entry;
    const ack = new Set([...(entry.ack_ids || []), ...ids]);
    return { ...entry, ack_ids: [...ack], open_events: (entry.open_events || []).filter((e) => !ack.has(e.id)) };
  }

  /**
   * 시세 시그널과 재무 건강을 합친 한 줄 판단. 둘 중 하나가 없거나 중립이면 null.
   * @returns {{tone:'bad'|'good'|'warn'|'info', label:string, text:string}|null}
   */
  function combinedView(signalState, healthState, health) {
    const down = signalState === "sell_review";
    const up = signalState === "buy_watch" || signalState === "rebound_watch";
    if (!down && !up) return null;
    if (!["good", "normal", "caution", "danger"].includes(healthState)) return null;
    const weak = healthState === "caution" || healthState === "danger";
    // 나쁜 이유가 부채비율뿐이면(수익·성장·자본잠식 이유 없음) '실적 악화'라고 하지 않는다(BL-57)
    const bad = health && Array.isArray(health.reasons) ? health.reasons.filter((r) => r.tone !== "good") : [];
    const debtOnly = weak && bad.length > 0 && bad.every((r) => r.kind === "debt");
    if (down) {
      if (debtOnly) return { tone: "warn", label: "재무 부담(부채) 동반 하락", text: "가격 하락에 부채 부담이 겹쳐 있습니다. 실적 쪽 문제는 보이지 않으니 부채·이자 부담과 업종 특성을 함께 보세요." };
      if (weak) return { tone: "bad", label: "실적 악화 동반 하락", text: "가격 하락에 실적·재무 악화가 겹쳐 있습니다. 정리 검토를 우선 살펴보세요." };
      if (healthState === "good") return { tone: "good", label: "가격만 하락", text: "가격은 약세지만 재무는 양호해 보유 근거는 유지됩니다. 지켜보기." };
      return { tone: "info", label: "재무 보통, 가격 약세", text: "재무는 보통이고 가격 흐름만 약세입니다." };
    }
    if (debtOnly) return { tone: "warn", label: "부채 부담 속 반등", text: "반등 신호가 있지만 부채 부담이 큽니다. 실적 쪽 문제는 보이지 않습니다." };
    if (weak) return { tone: "warn", label: "재무 악화 속 반등", text: "반등 신호가 있지만 재무가 좋지 않아 위험이 큽니다." };
    if (healthState === "good") return { tone: "good", label: "재무가 받쳐 주는 반등", text: "반등·매수 관심 신호에 재무도 양호합니다." };
    return { tone: "info", label: "재무 보통", text: "반등·매수 관심 신호가 있고 재무는 보통입니다." };
  }

  const HEALTH_RANK = { danger: 0, caution: 1, normal: 2, good: 3, insufficient: 4, not_applicable: 5 };
  const TONE_RANK = { danger: 0, warn: 1, good: 2 };

  /**
   * 보유 종목 전체의 재무 점검 요약표를 만든다(BL-39, design/13 §3-1). 저장하지 않고 화면을 그릴 때 계산한다.
   * 정렬: 위험 → 주의 → 보통 → 양호 → 재무 없음, 같은 상태면 이름순.
   * @param {{key:string, stock_name:string, market_kind:string, years:object[], is_fund_like?:boolean, fund_profile_kind?:string, missing_reason_text?:string}[]} items 종목과 그 종목의 연도별 재무 묶음(ETF 등은 is_fund_like, 금융업은 fund_profile_kind, 재무가 없을 때 이유는 missing_reason_text)
   * @returns {{holding_cnt:number, fund_target_cnt:number, fund_excluded_cnt:number, fund_etf_cnt:number, fund_financial_cnt:number, fund_collected_cnt:number, fund_missing_cnt:number, fund_summary_row_list:object[]}}
   */
  function buildFundSummary(items, settings) {
    const fund_summary_row_list = (items || []).map((it) => {
      const health = it.health || assessHealth(it.years, settings, it.fund_profile_kind); // 종목 분석 모델이 이미 계산했으면 그것을 쓴다(BL-46)
      const isFinancial = health.health_state === "not_applicable";
      const { latest, prev } = latestPair(it.years);
      const sorted = [...health.reasons].sort((x, y) => TONE_RANK[x.tone] - TONE_RANK[y.tone]);
      const reasonText = it.is_fund_like
        ? "ETF라 재무 없음"
        : isFinancial
          ? "금융업 — 부채비율 기준이 맞지 않아 재무 점검에서 제외"
          : latest
            ? sorted.slice(0, 2).map((r) => r.text).join(" · ")
            : it.missing_reason_text || "재무 없음 (기업 정보 받기 필요)";
      return {
        key: it.key,
        stock_name: it.stock_name,
        market_kind: it.market_kind,
        health_state: health.health_state,
        last_fiscal_year: health.latest_year,
        debt_ratio_rate: latest ? ratioOf(latest.total_liabilities_amount, latest.total_equity_amount) : null,
        operating_profit_amount: latest && isNum(latest.operating_profit_amount) ? latest.operating_profit_amount : null,
        operating_profit_growth_rate: latest && prev ? growth(latest.operating_profit_amount, prev.operating_profit_amount) : null,
        reason_text: reasonText || "특이 사항 없음",
        is_fund_like: Boolean(it.is_fund_like),
        is_financial: isFinancial && !it.is_fund_like,
      };
    });
    const excludedOf = (r) => r.is_fund_like || r.is_financial;
    fund_summary_row_list.sort((x, y) => Number(excludedOf(x)) - Number(excludedOf(y)) || HEALTH_RANK[x.health_state] - HEALTH_RANK[y.health_state] || String(x.stock_name).localeCompare(String(y.stock_name), "ko"));
    const etf = fund_summary_row_list.filter((r) => r.is_fund_like).length;
    const financial = fund_summary_row_list.filter((r) => r.is_financial).length;
    const excluded = etf + financial;
    const target = fund_summary_row_list.length - excluded;
    const collected = fund_summary_row_list.filter((r) => !excludedOf(r) && r.last_fiscal_year !== null).length;
    return { holding_cnt: fund_summary_row_list.length, fund_target_cnt: target, fund_excluded_cnt: excluded, fund_etf_cnt: etf, fund_financial_cnt: financial, fund_collected_cnt: collected, fund_missing_cnt: target - collected, fund_summary_row_list };
  }

  const api = {
    FUND_SIGNAL_DEFAULTS,
    FUND_PROFILE_KEYWORDS,
    FUND_PROFILE_LABEL,
    HEALTH_LABEL,
    mergeFundSettings,
    debtThresholds,
    resolveFundProfile,
    latestPair,
    assessHealth,
    yearEvents,
    valuationZone,
    evaluateFundEvents,
    acknowledgeEvents,
    combinedView,
    buildFundSummary,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FundSignals = api;
})(typeof window !== "undefined" ? window : globalThis);
