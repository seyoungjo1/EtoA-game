/* ===========================================================
   firebase-config.js — 실시간 동기화 설정

   apiKey 만 채우면 모든 기기가 같은 게임판을 공유합니다.
   비워두면 이 브라우저에만 저장되는 오프라인 모드로 동작합니다.

   apiKey 는 어디서 얻나요?
     Firebase 콘솔 → 프로젝트 설정(톱니) → 내 앱 → 웹 앱(</>)
     → firebaseConfig 의 apiKey ("AIza..." 로 시작)
     웹 앱이 없으면 '앱 추가 → 웹' 으로 하나 만들면 됩니다.

   apiKey 는 비밀이 아니며 공개되어도 되는 값입니다.
   실제 접근 제어는 Realtime Database 규칙(firebase.rules.json)이 합니다.

   projectId 와 authDomain 은 databaseURL 에서 자동으로 유추합니다.
   =========================================================== */
window.ETOA_FIREBASE = {
  databaseURL: 'https://etoa-score-default-rtdb.firebaseio.com',
  apiKey: '',   // <-- 여기에 붙여넣으세요
};
