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
  function nC4(n) {
    if (n < 4) return 0;
    return (n * (n - 1) * (n - 2) * (n - 3)) / 24;
  }

  /** 4인 조합을 하나씩 훑는다. 경우의 수가 너무 많으면 무작위 샘플링으로 대체. */
  function eachCombo(pool, fn) {
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

  function collectRanked(pool, day, gamesOf) {
    const cands = [];
    eachCombo(pool, (four) => {
      const h = four.map(half);
      const male = four.map((m) => (m.gender === 'M' ? 1 : 0));
      const gameSum = four.reduce((a, m) => a + gamesOf(m), 0);
      const comboCount = day.combos[Store.comboKey(four.map((m) => m.id))] || 0;

      for (const [a, b, c, d] of SPLITS) {
        if (!partnersKept([four[a], four[b]]) || !partnersKept([four[c], four[d]])) continue;
        const diff2 = Math.abs((h[a] + h[b]) - (h[c] + h[d]));
        // 양 팀 성별 구성이 같으면(남복·여복·혼복) 점수차를 0.5점 더 봐준다
        const sameGender = (male[a] + male[b]) === (male[c] + male[d]);
        const grace = DIFF_GRACE + (sameGender ? GENDER_GRACE : 0);
        cands.push({
          players: [four[a], four[b], four[c], four[d]],
          gameSum, comboCount, sameGender,
          diff: diff2 / 2,
          effDiff2: Math.max(0, diff2 - grace),
          scoreA: (h[a] + h[b]) / 2,
          scoreB: (h[c] + h[d]) / 2,
        });
      }
    });
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
    const cands = collectRanked(pool, day, gamesOf);
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
    const chosen = Util.pick(bucket);
    return Object.assign(chosen, { relaxed: chosen.effDiff2 > 0 });
  }

  /**
   * 비어 있는 자리를 4명 단위로 채운다.
   * @param {boolean} includeCourts   빈 코트도 채울지. 기본은 대기 줄만 채운다.
   * @param {boolean} includePlaying  대기 줄을 짤 때 코트에서 뛰는 사람도 후보에 넣을지
   */
  function fillAll({ includeCourts = false, includeQueues = true, includePlaying = false } = {}) {
    const day = Store.day();
    const targets = [];

    if (includeCourts) {
      day.courts.forEach((c, i) => {
        if (c.players.every((p) => !p)) targets.push({ kind: 'c', index: i });
      });
    }
    if (includeQueues) {
      day.queues.forEach((q, i) => {
        if (q.every((p) => !p)) targets.push({ kind: 'q', index: i });
      });
    }

    let filled = 0;
    let relaxed = false;

    for (const t of targets) {
      // 코트에는 이미 뛰고 있는 사람을 다시 넣을 수 없다. 대기 줄에만 허용.
      const allowPlaying = t.kind === 'q' && includePlaying;
      const pool = Store.candidateMembers(allowPlaying);
      if (pool.length < 4) break;

      const game = rankedGame(pool, day, Store.gamesOfFn());
      if (!game) break;
      if (game.relaxed) relaxed = true;

      game.players.forEach((m, slot) => Store.setAt(`${t.kind}:${t.index}:${slot}`, m.id));
      if (t.kind === 'c') Store.touchCourt(`c:${t.index}:0`);
      filled++;
    }

    return { filled, relaxed, remaining: Store.poolMembers().length };
  }

  /** 특정 코트/대기 줄 하나만 편성 */
  function fillOne(kind, index, includePlaying = false) {
    const day = Store.day();
    const base = `${kind}:${index}`;
    for (let s = 0; s < 4; s++) if (Store.getAt(`${base}:${s}`)) return { filled: 0, reason: 'occupied' };

    const allowPlaying = kind === 'q' && includePlaying;
    const pool = Store.candidateMembers(allowPlaying);
    if (pool.length < 4) return { filled: 0, reason: 'short' };

    const game = rankedGame(pool, day, Store.gamesOfFn());
    if (!game) return { filled: 0, reason: 'none' };

    game.players.forEach((m, slot) => Store.setAt(`${base}:${slot}`, m.id));
    if (kind === 'c') Store.touchCourt(`c:${index}:0`);
    return { filled: 1, relaxed: !!game.relaxed, diff: game.diff, comboCount: game.comboCount };
  }

  return { rankedGame, fillAll, fillOne };
})();
