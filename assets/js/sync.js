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
  const CFG_KEY = 'etoa.firebase';
  const ROOT = 'etoa';
  const PUSH_DELAY = 250;

  let rootRef = null;
  let status = 'off';            // off | connecting | online | offline | error
  let detail = '';
  let onRemoteCb = () => {};
  let onStatusCb = () => {};
  let onSeedCb = () => {};
  let pushTimer = null;
  let pending = null;
  let sent = {};                 // 노드별 마지막으로 보낸 JSON
  let sawRemote = false;

  /* ---------- 설정 ---------- */
  function config() {
    try {
      const raw = localStorage.getItem(CFG_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* noop */ }
    return window.ETOA_FIREBASE || null;
  }

  function saveConfig(cfg) {
    try {
      if (cfg) localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
      else localStorage.removeItem(CFG_KEY);
    } catch (e) { /* noop */ }
  }

  /** 붙여넣은 텍스트에서 설정 객체를 뽑아낸다. JS 조각도 받아준다. */
  function parseConfig(text) {
    const t = String(text).trim();
    if (!t) throw new Error('설정을 붙여넣어 주세요.');
    let obj = null;
    try {
      obj = JSON.parse(t);
    } catch (e) {
      const m = t.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('설정 형식을 알아보지 못했습니다.');
      try {
        // eslint-disable-next-line no-new-func
        obj = Function(`"use strict";return (${m[0]});`)();
      } catch (e2) {
        throw new Error('설정 형식을 알아보지 못했습니다.');
      }
    }
    if (!obj || !obj.apiKey) throw new Error('apiKey 가 없습니다.');
    if (!obj.databaseURL) throw new Error('databaseURL 이 없습니다. Realtime Database 를 먼저 만들어주세요.');
    return obj;
  }

  const isOn = () => status === 'online' || status === 'offline';
  const state = () => ({ status, detail, configured: !!config() });

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
        includePlaying: !!d.includePlaying,
      },
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
      includePlaying: !!meta.includePlaying,
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
    if (!isOn()) return;
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

  /* ---------- 연결 ---------- */
  async function connect() {
    const cfg = config();
    if (!cfg) { setStatus('off'); return false; }

    setStatus('connecting');
    try {
      await loadSdk();
      const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
      try {
        await firebase.auth().signInAnonymously();
      } catch (err) {
        setStatus('error', `익명 로그인 실패: ${err.code || err.message}. Firebase 콘솔에서 Authentication > 익명 로그인을 켜주세요.`);
        return false;
      }

      const db = firebase.database(app);
      rootRef = db.ref(ROOT);

      db.ref('.info/connected').on('value', (s) => {
        if (status === 'error') return;
        setStatus(s.val() ? 'online' : 'offline');
      });

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

      return true;
    } catch (err) {
      setStatus('error', err.message);
      return false;
    }
  }

  function disconnect() {
    try { if (rootRef) rootRef.off(); } catch (e) { /* noop */ }
    rootRef = null;
    sent = {};
    sawRemote = false;
    clearTimeout(pushTimer);
    pushTimer = null;
    setStatus('off');
  }

  const onRemote = (fn) => { onRemoteCb = fn; };
  const onStatus = (fn) => { onStatusCb = fn; };
  const onSeed = (fn) => { onSeedCb = fn; };

  return {
    config, saveConfig, parseConfig, connect, disconnect,
    push, isOn, state, onRemote, onStatus, onSeed,
  };
})();
