// 시장 상태 점검 (순수 함수 모음). 설계: design/15_시장상태점검.md
// - 저장된 시세 기록(종가·거래량)으로 거래정지 의심, 시세 변화 없음, 급등락, 거래량 급증 등을 알려 준다.
// - 공식 지정(거래정지·관리종목 등)을 대신하지 않는 참고 정보다. 화면과 저장소에 의존하지 않는다.
(function (root) {
  "use strict";

  // ===== 수정 영역: 기준값 =====
  const MARKET_STATUS_DEFAULTS = {
    halt_min_days: 3, // 거래량이 이 거래일 수 이상 연속 0이면 거래정지 의심
    flat_min_days: 10, // 같은 종가가 이 거래일 수 이상 연속이면 시세 변화 없음
    stale_days: 5, // 마지막 시세가 이 일수 이상 전이면 시세 지연
    move_alert_rate: 0.1, // 전일 대비 이 비율 이상이면 급등락(0.1 = 10%)
    limit_near_rate: 0.28, // 이 비율 이상이면 상·하한가 근접(국내는 하루 ±30% 제한)
    volume_surge_ratio: 5, // 직전 20일 평균 거래량의 이 배수 이상이면 거래량 급증
    near_extreme_rate: 0.01, // 52주 최고·최저의 이 비율 안이면 신고가·신저가 근처
  };
  // ===== 수정 영역 END =====

  const isNum = (v) => typeof v === "number" && Number.isFinite(v);

  function mergeMarketSettings(saved) {
    const out = { ...MARKET_STATUS_DEFAULTS };
    if (saved && typeof saved === "object") {
      for (const k of Object.keys(MARKET_STATUS_DEFAULTS)) {
        const v = Number(saved[k]);
        if (Number.isFinite(v) && v > 0) out[k] = v;
      }
    }
    ["halt_min_days", "flat_min_days", "stale_days"].forEach((k) => (out[k] = Math.max(1, Math.round(out[k]))));
    return out;
  }

  /** 날짜(YYYY-MM-DD) 두 개 사이의 일수(뒤 - 앞). */
  function daysBetween(fromIso, toIso) {
    return Math.round((Date.parse(String(toIso).slice(0, 10) + "T00:00:00Z") - Date.parse(String(fromIso).slice(0, 10) + "T00:00:00Z")) / 86400000);
  }

  const pct1 = (v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

  /**
   * 시세 기록으로 시장 상태를 점검한다.
   * @param {object[]} history 날짜별 기록(price_date, close_price, trade_volume 등)
   * @param {string} todayIso 오늘 날짜(YYYY-MM-DD)
   * @param {{marketKind?:'kr'|'us'}} opts
   * @returns {{has_data:boolean, halted:boolean, flat_only:boolean, signals_unreliable:boolean, halt_since:string|null, last_trade_date:string|null, halt_days:number, flat_days:number, stale_days:number|null, change_rate:number|null, volume_ratio:number|null, items:{kind:string, tone:'danger'|'warn'|'info', text:string}[]}}
   */
  function analyzeMarketStatus(history, todayIso, settings, opts) {
    const s = mergeMarketSettings(settings);
    const kr = !opts || opts.marketKind !== "us";
    const rows = (Array.isArray(history) ? history : [])
      .filter((e) => e && isNum(e.close_price) && e.close_price > 0 && e.price_date)
      .sort((a, b) => (a.price_date < b.price_date ? -1 : a.price_date > b.price_date ? 1 : 0));
    const out = { has_data: rows.length > 0, halted: false, flat_only: false, signals_unreliable: false, halt_since: null, last_trade_date: null, halt_days: 0, flat_days: 0, stale_days: null, change_rate: null, volume_ratio: null, items: [] };
    if (rows.length === 0) return out;
    const n = rows.length;
    const last = rows[n - 1];
    const prev = n > 1 ? rows[n - 2] : null;
    const add = (kind, tone, text) => out.items.push({ kind, tone, text });

    // 거래정지 의심: 거래량이 연속 0
    let zero = 0;
    for (let i = n - 1; i >= 0; i--) {
      if (isNum(rows[i].trade_volume) && rows[i].trade_volume <= 0) zero++;
      else break;
    }
    out.halt_days = zero;
    out.halted = zero >= s.halt_min_days;
    if (out.halted) {
      out.halt_since = rows[n - zero].price_date;
      out.last_trade_date = n - zero - 1 >= 0 ? rows[n - zero - 1].price_date : null;
      add("halt", "danger", `거래정지로 보입니다 — 거래량 0이 ${zero}거래일째(${out.halt_since}부터${out.last_trade_date ? `, 마지막 거래 ${out.last_trade_date}` : ""}). 거래소 공시로 확인하세요`);
    }

    // 시세 변화 없음: 같은 종가가 연속(거래정지 의심이 아닐 때)
    let flat = 1;
    for (let i = n - 2; i >= 0 && rows[i].close_price === last.close_price; i--) flat++;
    out.flat_days = flat;
    if (!out.halted && flat >= s.flat_min_days) {
      out.flat_only = true;
      add("flat", "warn", `${flat}거래일째 같은 가격(${last.close_price.toLocaleString("ko-KR")})입니다. 거래정지 등을 거래소 공시로 확인하세요`);
    }
    out.signals_unreliable = out.halted || out.flat_only;

    // 시세 지연
    if (todayIso) {
      out.stale_days = daysBetween(last.price_date, todayIso);
      if (out.stale_days >= s.stale_days) add("stale", "warn", `마지막 시세가 ${out.stale_days}일 전(${last.price_date})입니다. 시세를 새로고침하세요`);
    }

    if (!out.halted && prev) {
      // 급등락, 상·하한가 근접
      out.change_rate = last.close_price / prev.close_price - 1;
      if (Math.abs(out.change_rate) >= s.move_alert_rate) {
        const up = out.change_rate > 0;
        const near = kr && Math.abs(out.change_rate) >= s.limit_near_rate;
        add("move", "warn", `전일 대비 ${pct1(out.change_rate)} ${up ? "급등" : "급락"}${near ? ` (${up ? "상한가" : "하한가"} 근접)` : ""}`);
      }
      // 거래량 급증
      if (isNum(last.trade_volume) && last.trade_volume > 0) {
        const before = rows.slice(Math.max(0, n - 21), n - 1).map((e) => e.trade_volume).filter((v) => isNum(v) && v > 0);
        if (before.length >= 5) {
          const avg = before.reduce((a, b) => a + b, 0) / before.length;
          out.volume_ratio = avg > 0 ? last.trade_volume / avg : null;
          if (out.volume_ratio !== null && out.volume_ratio >= s.volume_surge_ratio) add("volume", "info", `거래량이 직전 20일 평균의 ${out.volume_ratio.toFixed(1)}배입니다`);
        }
      }
      // 52주 신고가·신저가 근처
      const year = rows.slice(-250);
      if (year.length >= 60) {
        const closes = year.map((e) => e.close_price);
        const hi = Math.max(...closes);
        const lo = Math.min(...closes);
        if (hi > lo) {
          if (last.close_price >= hi * (1 - s.near_extreme_rate)) add("high52", "info", "52주 신고가 근처입니다");
          else if (last.close_price <= lo * (1 + s.near_extreme_rate)) add("low52", "info", "52주 신저가 근처입니다");
        }
      }
    }
    return out;
  }

  const api = { MARKET_STATUS_DEFAULTS, mergeMarketSettings, daysBetween, analyzeMarketStatus };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MarketStatus = api;
})(typeof window !== "undefined" ? window : globalThis);
