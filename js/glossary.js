// 주식 용어집 데이터와 검색 (순수 함수). 설계: design/11_시그널과용어집.md §4
// - 앱 화면에 새 용어를 쓰면 여기에도 등록한다(CM-037). 화면의 data-glossary="용어id" 가 term_id 와 같아야 한다.
// - 표준 변수명(변수사전): term_id, term_name, term_aliases, term_category, term_summary, term_detail, term_formula, term_used_in
(function (root) {
  "use strict";

  const CATEGORY_LABEL = { indicator: "지표", price: "가격·수익", strategy: "알림·전략", market: "시장·분류" };

  const GLOSSARY = [
    // ---- 지표 ----
    {
      term_id: "rsi",
      term_name: "RSI (상대강도지수)",
      term_aliases: ["RSI", "Relative Strength Index", "상대강도"],
      term_category: "indicator",
      term_summary: "최근 가격이 얼마나 많이·세게 올랐는지를 0~100으로 나타낸 지표입니다.",
      term_detail: "최근 14거래일 동안 오른 날의 평균 상승폭과 내린 날의 평균 하락폭을 비교합니다. 70 이상이면 짧은 기간에 너무 올라 과열(과매수), 30 이하이면 너무 내려 과매도로 봅니다. 과열이라고 바로 떨어지는 것도, 과매도라고 바로 오르는 것도 아니라서 다른 신호와 함께 참고합니다.",
      term_formula: "RSI = 100 − 100 ÷ (1 + 평균 상승폭 ÷ 평균 하락폭)  (14거래일, Wilder 방식 평균)",
      term_used_in: "종목 상세의 시세 시그널. 30 이하는 매수 관심, 70 이상은 매도 검토의 근거입니다.",
    },
    {
      term_id: "atr",
      term_name: "ATR (평균 진폭)",
      term_aliases: ["ATR", "Average True Range", "평균진폭", "변동폭"],
      term_category: "indicator",
      term_summary: "하루에 보통 얼마나 움직이는지(변동폭)를 가격 단위로 나타낸 지표입니다.",
      term_detail: "하루의 진짜 변동폭(True Range)을 구해 최근 14거래일을 평균 낸 값입니다. 값이 클수록 가격이 크게 출렁이는 종목입니다. 손절가·추세 이탈선을 정할 때 '이 종목은 보통 이만큼 흔들린다'를 반영하려고 씁니다.",
      term_formula: "True Range = 고가−저가, |고가−전일종가|, |저가−전일종가| 중 가장 큰 값 / ATR = True Range의 14거래일 평균",
      term_used_in: "단기매매 종목의 손절가(평단 − 2×ATR), 시세 시그널의 추세 이탈선(최고 종가 − 3×ATR).",
    },
    {
      term_id: "sma",
      term_name: "이동평균선",
      term_aliases: ["이평선", "SMA", "이동평균", "MA", "20일선", "60일선", "Moving Average"],
      term_category: "indicator",
      term_summary: "최근 N거래일 종가의 평균을 이어 그린 선으로, 가격의 큰 흐름(추세)을 보여 줍니다.",
      term_detail: "20일선은 최근 20거래일 종가의 평균입니다. 일일 등락의 잡음을 줄여서 오르는 흐름인지 내리는 흐름인지를 보여 줍니다. 기간이 짧은 선(20일, 약 1개월)은 빠르게 반응하고, 긴 선(60일, 약 3개월)은 천천히 움직입니다. 장기 추세는 120일선(약 6개월)과 200일선(약 1년)으로 보는 투자자가 많습니다. 가격이 선 위에 있으면 지지받는 흐름, 아래에 있으면 눌리는 흐름으로 읽습니다.",
      term_formula: "N일 이동평균 = 최근 N거래일 종가의 합 ÷ N",
      term_used_in: "골든크로스·데드크로스 판정 (20일선과 60일선), 종목 상세 가격 그래프의 이동평균선(20·60·120·200일, 켜고 끌 수 있음. 기본은 20일선과 200일선).",
    },
    {
      term_id: "ma_alignment",
      term_name: "정배열·역배열",
      term_aliases: ["정배열", "역배열", "이평선 배열", "상승 흐름", "하락 흐름"],
      term_category: "indicator",
      term_summary: "이동평균선이 짧은 것부터 위에 늘어서면 정배열(상승 흐름), 반대로 아래에 늘어서면 역배열(하락 흐름)입니다.",
      term_detail: "20일선이 60일선 위에 있으면 최근 가격이 과거 평균보다 높다는 뜻이라 오르는 흐름으로 봅니다(정배열). 20일선이 60일선 아래이면 최근 가격이 과거 평균보다 낮은 내리막 흐름입니다(역배열). 선들이 서로 엉켜 있으면 방향이 뚜렷하지 않은 횡보 구간입니다. 현재가가 장기선(60일선)을 넘어서 올라오는지도 함께 보면 도움이 됩니다. 이동평균은 지나간 가격의 평균이라 변화를 한발 늦게 알려 줍니다.",
      term_formula: "정배열: 현재가 > 20일선 > 60일선 (120일선까지 보면 더 확실) / 역배열: 그 반대",
      term_used_in: "종목 상세의 시세 시그널 흐름 문장, 가격 그래프의 이동평균선.",
    },
    {
      term_id: "golden_cross",
      term_name: "골든크로스",
      term_aliases: ["Golden Cross", "황금 교차"],
      term_category: "indicator",
      term_summary: "단기 이동평균선(20일)이 장기선(60일)을 아래에서 위로 뚫고 올라가는 것으로, 상승 전환 신호로 봅니다.",
      term_detail: "최근 가격이 과거 평균보다 강해졌다는 뜻입니다. 다만 이미 많이 오른 뒤에 나타나는 경우가 많고 가짜 신호도 있어서, RSI 같은 다른 지표와 같이 봅니다.",
      term_formula: "전날 20일선 ≤ 60일선, 오늘 20일선 > 60일선",
      term_used_in: "시세 시그널의 매수 관심 근거(최근 5거래일 안에 발생했을 때).",
    },
    {
      term_id: "dead_cross",
      term_name: "데드크로스",
      term_aliases: ["Dead Cross", "죽음의 교차"],
      term_category: "indicator",
      term_summary: "단기 이동평균선(20일)이 장기선(60일)을 위에서 아래로 뚫고 내려가는 것으로, 하락 전환 신호로 봅니다.",
      term_detail: "최근 가격이 과거 평균보다 약해졌다는 뜻입니다. 이미 떨어진 뒤에 확인되는 경우가 많아서 늦은 신호일 수 있습니다.",
      term_formula: "전날 20일선 ≥ 60일선, 오늘 20일선 < 60일선",
      term_used_in: "시세 시그널의 매도 검토 근거(최근 5거래일 안에 발생했을 때).",
    },
    {
      term_id: "overbought_oversold",
      term_name: "과매수·과매도",
      term_aliases: ["과열", "과매수", "과매도", "overbought", "oversold"],
      term_category: "indicator",
      term_summary: "단기간에 너무 올라 과열된 상태(과매수) 또는 너무 내려 지나치게 팔린 상태(과매도)입니다.",
      term_detail: "RSI로 판단합니다(70 이상 과열, 30 이하 과매도). 가격이 평소 범위를 벗어났으니 되돌림이 나올 수 있다는 참고 신호일 뿐, 반드시 반대로 움직이는 것은 아닙니다. 강한 상승·하락 추세에서는 과열·과매도 상태가 오래 이어지기도 합니다.",
      term_formula: "RSI ≥ 70 과매수, RSI ≤ 30 과매도 (설정에서 바꿀 수 있음)",
      term_used_in: "시세 시그널의 근거 문장.",
    },
    {
      term_id: "trend_break",
      term_name: "추세 이탈 (추적 손절선)",
      term_aliases: ["추적 손절", "트레일링 스탑", "trailing stop", "샹들리에", "추세이탈"],
      term_category: "indicator",
      term_summary: "최근 최고 종가에서 일정 폭(3×ATR) 이상 내려와 상승 흐름이 꺾였다고 볼 만한 상태입니다.",
      term_detail: "내가 산 가격(평단)과 상관없이 '최근 고점 대비 얼마나 떨어졌나'만 봅니다. 고점이 오르면 기준선도 따라 올라가므로 오래 보유한 종목에도 쓸 수 있습니다. 현재가가 이 선 아래로 내려오면 매도 검토 근거로 봅니다. 이미 오래 하락 중인 종목은 계속 이탈 상태로 표시될 수 있습니다.",
      term_formula: "추적 손절선 = 최근 60거래일 최고 종가 − 3 × ATR",
      term_used_in: "시세 시그널의 매도 검토 근거, 종목 상세 가격 그래프의 주황 점선.",
    },
    {
      term_id: "range_52w",
      term_name: "52주 범위",
      term_aliases: ["52주 최고", "52주 최저", "52주 위치", "52주"],
      term_category: "indicator",
      term_summary: "최근 1년(약 250거래일) 동안의 최고·최저 종가 범위에서 현재가가 어디쯤인지 보여 줍니다.",
      term_detail: "위치가 100%에 가까우면 1년 중 가장 높은 쪽, 0%에 가까우면 가장 낮은 쪽입니다. 고점 대비 하락률은 1년 최고 종가에서 얼마나 내려왔는지를 보여 줍니다. 참고 정보이며 시그널 판정에는 쓰지 않습니다.",
      term_formula: "위치 = (현재가 − 최저) ÷ (최고 − 최저)  /  고점 대비 하락률 = 현재가 ÷ 최고 − 1",
      term_used_in: "종목 상세의 시세 시그널 영역.",
    },
    {
      term_id: "volatility",
      term_name: "변동성",
      term_aliases: ["volatility", "출렁임"],
      term_category: "indicator",
      term_summary: "가격이 얼마나 크게 오르내리는지를 말합니다. 클수록 위험도 기회도 큽니다.",
      term_detail: "이 앱에서는 ATR로 변동성을 가격 단위로 나타냅니다. 변동성이 큰 종목은 손절폭을 넓게 잡아야 사소한 출렁임에 잘못 걸리지 않습니다.",
      term_formula: null,
      term_used_in: "ATR 기반 손절폭 계산.",
    },

    // ---- 가격·수익 ----
    {
      term_id: "average_price",
      term_name: "평균단가 (평단)",
      term_aliases: ["평단", "평균매수가", "매입단가"],
      term_category: "price",
      term_summary: "내가 산 주식의 평균 매수 가격입니다. 수수료를 포함해 계산합니다.",
      term_detail: "여러 번에 나눠 사면 가격이 다르므로 수량으로 가중평균을 냅니다. 팔 때는 수량만 줄고 평균단가는 그대로입니다.",
      term_formula: "평균단가 = (기존 수량×기존 평단 + 새 수량×새 단가 + 수수료) ÷ 총 수량",
      term_used_in: "보유 종목 한 줄, 손익 계산, 단기매매 종목의 목표가·손절가 기준.",
    },
    {
      term_id: "profit_rate",
      term_name: "수익률·평가손익",
      term_aliases: ["수익률", "손익", "평가손익", "손실률"],
      term_category: "price",
      term_summary: "산 금액 대비 지금 평가금액이 얼마나 늘거나 줄었는지입니다.",
      term_detail: "평가손익은 금액(원·달러), 수익률은 비율(%)입니다. 아직 팔지 않았으므로 확정된 손익이 아니라 현재가 기준의 평가입니다. 한국 관행에 맞춰 상승은 빨강, 하락은 파랑으로 표시합니다.",
      term_formula: "평가손익 = 현재가×수량 − 평균단가×수량 / 수익률 = 평가손익 ÷ (평균단가×수량)",
      term_used_in: "보유 종목 한 줄, 수익률 순위, 현황 합계.",
    },
    {
      term_id: "day_change",
      term_name: "전일비",
      term_aliases: ["전일대비", "등락률"],
      term_category: "price",
      term_summary: "바로 전 거래일 종가와 비교한 오늘 가격의 변화율입니다.",
      term_detail: "저장된 시세 기록의 마지막 두 날짜를 비교합니다. 국내는 하루 늦은 종가라서 실제 오늘 등락과 하루 차이가 날 수 있습니다.",
      term_formula: "전일비 = 최근 종가 ÷ 그 전 종가 − 1",
      term_used_in: "보유 종목 한 줄.",
    },
    {
      term_id: "weight",
      term_name: "비중",
      term_aliases: ["종목 비중", "포트폴리오 비중", "집중도"],
      term_category: "price",
      term_summary: "전체 자산 중 한 종목이 차지하는 비율입니다.",
      term_detail: "한 종목의 비중이 너무 크면 그 종목이 흔들릴 때 전체 자산이 크게 흔들립니다. 이 앱은 한 종목이 전체(원화 환산)의 20%를 넘으면 '비중 초과'로 알립니다. 한도는 설정에서 바꿀 수 있습니다.",
      term_formula: "비중 = 종목 평가금액(원화 환산) ÷ 전체 평가금액(원화 환산)",
      term_used_in: "현황의 종목 비중, 보유 종목의 비중 초과 표시.",
    },
    {
      term_id: "drawdown",
      term_name: "고점 대비 하락률",
      term_aliases: ["낙폭", "MDD", "하락률", "drawdown"],
      term_category: "price",
      term_summary: "최근 1년 최고 종가에서 지금까지 얼마나 내려왔는지입니다.",
      term_detail: "평단 대비 손익과는 다릅니다. 평단은 내가 산 가격 기준이고, 고점 대비 하락률은 시장 가격 흐름 기준입니다.",
      term_formula: "하락률 = 현재가 ÷ 최근 1년 최고 종가 − 1",
      term_used_in: "종목 상세의 시세 시그널 영역.",
    },

    // ---- 알림·전략 ----
    {
      term_id: "signal",
      term_name: "시세 시그널 (매수 관심·매도 검토)",
      term_aliases: ["시그널", "매수 관심", "매도 검토", "매매 신호"],
      term_category: "strategy",
      term_summary: "이동평균 교차, RSI, 추세 이탈로 지금이 사볼 만한지·정리를 검토할 만한지 참고용으로 알려 주는 표시입니다.",
      term_detail: "매수 근거만 있으면 '매수 관심', 매도 근거만 있으면 '매도 검토', 둘 다 있거나 없으면 '중립'입니다. 과거 가격으로 계산한 참고 정보이며 매매를 권유하는 것이 아닙니다. 시그널이 바뀐 날에만 새 알림으로 알려 줍니다.",
      term_formula: null,
      term_used_in: "현황의 시그널 변경 배너, 보유 종목 배지, 종목 상세.",
    },
    {
      term_id: "holding_style",
      term_name: "장기보유·단기매매",
      term_aliases: ["투자 성격", "장기", "단기", "보유 성격"],
      term_category: "strategy",
      term_summary: "종목마다 오래 가져갈지(장기보유), 가격 변동을 보며 사고팔지(단기매매) 정하는 설정입니다.",
      term_detail: "장기보유 종목은 내 평단 기준 목표가·손절가 알림을 쓰지 않고 시세 시그널만 봅니다(기본값). 단기매매 종목은 목표가·손절가 알림을 씁니다. 종목 상세에서 바꿉니다.",
      term_formula: null,
      term_used_in: "종목 상세의 투자 성격 선택.",
    },
    {
      term_id: "target_price",
      term_name: "목표가",
      term_aliases: ["익절가", "목표 주가"],
      term_category: "strategy",
      term_summary: "이 가격에 닿으면 수익을 챙기는 것을 고려하려고 정해 두는 가격입니다.",
      term_detail: "단기매매 종목은 앱이 평단과 손익비(1:2)로 권장값을 자동으로 정합니다. 직접 고칠 수 있고, 현재가가 목표가 이상이면 알림이 뜹니다.",
      term_formula: "목표가 = 평단 + 손익비 × (평단 − 손절가)",
      term_used_in: "단기매매 종목의 목표가·손절가 영역.",
    },
    {
      term_id: "stop_price",
      term_name: "손절가",
      term_aliases: ["손절", "스톱로스", "stop loss"],
      term_category: "strategy",
      term_summary: "손실이 더 커지기 전에 정리하려고 정해 두는 가격입니다.",
      term_detail: "앱의 권장값은 평단 − 2×ATR(시세 기록이 부족하면 평단 −10%)이며 평단 대비 7~20% 범위로 제한합니다. 현재가가 손절가 이하이면 알림이 뜹니다. 이미 평단보다 많이 내려간 종목은 평단 기준 선이 의미가 없을 수 있어 장기보유로 두고 시세 시그널을 봅니다.",
      term_formula: "손절가 = 평단 × (1 − max(7%, min(20%, 2×ATR ÷ 평단)))",
      term_used_in: "단기매매 종목의 목표가·손절가 영역.",
    },
    {
      term_id: "reward_risk",
      term_name: "손익비",
      term_aliases: ["R:R", "리스크 대비 보상", "reward risk"],
      term_category: "strategy",
      term_summary: "감수하는 손실 한 번에 기대하는 이익이 몇 배인지를 나타냅니다.",
      term_detail: "손익비 1:2는 손실 가능폭이 10%이면 목표 이익을 20%로 잡는다는 뜻입니다. 이렇게 하면 승률이 50%보다 낮아도 장기적으로 손실을 줄일 수 있다는 것이 일반적인 설명입니다. 설정에서 바꿀 수 있습니다.",
      term_formula: "목표폭 = 손절폭 × 손익비",
      term_used_in: "목표가 자동 계산.",
    },
    {
      term_id: "rebalancing",
      term_name: "리밸런싱",
      term_aliases: ["비중 조절", "재조정", "rebalancing"],
      term_category: "strategy",
      term_summary: "너무 커진 종목은 줄이고 작아진 쪽을 늘려 처음 정한 비중으로 되돌리는 것입니다.",
      term_detail: "전부 사고팔지 않고 일부만 조정합니다. 한 종목에 몰린 위험을 줄이는 방법이며, 이 앱의 '비중 초과' 표시가 검토 신호가 됩니다.",
      term_formula: null,
      term_used_in: "비중 초과 문구.",
    },

    // ---- 시장·분류 ----
    {
      term_id: "exchange",
      term_name: "거래소 (코스피·코스닥·나스닥·NYSE)",
      term_aliases: ["코스피", "코스닥", "나스닥", "NYSE", "KOSPI", "KOSDAQ", "NASDAQ", "코넥스"],
      term_category: "market",
      term_summary: "주식이 거래되는 시장입니다. 국내는 코스피·코스닥, 미국은 나스닥·NYSE 등이 대표적입니다.",
      term_detail: "코스피는 대형·우량 기업 중심, 코스닥은 중소·성장 기업 중심 시장입니다. 미국의 나스닥은 기술주가 많고 NYSE(뉴욕증권거래소)는 전통 대기업이 많습니다. 앱은 시세 조회 결과로 거래소를 자동으로 채우고 필요하면 직접 고칠 수 있습니다.",
      term_formula: null,
      term_used_in: "보유 화면의 그룹·필터.",
    },
    {
      term_id: "sector",
      term_name: "섹터",
      term_aliases: ["업종", "산업"],
      term_category: "market",
      term_summary: "반도체, 2차전지, 금융처럼 비슷한 사업을 하는 기업끼리 묶은 분류입니다.",
      term_detail: "같은 섹터 종목은 함께 오르내리는 경향이 있습니다. 섹터별로 묶어 보면 한 업종에 몰려 있지는 않은지 알 수 있습니다.",
      term_formula: null,
      term_used_in: "보유 화면의 섹터 그룹·필터.",
    },
    {
      term_id: "fx",
      term_name: "환율·환차손익",
      term_aliases: ["환율", "환차손익", "원달러", "USD/KRW"],
      term_category: "market",
      term_summary: "1달러가 몇 원인지를 나타냅니다. 미국 주식을 원화로 환산할 때 쓰며, 환율이 변해서 생기는 손익이 환차손익입니다.",
      term_detail: "이 앱은 미국 거래를 달러로만 기록하므로, 오늘 환율로 원화로 바꿔 합계를 냅니다. 산 날의 환율을 모르기 때문에 환차손익은 계산에 포함하지 않습니다.",
      term_formula: "원화 평가금액 = 달러 평가금액 × 오늘 환율",
      term_used_in: "현황의 총 평가금액(원화 환산).",
    },
    {
      term_id: "dividend",
      term_name: "배당",
      term_aliases: ["배당금", "dividend"],
      term_category: "market",
      term_summary: "기업이 이익의 일부를 주주에게 나눠 주는 돈입니다.",
      term_detail: "미국 배당은 달러로 기록하고, 원화로 입력하면 그날 환율로 달러로 바꿔 저장합니다.",
      term_formula: null,
      term_used_in: "배당 기록 화면, 종목 상세의 배당 합계.",
    },
    {
      term_id: "symbol",
      term_name: "시세 코드",
      term_aliases: ["종목코드", "티커", "ticker", "심볼"],
      term_category: "market",
      term_summary: "시세를 조회할 때 쓰는 종목 식별 코드입니다. 국내는 6자리 종목코드, 미국은 영문 티커입니다.",
      term_detail: "예를 들어 국내는 005930, 미국은 AAPL 같은 형태입니다. 코드가 없으면 자동 시세 조회가 안 되므로 '코드찾기'나 '시세 코드 일괄 찾기'로 채웁니다.",
      term_formula: null,
      term_used_in: "보유 종목의 시세 코드 칸.",
    },
  ];

  const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");

  /** 용어·별칭·요약·설명에 검색어가 들어 있는 용어를 돌려준다. 빈 검색어는 전체. */
  function searchGlossary(query, list) {
    const src = list || GLOSSARY;
    const q = norm(query);
    if (!q) return src;
    return src.filter((t) => norm([t.term_name, ...(t.term_aliases || []), t.term_summary, t.term_detail].join(" ")).includes(q));
  }

  function findTerm(termId) {
    return GLOSSARY.find((t) => t.term_id === termId) || null;
  }

  const api = { GLOSSARY, CATEGORY_LABEL, searchGlossary, findTerm };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Glossary = api;
})(typeof window !== "undefined" ? window : globalThis);
