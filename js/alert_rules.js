// 목표가·손절가 알림 계산 (순수 함수 모음). 설계: design/10_목표가손절가알림.md
// - 화면·저장소·시간에 의존하지 않는다. 브라우저에서는 window.AlertRules, node 시험에서는 require() 로 같이 쓴다.
// - 산식은 시장의 일반적인 방식이다: 손절 = 매수가 - 2×ATR(14) (히스토리가 부족하면 고정 -10%), 목표 = 손익비 1:2.
// - 아래 ALERT_DEFAULTS 가 수정 영역이다. 설정 화면에서 바꾼 값이 이 기본값 위에 덮인다.
(function (root) {
  "use strict";

  // ===== 수정 영역: 기본 산식 상수 =====
  const ALERT_DEFAULTS = {
    default_stop_rate: 0.1, // 히스토리가 부족할 때의 고정 손절폭(10%)
    reward_risk_ratio: 2, // 손익비. 목표폭 = 손절폭 × 이 값
    atr_period: 14, // ATR 계산 기간(거래일)
    atr_multiple: 2, // 손절폭 = 이 값 × ATR
    min_stop_rate: 0.07, // 손절폭 하한(7%)
    max_stop_rate: 0.2, // 손절폭 상한(20%)
  };
  // ===== 수정 영역 END =====

  const EPS = 1e-9;

  /** 저장된 설정과 기본값을 합친다. 숫자가 아니거나 0 이하인 값은 기본값을 쓴다. */
  function mergeSettings(saved) {
    const out = { ...ALERT_DEFAULTS };
    if (saved && typeof saved === "object") {
      for (const k of Object.keys(ALERT_DEFAULTS)) {
        const v = Number(saved[k]);
        if (Number.isFinite(v) && v > 0) out[k] = v;
      }
    }
    if (out.min_stop_rate > out.max_stop_rate) out.min_stop_rate = out.max_stop_rate;
    out.atr_period = Math.max(2, Math.round(out.atr_period));
    return out;
  }

  /** 설정값 묶음의 식별 문자열. 바뀌면 자동 규칙을 다시 계산한다. */
  function settingsStamp(settings) {
    const s = mergeSettings(settings);
    return Object.keys(ALERT_DEFAULTS)
      .map((k) => s[k])
      .join("/");
  }

  const isNum = (v) => typeof v === "number" && Number.isFinite(v);

  /** 시장별 가격 반올림: 국내는 원 단위, 미국은 센트. */
  function roundPrice(marketKind, value) {
    if (!isNum(value)) return value;
    return marketKind === "us" ? Math.round(value * 100) / 100 : Math.round(value);
  }

  /**
   * ATR(평균 진폭)을 계산한다. 기록이 period+1일 미만이면 null.
   * True Range = max(고가-저가, |고가-전일종가|, |저가-전일종가|). 고가·저가가 없으면 |종가-전일종가|.
   * @param {{price_date:string, high_price?:number, low_price?:number, close_price:number}[]} history
   */
  function computeAtr(history, period) {
    const n = Math.max(2, Math.round(period || ALERT_DEFAULTS.atr_period));
    const rows = (Array.isArray(history) ? history : [])
      .filter((e) => e && isNum(e.close_price) && e.close_price > 0)
      .sort((a, b) => (a.price_date < b.price_date ? -1 : a.price_date > b.price_date ? 1 : 0));
    if (rows.length < n + 1) return null;
    const recent = rows.slice(-(n + 1));
    let sum = 0;
    for (let i = 1; i < recent.length; i++) {
      const prevClose = recent[i - 1].close_price;
      const e = recent[i];
      const hasRange = isNum(e.high_price) && isNum(e.low_price) && e.high_price > 0 && e.low_price > 0 && e.high_price >= e.low_price;
      sum += hasRange
        ? Math.max(e.high_price - e.low_price, Math.abs(e.high_price - prevClose), Math.abs(e.low_price - prevClose))
        : Math.abs(e.close_price - prevClose);
    }
    return sum / n;
  }

  /**
   * 평균단가 기준 권장 목표가·손절가.
   * @returns {{stop_price:number, target_price:number, stop_rate:number, target_rate:number, calc_kind:'atr'|'fixed'}|null}
   */
  function recommendLevels(averagePrice, marketKind, history, settings) {
    if (!isNum(averagePrice) || averagePrice <= 0) return null;
    const s = mergeSettings(settings);
    const atr = computeAtr(history, s.atr_period);
    let stopPct;
    let basis;
    if (atr !== null && atr > 0) {
      stopPct = Math.min(s.max_stop_rate, Math.max(s.min_stop_rate, (s.atr_multiple * atr) / averagePrice));
      basis = "atr";
    } else {
      stopPct = s.default_stop_rate;
      basis = "fixed";
    }
    const targetPct = stopPct * s.reward_risk_ratio;
    return {
      stop_price: roundPrice(marketKind, averagePrice * (1 - stopPct)),
      target_price: roundPrice(marketKind, averagePrice * (1 + targetPct)),
      stop_rate: stopPct,
      target_rate: targetPct,
      calc_kind: basis,
    };
  }

  /**
   * 사용자가 쓴 값을 가격으로 해석한다. 가격(`85000`, `1,250.5`)이나 평균단가 대비 비율(`+25%`, `-8%`)을 받는다.
   * 부호가 없는 비율은 목표가는 +, 손절가는 -로 본다. 빈 칸은 '끄기'(price:null).
   * @param {'target'|'stop'} kind
   * @returns {{ok:boolean, price?:number|null, error?:string}}
   */
  function parseLevelInput(text, averagePrice, marketKind, kind) {
    const raw = String(text === undefined || text === null ? "" : text).trim().replace(/,/g, "");
    if (raw === "") return { ok: true, price: null };
    if (raw.endsWith("%")) {
      const body = raw.slice(0, -1).trim();
      if (!/^[+-]?\d+(\.\d+)?$/.test(body)) return { ok: false, error: "비율은 +20%, -8% 처럼 써 주세요." };
      if (!isNum(averagePrice) || averagePrice <= 0) return { ok: false, error: "평균단가가 없어 비율을 가격으로 바꿀 수 없습니다." };
      let pct = Number(body);
      if (!/^[+-]/.test(body)) pct = kind === "stop" ? -Math.abs(pct) : Math.abs(pct);
      const price = roundPrice(marketKind, averagePrice * (1 + pct / 100));
      if (!(price > 0)) return { ok: false, error: "계산된 가격이 0 이하입니다." };
      return { ok: true, price };
    }
    if (!/^\d+(\.\d+)?$/.test(raw)) return { ok: false, error: "가격(숫자) 또는 비율(예: +20%)로 써 주세요." };
    const price = Number(raw);
    if (!(price > 0)) return { ok: false, error: "가격은 0보다 커야 합니다." };
    return { ok: true, price };
  }

  /** 평균단가 대비 비율(0~1 소수, 표준 NR-10). */
  function pctFromAverage(price, averagePrice) {
    if (!isNum(price) || !isNum(averagePrice) || averagePrice <= 0) return null;
    return price / averagePrice - 1;
  }

  /** 평균단가·서로의 관계가 어긋나면 확인용 문장 목록을 돌려준다(없으면 빈 배열). */
  function levelWarnings(averagePrice, targetPrice, stopPrice) {
    const out = [];
    if (isNum(targetPrice) && isNum(averagePrice) && targetPrice <= averagePrice) out.push("목표가가 평균단가 이하입니다.");
    if (isNum(stopPrice) && isNum(averagePrice) && stopPrice >= averagePrice) out.push("손절가가 평균단가 이상입니다.");
    if (isNum(targetPrice) && isNum(stopPrice) && targetPrice <= stopPrice) out.push("목표가가 손절가 이하입니다.");
    return out;
  }

  /** 현재가와 규칙으로 상태를 판정한다. 현재가가 없으면 'none'. */
  function judgeAlert(currentPrice, rule) {
    if (!rule || !isNum(currentPrice) || currentPrice <= 0) return "none";
    if (isNum(rule.stop_price) && currentPrice <= rule.stop_price) return "hit_stop";
    if (isNum(rule.target_price) && currentPrice >= rule.target_price) return "hit_target";
    return "none";
  }

  function autoRule(holding, history, settings, nowIso, previous) {
    const rec = recommendLevels(holding.average_price, holding.market_kind, history, settings);
    if (!rec) return previous || null;
    return {
      target_price: rec.target_price,
      stop_price: rec.stop_price,
      rule_kind: "auto",
      rule_basis_price: holding.average_price,
      stop_rate: rec.stop_rate,
      target_rate: rec.target_rate,
      calc_kind: rec.calc_kind,
      settings_id: settingsStamp(settings),
      alert_state: previous ? previous.alert_state || "none" : "none",
      alert_ack_state: previous ? previous.alert_ack_state || "none" : "none",
      rule_updated_at: nowIso,
    };
  }

  /**
   * 규칙을 만들거나, 자동(auto) 규칙이 낡았으면 다시 계산한다. 직접(manual) 규칙은 그대로 둔다.
   * 다시 계산하는 때: 규칙 없음 / 평균단가가 바뀜 / 설정값이 바뀜 / 고정(fixed)이었는데 ATR 을 쓸 수 있게 됨.
   */
  function reconcileRule(rule, holding, history, settings, nowIso) {
    if (!rule) return autoRule(holding, history, settings, nowIso, null);
    if (rule.rule_kind === "manual") return rule;
    const stale =
      !isNum(rule.rule_basis_price) ||
      Math.abs(rule.rule_basis_price - holding.average_price) > EPS ||
      rule.settings_id !== settingsStamp(settings) ||
      (rule.calc_kind === "fixed" && computeAtr(history, mergeSettings(settings).atr_period) !== null);
    return stale ? autoRule(holding, history, settings, nowIso, rule) : rule;
  }

  /**
   * 보유 종목 전체의 규칙을 맞추고 상태를 판정한다. 보유가 아닌 종목의 규칙은 건드리지 않는다.
   * @param {Record<string, object>} ruleMap holding_key -> rule
   * @param {{key:string, market_kind:string, average_price:number}[]} holdings
   * @returns {{ rule_map:Record<string,object>, changed:boolean, pending:{key:string, alert_state:string}[] }}
   */
  function evaluateAlerts(ruleMap, holdings, prices, historyMap, settings, nowIso) {
    const next = { ...(ruleMap || {}) };
    const pending = [];
    let changed = false;
    for (const h of holdings) {
      const before = next[h.key];
      let rule = reconcileRule(before, h, (historyMap || {})[h.key] || [], settings, nowIso);
      if (!rule) continue;
      const state = judgeAlert((prices || {})[h.key], rule);
      if (state !== rule.alert_state) {
        rule = { ...rule, alert_state: state, alert_ack_state: state === "none" ? "none" : rule.alert_ack_state || "none" };
      }
      if (JSON.stringify(rule) !== JSON.stringify(before)) {
        next[h.key] = rule;
        changed = true;
      }
      if (state !== "none" && state !== rule.alert_ack_state) pending.push({ key: h.key, alert_state: state });
    }
    return { rule_map: next, changed, pending };
  }

  /** 알림을 확인(닫음) 처리한다. 같은 상태에서는 배너가 다시 뜨지 않는다. */
  function acknowledgeAlert(rule) {
    return rule ? { ...rule, alert_ack_state: rule.alert_state } : rule;
  }

  /** 사용자가 값을 고쳤을 때: manual 규칙으로 바꾼다(null 이면 그 알림을 끈다). */
  function applyManualLevels(rule, targetPrice, stopPrice, nowIso) {
    const base = rule || {};
    return {
      ...base,
      target_price: targetPrice === null || targetPrice === undefined ? null : targetPrice,
      stop_price: stopPrice === null || stopPrice === undefined ? null : stopPrice,
      rule_kind: "manual",
      alert_state: base.alert_state || "none",
      alert_ack_state: base.alert_ack_state || "none",
      rule_updated_at: nowIso,
    };
  }

  const api = {
    ALERT_DEFAULTS,
    mergeSettings,
    settingsStamp,
    roundPrice,
    computeAtr,
    recommendLevels,
    parseLevelInput,
    pctFromAverage,
    levelWarnings,
    judgeAlert,
    reconcileRule,
    evaluateAlerts,
    acknowledgeAlert,
    applyManualLevels,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AlertRules = api;
})(typeof window !== "undefined" ? window : globalThis);
