// Sprint 2: 매수/매도 거래내역을 입력하면 보유수량·평균단가를 자동 계산한다.
// 데이터는 폰(브라우저) 안의 localStorage에만 저장된다. 서버로 전송하지 않음.

// 저장 형식은 design/01_저장데이터형식.md (v2, 표준 변수명)를 따른다.
const TX_KEY = "stockTransactions_v2"; // trade_list
const PRICES_KEY = "stockCurrentPrices_v2"; // current_price_map: holding_key -> current_price
const SYMBOLS_KEY = "stockSymbols_v2"; // symbol_code_map: holding_key("market_kind|stock_name") -> 시세 조회용 코드(종목코드/티커)
const API_KEY_KEY = "stockApiKey_v1"; // us_price_api_key: Twelve Data (미국)
const KR_API_KEY_KEY = "stockKrApiKey_v1"; // kr_price_api_key: 공공데이터포털 (국내)
const PRICE_HISTORY_KEY = "stockPriceHistory_v2"; // price_history_map: 자동조회 결과를 날짜별로 누적(추후 추세 분석용)
const DIVIDENDS_KEY = "stockDividends_v2"; // dividend_list

// v1 저장 키(옛 형식). 앱이 읽어서 v2로 변환만 하고, 지우거나 고치지 않는다.
const LEGACY_TX_KEY = "stockTransactions_v1";
const LEGACY_PRICES_KEY = "stockCurrentPrices_v1";
const LEGACY_SYMBOLS_KEY = "stockSymbols_v1";
const LEGACY_PRICE_HISTORY_KEY = "stockPriceHistory_v1";
const LEGACY_DIVIDENDS_KEY = "stockDividends_v1";
const OLD_HOLDINGS_KEY = "stockHoldings_v1"; // Sprint 1에서 쓰던 저장 키 (이전용)

const BACKUP_VERSION = 2;

/** @typedef {{trade_id:string, trade_date:string, market_kind:'kr'|'us', stock_name:string, trade_kind:'buy'|'sell', trade_quantity:number, unit_price:number, trade_fee:number, sequence_no:number}} Trade */

function makeId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function holdingKey(marketKind, stockName) {
  return `${marketKind}|${stockName}`;
}

// ===== 데이터 형식 전환 BEGIN (v1 -> v2, 순수 함수만. tests/test_migration.js 가 이 구간을 꺼내 시험한다) =====
const LEGACY_MARKET = { KR: "kr", US: "us" };
const LEGACY_TRADE = { BUY: "buy", SELL: "sell" };

// "KR|삼성전자" -> "kr|삼성전자". 이미 v2 형식이면 그대로 둔다.
function convertLegacyHoldingKey(key) {
  const sep = key.indexOf("|");
  if (sep < 0) return key;
  const mapped = LEGACY_MARKET[key.slice(0, sep)];
  return mapped ? `${mapped}|${key.slice(sep + 1)}` : key;
}

function convertLegacyTrade(t) {
  if (t.trade_id !== undefined) return t; // 이미 v2
  return {
    trade_id: t.id,
    trade_date: t.date,
    market_kind: LEGACY_MARKET[t.market] || t.market,
    stock_name: t.name,
    trade_kind: LEGACY_TRADE[t.type] || t.type,
    trade_quantity: t.qty,
    unit_price: t.price,
    trade_fee: t.fee || 0,
    sequence_no: t.seq,
  };
}

function convertLegacyDividend(d) {
  if (d.dividend_id !== undefined) return d; // 이미 v2
  return {
    dividend_id: d.id,
    dividend_date: d.date,
    market_kind: LEGACY_MARKET[d.market] || d.market,
    stock_name: d.name,
    dividend_amount: d.amount,
    sequence_no: d.seq,
  };
}

function convertLegacyPriceEntry(e) {
  if (e.price_date !== undefined) return e; // 이미 v2
  return {
    price_date: e.date,
    open_price: e.open,
    high_price: e.high,
    low_price: e.low,
    close_price: e.close,
    trade_volume: e.volume,
  };
}

// holding_key 로 묶인 맵(현재가, 시세 코드)의 키만 바꾼다.
function convertLegacyKeyMap(map) {
  const out = {};
  Object.keys(map).forEach((k) => {
    out[convertLegacyHoldingKey(k)] = map[k];
  });
  return out;
}

function convertLegacyPriceHistoryMap(map) {
  const out = {};
  Object.keys(map).forEach((k) => {
    const list = Array.isArray(map[k]) ? map[k] : [];
    out[convertLegacyHoldingKey(k)] = list.map(convertLegacyPriceEntry);
  });
  return out;
}

// 백업 파일(v1 또는 v2)을 v2 형식으로 맞춘다. 파일에 없는 항목은 undefined 로 둔다(가져올 때 건너뜀).
function convertBackup(data) {
  if (data.backup_version >= 2) return data;
  const meta = data._meta || {};
  return {
    backup_app_name: meta.app || "주식현황관리",
    exported_at: meta.exportedAt,
    backup_version: BACKUP_VERSION,
    trade_list: Array.isArray(data.transactions) ? data.transactions.map(convertLegacyTrade) : undefined,
    current_price_map: data.prices && typeof data.prices === "object" ? convertLegacyKeyMap(data.prices) : undefined,
    symbol_code_map: data.symbols && typeof data.symbols === "object" ? convertLegacyKeyMap(data.symbols) : undefined,
    price_history_map:
      data.priceHistory && typeof data.priceHistory === "object" ? convertLegacyPriceHistoryMap(data.priceHistory) : undefined,
    dividend_list: Array.isArray(data.dividends) ? data.dividends.map(convertLegacyDividend) : undefined,
    us_price_api_key: typeof data.apiKey === "string" ? data.apiKey : undefined,
    kr_price_api_key: typeof data.krApiKey === "string" ? data.krApiKey : undefined,
  };
}
// ===== 데이터 형식 전환 END =====

// --- 저장소 ---

/** @returns {Trade[]} */
function loadTransactions() {
  const raw = localStorage.getItem(TX_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error("거래내역을 읽는 중 오류:", e);
    return [];
  }
}

/** @param {Trade[]} transactions */
function saveTransactions(transactions) {
  localStorage.setItem(TX_KEY, JSON.stringify(transactions));
}

/** @returns {Record<string, number>} holding_key -> current_price */
function loadPrices() {
  const raw = localStorage.getItem(PRICES_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error("현재가 데이터를 읽는 중 오류:", e);
    return {};
  }
}

function savePrices(prices) {
  localStorage.setItem(PRICES_KEY, JSON.stringify(prices));
}

/** @returns {Record<string, string>} holding_key -> symbol_code */
function loadSymbols() {
  const raw = localStorage.getItem(SYMBOLS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error("시세 코드 데이터를 읽는 중 오류:", e);
    return {};
  }
}

function saveSymbols(symbols) {
  localStorage.setItem(SYMBOLS_KEY, JSON.stringify(symbols));
}

function loadApiKey() {
  return localStorage.getItem(API_KEY_KEY) || "";
}

function saveApiKey(key) {
  localStorage.setItem(API_KEY_KEY, key);
}

function loadKrApiKey() {
  return localStorage.getItem(KR_API_KEY_KEY) || "";
}

function saveKrApiKey(key) {
  localStorage.setItem(KR_API_KEY_KEY, key);
}

/** @returns {Record<string, {price_date:string, open_price:number, high_price:number, low_price:number, close_price:number, trade_volume:number}[]>} holding_key -> 날짜순 가격 기록 */
function loadPriceHistory() {
  const raw = localStorage.getItem(PRICE_HISTORY_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error("가격 히스토리를 읽는 중 오류:", e);
    return {};
  }
}

function savePriceHistory(history) {
  localStorage.setItem(PRICE_HISTORY_KEY, JSON.stringify(history));
}

// 같은 날짜에 다시 조회하면 그날 값만 덮어쓰고, 새 날짜면 추가한다(하루 1개 기록 유지).
// ohlcv: {open_price, high_price, low_price, close_price, trade_volume} — 종가뿐 아니라
// 시가·고가·저가·거래량도 같이 남겨야 추세/변동성 분석에 쓸 수 있다.
function appendPriceHistory(key, dateStr, ohlcv) {
  const history = loadPriceHistory();
  const list = history[key] || [];
  const entry = { price_date: dateStr, ...ohlcv };
  const idx = list.findIndex((e) => e.price_date === dateStr);
  if (idx >= 0) {
    list[idx] = entry;
  } else {
    list.push(entry);
    list.sort((a, b) => (a.price_date < b.price_date ? -1 : a.price_date > b.price_date ? 1 : 0));
  }
  history[key] = list;
  savePriceHistory(history);
}

/** @typedef {{dividend_id:string, dividend_date:string, market_kind:'kr'|'us', stock_name:string, dividend_amount:number, sequence_no:number}} Dividend */

/** @returns {Dividend[]} */
function loadDividends() {
  const raw = localStorage.getItem(DIVIDENDS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error("배당 기록을 읽는 중 오류:", e);
    return [];
  }
}

function saveDividends(dividends) {
  localStorage.setItem(DIVIDENDS_KEY, JSON.stringify(dividends));
}

// v1(옛 형식) 저장 데이터를 v2(표준 변수명)로 변환해 새 키에 저장한다.
// v2 키가 이미 있으면 건너뛰고, v1 키는 지우거나 고치지 않는다(되돌리기·비교용).
// JSON 오류 등으로 변환하지 못한 항목은 건너뛰고 v1을 그대로 둔다.
function migrateLegacyDataIfNeeded() {
  const jobs = [
    [LEGACY_TX_KEY, TX_KEY, (v) => Array.isArray(v) && v.map(convertLegacyTrade)],
    [LEGACY_PRICES_KEY, PRICES_KEY, (v) => v && typeof v === "object" && !Array.isArray(v) && convertLegacyKeyMap(v)],
    [LEGACY_SYMBOLS_KEY, SYMBOLS_KEY, (v) => v && typeof v === "object" && !Array.isArray(v) && convertLegacyKeyMap(v)],
    [
      LEGACY_PRICE_HISTORY_KEY,
      PRICE_HISTORY_KEY,
      (v) => v && typeof v === "object" && !Array.isArray(v) && convertLegacyPriceHistoryMap(v),
    ],
    [LEGACY_DIVIDENDS_KEY, DIVIDENDS_KEY, (v) => Array.isArray(v) && v.map(convertLegacyDividend)],
  ];
  jobs.forEach(([legacyKey, newKey, convert]) => {
    if (localStorage.getItem(newKey) !== null) return; // 이미 v2가 있음
    const raw = localStorage.getItem(legacyKey);
    if (raw === null) return;
    try {
      const converted = convert(JSON.parse(raw));
      if (converted === false) throw new Error("예상하지 못한 데이터 구조");
      localStorage.setItem(newKey, JSON.stringify(converted));
      console.log(`저장 데이터를 v2로 변환했습니다: ${legacyKey} -> ${newKey}`);
    } catch (e) {
      console.error(`저장 데이터 변환 실패(v1은 그대로 둠): ${legacyKey}`, e);
    }
  });
}

// Sprint 1에서 입력해둔 종목이 있으면, 한 번만 거래내역(최초 매수)으로 변환해 이어서 쓴다.
function migrateOldHoldingsIfNeeded() {
  if (localStorage.getItem(TX_KEY) !== null) return; // 이미 마이그레이션 했음
  if (localStorage.getItem(LEGACY_TX_KEY) !== null) return; // v1 거래내역이 있으면(변환 실패 포함) 건드리지 않음

  const raw = localStorage.getItem(OLD_HOLDINGS_KEY);
  if (!raw) return;

  let oldHoldings;
  try {
    oldHoldings = JSON.parse(raw);
  } catch (e) {
    return;
  }
  if (!Array.isArray(oldHoldings) || oldHoldings.length === 0) return;

  const transactions = oldHoldings.map((h, i) => ({
    trade_id: makeId(),
    trade_date: todayISO(),
    market_kind: LEGACY_MARKET[h.market] || h.market,
    stock_name: h.name,
    trade_kind: "buy",
    trade_quantity: Number(h.qty) || 0,
    unit_price: Number(h.avgPrice) || 0,
    trade_fee: 0,
    sequence_no: Date.now() + i,
  }));

  const prices = loadPrices();
  oldHoldings.forEach((h) => {
    prices[holdingKey(LEGACY_MARKET[h.market] || h.market, h.name)] = Number(h.curPrice) || 0;
  });

  saveTransactions(transactions);
  savePrices(prices);
}

// --- 계산 ---

// 거래내역으로부터 종목별 보유수량·평균단가를 계산한다.
// 매수: 가중평균으로 평균단가 재계산. 매도: 수량만 줄이고 평균단가는 유지.
function computeHoldings(transactions) {
  const sorted = [...transactions].sort((a, b) => {
    if (a.trade_date !== b.trade_date) return a.trade_date < b.trade_date ? -1 : 1;
    return a.sequence_no - b.sequence_no;
  });

  const groups = new Map();

  for (const tx of sorted) {
    const key = holdingKey(tx.market_kind, tx.stock_name);
    if (!groups.has(key)) {
      groups.set(key, { market_kind: tx.market_kind, stock_name: tx.stock_name, holding_quantity: 0, average_price: 0 });
    }
    const g = groups.get(key);

    if (tx.trade_kind === "buy") {
      const costBefore = g.holding_quantity * g.average_price;
      const costAdded = tx.trade_quantity * tx.unit_price + (tx.trade_fee || 0);
      const newQty = g.holding_quantity + tx.trade_quantity;
      g.average_price = newQty === 0 ? 0 : (costBefore + costAdded) / newQty;
      g.holding_quantity = newQty;
    } else {
      g.holding_quantity = g.holding_quantity - tx.trade_quantity;
    }
  }

  return [...groups.values()].filter((g) => g.holding_quantity > 1e-9);
}

// profit_rate 는 0~1 소수다(표준, NR-10). 화면에서만 formatPercent 가 %로 바꾼다.
/** @param {{holding_quantity:number, average_price:number}} h @param {number} currentPrice */
function calc(h, currentPrice) {
  const buy_amount = h.holding_quantity * h.average_price;
  const evaluation_amount = h.holding_quantity * currentPrice;
  const profit_amount = evaluation_amount - buy_amount;
  const profit_rate = buy_amount === 0 ? 0 : profit_amount / buy_amount;
  return { buy_amount, evaluation_amount, profit_amount, profit_rate };
}

// --- 시세 자동 조회 ---
// 시장별 조회 소스를 각각 함수 하나에 모아둔다. 나중에 다른 소스(Plan B)로
// 바꾸고 싶으면 fetchCurrentPrice()의 분기와 해당 provider 함수만 고치면 된다.
// (조사 결과: 야후 파이낸스·네이버 금융·Stooq·공용 CORS 프록시는 브라우저
//  직접 호출이 막히거나 무가입으로는 못 쓴다.)

// Twelve Data 오류 응답을 Error 로 만든다. code 가 429 면 "분당 한도"라서 rate_limited 로 표시한다.
function rateLimitAwareError(data, fallbackMessage) {
  const err = new Error(data.message || fallbackMessage);
  err.rate_limited = Number(data.code) === 429;
  return err;
}

// 미국: Twelve Data — 브라우저 직접 호출 허용, 거의 실시간가.
// /quote 엔드포인트를 쓰면 현재가(close)뿐 아니라 시가·고가·저가·거래량도
// 같은 호출 한 번으로 받을 수 있다(트렌드 분석용 히스토리에 함께 저장).
async function fetchPriceTwelveData(apiKey, symbol) {
  const params = new URLSearchParams({ symbol, apikey: apiKey });
  const res = await fetch(`https://api.twelvedata.com/quote?${params.toString()}`);
  const data = await res.json();

  if (data.status === "error" || data.code) {
    throw rateLimitAwareError(data, "시세 조회에 실패했습니다.");
  }
  const current_price = Number(data.close);
  if (!Number.isFinite(current_price)) {
    throw new Error("가격 데이터를 이해할 수 없습니다.");
  }
  return {
    current_price,
    price_date: data.datetime || todayISO(),
    open_price: Number(data.open),
    high_price: Number(data.high),
    low_price: Number(data.low),
    trade_volume: Number(data.volume),
    exchange_kind: normalizeExchangeKind(data.exchange),
  };
}

// 국내: 공공데이터포털 금융위원회_주식시세정보 — 브라우저 직접 호출 허용.
// 실시간이 아니라 "직전 영업일 종가"(하루 지연)이므로 그렇게 표시해야 한다.
// 서비스키는 반드시 "일반 인증키(Decoding)"를 써야 한다 — URLSearchParams가
// 자동으로 다시 인코딩하므로 Encoding 키를 쓰면 이중 인코딩으로 깨진다.
// 공공데이터포털 주식시세정보 호출 공통 함수(시세 조회와 코드 찾기가 같이 쓴다).
// query 에 종목코드(likeSrtnCd)나 종목명(itmsNm, likeItmsNm) 조건을 넘긴다. 영업일을 모를 수 있어 9일 전부터 조회한다.
// range: { begin, end, pageNo } 로 기간(Date)과 쪽을 정한다. 없으면 오늘부터 9일 전까지, 1쪽.
async function fetchDataGoKrItems(apiKey, query, numOfRows, failMessage, range = {}) {
  const pad = (n) => String(n).padStart(2, "0");
  const toBasDt = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const end = range.end || new Date();
  const begin = range.begin || new Date(end.getTime() - 9 * 24 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    serviceKey: apiKey,
    resultType: "json",
    numOfRows: String(numOfRows),
    pageNo: String(range.pageNo || 1),
    ...query,
    beginBasDt: toBasDt(begin),
    endBasDt: toBasDt(end),
  });

  const res = await fetch(
    `https://apis.data.go.kr/1160100/GetStockSecuritiesInfoService_V2/getStockPriceInfo_V2?${params.toString()}`
  );
  const data = await res.json();

  if (!data.response) {
    const msg = data?.OpenAPI_ServiceResponse?.cmmMsgHeader?.returnAuthMsg;
    throw new Error(msg || failMessage);
  }

  const items = data.response?.body?.items?.item;
  return Array.isArray(items) ? items : items ? [items] : [];
}

async function fetchPriceDataGoKr(apiKey, symbol) {
  // 주의: 종목코드 조건은 "likeSrtnCd" 이다. "srtnCd"는 이 API에서 조용히 무시되고 전체 목록이 돌아온다(실측 확인).
  const list = await fetchDataGoKrItems(apiKey, { likeSrtnCd: symbol }, 10, "시세 조회에 실패했습니다.");
  if (list.length === 0) {
    throw new Error("해당 종목코드의 시세 데이터가 없습니다.");
  }

  const latest = list.reduce((a, b) => (b.basDt > a.basDt ? b : a));
  const current_price = Number(latest.clpr);
  if (!Number.isFinite(current_price)) {
    throw new Error("가격 데이터를 이해할 수 없습니다.");
  }

  const basDt = latest.basDt;
  const price_date = `${basDt.slice(0, 4)}-${basDt.slice(4, 6)}-${basDt.slice(6, 8)}`;
  return {
    current_price,
    price_date,
    open_price: Number(latest.mkp),
    high_price: Number(latest.hipr),
    low_price: Number(latest.lopr),
    trade_volume: Number(latest.trqu),
    exchange_kind: normalizeExchangeKind(latest.mrktCtg),
  };
}

async function fetchCurrentPrice(marketKind, symbol) {
  if (marketKind === "kr") {
    const apiKey = loadKrApiKey();
    if (!apiKey) throw new Error("공공데이터포털 API 키가 설정에 없습니다");
    return fetchPriceDataGoKr(apiKey, symbol);
  }
  const apiKey = loadApiKey();
  if (!apiKey) throw new Error("Twelve Data API 키가 설정에 없습니다");
  return fetchPriceTwelveData(apiKey, symbol);
}

// --- 시세 코드 자동 찾기 ---
// 종목명만 알고 시세 코드를 모를 때, 이름으로 검색해서 코드를 채워준다.
// 정확하지 않을 수 있으므로(동명이인 종목, ETF/워런트 혼재 등) "최선 추정"이고,
// 사용자가 시세 코드 칸에서 언제든 직접 고칠 수 있다.

// 국내: 공공데이터포털에 종목코드(srtnCd) 대신 종목명(itmsNm)으로 질의해서 찾는다.
// 같은 API·같은 키를 재사용(새 키 불필요).
async function lookupSymbolKr(apiKey, name) {
  const fail = "종목코드 검색에 실패했습니다.";
  let list = await fetchDataGoKrItems(apiKey, { itmsNm: name }, 100, fail);
  if (list.length === 0) {
    // 같은 이름이 없으면 이름을 포함하는 종목을 후보로만 찾는다(자동 저장하지 않는다).
    list = await fetchDataGoKrItems(apiKey, { likeItmsNm: name }, 100, fail);
  }
  if (list.length === 0) {
    throw new Error("이름으로 찾은 종목이 없습니다.");
  }

  const exact = list.find((item) => item.itmsNm === name);
  const best = exact || list[0];
  const seen = new Set();
  const candidate_list = [];
  list.forEach((item) => {
    if (!seen.has(item.srtnCd) && candidate_list.length < 5) {
      seen.add(item.srtnCd);
      candidate_list.push(`${item.itmsNm}(${item.srtnCd})`);
    }
  });
  return {
    symbol_code: best.srtnCd,
    matched_name: best.itmsNm,
    exact: Boolean(exact),
    candidate_list,
    exchange_kind: normalizeExchangeKind(best.mrktCtg),
  };
}

// 미국: Twelve Data symbol_search — 결과가 여러 거래소/ETF/워런트 섞여 나오므로
// 일반 보통주(Common Stock) + 미국 거래소를 우선으로 고른다.
async function lookupSymbolUs(apiKey, name) {
  const params = new URLSearchParams({ symbol: name, apikey: apiKey });
  const res = await fetch(`https://api.twelvedata.com/symbol_search?${params.toString()}`);
  const data = await res.json();

  if (data.status === "error" || data.code) {
    throw rateLimitAwareError(data, "종목코드 검색에 실패했습니다.");
  }
  const list = Array.isArray(data.data) ? data.data : [];
  if (list.length === 0) {
    throw new Error(
      "이름으로 찾은 종목이 없습니다. 미국 종목은 영문 이름이나 티커로 찾습니다. 한글 이름이면 시세 코드 칸에 티커(예: GOOGL)를 직접 입력해 주세요."
    );
  }

  const usExchanges = ["NASDAQ", "NYSE", "AMEX"];
  const best =
    list.find((d) => usExchanges.includes(d.exchange) && d.instrument_type === "Common Stock") ||
    list.find((d) => usExchanges.includes(d.exchange)) ||
    list[0];
  const target = name.trim().toLowerCase();
  const exact = best.symbol.toLowerCase() === target || String(best.instrument_name || "").toLowerCase() === target;
  const candidate_list = list.slice(0, 5).map((d) => `${d.instrument_name || d.symbol}(${d.symbol})`);
  return {
    symbol_code: best.symbol,
    matched_name: best.instrument_name || best.symbol,
    exact,
    candidate_list,
    exchange_kind: normalizeExchangeKind(best.exchange),
  };
}

// 시장별로 시세 코드를 찾는다. { symbol_code, matched_name, exact, candidate_list } 를 돌려준다.
// exact 는 입력한 이름과 같은 종목을 찾았다는 뜻이다(아니면 최선 추정).
async function lookupSymbolDetail(marketKind, stockName) {
  if (marketKind === "kr") {
    const apiKey = loadKrApiKey();
    if (!apiKey) throw new Error("공공데이터포털 API 키가 설정에 없습니다");
    return lookupSymbolKr(apiKey, stockName);
  }
  const apiKey = loadApiKey();
  if (!apiKey) throw new Error("Twelve Data API 키가 설정에 없습니다");
  return lookupSymbolUs(apiKey, stockName);
}

// 단건 '코드찾기'용: 최선 추정 코드 문자열만 돌려준다.
async function lookupSymbol(marketKind, stockName) {
  return (await lookupSymbolDetail(marketKind, stockName)).symbol_code;
}

// ===== 시세 코드 일괄 찾기 (design/03_시세코드일괄찾기.md) =====
// 조회 간격(ms): 국내는 짧게, 미국은 Twelve Data 무료 플랜의 분당 8회 제한 때문에 길게.
const SYMBOL_LOOKUP_GAP_MS = { kr: 200, us: 8000 };

// 시세 코드가 비어 있는 보유 종목만 찾는다. 이름이 정확히 같을 때만 저장하고, 아니면 후보만 알린다.
async function findMissingSymbols() {
  const symbols = loadSymbols();
  const targets = computeHoldings(loadTransactions()).filter((h) => !symbols[holdingKey(h.market_kind, h.stock_name)]);
  const found = [];
  const review = [];
  const failed = [];

  for (let i = 0; i < targets.length; i++) {
    const h = targets[i];
    setFetchStatus(`시세 코드 찾는 중... (${i + 1}/${targets.length}) ${h.stock_name}`);
    try {
      let r;
      try {
        r = await lookupSymbolDetail(h.market_kind, h.stock_name);
      } catch (e) {
        if (!e.rate_limited) throw e;
        await waitWithCountdown(
          RATE_LIMIT_WAIT_MS,
          (sec) => `미국 시세 분당 한도에 걸려 ${sec}초 기다린 뒤 ${h.stock_name} 코드를 다시 찾습니다 (${i + 1}/${targets.length})`
        );
        r = await lookupSymbolDetail(h.market_kind, h.stock_name);
      }
      if (r.exact) {
        const latest = loadSymbols(); // 중간에 사용자가 바꾼 값을 덮어쓰지 않게 매번 다시 읽는다
        latest[holdingKey(h.market_kind, h.stock_name)] = r.symbol_code;
        saveSymbols(latest);
        if (r.exchange_kind) updateStockInfo(holdingKey(h.market_kind, h.stock_name), { exchange_kind: r.exchange_kind }, { onlyIfEmpty: true });
        found.push(`${h.stock_name} → ${r.symbol_code} (${r.matched_name})`);
      } else {
        review.push(`${h.stock_name}: 같은 이름 없음, 후보 ${r.candidate_list.join(", ")}`);
      }
    } catch (e) {
      failed.push(`${h.stock_name}: ${e.message}`);
    }
    if (i < targets.length - 1) await sleep(SYMBOL_LOOKUP_GAP_MS[h.market_kind] ?? 0);
  }
  return { target_cnt: targets.length, found, review, failed };
}

function showSymbolBulkResult(result) {
  const details = document.getElementById("symbol-bulk-details");
  const list = document.getElementById("symbol-bulk-result");
  list.textContent = "";
  const add = (label, items) =>
    items.forEach((text) => {
      const li = document.createElement("li");
      li.textContent = `${label} ${text}`;
      list.appendChild(li);
    });
  add("✔ 저장", result.found);
  add("? 확인 필요(저장 안 함)", result.review);
  add("✖ 실패", result.failed);
  document.getElementById("symbol-bulk-summary").textContent =
    `일괄 찾기 결과 (저장 ${result.found.length} · 확인 필요 ${result.review.length} · 실패 ${result.failed.length})`;
  details.hidden = false;
  details.open = true;
}

function setupBulkSymbols() {
  const button = document.getElementById("bulk-symbol-btn");
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const result = await findMissingSymbols();
      if (result.target_cnt === 0) {
        setFetchStatus("시세 코드가 비어 있는 종목이 없습니다.");
        return;
      }
      render();
      showSymbolBulkResult(result);
      setFetchStatus(
        `${result.found.length}건 찾아 저장함 · 확인 필요 ${result.review.length}건(저장 안 함) · 실패 ${result.failed.length}건`
      );
    } finally {
      button.disabled = false;
    }
  });
}

/** 종목 하나의 현재가를 조회해 저장하고, 날짜별 히스토리에도 남긴다. */
async function fetchAndUpdatePrice(marketKind, stockName) {
  const key = holdingKey(marketKind, stockName);
  const symbol = loadSymbols()[key];

  if (!symbol) return { ok: false, message: "시세 코드가 없습니다" };

  try {
    const { current_price, price_date, open_price, high_price, low_price, trade_volume, exchange_kind } = await fetchCurrentPrice(
      marketKind,
      symbol
    );
    const prices = loadPrices();
    prices[key] = current_price;
    savePrices(prices);
    appendPriceHistory(key, price_date, { open_price, high_price, low_price, close_price: current_price, trade_volume });
    if (exchange_kind) updateStockInfo(key, { exchange_kind }, { onlyIfEmpty: true }); // 거래소가 비어 있을 때만 자동으로 채운다
    return { ok: true, current_price, price_date };
  } catch (e) {
    // 분당 한도 오류는 영어 원문이 길어서 짧은 한글로 바꿔 보여 준다.
    const message = e.rate_limited ? "분당 한도(8회)를 넘었습니다" : e.message;
    return { ok: false, message, rate_limited: Boolean(e.rate_limited) };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 전체 시세 새로고침 간격(ms) (design/04_전체시세새로고침.md). 미국(Twelve Data 무료 플랜)은 분당 8회 제한이라 8초.
const REFRESH_GAP_MS = { kr: 300, us: 8000 };
let RATE_LIMIT_WAIT_MS = 62000; // 분당 한도 오류(429)가 나면 다음 분까지 기다렸다가 1번만 다시 시도한다(시험에서는 0으로 줄인다)

// totalMs 동안 기다리며 남은 초를 makeText(남은 초)로 화면에 보여 준다.
async function waitWithCountdown(totalMs, makeText) {
  const end = Date.now() + totalMs;
  while (Date.now() < end) {
    setFetchStatus(makeText(Math.ceil((end - Date.now()) / 1000)));
    await sleep(Math.min(1000, end - Date.now()));
  }
}

function setFetchStatus(text) {
  const el = document.getElementById("fetch-status");
  if (el) el.textContent = text;
}

// --- 표시 형식 ---

function formatMoney(value, marketKind) {
  if (marketKind === "kr") {
    return Math.round(value).toLocaleString("ko-KR") + "원";
  }
  return (
    "$" +
    value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function formatQty(value) {
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 4 });
}

// rate 는 0~1 소수(예: 0.125). 화면에는 % 로 표시한다.
function formatPercent(rate) {
  const percent = rate * 100;
  const sign = percent > 0 ? "+" : "";
  return sign + percent.toFixed(2) + "%";
}

// 한국 주식 관행에 맞춰 상승(이익)은 빨강, 하락(손실)은 파랑으로 표시.
function profitClass(value) {
  if (value > 0) return "profit-positive";
  if (value < 0) return "profit-negative";
  return "profit-zero";
}

// --- 렌더링 ---

const SHARE_COLORS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
];
const SHARE_OTHER_COLOR = "var(--series-other)";
const MARKET_LABEL = { kr: "국내", us: "미국" };

// 대시보드: 시장별 평가금액(값)·손익(델타)을 스탯 타일로.
function renderDashboard(holdings, prices) {
  const area = document.getElementById("dashboard-area");
  const markets = ["kr", "us"];

  const tilesHtml = markets
    .map((market) => {
      const items = holdings.filter((h) => h.market_kind === market);
      if (items.length === 0) return "";

      let totalBuy = 0;
      let totalEval = 0;
      items.forEach((h) => {
        const currentPrice = prices[holdingKey(h.market_kind, h.stock_name)] || 0;
        const { buy_amount, evaluation_amount } = calc(h, currentPrice);
        totalBuy += buy_amount;
        totalEval += evaluation_amount;
      });
      const totalProfit = totalEval - totalBuy;
      const totalRate = totalBuy === 0 ? 0 : totalProfit / totalBuy;

      return `
        <div class="stat-tile">
          <div class="stat-label">${MARKET_LABEL[market]} 평가금액</div>
          <div class="stat-value">${formatMoney(totalEval, market)}</div>
          <div class="stat-delta ${profitClass(totalProfit)}">${formatMoney(totalProfit, market)} (${formatPercent(totalRate)})</div>
        </div>
      `;
    })
    .join("");

  area.innerHTML = tilesHtml
    ? `<div class="stat-grid">${fxTotalTileHtml(holdings, prices)}${tilesHtml}</div>`
    : '<p class="empty-message">아직 보유 중인 종목이 없습니다.</p>';
}

// 종목 비중: 시장별로 평가금액 기준 part-to-whole 가로 막대 + 범례.
// 상위 7종목은 각자 색을 받고, 나머지는 "기타"로 묶는다(토큰 한도).
function renderShare(holdings, prices) {
  const area = document.getElementById("share-area");
  const markets = ["kr", "us"];

  const blocksHtml = markets
    .map((market) => {
      const items = holdings
        .filter((h) => h.market_kind === market)
        .map((h) => {
          const currentPrice = prices[holdingKey(h.market_kind, h.stock_name)] || 0;
          return { stock_name: h.stock_name, evaluation_amount: calc(h, currentPrice).evaluation_amount };
        })
        .sort((a, b) => b.evaluation_amount - a.evaluation_amount);

      if (items.length === 0) return "";

      const total = items.reduce((sum, x) => sum + x.evaluation_amount, 0);
      const top = items.slice(0, SHARE_COLORS.length);
      const rest = items.slice(SHARE_COLORS.length);

      const slots = top.map((x, i) => ({ ...x, color: SHARE_COLORS[i] }));
      if (rest.length > 0) {
        slots.push({
          stock_name: `기타 (${rest.length}종목)`,
          evaluation_amount: rest.reduce((sum, x) => sum + x.evaluation_amount, 0),
          color: SHARE_OTHER_COLOR,
        });
      }

      const segmentsHtml = slots
        .map((s) => {
          const pct = total === 0 ? 0 : (s.evaluation_amount / total) * 100;
          return `<div class="share-segment" style="width:${pct}%;background-color:${s.color}"></div>`;
        })
        .join("");

      const legendHtml = slots
        .map((s) => {
          const pct = total === 0 ? 0 : (s.evaluation_amount / total) * 100;
          return `
            <div class="legend-row">
              <span class="legend-swatch" style="background-color:${s.color}"></span>
              <span class="legend-name">${s.stock_name}</span>
              <span class="legend-value">${pct.toFixed(1)}% · ${formatMoney(s.evaluation_amount, market)}</span>
            </div>
          `;
        })
        .join("");

      return `
        <div class="share-block">
          <h3>${MARKET_LABEL[market]} 종목 비중</h3>
          <div class="share-bar">${segmentsHtml}</div>
          <div class="share-legend">${legendHtml}</div>
        </div>
      `;
    })
    .join("");

  area.innerHTML = combinedShareHtml(holdings, prices) + blocksHtml || '<p class="empty-message">아직 보유 중인 종목이 없습니다.</p>';
}

// 수익률 순위: 0%를 기준선으로 양쪽으로 뻗는 막대. %는 단위가 없어
// 국내·미국 종목을 한 목록에서 같이 비교한다.
function renderRank(holdings, prices) {
  const area = document.getElementById("rank-area");

  if (holdings.length === 0) {
    area.innerHTML = '<p class="empty-message">아직 보유 중인 종목이 없습니다.</p>';
    return;
  }

  const rows = holdings
    .map((h) => {
      const currentPrice = prices[holdingKey(h.market_kind, h.stock_name)] || 0;
      return { stock_name: h.stock_name, market_kind: h.market_kind, profit_rate: calc(h, currentPrice).profit_rate };
    })
    .sort((a, b) => b.profit_rate - a.profit_rate);

  const maxAbs = Math.max(1e-9, ...rows.map((r) => Math.abs(r.profit_rate)));

  area.innerHTML = rows
    .map((r, i) => {
      const widthPct = (Math.abs(r.profit_rate) / maxAbs) * 100;
      const isPos = r.profit_rate >= 0;
      const valueLabel = formatPercent(r.profit_rate);

      const negSide = !isPos
        ? `<span class="rank-value">${valueLabel}</span><div class="rank-bar neg" style="width:${widthPct}%"></div>`
        : "";
      const posSide = isPos
        ? `<div class="rank-bar pos" style="width:${widthPct}%"></div><span class="rank-value">${valueLabel}</span>`
        : "";

      return `
        <div class="rank-row">
          <div class="rank-name">${i + 1}. ${r.stock_name} <span class="rank-market">${MARKET_LABEL[r.market_kind]}</span></div>
          <div class="rank-track">
            <div class="rank-half rank-half-neg">${negSide}</div>
            <div class="rank-half rank-half-pos">${posSide}</div>
          </div>
        </div>
      `;
    })
    .join("");
}

// ===== 보유 종목 그룹·필터·검색·상세 (design/07_보유종목그룹.md) =====
const STOCK_INFO_KEY = "stockInfo_v2"; // stock_info_map: holding_key -> { exchange_kind, sector_name }
const HOLDINGS_VIEW_KEY = "stockHoldingsView_v1"; // holdings_view
// 섹터 선택 목록의 기본값(특정 종목과 무관한 일반 분류). 사용자가 쓰는 섹터가 함께 나온다.
const DEFAULT_SECTORS = [
  "반도체", "2차전지", "자동차", "조선", "전력기기", "에너지", "화학·소재", "금융", "인터넷·플랫폼", "AI·소프트웨어",
  "가전·전자", "물류", "로봇", "방산·철도", "기계·건설", "게임", "항공·우주", "바이오", "ETF", "핀테크",
  "양자컴퓨팅", "유통·소비재", "통신", "헬스케어", "부동산·리츠",
];
const AUTO_FILL_KEY = "stockAutoFill_v1"; // is_auto_fill_enabled ("false"면 끔)
const INFO_CHECK_KEY = "stockInfoChecked_v1"; // exchange_checked_map: holding_key -> 거래소를 확인해 본 날짜
const EXCHANGE_LABEL = { kospi: "코스피", kosdaq: "코스닥", konex: "코넥스", nasdaq: "나스닥", nyse: "NYSE", other: "기타" };
const DEFAULT_HOLDINGS_VIEW = {
  market_filter: "all", // all | kr | us
  exchange_filter: "all", // all | kospi | kosdaq | unknown (국장일 때만)
  sector_filter: "all", // all | __none | 섹터 이름
  sort_kind: "value", // value | rate | name
  group_kind: "market", // market | sector
  signal_filter: "all", // all | buy_watch | sell_review
  search_text: "",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function loadStockInfo() {
  const raw = localStorage.getItem(STOCK_INFO_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error("종목정보를 읽는 중 오류:", e);
    return {};
  }
}

function saveStockInfo(info) {
  localStorage.setItem(STOCK_INFO_KEY, JSON.stringify(info));
}

// 종목정보 한 종목의 값을 바꾼다. 빈 값은 그 항목을 지운다. onlyIfEmpty 면 이미 값이 있는 항목은 건드리지 않는다.
function updateStockInfo(key, patch, options = {}) {
  const info = loadStockInfo();
  const current = { ...(info[key] || {}) };
  let changed = false;
  Object.entries(patch).forEach(([field, value]) => {
    if (value === undefined) return;
    if (value === "" || value === null) {
      if (current[field] !== undefined) {
        delete current[field];
        changed = true;
      }
      return;
    }
    if (options.onlyIfEmpty && current[field]) return;
    if (current[field] !== value) {
      current[field] = value;
      changed = true;
    }
  });
  if (!changed) return false;
  if (Object.keys(current).length === 0) delete info[key];
  else info[key] = current;
  saveStockInfo(info);
  return true;
}

// 서비스 응답의 시장구분(KOSPI, KOSDAQ, NASDAQ, NYSE ...)을 exchange_kind 코드값으로 바꾼다. 모르면 "".
function normalizeExchangeKind(raw) {
  const x = String(raw || "").trim().toUpperCase();
  if (!x) return "";
  if (x.includes("KOSDAQ")) return "kosdaq";
  if (x.includes("KOSPI")) return "kospi";
  if (x.includes("KONEX")) return "konex";
  if (x.includes("NASDAQ")) return "nasdaq";
  if (x === "NYSE") return "nyse";
  return "other";
}

function loadHoldingsView() {
  const view = { ...DEFAULT_HOLDINGS_VIEW };
  try {
    const saved = JSON.parse(localStorage.getItem(HOLDINGS_VIEW_KEY) || "{}");
    if (["all", "kr", "us"].includes(saved.market_filter)) view.market_filter = saved.market_filter;
    if (["all", "kospi", "kosdaq", "unknown"].includes(saved.exchange_filter)) view.exchange_filter = saved.exchange_filter;
    if (typeof saved.sector_filter === "string") view.sector_filter = saved.sector_filter;
    if (["value", "rate", "name"].includes(saved.sort_kind)) view.sort_kind = saved.sort_kind;
    if (["market", "sector"].includes(saved.group_kind)) view.group_kind = saved.group_kind;
    if (["all", "buy_watch", "sell_review"].includes(saved.signal_filter)) view.signal_filter = saved.signal_filter;
    if (typeof saved.search_text === "string") view.search_text = saved.search_text;
  } catch (e) {
    // 저장된 설정을 못 읽으면 기본값으로 시작한다
  }
  return view;
}

let holdingsView = loadHoldingsView();
const openHoldingKeys = new Set(); // 펼쳐 둔 종목(화면을 다시 그려도 유지)
const collapsedGroupIds = new Set(); // 접어 둔 그룹

function saveHoldingsView() {
  try {
    localStorage.setItem(HOLDINGS_VIEW_KEY, JSON.stringify(holdingsView));
  } catch (e) {
    // 저장소를 못 쓰는 환경이면 기억만 건너뛴다
  }
}

// 보유 종목마다 계산값과 분류 정보를 붙인다.
function buildHoldingRows(holdings, prices, symbols, info) {
  return holdings.map((h) => {
    const key = holdingKey(h.market_kind, h.stock_name);
    const currentPrice = prices[key] || 0;
    const meta = info[key] || {};
    return {
      key,
      h,
      currentPrice,
      symbol: symbols[key] || "",
      exchange_kind: meta.exchange_kind || "",
      sector_name: meta.sector_name || "",
      holding_style_kind: meta.holding_style_kind === "trade" ? "trade" : "long",
      ...calc(h, currentPrice),
    };
  });
}

function filterHoldingRows(rows, view) {
  const q = view.search_text.trim().toLowerCase();
  return rows.filter((r) => {
    if (view.market_filter !== "all" && r.h.market_kind !== view.market_filter) return false;
    if (view.market_filter === "kr" && view.exchange_filter !== "all") {
      if (view.exchange_filter === "unknown" ? r.exchange_kind !== "" : r.exchange_kind !== view.exchange_filter) return false;
    }
    if (view.sector_filter !== "all") {
      if (view.sector_filter === "__none" ? r.sector_name !== "" : r.sector_name !== view.sector_filter) return false;
    }
    if (view.signal_filter !== "all" && (!r.signal || r.signal.signal_state !== view.signal_filter)) return false;
    if (q && !`${r.h.stock_name} ${r.sector_name} ${r.symbol}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function sortHoldingRows(rows, view) {
  return [...rows].sort((a, b) => {
    if (view.sort_kind === "name") return a.h.stock_name.localeCompare(b.h.stock_name, "ko");
    if (view.sort_kind === "rate") return b.profit_rate - a.profit_rate;
    const marketOrder = a.h.market_kind === b.h.market_kind ? 0 : a.h.market_kind === "kr" ? -1 : 1; // 평가금액순은 같은 시장 안에서만 비교
    return marketOrder || b.evaluation_amount - a.evaluation_amount;
  });
}

// 그룹 기준(시장·거래소 / 섹터)에 따라 [{id, label, rows}] 로 묶는다. 빈 그룹은 만들지 않는다.
function groupHoldingRows(rows, view) {
  if (view.group_kind === "sector") {
    const map = new Map();
    rows.forEach((r) => {
      if (!map.has(r.sector_name)) map.set(r.sector_name, []);
      map.get(r.sector_name).push(r);
    });
    const names = [...map.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "ko"))); // 미분류는 맨 뒤
    return names.map((n) => ({ id: `s:${n}`, label: n || "섹터 미분류", rows: map.get(n) }));
  }
  const defs = [
    ["m:kr:kospi", "국장 · 코스피", (r) => r.h.market_kind === "kr" && r.exchange_kind === "kospi"],
    ["m:kr:kosdaq", "국장 · 코스닥", (r) => r.h.market_kind === "kr" && r.exchange_kind === "kosdaq"],
    ["m:kr:konex", "국장 · 코넥스", (r) => r.h.market_kind === "kr" && r.exchange_kind === "konex"],
    ["m:kr:none", "국장 · 거래소 미분류", (r) => r.h.market_kind === "kr" && !["kospi", "kosdaq", "konex"].includes(r.exchange_kind)],
    ["m:us", "미장", (r) => r.h.market_kind === "us"],
  ];
  return defs.map(([id, label, test]) => ({ id, label, rows: rows.filter(test) })).filter((g) => g.rows.length > 0);
}

// 그룹 소계 문장. 원화와 달러는 섞지 않고 시장별로 따로 쓴다.
function groupTotalsText(rows) {
  const fx = loadFxRate();
  const both = rows.some((r) => r.h.market_kind === "kr") && rows.some((r) => r.h.market_kind === "us");
  const combined =
    both && fx
      ? ` · 합계 ${formatMoney(
          rows.reduce((sum, r) => sum + r.evaluation_amount * (r.h.market_kind === "us" ? Number(fx.krw_per_usd) : 1), 0),
          "kr"
        )}`
      : "";
  return (
    ["kr", "us"]
    .map((m) => {
      const items = rows.filter((r) => r.h.market_kind === m);
      if (items.length === 0) return "";
      const buy = items.reduce((sum, r) => sum + r.buy_amount, 0);
      const evaluation = items.reduce((sum, r) => sum + r.evaluation_amount, 0);
      return `평가 ${formatMoney(evaluation, m)} (${formatPercent(buy === 0 ? 0 : (evaluation - buy) / buy)})`;
    })
    .filter(Boolean)
    .join(" · ") + combined
  );
}

// 섹터 선택 목록: 미분류 / 섹터들 / 새 섹터 입력
function sectorOptionsHtml(choices, current) {
  const options = choices.map((n) => `<option value="${escapeHtml(n)}" ${n === current ? "selected" : ""}>${escapeHtml(n)}</option>`).join("");
  return `<option value="" ${current ? "" : "selected"}>미분류</option>${options}<option value="__new">＋ 새 섹터 입력…</option>`;
}

// 가격 추이 차트(SVG). 종가 선 + 내 평균단가 점선. 기록이 2일 미만이면 안내만 돌려준다.
// 그래프에 겹쳐 그릴 수 있는 이동평균선(거래일)과 색. 기본은 단기 20일선과 장기 200일선. 시그널 판정(20·60일선 교차)과는 별개다.
const CHART_MA_PERIODS = [20, 60, 120, 200];
const CHART_MA_COLORS = { 20: "#34d399", 60: "#a78bfa", 120: "#f472b6", 200: "#e2e8f0" };
const CHART_LAYERS_DEFAULT = [20, 200];
const CHART_LAYERS_KEY = "stockChartLayers_v2"; // chart_layer_list: 그래프에 켜 둔 이동평균선 기간 (화면 설정이라 백업 대상 아님)
const chartLayersOn = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(CHART_LAYERS_KEY) || "null");
    if (Array.isArray(saved)) return new Set(saved.filter((n) => CHART_MA_PERIODS.includes(n)));
  } catch (e) {
    // 저장값을 못 읽으면 기본값으로
  }
  return new Set(CHART_LAYERS_DEFAULT);
})();
function saveChartLayers() {
  try {
    localStorage.setItem(CHART_LAYERS_KEY, JSON.stringify([...chartLayersOn]));
  } catch (e) {
    // 저장소를 못 쓰면 기억만 건너뛴다
  }
}
function chartMaSpecs() {
  return CHART_MA_PERIODS.map((period) => ({ period, color: CHART_MA_COLORS[period] }));
}

function priceChartHtml(entries, averagePrice, marketKind, trail = [], maLines = [], maToggleHtml = "") {
  const rows = [...entries].filter((e) => Number.isFinite(e.close_price)).sort((a, b) => (a.price_date < b.price_date ? -1 : 1)).slice(-250);
  if (rows.length < 2) {
    return `<div class="hd-note">저장된 시세가 ${rows.length}일뿐입니다. '과거 시세 채우기'를 눌러 주세요.</div>`;
  }
  const W = 300;
  const H = 110;
  const PADX = 4;
  const PADY = 10;
  const t = (e) => new Date(e.price_date + "T00:00:00").getTime();
  const t0 = t(rows[0]);
  const t1 = t(rows[rows.length - 1]);
  const firstDate = rows[0].price_date;
  const trailRows = trail.filter((p) => p.price_date >= firstDate && Number.isFinite(p.stop_line) && p.stop_line > 0); // 추세 이탈선(그래프에 같이 그림)
  const maRows = maLines.map((m) => ({ ...m, points: m.points.filter((p) => p.price_date >= firstDate) })).filter((m) => m.points.length > 1);
  const values = rows
    .map((e) => e.close_price)
    .concat(averagePrice > 0 ? [averagePrice] : [])
    .concat(trailRows.map((p) => p.stop_line))
    .concat(maRows.flatMap((m) => m.points.map((p) => p.value)));
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (e) => PADX + ((t(e) - t0) / (t1 - t0 || 1)) * (W - 2 * PADX);
  const y = (v) => PADY + (1 - (v - lo) / span) * (H - 2 * PADY);
  const path = rows.map((e, i) => `${i === 0 ? "M" : "L"}${x(e).toFixed(1)},${y(e.close_price).toFixed(1)}`).join(" ");
  const first = rows[0].close_price;
  const last = rows[rows.length - 1].close_price;
  const change = first === 0 ? 0 : (last - first) / first;
  const color = change >= 0 ? "#e66767" : "#3987e5"; // 한국 관행: 상승 빨강, 하락 파랑
  const trailPath = trailRows
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p).toFixed(1)},${y(p.stop_line).toFixed(1)}`)
    .join(" ");
  const lastTrail = trailRows.length ? trailRows[trailRows.length - 1] : null;
  const broken = lastTrail && last < lastTrail.stop_line; // 현재가가 추세 이탈선 아래
  const trailSvg = trailPath
    ? `<path class="pc-trail" d="${trailPath}" fill="none" stroke="#fb923c" stroke-width="1.2" stroke-dasharray="1.5 2" />` +
      (broken ? `<circle class="pc-trail-break" cx="${x(rows[rows.length - 1]).toFixed(1)}" cy="${y(last).toFixed(1)}" r="3" fill="#fb923c" />` : "")
    : "";
  const maSvg = maRows
    .map(
      (m) =>
        `<path class="pc-ma pc-ma-${m.period}" d="${m.points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ")}" fill="none" stroke="${m.color}" stroke-width="1" />`
    )
    .join("");
  const avgLine =
    averagePrice > 0
      ? `<line class="pc-avg" x1="${PADX}" x2="${W - PADX}" y1="${y(averagePrice).toFixed(1)}" y2="${y(averagePrice).toFixed(1)}" stroke="#facc15" stroke-width="1" stroke-dasharray="4 3" />`
      : "";
  return `
    <svg class="price-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="종가 추이">
      ${avgLine}
      ${maSvg}
      ${trailSvg}
      <path class="pc-line" d="${path}" fill="none" stroke="${color}" stroke-width="1.6" />
    </svg>
    <div class="pc-legend">
      <span>최고 ${formatMoney(Math.max(...rows.map((e) => e.close_price)), marketKind)}</span>
      <span>최저 ${formatMoney(Math.min(...rows.map((e) => e.close_price)), marketKind)}</span>
      <span>${rows[0].price_date} ~ ${rows[rows.length - 1].price_date} (${rows.length}일)</span>
      <span class="${profitClass(change)}">기간 시세 변화 ${formatPercent(change)}</span>
      ${averagePrice > 0 ? '<span class="pc-avg-note">노란 점선: 내 평균단가</span>' : ""}
      ${maRows.map((m) => `<span style="color:${m.color}">${m.period}일선 ${Math.round(m.points[m.points.length - 1].value).toLocaleString("ko-KR")}</span>`).join("")}
      ${trailPath ? `<span class="pc-trail-note">주황 점선: 추세 이탈선 ${glossaryBtn("trend_break")} (그날까지 최근 고점 − ATR×배수)${broken ? " · 현재가가 선 아래 ●" : ""}</span>` : ""}
    </div>
    ${maToggleHtml}`;
}

// 종목 한 줄에 넣는 시세 미니 그래프(최근 60일 종가 선)와 전일비. 시세가 2일 미만이면 둘 다 비어 있다.
function summaryTrend(entries) {
  const rows = [...entries].filter((e) => Number.isFinite(e.close_price)).sort((a, b) => (a.price_date < b.price_date ? -1 : 1));
  if (rows.length < 2) return { spark: "", dayChange: null };
  const recent = rows.slice(-60);
  const closes = recent.map((e) => e.close_price);
  const lo = Math.min(...closes);
  const span = Math.max(...closes) - lo || 1;
  const W = 64;
  const H = 16;
  const points = closes
    .map((c, i) => `${((i / (closes.length - 1 || 1)) * W).toFixed(1)},${(H - 1 - ((c - lo) / span) * (H - 2)).toFixed(1)}`)
    .join(" ");
  const up = closes[closes.length - 1] >= closes[0];
  const prev = rows[rows.length - 2].close_price;
  const last = rows[rows.length - 1].close_price;
  return {
    spark: `<svg class="hs-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><polyline points="${points}" fill="none" stroke="${up ? "#e66767" : "#3987e5"}" stroke-width="1.2" /></svg>`,
    dayChange: prev === 0 ? null : (last - prev) / prev,
  };
}

function holdingRowHtml(r, ctx) {
  const key = escapeHtml(r.key);
  const market = r.h.market_kind;
  const tags = [
    `<span class="tag">${MARKET_LABEL[market]}</span>`,
    r.exchange_kind ? `<span class="tag">${EXCHANGE_LABEL[r.exchange_kind]}</span>` : "",
    r.sector_name ? `<span class="tag tag-sector">${escapeHtml(r.sector_name)}</span>` : "",
    r.holding_style_kind === "trade" ? alertBadgeHtml(ctx.alertRules[r.key]) : "",
    signalBadgeHtml(r.signal),
    weightBadgeHtml(ctx, r.key),
  ].join("");
  const marketTotal = ctx.marketTotals[market] || 0;
  const share = marketTotal > 0 ? ((r.evaluation_amount / marketTotal) * 100).toFixed(1) : "0.0";
  const trades = ctx.tradesByKey[r.key] || [];
  const tradeHtml =
    trades
      .slice(0, 5)
      .map(
        (t) =>
          `<li>${t.trade_date} ${t.trade_kind === "buy" ? "매수" : "매도"} ${formatQty(t.trade_quantity)}주 · ${formatMoney(t.unit_price, market)}</li>`
      )
      .join("") || "<li>거래내역 없음</li>";
  const div = ctx.dividendByKey[r.key] || { count: 0, total: 0 };
  const exchangeOptions = [["", "미분류"], ...Object.entries(EXCHANGE_LABEL)]
    .map(([v, label]) => `<option value="${v}" ${v === r.exchange_kind ? "selected" : ""}>${label}</option>`)
    .join("");
  const symbolPlaceholder = { kr: "예: 005930", us: "예: AAPL" }[market];
  const trend = summaryTrend(ctx.historyByKey[r.key] || []);

  return `
    <details class="holding-item" data-key="${key}" ${openHoldingKeys.has(r.key) ? "open" : ""}>
      <summary class="holding-summary">
        <span class="hs-name holding-item-name">${escapeHtml(r.h.stock_name)}</span>
        <span class="hs-eval">${formatMoney(r.evaluation_amount, market)}</span>
        <span class="hs-tags">${tags}</span>
        <span class="hs-profit ${profitClass(r.profit_amount)}">${formatMoney(r.profit_amount, market)} (${formatPercent(r.profit_rate)})</span>
        <span class="hs-info">
          <span>수량 ${formatQty(r.h.holding_quantity)}주 · 평단 ${formatMoney(r.h.average_price, market)} · 현재 ${r.currentPrice ? formatMoney(r.currentPrice, market) : "-"}</span>
          ${trend.dayChange === null ? "" : `<span class="hs-day ${profitClass(trend.dayChange)}">전일비 ${formatPercent(trend.dayChange)}</span>`}
          ${trend.spark}
        </span>
      </summary>
      <div class="holding-body">
        <div class="holding-item-detail">
          <span>수량 ${formatQty(r.h.holding_quantity)} · 평균단가 ${formatMoney(r.h.average_price, market)}</span>
        </div>
        <div class="holding-item-symbol-row">
          <span>시세 코드</span>
          <div class="symbol-input-group">
            <input class="symbol-input" type="text" data-action="symbol-input" data-key="${key}" value="${escapeHtml(r.symbol)}" placeholder="${symbolPlaceholder}" />
            <button type="button" class="fetch-btn" data-action="lookup-symbol" data-key="${key}">코드찾기</button>
            <button type="button" class="fetch-btn" data-action="fetch-price" data-key="${key}">조회</button>
          </div>
        </div>
        <div class="holding-item-price-row">
          <span>현재가</span>
          <input class="price-input" type="number" step="any" min="0" data-action="price-input" data-key="${key}" value="${r.currentPrice || ""}" />
        </div>
        <div class="holding-item-detail">
          <span>평가금액 ${formatMoney(r.evaluation_amount, market)}</span>
          <span class="${profitClass(r.profit_amount)}">${formatMoney(r.profit_amount, market)} (${formatPercent(r.profit_rate)})</span>
        </div>
        <div class="holding-item-price-row">
          <span>거래소</span>
          <select class="info-select" data-action="exchange-select" data-key="${key}">${exchangeOptions}</select>
        </div>
        <div class="holding-item-price-row">
          <span>섹터</span>
          <span class="sector-edit">
            <select class="info-select" data-action="sector-select" data-key="${key}">${sectorOptionsHtml(ctx.sectorChoices, r.sector_name)}</select>
            <input class="info-input" type="text" list="sector-list" data-action="sector-input" data-key="${key}" placeholder="새 섹터 이름" hidden />
          </span>
        </div>
        <div class="holding-item-detail"><span>${MARKET_LABEL[market]} 비중 ${share}%</span></div>
        ${styleRowHtml(r)}
        ${r.holding_style_kind === "trade" ? alertSectionHtml(r, ctx.alertRules[r.key]) : alertOffNoteHtml()}
        ${signalSectionHtml(r, ctx)}
        <div class="hd-section">
          <div class="hd-title">거래내역 ${trades.length}건 <span class="hd-note">(수정·삭제는 거래 탭에서)</span></div>
          <ul class="hd-list">${tradeHtml}</ul>
          ${trades.length > 5 ? `<div class="hd-note">외 ${trades.length - 5}건</div>` : ""}
        </div>
        <div class="hd-section">
          <div class="hd-title">가격 추이 <span class="hd-note">(저장된 시세 ${(ctx.historyByKey[r.key] || []).length}일)</span>
            <button type="button" class="fetch-btn" data-action="backfill-one" data-key="${key}">과거 시세 채우기</button>
          </div>
          ${priceChartHtml(ctx.historyByKey[r.key] || [], r.h.average_price, market, Signals.trailingStopSeries(ctx.historyByKey[r.key] || [], ctx.signalSettings.trail_lookback_days, ctx.signalSettings.trail_atr_multiple, ctx.atrPeriod), chartMaSpecs().filter((m) => chartLayersOn.has(m.period)).map((m) => ({ ...m, points: Signals.smaSeries(ctx.historyByKey[r.key] || [], m.period) })), maToggleHtml())}
        </div>
        <div class="hd-section">
          <div class="hd-title">배당 ${div.count}건${div.count > 0 ? ` · 합계 ${formatMoney(div.total, market)}` : ""}</div>
        </div>
      </div>
    </details>`;
}

function renderHoldingsToolbar(allRows, shownCount) {
  const v = holdingsView;
  document.querySelectorAll("#holdings-toolbar .chip").forEach((chip) => {
    chip.classList.toggle("active", v[chip.dataset.hv] === chip.dataset.val);
  });
  document.getElementById("hv-exchange").hidden = v.market_filter !== "kr";
  document.getElementById("hv-group").value = v.group_kind;
  document.getElementById("hv-sort").value = v.sort_kind;
  const sectors = [...new Set(allRows.map((r) => r.sector_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  if (v.sector_filter !== "all" && v.sector_filter !== "__none" && !sectors.includes(v.sector_filter)) v.sector_filter = "all";
  const sel = document.getElementById("hv-sector");
  sel.innerHTML =
    '<option value="all">전체 섹터</option><option value="__none">미분류</option>' +
    sectors.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
  sel.value = v.sector_filter;
  const q = document.getElementById("hv-query");
  if (q.value !== v.search_text) q.value = v.search_text;
  document.getElementById("hv-count").textContent = `표시 ${shownCount} / 전체 ${allRows.length}종목`;
}

function renderHoldings(holdings, prices, symbols, info = {}, transactions = [], dividends = []) {
  const holdingsArea = document.getElementById("holdings-area");
  const allRows = buildHoldingRows(holdings, prices, symbols, info);
  const signalSettings = loadSignalSettings();
  const historyMap = loadPriceHistory();
  const atrPeriod = loadAlertSettings().atr_period;
  allRows.forEach((r) => (r.signal = Signals.computeSignal(historyMap[r.key], signalSettings, atrPeriod)));

  if (allRows.length === 0) {
    holdingsArea.innerHTML = '<p class="empty-message">아직 보유 중인 종목이 없습니다.</p>';
    renderHoldingsToolbar(allRows, 0);
    return;
  }

  const rows = sortHoldingRows(filterHoldingRows(allRows, holdingsView), holdingsView);
  renderHoldingsToolbar(allRows, rows.length);

  // 비중 계산용(필터와 상관없이 시장 전체 기준), 종목별 거래·배당 묶음
  const marketTotals = { kr: 0, us: 0 };
  allRows.forEach((r) => (marketTotals[r.h.market_kind] += r.evaluation_amount));
  const tradesByKey = {};
  [...transactions]
    .sort((a, b) => (a.trade_date === b.trade_date ? b.sequence_no - a.sequence_no : a.trade_date < b.trade_date ? 1 : -1))
    .forEach((t) => {
      (tradesByKey[holdingKey(t.market_kind, t.stock_name)] ||= []).push(t);
    });
  const dividendByKey = {};
  dividends.forEach((d) => {
    const k = holdingKey(d.market_kind, d.stock_name);
    dividendByKey[k] = dividendByKey[k] || { count: 0, total: 0 };
    dividendByKey[k].count += 1;
    dividendByKey[k].total += d.dividend_amount;
  });
  const sectorChoices = [...new Set([...DEFAULT_SECTORS, ...allRows.map((r) => r.sector_name).filter(Boolean)])].sort((a, b) =>
    a.localeCompare(b, "ko")
  );
  const ctx = { marketTotals, tradesByKey, dividendByKey, sectorChoices, historyByKey: historyMap, signalSettings, atrPeriod, alertRules: loadAlertRules(), weightOver: computeWeightOver(allRows) };

  const groups = groupHoldingRows(rows, holdingsView);
  const sectorOptions = [...new Set(allRows.map((r) => r.sector_name).filter(Boolean))]
    .map((n) => `<option value="${escapeHtml(n)}"></option>`)
    .join("");
  holdingsArea.innerHTML =
    `<datalist id="sector-list">${sectorOptions}</datalist>` +
    (groups.length === 0
      ? '<p class="empty-message">조건에 맞는 종목이 없습니다.</p>'
      : groups
          .map(
            (g) => `
      <details class="holding-group" data-group="${escapeHtml(g.id)}" ${collapsedGroupIds.has(g.id) ? "" : "open"}>
        <summary class="group-summary">
          <span class="gs-title">${escapeHtml(g.label)} <span class="gs-count">(${g.rows.length}종목)</span></span>
          <span class="gs-total">${groupTotalsText(g.rows)}</span>
        </summary>
        ${g.rows.map((r) => holdingRowHtml(r, ctx)).join("")}
      </details>`
          )
          .join(""));
}

// ===== 자동 채우기 (design/07_보유종목그룹.md §3-1) =====
function loadAutoFillEnabled() {
  try {
    return localStorage.getItem(AUTO_FILL_KEY) !== "false";
  } catch (e) {
    return true;
  }
}

// 이름 규칙으로 섹터를 알 수 있는 경우: ① 이름에 ETF ② 우선주(...우, ...우B)는 보통주의 섹터
function inferSectorName(name, sectorByName) {
  if (/ETF/i.test(name)) return "ETF";
  const m = name.match(/^(.*?)우[A-Z]?$/);
  if (m && m[1] && sectorByName[m[1]]) return sectorByName[m[1]];
  return "";
}

// 한 번도 분류한 적 없는(종목정보가 없는) 보유 종목에만 채운다. 사용자가 정한 값은 건드리지 않는다.
function autoFillSectors(holdings) {
  const info = loadStockInfo();
  const sectorByName = {};
  Object.entries(info).forEach(([key, v]) => {
    if (v.sector_name) sectorByName[splitHoldingKey(key).stock_name] = v.sector_name;
  });
  let changed = false;
  holdings.forEach((h) => {
    const key = holdingKey(h.market_kind, h.stock_name);
    if (info[key]) return;
    const sector = inferSectorName(h.stock_name, sectorByName);
    if (!sector) return;
    info[key] = { sector_name: sector };
    sectorByName[h.stock_name] = sector;
    changed = true;
  });
  if (changed) saveStockInfo(info);
  return changed;
}

function renderKnownStockNames(transactions) {
  const el = document.getElementById("known-stock-names");
  if (!el) return;
  const names = [...new Set([...transactions.map((t) => t.stock_name), ...loadDividends().map((d) => d.stock_name)])].sort((a, b) =>
    a.localeCompare(b, "ko")
  );
  el.innerHTML = names.map((n) => `<option value="${escapeHtml(n)}"></option>`).join("");
}

// 이미 알고 있는 종목명이 한 시장에만 있으면 구분(국내/미국)을 자동으로 맞춘다.
function setupNameAutoFill() {
  document.querySelectorAll('#transaction-form [name="stock_name"], #dividend-form [name="stock_name"]').forEach((input) => {
    input.addEventListener("change", () => {
      const name = input.value.trim();
      const kinds = new Set([
        ...loadTransactions().filter((t) => t.stock_name === name).map((t) => t.market_kind),
        ...loadDividends().filter((d) => d.stock_name === name).map((d) => d.market_kind),
      ]);
      if (kinds.size !== 1) return;
      const form = input.form;
      form.querySelector('[name="market_kind"]').value = [...kinds][0];
      if (form.id === "dividend-form") updateDividendCurrencyFields(form);
    });
  });
}

function loadInfoChecked() {
  try {
    return JSON.parse(localStorage.getItem(INFO_CHECK_KEY) || "{}");
  } catch (e) {
    return {};
  }
}

// 종목의 거래소(시장구분)만 읽는다. 현재가·히스토리는 저장하지 않는다.
async function fetchExchangeKind(marketKind, symbol) {
  if (marketKind === "kr") {
    const list = await fetchDataGoKrItems(loadKrApiKey(), { likeSrtnCd: symbol }, 10, "시장구분 조회에 실패했습니다.");
    return list.length ? normalizeExchangeKind(list[0].mrktCtg) : "";
  }
  const params = new URLSearchParams({ symbol, apikey: loadApiKey() });
  const res = await fetch(`https://api.twelvedata.com/quote?${params.toString()}`);
  const data = await res.json();
  if (data.status === "error" || data.code) throw rateLimitAwareError(data, "시장구분 조회에 실패했습니다.");
  return normalizeExchangeKind(data.exchange);
}

function setAutoFillStatus(text) {
  const el = document.getElementById("auto-fill-status");
  if (el) el.textContent = text;
}

let autoFillRunning = false;

// 시세 코드가 있고 거래소가 비어 있는 종목의 거래소를 백그라운드로 채운다(종목마다 하루 1번만 시도).
async function autoFillExchanges() {
  if (autoFillRunning || !loadAutoFillEnabled()) return;
  const busy = ["refresh-all-btn", "bulk-symbol-btn", "backfill-btn"].some((id) => document.getElementById(id)?.disabled);
  if (busy) return; // 다른 시세 조회가 한창이면 한도를 같이 쓰므로 양보한다
  const symbols = loadSymbols();
  const info = loadStockInfo();
  const checked = loadInfoChecked();
  const today = todayISO();
  const targets = computeHoldings(loadTransactions()).filter((h) => {
    const key = holdingKey(h.market_kind, h.stock_name);
    const hasKey = h.market_kind === "kr" ? loadKrApiKey() : loadApiKey();
    return hasKey && symbols[key] && !(info[key] && info[key].exchange_kind) && checked[key] !== today;
  });
  if (targets.length === 0) return;

  autoFillRunning = true;
  let filled = 0;
  try {
    for (let i = 0; i < targets.length; i++) {
      const h = targets[i];
      const key = holdingKey(h.market_kind, h.stock_name);
      setAutoFillStatus(`거래소 자동 확인 중... (${i + 1}/${targets.length}) ${h.stock_name}`);
      try {
        const exchange = await fetchExchangeKind(h.market_kind, symbols[key]);
        checked[key] = today;
        localStorage.setItem(INFO_CHECK_KEY, JSON.stringify(checked));
        if (exchange && updateStockInfo(key, { exchange_kind: exchange }, { onlyIfEmpty: true })) filled++;
      } catch (e) {
        if (e.rate_limited) break; // 분당 한도: 이번 회차는 멈추고 다음에 다시 시도한다
        checked[key] = today; // 그 밖의 오류는 오늘은 다시 시도하지 않는다
        localStorage.setItem(INFO_CHECK_KEY, JSON.stringify(checked));
      }
      if (i < targets.length - 1) await sleep(REFRESH_GAP_MS[h.market_kind] ?? 0);
    }
  } finally {
    autoFillRunning = false;
  }
  setAutoFillStatus(filled > 0 ? `거래소 ${filled}종목을 자동으로 채웠습니다.` : "");
  if (filled > 0) renderHoldingsOnly();
}

function setupAutoFill() {
  const toggle = document.getElementById("auto-fill-toggle");
  toggle.checked = loadAutoFillEnabled();
  toggle.addEventListener("change", () => {
    try {
      localStorage.setItem(AUTO_FILL_KEY, String(toggle.checked));
    } catch (e) {
      // 저장소를 못 쓰는 환경이면 건너뛴다
    }
    if (toggle.checked) autoFillExchanges();
  });
  setupNameAutoFill();
  setTimeout(autoFillExchanges, 2000); // 앱을 연 직후 화면이 자리 잡은 다음 백그라운드로 확인
}

// ===== 과거 시세 채우기 (design/08_가격히스토리.md) =====
const BACKFILL_COVER_DAYS = 7; // 채우기 시작일에서 이 일수 안에 기록이 시작되면 이미 채워진 것으로 본다
const BACKFILL_MIN_DAYS = 365; // 첫 매수일이 이보다 최근이어도 최소 이만큼(일) 과거부터 채운다 (CSV로 가져온 임시 거래일 대비, D23)

// 한 종목의 일별 시세를 첫 매수일부터 오늘까지 받아 [{price_date, open_price, ...}] 로 돌려준다.
async function fetchPriceHistoryRange(marketKind, symbol, fromDate) {
  if (marketKind === "kr") {
    const apiKey = loadKrApiKey();
    if (!apiKey) throw new Error("공공데이터포털 API 키가 설정에 없습니다");
    const rows = [];
    for (let page = 1; page <= 6; page++) {
      const list = await fetchDataGoKrItems(apiKey, { likeSrtnCd: symbol }, 1000, "과거 시세 조회에 실패했습니다.", {
        begin: new Date(fromDate + "T00:00:00"),
        end: new Date(),
        pageNo: page,
      });
      rows.push(...list);
      if (list.length < 1000) break;
    }
    return rows
      .map((x) => ({
        price_date: `${x.basDt.slice(0, 4)}-${x.basDt.slice(4, 6)}-${x.basDt.slice(6, 8)}`,
        open_price: Number(x.mkp),
        high_price: Number(x.hipr),
        low_price: Number(x.lopr),
        close_price: Number(x.clpr),
        trade_volume: Number(x.trqu),
      }))
      .filter((e) => Number.isFinite(e.close_price));
  }
  const apiKey = loadApiKey();
  if (!apiKey) throw new Error("Twelve Data API 키가 설정에 없습니다");
  const params = new URLSearchParams({ symbol, interval: "1day", start_date: fromDate, outputsize: "5000", apikey: apiKey });
  const res = await fetch(`https://api.twelvedata.com/time_series?${params.toString()}`);
  const data = await res.json();
  if (data.status === "error" || data.code) throw rateLimitAwareError(data, "과거 시세 조회에 실패했습니다.");
  return (Array.isArray(data.values) ? data.values : [])
    .map((v) => ({
      price_date: String(v.datetime).slice(0, 10),
      open_price: Number(v.open),
      high_price: Number(v.high),
      low_price: Number(v.low),
      close_price: Number(v.close),
      trade_volume: Number(v.volume),
    }))
    .filter((e) => Number.isFinite(e.close_price));
}

// 받아 온 시세를 저장된 히스토리에 합친다(같은 날짜는 덮어쓰고 날짜순 정렬). 새로 생긴 날짜 수를 돌려준다.
function mergePriceHistory(key, entries) {
  const history = loadPriceHistory();
  const byDate = new Map((history[key] || []).map((e) => [e.price_date, e]));
  let added = 0;
  entries.forEach((e) => {
    if (!byDate.has(e.price_date)) added++;
    byDate.set(e.price_date, e);
  });
  history[key] = [...byDate.values()].sort((a, b) => (a.price_date < b.price_date ? -1 : 1));
  savePriceHistory(history);
  return added;
}

function firstTradeDateOf(key, transactions) {
  const dates = transactions.filter((t) => holdingKey(t.market_kind, t.stock_name) === key).map((t) => t.trade_date);
  return dates.length ? dates.sort()[0] : "";
}

// 과거 시세 채우기 시작일: 첫 매수일과 '오늘-BACKFILL_MIN_DAYS' 중 더 이른 날. 거래가 없으면 빈 문자열.
function backfillStartDate(key, transactions, today = new Date()) {
  const first = firstTradeDateOf(key, transactions);
  if (!first) return "";
  const d = new Date(today.getTime() - BACKFILL_MIN_DAYS * 24 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const minStart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return first < minStart ? first : minStart;
}

// 한 종목의 과거 시세를 채운다. 분당 한도 오류(429)는 기다렸다가 1번 다시 시도한다.
async function backfillOne(marketKind, stockName) {
  const key = holdingKey(marketKind, stockName);
  const symbol = loadSymbols()[key];
  if (!symbol) return { ok: false, message: "시세 코드가 없습니다" };
  const from = backfillStartDate(key, loadTransactions());
  if (!from) return { ok: false, message: "거래내역이 없습니다" };
  const run = () => fetchPriceHistoryRange(marketKind, symbol, from);
  try {
    let entries;
    try {
      entries = await run();
    } catch (e) {
      if (!e.rate_limited) throw e;
      await waitWithCountdown(RATE_LIMIT_WAIT_MS, (sec) => `미국 시세 분당 한도에 걸려 ${sec}초 기다린 뒤 ${stockName}을(를) 다시 조회합니다`);
      entries = await run();
    }
    if (entries.length === 0) return { ok: false, message: "받아 온 시세가 없습니다" };
    return { ok: true, added: mergePriceHistory(key, entries), total: entries.length, from };
  } catch (e) {
    return { ok: false, message: e.rate_limited ? "분당 한도(8회)를 넘었습니다" : e.message };
  }
}

let backfillRunning = false;

async function backfillAll() {
  const symbols = loadSymbols();
  const transactions = loadTransactions();
  const history = loadPriceHistory();
  const holdings = [...computeHoldings(transactions)].sort((a, b) => (a.market_kind === b.market_kind ? 0 : a.market_kind === "kr" ? -1 : 1));
  const targets = [];
  let covered = 0;
  holdings.forEach((h) => {
    const key = holdingKey(h.market_kind, h.stock_name);
    if (!symbols[key]) return;
    const from = backfillStartDate(key, transactions);
    const first = (history[key] || [])[0];
    const limit = new Date(new Date(from + "T00:00:00").getTime() + BACKFILL_COVER_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (first && first.price_date <= limit) covered++;
    else targets.push(h);
  });
  const failed = [];
  let filled = 0;
  for (let i = 0; i < targets.length; i++) {
    const h = targets[i];
    setFetchStatus(`과거 시세 채우는 중... (${i + 1}/${targets.length}) ${h.stock_name}`);
    const result = await backfillOne(h.market_kind, h.stock_name);
    if (result.ok) filled++;
    else failed.push(`${h.stock_name}: ${result.message}`);
    if (i < targets.length - 1) await sleep(REFRESH_GAP_MS[h.market_kind] ?? 0);
  }
  return { target_cnt: targets.length, covered, filled, failed };
}

function setupBackfill() {
  const button = document.getElementById("backfill-btn");
  button.addEventListener("click", async () => {
    if (backfillRunning) return;
    backfillRunning = true;
    button.disabled = true;
    try {
      const r = await backfillAll();
      renderHoldingsOnly();
      const shown = r.failed.slice(0, 3).join(", ") + (r.failed.length > 3 ? ` 외 ${r.failed.length - 3}개` : "");
      setFetchStatus(
        r.target_cnt === 0
          ? `채울 종목이 없습니다. (이미 채워진 종목 ${r.covered}개, 시세 코드가 없는 종목은 건너뜀)`
          : `과거 시세 ${r.filled}종목 채움 · 이미 채워진 ${r.covered}종목 건너뜀` + (r.failed.length > 0 ? ` · 실패 ${r.failed.length}개 (${shown})` : "")
      );
    } finally {
      backfillRunning = false;
      button.disabled = false;
    }
  });
  // 종목 상세의 '과거 시세 채우기'(한 종목)
  document.getElementById("holdings-area").addEventListener("click", async (event) => {
    const btn = event.target.closest('[data-action="backfill-one"]');
    if (!btn || backfillRunning) return;
    const { market_kind, stock_name } = splitHoldingKey(btn.dataset.key);
    backfillRunning = true;
    btn.disabled = true;
    setFetchStatus(`${stock_name} 과거 시세 채우는 중...`);
    try {
      const r = await backfillOne(market_kind, stock_name);
      setFetchStatus(
        r.ok
          ? `${stock_name} 과거 시세 ${r.total}일을 받았습니다(${r.from}부터, 새로 추가 ${r.added}일).`
          : `${stock_name} 과거 시세 조회 실패: ${r.message}`
      );
      renderHoldingsOnly();
    } finally {
      backfillRunning = false;
    }
  });
}

// 보유 화면만 다시 그린다(검색·필터를 바꿀 때).
function renderHoldingsOnly() {
  renderHoldings(computeHoldings(loadTransactions()), loadPrices(), loadSymbols(), loadStockInfo(), loadTransactions(), loadDividends());
}

function setupHoldingsView() {
  const toolbar = document.getElementById("holdings-toolbar");
  toolbar.addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    holdingsView[chip.dataset.hv] = chip.dataset.val;
    if (chip.dataset.hv === "market_filter" && chip.dataset.val !== "kr") holdingsView.exchange_filter = "all";
    saveHoldingsView();
    renderHoldingsOnly();
  });
  [
    ["hv-group", "group_kind"],
    ["hv-sector", "sector_filter"],
    ["hv-sort", "sort_kind"],
  ].forEach(([id, field]) => {
    document.getElementById(id).addEventListener("change", (event) => {
      holdingsView[field] = event.target.value;
      saveHoldingsView();
      renderHoldingsOnly();
    });
  });
  document.getElementById("hv-query").addEventListener("input", (event) => {
    holdingsView.search_text = event.target.value;
    saveHoldingsView();
    renderHoldingsOnly();
  });
  // 그룹·종목을 접고 펼친 상태를 기억해서 화면을 다시 그려도 유지한다.
  document.getElementById("holdings-area").addEventListener(
    "toggle",
    (event) => {
      const el = event.target;
      if (el.classList.contains("holding-item")) {
        if (el.open) openHoldingKeys.add(el.dataset.key);
        else openHoldingKeys.delete(el.dataset.key);
      } else if (el.classList.contains("holding-group")) {
        if (el.open) collapsedGroupIds.delete(el.dataset.group);
        else collapsedGroupIds.add(el.dataset.group);
      }
    },
    true
  );
}

function renderTransactions(transactions) {
  const txArea = document.getElementById("tx-area");

  if (transactions.length === 0) {
    txArea.innerHTML =
      '<p class="empty-message">아직 입력한 거래내역이 없습니다.</p>';
    return;
  }

  const marketLabel = MARKET_LABEL;
  const typeLabel = { buy: "매수", sell: "매도" };
  const typeClass = { buy: "tx-type-buy", sell: "tx-type-sell" };

  const sortedDesc = [...transactions].sort((a, b) => {
    if (a.trade_date !== b.trade_date) return a.trade_date > b.trade_date ? -1 : 1;
    return b.sequence_no - a.sequence_no;
  });

  txArea.innerHTML = sortedDesc
    .map((tx) => {
      return `
        <div class="tx-item" data-id="${tx.trade_id}">
          <div class="tx-item-main">
            <span class="tx-item-date">${tx.trade_date}</span>
            <span>
              <span class="${typeClass[tx.trade_kind]}">${typeLabel[tx.trade_kind]}</span>
              ${tx.stock_name} (${marketLabel[tx.market_kind]}) ·
              ${formatQty(tx.trade_quantity)}주 · ${formatMoney(tx.unit_price, tx.market_kind)}
              ${tx.trade_fee ? ` · 수수료 ${formatMoney(tx.trade_fee, tx.market_kind)}` : ""}
            </span>
          </div>
          <span class="tx-item-actions">
            <button class="edit-btn" data-action="edit-tx">수정</button>
            <button class="delete-btn" data-action="delete-tx">삭제</button>
          </span>
        </div>
      `;
    })
    .join("");
}

// 원화로 입력한 미국 배당이면 "원화 13,380원 ÷ 환율 1,338 (기준일)" 설명을 붙인다.
function dividendKrwNote(d) {
  if (d.dividend_amount_krw === undefined) return "";
  const dateNote = d.krw_per_usd_date ? ` (${d.krw_per_usd_date} 기준)` : "";
  return ` · 원화 ${Math.round(d.dividend_amount_krw).toLocaleString("ko-KR")}원 ÷ 환율 ${Number(d.krw_per_usd).toLocaleString("ko-KR")}${dateNote}`;
}

function renderDividends(dividends) {
  const summaryArea = document.getElementById("dividend-summary");
  const listArea = document.getElementById("dividend-area");

  if (dividends.length === 0) {
    summaryArea.innerHTML = "";
    listArea.innerHTML = '<p class="empty-message">아직 입력한 배당 기록이 없습니다.</p>';
    return;
  }

  const markets = ["kr", "us"];
  summaryArea.innerHTML = markets
    .map((market) => {
      const items = dividends.filter((d) => d.market_kind === market);
      if (items.length === 0) return "";
      const total = items.reduce((sum, d) => sum + d.dividend_amount, 0);
      return `
        <div class="summary-row">
          <span>${MARKET_LABEL[market]} 배당 합계</span>
          <span>${formatMoney(total, market)}</span>
        </div>
      `;
    })
    .join("");

  const sortedDesc = [...dividends].sort((a, b) => {
    if (a.dividend_date !== b.dividend_date) return a.dividend_date > b.dividend_date ? -1 : 1;
    return b.sequence_no - a.sequence_no;
  });

  listArea.innerHTML = sortedDesc
    .map(
      (d) => `
        <div class="tx-item" data-id="${d.dividend_id}">
          <div class="tx-item-main">
            <span class="tx-item-date">${d.dividend_date}</span>
            <span>${d.stock_name} (${MARKET_LABEL[d.market_kind]}) · ${formatMoney(d.dividend_amount, d.market_kind)}${dividendKrwNote(d)}</span>
          </div>
          <button class="delete-btn" data-action="delete-dividend">삭제</button>
        </div>
      `
    )
    .join("");
}

// ===== 시세 시그널·투자 성격·용어집 (design/11_시그널과용어집.md) =====
// 계산은 js/signals.js(Signals)와 js/glossary.js(Glossary)가 하고, 여기서는 저장·화면·이벤트만 이어 준다.
const SIGNAL_MAP_KEY = "stockSignals_v2"; // signal_state_map: holding_key -> 시그널 상태
const SIGNAL_SETTINGS_KEY = "stockSignalSettings_v2"; // signal_settings: 산식 상수(수정 영역)
const SIGNAL_LABEL = { buy_watch: "매수 관심", sell_review: "매도 검토", neutral: "중립", insufficient: "데이터 부족" };

function loadSignalMap() {
  try {
    const raw = localStorage.getItem(SIGNAL_MAP_KEY);
    const map = raw ? JSON.parse(raw) : {};
    return map && typeof map === "object" ? map : {};
  } catch (e) {
    console.error("시그널 상태를 읽는 중 오류:", e);
    return {};
  }
}

function saveSignalMap(map) {
  localStorage.setItem(SIGNAL_MAP_KEY, JSON.stringify(map));
}

function loadSignalSettings() {
  try {
    const raw = localStorage.getItem(SIGNAL_SETTINGS_KEY);
    return Signals.mergeSignalSettings(raw ? JSON.parse(raw) : {});
  } catch (e) {
    return Signals.mergeSignalSettings({});
  }
}

function saveSignalSettings(settings) {
  localStorage.setItem(SIGNAL_SETTINGS_KEY, JSON.stringify(Signals.mergeSignalSettings(settings)));
}

// 용어집으로 가는 작은 '?' 버튼 (누르면 그 용어가 펼쳐진 용어집이 열린다)
function glossaryBtn(termId) {
  return `<button type="button" class="gl-btn" data-glossary="${termId}" aria-label="용어 설명">?</button>`;
}

// 종목의 투자 성격. 종목정보에 값이 없으면 장기보유(기본값).
function holdingStyleOf(info, key) {
  return (info[key] || {}).holding_style_kind === "trade" ? "trade" : "long";
}

// 보유 종목의 시그널 상태를 갱신하고 새로 알릴 것을 돌려준다. 바뀌었을 때만 저장한다.
function syncSignals(holdings) {
  const keyed = holdings.map((h) => ({ key: holdingKey(h.market_kind, h.stock_name) }));
  const result = Signals.evaluateSignals(
    loadSignalMap(),
    keyed,
    loadPriceHistory(),
    loadSignalSettings(),
    loadAlertSettings().atr_period,
    new Date().toISOString()
  );
  if (result.changed) saveSignalMap(result.signal_map);
  return result;
}

function signalBadgeHtml(signal) {
  if (!signal || (signal.signal_state !== "buy_watch" && signal.signal_state !== "sell_review")) return "";
  return `<span class="signal-badge signal-${signal.signal_state}">${SIGNAL_LABEL[signal.signal_state]}</span>`;
}

// 현황 화면의 '시그널 변경' 배너: 상태가 바뀌어 아직 확인하지 않은 것만 보인다.
function renderSignalBanner(pending) {
  const area = document.getElementById("signal-banner-area");
  if (!area) return;
  if (pending.length === 0) {
    area.innerHTML = "";
    return;
  }
  const items = pending
    .map(({ key, signal_state, reasons }) => {
      const { stock_name } = splitHoldingKey(key);
      return `<div class="alert-item" data-key="${escapeHtml(key)}">
        <span class="signal-badge signal-${signal_state}">${SIGNAL_LABEL[signal_state]}</span>
        <span class="alert-item-text"><strong>${escapeHtml(stock_name)}</strong>
          <small>${escapeHtml((reasons || [])[0] || "")}</small></span>
        <button type="button" class="fetch-btn" data-action="signal-go">보기</button>
        <button type="button" class="fetch-btn" data-action="signal-ack">확인</button>
      </div>`;
    })
    .join("");
  area.innerHTML = `<div class="card alert-banner signal-banner">
    <div class="alert-banner-head"><strong>시세 시그널 변경 ${pending.length}건 ${glossaryBtn("signal")}</strong>
      <button type="button" class="fetch-btn" data-action="signal-ack-all">모두 확인</button></div>
    <div class="hint-text">과거 가격으로 계산한 참고 정보이며 매매 권유가 아닙니다.</div>
    ${items}</div>`;
}

// 전체(원화 환산) 대비 종목 비중이 한도를 넘는 종목. 미국 종목이 있는데 환율이 없으면 건너뛴다.
function computeWeightOver(rows) {
  const hasUs = rows.some((r) => r.h.market_kind === "us");
  const fx = loadFxRate();
  if (hasUs && !fx) return { total: 0, over: {}, skipped: true };
  const rate = hasUs ? Number(fx.krw_per_usd) : 1;
  const items = rows.map((r) => ({ key: r.key, value: r.evaluation_amount * (r.h.market_kind === "us" ? rate : 1) }));
  return Signals.weightOver(items, loadSignalSettings().max_weight_rate);
}

function weightBadgeHtml(ctx, key) {
  return ctx.weightOver && ctx.weightOver.over[key] ? '<span class="signal-badge signal-weight">비중 초과</span>' : "";
}

// 종목 상세의 '시세 시그널' 영역.
function signalSectionHtml(r, ctx) {
  const sig = r.signal;
  const market = r.h.market_kind;
  const settings = loadSignalSettings();
  const lines = [];
  if (sig.signal_state === "insufficient") {
    lines.push(
      `<div class="hd-note">시세 기록이 ${sig.metrics.rows_cnt}일뿐이라 판정할 수 없습니다 (최소 ${sig.needed_cnt}일 필요). 보유 화면 위쪽 '과거 시세 채우기'를 먼저 하세요.</div>`
    );
  } else {
    const reasonLis = [
      ...sig.buy_reasons.map((x) => `<li class="sig-buy">매수 근거 · ${escapeHtml(x)}</li>`),
      ...sig.sell_reasons.map((x) => `<li class="sig-sell">매도 근거 · ${escapeHtml(x)}</li>`),
    ].join("");
    lines.push(reasonLis ? `<ul class="hd-list">${reasonLis}</ul>` : '<div class="hd-note">지금은 특별한 신호가 없습니다.</div>');
    if (sig.mixed) lines.push('<div class="hd-note">매수·매도 근거가 엇갈려 중립으로 봅니다.</div>');
    const m = sig.metrics;
    const rg = m.range;
    lines.push(`<div class="sig-metrics">
      <span>RSI ${glossaryBtn("rsi")} ${m.rsi === null ? "-" : m.rsi.toFixed(1)}</span>
      <span>${settings.sma_short_period}일선 ${glossaryBtn("sma")} ${formatMoney(m.sma_short, market)}</span>
      <span>${settings.sma_long_period}일선 ${formatMoney(m.sma_long, market)}</span>
      <span>추세 이탈선 ${glossaryBtn("trend_break")} ${m.trail ? formatMoney(m.trail.stop_line, market) : "-"}</span>
      ${rg ? `<span>52주 위치 ${glossaryBtn("range_52w")} ${(rg.position_rate * 100).toFixed(0)}%</span><span>고점 대비 ${glossaryBtn("drawdown")} ${formatPercent(rg.drawdown_rate)}</span>` : ""}
    </div>`);
  }
  if (sig.signal_state !== "insufficient" && sig.metrics.sma_short !== null && sig.metrics.sma_long !== null) {
    const up = sig.metrics.sma_short > sig.metrics.sma_long;
    lines.push(
      `<div class="hd-note">${settings.sma_short_period}일선이 ${settings.sma_long_period}일선 ${up ? "위" : "아래"}에 있어 ${up ? "상승" : "하락"} 흐름(${up ? "정배열" : "역배열"}) ${glossaryBtn("ma_alignment")}입니다. 현재가는 ${settings.sma_long_period}일선 ${sig.metrics.current_price >= sig.metrics.sma_long ? "위" : "아래"}입니다.</div>`
    );
  }
  const w = ctx.weightOver && ctx.weightOver.over[r.key];
  if (w) {
    lines.push(
      `<div class="hd-note sig-weight">비중 ${glossaryBtn("weight")} ${(w * 100).toFixed(1)}%로 한도 ${(settings.max_weight_rate * 100).toFixed(0)}%를 넘었습니다. 비중 축소(${"리밸런싱"} ${glossaryBtn("rebalancing")})를 검토해 보세요.</div>`
    );
  }
  return `<div class="hd-section signal-section">
    <div class="hd-title">시세 시그널 ${glossaryBtn("signal")} ${signalBadgeHtml(sig)} <span class="hd-note">참고용 · 매매 권유 아님</span></div>
    ${lines.join("")}
  </div>`;
}

// 장기보유 종목은 평단 기준 목표가·손절가 알림을 쓰지 않는다는 안내.
function alertOffNoteHtml() {
  return `<div class="hd-section"><div class="hd-note">장기보유 종목이라 평단 기준 목표가·손절가 알림은 꺼져 있습니다. 시세 시그널을 참고하세요. 단기매매로 바꾸면 목표가·손절가 알림이 켜집니다.</div></div>`;
}

function styleRowHtml(r) {
  const key = escapeHtml(r.key);
  const opt = (v, label) => `<option value="${v}" ${r.holding_style_kind === v ? "selected" : ""}>${label}</option>`;
  return `<div class="holding-item-price-row">
    <span>투자 성격 ${glossaryBtn("holding_style")}</span>
    <select class="info-select" data-action="style-select" data-key="${key}">${opt("long", "장기보유")}${opt("trade", "단기매매")}</select>
  </div>`;
}

// 그래프 아래의 이동평균선 켜기·끄기 버튼
function maToggleHtml() {
  const chips = chartMaSpecs()
    .map(
      (m) =>
        `<button type="button" class="chip pc-ma-chip ${chartLayersOn.has(m.period) ? "active" : ""}" data-action="chart-ma" data-layer="${m.period}" style="border-color:${m.color}">${m.period}일선</button>`
    )
    .join("");
  return `<div class="pc-toggles"><span class="hd-note">이동평균선 ${glossaryBtn("sma")}</span>${chips}
    <span class="hd-note">기본: 단기 20일선 + 장기 200일선 · 단기선이 장기선 아래면 하락 흐름 ${glossaryBtn("ma_alignment")}</span></div>`;
}

function setupSignalActions() {
  document.getElementById("holdings-area").addEventListener("click", (event) => {
    const chip = event.target.closest('[data-action="chart-ma"]');
    if (!chip) return;
    const period = Number(chip.dataset.layer);
    if (chartLayersOn.has(period)) chartLayersOn.delete(period);
    else chartLayersOn.add(period);
    saveChartLayers();
    renderHoldingsOnly();
  });
  document.getElementById("holdings-area").addEventListener("change", (event) => {
    const sel = event.target.closest('[data-action="style-select"]');
    if (!sel) return;
    updateStockInfo(sel.dataset.key, { holding_style_kind: sel.value === "trade" ? "trade" : "" });
    render();
  });

  document.getElementById("signal-banner-area").addEventListener("click", (event) => {
    const map = loadSignalMap();
    if (event.target.closest('[data-action="signal-ack-all"]')) {
      Object.keys(map).forEach((k) => (map[k] = Signals.acknowledgeSignal(map[k])));
      saveSignalMap(map);
      render();
      return;
    }
    const item = event.target.closest(".alert-item");
    if (!item) return;
    const key = item.dataset.key;
    if (event.target.closest('[data-action="signal-ack"]')) {
      map[key] = Signals.acknowledgeSignal(map[key]);
      saveSignalMap(map);
      render();
    } else if (event.target.closest('[data-action="signal-go"]')) {
      openHoldingKeys.add(key);
      showScreen("holdings");
      renderHoldingsOnly();
    }
  });
}

// 설정 화면의 시그널 산식 상수 9개(수정 영역). 퍼센트 값은 화면에서는 %로, 저장은 소수로 한다.
const SIGNAL_SETTING_FIELDS = [
  { name: "sma_short_period", label: "단기 이동평균 (거래일)" },
  { name: "sma_long_period", label: "장기 이동평균 (거래일)" },
  { name: "cross_lookback_days", label: "교차 확인 기간 (거래일)" },
  { name: "rsi_period", label: "RSI 기간 (거래일)" },
  { name: "rsi_buy_level", label: "RSI 과매도 기준 (이하)" },
  { name: "rsi_sell_level", label: "RSI 과열 기준 (이상)" },
  { name: "trail_lookback_days", label: "추세선 조회 기간 (거래일)" },
  { name: "trail_atr_multiple", label: "추세 이탈 ATR 배수" },
  { name: "max_weight_rate", label: "한 종목 최대 비중 (%)", percent: true },
];

function renderSignalSettings() {
  const area = document.getElementById("signal-settings-area");
  if (!area) return;
  const s = loadSignalSettings();
  area.innerHTML = SIGNAL_SETTING_FIELDS.map((f) => {
    const shown = f.percent ? Math.round(s[f.name] * 1000) / 10 : s[f.name];
    return `<label>${f.label}<input type="number" step="any" min="0" data-signal-setting="${f.name}" value="${shown}" /></label>`;
  }).join("");
}

function setupSignalSettings() {
  renderSignalSettings();
  document.getElementById("signal-settings-area").addEventListener("change", (event) => {
    const input = event.target.closest("[data-signal-setting]");
    if (!input) return;
    const field = SIGNAL_SETTING_FIELDS.find((f) => f.name === input.dataset.signalSetting);
    const value = Number(input.value);
    const next = loadSignalSettings();
    if (Number.isFinite(value) && value > 0) next[field.name] = field.percent ? value / 100 : value;
    saveSignalSettings(next);
    renderSignalSettings(); // 잘못된 값은 기본값/이전 값으로 되돌려 보인다
    render();
  });
  document.getElementById("signal-settings-reset").addEventListener("click", () => {
    localStorage.removeItem(SIGNAL_SETTINGS_KEY);
    renderSignalSettings();
    render();
  });
}

// ----- 용어집 화면 -----
let glossaryOpenId = ""; // 펼쳐 둘 용어

function renderGlossary() {
  const area = document.getElementById("glossary-area");
  if (!area) return;
  const query = document.getElementById("glossary-query").value;
  const found = Glossary.searchGlossary(query);
  if (found.length === 0) {
    area.innerHTML = '<p class="empty-message">찾는 용어가 없습니다. 다른 말로 검색해 보세요.</p>';
    return;
  }
  area.innerHTML = Object.entries(Glossary.CATEGORY_LABEL)
    .map(([cat, label]) => {
      const items = found.filter((t) => t.term_category === cat);
      if (items.length === 0) return "";
      return `<div class="gl-group"><div class="gl-group-title">${label} (${items.length})</div>${items
        .map(
          (t) => `<details class="gl-term" data-term="${t.term_id}" ${t.term_id === glossaryOpenId ? "open" : ""}>
            <summary><strong>${escapeHtml(t.term_name)}</strong><span class="gl-summary">${escapeHtml(t.term_summary)}</span></summary>
            <div class="gl-body">
              <p>${escapeHtml(t.term_detail)}</p>
              ${t.term_formula ? `<p class="gl-formula">계산: ${escapeHtml(t.term_formula)}</p>` : ""}
              ${t.term_used_in ? `<p class="hd-note">이 앱에서: ${escapeHtml(t.term_used_in)}</p>` : ""}
              ${(t.term_aliases || []).length ? `<p class="hd-note">다른 이름: ${escapeHtml(t.term_aliases.join(", "))}</p>` : ""}
            </div>
          </details>`
        )
        .join("")}</div>`;
    })
    .join("");
}

// 용어집을 열고 그 용어를 펼친다.
function openGlossary(termId) {
  glossaryOpenId = termId || "";
  const q = document.getElementById("glossary-query");
  if (termId) q.value = "";
  renderGlossary();
  showScreen("glossary");
  if (termId) {
    const el = document.querySelector(`#glossary-area .gl-term[data-term="${termId}"]`);
    if (el) el.scrollIntoView({ block: "center" });
  }
}

function setupGlossary() {
  const q = document.getElementById("glossary-query");
  q.addEventListener("input", () => {
    glossaryOpenId = "";
    renderGlossary();
  });
  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-glossary]");
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    openGlossary(btn.dataset.glossary);
  });
  renderGlossary();
}
// ===== 시세 시그널·투자 성격·용어집 END =====

// ===== 목표가·손절가 알림 (design/10_목표가손절가알림.md) =====
// 계산은 js/alert_rules.js(AlertRules)가 하고, 여기서는 저장·화면·이벤트만 이어 준다.
const ALERT_RULES_KEY = "stockAlertRules_v2"; // alert_rule_map: holding_key -> 규칙
const ALERT_SETTINGS_KEY = "stockAlertSettings_v2"; // alert_settings: 산식 상수(수정 영역)

function loadAlertRules() {
  try {
    const raw = localStorage.getItem(ALERT_RULES_KEY);
    const map = raw ? JSON.parse(raw) : {};
    return map && typeof map === "object" ? map : {};
  } catch (e) {
    console.error("알림 규칙을 읽는 중 오류:", e);
    return {};
  }
}

function saveAlertRules(map) {
  localStorage.setItem(ALERT_RULES_KEY, JSON.stringify(map));
}

/** 저장된 설정을 기본값과 합친 값(항상 6개 키가 다 있다). */
function loadAlertSettings() {
  try {
    const raw = localStorage.getItem(ALERT_SETTINGS_KEY);
    return AlertRules.mergeSettings(raw ? JSON.parse(raw) : {});
  } catch (e) {
    return AlertRules.mergeSettings({});
  }
}

function saveAlertSettings(settings) {
  localStorage.setItem(ALERT_SETTINGS_KEY, JSON.stringify(AlertRules.mergeSettings(settings)));
}

const ALERT_STATE_LABEL = { hit_target: "목표가 도달", hit_stop: "손절가 이탈" };

// 보유 종목의 규칙을 맞추고(없으면 자동 생성, 낡은 자동 규칙은 다시 계산) 상태를 판정한다. 바뀌었을 때만 저장한다.
function syncAlerts(holdings, prices) {
  const info = loadStockInfo();
  const keyed = holdings
    .map((h) => ({ ...h, key: holdingKey(h.market_kind, h.stock_name) }))
    .filter((h) => holdingStyleOf(info, h.key) === "trade"); // 장기보유 종목은 평단 기준 알림을 쓰지 않는다 (D24)
  const result = AlertRules.evaluateAlerts(
    loadAlertRules(),
    keyed,
    prices,
    loadPriceHistory(),
    loadAlertSettings(),
    new Date().toISOString()
  );
  if (result.changed) saveAlertRules(result.rule_map);
  return result;
}

function alertBadgeHtml(rule) {
  if (!rule || !ALERT_STATE_LABEL[rule.alert_state]) return "";
  return `<span class="alert-badge alert-${rule.alert_state}">${ALERT_STATE_LABEL[rule.alert_state]}</span>`;
}

// 현황 화면 위쪽 배너: 확인하지 않은 알림만 보인다.
function renderAlertBanner(pending) {
  const area = document.getElementById("alert-banner-area");
  if (!area) return;
  if (pending.length === 0) {
    area.innerHTML = "";
    return;
  }
  const rules = loadAlertRules();
  const prices = loadPrices();
  const items = pending
    .map(({ key, alert_state }) => {
      const { market_kind, stock_name } = splitHoldingKey(key);
      const rule = rules[key] || {};
      const level = alert_state === "hit_target" ? rule.target_price : rule.stop_price;
      const levelLabel = alert_state === "hit_target" ? "목표가" : "손절가";
      return `<div class="alert-item" data-key="${escapeHtml(key)}">
        <span class="alert-badge alert-${alert_state}">${ALERT_STATE_LABEL[alert_state]}</span>
        <span class="alert-item-text"><strong>${escapeHtml(stock_name)}</strong>
          <small>현재 ${formatMoney(prices[key] || 0, market_kind)} · ${levelLabel} ${formatMoney(level, market_kind)}</small></span>
        <button type="button" class="fetch-btn" data-action="alert-go">보기</button>
        <button type="button" class="fetch-btn" data-action="alert-ack">확인</button>
      </div>`;
    })
    .join("");
  area.innerHTML = `<div class="card alert-banner">
    <div class="alert-banner-head"><strong>알림 ${pending.length}건</strong>
      <button type="button" class="fetch-btn" data-action="alert-ack-all">모두 확인</button></div>
    ${items}</div>`;
}

// 종목 상세의 목표가·손절가 영역. 평균단가는 r.h.average_price, 현재가는 r.currentPrice.
function alertSectionHtml(r, rule) {
  if (!rule) return "";
  const market = r.h.market_kind;
  const avg = r.h.average_price;
  const key = escapeHtml(r.key);
  const row = (level, label, price) => {
    const note = price
      ? `평단 대비 ${formatPercent(AlertRules.pctFromAverage(price, avg))}` +
        (r.currentPrice ? ` · 현재가에서 ${formatPercent(price / r.currentPrice - 1)}` : "")
      : "사용 안 함 (칸을 비워 둠)";
    return `<div class="alert-level-row">
      <span>${label}</span>
      <input class="alert-level-input" type="text" inputmode="decimal" data-action="alert-level" data-level="${level}" data-key="${key}"
        value="${price ? AlertRules.roundPrice(market, price) : ""}" placeholder="가격 또는 ${level === "target" ? "+20%" : "-10%"}" />
      <button type="button" class="fetch-btn" data-action="alert-step" data-level="${level}" data-delta="-0.05" data-key="${key}">−5%p</button>
      <button type="button" class="fetch-btn" data-action="alert-step" data-level="${level}" data-delta="0.05" data-key="${key}">＋5%p</button>
      <span class="alert-level-note">${note}</span>
    </div>`;
  };
  const ratio = loadAlertSettings().reward_risk_ratio;
  const sourceNote =
    rule.rule_kind === "manual"
      ? `직접 정함 <button type="button" class="fetch-btn" data-action="alert-auto" data-key="${key}">자동으로 되돌리기</button>`
      : `자동 권장값 (${rule.calc_kind === "atr" ? "변동성 ATR 기준" : "시세 기록이 적어 고정 비율"}, 손익비 1:${ratio})`;
  return `<div class="hd-section alert-section">
    <div class="hd-title">목표가·손절가 ${alertBadgeHtml(rule)} <span class="hd-note">${sourceNote}</span></div>
    ${row("target", "목표가", rule.target_price)}
    ${row("stop", "손절가", rule.stop_price)}
    <div class="hd-note">값을 직접 고치면 그 종목은 '직접 정함'이 됩니다. 가격(85000)이나 평단 대비 비율(+25%, -8%)로 쓸 수 있습니다.</div>
  </div>`;
}

function findHoldingByKey(key) {
  return computeHoldings(loadTransactions()).find((h) => holdingKey(h.market_kind, h.stock_name) === key);
}

// 목표가 또는 손절가 하나를 바꿔 저장한다. 평단과 어긋나면 확인을 받는다(D22). 저장했으면 true.
function applyLevelChange(key, level, newPrice) {
  const h = findHoldingByKey(key);
  const rules = loadAlertRules();
  const rule = rules[key];
  if (!h || !rule) return false;
  const target = level === "target" ? newPrice : rule.target_price;
  const stop = level === "stop" ? newPrice : rule.stop_price;
  const warnings = AlertRules.levelWarnings(h.average_price, target, stop);
  if (warnings.length > 0 && !window.confirm(`${warnings.join("\n")}\n그래도 이 값으로 저장할까요?`)) return false;
  rules[key] = AlertRules.applyManualLevels(rule, target, stop, new Date().toISOString());
  saveAlertRules(rules);
  return true;
}

function setupAlertActions() {
  const holdingsArea = document.getElementById("holdings-area");
  const bannerArea = document.getElementById("alert-banner-area");

  holdingsArea.addEventListener("change", (event) => {
    const input = event.target.closest('[data-action="alert-level"]');
    if (!input) return;
    const key = input.dataset.key;
    const h = findHoldingByKey(key);
    if (h) {
      const parsed = AlertRules.parseLevelInput(input.value, h.average_price, h.market_kind, input.dataset.level);
      if (!parsed.ok) setFetchStatus(parsed.error);
      else applyLevelChange(key, input.dataset.level, parsed.price);
    }
    render();
  });

  holdingsArea.addEventListener("click", (event) => {
    const step = event.target.closest('[data-action="alert-step"]');
    if (step) {
      const key = step.dataset.key;
      const h = findHoldingByKey(key);
      const rule = loadAlertRules()[key];
      if (h && rule) {
        const current = step.dataset.level === "target" ? rule.target_price : rule.stop_price;
        const basePct = AlertRules.pctFromAverage(current, h.average_price);
        if (basePct !== null) {
          const price = AlertRules.roundPrice(h.market_kind, h.average_price * (1 + basePct + Number(step.dataset.delta)));
          if (price > 0) applyLevelChange(key, step.dataset.level, price);
        } else {
          setFetchStatus("값이 비어 있습니다. 가격이나 비율을 먼저 쓰세요.");
        }
      }
      render();
      return;
    }
    const auto = event.target.closest('[data-action="alert-auto"]');
    if (auto) {
      const rules = loadAlertRules();
      delete rules[auto.dataset.key]; // 규칙을 지우면 render 가 권장값으로 다시 만든다(알림 확인 기록은 초기화)
      saveAlertRules(rules);
      render();
    }
  });

  bannerArea.addEventListener("click", (event) => {
    const rules = loadAlertRules();
    if (event.target.closest('[data-action="alert-ack-all"]')) {
      Object.keys(rules).forEach((k) => (rules[k] = AlertRules.acknowledgeAlert(rules[k])));
      saveAlertRules(rules);
      render();
      return;
    }
    const item = event.target.closest(".alert-item");
    if (!item) return;
    const key = item.dataset.key;
    if (event.target.closest('[data-action="alert-ack"]')) {
      rules[key] = AlertRules.acknowledgeAlert(rules[key]);
      saveAlertRules(rules);
      render();
    } else if (event.target.closest('[data-action="alert-go"]')) {
      openHoldingKeys.add(key);
      showScreen("holdings");
      renderHoldingsOnly();
    }
  });
}

// 설정 화면: 산식 상수 6개(수정 영역). 퍼센트 값은 화면에서는 %로, 저장은 소수(0.1)로 한다.
const ALERT_SETTING_FIELDS = [
  { name: "default_stop_rate", label: "고정 손절폭 (%, 시세 기록이 적을 때)", percent: true },
  { name: "reward_risk_ratio", label: "손익비 (목표폭 = 손절폭 × 이 값)" },
  { name: "atr_period", label: "ATR 기간 (거래일)" },
  { name: "atr_multiple", label: "ATR 배수 (손절폭 = 배수 × ATR)" },
  { name: "min_stop_rate", label: "손절폭 하한 (%)", percent: true },
  { name: "max_stop_rate", label: "손절폭 상한 (%)", percent: true },
];

function renderAlertSettings() {
  const area = document.getElementById("alert-settings-area");
  if (!area) return;
  const s = loadAlertSettings();
  area.innerHTML = ALERT_SETTING_FIELDS.map((f) => {
    const shown = f.percent ? Math.round(s[f.name] * 1000) / 10 : s[f.name];
    return `<label>${f.label}<input type="number" step="any" min="0" data-alert-setting="${f.name}" value="${shown}" /></label>`;
  }).join("");
}

function setupAlertSettings() {
  renderAlertSettings();
  document.getElementById("alert-settings-area").addEventListener("change", (event) => {
    const input = event.target.closest("[data-alert-setting]");
    if (!input) return;
    const field = ALERT_SETTING_FIELDS.find((f) => f.name === input.dataset.alertSetting);
    const value = Number(input.value);
    const next = loadAlertSettings();
    if (Number.isFinite(value) && value > 0) next[field.name] = field.percent ? value / 100 : value;
    saveAlertSettings(next);
    renderAlertSettings(); // 잘못된 값은 이전 값으로 되돌려 보인다
    render();
  });
  document.getElementById("alert-settings-reset").addEventListener("click", () => {
    localStorage.removeItem(ALERT_SETTINGS_KEY);
    renderAlertSettings();
    render();
  });
}
// ===== 목표가·손절가 알림 END =====

function render() {
  const transactions = loadTransactions();
  const prices = loadPrices();
  const symbols = loadSymbols();
  const holdings = computeHoldings(transactions);
  autoFillSectors(holdings); // 분류한 적 없는 종목에 이름 규칙으로 섹터를 채운다
  renderKnownStockNames(transactions);
  renderAlertBanner(syncAlerts(holdings, prices).pending); // 목표가·손절가 규칙 맞춤·판정 (보유 화면보다 먼저)
  renderSignalBanner(syncSignals(holdings).pending); // 시세 시그널 변경 알림

  renderDashboard(holdings, prices);
  renderShare(holdings, prices);
  renderRank(holdings, prices);
  renderHoldings(holdings, prices, symbols, loadStockInfo(), transactions, loadDividends());
  renderTransactions(transactions);
  renderDividends(loadDividends());
}

// --- 이벤트 ---

// ===== 거래 추가 / 수정 (design/06_거래내역수정.md) =====
function setTradeFormStatus(text) {
  const el = document.getElementById("trade-form-status");
  if (el) el.textContent = text;
}

// 양식을 수정 모드(trade 를 넘김)나 추가 모드(null)로 바꾼다.
function setTradeFormMode(form, trade) {
  const editing = Boolean(trade);
  form.reset();
  form.querySelector('[name="trade_id"]').value = editing ? trade.trade_id : ""; // hidden 입력은 reset 으로 안 지워져서 직접 비운다
  form.querySelector('[name="trade_date"]').value = editing ? trade.trade_date : todayISO();
  if (editing) {
    form.querySelector('[name="market_kind"]').value = trade.market_kind;
    form.querySelector('[name="stock_name"]').value = trade.stock_name;
    form.querySelector('[name="trade_kind"]').value = trade.trade_kind;
    form.querySelector('[name="trade_quantity"]').value = trade.trade_quantity;
    form.querySelector('[name="unit_price"]').value = trade.unit_price;
    form.querySelector('[name="trade_fee"]').value = trade.trade_fee || 0;
  }
  document.getElementById("trade-panel-summary").textContent = editing ? "✎ 거래 수정" : "＋ 거래 추가";
  document.getElementById("trade-submit-btn").textContent = editing ? "수정 저장" : "거래 추가";
  document.getElementById("trade-cancel-btn").hidden = !editing;
}

// 입력값 검사. 문제가 있으면 안내 문장을, 없으면 빈 문자열을 돌려준다.
function validateTradeInput(t) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.trade_date)) return "날짜를 YYYY-MM-DD 형식으로 입력해 주세요.";
  if (!t.stock_name) return "종목명을 입력해 주세요.";
  if (!Number.isFinite(t.trade_quantity) || t.trade_quantity <= 0) return "수량은 0보다 커야 합니다.";
  if (!Number.isFinite(t.unit_price) || t.unit_price < 0) return "단가는 0 이상의 숫자여야 합니다.";
  if (!Number.isFinite(t.trade_fee) || t.trade_fee < 0) return "수수료는 0 이상의 숫자여야 합니다.";
  return "";
}

// 한 종목(holding_key)의 최종 보유 수량(매수 합 - 매도 합).
function finalHoldingQuantity(transactions, key) {
  return transactions
    .filter((x) => holdingKey(x.market_kind, x.stock_name) === key)
    .reduce((sum, x) => sum + (x.trade_kind === "buy" ? x.trade_quantity : -x.trade_quantity), 0);
}

// 종목 키가 바뀌었을 때 시세 코드·현재가·가격 히스토리를 새 키로 옮긴다. 옮겼으면 true.
// 새 키에 이미 값이 있으면 덮어쓰지 않고, 옛 키를 쓰는 거래가 하나도 안 남았을 때만 옛 값을 지운다.
function carryHoldingData(oldKey, newKey, transactions) {
  if (oldKey === newKey) return false;
  const stillUsed = transactions.some((x) => holdingKey(x.market_kind, x.stock_name) === oldKey);
  let moved = false;
  [
    [loadSymbols, saveSymbols],
    [loadPrices, savePrices],
    [loadPriceHistory, savePriceHistory],
  ].forEach(([load, save]) => {
    const map = load();
    let changed = false;
    if (map[oldKey] !== undefined && map[newKey] === undefined) {
      map[newKey] = map[oldKey];
      changed = true;
      moved = true;
    }
    if (!stillUsed && map[oldKey] !== undefined) {
      delete map[oldKey];
      changed = true;
    }
    if (changed) save(map);
  });
  return moved;
}

function setupForm() {
  const form = document.getElementById("transaction-form");
  setTradeFormMode(form, null);

  document.getElementById("trade-cancel-btn").addEventListener("click", () => {
    setTradeFormMode(form, null);
    form.closest("details").open = false;
    setTradeFormStatus("");
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const editId = String(formData.get("trade_id") || "");
    const input = {
      trade_date: String(formData.get("trade_date")) || todayISO(),
      market_kind: formData.get("market_kind"),
      stock_name: String(formData.get("stock_name")).trim(),
      trade_kind: formData.get("trade_kind"),
      trade_quantity: Number(formData.get("trade_quantity")),
      unit_price: Number(formData.get("unit_price")),
      trade_fee: Number(formData.get("trade_fee")) || 0,
    };
    const problem = validateTradeInput(input);
    if (problem) {
      setTradeFormStatus(problem);
      return;
    }

    const transactions = loadTransactions();
    let note = "";
    if (editId) {
      // 수정: 같은 거래(trade_id, sequence_no)를 제자리에서 갱신한다.
      const idx = transactions.findIndex((x) => x.trade_id === editId);
      if (idx < 0) {
        setTradeFormStatus("수정하려는 거래를 찾지 못했습니다(이미 삭제되었을 수 있습니다). 수정을 취소합니다.");
        setTradeFormMode(form, null);
        return;
      }
      const old = transactions[idx];
      const oldKey = holdingKey(old.market_kind, old.stock_name);
      const newKey = holdingKey(input.market_kind, input.stock_name);
      const next = transactions.map((x, n) => (n === idx ? { ...x, ...input } : x));
      const negative = [...new Set([oldKey, newKey])].find(
        (k) => next.some((x) => holdingKey(x.market_kind, x.stock_name) === k) && finalHoldingQuantity(next, k) < -1e-9
      );
      if (negative) {
        setTradeFormStatus(`저장하지 않았습니다. 이렇게 고치면 ${negative.split("|").slice(1).join("|")}의 보유 수량이 마이너스가 됩니다. 매도 수량을 먼저 확인해 주세요.`);
        return;
      }
      saveTransactions(next);
      if (carryHoldingData(oldKey, newKey, next)) note = " 종목이 바뀌어 시세 코드·현재가를 새 종목으로 옮겼습니다.";
      note = "거래를 수정했습니다." + note;
    } else {
      transactions.push({ trade_id: makeId(), ...input, sequence_no: Date.now() });
      saveTransactions(transactions);
    }

    setTradeFormMode(form, null);
    setTradeFormStatus(note);
    render();
    form.dispatchEvent(new CustomEvent("saved")); // 추가 패널을 접는다
  });
}

// "market_kind|stock_name" 형태의 holding_key를 market_kind/stock_name으로 되돌린다.
function splitHoldingKey(key) {
  const sep = key.indexOf("|");
  return { market_kind: key.slice(0, sep), stock_name: key.slice(sep + 1) };
}

function setupHoldingsActions() {
  const holdingsArea = document.getElementById("holdings-area");

  holdingsArea.addEventListener("change", (event) => {
    const priceInput = event.target.closest('[data-action="price-input"]');
    if (priceInput) {
      const key = priceInput.dataset.key;
      const prices = loadPrices();
      prices[key] = Number(priceInput.value) || 0;
      savePrices(prices);
      render();
      return;
    }

    const symbolInput = event.target.closest('[data-action="symbol-input"]');
    if (symbolInput) {
      const key = symbolInput.dataset.key;
      const symbols = loadSymbols();
      symbols[key] = symbolInput.value.trim();
      saveSymbols(symbols);
      autoFillExchanges();
      return;
    }

    const sectorSelect = event.target.closest('[data-action="sector-select"]');
    if (sectorSelect) {
      if (sectorSelect.value === "__new") {
        // 새 섹터 이름을 적을 입력 칸을 보여 준다
        const input = sectorSelect.parentElement.querySelector('[data-action="sector-input"]');
        input.hidden = false;
        input.focus();
        return;
      }
      updateStockInfo(sectorSelect.dataset.key, { sector_name: sectorSelect.value });
      render();
      return;
    }

    const sectorInput = event.target.closest('[data-action="sector-input"]');
    if (sectorInput) {
      updateStockInfo(sectorInput.dataset.key, { sector_name: sectorInput.value.trim() });
      render(); // 그룹과 섹터 목록이 바로 바뀐다
      return;
    }

    const exchangeSelect = event.target.closest('[data-action="exchange-select"]');
    if (exchangeSelect) {
      updateStockInfo(exchangeSelect.dataset.key, { exchange_kind: exchangeSelect.value });
      render();
    }
  });

  holdingsArea.addEventListener("click", async (event) => {
    const fetchBtn = event.target.closest('[data-action="fetch-price"]');
    if (fetchBtn) {
      const { market_kind, stock_name } = splitHoldingKey(fetchBtn.dataset.key);
      setFetchStatus(`${stock_name} 조회 중...`);
      const result = await fetchAndUpdatePrice(market_kind, stock_name);

      if (result.ok) {
        const dateNote = market_kind === "kr" ? ` (${result.price_date} 종가)` : "";
        setFetchStatus(`${stock_name} 현재가를 ${formatMoney(result.current_price, market_kind)}로 갱신했습니다.${dateNote}`);
        render();
      } else {
        setFetchStatus(`${stock_name} 조회 실패: ${result.message}`);
      }
      return;
    }

    const lookupBtn = event.target.closest('[data-action="lookup-symbol"]');
    if (lookupBtn) {
      const key = lookupBtn.dataset.key;
      const { market_kind, stock_name } = splitHoldingKey(key);
      setFetchStatus(`${stock_name} 시세 코드 찾는 중...`);
      try {
        const found = await lookupSymbolDetail(market_kind, stock_name);
        const symbol = found.symbol_code;
        const symbols = loadSymbols();
        symbols[key] = symbol;
        saveSymbols(symbols);
        if (found.exchange_kind) updateStockInfo(key, { exchange_kind: found.exchange_kind }, { onlyIfEmpty: true });
        setFetchStatus(`${stock_name}의 시세 코드를 "${symbol}"(으)로 채웠습니다. 맞는지 확인해 주세요.`);
        render();
      } catch (e) {
        setFetchStatus(`${stock_name} 시세 코드 찾기 실패: ${e.message}`);
      }
    }
  });
}

function setupSettings() {
  const usInput = document.getElementById("api-key-input");
  usInput.value = loadApiKey();
  usInput.addEventListener("change", () => {
    saveApiKey(usInput.value.trim());
  });

  const krInput = document.getElementById("kr-api-key-input");
  krInput.value = loadKrApiKey();
  krInput.addEventListener("change", () => {
    saveKrApiKey(krInput.value.trim());
  });
}

function setupRefreshAll() {
  const button = document.getElementById("refresh-all-btn");

  button.addEventListener("click", async () => {
    // 국내(제한이 느슨함)를 먼저, 미국(분당 8회 제한)은 뒤에서 천천히 조회한다.
    const holdings = [...computeHoldings(loadTransactions())].sort(
      (a, b) => (a.market_kind === b.market_kind ? 0 : a.market_kind === "kr" ? -1 : 1)
    );
    if (holdings.length === 0) {
      setFetchStatus("보유 중인 종목이 없습니다.");
      return;
    }

    button.disabled = true;
    setFetchStatus(`전체 종목 조회 중... (0/${holdings.length})`);

    let successCount = 0;
    const failMessages = [];

    try {
      for (let i = 0; i < holdings.length; i++) {
        const h = holdings[i];
        let result = await fetchAndUpdatePrice(h.market_kind, h.stock_name);
        if (!result.ok && result.rate_limited) {
          // 분당 한도: 다음 분까지 기다렸다가 이 종목만 한 번 다시 조회한다.
          await waitWithCountdown(
            RATE_LIMIT_WAIT_MS,
            (sec) => `미국 시세 분당 한도에 걸려 ${sec}초 기다린 뒤 ${h.stock_name}을(를) 다시 조회합니다 (${i + 1}/${holdings.length})`
          );
          result = await fetchAndUpdatePrice(h.market_kind, h.stock_name);
        }
        if (result.ok) {
          successCount++;
        } else {
          failMessages.push(`${h.stock_name}: ${result.message}`);
        }

        const usLeft = holdings.slice(i + 1).filter((x) => x.market_kind === "us").length;
        const etaSec = Math.round((usLeft * REFRESH_GAP_MS.us) / 1000);
        setFetchStatus(
          `전체 종목 조회 중... (${i + 1}/${holdings.length})` +
            (usLeft > 0 && REFRESH_GAP_MS.us > 0 ? ` · 미국 ${usLeft}종목 남음, 분당 8회 제한이라 약 ${etaSec}초` : "")
        );
        if (i < holdings.length - 1) await sleep(REFRESH_GAP_MS[h.market_kind] ?? 0);
      }
    } finally {
      button.disabled = false;
    }
    render();

    // 실패가 많으면 화면이 길어지므로 3개까지만 보여 준다.
    const shown = failMessages.slice(0, 3).join(", ") + (failMessages.length > 3 ? ` 외 ${failMessages.length - 3}개` : "");
    const summary =
      `${successCount}개 종목 갱신 완료` + (failMessages.length > 0 ? ` · 실패 ${failMessages.length}개 (${shown})` : "");
    setFetchStatus(summary);
  });
}

function setupTransactionActions() {
  const txArea = document.getElementById("tx-area");
  const form = document.getElementById("transaction-form");

  txArea.addEventListener("click", (event) => {
    const editBtn = event.target.closest('[data-action="edit-tx"]');
    if (editBtn) {
      const trade = loadTransactions().find((tx) => tx.trade_id === editBtn.closest(".tx-item").dataset.id);
      if (!trade) return;
      setTradeFormMode(form, trade);
      setTradeFormStatus("");
      form.closest("details").open = true;
      document.getElementById("screen-area").scrollTop = 0;
      return;
    }

    const button = event.target.closest('[data-action="delete-tx"]');
    if (!button) return;

    const item = button.closest(".tx-item");
    const id = item.dataset.id;

    if (!window.confirm("이 거래내역을 삭제할까요? (보유수량·평균단가가 다시 계산됩니다)")) return;

    const transactions = loadTransactions().filter((tx) => tx.trade_id !== id);
    saveTransactions(transactions);
    if (form.querySelector('[name="trade_id"]').value === id) setTradeFormMode(form, null); // 수정 중이던 거래를 지웠다
    render();
  });
}

// 미국 배당일 때만 '입력 통화'를 보이고, 원화를 고르면 환율 칸을 보인다.
function updateDividendCurrencyFields(form) {
  const isUs = form.querySelector('[name="market_kind"]').value === "us";
  const isKrw = isUs && form.querySelector('[name="currency_kind"]').value === "krw";
  document.getElementById("dividend-currency-row").hidden = !isUs;
  document.getElementById("dividend-rate-label").hidden = !isKrw;
  document.getElementById("dividend-amount-label").textContent = isKrw ? "배당금액(원)" : isUs ? "배당금액($)" : "배당금액";
}

// ===== 환율(오늘 1달러당 원) (design/09_환율반영.md) =====
const FX_KEY = "stockFxRate_v1"; // fx_rate: { krw_per_usd, krw_per_usd_date, fetched_at, is_manual }
const FX_STALE_MS = 12 * 60 * 60 * 1000; // 자동 갱신 주기

function loadFxRate() {
  try {
    const v = JSON.parse(localStorage.getItem(FX_KEY) || "null");
    return v && Number(v.krw_per_usd) > 0 ? v : null;
  } catch (e) {
    return null;
  }
}

function saveFxRate(value) {
  localStorage.setItem(FX_KEY, JSON.stringify(value));
}

// 서비스에서 최신 환율을 받아 저장한다(직접 입력 표시는 지운다).
async function refreshFxRate() {
  const r = await fetchUsdKrwRate("latest");
  const value = { krw_per_usd: r.krw_per_usd, krw_per_usd_date: r.krw_per_usd_date, fetched_at: new Date().toISOString(), is_manual: false };
  saveFxRate(value);
  return value;
}

// 앱을 열 때: 미국 보유 종목이 있고, 환율이 없거나 12시간이 지났고 직접 입력한 값이 아니면 새로 받는다.
async function ensureFxRate() {
  if (!loadAutoFillEnabled()) return;
  if (!computeHoldings(loadTransactions()).some((h) => h.market_kind === "us")) return;
  const cur = loadFxRate();
  if (cur && (cur.is_manual || Date.now() - Date.parse(cur.fetched_at) < FX_STALE_MS)) return;
  try {
    await refreshFxRate();
    render();
  } catch (e) {
    console.warn("환율을 받지 못했습니다(이전 값을 그대로 씁니다):", e);
  }
}

// 현황 맨 위 '총 평가금액(원화 환산)' 칸. 미국 종목이 없으면 비어 있다.
function fxTotalTileHtml(holdings, prices) {
  if (!holdings.some((h) => h.market_kind === "us")) return "";
  const manual = `<details class="help fx-manual"><summary>환율 직접 입력</summary>
      <span class="fx-manual-row"><input id="fx-input" type="number" step="any" min="0" placeholder="예: 1400" />
      <button type="button" class="fetch-btn" data-action="fx-save">저장</button></span></details>`;
  const fx = loadFxRate();
  if (!fx) {
    return `<div class="stat-tile stat-total"><div class="stat-label">총 평가금액 (원화 환산)</div>
      <div class="fx-note">환율을 아직 가져오지 못했습니다. <button type="button" class="fetch-btn" data-action="fx-refresh">환율 가져오기</button></div>
      <div id="fx-status" class="fx-note"></div>${manual}</div>`;
  }
  const rate = Number(fx.krw_per_usd);
  let buy = 0;
  let evaluation = 0;
  holdings.forEach((h) => {
    const c = calc(h, prices[holdingKey(h.market_kind, h.stock_name)] || 0);
    const k = h.market_kind === "us" ? rate : 1;
    buy += c.buy_amount * k;
    evaluation += c.evaluation_amount * k;
  });
  const profit = evaluation - buy;
  return `<div class="stat-tile stat-total">
      <div class="stat-label">총 평가금액 (원화 환산)</div>
      <div class="stat-value">${formatMoney(evaluation, "kr")}</div>
      <div class="stat-delta ${profitClass(profit)}">${formatMoney(profit, "kr")} (${formatPercent(buy === 0 ? 0 : profit / buy)})</div>
      <div class="fx-note">환율 ${rate.toLocaleString("ko-KR")}원/$ · ${escapeHtml(fx.krw_per_usd_date)} 기준${fx.is_manual ? " (직접 입력)" : ""}
        <button type="button" class="fetch-btn" data-action="fx-refresh">갱신</button></div>
      <div id="fx-status" class="fx-note"></div>
      <div class="fx-note">미국 손익은 달러 손익을 오늘 환율로 옮긴 값이라 환차손익은 포함되지 않습니다.</div>${manual}</div>`;
}

// 국내+미국을 합친 전체 비중(원화 환산) 블록. 환율이 없거나 미국 종목이 없으면 비어 있다.
function combinedShareHtml(holdings, prices) {
  const fx = loadFxRate();
  if (!fx || !holdings.some((h) => h.market_kind === "us")) return "";
  const rate = Number(fx.krw_per_usd);
  const items = holdings
    .map((h) => ({
      stock_name: h.stock_name,
      evaluation_amount: calc(h, prices[holdingKey(h.market_kind, h.stock_name)] || 0).evaluation_amount * (h.market_kind === "us" ? rate : 1),
    }))
    .sort((a, b) => b.evaluation_amount - a.evaluation_amount);
  const total = items.reduce((sum, x) => sum + x.evaluation_amount, 0);
  const top = items.slice(0, SHARE_COLORS.length);
  const rest = items.slice(SHARE_COLORS.length);
  const slots = top.map((x, i) => ({ ...x, color: SHARE_COLORS[i] }));
  if (rest.length > 0) {
    slots.push({ stock_name: `기타 (${rest.length}종목)`, evaluation_amount: rest.reduce((sum, x) => sum + x.evaluation_amount, 0), color: SHARE_OTHER_COLOR });
  }
  const pct = (v) => (total === 0 ? 0 : (v / total) * 100);
  const segments = slots.map((x) => `<div class="share-segment" style="width:${pct(x.evaluation_amount)}%;background-color:${x.color}"></div>`).join("");
  const legend = slots
    .map(
      (x) => `<div class="legend-row"><span class="legend-swatch" style="background-color:${x.color}"></span>
        <span class="legend-name">${escapeHtml(x.stock_name)}</span>
        <span class="legend-value">${pct(x.evaluation_amount).toFixed(1)}% · ${formatMoney(x.evaluation_amount, "kr")}</span></div>`
    )
    .join("");
  return `<div class="share-block share-combined"><h3>전체 비중 (원화 환산)</h3><div class="share-bar">${segments}</div><div class="share-legend">${legend}</div></div>`;
}

function setupFxActions() {
  document.getElementById("dashboard-area").addEventListener("click", async (event) => {
    const refresh = event.target.closest('[data-action="fx-refresh"]');
    if (refresh) {
      const status = document.getElementById("fx-status");
      if (status) status.textContent = "환율을 받는 중...";
      try {
        await refreshFxRate();
        render();
      } catch (e) {
        const el = document.getElementById("fx-status");
        if (el) el.textContent = `환율을 가져오지 못했습니다: ${e.message}`;
      }
      return;
    }
    const save = event.target.closest('[data-action="fx-save"]');
    if (save) {
      const value = Number(document.getElementById("fx-input").value);
      const el = document.getElementById("fx-status");
      if (!Number.isFinite(value) || value <= 0) {
        if (el) el.textContent = "환율은 0보다 큰 숫자로 입력해 주세요.";
        return;
      }
      saveFxRate({ krw_per_usd: value, krw_per_usd_date: todayISO(), fetched_at: new Date().toISOString(), is_manual: true });
      render();
    }
  });
}

function setDividendFormStatus(text) {
  const el = document.getElementById("dividend-form-status");
  if (el) el.textContent = text;
}

// 달러/원 환율(1달러당 원)을 날짜로 조회한다. 출처: Frankfurter(유럽중앙은행 기준환율).
// 가입·키가 필요 없고 브라우저에서 바로 호출된다. 주말·휴일이면 직전 영업일 값과 그 날짜를 돌려준다.
async function fetchUsdKrwRate(dateStr) {
  const res = await fetch(`https://api.frankfurter.dev/v1/${dateStr}?base=USD&symbols=KRW`);
  if (!res.ok) throw new Error(`환율 서비스 응답 오류(${res.status})`);
  const data = await res.json();
  const krw_per_usd = Number(data && data.rates && data.rates.KRW);
  if (!Number.isFinite(krw_per_usd) || krw_per_usd <= 0) throw new Error("환율 데이터를 이해할 수 없습니다.");
  return { krw_per_usd, krw_per_usd_date: (data && data.date) || dateStr };
}

function setupDividendForm() {
  const form = document.getElementById("dividend-form");
  const dateInput = form.querySelector('input[name="dividend_date"]');
  const submitBtn = document.getElementById("dividend-submit-btn");
  dateInput.value = todayISO();
  updateDividendCurrencyFields(form);
  form.querySelector('[name="market_kind"]').addEventListener("change", () => updateDividendCurrencyFields(form));
  form.querySelector('[name="currency_kind"]').addEventListener("change", () => updateDividendCurrencyFields(form));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const stock_name = String(formData.get("stock_name")).trim();
    if (!stock_name) return;

    const market_kind = formData.get("market_kind");
    const inputAmount = Number(formData.get("dividend_amount"));
    const newDividend = {
      dividend_id: makeId(),
      dividend_date: String(formData.get("dividend_date")) || todayISO(),
      market_kind,
      stock_name,
      dividend_amount: inputAmount,
      sequence_no: Date.now(),
    };
    let note = "";

    // 미국 배당을 원화로 입력하면 환율로 달러를 계산해 저장하고, 원화 금액과 환율은 참고로 남긴다.
    // 환율 칸이 비어 있으면 배당일의 환율을 자동으로 가져온다.
    if (market_kind === "us" && formData.get("currency_kind") === "krw") {
      if (!Number.isFinite(inputAmount) || inputAmount <= 0) {
        setDividendFormStatus("원화로 입력하려면 배당금액(원)을 0보다 크게 입력해 주세요.");
        return;
      }
      const rateText = String(formData.get("krw_per_usd") || "").trim();
      let krwPerUsd;
      let rateDate;
      if (rateText === "") {
        submitBtn.disabled = true;
        setDividendFormStatus(`${newDividend.dividend_date} 환율을 가져오는 중...`);
        try {
          const r = await fetchUsdKrwRate(newDividend.dividend_date);
          krwPerUsd = r.krw_per_usd;
          rateDate = r.krw_per_usd_date;
        } catch (e) {
          setDividendFormStatus(`환율을 자동으로 가져오지 못했습니다(${e.message}). 환율 칸에 그날 환율을 직접 입력해 주세요.`);
          return;
        } finally {
          submitBtn.disabled = false;
        }
      } else {
        krwPerUsd = Number(rateText);
        if (!Number.isFinite(krwPerUsd) || krwPerUsd <= 0) {
          setDividendFormStatus("환율은 0보다 큰 숫자로 입력해 주세요. 비워 두면 자동으로 가져옵니다.");
          return;
        }
      }
      newDividend.dividend_amount = Math.round((inputAmount / krwPerUsd) * 100) / 100;
      newDividend.dividend_amount_krw = inputAmount;
      newDividend.krw_per_usd = krwPerUsd;
      if (rateDate) {
        newDividend.krw_per_usd_date = rateDate;
        note = `환율 ${krwPerUsd.toLocaleString("ko-KR")}원(${rateDate} 기준, 유럽중앙은행 기준환율)을 적용해 ${formatMoney(newDividend.dividend_amount, "us")}로 저장했습니다.`;
      } else {
        note = `입력한 환율 ${krwPerUsd.toLocaleString("ko-KR")}원을 적용해 ${formatMoney(newDividend.dividend_amount, "us")}로 저장했습니다.`;
      }
    }

    const dividends = loadDividends();
    dividends.push(newDividend);
    saveDividends(dividends);

    form.reset();
    dateInput.value = todayISO();
    updateDividendCurrencyFields(form);
    setDividendFormStatus(note);
    renderDividends(loadDividends());
    form.dispatchEvent(new CustomEvent("saved")); // 추가 패널을 접는다
  });
}

function setupDividendActions() {
  const area = document.getElementById("dividend-area");

  area.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="delete-dividend"]');
    if (!button) return;

    const item = button.closest(".tx-item");
    const id = item.dataset.id;

    if (!window.confirm("이 배당 기록을 삭제할까요?")) return;

    const dividends = loadDividends().filter((d) => d.dividend_id !== id);
    saveDividends(dividends);
    renderDividends(dividends);
  });
}

// --- 데이터 관리: 거래내역 CSV, 전체 백업(JSON) ---

function setCsvStatus(text) {
  const el = document.getElementById("csv-status");
  if (el) el.textContent = text;
}

function setDividendCsvStatus(text) {
  const el = document.getElementById("dividend-csv-status");
  if (el) el.textContent = text;
}

function setJsonStatus(text) {
  const el = document.getElementById("json-status");
  if (el) el.textContent = text;
}

function downloadTextFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n\r]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function buildTransactionsCsv(transactions, symbols) {
  const header = ["날짜", "구분", "종목명", "매수/매도", "수량", "단가", "수수료", "시세코드"];
  const typeLabel = { buy: "매수", sell: "매도" };

  const rows = transactions.map((tx) => {
    const symbol = symbols[holdingKey(tx.market_kind, tx.stock_name)] || "";
    return [
      tx.trade_date,
      MARKET_LABEL[tx.market_kind],
      tx.stock_name,
      typeLabel[tx.trade_kind],
      tx.trade_quantity,
      tx.unit_price,
      tx.trade_fee,
      symbol,
    ]
      .map(csvEscape)
      .join(",");
  });

  return [header.join(","), ...rows].join("\r\n");
}

function buildDividendsCsv(dividends) {
  const header = ["날짜", "구분", "종목명", "배당금액", "원화금액", "환율", "환율기준일"];
  const rows = dividends.map((d) =>
    [
      d.dividend_date,
      MARKET_LABEL[d.market_kind],
      d.stock_name,
      d.dividend_amount,
      d.dividend_amount_krw ?? "",
      d.krw_per_usd ?? "",
      d.krw_per_usd_date ?? "",
    ]
      .map(csvEscape)
      .join(",")
  );
  return [header.join(","), ...rows].join("\r\n");
}

// 쉼표/줄바꿈/따옴표가 포함된 필드(큰따옴표로 감싼 경우)까지 다루는 간단한 CSV 파서.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function handleCsvImportFile(file) {
  const BOM = String.fromCharCode(0xfeff);
  const text = (await file.text()).replace(new RegExp("^" + BOM), ""); // 엑셀이 붙이는 UTF-8 BOM 제거
  const rows = parseCsv(text);
  if (rows.length <= 1) {
    setCsvStatus("가져올 내용이 없습니다 (빈 파일이거나 머리글만 있음).");
    return;
  }

  const marketFromLabel = { 국내: "kr", 미국: "us" };
  const typeFromLabel = { 매수: "buy", 매도: "sell" };

  const transactions = loadTransactions();
  const symbols = loadSymbols();
  let added = 0;
  const errors = [];

  rows.slice(1).forEach((cols, idx) => {
    const lineNo = idx + 2; // 머리글 포함 실제 줄 번호
    if (cols.every((c) => c.trim() === "")) return; // 빈 줄은 조용히 건너뜀

    const [date, marketLabel, name, typeLabel2, qtyStr, priceStr, feeStr, symbol] = cols;
    const market_kind = marketFromLabel[(marketLabel || "").trim()];
    const trade_kind = typeFromLabel[(typeLabel2 || "").trim()];
    const qty = Number(qtyStr);
    const price = Number(priceStr);
    const fee = feeStr && feeStr.trim() !== "" ? Number(feeStr) : 0;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      errors.push(`${lineNo}줄: 날짜 형식 오류(YYYY-MM-DD)`);
      return;
    }
    if (!market_kind) {
      errors.push(`${lineNo}줄: 구분은 "국내" 또는 "미국"`);
      return;
    }
    if (!name || !name.trim()) {
      errors.push(`${lineNo}줄: 종목명 없음`);
      return;
    }
    if (!trade_kind) {
      errors.push(`${lineNo}줄: 매수/매도는 "매수" 또는 "매도"`);
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.push(`${lineNo}줄: 수량 오류`);
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      errors.push(`${lineNo}줄: 단가 오류`);
      return;
    }

    transactions.push({
      trade_id: makeId(),
      trade_date: date.trim(),
      market_kind,
      stock_name: name.trim(),
      trade_kind,
      trade_quantity: qty,
      unit_price: price,
      trade_fee: Number.isFinite(fee) ? fee : 0,
      sequence_no: Date.now() + added,
    });

    if (symbol && symbol.trim()) {
      symbols[holdingKey(market_kind, name.trim())] = symbol.trim();
    }
    added++;
  });

  saveTransactions(transactions);
  saveSymbols(symbols);
  render();
  autoFillExchanges();

  const summary =
    `${added}줄 가져옴` +
    (errors.length > 0
      ? ` · ${errors.length}줄 건너뜀 (${errors.slice(0, 5).join(", ")}${errors.length > 5 ? " 외" : ""})`
      : "");
  setCsvStatus(summary);
}

// 배당내역 CSV 가져오기: 줄 단위로 검증하고, 이미 같은 날짜·구분·종목명·금액이 있으면 건너뛴다.
async function handleDividendCsvImportFile(file) {
  const BOM = String.fromCharCode(0xfeff);
  const text = (await file.text()).replace(new RegExp("^" + BOM), ""); // 엑셀이 붙이는 UTF-8 BOM 제거
  const rows = parseCsv(text);
  if (rows.length <= 1) {
    setDividendCsvStatus("가져올 내용이 없습니다 (빈 파일이거나 머리글만 있음).");
    return;
  }

  const marketFromLabel = { 국내: "kr", 미국: "us" };
  const dividends = loadDividends();
  const existing = new Set(
    dividends.map((d) => [d.dividend_date, d.market_kind, d.stock_name, Number(d.dividend_amount)].join("|"))
  );
  let added = 0;
  let skippedSame = 0;
  const errors = [];

  rows.slice(1).forEach((cols, idx) => {
    const lineNo = idx + 2; // 머리글 포함 실제 줄 번호
    if (cols.every((c) => c.trim() === "")) return; // 빈 줄은 조용히 건너뜀

    const [date, marketLabel, name, amountStr, krwStr, rateStr, rateDateStr] = cols;
    const market_kind = marketFromLabel[(marketLabel || "").trim()];
    const amount = Number(amountStr);
    const hasKrw = (krwStr || "").trim() !== "";
    const hasRate = (rateStr || "").trim() !== "";
    const hasRateDate = (rateDateStr || "").trim() !== "";

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      errors.push(`${lineNo}줄: 날짜 형식 오류(YYYY-MM-DD)`);
      return;
    }
    if (!market_kind) {
      errors.push(`${lineNo}줄: 구분은 "국내" 또는 "미국"`);
      return;
    }
    if (!name || !name.trim()) {
      errors.push(`${lineNo}줄: 종목명 없음`);
      return;
    }
    if (!amountStr || amountStr.trim() === "" || !Number.isFinite(amount) || amount < 0) {
      errors.push(`${lineNo}줄: 배당금액 오류`);
      return;
    }

    if (hasKrw !== hasRate) {
      errors.push(`${lineNo}줄: 원화금액과 환율은 둘 다 쓰거나 둘 다 비워야 함`);
      return;
    }
    const krw = Number(krwStr);
    const rate = Number(rateStr);
    if (hasKrw && (market_kind !== "us" || !Number.isFinite(krw) || krw <= 0 || !Number.isFinite(rate) || rate <= 0)) {
      errors.push(`${lineNo}줄: 원화금액·환율은 미국 배당에만, 0보다 큰 숫자로`);
      return;
    }

    if (hasRateDate && (!hasRate || !/^\d{4}-\d{2}-\d{2}$/.test(rateDateStr.trim()))) {
      errors.push(`${lineNo}줄: 환율기준일은 환율과 함께 YYYY-MM-DD 형식으로`);
      return;
    }

    const key = [date.trim(), market_kind, name.trim(), amount].join("|");
    if (existing.has(key)) {
      skippedSame++;
      return;
    }

    const newDividend = {
      dividend_id: makeId(),
      dividend_date: date.trim(),
      market_kind,
      stock_name: name.trim(),
      dividend_amount: amount,
      sequence_no: Date.now() + added,
    };
    if (hasKrw) {
      newDividend.dividend_amount_krw = krw;
      newDividend.krw_per_usd = rate;
      if (hasRateDate) newDividend.krw_per_usd_date = rateDateStr.trim();
    }
    dividends.push(newDividend);
    added++;
  });

  saveDividends(dividends);
  renderDividends(loadDividends());

  const summary =
    `${added}줄 가져옴` +
    (skippedSame > 0 ? ` · 이미 있는 ${skippedSame}줄 건너뜀` : "") +
    (errors.length > 0
      ? ` · ${errors.length}줄 오류로 건너뜀 (${errors.slice(0, 5).join(", ")}${errors.length > 5 ? " 외" : ""})`
      : "");
  setDividendCsvStatus(summary);
}

// ===== 종목정보 CSV (구분,종목명,섹터,거래소) =====
function setStockInfoCsvStatus(text) {
  const el = document.getElementById("stock-info-csv-status");
  if (el) el.textContent = text;
}

function buildStockInfoCsv(info, holdings) {
  const keys = new Set([...Object.keys(info), ...holdings.map((h) => holdingKey(h.market_kind, h.stock_name))]);
  const rows = [...keys].map((key) => {
    const { market_kind, stock_name } = splitHoldingKey(key);
    const meta = info[key] || {};
    return [MARKET_LABEL[market_kind] || "", stock_name, meta.sector_name || "", EXCHANGE_LABEL[meta.exchange_kind] || ""];
  });
  rows.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1], "ko") : a[0] === "국내" ? -1 : 1));
  return [["구분", "종목명", "섹터", "거래소"], ...rows].map((cols) => cols.map(csvEscape).join(",")).join("\r\n");
}

// 종목정보 CSV 가져오기: 줄 단위로 검사하고, 비어 있는 칸은 기존 값을 지우지 않는다.
async function handleStockInfoCsvImportFile(file) {
  const BOM = String.fromCharCode(0xfeff);
  const text = (await file.text()).replace(new RegExp("^" + BOM), "");
  const rows = parseCsv(text);
  if (rows.length <= 1) {
    setStockInfoCsvStatus("가져올 내용이 없습니다 (빈 파일이거나 머리글만 있음).");
    return;
  }
  const marketFromLabel = { 국내: "kr", 미국: "us" };
  const exchangeFromLabel = Object.fromEntries(Object.entries(EXCHANGE_LABEL).map(([k, v]) => [v, k]));
  let applied = 0;
  const errors = [];
  rows.slice(1).forEach((cols, idx) => {
    const lineNo = idx + 2;
    if (cols.every((c) => c.trim() === "")) return;
    const [marketLabel, name, sector, exchangeLabel] = cols.map((c) => (c || "").trim());
    const market_kind = marketFromLabel[marketLabel];
    if (!market_kind) {
      errors.push(`${lineNo}줄: 구분은 "국내" 또는 "미국"`);
      return;
    }
    if (!name) {
      errors.push(`${lineNo}줄: 종목명 없음`);
      return;
    }
    if (exchangeLabel && !exchangeFromLabel[exchangeLabel]) {
      errors.push(`${lineNo}줄: 거래소는 ${Object.values(EXCHANGE_LABEL).join("/")} 중 하나`);
      return;
    }
    updateStockInfo(holdingKey(market_kind, name), {
      sector_name: sector || undefined,
      exchange_kind: exchangeLabel ? exchangeFromLabel[exchangeLabel] : undefined,
    });
    applied++;
  });
  render();
  setStockInfoCsvStatus(
    `${applied}줄 적용` + (errors.length > 0 ? ` · ${errors.length}줄 건너뜀 (${errors.slice(0, 5).join(", ")}${errors.length > 5 ? " 외" : ""})` : "")
  );
}

function collectBackupData() {
  return {
    backup_app_name: "주식현황관리",
    exported_at: new Date().toISOString(),
    backup_version: BACKUP_VERSION,
    trade_list: loadTransactions(),
    current_price_map: loadPrices(),
    symbol_code_map: loadSymbols(),
    price_history_map: loadPriceHistory(),
    dividend_list: loadDividends(),
    stock_info_map: loadStockInfo(),
    alert_rule_map: loadAlertRules(),
    alert_settings: loadAlertSettings(),
    signal_state_map: loadSignalMap(),
    signal_settings: loadSignalSettings(),
    us_price_api_key: loadApiKey(),
    kr_price_api_key: loadKrApiKey(),
  };
}

function exportJsonBackup() {
  const data = collectBackupData();
  downloadTextFile(`주식현황_백업_${todayISO()}.json`, JSON.stringify(data, null, 2), "application/json");
}

async function handleJsonImportFile(file) {
  let raw;
  try {
    raw = JSON.parse(await file.text());
  } catch (e) {
    setJsonStatus("JSON 파일을 읽을 수 없습니다.");
    return;
  }
  if (!raw || typeof raw !== "object") {
    setJsonStatus("올바른 백업 파일이 아닙니다.");
    return;
  }
  // 옛 백업(v1)이든 새 백업(v2)이든 v2 형식으로 맞춰서 가져온다.
  const data = convertBackup(raw);
  if (!window.confirm("지금 폰에 있는 데이터를 이 백업 파일 내용으로 덮어씁니다. 계속할까요?")) {
    return;
  }

  if (Array.isArray(data.trade_list)) saveTransactions(data.trade_list);
  if (data.current_price_map && typeof data.current_price_map === "object") savePrices(data.current_price_map);
  if (data.symbol_code_map && typeof data.symbol_code_map === "object") saveSymbols(data.symbol_code_map);
  if (data.price_history_map && typeof data.price_history_map === "object") savePriceHistory(data.price_history_map);
  if (Array.isArray(data.dividend_list)) saveDividends(data.dividend_list);
  if (data.stock_info_map && typeof data.stock_info_map === "object") saveStockInfo(data.stock_info_map);
  if (data.alert_rule_map && typeof data.alert_rule_map === "object") saveAlertRules(data.alert_rule_map);
  if (data.alert_settings && typeof data.alert_settings === "object") saveAlertSettings(data.alert_settings);
  if (data.signal_state_map && typeof data.signal_state_map === "object") saveSignalMap(data.signal_state_map);
  if (data.signal_settings && typeof data.signal_settings === "object") saveSignalSettings(data.signal_settings);
  if (typeof data.us_price_api_key === "string") saveApiKey(data.us_price_api_key);
  if (typeof data.kr_price_api_key === "string") saveKrApiKey(data.kr_price_api_key);

  document.getElementById("api-key-input").value = loadApiKey();
  document.getElementById("kr-api-key-input").value = loadKrApiKey();
  renderAlertSettings();
  renderSignalSettings();

  render();
  setJsonStatus("백업을 불러왔습니다.");
}

function setupDataManagement() {
  document.getElementById("export-csv-btn").addEventListener("click", () => {
    const csv = buildTransactionsCsv(loadTransactions(), loadSymbols());
    downloadTextFile(`거래내역_${todayISO()}.csv`, String.fromCharCode(0xfeff) + csv, "text/csv;charset=utf-8");
    setCsvStatus("거래내역 CSV 파일을 내보냈습니다.");
  });

  const csvFileInput = document.getElementById("import-csv-file");
  document.getElementById("import-csv-btn").addEventListener("click", () => csvFileInput.click());
  csvFileInput.addEventListener("change", async () => {
    const file = csvFileInput.files[0];
    if (!file) return;
    await handleCsvImportFile(file);
    csvFileInput.value = "";
  });

  document.getElementById("export-dividend-csv-btn").addEventListener("click", () => {
    const csv = buildDividendsCsv(loadDividends());
    downloadTextFile(`배당내역_${todayISO()}.csv`, String.fromCharCode(0xfeff) + csv, "text/csv;charset=utf-8");
    setDividendCsvStatus("배당내역 CSV 파일을 내보냈습니다.");
  });

  const dividendCsvFileInput = document.getElementById("import-dividend-csv-file");
  document.getElementById("import-dividend-csv-btn").addEventListener("click", () => dividendCsvFileInput.click());
  dividendCsvFileInput.addEventListener("change", async () => {
    const file = dividendCsvFileInput.files[0];
    if (!file) return;
    await handleDividendCsvImportFile(file);
    dividendCsvFileInput.value = "";
  });

  document.getElementById("export-stock-info-csv-btn").addEventListener("click", () => {
    const csv = buildStockInfoCsv(loadStockInfo(), computeHoldings(loadTransactions()));
    downloadTextFile(`종목정보_${todayISO()}.csv`, String.fromCharCode(0xfeff) + csv, "text/csv;charset=utf-8");
    setStockInfoCsvStatus("종목정보 CSV 파일을 내보냈습니다.");
  });

  const stockInfoFileInput = document.getElementById("import-stock-info-csv-file");
  document.getElementById("import-stock-info-csv-btn").addEventListener("click", () => stockInfoFileInput.click());
  stockInfoFileInput.addEventListener("change", async () => {
    const file = stockInfoFileInput.files[0];
    if (!file) return;
    await handleStockInfoCsvImportFile(file);
    stockInfoFileInput.value = "";
  });

  document.getElementById("export-json-btn").addEventListener("click", () => {
    exportJsonBackup();
    setJsonStatus("백업 파일을 내보냈습니다.");
  });

  const jsonFileInput = document.getElementById("import-json-file");
  document.getElementById("import-json-btn").addEventListener("click", () => jsonFileInput.click());
  jsonFileInput.addEventListener("change", async () => {
    const file = jsonFileInput.files[0];
    if (!file) return;
    await handleJsonImportFile(file);
    jsonFileInput.value = "";
  });
}

// ===== 화면 틀 (design/02_화면구조.md) =====
// 화면 목록 SCREENS 가 유일한 원본이다. 아래쪽 탭과 '더보기' 메뉴는 이 목록으로 자동으로 만들어진다.
// 새 기능: ① index.html 에 <section class="screen" data-screen="새id" hidden> 를 만들고
//          ② SCREENS 에 한 줄을 추가한다. (기본은 '더보기'에 나타남. pinned: true 로 올리면 탭 후보)
const MAX_TAB_SLOTS = 4; // 아래쪽 탭 칸 수('더보기' 포함). 탭 후보는 앞에서부터 MAX_TAB_SLOTS - 1 개만 탭이 된다.
const MORE_SCREEN_ID = "more";
const LAST_SCREEN_KEY = "stockLastScreen_v1";
const SCREENS = [
  { id: "home", label: "현황", icon: "📊", pinned: true },
  { id: "holdings", label: "보유", icon: "💼", pinned: true },
  { id: "trades", label: "거래", icon: "🧾", pinned: true },
  { id: "dividends", label: "배당 기록", icon: "💰" },
  { id: "data", label: "데이터 관리", icon: "💾" },
  { id: "settings", label: "설정", icon: "⚙️" },
  { id: "glossary", label: "용어집", icon: "📖" },
];

function getTabScreens() {
  return SCREENS.filter((s) => s.pinned).slice(0, MAX_TAB_SLOTS - 1);
}

function getMoreScreens() {
  const tabIds = new Set(getTabScreens().map((s) => s.id));
  return SCREENS.filter((s) => !tabIds.has(s.id));
}

function currentScreenId() {
  const el = [...document.querySelectorAll(".screen")].find((x) => !x.hidden);
  return el ? el.dataset.screen : null;
}

// 탭 바와 더보기 목록을 SCREENS 로 다시 만든다.
function renderNavigation() {
  const tabs = getTabScreens();
  const tabHtml = tabs
    .map(
      (s) => `<button type="button" class="tab-btn" data-screen-go="${s.id}" data-tab="${s.id}">
        <span class="tab-icon">${s.icon}</span><span>${s.label}</span></button>`
    )
    .join("");
  document.getElementById("tab-bar").innerHTML =
    tabHtml +
    `<button type="button" class="tab-btn" data-screen-go="${MORE_SCREEN_ID}" data-tab="${MORE_SCREEN_ID}">
      <span class="tab-icon">☰</span><span>더보기</span></button>`;

  document.getElementById("more-list").innerHTML = getMoreScreens()
    .map(
      (s) => `<li><button type="button" class="menu-item" data-screen-go="${s.id}">
        <span>${s.icon}</span><span>${s.label}</span><span class="menu-arrow">›</span></button></li>`
    )
    .join("");
}

function showScreen(id, options = {}) {
  const { push = true } = options;
  const known = id === MORE_SCREEN_ID || SCREENS.some((s) => s.id === id);
  if (!known) id = SCREENS[0].id; // 알 수 없는 화면은 첫 화면으로

  document.querySelectorAll(".screen").forEach((el) => {
    el.hidden = el.dataset.screen !== id;
  });
  const screen = SCREENS.find((s) => s.id === id);
  document.getElementById("screen-title").textContent = id === MORE_SCREEN_ID ? "더보기" : screen.label;

  const tabIds = getTabScreens().map((s) => s.id);
  const activeTab = tabIds.includes(id) ? id : MORE_SCREEN_ID; // 탭에 없는 화면이면 '더보기' 탭을 선택 상태로
  document.querySelectorAll("#tab-bar .tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === activeTab);
  });

  document.getElementById("screen-area").scrollTop = 0;
  if (id === "settings" || id === MORE_SCREEN_ID) renderVersionInfo();
  try {
    localStorage.setItem(LAST_SCREEN_KEY, id);
  } catch (e) {
    // 저장소를 못 쓰는 환경이면 기억만 건너뛴다
  }
  if (push && location.hash !== "#" + id) {
    history.pushState({ screen: id }, "", "#" + id);
  }
}

function setupNavigation() {
  renderNavigation();

  document.addEventListener("click", (event) => {
    const go = event.target.closest("[data-screen-go]");
    if (go) showScreen(go.dataset.screenGo);
  });
  // 폰의 뒤로가기: 앱이 꺼지지 않고 이전 화면으로 돌아간다.
  window.addEventListener("popstate", () => {
    showScreen(location.hash.slice(1), { push: false });
  });

  let first = location.hash.slice(1); // 주소가 우선, 없으면 마지막으로 본 화면
  if (!first) {
    try {
      first = localStorage.getItem(LAST_SCREEN_KEY) || "";
    } catch (e) {
      first = "";
    }
  }
  showScreen(first, { push: false });
  history.replaceState({ screen: currentScreenId() }, "", "#" + currentScreenId());
}

// 앱 버전과 오프라인 저장본(서비스 워커 캐시)의 버전을 화면에 보여 준다.
// 둘이 다르면 옛 저장본이 남아 있다는 뜻이라 앱을 닫았다가 다시 열라고 안내한다.
async function renderVersionInfo() {
  document.querySelectorAll(".app-version-text").forEach((el) => {
    el.textContent = `앱 버전 ${APP_VERSION} (${APP_BUILD_DATE})`;
  });
  const el = document.getElementById("app-cache-text");
  if (!el) return;
  const prefix = "stock-app-cache-";
  if (!("caches" in window)) {
    el.textContent = "오프라인 저장본: 이 주소(http)에서는 쓸 수 없습니다. https 주소나 localhost에서만 저장됩니다.";
    return;
  }
  let keys = [];
  try {
    keys = (await caches.keys()).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
  } catch (e) {
    el.textContent = "오프라인 저장본: 확인하지 못했습니다.";
    return;
  }
  if (keys.length === 0) {
    el.textContent = "오프라인 저장본: 아직 없음 (앱을 한 번 더 열면 저장됩니다)";
  } else if (keys.length === 1 && keys[0] === APP_VERSION) {
    el.textContent = `오프라인 저장본: ${APP_VERSION} (최신)`;
  } else {
    el.textContent = `오프라인 저장본: ${keys.join(", ")} — 앱 버전과 다릅니다. 앱을 닫았다가 다시 열어 주세요.`;
  }
}

// 구분 버튼(.seg): 같은 카드 안의 .seg-panel 중 선택한 것만 보인다.
function setupSegments() {
  document.querySelectorAll(".seg").forEach((seg) => {
    seg.addEventListener("click", (event) => {
      const btn = event.target.closest(".seg-btn");
      if (!btn) return;
      seg.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
      seg.parentElement.querySelectorAll(":scope > .seg-panel").forEach((panel) => {
        panel.hidden = panel.id !== btn.dataset.segTarget;
      });
    });
  });
}

// '＋ 추가' 패널(details.add-panel): 양식이 "saved" 이벤트를 보내면(저장 성공) 접는다.
// 검증 실패나 환율 조회 실패 때는 패널을 열어 둬서 안내 메시지와 입력칸이 보이게 한다.
function setupAddPanels() {
  document.querySelectorAll("details.add-panel form").forEach((form) => {
    form.addEventListener("saved", () => {
      form.closest("details").open = false;
    });
  });
}

migrateLegacyDataIfNeeded();
migrateOldHoldingsIfNeeded();
setupSettings();
setupForm();
setupHoldingsActions();
setupAlertActions();
setupAlertSettings();
setupSignalActions();
setupSignalSettings();
setupGlossary();
setupRefreshAll();
setupBulkSymbols();
setupHoldingsView();
setupAutoFill();
setupBackfill();
setupFxActions();
setTimeout(ensureFxRate, 1500); // 앱을 연 직후 화면이 자리 잡은 다음 환율을 확인
setupTransactionActions();
setupDividendForm();
setupDividendActions();
setupDataManagement();
render();
setupSegments();
setupAddPanels();
setupNavigation();

// 서비스 워커 등록 (Sprint 0부터 유지)
// + 자동 업데이트: 앱을 열 때마다 새 버전이 있는지 확인하고, 새 버전이 설치되면
// (service-worker.js의 skipWaiting+clients.claim 덕분에 자동으로 활성화됨)
// 화면을 한 번 새로고침해서 바로 반영한다. 사용자가 따로 "업데이트" 버튼을
// 누를 필요가 없다.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .then((reg) => {
        console.log("서비스 워커 등록 성공:", reg.scope);
        reg.update(); // 앱을 열 때마다 새 버전이 있는지 즉시 확인
      })
      .catch((err) => {
        console.error("서비스 워커 등록 실패:", err);
      });
  });

  let hasReloadedForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hasReloadedForUpdate) return; // 새로고침 무한 반복 방지
    hasReloadedForUpdate = true;
    window.location.reload();
  });
}
