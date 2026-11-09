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
  };
}

// 국내: 공공데이터포털 금융위원회_주식시세정보 — 브라우저 직접 호출 허용.
// 실시간이 아니라 "직전 영업일 종가"(하루 지연)이므로 그렇게 표시해야 한다.
// 서비스키는 반드시 "일반 인증키(Decoding)"를 써야 한다 — URLSearchParams가
// 자동으로 다시 인코딩하므로 Encoding 키를 쓰면 이중 인코딩으로 깨진다.
// 공공데이터포털 주식시세정보 호출 공통 함수(시세 조회와 코드 찾기가 같이 쓴다).
// query 에 종목코드(likeSrtnCd)나 종목명(itmsNm, likeItmsNm) 조건을 넘긴다. 영업일을 모를 수 있어 9일 전부터 조회한다.
async function fetchDataGoKrItems(apiKey, query, numOfRows, failMessage) {
  const pad = (n) => String(n).padStart(2, "0");
  const toBasDt = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const end = new Date();
  const begin = new Date(end.getTime() - 9 * 24 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    serviceKey: apiKey,
    resultType: "json",
    numOfRows: String(numOfRows),
    pageNo: "1",
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
  return { symbol_code: best.srtnCd, matched_name: best.itmsNm, exact: Boolean(exact), candidate_list };
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
  return { symbol_code: best.symbol, matched_name: best.instrument_name || best.symbol, exact, candidate_list };
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
    const { current_price, price_date, open_price, high_price, low_price, trade_volume } = await fetchCurrentPrice(
      marketKind,
      symbol
    );
    const prices = loadPrices();
    prices[key] = current_price;
    savePrices(prices);
    appendPriceHistory(key, price_date, { open_price, high_price, low_price, close_price: current_price, trade_volume });
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
    ? `<div class="stat-grid">${tilesHtml}</div>`
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

  area.innerHTML =
    blocksHtml || '<p class="empty-message">아직 보유 중인 종목이 없습니다.</p>';
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

function renderHoldings(holdings, prices, symbols) {
  const holdingsArea = document.getElementById("holdings-area");

  if (holdings.length === 0) {
    holdingsArea.innerHTML =
      '<p class="empty-message">아직 보유 중인 종목이 없습니다.</p>';
    return;
  }

  const marketLabel = MARKET_LABEL;
  const symbolPlaceholder = { kr: "예: 005930", us: "예: AAPL" };

  holdingsArea.innerHTML = holdings
    .map((h) => {
      const key = holdingKey(h.market_kind, h.stock_name);
      const currentPrice = prices[key] || 0;
      const symbol = symbols[key] || "";
      const { evaluation_amount, profit_amount, profit_rate } = calc(h, currentPrice);

      return `
        <div class="holding-item" data-key="${key}">
          <div class="holding-item-top">
            <span>
              <span class="holding-item-name">${h.stock_name}</span>
              <span class="holding-item-market">${marketLabel[h.market_kind]}</span>
            </span>
          </div>
          <div class="holding-item-detail">
            <span>수량 ${formatQty(h.holding_quantity)} · 평균단가 ${formatMoney(h.average_price, h.market_kind)}</span>
          </div>
          <div class="holding-item-symbol-row">
            <span>시세 코드</span>
            <div class="symbol-input-group">
              <input
                class="symbol-input"
                type="text"
                data-action="symbol-input"
                data-key="${key}"
                value="${symbol}"
                placeholder="${symbolPlaceholder[h.market_kind]}"
              />
              <button type="button" class="fetch-btn" data-action="lookup-symbol" data-key="${key}">코드찾기</button>
              <button type="button" class="fetch-btn" data-action="fetch-price" data-key="${key}">조회</button>
            </div>
          </div>
          <div class="holding-item-price-row">
            <span>현재가</span>
            <input
              class="price-input"
              type="number"
              step="any"
              min="0"
              data-action="price-input"
              data-key="${key}"
              value="${currentPrice || ""}"
            />
          </div>
          <div class="holding-item-detail">
            <span>평가금액 ${formatMoney(evaluation_amount, h.market_kind)}</span>
            <span class="${profitClass(profit_amount)}">${formatMoney(profit_amount, h.market_kind)} (${formatPercent(profit_rate)})</span>
          </div>
        </div>
      `;
    })
    .join("");
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

function render() {
  const transactions = loadTransactions();
  const prices = loadPrices();
  const symbols = loadSymbols();
  const holdings = computeHoldings(transactions);

  renderDashboard(holdings, prices);
  renderShare(holdings, prices);
  renderRank(holdings, prices);
  renderHoldings(holdings, prices, symbols);
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
        const symbol = await lookupSymbol(market_kind, stock_name);
        const symbols = loadSymbols();
        symbols[key] = symbol;
        saveSymbols(symbols);
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
  if (typeof data.us_price_api_key === "string") saveApiKey(data.us_price_api_key);
  if (typeof data.kr_price_api_key === "string") saveKrApiKey(data.kr_price_api_key);

  document.getElementById("api-key-input").value = loadApiKey();
  document.getElementById("kr-api-key-input").value = loadKrApiKey();

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
setupRefreshAll();
setupBulkSymbols();
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
