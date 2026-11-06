// Sprint 2: 매수/매도 거래내역을 입력하면 보유수량·평균단가를 자동 계산한다.
// 데이터는 폰(브라우저) 안의 localStorage에만 저장된다. 서버로 전송하지 않음.

const TX_KEY = "stockTransactions_v1";
const PRICES_KEY = "stockCurrentPrices_v1";
const SYMBOLS_KEY = "stockSymbols_v1"; // key: "market|name" -> 시세 조회용 코드(종목코드/티커)
const API_KEY_KEY = "stockApiKey_v1"; // Twelve Data (미국)
const KR_API_KEY_KEY = "stockKrApiKey_v1"; // 공공데이터포털 (국내)
const PRICE_HISTORY_KEY = "stockPriceHistory_v1"; // 자동조회 결과를 날짜별로 누적(추후 추세 분석용)
const DIVIDENDS_KEY = "stockDividends_v1";
const OLD_HOLDINGS_KEY = "stockHoldings_v1"; // Sprint 1에서 쓰던 저장 키 (이전용)

/** @typedef {{id:string, date:string, market:'KR'|'US', name:string, type:'BUY'|'SELL', qty:number, price:number, fee:number, seq:number}} Transaction */

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

function holdingKey(market, name) {
  return `${market}|${name}`;
}

// --- 저장소 ---

/** @returns {Transaction[]} */
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

/** @param {Transaction[]} transactions */
function saveTransactions(transactions) {
  localStorage.setItem(TX_KEY, JSON.stringify(transactions));
}

/** @returns {Record<string, number>} key: "market|name" -> 현재가 */
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

/** @returns {Record<string, string>} key: "market|name" -> 시세 조회 코드 */
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

/** @returns {Record<string, {date:string, open:number, high:number, low:number, close:number, volume:number}[]>} key: "market|name" -> 날짜순 가격 기록 */
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
// ohlcv: {open, high, low, close, volume} — 종가뿐 아니라 시가·고가·저가·거래량도
// 같이 남겨야 추세/변동성 분석에 쓸 수 있다.
function appendPriceHistory(key, dateStr, ohlcv) {
  const history = loadPriceHistory();
  const list = history[key] || [];
  const entry = { date: dateStr, ...ohlcv };
  const idx = list.findIndex((e) => e.date === dateStr);
  if (idx >= 0) {
    list[idx] = entry;
  } else {
    list.push(entry);
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  history[key] = list;
  savePriceHistory(history);
}

/** @typedef {{id:string, date:string, market:'KR'|'US', name:string, amount:number, seq:number}} Dividend */

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

// Sprint 1에서 입력해둔 종목이 있으면, 한 번만 거래내역(최초 매수)으로 변환해 이어서 쓴다.
function migrateOldHoldingsIfNeeded() {
  if (localStorage.getItem(TX_KEY) !== null) return; // 이미 마이그레이션 했음

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
    id: makeId(),
    date: todayISO(),
    market: h.market,
    name: h.name,
    type: "BUY",
    qty: Number(h.qty) || 0,
    price: Number(h.avgPrice) || 0,
    fee: 0,
    seq: Date.now() + i,
  }));

  const prices = loadPrices();
  oldHoldings.forEach((h) => {
    prices[holdingKey(h.market, h.name)] = Number(h.curPrice) || 0;
  });

  saveTransactions(transactions);
  savePrices(prices);
}

// --- 계산 ---

// 거래내역으로부터 종목별 보유수량·평균단가를 계산한다.
// 매수: 가중평균으로 평균단가 재계산. 매도: 수량만 줄이고 평균단가는 유지.
function computeHoldings(transactions) {
  const sorted = [...transactions].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.seq - b.seq;
  });

  const groups = new Map();

  for (const tx of sorted) {
    const key = holdingKey(tx.market, tx.name);
    if (!groups.has(key)) {
      groups.set(key, { market: tx.market, name: tx.name, qty: 0, avgPrice: 0 });
    }
    const g = groups.get(key);

    if (tx.type === "BUY") {
      const costBefore = g.qty * g.avgPrice;
      const costAdded = tx.qty * tx.price + (tx.fee || 0);
      const newQty = g.qty + tx.qty;
      g.avgPrice = newQty === 0 ? 0 : (costBefore + costAdded) / newQty;
      g.qty = newQty;
    } else {
      g.qty = g.qty - tx.qty;
    }
  }

  return [...groups.values()].filter((g) => g.qty > 1e-9);
}

/** @param {{qty:number, avgPrice:number}} h @param {number} curPrice */
function calc(h, curPrice) {
  const buyAmount = h.qty * h.avgPrice;
  const evalAmount = h.qty * curPrice;
  const profit = evalAmount - buyAmount;
  const profitRate = buyAmount === 0 ? 0 : (profit / buyAmount) * 100;
  return { buyAmount, evalAmount, profit, profitRate };
}

// --- 시세 자동 조회 ---
// 시장별 조회 소스를 각각 함수 하나에 모아둔다. 나중에 다른 소스(Plan B)로
// 바꾸고 싶으면 fetchCurrentPrice()의 분기와 해당 provider 함수만 고치면 된다.
// (조사 결과: 야후 파이낸스·네이버 금융·Stooq·공용 CORS 프록시는 브라우저
//  직접 호출이 막히거나 무가입으로는 못 쓴다.)

// 미국: Twelve Data — 브라우저 직접 호출 허용, 거의 실시간가.
// /quote 엔드포인트를 쓰면 현재가(close)뿐 아니라 시가·고가·저가·거래량도
// 같은 호출 한 번으로 받을 수 있다(트렌드 분석용 히스토리에 함께 저장).
async function fetchPriceTwelveData(apiKey, symbol) {
  const params = new URLSearchParams({ symbol, apikey: apiKey });
  const res = await fetch(`https://api.twelvedata.com/quote?${params.toString()}`);
  const data = await res.json();

  if (data.status === "error" || data.code) {
    throw new Error(data.message || "시세 조회에 실패했습니다.");
  }
  const price = Number(data.close);
  if (!Number.isFinite(price)) {
    throw new Error("가격 데이터를 이해할 수 없습니다.");
  }
  return {
    price,
    date: data.datetime || todayISO(),
    open: Number(data.open),
    high: Number(data.high),
    low: Number(data.low),
    volume: Number(data.volume),
  };
}

// 국내: 공공데이터포털 금융위원회_주식시세정보 — 브라우저 직접 호출 허용.
// 실시간이 아니라 "직전 영업일 종가"(하루 지연)이므로 그렇게 표시해야 한다.
// 서비스키는 반드시 "일반 인증키(Decoding)"를 써야 한다 — URLSearchParams가
// 자동으로 다시 인코딩하므로 Encoding 키를 쓰면 이중 인코딩으로 깨진다.
async function fetchPriceDataGoKr(apiKey, symbol) {
  const pad = (n) => String(n).padStart(2, "0");
  const toBasDt = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const end = new Date();
  const begin = new Date(end.getTime() - 9 * 24 * 60 * 60 * 1000); // 영업일 여유를 두고 9일 전부터

  const params = new URLSearchParams({
    serviceKey: apiKey,
    resultType: "json",
    numOfRows: "10",
    pageNo: "1",
    likeSrtnCd: symbol, // 주의: "srtnCd"는 이 API에서 조용히 무시되고 전체 목록이 돌아옴(실측 확인)
    beginBasDt: toBasDt(begin),
    endBasDt: toBasDt(end),
  });

  const res = await fetch(
    `https://apis.data.go.kr/1160100/GetStockSecuritiesInfoService_V2/getStockPriceInfo_V2?${params.toString()}`
  );
  const data = await res.json();

  if (!data.response) {
    const msg = data?.OpenAPI_ServiceResponse?.cmmMsgHeader?.returnAuthMsg;
    throw new Error(msg || "시세 조회에 실패했습니다.");
  }

  const items = data.response?.body?.items?.item;
  const list = Array.isArray(items) ? items : items ? [items] : [];
  if (list.length === 0) {
    throw new Error("해당 종목코드의 시세 데이터가 없습니다.");
  }

  const latest = list.reduce((a, b) => (b.basDt > a.basDt ? b : a));
  const price = Number(latest.clpr);
  if (!Number.isFinite(price)) {
    throw new Error("가격 데이터를 이해할 수 없습니다.");
  }

  const basDt = latest.basDt;
  const date = `${basDt.slice(0, 4)}-${basDt.slice(4, 6)}-${basDt.slice(6, 8)}`;
  return {
    price,
    date,
    open: Number(latest.mkp),
    high: Number(latest.hipr),
    low: Number(latest.lopr),
    volume: Number(latest.trqu),
  };
}

async function fetchCurrentPrice(market, symbol) {
  if (market === "KR") {
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
  const pad = (n) => String(n).padStart(2, "0");
  const toBasDt = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const end = new Date();
  const begin = new Date(end.getTime() - 9 * 24 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    serviceKey: apiKey,
    resultType: "json",
    numOfRows: "20",
    pageNo: "1",
    itmsNm: name,
    beginBasDt: toBasDt(begin),
    endBasDt: toBasDt(end),
  });

  const res = await fetch(
    `https://apis.data.go.kr/1160100/GetStockSecuritiesInfoService_V2/getStockPriceInfo_V2?${params.toString()}`
  );
  const data = await res.json();

  if (!data.response) {
    const msg = data?.OpenAPI_ServiceResponse?.cmmMsgHeader?.returnAuthMsg;
    throw new Error(msg || "종목코드 검색에 실패했습니다.");
  }

  const items = data.response?.body?.items?.item;
  const list = Array.isArray(items) ? items : items ? [items] : [];
  if (list.length === 0) {
    throw new Error("이름으로 찾은 종목이 없습니다.");
  }

  const exact = list.find((item) => item.itmsNm === name);
  return (exact || list[0]).srtnCd;
}

// 미국: Twelve Data symbol_search — 결과가 여러 거래소/ETF/워런트 섞여 나오므로
// 일반 보통주(Common Stock) + 미국 거래소를 우선으로 고른다.
async function lookupSymbolUs(apiKey, name) {
  const params = new URLSearchParams({ symbol: name, apikey: apiKey });
  const res = await fetch(`https://api.twelvedata.com/symbol_search?${params.toString()}`);
  const data = await res.json();

  if (data.status === "error" || data.code) {
    throw new Error(data.message || "종목코드 검색에 실패했습니다.");
  }
  const list = Array.isArray(data.data) ? data.data : [];
  if (list.length === 0) {
    throw new Error("이름으로 찾은 종목이 없습니다.");
  }

  const usExchanges = ["NASDAQ", "NYSE", "AMEX"];
  const best =
    list.find((d) => usExchanges.includes(d.exchange) && d.instrument_type === "Common Stock") ||
    list.find((d) => usExchanges.includes(d.exchange)) ||
    list[0];
  return best.symbol;
}

async function lookupSymbol(market, name) {
  if (market === "KR") {
    const apiKey = loadKrApiKey();
    if (!apiKey) throw new Error("공공데이터포털 API 키가 설정에 없습니다");
    return lookupSymbolKr(apiKey, name);
  }
  const apiKey = loadApiKey();
  if (!apiKey) throw new Error("Twelve Data API 키가 설정에 없습니다");
  return lookupSymbolUs(apiKey, name);
}

/** 종목 하나의 현재가를 조회해 저장하고, 날짜별 히스토리에도 남긴다. */
async function fetchAndUpdatePrice(market, name) {
  const key = holdingKey(market, name);
  const symbol = loadSymbols()[key];

  if (!symbol) return { ok: false, message: "시세 코드가 없습니다" };

  try {
    const { price, date, open, high, low, volume } = await fetchCurrentPrice(market, symbol);
    const prices = loadPrices();
    prices[key] = price;
    savePrices(prices);
    appendPriceHistory(key, date, { open, high, low, close: price, volume });
    return { ok: true, price, date };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setFetchStatus(text) {
  const el = document.getElementById("fetch-status");
  if (el) el.textContent = text;
}

// --- 표시 형식 ---

function formatMoney(value, market) {
  if (market === "KR") {
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

function formatPercent(value) {
  const sign = value > 0 ? "+" : "";
  return sign + value.toFixed(2) + "%";
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
const MARKET_LABEL = { KR: "국내", US: "미국" };

// 대시보드: 시장별 평가금액(값)·손익(델타)을 스탯 타일로.
function renderDashboard(holdings, prices) {
  const area = document.getElementById("dashboard-area");
  const markets = ["KR", "US"];

  const tilesHtml = markets
    .map((market) => {
      const items = holdings.filter((h) => h.market === market);
      if (items.length === 0) return "";

      let totalBuy = 0;
      let totalEval = 0;
      items.forEach((h) => {
        const curPrice = prices[holdingKey(h.market, h.name)] || 0;
        const { buyAmount, evalAmount } = calc(h, curPrice);
        totalBuy += buyAmount;
        totalEval += evalAmount;
      });
      const totalProfit = totalEval - totalBuy;
      const totalRate = totalBuy === 0 ? 0 : (totalProfit / totalBuy) * 100;

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
  const markets = ["KR", "US"];

  const blocksHtml = markets
    .map((market) => {
      const items = holdings
        .filter((h) => h.market === market)
        .map((h) => {
          const curPrice = prices[holdingKey(h.market, h.name)] || 0;
          return { name: h.name, evalAmount: calc(h, curPrice).evalAmount };
        })
        .sort((a, b) => b.evalAmount - a.evalAmount);

      if (items.length === 0) return "";

      const total = items.reduce((sum, x) => sum + x.evalAmount, 0);
      const top = items.slice(0, SHARE_COLORS.length);
      const rest = items.slice(SHARE_COLORS.length);

      const slots = top.map((x, i) => ({ ...x, color: SHARE_COLORS[i] }));
      if (rest.length > 0) {
        slots.push({
          name: `기타 (${rest.length}종목)`,
          evalAmount: rest.reduce((sum, x) => sum + x.evalAmount, 0),
          color: SHARE_OTHER_COLOR,
        });
      }

      const segmentsHtml = slots
        .map((s) => {
          const pct = total === 0 ? 0 : (s.evalAmount / total) * 100;
          return `<div class="share-segment" style="width:${pct}%;background-color:${s.color}"></div>`;
        })
        .join("");

      const legendHtml = slots
        .map((s) => {
          const pct = total === 0 ? 0 : (s.evalAmount / total) * 100;
          return `
            <div class="legend-row">
              <span class="legend-swatch" style="background-color:${s.color}"></span>
              <span class="legend-name">${s.name}</span>
              <span class="legend-value">${pct.toFixed(1)}% · ${formatMoney(s.evalAmount, market)}</span>
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
      const curPrice = prices[holdingKey(h.market, h.name)] || 0;
      return { name: h.name, market: h.market, profitRate: calc(h, curPrice).profitRate };
    })
    .sort((a, b) => b.profitRate - a.profitRate);

  const maxAbs = Math.max(1e-9, ...rows.map((r) => Math.abs(r.profitRate)));

  area.innerHTML = rows
    .map((r, i) => {
      const widthPct = (Math.abs(r.profitRate) / maxAbs) * 100;
      const isPos = r.profitRate >= 0;
      const valueLabel = formatPercent(r.profitRate);

      const negSide = !isPos
        ? `<span class="rank-value">${valueLabel}</span><div class="rank-bar neg" style="width:${widthPct}%"></div>`
        : "";
      const posSide = isPos
        ? `<div class="rank-bar pos" style="width:${widthPct}%"></div><span class="rank-value">${valueLabel}</span>`
        : "";

      return `
        <div class="rank-row">
          <div class="rank-name">${i + 1}. ${r.name} <span class="rank-market">${MARKET_LABEL[r.market]}</span></div>
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

  const marketLabel = { KR: "국내", US: "미국" };
  const symbolPlaceholder = { KR: "예: 005930", US: "예: AAPL" };

  holdingsArea.innerHTML = holdings
    .map((h) => {
      const key = holdingKey(h.market, h.name);
      const curPrice = prices[key] || 0;
      const symbol = symbols[key] || "";
      const { evalAmount, profit, profitRate } = calc(h, curPrice);

      return `
        <div class="holding-item" data-key="${key}">
          <div class="holding-item-top">
            <span>
              <span class="holding-item-name">${h.name}</span>
              <span class="holding-item-market">${marketLabel[h.market]}</span>
            </span>
          </div>
          <div class="holding-item-detail">
            <span>수량 ${formatQty(h.qty)} · 평균단가 ${formatMoney(h.avgPrice, h.market)}</span>
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
                placeholder="${symbolPlaceholder[h.market]}"
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
              value="${curPrice || ""}"
            />
          </div>
          <div class="holding-item-detail">
            <span>평가금액 ${formatMoney(evalAmount, h.market)}</span>
            <span class="${profitClass(profit)}">${formatMoney(profit, h.market)} (${formatPercent(profitRate)})</span>
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

  const marketLabel = { KR: "국내", US: "미국" };
  const typeLabel = { BUY: "매수", SELL: "매도" };
  const typeClass = { BUY: "tx-type-buy", SELL: "tx-type-sell" };

  const sortedDesc = [...transactions].sort((a, b) => {
    if (a.date !== b.date) return a.date > b.date ? -1 : 1;
    return b.seq - a.seq;
  });

  txArea.innerHTML = sortedDesc
    .map((tx) => {
      return `
        <div class="tx-item" data-id="${tx.id}">
          <div class="tx-item-main">
            <span class="tx-item-date">${tx.date}</span>
            <span>
              <span class="${typeClass[tx.type]}">${typeLabel[tx.type]}</span>
              ${tx.name} (${marketLabel[tx.market]}) ·
              ${formatQty(tx.qty)}주 · ${formatMoney(tx.price, tx.market)}
              ${tx.fee ? ` · 수수료 ${formatMoney(tx.fee, tx.market)}` : ""}
            </span>
          </div>
          <button class="delete-btn" data-action="delete-tx">삭제</button>
        </div>
      `;
    })
    .join("");
}

function renderDividends(dividends) {
  const summaryArea = document.getElementById("dividend-summary");
  const listArea = document.getElementById("dividend-area");

  if (dividends.length === 0) {
    summaryArea.innerHTML = "";
    listArea.innerHTML = '<p class="empty-message">아직 입력한 배당 기록이 없습니다.</p>';
    return;
  }

  const markets = ["KR", "US"];
  summaryArea.innerHTML = markets
    .map((market) => {
      const items = dividends.filter((d) => d.market === market);
      if (items.length === 0) return "";
      const total = items.reduce((sum, d) => sum + d.amount, 0);
      return `
        <div class="summary-row">
          <span>${MARKET_LABEL[market]} 배당 합계</span>
          <span>${formatMoney(total, market)}</span>
        </div>
      `;
    })
    .join("");

  const sortedDesc = [...dividends].sort((a, b) => {
    if (a.date !== b.date) return a.date > b.date ? -1 : 1;
    return b.seq - a.seq;
  });

  listArea.innerHTML = sortedDesc
    .map(
      (d) => `
        <div class="tx-item" data-id="${d.id}">
          <div class="tx-item-main">
            <span class="tx-item-date">${d.date}</span>
            <span>${d.name} (${MARKET_LABEL[d.market]}) · ${formatMoney(d.amount, d.market)}</span>
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

function setupForm() {
  const form = document.getElementById("transaction-form");

  const dateInput = form.querySelector('input[name="date"]');
  dateInput.value = todayISO();

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const name = String(formData.get("name")).trim();
    if (!name) return;

    const newTx = {
      id: makeId(),
      date: String(formData.get("date")) || todayISO(),
      market: formData.get("market"),
      name,
      type: formData.get("type"),
      qty: Number(formData.get("qty")),
      price: Number(formData.get("price")),
      fee: Number(formData.get("fee")) || 0,
      seq: Date.now(),
    };

    const transactions = loadTransactions();
    transactions.push(newTx);
    saveTransactions(transactions);

    form.reset();
    dateInput.value = todayISO();
    render();
  });
}

// "market|name" 형태의 key를 market/name으로 되돌린다.
function splitHoldingKey(key) {
  const sep = key.indexOf("|");
  return { market: key.slice(0, sep), name: key.slice(sep + 1) };
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
      const { market, name } = splitHoldingKey(fetchBtn.dataset.key);
      setFetchStatus(`${name} 조회 중...`);
      const result = await fetchAndUpdatePrice(market, name);

      if (result.ok) {
        const dateNote = market === "KR" ? ` (${result.date} 종가)` : "";
        setFetchStatus(`${name} 현재가를 ${formatMoney(result.price, market)}로 갱신했습니다.${dateNote}`);
        render();
      } else {
        setFetchStatus(`${name} 조회 실패: ${result.message}`);
      }
      return;
    }

    const lookupBtn = event.target.closest('[data-action="lookup-symbol"]');
    if (lookupBtn) {
      const key = lookupBtn.dataset.key;
      const { market, name } = splitHoldingKey(key);
      setFetchStatus(`${name} 시세 코드 찾는 중...`);
      try {
        const symbol = await lookupSymbol(market, name);
        const symbols = loadSymbols();
        symbols[key] = symbol;
        saveSymbols(symbols);
        setFetchStatus(`${name}의 시세 코드를 "${symbol}"(으)로 채웠습니다. 맞는지 확인해 주세요.`);
        render();
      } catch (e) {
        setFetchStatus(`${name} 시세 코드 찾기 실패: ${e.message}`);
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
    const holdings = computeHoldings(loadTransactions());
    if (holdings.length === 0) {
      setFetchStatus("보유 중인 종목이 없습니다.");
      return;
    }

    button.disabled = true;
    setFetchStatus(`전체 종목 조회 중... (0/${holdings.length})`);

    let successCount = 0;
    const failMessages = [];

    for (let i = 0; i < holdings.length; i++) {
      const h = holdings[i];
      const result = await fetchAndUpdatePrice(h.market, h.name);
      if (result.ok) {
        successCount++;
      } else {
        failMessages.push(`${h.name}: ${result.message}`);
      }
      setFetchStatus(`전체 종목 조회 중... (${i + 1}/${holdings.length})`);
      await sleep(300); // Twelve Data 무료 플랜의 분당 호출 제한을 피하기 위한 최소 간격
    }

    button.disabled = false;
    render();

    const summary =
      `${successCount}개 종목 갱신 완료` +
      (failMessages.length > 0 ? ` · 실패 ${failMessages.length}개 (${failMessages.join(", ")})` : "");
    setFetchStatus(summary);
  });
}

function setupTransactionActions() {
  const txArea = document.getElementById("tx-area");

  txArea.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="delete-tx"]');
    if (!button) return;

    const item = button.closest(".tx-item");
    const id = item.dataset.id;

    if (!window.confirm("이 거래내역을 삭제할까요? (보유수량·평균단가가 다시 계산됩니다)")) return;

    const transactions = loadTransactions().filter((tx) => tx.id !== id);
    saveTransactions(transactions);
    render();
  });
}

function setupDividendForm() {
  const form = document.getElementById("dividend-form");
  const dateInput = form.querySelector('input[name="date"]');
  dateInput.value = todayISO();

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const name = String(formData.get("name")).trim();
    if (!name) return;

    const newDividend = {
      id: makeId(),
      date: String(formData.get("date")) || todayISO(),
      market: formData.get("market"),
      name,
      amount: Number(formData.get("amount")),
      seq: Date.now(),
    };

    const dividends = loadDividends();
    dividends.push(newDividend);
    saveDividends(dividends);

    form.reset();
    dateInput.value = todayISO();
    renderDividends(loadDividends());
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

    const dividends = loadDividends().filter((d) => d.id !== id);
    saveDividends(dividends);
    renderDividends(dividends);
  });
}

// --- 데이터 관리: 거래내역 CSV, 전체 백업(JSON) ---

function setCsvStatus(text) {
  const el = document.getElementById("csv-status");
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
  const typeLabel = { BUY: "매수", SELL: "매도" };

  const rows = transactions.map((tx) => {
    const symbol = symbols[holdingKey(tx.market, tx.name)] || "";
    return [tx.date, MARKET_LABEL[tx.market], tx.name, typeLabel[tx.type], tx.qty, tx.price, tx.fee, symbol]
      .map(csvEscape)
      .join(",");
  });

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

  const marketFromLabel = { 국내: "KR", 미국: "US" };
  const typeFromLabel = { 매수: "BUY", 매도: "SELL" };

  const transactions = loadTransactions();
  const symbols = loadSymbols();
  let added = 0;
  const errors = [];

  rows.slice(1).forEach((cols, idx) => {
    const lineNo = idx + 2; // 머리글 포함 실제 줄 번호
    if (cols.every((c) => c.trim() === "")) return; // 빈 줄은 조용히 건너뜀

    const [date, marketLabel, name, typeLabel2, qtyStr, priceStr, feeStr, symbol] = cols;
    const market = marketFromLabel[(marketLabel || "").trim()];
    const type = typeFromLabel[(typeLabel2 || "").trim()];
    const qty = Number(qtyStr);
    const price = Number(priceStr);
    const fee = feeStr && feeStr.trim() !== "" ? Number(feeStr) : 0;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      errors.push(`${lineNo}줄: 날짜 형식 오류(YYYY-MM-DD)`);
      return;
    }
    if (!market) {
      errors.push(`${lineNo}줄: 구분은 "국내" 또는 "미국"`);
      return;
    }
    if (!name || !name.trim()) {
      errors.push(`${lineNo}줄: 종목명 없음`);
      return;
    }
    if (!type) {
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
      id: makeId(),
      date: date.trim(),
      market,
      name: name.trim(),
      type,
      qty,
      price,
      fee: Number.isFinite(fee) ? fee : 0,
      seq: Date.now() + added,
    });

    if (symbol && symbol.trim()) {
      symbols[holdingKey(market, name.trim())] = symbol.trim();
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

function collectBackupData() {
  return {
    _meta: { app: "주식현황관리", exportedAt: new Date().toISOString(), version: 1 },
    transactions: loadTransactions(),
    prices: loadPrices(),
    symbols: loadSymbols(),
    priceHistory: loadPriceHistory(),
    dividends: loadDividends(),
    apiKey: loadApiKey(),
    krApiKey: loadKrApiKey(),
  };
}

function exportJsonBackup() {
  const data = collectBackupData();
  downloadTextFile(`주식현황_백업_${todayISO()}.json`, JSON.stringify(data, null, 2), "application/json");
}

async function handleJsonImportFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (e) {
    setJsonStatus("JSON 파일을 읽을 수 없습니다.");
    return;
  }
  if (!data || typeof data !== "object") {
    setJsonStatus("올바른 백업 파일이 아닙니다.");
    return;
  }
  if (!window.confirm("지금 폰에 있는 데이터를 이 백업 파일 내용으로 덮어씁니다. 계속할까요?")) {
    return;
  }

  if (Array.isArray(data.transactions)) saveTransactions(data.transactions);
  if (data.prices && typeof data.prices === "object") savePrices(data.prices);
  if (data.symbols && typeof data.symbols === "object") saveSymbols(data.symbols);
  if (data.priceHistory && typeof data.priceHistory === "object") savePriceHistory(data.priceHistory);
  if (Array.isArray(data.dividends)) saveDividends(data.dividends);
  if (typeof data.apiKey === "string") saveApiKey(data.apiKey);
  if (typeof data.krApiKey === "string") saveKrApiKey(data.krApiKey);

  document.getElementById("api-key-input").value = loadApiKey();
  document.getElementById("kr-api-key-input").value = loadKrApiKey();

  render();
  setJsonStatus("백업을 불러왔습니다.");
}

function setupDataManagement() {
  document.getElementById("export-csv-btn").addEventListener("click", () => {
    const csv = buildTransactionsCsv(loadTransactions(), loadSymbols());
    downloadTextFile(`거래내역_${todayISO()}.csv`, String.fromCharCode(0xfeff) + csv, "text/csv;charset=utf-8");
    setCsvStatus("CSV 파일을 내보냈습니다.");
  });

  const csvFileInput = document.getElementById("import-csv-file");
  document.getElementById("import-csv-btn").addEventListener("click", () => csvFileInput.click());
  csvFileInput.addEventListener("change", async () => {
    const file = csvFileInput.files[0];
    if (!file) return;
    await handleCsvImportFile(file);
    csvFileInput.value = "";
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

migrateOldHoldingsIfNeeded();
setupSettings();
setupForm();
setupHoldingsActions();
setupRefreshAll();
setupTransactionActions();
setupDividendForm();
setupDividendActions();
setupDataManagement();
render();

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
