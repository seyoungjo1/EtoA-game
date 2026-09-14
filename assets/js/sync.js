/* ===========================================================
   sync.js — Firebase Realtime Database 실시간 동기화

   설정이 있으면 모든 기기가 같은 데이터를 공유하고, 없으면
   localStorage 만 쓰는 오프라인 모드로 그대로 동작합니다.

   저장 구조 (루트 = etoa)
     users            계정 배열
     members          회원/게스트 배열
     day/meta         날짜 · 코트 수 · 대기 줄 수 · 토글
     day/courts       코트별 4자리
     day/queues       대기 줄
     day/attendance   오늘 참석 여부
     day/games        개인 게임 수
     day/combos       4인 조합 사용 횟수
     day/pairs        파트너 조합 횟수
     day/history      완료 경기 기록

   바뀐 가지만 골라 쓰기 때문에, 두 사람이 각각 명단과 게임판을
   만져도 서로 덮어쓰지 않습니다.
   =========================================================== */
const Sync = (() => {
  const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
  const CLUBS = 'clubs';           // 모임 목록 (어느 모임에 속하든 함께 본다)
  const SITE = 'site';             // 사이트 최고 관리자
  const PUSH_DELAY = 250;

  let rootRef = null;
  let clubsRef = null;
  let siteRef = null;
  let status = 'off';            // off | connecting | online | offline | error
  let detail = '';
  let onRemoteCb = () => {};
  let onStatusCb = () => {};
  let onSeedCb = () => {};
  let onClubsCb = () => {};
  let onSiteCb = () => {};
  let pushTimer = null;
  let pending = null;
  let sent = {};                 // 노드별 마지막으로 보낸 JSON
  let dbRef = null;
  let sawRemote = false;
  let role = null;               // 'write' (관리자·운영진) | 'read' (회원) | null

  /* ---------- 설정 ---------- */
  /** databaseURL 에서 프로젝트 아이디를 뽑는다. etoa-score-default-rtdb.firebaseio.com -> etoa-score */
  function projectFromDbUrl(url) {
    try {
      const host = new URL(url).host;
      return host.split('.')[0].replace(/-default-rtdb$/, '');
    } catch (e) { return ''; }
  }

  /** 빠진 값을 databaseURL 에서 채워 넣는다. */
  function normalize(cfg) {
    if (!cfg) return null;
    const out = Object.assign({}, cfg);
    const base = window.ETOA_FIREBASE || {};
    if (!out.databaseURL) out.databaseURL = base.databaseURL || '';
    if (!out.apiKey) out.apiKey = base.apiKey || '';
    if (!out.accounts) out.accounts = base.accounts || null;
    if (!out.projectId) out.projectId = projectFromDbUrl(out.databaseURL);
    if (!out.authDomain && out.projectId) out.authDomain = `${out.projectId}.firebaseapp.com`;
    return out;
  }

  /** 설정은 firebase-config.js 에 박힌 값만 쓴다. 기기에서 바꿀 수 없다. */
  function config() {
    const cfg = normalize(window.ETOA_FIREBASE || null);
    if (!cfg || !cfg.databaseURL) return null;
    return cfg;
  }

  /** 연결에 필요한 값이 다 있는지 */
  const ready = () => { const c = config(); return !!(c && c.apiKey && c.databaseURL); };

  const isOn = () => status === 'online' || status === 'offline';
  const state = () => ({ status, detail, configured: ready(), role, canWrite: role === 'write' });

  function setStatus(s, msg = '') {
    status = s; detail = msg;
    onStatusCb(state());
  }

  /* ---------- SDK 로딩 ---------- */
  function loadScript(src) {
    return new Promise((res, rej) => {
      if ([...document.scripts].some((s) => s.src === src)) return res();
      const el = document.createElement('script');
      el.src = src;
      el.onload = () => res();
      el.onerror = () => rej(new Error('Firebase SDK 를 불러오지 못했습니다.'));
      document.head.appendChild(el);
    });
  }

  async function loadSdk() {
    if (window.firebase && firebase.database) return;
    await loadScript(`${SDK}firebase-app-compat.js`);
    await Promise.all([
      loadScript(`${SDK}firebase-auth-compat.js`),
      loadScript(`${SDK}firebase-database-compat.js`),
    ]);
  }

  /* ---------- 직렬화 ----------
     Firebase 는 null 을 지우고 배열을 객체로 바꿔버리기도 해서
     빈 자리는 '' 로 바꿔 보내고 읽을 때 되돌린다.                */
  const EMPTY = '';

  function toArr(v) {
    if (Array.isArray(v)) return v.filter((x) => x !== undefined && x !== null);
    if (v && typeof v === 'object') {
      return Object.keys(v).sort((a, b) => Number(a) - Number(b)).map((k) => v[k]);
    }
    return [];
  }

  function fill4(a) {
    const s = a.slice(0, 4);
    while (s.length < 4) s.push(null);
    return s;
  }

  function encodeDay(d) {
    return {
      meta: {
        date: d.date,
        courtCount: d.courtCount,
        queueRows: d.queueRows,
        autoAdvance: !!d.autoAdvance,
        fillCourts: !!d.fillCourts,
        includePlaying: !!d.includePlaying,
        session: {
          no: (d.session && d.session.no) || 0,
          startedAt: (d.session && d.session.startedAt) || 0,
          endedAt: (d.session && d.session.endedAt) || 0,
        },
      },
      sessions: d.sessions || [],
      courts: d.courts.map((c) => ({
        players: c.players.map((p) => p || EMPTY),
        startedAt: c.startedAt || 0,
      })),
      queues: d.queues.map((q) => q.map((p) => p || EMPTY)),
      attendance: d.attendance || {},
      games: d.games || {},
      combos: d.combos || {},
      pairs: d.pairs || {},
      history: d.history || [],
    };
  }

  function decodeDay(raw) {
    const r = raw || {};
    const meta = r.meta || {};
    return {
      date: meta.date || Util.todayStr(),
      courtCount: Number(meta.courtCount) || 2,
      queueRows: Number(meta.queueRows) || 3,
      autoAdvance: !!meta.autoAdvance,
      fillCourts: !!meta.fillCourts,
      includePlaying: !!meta.includePlaying,
      session: {
        no: (meta.session && meta.session.no) || 0,
        startedAt: (meta.session && meta.session.startedAt) || null,
        endedAt: (meta.session && meta.session.endedAt) || null,
      },
      sessions: toArr(r.sessions),
      courts: toArr(r.courts).map((c) => ({
        players: fill4(toArr(c && c.players).map((p) => p || null)),
        startedAt: c && c.startedAt ? c.startedAt : null,
      })),
      queues: toArr(r.queues).map((q) => fill4(toArr(q).map((p) => p || null))),
      attendance: r.attendance || {},
      games: r.games || {},
      combos: r.combos || {},
      pairs: r.pairs || {},
      history: toArr(r.history),
    };
  }

  /* ---------- 쓰기 ---------- */
  function push(snapshot) {
    if (!isOn() || role !== 'write') return;    // 회원(읽기 전용)은 올리지 않는다
    pending = snapshot;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(flush, PUSH_DELAY);
  }

  function flush() {
    pushTimer = null;
    if (!rootRef || !pending) return;
    const day = encodeDay(pending.day);
    const nodes = {
      users: pending.users,
      members: pending.members,
      'day/meta': day.meta,
      'day/sessions': day.sessions,
      'day/courts': day.courts,
      'day/queues': day.queues,
      'day/attendance': day.attendance,
      'day/games': day.games,
      'day/combos': day.combos,
      'day/pairs': day.pairs,
      'day/history': day.history,
    };
    pending = null;

    const updates = {};
    Object.keys(nodes).forEach((k) => {
      const json = JSON.stringify(nodes[k]);
      if (sent[k] !== json) { updates[k] = nodes[k]; sent[k] = json; }
    });
    if (!Object.keys(updates).length) return;

    rootRef.update(updates).catch((err) => {
      sent = {};                                  // 다음에 다시 시도
      setStatus('error', `쓰기 실패: ${err.message}`);
    });
  }

  const hasPending = () => !!pushTimer;

  /* ---------- 역할별 계정 ---------- */
  const SALT = 'etoa-game-2026';

  /** 난독화해 둔 비밀번호를 되돌린다. 계정 주소를 열쇠에 섞어 둘이 달라 보이게 한다. */
  function reveal(secret, email) {
    try {
      const raw = atob(secret);
      const key = SALT + email;
      let out = '';
      for (let i = 0; i < raw.length; i++) {
        out += String.fromCharCode(raw.charCodeAt(i) ^ key.charCodeAt(i % key.length));
      }
      return out;
    } catch (e) {
      return '';
    }
  }

  /** 관리자·운영진은 읽기+쓰기 계정, 회원은 읽기 전용 계정으로 DB 에 로그인한다. */
  function account(cfg, r) {
    const a = (cfg && cfg.accounts) || {};
    const picked = r === 'write' ? a.write : a.read;
    if (!picked || !picked.email) return null;
    const password = picked.password || reveal(picked.secret, picked.email);
    return password ? { email: picked.email, password } : null;
  }

  /** 로그인하고, 계정이 아직 없으면 처음 한 번 만들어 준다. */
  async function signIn(acct) {
    const auth = firebase.auth();
    try {
      await auth.signInWithEmailAndPassword(acct.email, acct.password);
      return;
    } catch (err) {
      const code = err.code || '';
      const missing = code === 'auth/user-not-found' || code === 'auth/invalid-credential';
      if (!missing) throw err;
      try {
        await auth.createUserWithEmailAndPassword(acct.email, acct.password);
      } catch (err2) {
        // 계정은 있는데 비밀번호가 다른 경우
        if ((err2.code || '') === 'auth/email-already-in-use') {
          const e = new Error('비밀번호 불일치');
          e.code = 'auth/wrong-password';
          throw e;
        }
        throw err2;
      }
    }
  }

  function authMessage(err, acct) {
    const code = err.code || '';
    if (code === 'auth/operation-not-allowed') {
      return 'Firebase 콘솔 → Authentication → Sign-in method 에서 "이메일/비밀번호" 를 켜주세요.';
    }
    if (code === 'auth/wrong-password') {
      return `${acct.email} 계정의 비밀번호가 설정과 다릅니다. Firebase 콘솔 → Authentication → Users 에서 비밀번호를 맞춰주세요.`;
    }
    if (code === 'auth/api-key-not-valid' || code === 'auth/invalid-api-key') {
      return 'apiKey 가 올바르지 않습니다. Firebase 콘솔 → 프로젝트 설정 → 내 앱 에서 다시 복사해주세요.';
    }
    if (code === 'auth/weak-password') {
      return '동기화 계정 비밀번호가 6자 미만입니다. firebase-config.js 에서 더 길게 바꿔주세요.';
    }
    return `동기화 로그인 실패: ${code || err.message}`;
  }

  /* ---------- 연결 ---------- */
  async function connect() {
    const cfg = config();
    if (!cfg) { setStatus('off'); return false; }
    if (!cfg.apiKey) {
      setStatus('off', 'apiKey 만 넣으면 실시간 동기화가 켜집니다. Firebase 콘솔 → 프로젝트 설정 → 내 앱 에서 복사해 아래에 붙여넣으세요.');
      return false;
    }

    setStatus('connecting');
    try {
      await loadSdk();
      const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);

      const acct = account(cfg, role);
      if (!acct) { setStatus('off', '동기화 계정 설정이 없습니다.'); return false; }
      try {
        await signIn(acct);
      } catch (err) {
        setStatus('error', authMessage(err, acct));
        return false;
      }

      const db = firebase.database(app);
      dbRef = db;
      rootRef = db.ref(Store.currentClub());

      // 최고 관리자 계정은 모임과 무관하다
      siteRef = db.ref(SITE);
      siteRef.on('value', (snap) => {
        const raw = snap.val();
        if (raw) Store.applySite({ admins: toArr(raw.admins) });
        onSiteCb();
      }, () => { /* 권한 없으면 조용히 넘어간다 */ });

      // 모임 목록은 어느 모임에 있든 함께 본다
      clubsRef = db.ref(CLUBS);
      clubsRef.on('value', (snap) => {
        const raw = snap.val();
        if (raw) Store.applyClubs(raw);
        onClubsCb(Store.clubList());
      }, () => { /* 권한 없으면 조용히 넘어간다 */ });

      db.ref('.info/connected').on('value', (s) => {
        if (status === 'error') return;
        setStatus(s.val() ? 'online' : 'offline');
      });

      attachRoot();

      return true;
    } catch (err) {
      setStatus('error', err.message);
      return false;
    }
  }

  /**
   * 앱 로그인 역할에 맞춰 DB 접속을 맞춘다.
   * @param {'write'|'read'|null} next 관리자·운영진 = write, 회원 = read, 로그아웃 = null
   */
  /** 다른 모임으로 갈아탄다. 그 모임 노드를 새로 구독한다. */
  async function switchClub() {
    if (!dbRef) return false;
    detachRef();
    rootRef = dbRef.ref(Store.currentClub());
    attachRoot();
    return true;
  }

  /** 최고 관리자 목록을 서버에 올린다. */
  function pushSite(data) {
    if (!siteRef || role !== 'write') return;
    siteRef.set({ admins: (data && data.admins) || [] }).catch(() => { /* 읽기 전용이면 무시 */ });
  }

  /** 모임 목록을 서버에 올린다. */
  function pushClubs(list) {
    if (!clubsRef || role !== 'write') return;
    clubsRef.update(list).catch(() => { /* 읽기 전용이면 무시 */ });
  }

  /** 다른 모임의 계정 목록을 읽는다. */
  function readClubUsers(id) {
    if (!dbRef) return Promise.resolve(null);
    return dbRef.ref(`${id}/users`).once('value').then((s) => toArr(s.val())).catch(() => null);
  }

  /** 다른 모임의 계정 목록을 덮어쓴다. */
  function writeClubUsers(id, users) {
    if (!dbRef || role !== 'write') return Promise.reject(new Error('쓰기 권한이 없습니다.'));
    return dbRef.ref(`${id}/users`).set(users);
  }

  /** 새 모임 폴더에 첫 데이터를 심는다. */
  function seedClub(id, snapshot) {
    if (!dbRef || role !== 'write') return Promise.reject(new Error('쓰기 권한이 없습니다.'));
    const day = encodeDay(snapshot.day);
    return dbRef.ref(id).set({
      users: snapshot.users,
      members: snapshot.members,
      day: {
        meta: day.meta, courts: day.courts, queues: day.queues,
        sessions: day.sessions,
        attendance: day.attendance, games: day.games,
        combos: day.combos, pairs: day.pairs, history: day.history,
      },
    });
  }

  async function setRole(next) {
    if (next === role && (status === 'online' || status === 'offline')) return true;
    role = next;
    if (!next) { await signOutAll(); return false; }
    detachRef();
    return connect();
  }

  async function signOutAll() {
    detachRef();
    try {
      if (window.firebase && firebase.apps.length) await firebase.auth().signOut();
    } catch (e) { /* noop */ }
    setStatus('off');
  }

  function attachRoot() {
    if (!rootRef) return;
    sawRemote = false;
    sent = {};
    rootRef.on('value', (snap) => {
      const raw = snap.val();
      if (!raw || (!raw.users && !raw.members && !raw.day)) {
        if (!sawRemote) { sawRemote = true; onSeedCb(); }   // 비어 있으면 지금 상태를 올린다
        return;
      }
      sawRemote = true;
      if (hasPending()) return;                             // 내가 보낼 게 남았으면 덮어쓰지 않는다
      onRemoteCb({
        users: toArr(raw.users),
        members: toArr(raw.members),
        day: decodeDay(raw.day),
      });
    }, (err) => {
      setStatus('error', `읽기 실패: ${err.message}. Realtime Database 규칙을 확인해주세요.`);
    });
  }

  function detachRef() {
    try { if (rootRef) rootRef.off(); } catch (e) { /* noop */ }
    rootRef = null;
    sent = {};
    sawRemote = false;
    clearTimeout(pushTimer);
    pushTimer = null;
    pending = null;
  }

  function disconnect() {
    role = null;
    detachRef();
    setStatus('off');
  }

  const onRemote = (fn) => { onRemoteCb = fn; };
  const onStatus = (fn) => { onStatusCb = fn; };
  const onSeed = (fn) => { onSeedCb = fn; };
  const onClubs = (fn) => { onClubsCb = fn; };
  const onSite = (fn) => { onSiteCb = fn; };

  return {
    config, setRole, disconnect, ready,
    push, pushClubs, pushSite, seedClub, switchClub, readClubUsers, writeClubUsers,
    isOn, state, onRemote, onStatus, onSeed, onClubs, onSite,
  };
})();
