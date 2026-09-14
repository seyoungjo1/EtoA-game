/* ===========================================================
   firebase-config.js — 실시간 동기화 설정

   여기에 Firebase 설정을 넣으면 모든 기기가 같은 게임판을 공유합니다.
   비워두면 이 브라우저에만 저장되는 오프라인 모드로 동작합니다.

   설정을 넣는 방법은 두 가지입니다.
   1) 이 파일에 직접 적어 커밋하면 모든 기기가 자동으로 연결됩니다. (권장)
   2) 관리자로 로그인해 '설정 · 기록' 탭에서 붙여넣으면 그 기기만 연결됩니다.

   Firebase 웹 설정값은 비밀이 아니며 공개되어도 되는 값입니다.
   접근 제어는 Realtime Database 규칙으로 합니다. README 를 참고하세요.
   =========================================================== */
window.ETOA_FIREBASE = null;

/* 예시
window.ETOA_FIREBASE = {
  apiKey: "AIza...",
  authDomain: "etoa-game.firebaseapp.com",
  databaseURL: "https://etoa-game-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "etoa-game",
  appId: "1:1234567890:web:abcdef"
};
*/
