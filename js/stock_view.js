// 종목 분석 모델 StockView (순수 함수). 설계: design/17_화면재설계_큰그림.md §6 (BL-46, CM-042)
// - 저장된 데이터(보유·시세 기록·재무)로 종목마다 분석 결과 하나를 만든다. 화면은 이 결과만 읽고 직접 계산하지 않는다.
// - 시그널·재무 건강·시장 상태·종합 판단 계산은 기존 모듈(Signals, FundSignals, MarketStatus)을 그대로 쓴다. 여기서는 한 곳에 모으기만 한다.
// - 화면·저장소·시간에 의존하지 않는다(오늘 날짜는 입력으로 받는다). 브라우저에서는 window.StockView, node 시험에서는 require() 로 쓴다.
(function (root) {
  "use strict";

  const isNode = typeof module !== "undefined" && module.exports;
  const Signals = isNode ? require("./signals.js") : root.Signals;
  const MarketStatus = isNode ? require("./market_status.js") : root.MarketStatus;
  const FundSignals = isNode ? require("./fund_signals.js") : root.FundSignals;
  const Fundamentals = isNode ? require("./fundamentals.js") : root.Fundamentals;

  /**
   * 평가금액·손익·수익률. profit_rate 는 0~1 소수(NR-10)이고 화면에서만 %로 바꾼다.
   * @param {{holding_quantity:number, average_price:number}} holding
   */
  function calcProfit(holding, currentPrice) {
    const buy_amount = holding.holding_quantity * holding.average_price;
    const evaluation_amount = holding.holding_quantity * currentPrice;
    const profit_amount = evaluation_amount - buy_amount;
    const profit_rate = buy_amount === 0 ? 0 : profit_amount / buy_amount;
    return { buy_amount, evaluation_amount, profit_amount, profit_rate };
  }

  /**
   * 종목 하나의 분석 결과를 만든다.
   * @param {object} input
   * @param {string} input.holding_key 종목 키(시장|종목명)
   * @param {{market_kind:string, stock_name:string, holding_quantity:number, average_price:number}} input.holding
   * @param {number} input.current_price
   * @param {string} [input.symbol_code]
   * @param {{exchange_kind?:string, sector_name?:string, holding_style_kind?:string}} [input.info] 종목정보
   * @param {object[]} [input.history] 일별 시세 기록
   * @param {object[]} [input.fund_years] 연도별 재무 묶음
   * @param {{signal:object, atr_period:number, market:object, fund:object}} input.settings 계산 기준값
   * @param {string} input.today_iso 오늘(YYYY-MM-DD)
   */
  function buildStockView(input) {
    const h = input.holding;
    const info = input.info || {};
    const s = input.settings;
    const history = input.history || [];
    const fundYears = input.fund_years || [];
    const price = Number(input.current_price) || 0;

    const signal = Signals.computeSignal(history, s.signal, s.atr_period, { average_price: h.average_price });
    const market = MarketStatus.analyzeMarketStatus(history, input.today_iso, s.market, { marketKind: h.market_kind });
    const health = FundSignals.assessHealth(fundYears, s.fund);
    // 거래정지 의심이면 시세 시그널은 쓰지 않는다(종합 판단에서 중립으로 본다)
    const combined = FundSignals.combinedView(market.signals_unreliable ? "neutral" : signal.signal_state, health.health_state);
    return {
      holding_key: input.holding_key,
      stock_name: h.stock_name,
      market_kind: h.market_kind,
      symbol_code: input.symbol_code || "",
      exchange_kind: info.exchange_kind || "",
      sector_name: info.sector_name || "",
      holding_style_kind: info.holding_style_kind === "trade" ? "trade" : "long",
      is_fund_like: Fundamentals.isFundLike(h.stock_name),
      holding_quantity: h.holding_quantity,
      average_price: h.average_price,
      current_price: price,
      ...calcProfit(h, price),
      fund_years: fundYears,
      signal,
      market,
      health,
      combined,
    };
  }

  /** 여러 종목을 한 번에(계산 기준값·오늘 날짜는 공통). 입력 순서를 유지한다. */
  function buildStockViews(inputs, shared) {
    return (inputs || []).map((it) => buildStockView({ ...it, settings: shared.settings, today_iso: shared.today_iso }));
  }

  const api = { calcProfit, buildStockView, buildStockViews };
  if (isNode) module.exports = api;
  else root.StockView = api;
})(typeof window !== "undefined" ? window : globalThis);
