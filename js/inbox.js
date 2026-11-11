// 알림함 묶음 계산 (순수 함수). 설계: design/17_화면재설계_큰그림.md §12 (BL-56, CM-042)
// - 목표가·손절가 / 시세 시그널 변경 / 기업 이벤트의 "아직 확인하지 않은 항목"을 받아 개수·순서·요약 문구를 만든다.
// - 화면은 이 결과를 그리기만 한다. 저장·시간·화면에 의존하지 않는다. 브라우저에서는 window.Inbox, node 시험에서는 require() 로 쓴다.
(function (root) {
  "use strict";

  // ===== 수정 영역: 알림 종류와 표시 순서 =====
  const INBOX_KINDS = [
    { kind: "alert", label: "목표가·손절가" },
    { kind: "signal", label: "시세 시그널 변경" },
    { kind: "event", label: "기업 이벤트" },
  ];
  // ===== 수정 영역 END =====

  /**
   * @param {{alert_pending?:object[], signal_pending?:object[], event_pending?:object[]}} input 종류별 미확인 항목(각 종류의 판정 함수가 돌려준 pending 그대로)
   * @returns {{inbox_total_cnt:number, kind_list:{kind:string,label:string,cnt:number}[], item_list:object[], summary_text:string}}
   *   kind_list 는 항목이 있는 종류만, item_list 는 종류 순서대로 항목에 inbox_kind 를 붙여 돌려준다.
   */
  function buildInbox(input) {
    const src = { alert: (input && input.alert_pending) || [], signal: (input && input.signal_pending) || [], event: (input && input.event_pending) || [] };
    const kind_list = INBOX_KINDS.map((k) => ({ kind: k.kind, label: k.label, cnt: src[k.kind].length })).filter((k) => k.cnt > 0);
    const item_list = INBOX_KINDS.flatMap((k) => src[k.kind].map((it) => ({ ...it, inbox_kind: k.kind })));
    return { inbox_total_cnt: item_list.length, kind_list, item_list, summary_text: kind_list.map((k) => `${k.label} ${k.cnt}`).join(" · ") };
  }

  const api = { INBOX_KINDS, buildInbox };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Inbox = api;
})(typeof window !== "undefined" ? window : globalThis);
