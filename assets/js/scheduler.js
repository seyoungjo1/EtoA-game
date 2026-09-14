/* ===========================================================
   scheduler.js — 자동 편성 알고리즘

   편성 규칙 (우선순위 순)
   0) [필터] 양 팀 점수 합의 차이가 허용치(기본 1.0점) 이내인 조합만 후보
   1) 그날 해당 4인 조합이 함께 뛴 횟수가 적은 조합 우선
   2) 그날 경기 수가 적은 사람이 포함된 조합 우선
      (4인의 경기 수를 내림차순 정렬해 사전식 비교 → 많이 뛴 사람이 적을수록 우선)
   3) 그날 같은 파트너로 짝을 이룬 횟수가 적은 편 구성 우선
   4) 위가 모두 같으면 그 안에서 랜덤 선택
   =========================================================== */
const Scheduler = (() => {
  /** 4인을 2:2로 나누는 3가지 경우 [A1,A2,B1,B2] */
  const SPLITS = [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2]];

  /** 허용 점수차. 1점 이내가 원칙이며, 후보가 없을 때만 단계적으로 완화한다. */
  const TOLERANCES = [1, 1.5, 2, 3, Infinity];

  /** 완전탐색 상한. 넘어가면 무작위 샘플링으로 대체한다. */
  const MAX_COMBOS = 60000;

  const EPS = 1e-9;

  function nC4(n) {
    if (n < 4) return 0;
    return (n * (n - 1) * (n - 2) * (n - 3)) / 24;
  }

  /** 후보 하나 만들기 */
  function makeCandidate(four, day, tol) {
    const out = [];
    const s = four.map(Store.scoreOf);
    const cKey = Store.comboKey(four.map((m) => m.id));
    const comboCount = day.combos[cKey] || 0;
    const games = four.map((m) => day.games[m.id] || 0).sort((a, b) => b - a);

    for (const [a, b, c, d] of SPLITS) {
      const diff = Math.abs((s[a] + s[b]) - (s[c] + s[d]));
      if (diff > tol + EPS) continue;
      const pairRepeat =
        (day.pairs[Store.pairKey(four[a].id, four[b].id)] || 0) +
        (day.pairs[Store.pairKey(four[c].id, four[d].id)] || 0);
      out.push({
        players: [four[a], four[b], four[c], four[d]], // 코트 슬롯 순서(팀A 2명 + 팀B 2명)
        diff, comboCount, games, pairRepeat,
        scoreA: s[a] + s[b], scoreB: s[c] + s[d],
      });
    }
    return out;
  }

  /** 우선순위 비교. 음수면 x 가 더 좋다. */
  function compare(x, y) {
    if (x.comboCount !== y.comboCount) return x.comboCount - y.comboCount;
    for (let i = 0; i < 4; i++) {
      if (x.games[i] !== y.games[i]) return x.games[i] - y.games[i];
    }
    if (x.pairRepeat !== y.pairRepeat) return x.pairRepeat - y.pairRepeat;
    return 0;
  }

  /** 후보 전체에서 최상위 그룹을 모아 그 안에서 랜덤으로 하나 고른다. */
  function bestRandom(cands) {
    let best = null;
    let bucket = [];
    for (const c of cands) {
      if (!best) { best = c; bucket = [c]; continue; }
      const cmp = compare(c, best);
      if (cmp < 0) { best = c; bucket = [c]; }
      else if (cmp === 0) bucket.push(c);
    }
    return bucket.length ? Util.pick(bucket) : null;
  }

  /** 주어진 허용치로 후보 생성 */
  function collect(pool, day, tol) {
    const n = pool.length;
    const cands = [];

    if (nC4(n) <= MAX_COMBOS) {
      for (let i = 0; i < n - 3; i++)
        for (let j = i + 1; j < n - 2; j++)
          for (let k = j + 1; k < n - 1; k++)
            for (let l = k + 1; l < n; l++)
              cands.push(...makeCandidate([pool[i], pool[j], pool[k], pool[l]], day, tol));
    } else {
      const seen = new Set();
      let tries = 0;
      while (seen.size < MAX_COMBOS && tries < MAX_COMBOS * 3) {
        tries++;
        const idx = Util.shuffle(pool).slice(0, 4);
        const key = Store.comboKey(idx.map((m) => m.id));
        if (seen.has(key)) continue;
        seen.add(key);
        cands.push(...makeCandidate(idx, day, tol));
      }
    }
    return cands;
  }

  /**
   * 대기 인원 중 한 게임(4인)을 편성한다.
   * @returns {{players:Array, diff:number, comboCount:number, scoreA:number, scoreB:number, relaxed:boolean}|null}
   */
  function pickGame(pool, day) {
    if (!pool || pool.length < 4) return null;
    for (let t = 0; t < TOLERANCES.length; t++) {
      const cands = collect(pool, day, TOLERANCES[t]);
      const best = bestRandom(cands);
      if (best) return Object.assign(best, { relaxed: t > 0, tolerance: TOLERANCES[t] });
    }
    return null;
  }

  /** 완전 무작위 4인 + 그 안에서 가장 균형 잡힌 2:2 분할 */
  function randomGame(pool) {
    if (!pool || pool.length < 4) return null;
    const four = Util.shuffle(pool).slice(0, 4);
    const s = four.map(Store.scoreOf);
    let best = null;
    for (const [a, b, c, d] of SPLITS) {
      const diff = Math.abs((s[a] + s[b]) - (s[c] + s[d]));
      if (!best || diff < best.diff) {
        best = { players: [four[a], four[b], four[c], four[d]], diff, scoreA: s[a] + s[b], scoreB: s[c] + s[d] };
      }
    }
    return Object.assign(best, { comboCount: 0, relaxed: false });
  }

  /** 비어 있는 자리(코트 → 대기 순)를 4명 단위로 채운다. */
  function fillAll({ mode = 'auto', includeCourts = true, includeQueues = true } = {}) {
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
      const pool = Store.poolMembers();
      if (pool.length < 4) break;
      const game = mode === 'random' ? randomGame(pool) : pickGame(pool, day);
      if (!game) break;
      if (game.relaxed) relaxed = true;
      game.players.forEach((m, slot) => Store.setAt(`${t.kind}:${t.index}:${slot}`, m.id));
      if (t.kind === 'c') Store.touchCourt(`c:${t.index}:0`);
      filled++;
    }

    return { filled, relaxed, remaining: Store.poolMembers().length };
  }

  /** 특정 코트/대기 줄 하나만 편성 */
  function fillOne(kind, index, mode = 'auto') {
    const day = Store.day();
    const slotsBase = `${kind}:${index}`;
    const empty = [];
    for (let s = 0; s < 4; s++) if (!Store.getAt(`${slotsBase}:${s}`)) empty.push(s);
    if (empty.length !== 4) return { filled: 0, reason: 'occupied' };

    const pool = Store.poolMembers();
    if (pool.length < 4) return { filled: 0, reason: 'short' };

    const game = mode === 'random' ? randomGame(pool) : pickGame(pool, day);
    if (!game) return { filled: 0, reason: 'none' };
    game.players.forEach((m, slot) => Store.setAt(`${slotsBase}:${slot}`, m.id));
    if (kind === 'c') Store.touchCourt(`c:${index}:0`);
    return { filled: 1, relaxed: game.relaxed, diff: game.diff, comboCount: game.comboCount };
  }

  return { pickGame, randomGame, fillAll, fillOne, TOLERANCES };
})();
