// 앱 버전 정보. 이 파일 하나로 두 가지가 정해진다.
//  1) 서비스 워커의 오프라인 저장본 이름: stock-app-cache-<APP_VERSION>
//  2) 앱 화면(설정, 더보기)에 보이는 버전
// 앱 파일을 고쳐서 내보낼 때는 APP_VERSION 을 올린다(예: v20 -> v21)와 APP_BUILD_DATE 를 오늘 날짜로 바꾼다.
// (service-worker.js 와 앱 화면이 같이 읽는다. design/05_서비스워커.md)
const APP_VERSION = "v39";
const APP_BUILD_DATE = "2026-11-10";
