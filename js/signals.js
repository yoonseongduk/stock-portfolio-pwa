// 시세 시그널 계산 (순수 함수 모음). 설계: design/11_시그널과용어집.md
// - 평단과 무관하게 현재 시세 흐름(이동평균 교차, RSI, 추세 이탈)으로 매수 관심/매도 검토를 판정한다.
// - 지표는 과거 가격으로 계산한 참고 정보이며 매매 권유가 아니다.
// - ATR 계산은 alert_rules.js 의 computeAtr 를 그대로 쓴다(공통 코드 재사용, CM-031).
(function (root) {
  "use strict";

  const AlertRules = typeof module !== "undefined" && module.exports ? require("./alert_rules.js") : root.AlertRules;

  // ===== 수정 영역: 기본 산식 상수 =====
  const SIGNAL_DEFAULTS = {
    sma_short_period: 20, // 단기 이동평균(거래일)
    sma_long_period: 60, // 장기 이동평균(거래일)
    cross_lookback_days: 5, // 이 기간 안의 교차만 근거로 본다
    rsi_period: 14,
    rsi_buy_level: 30, // 이하면 과매도
    rsi_sell_level: 70, // 이상이면 과열
    trail_lookback_days: 60, // 추적 손절선의 기준 최고 종가를 찾는 기간
    trail_atr_multiple: 3, // 추적 손절선 = 최고 종가 - 배수 × ATR
    max_weight_rate: 0.2, // 한 종목 최대 비중(0~1)
    rebound_min_reason_cnt: 2, // 반등 후보: RSI 되돌림이 없으면 매수 근거가 이 개수 이상이어야 한다 (BL-38)
    rebound_profit_limit_rate: 0, // 반등 후보: 현재가가 평단보다 이 비율(0~1)을 넘게 높으면 제외한다. 0이면 이익 중인 종목은 모두 제외
  };
  // ===== 수정 영역 END =====

  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const INT_KEYS = ["sma_short_period", "sma_long_period", "cross_lookback_days", "rsi_period", "trail_lookback_days", "rebound_min_reason_cnt"];

  /** 저장된 설정과 기본값을 합친다. 숫자가 아니거나 0 이하이면 기본값. 단기선이 장기선보다 길면 둘 다 기본값. */
  function mergeSignalSettings(saved) {
    const out = { ...SIGNAL_DEFAULTS };
    if (saved && typeof saved === "object") {
      for (const k of Object.keys(SIGNAL_DEFAULTS)) {
        const v = Number(saved[k]);
        if (Number.isFinite(v) && v > 0) out[k] = v;
      }
    }
    INT_KEYS.forEach((k) => (out[k] = Math.max(1, Math.round(out[k]))));
    if (out.sma_short_period >= out.sma_long_period) {
      out.sma_short_period = SIGNAL_DEFAULTS.sma_short_period;
      out.sma_long_period = SIGNAL_DEFAULTS.sma_long_period;
    }
    if (out.rsi_period < 2) out.rsi_period = 2;
    if (out.max_weight_rate > 1) out.max_weight_rate = 1;
    if (out.rsi_buy_level >= out.rsi_sell_level) {
      out.rsi_buy_level = SIGNAL_DEFAULTS.rsi_buy_level;
      out.rsi_sell_level = SIGNAL_DEFAULTS.rsi_sell_level;
    }
    return out;
  }

  /** 날짜순으로 정렬한 유효한 기록만 돌려준다(종가가 숫자이고 0보다 큰 것). */
  function cleanRows(history) {
    return (Array.isArray(history) ? history : [])
      .filter((e) => e && isNum(e.close_price) && e.close_price > 0)
      .sort((a, b) => (a.price_date < b.price_date ? -1 : a.price_date > b.price_date ? 1 : 0));
  }

  /** values[end-n+1 .. end] 의 단순 평균. 모자라면 null. end 를 안 주면 마지막. */
  function sma(values, n, end) {
    const e = end === undefined ? values.length - 1 : end;
    if (e < 0 || e - n + 1 < 0 || e >= values.length) return null;
    let sum = 0;
    for (let i = e - n + 1; i <= e; i++) sum += values[i];
    return sum / n;
  }

  /** RSI(Wilder 방식). 종가가 period+1개 미만이면 null. 하락이 없으면 100, 상승이 없으면 0. */
  function rsi(closes, period) {
    const n = period || SIGNAL_DEFAULTS.rsi_period;
    if (closes.length < n + 1) return null;
    let gain = 0;
    let loss = 0;
    for (let i = 1; i <= n; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gain += d;
      else loss -= d;
    }
    let avgGain = gain / n;
    let avgLoss = loss / n;
    for (let i = n + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      avgGain = (avgGain * (n - 1) + (d > 0 ? d : 0)) / n;
      avgLoss = (avgLoss * (n - 1) + (d < 0 ? -d : 0)) / n;
    }
    if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
    return 100 - 100 / (1 + avgGain / avgLoss);
  }

  /**
   * 날짜별 RSI(Wilder 방식, 그래프용). period+1일째부터 시작한다. 마지막 값은 rsi() 와 같다.
   * @returns {{price_date:string, value:number}[]}
   */
  function rsiSeries(history, period) {
    const rows = cleanRows(history);
    const n = period || SIGNAL_DEFAULTS.rsi_period;
    if (rows.length < n + 1) return [];
    const closes = rows.map((e) => e.close_price);
    let gain = 0;
    let loss = 0;
    for (let i = 1; i <= n; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gain += d;
      else loss -= d;
    }
    let avgGain = gain / n;
    let avgLoss = loss / n;
    const toRsi = () => (avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss));
    const out = [{ price_date: rows[n].price_date, value: toRsi() }];
    for (let i = n + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      avgGain = (avgGain * (n - 1) + (d > 0 ? d : 0)) / n;
      avgLoss = (avgLoss * (n - 1) + (d < 0 ? -d : 0)) / n;
      out.push({ price_date: rows[i].price_date, value: toRsi() });
    }
    return out;
  }

  /**
   * 최근 lookback 거래일 안의 단기·장기 이동평균 교차를 찾는다. 가장 최근 교차 하나를 돌려준다.
   * @returns {{kind:'golden'|'dead', days_ago:number}|null}
   */
  function findCross(closes, shortN, longN, lookback) {
    for (let k = 0; k < lookback; k++) {
      const idx = closes.length - 1 - k;
      const sNow = sma(closes, shortN, idx);
      const lNow = sma(closes, longN, idx);
      const sPrev = sma(closes, shortN, idx - 1);
      const lPrev = sma(closes, longN, idx - 1);
      if ([sNow, lNow, sPrev, lPrev].some((v) => v === null)) continue;
      if (sPrev <= lPrev && sNow > lNow) return { kind: "golden", days_ago: k };
      if (sPrev >= lPrev && sNow < lNow) return { kind: "dead", days_ago: k };
    }
    return null;
  }

  /**
   * 최근 lookback 거래일 안에 종가가 단기 이동평균선을 아래에서 위로 뚫었고 지금도 위에 있으면 그 시점을 돌려준다.
   * @returns {{days_ago:number}|null}
   */
  function findRecover(closes, shortN, lookback) {
    const last = closes.length - 1;
    const smaNow = sma(closes, shortN, last);
    if (smaNow === null || closes[last] <= smaNow) return null;
    for (let k = 0; k < lookback; k++) {
      const idx = last - k;
      const sNow = sma(closes, shortN, idx);
      const sPrev = sma(closes, shortN, idx - 1);
      if (sNow === null || sPrev === null) continue;
      if (closes[idx - 1] <= sPrev && closes[idx] > sNow) return { days_ago: k };
    }
    return null;
  }

  /**
   * 최근 lookback 거래일 안에 RSI 가 기준(보통 30) 이하였다가 지금은 기준 위로 올라왔는지(과매도에서 되돌림).
   * @returns {{days_ago:number, from_rsi:number}|null}
   */
  function findRsiRebound(closes, period, level, lookback) {
    const now = rsi(closes, period);
    if (now === null || now <= level) return null;
    for (let k = 1; k <= lookback; k++) {
      const prev = rsi(closes.slice(0, closes.length - k), period);
      if (prev !== null && prev <= level) return { days_ago: k - 1, from_rsi: prev };
    }
    return null;
  }

  /** 최근 최고 종가와 그 날로부터 구한 추적 손절선(최고 종가 - 배수×ATR). ATR 을 못 구하면 null. */
  function trailingStop(rows, lookback, atrMultiple, atrPeriod) {
    const recent = rows.slice(-lookback);
    if (recent.length === 0) return null;
    const peak = Math.max(...recent.map((e) => e.close_price));
    const atr = AlertRules.computeAtr(rows, atrPeriod);
    if (atr === null) return null;
    return { peak_close: peak, atr, stop_line: peak - atrMultiple * atr };
  }

  /** 날짜별 단순 이동평균(그래프용). n 거래일이 모이는 날부터 시작한다. @returns {{price_date:string, value:number}[]} */
  function smaSeries(history, n) {
    const rows = cleanRows(history);
    const closes = rows.map((e) => e.close_price);
    const out = [];
    for (let i = n - 1; i < rows.length; i++) out.push({ price_date: rows[i].price_date, value: sma(closes, n, i) });
    return out;
  }

  /**
   * 날짜별 추적 손절선(그래프용). 각 날짜의 선 = 그날까지 최근 lookback 거래일 최고 종가 - 배수 × 그날의 ATR.
   * ATR 을 구할 수 없는 앞부분은 건너뛴다. 마지막 값은 trailingStop() 의 stop_line 과 같다.
   * @returns {{price_date:string, stop_line:number}[]}
   */
  function trailingStopSeries(history, lookback, atrMultiple, atrPeriod) {
    const rows = cleanRows(history);
    const n = Math.max(2, Math.round(atrPeriod || AlertRules.ALERT_DEFAULTS.atr_period));
    const tr = rows.map((e, i) => {
      if (i === 0) return null;
      const prev = rows[i - 1].close_price;
      const hasRange = isNum(e.high_price) && isNum(e.low_price) && e.high_price > 0 && e.low_price > 0 && e.high_price >= e.low_price;
      return hasRange ? Math.max(e.high_price - e.low_price, Math.abs(e.high_price - prev), Math.abs(e.low_price - prev)) : Math.abs(e.close_price - prev);
    });
    const out = [];
    for (let i = n; i < rows.length; i++) {
      let sum = 0;
      for (let j = i - n + 1; j <= i; j++) sum += tr[j];
      let peak = 0;
      for (let j = Math.max(0, i - lookback + 1); j <= i; j++) peak = Math.max(peak, rows[j].close_price);
      out.push({ price_date: rows[i].price_date, stop_line: peak - atrMultiple * (sum / n) });
    }
    return out;
  }

  /** 최근 250거래일 종가 범위에서 현재 위치와 고점 대비 하락률(0~1 소수, 하락은 음수). */
  function rangePosition(rows, days) {
    const recent = rows.slice(-(days || 250));
    if (recent.length === 0) return null;
    const closes = recent.map((e) => e.close_price);
    const high = Math.max(...closes);
    const low = Math.min(...closes);
    const last = closes[closes.length - 1];
    return {
      high_close: high,
      low_close: low,
      position_rate: high === low ? 0.5 : (last - low) / (high - low),
      drawdown_rate: last / high - 1,
      days_cnt: recent.length,
    };
  }

  const pct1 = (v) => `${(v * 100).toFixed(1)}%`;

  /**
   * 종목 하나의 시세 시그널을 계산한다.
   * @param {{average_price?:number}} [ctx] 평단을 알면 넘긴다. 평단 위(이익 중)인 종목은 반등 후보에서 뺀다(BL-38). 없으면 그 조건은 건너뛴다
   * @returns {{signal_state:string, buy_reasons:string[], sell_reasons:string[], metrics:object, needed_cnt:number}}
   */
  function computeSignal(history, settings, atrPeriod, ctx) {
    const s = mergeSignalSettings(settings);
    const atrN = atrPeriod || AlertRules.ALERT_DEFAULTS.atr_period;
    const rows = cleanRows(history);
    const needed = Math.max(s.sma_long_period + s.cross_lookback_days, s.trail_lookback_days, atrN + 1, s.rsi_period + 1) + 1;
    const base = { buy_reasons: [], sell_reasons: [], metrics: { rows_cnt: rows.length }, needed_cnt: needed };
    if (rows.length < needed) return { signal_state: "insufficient", ...base };

    const closes = rows.map((e) => e.close_price);
    const last = closes[closes.length - 1];
    const m = {
      rows_cnt: rows.length,
      current_price: last,
      sma_short: sma(closes, s.sma_short_period),
      sma_long: sma(closes, s.sma_long_period),
      rsi: rsi(closes, s.rsi_period),
      cross: findCross(closes, s.sma_short_period, s.sma_long_period, s.cross_lookback_days),
      trail: trailingStop(rows, s.trail_lookback_days, s.trail_atr_multiple, atrN),
      range: rangePosition(rows, 250),
      recover: findRecover(closes, s.sma_short_period, s.cross_lookback_days),
      rsi_rebound: findRsiRebound(closes, s.rsi_period, s.rsi_buy_level, s.cross_lookback_days),
    };
    const buy = [];
    const sell = [];
    const sellHot = []; // 매도 근거 중 '과열'(상승 쪽) 근거. 이것이 있으면 반등 후보로 보지 않는다
    const ago = (n) => (n === 0 ? "오늘" : n + "거래일 전");
    if (m.cross && m.cross.kind === "golden") {
      buy.push(`${s.sma_short_period}일선이 ${s.sma_long_period}일선을 위로 뚫음 (골든크로스, ${m.cross.days_ago === 0 ? "오늘" : m.cross.days_ago + "거래일 전"})`);
    }
    if (m.cross && m.cross.kind === "dead") {
      sell.push(`${s.sma_short_period}일선이 ${s.sma_long_period}일선을 아래로 뚫음 (데드크로스, ${m.cross.days_ago === 0 ? "오늘" : m.cross.days_ago + "거래일 전"})`);
    }
    if (isNum(m.rsi) && m.rsi <= s.rsi_buy_level) buy.push(`RSI ${m.rsi.toFixed(1)}로 ${s.rsi_buy_level} 이하 (과매도)`);
    if (isNum(m.rsi) && m.rsi >= s.rsi_sell_level) {
      sell.push(`RSI ${m.rsi.toFixed(1)}로 ${s.rsi_sell_level} 이상 (과열)`);
      sellHot.push(true);
    }
    if (m.recover) buy.push(`현재가가 ${s.sma_short_period}일선을 아래에서 위로 뚫고 올라섬 (단기 반등 확인, ${ago(m.recover.days_ago)})`);
    if (m.rsi_rebound) buy.push(`RSI가 ${s.rsi_buy_level} 이하(${m.rsi_rebound.from_rsi.toFixed(1)})에서 ${s.rsi_buy_level} 위로 되돌림 (과매도 반등, ${ago(m.rsi_rebound.days_ago)})`);
    if (m.trail && last < m.trail.stop_line) {
      sell.push(`추세 이탈: 현재가가 추적 손절선(최근 ${s.trail_lookback_days}일 최고 종가 − ${s.trail_atr_multiple}×ATR)보다 아래`);
    }
    // 매수 근거만 → 매수 관심, 매도 근거만 → 매도 검토.
    // 둘 다 있을 때: 매도 근거가 하락 추세(추세 이탈·데드크로스)뿐이면 '반등 후보'(고위험), 과열이 섞이면 중립(엇갈림).
    let state = "neutral";
    if (buy.length > 0 && sell.length === 0) state = "buy_watch";
    else if (sell.length > 0 && buy.length === 0) state = "sell_review";
    else if (buy.length > 0 && sell.length > 0 && sellHot.length === 0 && isReboundWorthy(m, buy.length, s, ctx)) state = "rebound_watch";
    return { signal_state: state, buy_reasons: buy, sell_reasons: sell, metrics: m, needed_cnt: needed, mixed: buy.length > 0 && sell.length > 0 };
  }

  /**
   * 반등 후보로 볼 만한가(BL-38, design/11 §2). ① RSI 되돌림이 있거나 매수 근거가 기준 개수 이상 ② 평단 위(이익 중)가 아님.
   * 20일선 회복 하나만으로는 후보가 아니다. 평단을 모르면 ②는 건너뛴다.
   */
  function isReboundWorthy(m, buyCnt, s, ctx) {
    if (!m.rsi_rebound && buyCnt < s.rebound_min_reason_cnt) return false;
    const avg = ctx && ctx.average_price;
    if (isNum(avg) && avg > 0 && isNum(m.current_price) && m.current_price > avg * (1 + s.rebound_profit_limit_rate)) return false;
    return true;
  }

  const isActive = (st) => st === "buy_watch" || st === "sell_review" || st === "rebound_watch";

  /**
   * 보유 종목들의 시그널 상태를 갱신하고 새로 알릴 것을 골라낸다.
   * 처음 계산한 종목(또는 직전이 '데이터 부족'이던 종목)은 확인된 상태로 시작한다(처음 열었을 때 한꺼번에 뜨지 않게).
   * @param {Record<string, {signal_state:string, signal_ack_state:string, signal_updated_at:string}>} signalMap
   * @param {{key:string, average_price?:number}[]} holdings
   * @param {Record<string, object[]>} historyMap
   */
  function evaluateSignals(signalMap, holdings, historyMap, settings, atrPeriod, nowIso) {
    const next = { ...(signalMap || {}) };
    const pending = [];
    let changed = false;
    for (const h of holdings) {
      const result = computeSignal((historyMap || {})[h.key], settings, atrPeriod, { average_price: h.average_price });
      const state = result.signal_state;
      const before = next[h.key];
      let entry;
      if (!before || before.signal_state === "insufficient") {
        entry = { signal_state: state, signal_ack_state: state, signal_updated_at: nowIso };
      } else if (before.signal_state !== state) {
        entry = { signal_state: state, signal_ack_state: isActive(state) ? before.signal_ack_state : state, signal_updated_at: nowIso };
      } else {
        entry = before;
      }
      if (JSON.stringify(entry) !== JSON.stringify(before)) {
        next[h.key] = entry;
        changed = true;
      }
      if (isActive(state) && entry.signal_ack_state !== state) pending.push({ key: h.key, signal_state: state, reasons: state === "sell_review" ? result.sell_reasons : result.buy_reasons });
    }
    return { signal_map: next, changed, pending };
  }

  /** 시그널을 확인(닫음) 처리한다. */
  function acknowledgeSignal(entry) {
    return entry ? { ...entry, signal_ack_state: entry.signal_state } : entry;
  }

  /**
   * 비중이 한도를 넘는 종목을 찾는다.
   * @param {{key:string, value:number}[]} items 같은 통화(원화 환산)로 맞춘 평가금액
   * @returns {{total:number, over:Record<string, number>}} over: 키 → 비중(0~1)
   */
  function weightOver(items, limit) {
    const total = items.reduce((sum, x) => sum + (isNum(x.value) ? x.value : 0), 0);
    const over = {};
    if (total > 0) {
      for (const x of items) {
        const w = x.value / total;
        if (w > limit) over[x.key] = w;
      }
    }
    return { total, over };
  }

  const api = {
    SIGNAL_DEFAULTS,
    mergeSignalSettings,
    cleanRows,
    sma,
    rsi,
    rsiSeries,
    findCross,
    findRecover,
    findRsiRebound,
    trailingStop,
    trailingStopSeries,
    smaSeries,
    rangePosition,
    computeSignal,
    evaluateSignals,
    acknowledgeSignal,
    weightOver,
    pct1,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Signals = api;
})(typeof window !== "undefined" ? window : globalThis);
