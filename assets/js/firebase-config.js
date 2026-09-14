/* ===========================================================
   firebase-config.js — 실시간 동기화 설정

   apiKey 만 채우면 모든 기기가 같은 게임판을 공유합니다.
   비워두면 이 브라우저에만 저장되는 오프라인 모드로 동작합니다.

   apiKey 는 어디서 얻나요?
     Firebase 콘솔 → 프로젝트 설정(톱니) → 내 앱 → 웹 앱(</>)
     → firebaseConfig 의 apiKey ("AIza..." 로 시작)
     웹 앱이 없으면 '앱 추가 → 웹' 으로 하나 만들면 됩니다.

   apiKey 는 비밀이 아니며 공개되어도 되는 값입니다.
   실제 접근 제어는 아래 두 계정과 Realtime Database 규칙이 합니다.

   권한 구분
     관리자 · 운영진 로그인 -> write 계정으로 DB 에 로그인 (읽기 + 쓰기)
     회원 로그인            -> read  계정으로 DB 에 로그인 (읽기만)
   두 계정은 첫 실행 때 자동으로 만들어집니다.
   Authentication → Sign-in method → 이메일/비밀번호 를 켜두어야 합니다.
   =========================================================== */
window.ETOA_FIREBASE = {
  databaseURL: 'https://etoa-score-default-rtdb.firebaseio.com',
  apiKey: '',   // <-- 여기에 붙여넣으세요

  // 앱에 로그인하면 역할에 맞는 계정으로 DB 에 자동 로그인합니다.
  // 비밀번호는 소스에 그대로 보이지 않도록 난독화해 두었습니다.
  // (정적 사이트라 브라우저가 풀 수 있으면 사람도 풀 수 있습니다. 완전한 암호화는 아닙니다.)
  accounts: {
    write: { email: 'staff@etoa.app',  secret: 'EQQLFEkwCglUDA==' },
    read:  { email: 'viewer@etoa.app', secret: 'EQQLFEkwCglXbQ==' },
  },
};
