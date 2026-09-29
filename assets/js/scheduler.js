/* ===========================================================
   scheduler.js — 편성 알고리즘

   우선순위
   1) 4명의 그날 게임 수 '합' 이 적은 조합 우선
      단, 가장 적은 합보다 +2 까지는 같은 것으로 본다
   2) 2:2 점수차가 적은 편성 우선
      0.5점차까지는 0점차와 같은 것으로 본다
      양 팀의 성별 구성이 같으면(남복·여복·혼복) 0.5점을 더 봐준다
      → 성별이 맞으면 1점차까지 0점차와 동일 취급
   3) 그날 해당 4인 조합이 함께 뛴 횟수가 적은 조합 우선
   4) 위가 모두 같으면 그 안에서 랜덤 선택

   파트너 묶기
   - 묶인 둘은 언제나 같은 편으로만 편성된다.
   - 짝이 오늘 안 나왔으면 묶음을 무시하고 혼자서도 편성된다.

   오래 쉰 사람
   - 20분 넘게 못 들어간 사람이 있으면 그중 가장 오래 쉰 한 명을
     이번 편성에 반드시 넣는다. (위 우선순위보다 앞선다)

   남복·여복 우선 (토글)
   - 켜면 위 우선순위가 같은 후보 중에서 넷이 같은 성별인 편성(남복·여복)을
     혼복보다 1.5배 확률로 뽑는다. 게임 수·점수차 우선순위는 그대로다.

   게임 중 인원 포함 · 여러 줄 미리 짜기
   - 코트에서 뛰는 사람을 대기 줄에 미리 넣을 때:
     가장 오래된 코트 인원은 1번 대기부터, 나머지 코트 인원은 경기 시작
     7분이 지났을 때만 2번 대기부터, 코트 수+1번째 대기부터는 누구나.
   - 이미 대기 줄에 선 사람도 코트 수만큼 떨어진 줄에는 다시 설 수 있다.
     (편성 게임 수를 크게 잡으면 계속 섞여서 대진이 이어진다)
   =========================================================== */
const Scheduler = (() => {
  /** 4인을 2:2로 나누는 3가지 경우 [A1,A2,B1,B2] */
  const SPLITS = [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2]];

  /** 완전탐색 상한. 넘어가면 무작위 샘플링으로 대체한다. */
  const MAX_COMBOS = 60000;


  /* --- 편성 규칙 상수 --- */
  /** 게임 수 합이 최소값 + 이 값 이내면 같은 것으로 본다 */
  const GAME_SUM_TOLERANCE = 2;
  /** 점수는 0.5 단위라 반점(0.5) 을 1 로 두는 정수로 계산해 오차를 없앤다 */
  const half = (m) => Math.round(Store.scoreOf(m) * 2);
  /** 기본으로 봐주는 점수차 0.5점 */
  const DIFF_GRACE = 1;
  /** 양 팀 성별 구성이 같을 때 추가로 봐주는 점수차 0.5점 */
  const GENDER_GRACE = 1;
  /** '남복·여복 우선' 을 켰을 때 남복·여복 후보에 주는 가중치 */
  const PURE_WEIGHT = 1.5;
  function nC4(n) {
    if (n < 4) return 0;
    return (n * (n - 1) * (n - 2) * (n - 3)) / 24;
  }

  /** 4인 조합을 하나씩 훑는다. 경우의 수가 너무 많으면 무작위 샘플링으로 대체. */
  function eachCombo(pool, fn, mustId) {
    // 반드시 넣어야 할 사람이 있으면 그 사람을 고정하고 나머지 3명만 고른다
    if (mustId) {
      const must = pool.find((m) => m.id === mustId);
      const rest = pool.filter((m) => m.id !== mustId);
      if (!must || rest.length < 3) return;
      const r = rest.length;
      for (let i = 0; i < r - 2; i++)
        for (let j = i + 1; j < r - 1; j++)
          for (let k = j + 1; k < r; k++)
            fn([must, rest[i], rest[j], rest[k]]);
      return;
    }
    const n = pool.length;
    if (nC4(n) <= MAX_COMBOS) {
      for (let i = 0; i < n - 3; i++)
        for (let j = i + 1; j < n - 2; j++)
          for (let k = j + 1; k < n - 1; k++)
            for (let l = k + 1; l < n; l++)
              fn([pool[i], pool[j], pool[k], pool[l]]);
      return;
    }
    const seen = new Set();
    let tries = 0;
    while (seen.size < MAX_COMBOS && tries < MAX_COMBOS * 3) {
      tries++;
      const four = Util.shuffle(pool).slice(0, 4);
      const key = Store.comboKey(four.map((m) => m.id));
      if (seen.has(key)) continue;
      seen.add(key);
      fn(four);
    }
  }

  /** 묶인 둘이 같은 편인지. 짝이 이 판에 없으면 그 편성은 못 쓴다. */
  function partnersKept(team) {
    for (const m of team) {
      const mate = Store.partnerOf(m.id);
      if (mate && !team.some((x) => x.id === mate)) return false;
    }
    return true;
  }

  function collectRanked(pool, day, gamesOf, mustId) {
    const cands = [];
    const planned = Store.plannedCombos();
    eachCombo(pool, (four) => {
      const h = four.map(half);
      const male = four.map((m) => (m.gender === 'M' ? 1 : 0));
      const gameSum = four.reduce((a, m) => a + gamesOf(m), 0);
      const ck = Store.comboKey(four.map((m) => m.id));
      const comboCount = (day.combos[ck] || 0) + (planned[ck] || 0);

      for (const [a, b, c, d] of SPLITS) {
        if (!partnersKept([four[a], four[b]]) || !partnersKept([four[c], four[d]])) continue;
        const diff2 = Math.abs((h[a] + h[b]) - (h[c] + h[d]));
        // 양 팀 성별 구성이 같으면(남복·여복·혼복) 점수차를 0.5점 더 봐준다
        const sameGender = (male[a] + male[b]) === (male[c] + male[d]);
        const grace = DIFF_GRACE + (sameGender ? GENDER_GRACE : 0);
        cands.push({
          players: [four[a], four[b], four[c], four[d]],
          gameSum, comboCount, sameGender,
          pure: male[0] === male[1] && male[1] === male[2] && male[2] === male[3],   // 넷이 같은 성별 = 남복·여복
          diff: diff2 / 2,
          effDiff2: Math.max(0, diff2 - grace),
          scoreA: (h[a] + h[b]) / 2,
          scoreB: (h[c] + h[d]) / 2,
        });
      }
    }, mustId);
    return cands;
  }

  function compareRanked(x, y) {
    if (x.sumTier !== y.sumTier) return x.sumTier - y.sumTier;
    if (x.effDiff2 !== y.effDiff2) return x.effDiff2 - y.effDiff2;
    if (x.comboCount !== y.comboCount) return x.comboCount - y.comboCount;
    return 0;
  }

  function rankedGame(pool, day, gamesOf) {
    if (!pool || pool.length < 4) return null;

    // 20분 넘게 못 들어간 사람이 있으면 그 사람을 끼워서만 찾는다
    const must = Store.restPriorityId(pool);
    let cands = must ? collectRanked(pool, day, gamesOf, must) : [];
    const forced = cands.length > 0;
    if (!cands.length) cands = collectRanked(pool, day, gamesOf);
    if (!cands.length) return null;

    let minSum = Infinity;
    for (const c of cands) if (c.gameSum < minSum) minSum = c.gameSum;
    const cut = minSum + GAME_SUM_TOLERANCE;   // 최소 합 +2 까지는 동일 취급

    let best = null;
    let bucket = [];
    for (const c of cands) {
      c.sumTier = Math.max(0, c.gameSum - cut);
      if (!best) { best = c; bucket = [c]; continue; }
      const cmp = compareRanked(c, best);
      if (cmp < 0) { best = c; bucket = [c]; }
      else if (cmp === 0) bucket.push(c);
    }
    const chosen = day.preferPure ? weightedPick(bucket) : Util.pick(bucket);
    return Object.assign(chosen, { relaxed: chosen.effDiff2 > 0, waited: forced ? must : null });
  }

  /** 남복·여복 후보는 1.5, 나머지는 1 의 무게로 하나를 뽑는다 */
  function weightedPick(bucket) {
    const total = bucket.reduce((a, c) => a + (c.pure ? PURE_WEIGHT : 1), 0);
    let r = Math.random() * total;
    for (const c of bucket) {
      r -= c.pure ? PURE_WEIGHT : 1;
      if (r < 0) return c;
    }
    return bucket[bucket.length - 1];
  }

  /**
   * 대기 줄 하나를 채울 후보. 게임 중 인원은 코트 순서·경과 시간이 허용하는 줄에만 넣는다.
   * @param {number} rowIndex 대기 줄 번호(0부터)
   */
  function poolForQueue(rowIndex, includePlaying) {
    const pool = Store.candidateMembers(includePlaying, rowIndex);
    if (!includePlaying) return pool;
    const info = Store.playingInfo();
    const now = Date.now();
    return pool.filter((m) => Store.canQueueFromCourt(m.id, rowIndex, now, info));
  }

  /**
   * 비어 있는 자리를 4명 단위로 채운다.
   * @param {boolean} includeCourts   빈 코트도 채울지. 기본은 대기 줄만 채운다.
   * @param {boolean} includePlaying  대기 줄을 짤 때 코트에서 뛰는 사람도 후보에 넣을지
   */
  function fillAll({ includeCourts = false, includeQueues = true, includePlaying = false, maxGames = Infinity } = {}) {
    const day = Store.day();
    let filled = 0;
    let relaxed = false;

    const fillInto = (kind, index) => {
      // 코트에는 이미 뛰고 있는 사람을 다시 넣을 수 없다. 대기 줄에만 허용.
      const pool = kind === 'q' ? poolForQueue(index, includePlaying) : Store.candidateMembers(false);
      if (pool.length < 4) return false;           // 이 자리는 못 채워도 뒤는 채울 수 있다
      const game = rankedGame(pool, day, Store.gamesOfFn());
      if (!game) return false;
      if (game.relaxed) relaxed = true;
      game.players.forEach((m, slot) => Store.setAt(`${kind}:${index}:${slot}`, m.id));
      if (kind === 'c') Store.touchCourt(`c:${index}:0`);
      return true;
    };

    if (includeCourts) {
      day.courts.forEach((c, i) => { if (c.players.every((p) => !p) && fillInto('c', i)) filled++; });
    }

    // 대기: 빈 줄을 앞에서부터 채운다.
    // 편성 게임 수를 정해 부르면 그 수만큼 짜고, 줄이 모자라면 줄을 늘려서라도 채운다.
    // 게임 수 없이 부르면(예전 동작) 지금 있는 빈 줄만 채운다.
    let games = 0;
    if (includeQueues) {
      const grow = Number.isFinite(maxGames);
      const limit = grow ? Store.MAX_QUEUES : day.queues.length;
      for (let i = 0; games < maxGames && i < limit; i++) {
        if (i >= day.queues.length) {
          day.queueRows = i + 1;
          Store.normalizeDay();
        }
        if (!day.queues[i].every((p) => !p)) continue;
        if (fillInto('q', i)) { filled++; games++; }
      }
    }

    return { filled, relaxed, remaining: Store.poolMembers().length };
  }

  /** 특정 코트/대기 줄 하나만 편성 */
  function fillOne(kind, index, includePlaying = false) {
    const day = Store.day();
    const base = `${kind}:${index}`;
    for (let s = 0; s < 4; s++) if (Store.getAt(`${base}:${s}`)) return { filled: 0, reason: 'occupied' };

    const pool = kind === 'q' ? poolForQueue(index, includePlaying) : Store.candidateMembers(false);
    if (pool.length < 4) return { filled: 0, reason: 'short' };

    const game = rankedGame(pool, day, Store.gamesOfFn());
    if (!game) return { filled: 0, reason: 'none' };

    game.players.forEach((m, slot) => Store.setAt(`${base}:${slot}`, m.id));
    if (kind === 'c') Store.touchCourt(`c:${index}:0`);
    return { filled: 1, relaxed: !!game.relaxed, diff: game.diff, comboCount: game.comboCount };
  }

  /* ---------- 우선 편성 ----------
     정해진 사람(1~4명)을 넣고 나머지를 같은 규칙으로 채워 한 줄을 완성한다. */

  /** 원하는 구성이 가능한지. 남복/여복/혼복/상관없음 */
  function compAllowed(four, comp) {
    const mc = four.reduce((a, m) => a + (m.gender === 'M' ? 1 : 0), 0);
    if (comp === 'mm') return mc === 4;
    if (comp === 'ff') return mc === 0;
    if (comp === 'mixed') return mc === 2;
    return true;
  }

  /**
   * @param {string[]} fixedIds 반드시 들어갈 사람 (1~4명)
   * @param {object} opt
   *   rowIndex       채우려는 대기 줄 (후보 규칙에 쓴다)
   *   composition    'any' | 'mm' | 'ff' | 'mixed'
   *   sameTeam       fixed 가 2명일 때 둘을 같은 편으로
   *   slotTeams      { id: 'A'|'B' } 손으로 놓은 자리의 편. 같은 편끼리는 같은 편에, 다른 편은 다른 편에 둔다.
   *   includePlaying 코트에서 뛰는 사람도 채움 후보에 넣을지
   *   allowQueued    다른 대기 줄에 선 사람도 후보에 넣을지 (우선 편성: 뽑히면 그 줄에서 빠진다)
   *   ignorePartners 파트너 묶기를 무시할지 (우선 편성은 운영진이 직접 정하는 것이라 무시)
   * @returns { players, scoreA, scoreB, diff, auto } | null
   */
  function completeGame(fixedIds, opt = {}) {
    const day = Store.day();
    const fixed = (fixedIds || []).map((id) => Store.memberById(id)).filter(Boolean);
    if (!fixed.length || fixed.length > 4) return null;
    const comp = opt.composition || 'any';
    const fixedSet = new Set(fixed.map((m) => m.id));
    let pool = opt.allowQueued
      ? Store.priorityCandidates(opt.rowIndex, fixed.map((m) => m.id), !!opt.includePlaying)
      : (opt.rowIndex === undefined
        ? Store.candidateMembers(!!opt.includePlaying)
        : poolForQueue(opt.rowIndex, !!opt.includePlaying)).filter((m) => !fixedSet.has(m.id));
    if (comp === 'mm') pool = pool.filter((m) => m.gender === 'M');
    if (comp === 'ff') pool = pool.filter((m) => m.gender === 'F');
    const need = 4 - fixed.length;
    if (pool.length < need) return null;

    // 미편성(아무 데도 안 선 사람)으로 먼저 채운다. 모자랄 때만 다른 줄·코트 인원까지 쓴다.
    const queued = Store.queuedRowsOf();
    const playing = Store.playingIdSet();
    const free = pool.filter((m) => !queued.has(m.id) && !playing.has(m.id));
    const enoughFree = comp === 'mixed'
      ? (free.filter((m) => m.gender === 'M').length >= Math.max(0, 2 - fixed.filter((m) => m.gender === 'M').length)
         && free.filter((m) => m.gender === 'F').length >= Math.max(0, 2 - fixed.filter((m) => m.gender === 'F').length))
      : free.length >= need;
    if (enoughFree) pool = free;

    const gamesOf = Store.gamesOfFn();
    const planned = Store.plannedCombos();
    const cands = [];
    const consider = (four) => {
      if (!compAllowed(four, comp)) return;
      const male = four.map((m) => (m.gender === 'M' ? 1 : 0));
      const mc = male.reduce((a, b) => a + b, 0);
      const h = four.map(half);
      const gameSum = four.reduce((a, m) => a + gamesOf(m), 0);
      const ck = Store.comboKey(four.map((m) => m.id));
      const comboCount = (day.combos[ck] || 0) + (planned[ck] || 0);
      for (const [a, b, c, d] of SPLITS) {
        const A = [four[a], four[b]], B = [four[c], four[d]];
        if (!opt.ignorePartners && (!partnersKept(A) || !partnersKept(B))) continue;
        if (comp === 'mixed' && (male[a] === male[b] || male[c] === male[d])) continue;   // 혼복은 편마다 남녀 하나씩
        if (opt.sameTeam && fixed.length === 2) {
          const together = (fixedSet.has(A[0].id) && fixedSet.has(A[1].id)) || (fixedSet.has(B[0].id) && fixedSet.has(B[1].id));
          if (!together) continue;
        }
        if (opt.slotTeams) {
          // 한 편 안의 고정 인원은 모두 같은 표시여야 하고, 두 편에 다 있으면 표시가 달라야 한다
          const tag = (team) => { const t = team.map((m) => opt.slotTeams[m.id]).filter(Boolean); return t.length ? (t.every((x) => x === t[0]) ? t[0] : 'X') : null; };
          const ta = tag(A), tb = tag(B);
          if (ta === 'X' || tb === 'X' || (ta && tb && ta === tb)) continue;
        }
        const diff2 = Math.abs((h[a] + h[b]) - (h[c] + h[d]));
        const sameGender = (male[a] + male[b]) === (male[c] + male[d]);
        const grace = DIFF_GRACE + (sameGender ? GENDER_GRACE : 0);
        cands.push({
          players: [four[a], four[b], four[c], four[d]],
          gameSum, comboCount, sameGender, pure: mc === 0 || mc === 4,
          diff: diff2 / 2, effDiff2: Math.max(0, diff2 - grace),
          scoreA: (h[a] + h[b]) / 2, scoreB: (h[c] + h[d]) / 2,
        });
      }
    };
    const n = pool.length;
    if (need === 0) consider(fixed);
    else if (need === 1) for (let i = 0; i < n; i++) consider([...fixed, pool[i]]);
    else if (need === 2) for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) consider([...fixed, pool[i], pool[j]]);
    else for (let i = 0; i < n - 2; i++) for (let j = i + 1; j < n - 1; j++) for (let k = j + 1; k < n; k++) consider([...fixed, pool[i], pool[j], pool[k]]);
    if (!cands.length) return null;

    let minSum = Infinity;
    for (const c of cands) if (c.gameSum < minSum) minSum = c.gameSum;
    const cut = minSum + GAME_SUM_TOLERANCE;
    let best = null;
    let bucket = [];
    for (const c of cands) {
      c.sumTier = Math.max(0, c.gameSum - cut);
      if (!best) { best = c; bucket = [c]; continue; }
      const cmp = compareRanked(c, best);
      if (cmp < 0) { best = c; bucket = [c]; }
      else if (cmp === 0) bucket.push(c);
    }
    const chosen = day.preferPure ? weightedPick(bucket) : Util.pick(bucket);
    return Object.assign(chosen, { auto: need });
  }

  /**
   * 우선 편성: 고른 사람들을 rowIndex 줄에 넣고 나머지를 채운다.
   * 그 줄에 있던 사람은 미편성으로 돌아가고, 고른 사람이 서 있던 다른 줄은 한 명만 새로 채워 경기가 이어지게 한다.
   */
  function assignPriority({ rowIndex, ids, composition = 'any', sameTeam = false }) {
    const day = Store.day();
    if (!day.queues[rowIndex]) return { ok: false, reason: 'norow' };
    const pick = (ids || []).filter((id, i, arr) => id && arr.indexOf(id) === i).slice(0, 4);
    if (!pick.length) return { ok: false, reason: 'nobody' };

    const displaced = day.queues[rowIndex].filter(Boolean).filter((id) => !pick.includes(id));
    day.queues[rowIndex] = [null, null, null, null];
    const holes = [];
    day.queues.forEach((q, r) => {
      if (r === rowIndex) return;
      let hit = false;
      for (let s = 0; s < 4; s++) if (pick.includes(q[s])) { q[s] = null; hit = true; }
      if (hit) holes.push(r);
    });

    const game = completeGame(pick, { rowIndex, composition, sameTeam, includePlaying: !!day.includePlaying, allowQueued: true, ignorePartners: true });
    if (!game) {
      pick.forEach((id, i) => { day.queues[rowIndex][i] = id; });   // 채울 사람이 없으면 고른 사람만 넣어 둔다
      return { ok: false, reason: 'nofill', displaced, holes };
    }
    // 채움에 뽑힌 사람이 다른 줄에 서 있었으면 거기서 빼고, 그 줄도 다시 채울 목록에 넣는다
    const fillers = game.players.map((m) => m.id).filter((id) => !pick.includes(id));
    day.queues.forEach((q, r) => {
      if (r === rowIndex) return;
      let hit = false;
      for (let s = 0; s < 4; s++) if (fillers.includes(q[s])) { q[s] = null; hit = true; }
      if (hit && !holes.includes(r)) holes.push(r);
    });
    holes.sort((a, b) => a - b);
    game.players.forEach((m, s) => { day.queues[rowIndex][s] = m.id; });

    const refilled = [];
    holes.forEach((r) => {
      const left = day.queues[r].filter(Boolean);
      if (!left.length || left.length === 4) return;
      if (suggestRow('q', r, !!day.includePlaying).filled) refilled.push(r);
    });
    return { ok: true, game, displaced, holes, refilled };
  }

  /**
   * 추천 편성: 손으로 몇 명 놓은 줄의 나머지를 같은 규칙으로 채운다.
   * 왼쪽 두 칸에 놓은 사람은 한 편, 오른쪽 두 칸에 놓은 사람은 다른 편으로 본다.
   * 파트너 묶기를 지키며 찾고, 그래서 안 되면 묶기를 무시하고 한 번 더 찾는다.
   */
  function suggestRow(kind, index, includePlaying = false) {
    const day = Store.day();
    const arr = kind === 'q' ? day.queues[index] : (day.courts[index] || {}).players;
    if (!arr) return { filled: 0, reason: 'norow' };
    const fixedIds = arr.filter(Boolean);
    if (fixedIds.length === 0) return fillOne(kind, index, includePlaying);
    if (fixedIds.length === 4) return { filled: 0, reason: 'full' };

    const slotTeams = {};
    arr.forEach((id, s) => { if (id) slotTeams[id] = s < 2 ? 'A' : 'B'; });
    const base = { rowIndex: kind === 'q' ? index : undefined, includePlaying: kind === 'q' && includePlaying, slotTeams };
    const game = completeGame(fixedIds, base) || completeGame(fixedIds, { ...base, ignorePartners: true });
    if (!game) {
      const pool = kind === 'q' ? poolForQueue(index, includePlaying) : Store.candidateMembers(false);
      return { filled: 0, reason: pool.length < 4 - fixedIds.length ? 'short' : 'none' };
    }
    // 왼쪽에 놓았던 사람이 든 편을 왼쪽(0,1)에 둔다
    const A = game.players.slice(0, 2), B = game.players.slice(2, 4);
    const aLeft = A.some((m) => slotTeams[m.id] === 'A') || (!B.some((m) => slotTeams[m.id] === 'A') && !A.some((m) => slotTeams[m.id] === 'B'));
    const ordered = aLeft ? [...A, ...B] : [...B, ...A];
    ordered.forEach((m, s) => Store.setAt(`${kind}:${index}:${s}`, m.id));
    if (kind === 'c') Store.touchCourt(`c:${index}:0`);
    return { filled: 1, added: game.auto, relaxed: game.effDiff2 > 0, diff: game.diff };
  }

  return { rankedGame, fillAll, fillOne, completeGame, assignPriority, suggestRow };
})();
