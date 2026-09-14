/* ===========================================================
   store.js — 데이터 모델 & localStorage 영속화
   =========================================================== */
const Store = (() => {
  const KEY_PREFIX = 'etoa.gameboard.v1.';   // 모임별로 따로 저장한다
  const CLUBS_KEY = 'etoa.clubs';            // 모임 목록
  const CLUB_KEY = 'etoa.club';              // 이 기기에서 마지막으로 고른 모임
  const SESSION_KEY = 'etoa.current.';       // 모임별 로그인 세션
  const SITE_KEY = 'etoa.site';              // 사이트 최고 관리자 (어느 모임에도 속하지 않는다)
  const SITE_SESSION = 'etoa.current.__site';

  /** 처음부터 있는 모임. 데이터는 루트의 etoa 폴더에 들어간다. */
  const ROOT_CLUB = 'etoa';
  const CLUB_ID_RE = /^[a-z0-9][a-z0-9-]{1,19}$/;

  let clubId = ROOT_CLUB;
  let clubs = null;                          // { id: {name, createdAt} }
  let site = null;                           // { admins: [...] }

  /** 급수 점수표 (남/여) */
  const SCORE = {
    M: { A: 8, B: 7, C: 6, D: 5, N: 4 },
    F: { A: 6.5, B: 5.5, C: 4.5, D: 3.5, N: 2.5 },
  };
  const GRADES = ['A', 'B', 'C', 'D', 'N'];
  const GRADE_LABEL = { A: 'A', B: 'B', C: 'C', D: 'D', N: '초심' };
  const GENDER_LABEL = { M: '남', F: '여' };

  const MAX_COURTS = 4;
  const MAX_QUEUES = 4;
  const MAX_GUEST_BOOK = 300;   // 과거 게스트 보관 수

  let state = null;

  const emptySlots = () => [null, null, null, null];

  function blankSession() {
    return { startedAt: null, endedAt: null };
  }

  function blankDay(date) {
    return {
      date,
      session: blankSession(),   // 오늘의 모임 (하루에 여러 번 열 수 있다)
      sessions: [],              // 끝난 모임 요약
      courtCount: 2,
      queueRows: 3,
      autoAdvance: false,   // 경기 종료 시 1번 대기 자동 투입
      fillCourts: false,    // 자동 편성이 빈 코트까지 채울지
      includePlaying: false,
      attendance: {},                       // memberId -> true
      courts: [],                           // [{ players:[id|null x4], startedAt }]
      queues: [],                           // [[id|null x4], ...]
      games: {},                            // memberId -> 오늘 경기수
      combos: {},                           // '4인조합키' -> 횟수
      pairs: {},                            // '2인조합키' -> 횟수
      partners: {},                         // memberId -> 짝 memberId (서로 가리킨다)
      history: [],                          // 최근이 앞
    };
  }

  function defaults() {
    return { version: 3, users: [], members: [], day: blankDay(Util.todayStr()) };
  }

  /* ---------- 사이트 최고 관리자 ----------
     어느 모임에도 속하지 않는다. 모임을 만들고 관리하는 자리다. */
  let pushSite = null;
  const setPushSite = (fn) => { pushSite = fn; };

  function loadSite() {
    try {
      const raw = localStorage.getItem(SITE_KEY);
      if (raw) site = JSON.parse(raw);
    } catch (e) { /* noop */ }
    if (!site || !Array.isArray(site.admins)) site = { admins: [] };
    return site;
  }

  function saveSite() {
    try { localStorage.setItem(SITE_KEY, JSON.stringify(site)); } catch (e) { /* noop */ }
    if (pushSite) pushSite(site);
  }

  const siteAdmins = () => (site && site.admins) || [];

  function addSiteAdmin(user) {
    site.admins.push(user);
    saveSite();
  }

  /** 최고 관리자 목록을 고친 뒤 저장한다. */
  const saveSiteAdmins = () => saveSite();

  function removeSiteAdmin(username) {
    if (siteAdmins().length <= 1) throw new Error('최고 관리자는 최소 한 명 있어야 합니다.');
    site.admins = site.admins.filter((u) => u.username !== username);
    saveSite();
  }

  function applySite(remote) {
    if (!remote || !Array.isArray(remote.admins)) return;
    site = { admins: remote.admins.filter(Boolean) };
    try { localStorage.setItem(SITE_KEY, JSON.stringify(site)); } catch (e) { /* noop */ }
  }

  function siteUsername() {
    try { return localStorage.getItem(SITE_SESSION); } catch (e) { return null; }
  }
  function setSiteUsername(u) {
    try { u ? localStorage.setItem(SITE_SESSION, u) : localStorage.removeItem(SITE_SESSION); } catch (e) { /* noop */ }
  }

  /* ---------- 모임 목록 ---------- */
  function defaultClubs() {
    return { [ROOT_CLUB]: { name: 'EtoA', createdAt: 0 } };
  }

  function loadClubs() {
    try {
      const raw = localStorage.getItem(CLUBS_KEY);
      if (raw) clubs = Object.assign(defaultClubs(), JSON.parse(raw));
    } catch (e) { /* noop */ }
    if (!clubs) clubs = defaultClubs();
    if (!clubs[ROOT_CLUB]) clubs[ROOT_CLUB] = defaultClubs()[ROOT_CLUB];
    if (clubs[ROOT_CLUB].admin) delete clubs[ROOT_CLUB].admin;
    return clubs;
  }

  function saveClubs() {
    try { localStorage.setItem(CLUBS_KEY, JSON.stringify(clubs)); } catch (e) { /* noop */ }
    if (pushClubs) pushClubs(clubs);
  }

  const clubList = () => Object.keys(clubs || {})
    .map((id) => Object.assign({ id }, clubs[id]))
    .sort((a, b) => (a.id === ROOT_CLUB ? -1 : b.id === ROOT_CLUB ? 1 : (a.createdAt || 0) - (b.createdAt || 0)));

  const currentClub = () => clubId;
  const clubName = (id = clubId) => (clubs && clubs[id] && clubs[id].name) || id;
  const isRootClub = () => clubId === ROOT_CLUB;

  function addClub(id, name) {
    const key = String(id).trim().toLowerCase();
    if (!CLUB_ID_RE.test(key)) throw new Error('모임 아이디는 영문 소문자·숫자·하이픈 2~20자로 입력해주세요.');
    if (clubs[key]) throw new Error('이미 있는 모임 아이디입니다.');
    const label = String(name).trim();
    if (!label) throw new Error('모임 이름을 입력해주세요.');
    clubs[key] = { name: label, createdAt: Date.now() };
    saveClubs();
    return key;
  }

  const clubLogo = (id = clubId) => (clubs && clubs[id] && clubs[id].logo) || '';
  const clubAdmin = (id = clubId) => (clubs && clubs[id] && clubs[id].admin) || '';

  /** 모임 목록에 그 모임의 관리자 아이디를 적어둔다. */
  function setClubAdmin(id, username) {
    if (!clubs[id]) return;
    if (username) clubs[id].admin = username;
    else delete clubs[id].admin;
    saveClubs();
  }

  /** 예전 판이 EtoA 목록에 적어둔 최고 관리자 아이디를 지운다. */
  function stripRootAdminName() {
    if (clubs && clubs[ROOT_CLUB] && clubs[ROOT_CLUB].admin) {
      delete clubs[ROOT_CLUB].admin;
      saveClubs();
      return true;
    }
    return false;
  }

  function setClubLogo(id, dataUrl) {
    if (!clubs[id]) return;
    if (dataUrl) clubs[id].logo = dataUrl;
    else delete clubs[id].logo;
    saveClubs();
  }

  function renameClub(id, name) {
    if (!clubs[id]) return;
    clubs[id].name = String(name).trim() || id;
    saveClubs();
  }

  function removeClub(id) {
    if (id === ROOT_CLUB) throw new Error('EtoA 는 삭제할 수 없습니다.');
    delete clubs[id];
    saveClubs();
    try { localStorage.removeItem(KEY_PREFIX + id); } catch (e) { /* noop */ }
  }

  /**
   * EtoA 가 아닌 모임에 심어져 있던 기본 관리자(admin/1111)를 지운다.
   * 예전 판은 모든 모임에 이 계정을 자동으로 만들어, 다른 모임 계정 목록에
   * EtoA 관리자가 섞여 보이고 누구나 들어갈 수 있었다.
   */
  function cleanupSeededAdmin() {
    if (clubId === ROOT_CLUB) return false;
    const before = state.users.length;
    state.users = state.users.filter(
      (u) => !(u.username === 'admin' && u.mustChangePassword && u.role === 'admin'),
    );
    return state.users.length !== before;
  }

  /** 다른 모임의 계정 목록을 이 기기에 저장된 사본에서 읽는다. */
  function localClubUsers(id) {
    try {
      const raw = localStorage.getItem(KEY_PREFIX + id);
      if (raw) return JSON.parse(raw).users || [];
    } catch (e) { /* noop */ }
    return [];
  }

  /** 다른 모임의 계정 목록을 이 기기 사본에 써둔다. */
  function saveLocalClubUsers(id, users) {
    try {
      const raw = localStorage.getItem(KEY_PREFIX + id);
      const st = raw ? JSON.parse(raw) : defaults();
      st.users = users;
      localStorage.setItem(KEY_PREFIX + id, JSON.stringify(st));
    } catch (e) { /* noop */ }
  }

  /** 새 모임의 첫 관리자 계정만 담은 초기 데이터 */
  function blankClubState(adminUser) {
    const st = defaults();
    if (adminUser) st.users.push(adminUser);
    return st;
  }

  /* ---------- 영속화 ---------- */
  let pushRemote = null;               // Sync 가 붙으면 여기로 밀어 올린다
  let pushClubs = null;                // 모임 목록을 올리는 통로
  let applyingRemote = false;

  const setPushRemote = (fn) => { pushRemote = fn; };
  const setPushClubs = (fn) => { pushClubs = fn; };

  /** 서버에서 받은 모임 목록을 반영한다. 되돌려 보내지는 않는다. */
  function applyClubs(remote) {
    if (!remote || typeof remote !== 'object') return;
    clubs = Object.assign(defaultClubs(), remote);
    if (clubs[ROOT_CLUB] && clubs[ROOT_CLUB].admin) delete clubs[ROOT_CLUB].admin;
    try { localStorage.setItem(CLUBS_KEY, JSON.stringify(clubs)); } catch (e) { /* noop */ }
  }
  const snapshot = () => ({ users: state.users, members: state.members, day: state.day });

  function saveLocal() {
    try {
      localStorage.setItem(KEY_PREFIX + clubId, JSON.stringify(state));
    } catch (e) {
      console.error('저장 실패', e);
    }
  }

  function save() {
    saveLocal();
    if (pushRemote && !applyingRemote) pushRemote(snapshot());
  }

  /** 원격에서 받은 내용으로 통째로 교체한다. 되돌려 보내지는 않는다. */
  function applyRemote(data) {
    applyingRemote = true;
    try {
      state.users = Array.isArray(data.users) ? data.users : [];
      state.members = Array.isArray(data.members) ? data.members : [];
      const cleaned = cleanupSeededAdmin();
      state.day = Object.assign(blankDay(Util.todayStr()), data.day || {});
      state.day.attendance = state.day.attendance || {};
      state.day.games = state.day.games || {};
      state.day.combos = state.day.combos || {};
      state.day.pairs = state.day.pairs || {};
      state.day.partners = state.day.partners || {};
      state.day.history = state.day.history || [];
      const rolled = rolloverIfNeeded();
      normalizeDay();
      saveLocal();
      return rolled || cleaned;        // 바뀐 게 있으면 호출한 쪽에서 다시 올린다
    } finally {
      applyingRemote = false;
    }
  }

  function load(id) {
    loadClubs();
    loadSite();
    if (id && clubs[id]) clubId = id;
    else {
      let saved = null;
      try { saved = localStorage.getItem(CLUB_KEY); } catch (e) { /* noop */ }
      clubId = saved && clubs[saved] ? saved : ROOT_CLUB;
    }
    try { localStorage.setItem(CLUB_KEY, clubId); } catch (e) { /* noop */ }

    let raw = null;
    try { raw = localStorage.getItem(KEY_PREFIX + clubId); } catch (e) { /* private mode */ }
    state = defaults();
    if (raw) {
      try { Object.assign(state, JSON.parse(raw)); } catch (e) { console.warn('데이터 파싱 실패, 초기화합니다.'); }
    }
    state.users = state.users || [];
    state.members = (state.members || []).map((m) => Object.assign({ archived: false }, m, { archived: !!m.archived }));
    state.day = Object.assign(blankDay(Util.todayStr()), state.day || {});

    // 기존 기기에도 '수동 투입' 기본값이 적용되도록 한 번만 정리한다
    if (!state.version || state.version < 2) {
      state.day.autoAdvance = false;
      state.day.fillCourts = false;
      state.version = 2;
    }
    cleanupSeededAdmin();

    rolloverIfNeeded();
    normalizeDay();
    return state;
  }

  /** 날짜가 바뀌면 게스트를 과거 게스트로 넘기고 하루를 새로 시작한다. */
  function rolloverIfNeeded() {
    const today = Util.todayStr();
    if (state.day.date === today) return false;
    if (sessionOpen()) endSession();   // 새벽 4시가 지나면 열려 있던 모임을 닫는다
    const keep = { courtCount: state.day.courtCount, queueRows: state.day.queueRows, autoAdvance: state.day.autoAdvance, fillCourts: state.day.fillCourts, includePlaying: state.day.includePlaying, partners: state.day.partners || {}, sessions: [] };
    keep.sessions = state.day.sessions || [];
    archiveGuests(state.day.date);
    state.day = Object.assign(blankDay(today), keep);
    return true;
  }

  /** 코트/대기 배열 길이를 설정값에 맞춘다. */
  function normalizeDay() {
    const d = state.day;
    // 경기가 하나도 없는 모임은 잘못 눌러 생긴 것이므로 기록에서 뺀다
    d.sessions = (d.sessions || []).filter((x) => x && (x.games || 0) > 0);
    d.courtCount = Math.min(MAX_COURTS, Math.max(1, Number(d.courtCount) || 1));
    d.queueRows = Math.min(MAX_QUEUES, Math.max(1, Number(d.queueRows) || 1));

    d.courts = d.courts || [];
    while (d.courts.length < d.courtCount) d.courts.push({ players: emptySlots(), startedAt: null });
    d.courts.length = d.courtCount;
    d.courts.forEach((c) => {
      c.players = (c.players || emptySlots()).slice(0, 4);
      while (c.players.length < 4) c.players.push(null);
    });

    d.queues = d.queues || [];
    while (d.queues.length < d.queueRows) d.queues.push(emptySlots());
    d.queues.length = d.queueRows;
    d.queues = d.queues.map((q) => {
      const s = (q || []).slice(0, 4);
      while (s.length < 4) s.push(null);
      return s;
    });

    // 짝 묶기: 없는 사람이나 한쪽만 남은 짝은 지운다
    d.partners = d.partners || {};
    Object.keys(d.partners).forEach((a) => {
      const b = d.partners[a];
      const alive = (id) => id && state.members.some((m) => m.id === id);
      if (!alive(a) || !alive(b) || d.partners[b] !== a) delete d.partners[a];
    });

    // 존재하지 않거나 미참석인 인원은 자리에서 제거
    const ok = (id) => id && state.members.some((m) => m.id === id) && d.attendance[id];
    d.courts.forEach((c) => { c.players = c.players.map((id) => (ok(id) ? id : null)); });
    d.queues = d.queues.map((q) => q.map((id) => (ok(id) ? id : null)));
  }

  /** 다른 모임으로 갈아탄다. 그 모임의 데이터를 새로 읽는다. */
  function setClub(id) {
    if (!clubs[id]) return false;
    load(id);
    return true;
  }

  /* ---------- 접근자 ---------- */
  const get = () => state;
  const day = () => state.day;
  const members = () => state.members.filter((m) => !m.archived);
  /** 과거 게스트(보관함). 최근 참석 순 */
  const pastGuests = () => state.members
    .filter((m) => m.guest && m.archived)
    .sort((a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')) || a.name.localeCompare(b.name, 'ko'));
  const users = () => state.users;
  const allMembers = () => state.members;
  const memberById = (id) => state.members.find((m) => m.id === id) || null;
  const scoreOf = (m) => (m ? SCORE[m.gender][m.grade] : 0);

  function placedIds() {
    const s = new Set();
    state.day.courts.forEach((c) => c.players.forEach((id) => id && s.add(id)));
    state.day.queues.forEach((q) => q.forEach((id) => id && s.add(id)));
    return s;
  }

  /** 지금 코트에서 뛰고 있는 사람 */
  function playingIdSet() {
    const s = new Set();
    state.day.courts.forEach((c) => c.players.forEach((id) => id && s.add(id)));
    return s;
  }

  /** 이미 대기 줄에 들어가 있는 사람 */
  function queuedIdSet() {
    const s = new Set();
    state.day.queues.forEach((q) => q.forEach((id) => id && s.add(id)));
    return s;
  }

  /**
   * 편성 계산에 쓰는 게임 수.
   * 지금 코트에서 뛰는 사람은 그 판을 마치고 대기로 들어가므로 +1 로 본다.
   */
  function gamesOfFn() {
    const playing = playingIdSet();
    return (m) => (state.day.games[m.id] || 0) + (playing.has(m.id) ? 1 : 0);
  }

  /**
   * 편성 후보 인원.
   * @param {boolean} includePlaying 코트에서 뛰는 사람도 후보에 넣을지 (대기 줄 편성 전용)
   */
  function candidateMembers(includePlaying) {
    const queued = queuedIdSet();
    const playing = playingIdSet();
    const gamesOf = gamesOfFn();
    return state.members
      .filter((m) => {
        if (!state.day.attendance[m.id]) return false;
        if (queued.has(m.id)) return false;              // 이미 대기 중이면 제외
        if (playing.has(m.id)) return !!includePlaying;  // 경기 중은 옵션에 따라
        return true;
      })
      .sort((a, b) => {
        const ga = gamesOf(a), gb = gamesOf(b);
        if (ga !== gb) return ga - gb;
        return a.name.localeCompare(b.name, 'ko');
      });
  }

  /** 오늘 참석했지만 아직 코트/대기에 배치되지 않은 인원(= 미편성) */
  function poolMembers() {
    const placed = placedIds();
    return state.members
      .filter((m) => state.day.attendance[m.id] && !placed.has(m.id))
      .sort((a, b) => {
        const ga = state.day.games[a.id] || 0, gb = state.day.games[b.id] || 0;
        if (ga !== gb) return ga - gb;                  // 적게 뛴 사람 먼저
        return a.name.localeCompare(b.name, 'ko');
      });
  }

  const attendees = () => state.members.filter((m) => state.day.attendance[m.id]);

  /* ---------- 짝 묶기 (파트너) ----------
     묶인 둘은 자동 편성에서 항상 같은 편이 된다.
     짝이 오늘 안 나왔으면 묶음을 무시하고 혼자서도 편성된다.               */

  /** 저장된 짝. 오늘 참석 여부는 보지 않는다. */
  const rawPartnerOf = (id) => (state.day.partners || {})[id] || null;

  /** 편성에 실제로 적용되는 짝. 둘 다 오늘 참석해야 한다. */
  function partnerOf(id) {
    const b = rawPartnerOf(id);
    if (!b) return null;
    return state.day.attendance[id] && state.day.attendance[b] ? b : null;
  }

  /** 묶인 짝 목록 [[aId, bId], ...] */
  function partnerPairs() {
    const p = state.day.partners || {};
    const seen = new Set();
    const out = [];
    Object.keys(p).forEach((a) => {
      const b = p[a];
      if (seen.has(a) || seen.has(b)) return;
      seen.add(a); seen.add(b);
      out.push([a, b]);
    });
    return out;
  }

  /** 두 사람을 묶는다. 이미 다른 사람과 묶여 있으면 그 묶음은 풀린다. */
  function setPartner(a, b) {
    if (!a || !b || a === b) return false;
    if (!memberById(a) || !memberById(b)) return false;
    const p = state.day.partners = state.day.partners || {};
    [a, b].forEach((x) => { const old = p[x]; if (old) { delete p[old]; delete p[x]; } });
    p[a] = b;
    p[b] = a;
    return true;
  }

  /** 짝을 푼다. */
  function clearPartner(id) {
    const p = state.day.partners || {};
    const b = p[id];
    if (!b) return false;
    delete p[b];
    delete p[id];
    return true;
  }

  function clearAllPartners() {
    state.day.partners = {};
  }

  /* ---------- 위치(포지션) 조작 ----------
     pos 문자열: 'pool' | 'c:<코트>:<슬롯>' | 'q:<줄>:<슬롯>'          */
  function getAt(pos) {
    if (!pos || pos === 'pool') return null;
    const [t, a, b] = pos.split(':');
    const i = Number(a), j = Number(b);
    if (t === 'c') return state.day.courts[i]?.players[j] ?? null;
    if (t === 'q') return state.day.queues[i]?.[j] ?? null;
    return null;
  }

  function setAt(pos, id) {
    if (!pos || pos === 'pool') return;
    const [t, a, b] = pos.split(':');
    const i = Number(a), j = Number(b);
    if (t === 'c' && state.day.courts[i]) state.day.courts[i].players[j] = id || null;
    if (t === 'q' && state.day.queues[i]) state.day.queues[i][j] = id || null;
  }

  function findPos(id) {
    const d = state.day;
    for (let i = 0; i < d.courts.length; i++) {
      const j = d.courts[i].players.indexOf(id);
      if (j >= 0) return `c:${i}:${j}`;
    }
    for (let i = 0; i < d.queues.length; i++) {
      const j = d.queues[i].indexOf(id);
      if (j >= 0) return `q:${i}:${j}`;
    }
    return 'pool';
  }

  /**
   * 드래그/탭 이동. 대상이 차 있으면 서로 자리를 바꾼다.
   * 같은 사람이 코트와 대기에 동시에 있을 수 있으므로(경기 중 인원 포함 편성)
   * 출발 위치를 반드시 명시해서 엉뚱한 쪽이 움직이지 않게 한다.
   */
  function movePlayer(id, toPos, fromPos) {
    if (!id) return;
    const from = fromPos || findPos(id);
    if (from === toPos) return;
    if (toPos === 'pool') {
      if (from !== 'pool') setAt(from, null);
      touchCourt(from);
      return;
    }
    const occupant = getAt(toPos);
    setAt(toPos, id);
    if (from !== 'pool') setAt(from, occupant || null); // 서로 교체
    touchCourt(from); touchCourt(toPos);
  }

  /** 코트가 4명이 되는 순간 시작시각을 기록하고, 비면 지운다. */
  function touchCourt(pos) {
    if (!pos || !pos.startsWith('c:')) return;
    const i = Number(pos.split(':')[1]);
    const c = state.day.courts[i];
    if (!c) return;
    const n = c.players.filter(Boolean).length;
    if (n === 4 && !c.startedAt) c.startedAt = Date.now();
    if (n === 0) c.startedAt = null;
  }

  function refreshTimers() {
    state.day.courts.forEach((c, i) => touchCourt(`c:${i}:0`));
  }

  /* ---------- 조합 키 ---------- */
  const comboKey = (ids) => ids.slice().sort().join('|');
  const pairKey = (a, b) => [a, b].sort().join('|');

  /* ---------- 경기 종료 ---------- */
  function finishGame(courtIndex) {
    const d = state.day;
    const c = d.courts[courtIndex];
    if (!c) return null;
    const ids = c.players.filter(Boolean);
    let record = null;

    if (ids.length === 4) {
      const [a1, a2, b1, b2] = c.players;
      ids.forEach((id) => { d.games[id] = (d.games[id] || 0) + 1; });
      const ck = comboKey(ids);
      d.combos[ck] = (d.combos[ck] || 0) + 1;
      const pk1 = pairKey(a1, a2), pk2 = pairKey(b1, b2);
      d.pairs[pk1] = (d.pairs[pk1] || 0) + 1;
      d.pairs[pk2] = (d.pairs[pk2] || 0) + 1;

      const nm = (id) => memberById(id)?.name || '?';
      const sc = (id) => scoreOf(memberById(id));
      record = {
        at: Date.now(),
        court: courtIndex + 1,
        teamA: [nm(a1), nm(a2)],
        teamB: [nm(b1), nm(b2)],
        scoreA: sc(a1) + sc(a2),
        scoreB: sc(b1) + sc(b2),
        seconds: c.startedAt ? Math.round((Date.now() - c.startedAt) / 1000) : null,
      };
      d.history.unshift(record);
      if (d.history.length > 200) d.history.length = 200;
    }

    c.players = emptySlots();
    c.startedAt = null;
    return record;
  }

  /** 1번 대기를 해당 코트에 투입하고 대기 줄을 한 칸씩 당긴다. */
  function pushQueueToCourt(queueIndex, courtIndex) {
    const d = state.day;
    const q = d.queues[queueIndex];
    const c = d.courts[courtIndex];
    if (!q || !c) return false;
    if (q.filter(Boolean).length !== 4) return false;
    if (c.players.filter(Boolean).length > 0) return false;
    const playing = playingIdSet();
    if (q.some((id) => playing.has(id))) return false;   // 아직 경기 중인 사람이 섞여 있음
    c.players = q.slice();
    c.startedAt = Date.now();
    d.queues.splice(queueIndex, 1);
    d.queues.push(emptySlots());
    return true;
  }

  /** 해당 대기 줄이 지금 코트로 들어갈 수 있는 상태인지 */
  function queueReady(qi) {
    const q = state.day.queues[qi];
    if (!q || q.filter(Boolean).length !== 4) return false;
    const playing = playingIdSet();
    return !q.some((id) => playing.has(id));
  }

  function clearCourt(i) {
    const c = state.day.courts[i];
    if (!c) return;
    c.players = emptySlots();
    c.startedAt = null;
  }

  function clearQueueRow(i) {
    if (state.day.queues[i]) state.day.queues[i] = emptySlots();
  }

  function clearQueues() {
    state.day.queues = state.day.queues.map(() => emptySlots());
  }

  /* ---------- 모임 시작 / 종료 ---------- */
  const sessionOpen = () => !!(state.day.session && state.day.session.startedAt && !state.day.session.endedAt);
  const sessionEnded = () => !!(state.day.session && state.day.session.endedAt);

  /** 새 모임을 연다. 참석자와 코트 수를 고른 뒤에 열린다. 하루에 여러 번 열 수 있다. */
  function startSession(attendIds, courtCount) {
    const d = state.day;
    const courts = Math.min(MAX_COURTS, Math.max(1, Number(courtCount) || d.courtCount));
    const keep = {
      courtCount: courts, queueRows: d.queueRows, autoAdvance: d.autoAdvance,
      fillCourts: d.fillCourts, includePlaying: d.includePlaying,
      partners: d.partners || {},
      sessions: d.sessions || [],
    };
    const today = Util.todayStr();
    state.day = Object.assign(blankDay(today), keep);
    (attendIds || []).forEach((id) => { state.day.attendance[id] = true; });
    state.day.session = { startedAt: Date.now(), endedAt: null };
    normalizeDay();
    return state.day.session;
  }

  /** 코트와 대기를 비운다. */
  function clearBoard() {
    const d = state.day;
    d.courts.forEach((c) => { c.players = emptySlots(); c.startedAt = null; });
    d.queues = d.queues.map(() => emptySlots());
  }

  /**
   * 진행 중인 모임을 닫고 요약을 남긴다.
   * 한 경기도 하지 않았으면 잘못 누른 것으로 보고 기록을 남기지 않는다.
   * @returns 요약 (기록 없이 닫았으면 null)
   */
  function endSession() {
    const d = state.day;
    if (!sessionOpen()) return null;

    if (!d.history.length) {
      d.session = blankSession();
      clearBoard();
      return null;
    }

    d.session.endedAt = Date.now();
    const played = Object.values(d.games).reduce((a, b) => a + b, 0);
    const summary = {
      date: d.date,
      startedAt: d.session.startedAt,
      endedAt: d.session.endedAt,
      games: d.history.length,
      players: Object.keys(d.attendance).length,
      appearances: played,
    };
    d.sessions = d.sessions || [];
    d.sessions.unshift(summary);
    if (d.sessions.length > 60) d.sessions.length = 60;
    clearBoard();
    return summary;
  }

  function resetDay() {
    const keep = { courtCount: state.day.courtCount, queueRows: state.day.queueRows, autoAdvance: state.day.autoAdvance, fillCourts: state.day.fillCourts, includePlaying: state.day.includePlaying, attendance: state.day.attendance };
    state.day = Object.assign(blankDay(Util.todayStr()), keep);
    normalizeDay();
  }

  /* ---------- 멤버 ---------- */
  function addMember({ name, gender, grade, guest }) {
    const clean = String(name).trim();
    if (guest) {
      const old = state.members.find((x) => x.guest && x.archived && x.name === clean);
      if (old) {
        old.gender = gender === 'F' ? 'F' : 'M';
        old.grade = GRADES.includes(grade) ? grade : old.grade;
        return reviveGuest(old.id);
      }
    }
    const m = {
      id: Util.uid('m'),
      name: clean,
      gender: gender === 'F' ? 'F' : 'M',
      grade: GRADES.includes(grade) ? grade : 'D',
      guest: !!guest,
      archived: false,
      createdAt: Date.now(),
    };
    state.members.push(m);
    if (m.guest) state.day.attendance[m.id] = true; // 게스트는 당일 참석으로 자동 등록
    return m;
  }

  function updateMember(id, patch) {
    const m = memberById(id);
    if (m) Object.assign(m, patch);
    return m;
  }

  function removeMember(id) {
    state.members = state.members.filter((m) => m.id !== id);
    delete state.day.attendance[id];
    normalizeDay();
  }

  /** 오늘의 게스트를 과거 게스트로 넘긴다. 기록은 남는다. */
  function archiveGuests(date) {
    const on = date || state.day.date;
    state.members.forEach((m) => {
      if (!m.guest || m.archived) return;
      m.archived = true;
      m.lastSeen = on;
      delete state.day.attendance[m.id];
    });
    trimGuestBook();
  }

  /** 보관함이 무한정 늘지 않게 오래된 것부터 지운다. */
  function trimGuestBook() {
    const book = pastGuests();
    if (book.length <= MAX_GUEST_BOOK) return;
    const drop = new Set(book.slice(MAX_GUEST_BOOK).map((m) => m.id));
    state.members = state.members.filter((m) => !drop.has(m.id));
  }

  /** 과거 게스트를 오늘 참석으로 되살린다. */
  function reviveGuest(id) {
    const m = state.members.find((x) => x.id === id && x.guest && x.archived);
    if (!m) return null;
    m.archived = false;
    m.lastSeen = state.day.date;
    state.day.attendance[m.id] = true;
    return m;
  }

  /** 과거 게스트를 보관함에서 완전히 지운다. */
  function forgetGuest(id) {
    const before = state.members.length;
    state.members = state.members.filter((m) => !(m.id === id && m.guest && m.archived));
    return state.members.length < before;
  }

  function removeGuests() {
    archiveGuests(state.day.date);
    normalizeDay();
  }

  function setAttendance(id, on) {
    if (on) state.day.attendance[id] = true;
    else { delete state.day.attendance[id]; normalizeDay(); }
  }

  /* ---------- 표시 설정(이 브라우저 전용) ---------- */
  const SCORES_KEY = 'etoa.showScores';
  function showScores() {
    try { return localStorage.getItem(SCORES_KEY) === '1'; } catch (e) { return false; }
  }
  function setShowScores(on) {
    try { on ? localStorage.setItem(SCORES_KEY, '1') : localStorage.removeItem(SCORES_KEY); } catch (e) { /* noop */ }
  }

  /* ---------- 로그인 세션 ---------- */
  function currentUsername() {
    try { return localStorage.getItem(SESSION_KEY + clubId); } catch (e) { return null; }
  }
  function setCurrentUsername(u) {
    try { u ? localStorage.setItem(SESSION_KEY + clubId, u) : localStorage.removeItem(SESSION_KEY + clubId); } catch (e) { /* noop */ }
  }

  /** EtoA(루트 모임)에 로그인해 둔 아이디. 최고 관리자는 모임을 넘나들 수 있다. */
  function rootUsername() {
    try { return localStorage.getItem(SESSION_KEY + ROOT_CLUB); } catch (e) { return null; }
  }

  /* ---------- 내보내기 / 가져오기 ---------- */
  function exportJSON() {
    return JSON.stringify(state, null, 2);
  }
  function importJSON(text) {
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.members) || !Array.isArray(parsed.users)) {
      throw new Error('형식이 올바르지 않습니다.');
    }
    state = Object.assign(defaults(), parsed);
    state.day = Object.assign(blankDay(Util.todayStr()), state.day || {});
    rolloverIfNeeded();
    normalizeDay();
    save();
  }

  return {
    SCORE, GRADES, GRADE_LABEL, GENDER_LABEL, MAX_COURTS, MAX_QUEUES,
    load, save, get, day, members, allMembers, pastGuests, users, memberById, scoreOf,
    ROOT_CLUB, currentClub, clubName, clubList, isRootClub, setClub,
    addClub, renameClub, removeClub, blankClubState, applyClubs, setPushClubs,
    clubLogo, setClubLogo, clubAdmin, setClubAdmin, stripRootAdminName, localClubUsers, saveLocalClubUsers,
    siteAdmins, addSiteAdmin, removeSiteAdmin, saveSiteAdmins, applySite, setPushSite, siteUsername, setSiteUsername, loadSite,
    sessionOpen, sessionEnded, startSession, endSession,
    setPushRemote, applyRemote, snapshot,
    poolMembers, attendees, placedIds, playingIdSet, queuedIdSet, candidateMembers, gamesOfFn, queueReady,
    getAt, setAt, findPos, movePlayer, touchCourt, refreshTimers, normalizeDay, rolloverIfNeeded,
    rawPartnerOf, partnerOf, partnerPairs, setPartner, clearPartner, clearAllPartners,
    comboKey, pairKey, finishGame, pushQueueToCourt, clearCourt, clearQueueRow, clearQueues, resetDay,
    addMember, updateMember, removeMember, removeGuests, setAttendance,
    archiveGuests, reviveGuest, forgetGuest,
    currentUsername, setCurrentUsername, rootUsername, exportJSON, importJSON,
    showScores, setShowScores,
  };
})();
