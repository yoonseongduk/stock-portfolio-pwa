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
  };
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
    return out;
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

  const HEALTH_LABEL = { good: "재무 양호", normal: "재무 보통", caution: "재무 주의", danger: "재무 위험", insufficient: "재무 정보 없음" };

  /**
   * 재무 건강을 판정한다.
   * @param {object[]} years 연도별 재무 묶음(Fundamentals 형식)
   * @returns {{health_state:string, reasons:{tone:'good'|'warn'|'danger', text:string}[], latest_year:number|null}}
   */
  function assessHealth(years, settings) {
    const s = mergeFundSettings(settings);
    const { latest, prev } = latestPair(years);
    if (!latest) return { health_state: "insufficient", reasons: [], latest_year: null };
    const reasons = [];
    const add = (tone, text) => reasons.push({ tone, text });

    if (isNum(latest.operating_profit_amount)) {
      if (latest.operating_profit_amount > 0) add("good", `${latest.fiscal_year}년 영업이익 흑자`);
      else if (prev && isNum(prev.operating_profit_amount) && prev.operating_profit_amount <= 0) add("danger", `영업적자 2년 연속(${prev.fiscal_year}·${latest.fiscal_year}년)`);
      else add("warn", `${latest.fiscal_year}년 영업적자`);
    }
    if (isNum(latest.net_income_amount) && latest.net_income_amount < 0) add("warn", `${latest.fiscal_year}년 순적자`);
    if (isNum(latest.total_equity_amount) && latest.total_equity_amount <= 0) add("danger", "자본잠식(자본총계가 0 이하)");

    const debt = ratioOf(latest.total_liabilities_amount, latest.total_equity_amount);
    if (debt !== null) {
      if (debt > s.debt_ratio_danger) add("danger", `부채비율 ${pct0(debt)}로 매우 높음(${pct0(s.debt_ratio_danger)} 초과)`);
      else if (debt > s.debt_ratio_warn) add("warn", `부채비율 ${pct0(debt)}로 높음(${pct0(s.debt_ratio_warn)} 초과)`);
      else if (debt <= s.debt_ratio_low) add("good", `부채비율 ${pct0(debt)}로 낮음`);
    }
    const roe = ratioOf(latest.net_income_amount, latest.total_equity_amount);
    if (roe !== null && roe >= s.roe_good_rate) add("good", `ROE ${pct0(roe)}`);
    else if (isNum(latest.net_income_amount) && isNum(latest.total_equity_amount) && latest.total_equity_amount > 0 && latest.net_income_amount < 0) add("warn", `ROE 음수(${pct(latest.net_income_amount / latest.total_equity_amount)})`);

    if (prev) {
      const sg = growth(latest.sales_amount, prev.sales_amount);
      if (sg !== null && sg >= s.growth_sales_rate) add("good", `매출 전년 대비 ${pct(sg)}`);
      else if (sg !== null && sg <= -s.growth_sales_rate) add("warn", `매출 전년 대비 ${pct(sg)}`);
      const og = growth(latest.operating_profit_amount, prev.operating_profit_amount);
      if (og !== null && isNum(latest.operating_profit_amount) && latest.operating_profit_amount > 0) {
        if (og >= s.growth_event_rate) add("good", `영업이익 전년 대비 ${pct(og)}`);
        else if (og <= -s.growth_event_rate) add("warn", `영업이익 전년 대비 ${pct(og)}`);
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
  function yearEvents(years, settings) {
    const s = mergeFundSettings(settings);
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
      if (d1 !== null && d0 !== null && d1 >= s.debt_ratio_warn && d1 - d0 >= s.debt_jump_rate) {
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
      const events = yearEvents(it.years, s);
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
  function combinedView(signalState, healthState) {
    const down = signalState === "sell_review";
    const up = signalState === "buy_watch" || signalState === "rebound_watch";
    if (!down && !up) return null;
    if (!["good", "normal", "caution", "danger"].includes(healthState)) return null;
    const weak = healthState === "caution" || healthState === "danger";
    if (down) {
      if (weak) return { tone: "bad", label: "실적 악화 동반 하락", text: "가격 하락에 실적·재무 악화가 겹쳐 있습니다. 정리 검토를 우선 살펴보세요." };
      if (healthState === "good") return { tone: "good", label: "가격만 하락", text: "가격은 약세지만 재무는 양호해 보유 근거는 유지됩니다. 지켜보기." };
      return { tone: "info", label: "재무 보통, 가격 약세", text: "재무는 보통이고 가격 흐름만 약세입니다." };
    }
    if (weak) return { tone: "warn", label: "재무 악화 속 반등", text: "반등 신호가 있지만 재무가 좋지 않아 위험이 큽니다." };
    if (healthState === "good") return { tone: "good", label: "재무가 받쳐 주는 반등", text: "반등·매수 관심 신호에 재무도 양호합니다." };
    return { tone: "info", label: "재무 보통", text: "반등·매수 관심 신호가 있고 재무는 보통입니다." };
  }

  const HEALTH_RANK = { danger: 0, caution: 1, normal: 2, good: 3, insufficient: 4 };
  const TONE_RANK = { danger: 0, warn: 1, good: 2 };

  /**
   * 보유 종목 전체의 재무 점검 요약표를 만든다(BL-39, design/13 §3-1). 저장하지 않고 화면을 그릴 때 계산한다.
   * 정렬: 위험 → 주의 → 보통 → 양호 → 재무 없음, 같은 상태면 이름순.
   * @param {{key:string, stock_name:string, market_kind:string, years:object[], is_fund_like?:boolean}[]} items 종목과 그 종목의 연도별 재무 묶음(ETF 등은 is_fund_like)
   * @returns {{holding_cnt:number, fund_target_cnt:number, fund_excluded_cnt:number, fund_collected_cnt:number, fund_missing_cnt:number, fund_summary_row_list:object[]}}
   */
  function buildFundSummary(items, settings) {
    const fund_summary_row_list = (items || []).map((it) => {
      const health = assessHealth(it.years, settings);
      const { latest, prev } = latestPair(it.years);
      const sorted = [...health.reasons].sort((x, y) => TONE_RANK[x.tone] - TONE_RANK[y.tone]);
      const reasonText = it.is_fund_like ? "ETF라 재무 없음" : latest ? sorted.slice(0, 2).map((r) => r.text).join(" · ") : "재무 없음 (기업 정보 받기 필요)";
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
      };
    });
    fund_summary_row_list.sort((x, y) => Number(x.is_fund_like) - Number(y.is_fund_like) || HEALTH_RANK[x.health_state] - HEALTH_RANK[y.health_state] || String(x.stock_name).localeCompare(String(y.stock_name), "ko"));
    const excluded = fund_summary_row_list.filter((r) => r.is_fund_like).length;
    const target = fund_summary_row_list.length - excluded;
    const collected = fund_summary_row_list.filter((r) => !r.is_fund_like && r.last_fiscal_year !== null).length;
    return { holding_cnt: fund_summary_row_list.length, fund_target_cnt: target, fund_excluded_cnt: excluded, fund_collected_cnt: collected, fund_missing_cnt: target - collected, fund_summary_row_list };
  }

  const api = {
    FUND_SIGNAL_DEFAULTS,
    HEALTH_LABEL,
    mergeFundSettings,
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
