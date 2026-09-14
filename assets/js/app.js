/* ===========================================================
   app.js — 화면 렌더링 & 상호작용
   =========================================================== */
(() => {
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = Util.esc;

  const ui = { tab: 'board', selected: null, selectedFrom: null, memberFilter: '', pickFilter: '' };

  /* =========================================================
     코트 그래픽 (실제 배드민턴 코트 규격 비율)
     세로형: 네트가 가로로 중앙을 가른다.
     좌표계 610 x 1340 (단위 cm) — 실제 6.1m x 13.4m
     ========================================================= */
  const NET_TICKS = (() => {
    let s = '';
    for (let x = -18; x <= 628; x += 22) s += `<line x1="${x}" y1="658" x2="${x}" y2="682"/>`;
    return s;
  })();

  const NET_TICKS_H = (() => {
    let s = '';
    for (let y = -18; y <= 628; y += 22) s += `<line x1="658" y1="${y}" x2="682" y2="${y}"/>`;
    return s;
  })();

  /** 세로형 코트: 네트가 가로로 중앙을 가른다. 위 2명 / 아래 2명 */
  const COURT_SVG = `
<svg viewBox="-24 -24 658 1388" preserveAspectRatio="none" aria-hidden="true">
  <g fill="none" stroke="currentColor" stroke-width="2.4" vector-effect="non-scaling-stroke" stroke-linecap="square">
    <rect x="0" y="0" width="610" height="1340"/>
    <line x1="46"  y1="0"    x2="46"  y2="1340"/>
    <line x1="564" y1="0"    x2="564" y2="1340"/>
    <line x1="0"   y1="76"   x2="610" y2="76"/>
    <line x1="0"   y1="1264" x2="610" y2="1264"/>
    <line x1="0"   y1="472"  x2="610" y2="472"/>
    <line x1="0"   y1="868"  x2="610" y2="868"/>
    <line x1="305" y1="0"    x2="305" y2="472"/>
    <line x1="305" y1="868"  x2="305" y2="1340"/>
  </g>
  <g stroke="rgba(255,255,255,.45)" stroke-width="1" vector-effect="non-scaling-stroke">
    <rect x="-24" y="658" width="658" height="24" fill="rgba(255,255,255,.12)" stroke="none"/>
    ${NET_TICKS}
    <line x1="-24" y1="658" x2="634" y2="658" stroke="rgba(255,255,255,.92)" stroke-width="2.4"/>
    <line x1="-24" y1="682" x2="634" y2="682" stroke="rgba(255,255,255,.70)" stroke-width="2"/>
  </g>
</svg>`;

  /** 가로형 코트: 네트가 세로로 중앙을 가른다. 왼쪽 2명 / 오른쪽 2명 */
  const COURT_SVG_H = `
<svg viewBox="-24 -24 1388 658" preserveAspectRatio="none" aria-hidden="true">
  <g fill="none" stroke="currentColor" stroke-width="2.4" vector-effect="non-scaling-stroke" stroke-linecap="square">
    <rect x="0" y="0" width="1340" height="610"/>
    <line x1="0"    y1="46"  x2="1340" y2="46"/>
    <line x1="0"    y1="564" x2="1340" y2="564"/>
    <line x1="76"   y1="0"   x2="76"   y2="610"/>
    <line x1="1264" y1="0"   x2="1264" y2="610"/>
    <line x1="472"  y1="0"   x2="472"  y2="610"/>
    <line x1="868"  y1="0"   x2="868"  y2="610"/>
    <line x1="0"    y1="305" x2="472"  y2="305"/>
    <line x1="868"  y1="305" x2="1340" y2="305"/>
  </g>
  <g stroke="rgba(255,255,255,.45)" stroke-width="1" vector-effect="non-scaling-stroke">
    <rect x="658" y="-24" width="24" height="658" fill="rgba(255,255,255,.12)" stroke="none"/>
    ${NET_TICKS_H}
    <line x1="658" y1="-24" x2="658" y2="634" stroke="rgba(255,255,255,.92)" stroke-width="2.4"/>
    <line x1="682" y1="-24" x2="682" y2="634" stroke="rgba(255,255,255,.70)" stroke-width="2"/>
  </g>
</svg>`;

  /** 코트를 가로형으로 눕힐 수 있는 화면인지 (칸이 가로로 넓을 때) */
  const wideRow = window.matchMedia('(min-width: 641px)');

  /* =========================================================
     공통 UI
     ========================================================= */
  let toastTimer = null;
  function toast(msg, type = '') {
    const el = $('#toast');
    el.textContent = msg;
    el.className = `toast ${type}`;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  function openModal(html) {
    $('#modal-card').innerHTML = html;
    $('#modal').classList.remove('hidden');
    const first = $('#modal-card input, #modal-card select, #modal-card button');
    if (first) first.focus();
  }
  let modalResolve = null;
  function closeModal() {
    $('#modal').classList.add('hidden');
    $('#modal-card').classList.remove('wide');
    $('#modal-card').onclick = null;
    if (modalResolve) { const r = modalResolve; modalResolve = null; r(false); }
  }

  function confirmModal(title, body, okText = '확인', danger = false) {
    return new Promise((resolve) => {
      openModal(`
        <h3>${esc(title)}</h3>
        <p class="muted" style="font-size:13.5px;line-height:1.6">${body}</p>
        <div class="btn-row" style="margin-top:18px;justify-content:flex-end">
          <button class="btn btn-ghost" data-mok="0">취소</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-mok="1">${esc(okText)}</button>
        </div>`);
      modalResolve = resolve;
      $('#modal-card').onclick = (e) => {
        const b = e.target.closest('[data-mok]');
        if (!b) return;
        modalResolve = null;
        closeModal();
        resolve(b.dataset.mok === '1');
      };
    });
  }

  const gradeText = (m) => `${Store.GENDER_LABEL[m.gender]}${Store.GRADE_LABEL[m.grade]}`;
  const gradeShort = (m) => (m.grade === 'N' ? '초' : m.grade);
  const showScores = () => Auth.isAdmin() && Store.showScores();

  /* =========================================================
     선수 칩
     ========================================================= */
  function pcHTML(m) {
    const drag = Auth.isStaff();
    return `<div class="pc ${m.gender === 'F' ? 'f' : 'm'}${m.guest ? ' guest' : ''}${ui.selected === m.id ? ' is-sel' : ''}"
                 data-drag-id="${m.id}" draggable="${drag}"
                 title="${esc(m.name)} · ${gradeText(m)}${m.guest ? ' · 게스트' : ''}">
      <span class="pc-nm">${esc(m.name)}</span>
      <span class="pc-gr">${gradeShort(m)}</span>
    </div>`;
  }

  function miniHTML(m, playing) {
    const drag = Auth.isStaff();
    const g = Store.day().games[m.id] || 0;
    return `<div class="mini${m.gender === 'F' ? ' f' : ''}${m.guest ? ' guest' : ''}${playing ? ' playing' : ''}${ui.selected === m.id ? ' is-sel' : ''}"
                 data-drag-id="${m.id}" draggable="${drag}" title="${esc(m.name)} · ${gradeText(m)} · 오늘 ${g}게임${playing ? ' · 지금 경기 중' : ''}">
      <div class="mini-av">${esc(m.name.slice(0, 1))}</div>
      <div class="mini-txt">
        <span class="mini-name">${esc(m.name)}</span>
        <span class="mini-sub">${esc(gradeText(m))} · ${g}G</span>
      </div>
    </div>`;
  }

  /* =========================================================
     게임판 렌더
     ========================================================= */
  function renderCourts() {
    const d = Store.day();
    const wrap = $('#courts');
    wrap.dataset.n = String(d.courtCount);

    wrap.innerHTML = d.courts.map((c, i) => {
      const ms = c.players.map((id) => Store.memberById(id));
      const filled = ms.filter(Boolean).length;
      const live = filled === 4;
      const sA = Store.scoreOf(ms[0]) + Store.scoreOf(ms[1]);
      const sB = Store.scoreOf(ms[2]) + Store.scoreOf(ms[3]);
      const diff = Math.abs(sA - sB);

      // 칸이 가로로 넓은 3·4코트 배치에서는 코트도 가로형으로 눕힌다
      const wide = d.courtCount >= 3 && wideRow.matches;
      const slots = ms.map((m, s) => {
        const inner = m ? pcHTML(m) : '<span class="slot-ghost">+</span>';
        return `<div class="slot${m ? '' : ' empty'}" data-pos="c:${i}:${s}">${inner}</div>`;
      }).join('');

      const scores = (live && showScores()) ? `
        <div class="court-side-score top">${Util.fmt(sA)}</div>
        <div class="court-side-score bottom">${Util.fmt(sB)}</div>
        <div class="court-diff${diff > 1 ? ' warn' : ''}">${diff === 0 ? '동률' : `${Util.fmt(diff)}점차`}</div>` : '';

      return `<div class="court${live ? ' is-live' : ''}${filled === 0 ? ' is-empty' : ''}${wide ? ' wide' : ''}" data-court="${i}">
        <div class="court-head">
          <div class="court-name"><span class="court-no">${i + 1}</span><span class="court-title">번 코트</span></div>
          ${live ? '' : `<span class="chip">${filled ? `${filled}/4명` : '비어 있음'}</span>`}
          <span class="court-timer" data-timer="${i}">${c.startedAt ? Util.clock(Date.now() - c.startedAt) : ''}</span>
          <div class="court-acts staff-only">
            ${filled ? `<button class="btn btn-sm btn-primary" data-act="finish" data-i="${i}">경기 종료</button>` : ''}
            ${filled ? '' : `<button class="icon-btn" data-act="auto-court" data-i="${i}" title="이 코트 자동 편성">자동 편성</button>`}
            ${filled ? `<button class="icon-btn" data-act="clear-court" data-i="${i}" title="기록 없이 편성 취소">취소</button>` : ''}
          </div>
        </div>
        <div class="court-field">
          <div class="court-floor" data-pos="c:${i}:*">
            ${wide ? COURT_SVG_H : COURT_SVG}${scores}
            <div class="court-grid">${slots}</div>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  function renderQueues() {
    const d = Store.day();
    const playing = Store.playingIdSet();
    const hasEmptyCourt = d.courts.some((c) => c.players.every((p) => !p));

    $('#queues').innerHTML = d.queues.map((q, i) => {
      const n = q.filter(Boolean).length;
      const stillPlaying = q.some((id) => id && playing.has(id));
      const ready = Store.queueReady(i);
      const slots = q.map((id, s) => {
        const m = id ? Store.memberById(id) : null;
        return `<div class="qslot" data-pos="q:${i}:${s}">${m ? miniHTML(m, playing.has(m.id)) : '<span>+</span>'}</div>`;
      }).join('');
      const why = !hasEmptyCourt ? '빈 코트가 없습니다'
        : stillPlaying ? '아직 경기 중인 인원이 있습니다'
        : n !== 4 ? '4명이 채워져야 합니다' : '빈 코트에 투입';
      return `<div class="qrow${n === 4 ? ' full' : ''}${stillPlaying ? ' waiting' : ''}">
        <div class="qno">${i + 1}</div>
        <div class="qslots">${slots}</div>
        <div class="qacts staff-only">
          <button class="icon-btn go" data-act="push-queue" data-i="${i}" title="${why}"
                  ${ready && hasEmptyCourt ? '' : 'disabled'}>투입</button>
          ${n === 0
            ? `<button class="icon-btn" data-act="auto-queue" data-i="${i}" title="이 줄 자동 편성">자동</button>`
            : `<button class="icon-btn" data-act="cancel-queue" data-i="${i}" title="이 줄 편성 취소">취소</button>`}
        </div>
      </div>`;
    }).join('');

    const total = d.queues.reduce((a, q) => a + q.filter(Boolean).length, 0);
    $('#queue-count').textContent = `${total}명`;
  }

  function renderPool() {
    const pool = Store.poolMembers();
    $('#pool').innerHTML = pool.map(miniHTML).join('');
    $('#pool-count').textContent = `${pool.length}명`;
    $('#pool-empty').hidden = Store.attendees().length > 0;
  }

  function renderBoard() {
    renderCourts();
    renderQueues();
    renderPool();
    const d = Store.day();
    $('#attend-n').textContent = `${Store.attendees().length}명`;
    $('#court-count').value = String(d.courtCount);
    $('#queue-rows').value = String(d.queueRows);
    $('#auto-advance').checked = !!d.autoAdvance;
    $('#include-playing').checked = !!d.includePlaying;
  }

  /* =========================================================
     회원 관리
     ========================================================= */
  function renderScoreTable() {
    const g = Store.GRADES;
    let html = `<div class="hd"></div>${g.map((x) => `<div class="hd">${Store.GRADE_LABEL[x]}</div>`).join('')}`;
    ['M', 'F'].forEach((gen) => {
      html += `<div class="hd">${Store.GENDER_LABEL[gen]}</div>`;
      html += g.map((x) => `<div><b>${Util.fmt(Store.SCORE[gen][x])}</b></div>`).join('');
    });
    $('#score-table').innerHTML = html;
  }

  function renderMembers() {
    const d = Store.day();
    const q = ui.memberFilter.trim();
    const list = Store.members()
      .filter((m) => !q || m.name.includes(q))
      .sort((a, b) => {
        if (!!a.guest !== !!b.guest) return a.guest ? 1 : -1;
        return a.name.localeCompare(b.name, 'ko');
      });

    $('#member-count').textContent = `${Store.members().length}명 · 오늘 참석 ${Store.attendees().length}명`;
    $('#member-rows').innerHTML = list.map((m) => `
      <tr data-mid="${m.id}">
        <td><input type="checkbox" data-act="attend" ${d.attendance[m.id] ? 'checked' : ''} ${Auth.isStaff() ? '' : 'disabled'} /></td>
        <td class="nm">${esc(m.name)}</td>
        <td><span class="tag ${m.gender === 'F' ? 'f' : 'm'}">${Store.GENDER_LABEL[m.gender]}</span></td>
        <td>
          <select data-act="grade" ${Auth.isStaff() ? '' : 'disabled'}>
            ${Store.GRADES.map((g) => `<option value="${g}"${g === m.grade ? ' selected' : ''}>${Store.GRADE_LABEL[g]}</option>`).join('')}
          </select>
        </td>
        <td class="score-only">${showScores() ? `<b>${Util.fmt(Store.scoreOf(m))}</b>` : ''}</td>
        <td>${m.guest ? '<span class="tag guest">게스트</span>' : '<span class="tag">회원</span>'}</td>
        <td>${d.games[m.id] || 0}게임</td>
        <td>
          <div class="row-acts">
            <button class="icon-btn" data-act="edit-member" title="수정">수정</button>
            <button class="icon-btn" data-act="del-member" title="삭제">삭제</button>
          </div>
        </td>
      </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;color:#93a3b1;padding:24px">등록된 인원이 없습니다.</td></tr>';
    renderScoreTable();
  }

  /* =========================================================
     계정 관리
     ========================================================= */
  function renderAccounts() {
    const pend = Auth.pendingUsers();
    $('#pending-count').textContent = `${pend.length}명`;
    $('#pending-list').innerHTML = pend.length ? pend.map((u) => `
      <div class="urow">
        <div class="ui"><div class="un">${esc(u.display)}</div><div class="uid">@${esc(u.username)}</div></div>
        <button class="btn btn-sm btn-soft" data-act="approve" data-u="${esc(u.username)}" data-r="member">회원 승인</button>
        <button class="btn btn-sm btn-primary" data-act="approve" data-u="${esc(u.username)}" data-r="staff">운영진 승인</button>
        <button class="btn btn-sm btn-danger" data-act="reject" data-u="${esc(u.username)}">거절</button>
      </div>`).join('') : '<p class="hint">대기 중인 가입 신청이 없습니다.</p>';

    const users = Store.users().slice().sort((a, b) => a.createdAt - b.createdAt);
    $('#user-count').textContent = `${users.length}개`;
    $('#user-rows').innerHTML = users.map((u) => `
      <tr>
        <td class="nm">@${esc(u.username)}</td>
        <td>${esc(u.display)}</td>
        <td>
          <select data-act="role" data-u="${esc(u.username)}">
            ${['pending', 'member', 'staff', 'admin'].map((r) => `<option value="${r}"${r === u.role ? ' selected' : ''}>${Auth.ROLE_LABEL[r]}</option>`).join('')}
          </select>
        </td>
        <td style="text-align:right">
          <button class="icon-btn" data-act="reset-pw" data-u="${esc(u.username)}" title="비밀번호 초기화">🔑</button>
          <button class="icon-btn" data-act="del-user" data-u="${esc(u.username)}" title="계정 삭제">✕</button>
        </td>
      </tr>`).join('');

    const dot = $('#pending-dot');
    dot.hidden = pend.length === 0;
  }

  /* =========================================================
     설정 · 기록
     ========================================================= */
  function renderData() {
    const box = $('#sync-config');
    if (box && document.activeElement !== box) {
      const c = Sync.config();
      box.value = c && c.apiKey ? c.apiKey : '';
    }
    renderSyncStatus(Sync.state());
    const d = Store.day();
    const played = d.history.length;
    const attend = Store.attendees().length;
    const totalGames = Object.values(d.games).reduce((a, b) => a + b, 0);
    $('#day-stats').innerHTML = `
      <dt>날짜</dt><dd>${esc(Util.prettyDate(d.date))}</dd>
      <dt>참석 인원</dt><dd>${attend}명</dd>
      <dt>완료 경기</dt><dd>${played}경기</dd>
      <dt>총 출전 수</dt><dd>${totalGames}회</dd>
      <dt>코트 / 대기 줄</dt><dd>${d.courtCount} / ${d.queueRows}</dd>`;

    $('#history-count').textContent = `${played}경기`;
    $('#history').innerHTML = played ? d.history.map((h) => {
      const t = new Date(h.at);
      return `<div class="hrow">
        <span class="ht">${Util.pad(t.getHours())}:${Util.pad(t.getMinutes())}</span>
        <span class="hc">${h.court}코트</span>
        <span class="hteams">${esc(h.teamA.join(' · '))}<span class="vs">vs</span>${esc(h.teamB.join(' · '))}</span>
        <span class="hs">${showScores() ? `${Util.fmt(h.scoreA)} : ${Util.fmt(h.scoreB)} · ` : ''}${h.seconds != null ? Util.clock(h.seconds * 1000) : ''}</span>
      </div>`;
    }).join('') : '<p class="hint">아직 종료된 경기가 없습니다.</p>';
  }


  /* =========================================================
     오늘의 참석자 선택
     ========================================================= */
  const byName = (a, b) => a.name.localeCompare(b.name, 'ko');

  function pickCell(m) {
    const on = !!Store.day().attendance[m.id];
    return `<button type="button" class="pick${on ? ' on' : ''}${m.guest ? ' guest' : ''}" data-pick="${m.id}">
      <span class="pick-check">✓</span>
      <span class="pick-info">
        <span class="pick-nm">${esc(m.name)}</span>
        <span class="pick-sub">${esc(gradeText(m))}${showScores() ? ` · ${Util.fmt(Store.scoreOf(m))}점` : ''}</span>
      </span>
    </button>`;
  }

  function renderPickGrid() {
    const q = ui.pickFilter.trim();
    const all = Store.members().filter((m) => !q || m.name.includes(q));
    const mem = all.filter((m) => !m.guest).sort(byName);
    const gst = all.filter((m) => m.guest).sort(byName);

    let html = '';
    if (mem.length) html += `<div class="pick-sec">회원 ${mem.length}명</div>${mem.map(pickCell).join('')}`;
    if (gst.length) html += `<div class="pick-sec">게스트 ${gst.length}명</div>${gst.map(pickCell).join('')}`;
    if (!html) html = '<div class="pick-sec">표시할 인원이 없습니다.</div>';

    const grid = $('#pick-grid');
    if (grid) grid.innerHTML = html;
    const n = $('#pick-n');
    if (n) n.textContent = `${Store.attendees().length}명 선택됨`;
  }

  function openAttendPicker() {
    ui.pickFilter = '';
    openModal(`
      <h3>오늘의 참석자 선택</h3>
      <div class="pick-wrap">
        <div class="pick-tools">
          <input id="pick-search" class="search" type="search" placeholder="이름 검색" />
          <button class="btn btn-sm btn-soft" data-pick-all="1">전체 선택</button>
          <button class="btn btn-sm btn-ghost" data-pick-all="0">전체 해제</button>
          <span class="count" id="pick-n"></span>
        </div>
        <div class="pick-grid" id="pick-grid"></div>
        <div>
          <div class="card-title" style="margin-bottom:8px">게스트 추가 <span class="count">오늘만 유지</span></div>
          <form id="guest-form" class="guest-add">
            <label class="field"><span>이름</span><input name="name" required placeholder="게스트 이름" /></label>
            <label class="field"><span>성별</span><select name="gender"><option value="M">남</option><option value="F">여</option></select></label>
            <label class="field"><span>급수</span><select name="grade">
              ${Store.GRADES.map((g) => `<option value="${g}">${Store.GRADE_LABEL[g]}</option>`).join('')}
            </select></label>
            <button class="btn btn-soft" type="submit">추가</button>
          </form>
        </div>
        <div class="btn-row" style="justify-content:flex-end">
          <button type="button" class="btn btn-primary" data-close>완료</button>
        </div>
      </div>`);
    $('#modal-card').classList.add('wide');
    renderPickGrid();

    $('#pick-search').addEventListener('input', (e) => { ui.pickFilter = e.target.value; renderPickGrid(); });

    $('#modal-card').onclick = (e) => {
      const cell = e.target.closest('[data-pick]');
      if (cell) {
        const id = cell.dataset.pick;
        Store.setAttendance(id, !Store.day().attendance[id]);
        commit(); renderPickGrid();
        return;
      }
      const all = e.target.closest('[data-pick-all]');
      if (all) {
        const on = all.dataset.pickAll === '1';
        Store.members().forEach((m) => Store.setAttendance(m.id, on));
        commit(); renderPickGrid();
      }
    };

    $('#guest-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const name = String(f.get('name')).trim();
      if (!name) return;
      if (Store.members().some((m) => m.name === name)) { toast('같은 이름이 이미 있습니다.', 'warn'); return; }
      Store.addMember({ name, gender: f.get('gender'), grade: f.get('grade'), guest: true });
      e.target.elements.name.value = '';   // 성별·급수는 유지
      e.target.elements.name.focus();
      commit(); renderPickGrid();
      toast(`게스트 ${name} 추가 · 오늘 참석 처리`);
    });
  }

  /* =========================================================
     전체 렌더 / 화면 전환
     ========================================================= */
  function renderAll() {
    if (ui.tab === 'board') renderBoard();
    if (ui.tab === 'members') renderMembers();
    if (ui.tab === 'accounts') renderAccounts();
    if (ui.tab === 'data') renderData();
    if (Auth.isAdmin()) $('#pending-dot').hidden = Auth.pendingUsers().length === 0;
  }

  /* =========================================================
     실시간 동기화
     ========================================================= */
  const SYNC_LABEL = {
    off: '이 기기', connecting: '연결 중', online: '실시간', offline: '오프라인', error: '오류',
  };

  function renderSyncStatus(st) {
    const chip = $('#sync-chip');
    chip.dataset.state = st.status;
    $('#sync-text').textContent = SYNC_LABEL[st.status] || st.status;
    chip.title = st.detail
      || (st.status === 'online' ? `모든 기기가 같은 게임판을 봅니다 (${st.canWrite ? '읽기 · 쓰기' : '읽기 전용'})`
        : st.status === 'off' ? '이 브라우저에만 저장됩니다'
        : st.status === 'offline' ? '연결이 끊겨 이 기기에 임시 저장 중입니다'
        : '');
    const badge = $('#sync-state');
    if (badge) badge.textContent = SYNC_LABEL[st.status] || st.status;
    const det = $('#sync-detail');
    if (det) {
      det.textContent = st.detail || (st.status === 'online'
        ? `연결되었습니다. 이 계정은 ${st.canWrite ? '읽기 · 쓰기' : '읽기 전용'} 권한입니다. 회원 · 참석 · 코트 · 대기가 모든 기기에서 함께 바뀝니다.`
        : st.status === 'off'
          ? '아직 설정하지 않았습니다. 지금은 이 브라우저에만 저장됩니다.'
          : '');
    }
  }

  /** 원격에서 내려온 내용을 반영하고 화면을 다시 그린다. */
  function applyRemoteState(data) {
    const before = Auth.user() && Auth.user().role;
    const rolled = Store.applyRemote(data);
    if (rolled) Store.save();                       // 날짜가 넘어갔으면 정리된 상태를 다시 올린다

    if (document.body.dataset.view !== 'app') { renderSyncStatus(Sync.state()); return; }
    const u = Auth.restore();
    if (!u || u.role === 'pending') { route(); return; }   // 계정이 사라졌거나 권한이 내려간 경우
    if (u.role !== before) { enterApp(); return; }
    syncRole();
    applyScoreVisibility();
    $('#today-label').textContent = Util.prettyDate(Store.day().date);
    renderAll();
  }

  /**
   * 관리자·운영진은 읽기+쓰기, 그 외에는 읽기 전용으로 DB 에 접속한다.
   * 로그인 화면에서도 읽기로 붙어야 서버의 계정 목록을 받아올 수 있다.
   * (그러지 않으면 처음 접속한 기기에서는 아무도 로그인할 수 없다)
   */
  const dbRole = () => (Auth.isStaff() ? 'write' : 'read');

  function startSync() {
    Store.setPushRemote((snap) => Sync.push(snap));
    Sync.onStatus(renderSyncStatus);
    Sync.onRemote(applyRemoteState);
    Sync.onSeed(() => Sync.push(Store.snapshot()));
    renderSyncStatus(Sync.state());
  }

  /** 로그인 상태가 바뀔 때마다 DB 접속 권한을 맞춘다. */
  function syncRole() {
    Sync.setRole(dbRole());
  }

  function openSyncSetup() {
    const c = Sync.config();
    $('#sync-config').value = c && c.apiKey ? c.apiKey : '';
    setTab('data');
    $('#sync-config').focus();
  }

  function applyScoreVisibility() {
    const on = Auth.isAdmin() && Store.showScores();
    document.body.classList.toggle('show-scores', on);
    const cb = $('#show-scores');
    if (cb) cb.checked = Store.showScores();
  }

  function commit() { Store.save(); renderAll(); }

  function setTab(tab) {
    ui.tab = tab;
    $$('#tabs .tab').forEach((b) => b.classList.toggle('is-on', b.dataset.tab === tab));
    $$('.panel').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== tab));
    renderAll();
  }

  function showView(view) {
    document.body.dataset.view = view;
    $('#gate').classList.toggle('hidden', view !== 'gate');
    $('#pending').classList.toggle('hidden', view !== 'pending');
    $('#app').classList.toggle('hidden', view !== 'app');
  }

  function enterApp() {
    const u = Auth.user();
    document.body.dataset.role = u.role;
    $('#who-name').textContent = u.display;
    $('#who-role').textContent = Auth.ROLE_LABEL[u.role];
    $('#who-role').className = `badge ${u.role}`;
    $('#today-label').textContent = Util.prettyDate(Store.day().date);

    $$('#tabs .tab').forEach((b) => {
      const need = b.dataset.need;
      b.hidden = need === 'admin' ? !Auth.isAdmin() : need === 'staff' ? !Auth.isStaff() : false;
    });

    applyScoreVisibility();
    showView('app');
    setTab('board');
    syncRole();

    if (u.mustChangePassword) {
      toast('기본 비밀번호를 사용 중입니다. 비밀번호를 변경해주세요.', 'warn');
    }
  }

  function route() {
    const u = Auth.restore();
    if (!u) { syncRole(); showView('gate'); return; }
    if (u.role === 'pending') {
      syncRole();
      $('#pending-who').textContent = `${u.display} (@${u.username})`;
      showView('pending');
      return;
    }
    enterApp();
  }

  /* =========================================================
     드래그 & 드롭 + 탭 선택 이동
     ========================================================= */
  /** 칩이 놓여 있는 자리 문자열 */
  const posOf = (el) => el.closest('[data-pos]')?.dataset.pos || 'pool';

  /** 'c:0:*' 처럼 자리를 지정하지 않은 대상은 첫 빈 자리로 바꿔준다. */
  function resolvePos(pos) {
    if (!pos || !pos.endsWith(':*')) return pos;
    const [t, i] = pos.split(':');
    const idx = Number(i);
    const arr = t === 'c' ? Store.day().courts[idx]?.players : Store.day().queues[idx];
    if (!arr) return null;
    const slot = arr.indexOf(null);
    return slot >= 0 ? `${t}:${idx}:${slot}` : null;
  }

  function movePlayerTo(id, rawPos, fromPos) {
    if (!Auth.isStaff()) return;
    const toPos = resolvePos(rawPos);
    if (!toPos) { toast('빈 자리가 없습니다.', 'warn'); return; }
    Store.movePlayer(id, toPos, fromPos);
    ui.selected = null;
    ui.selectedFrom = null;
    commit();
  }

  function bindDnD() {
    document.addEventListener('dragstart', (e) => {
      const chip = e.target.closest('[data-drag-id]');
      if (!chip || !Auth.isStaff()) return;
      e.dataTransfer.setData('text/plain', `${chip.dataset.dragId}@${posOf(chip)}`);
      e.dataTransfer.effectAllowed = 'move';
      chip.classList.add('dragging');
    });

    document.addEventListener('dragend', () => {
      $$('.dragging').forEach((el) => el.classList.remove('dragging'));
      $$('.is-over').forEach((el) => el.classList.remove('is-over'));
    });

    document.addEventListener('dragover', (e) => {
      const zone = e.target.closest('[data-pos]');
      if (!zone || !Auth.isStaff()) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!zone.classList.contains('is-over')) {
        $$('.is-over').forEach((el) => el.classList.remove('is-over'));
        zone.classList.add('is-over');
      }
    });

    document.addEventListener('dragleave', (e) => {
      const zone = e.target.closest('[data-pos]');
      if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('is-over');
    });

    document.addEventListener('drop', (e) => {
      const zone = e.target.closest('[data-pos]');
      if (!zone || !Auth.isStaff()) return;
      e.preventDefault();
      const raw = e.dataTransfer.getData('text/plain');
      if (!raw) return;
      const at = raw.lastIndexOf('@');
      const id = at > 0 ? raw.slice(0, at) : raw;
      const from = at > 0 ? raw.slice(at + 1) : undefined;
      movePlayerTo(id, zone.dataset.pos, from);
    });
  }

  /** 터치 환경 대응: 선수를 탭해서 고른 뒤 목적지를 탭하면 이동 */
  function handleTapMove(e) {
    if (!Auth.isStaff()) return false;
    const chip = e.target.closest('[data-drag-id]');
    const zone = e.target.closest('[data-pos]');

    if (chip) {
      const id = chip.dataset.dragId;
      const at = posOf(chip);
      if (ui.selected && ui.selected !== id) { movePlayerTo(ui.selected, at, ui.selectedFrom); return true; }
      const same = ui.selected === id && ui.selectedFrom === at;
      ui.selected = same ? null : id;
      ui.selectedFrom = same ? null : at;
      renderBoard();
      return true;
    }
    if (zone && ui.selected) { movePlayerTo(ui.selected, zone.dataset.pos, ui.selectedFrom); return true; }
    return false;
  }

  /* =========================================================
     동작 (버튼)
     ========================================================= */
  async function doFinish(i) {
    const d = Store.day();
    const rec = Store.finishGame(i);
    if (d.autoAdvance && Store.queueReady(0)) Store.pushQueueToCourt(0, i);
    commit();
    toast(rec ? `${rec.court}코트 경기 종료 · 기록되었습니다` : '코트를 비웠습니다');
  }

  function doAutoFill(mode) {
    const includePlaying = !!Store.day().includePlaying;
    const r = mode === 'random'
      ? Scheduler.fillAll({ mode, includeCourts: false, includeQueues: true, includePlaying })
      : Scheduler.fillAll({ mode, includePlaying });
    commit();
    if (!r.filled) {
      toast(mode === 'random'
        ? '대기를 채울 인원이나 빈 대기 줄이 없습니다.'
        : '편성할 인원이 부족합니다. (4명 이상 필요)', 'warn');
      return;
    }
    const msg = `${r.filled}게임 편성 완료 · 남은 인원 ${r.remaining}명`;
    toast(r.relaxed ? `${msg} · 일부는 실력 차가 있는 편성입니다` : msg, r.relaxed ? 'warn' : '');
  }

  function doFillOne(kind, index, mode = 'auto') {
    const r = Scheduler.fillOne(kind, index, mode, !!Store.day().includePlaying);
    commit();
    if (!r.filled) {
      toast(r.reason === 'short' ? '미편성 인원이 4명 미만입니다.' : '조건에 맞는 조합을 찾지 못했습니다.', 'warn');
      return;
    }
    toast(r.relaxed ? '편성 완료 · 균형 조합이 없어 실력 차가 있는 편성입니다' : '편성 완료', r.relaxed ? 'warn' : '');
  }

  /** 대기 줄을 코트에 투입한다. 빈 코트가 여러 개면 어디로 넣을지 고르게 한다. */
  function pushQueue(qi) {
    const empties = Store.day().courts
      .map((c, ci) => ({ ci, empty: c.players.every((p) => !p) }))
      .filter((x) => x.empty)
      .map((x) => x.ci);

    if (!empties.length) { toast('비어 있는 코트가 없습니다.', 'warn'); return; }

    const send = (ci) => {
      if (!Store.pushQueueToCourt(qi, ci)) {
        toast('아직 경기 중인 인원이 있어 투입할 수 없습니다.', 'warn');
        return;
      }
      commit();
      toast(`${ci + 1}번 코트 투입 완료 · 대기 줄이 한 칸씩 당겨졌습니다`);
    };

    if (empties.length === 1) { send(empties[0]); return; }

    openModal(`
      <h3>${qi + 1}번 대기 투입</h3>
      <p class="muted" style="font-size:13.5px">어느 코트로 투입할까요?</p>
      <div class="court-choose">
        ${empties.map((ci) => `<button class="btn court-pick" data-court-pick="${ci}"><b>${ci + 1}</b><span>번 코트</span></button>`).join('')}
      </div>
      <div class="btn-row" style="justify-content:flex-end;margin-top:16px">
        <button class="btn btn-ghost" data-close>취소</button>
      </div>`);
    $('#modal-card').onclick = (e) => {
      const b = e.target.closest('[data-court-pick]');
      if (!b) return;
      const ci = Number(b.dataset.courtPick);
      closeModal();
      send(ci);
    };
  }

  function openMemberEdit(id) {
    const m = Store.memberById(id);
    if (!m) return;
    openModal(`
      <h3>인원 수정</h3>
      <form id="edit-member" class="stack">
        <label class="field"><span>이름</span><input name="name" value="${esc(m.name)}" required /></label>
        <div class="row2">
          <label class="field"><span>성별</span><select name="gender">
            <option value="M"${m.gender === 'M' ? ' selected' : ''}>남</option>
            <option value="F"${m.gender === 'F' ? ' selected' : ''}>여</option></select></label>
          <label class="field"><span>급수</span><select name="grade">
            ${Store.GRADES.map((g) => `<option value="${g}"${g === m.grade ? ' selected' : ''}>${Store.GRADE_LABEL[g]}</option>`).join('')}
          </select></label>
        </div>
        <label class="field"><span>구분</span><select name="kind">
          <option value="member"${!m.guest ? ' selected' : ''}>회원 (계속 유지)</option>
          <option value="guest"${m.guest ? ' selected' : ''}>게스트 (당일만)</option></select></label>
        <div class="btn-row" style="justify-content:flex-end">
          <button type="button" class="btn btn-ghost" data-close>취소</button>
          <button type="submit" class="btn btn-primary">저장</button>
        </div>
      </form>`);
    $('#edit-member').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      Store.updateMember(id, {
        name: String(f.get('name')).trim(),
        gender: f.get('gender'),
        grade: f.get('grade'),
        guest: f.get('kind') === 'guest',
      });
      closeModal(); commit(); toast('수정되었습니다');
    });
  }

  function openPasswordModal() {
    const u = Auth.user();
    openModal(`
      <h3>비밀번호 변경</h3>
      <form id="pw-form" class="stack">
        <label class="field"><span>현재 비밀번호</span><input name="cur" type="password" required /></label>
        <label class="field"><span>새 비밀번호</span><input name="next" type="password" minlength="4" required /></label>
        <label class="field"><span>새 비밀번호 확인</span><input name="next2" type="password" minlength="4" required /></label>
        <p class="form-msg" id="pw-msg"></p>
        <div class="btn-row" style="justify-content:flex-end">
          <button type="button" class="btn btn-ghost" data-close>취소</button>
          <button type="submit" class="btn btn-primary">변경</button>
        </div>
      </form>`);
    $('#pw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const msg = $('#pw-msg');
      if (f.get('next') !== f.get('next2')) { msg.textContent = '새 비밀번호가 일치하지 않습니다.'; return; }
      try {
        await Auth.changePassword(u.username, f.get('cur'), f.get('next'));
        closeModal(); toast('비밀번호가 변경되었습니다');
      } catch (err) { msg.textContent = err.message; }
    });
  }

  /* =========================================================
     이벤트 바인딩
     ========================================================= */
  function bindEvents() {
    /* --- 게이트 --- */
    $$('[data-gate-tab]').forEach((b) => b.addEventListener('click', () => {
      $$('[data-gate-tab]').forEach((x) => x.classList.toggle('is-on', x === b));
      $('#form-login').classList.toggle('hidden', b.dataset.gateTab !== 'login');
      $('#form-signup').classList.toggle('hidden', b.dataset.gateTab !== 'signup');
    }));

    $('#form-login').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const msg = $('#login-msg');
      msg.textContent = '';
      try {
        await Auth.login(f.get('username'), f.get('password'));
        e.target.reset();
        route();
      } catch (err) { msg.textContent = err.message; }
    });

    $('#form-signup').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const msg = $('#signup-msg');
      msg.className = 'form-msg';
      if (f.get('password') !== f.get('password2')) { msg.textContent = '비밀번호가 일치하지 않습니다.'; return; }
      try {
        await Auth.signup({ username: f.get('username'), display: f.get('display'), password: f.get('password') });
        e.target.reset();
        msg.className = 'form-msg ok';
        msg.textContent = '가입 신청이 완료되었습니다. 관리자 승인을 기다려주세요.';
      } catch (err) { msg.textContent = err.message; }
    });

    /* --- 설정 --- */
    $('#court-count').addEventListener('change', (e) => {
      Store.day().courtCount = Number(e.target.value);
      Store.normalizeDay(); commit();
    });
    $('#queue-rows').addEventListener('change', (e) => {
      Store.day().queueRows = Number(e.target.value);
      Store.normalizeDay(); commit();
    });
    $('#auto-advance').addEventListener('change', (e) => {
      Store.day().autoAdvance = e.target.checked; commit();
    });
    $('#include-playing').addEventListener('change', (e) => {
      Store.day().includePlaying = e.target.checked; commit();
      toast(e.target.checked
        ? '경기 중인 인원도 대기 편성 후보에 포함합니다'
        : '미편성 인원만으로 대기를 편성합니다');
    });
    $('#show-scores').addEventListener('change', (e) => {
      Store.setShowScores(e.target.checked);
      applyScoreVisibility();
      renderAll();
      toast(e.target.checked ? '내부 점수를 표시합니다 (이 브라우저에만 적용)' : '내부 점수를 숨겼습니다');
    });

    /* --- 탭 --- */
    $('#sync-chip').addEventListener('click', () => {
      if (Auth.isAdmin()) openSyncSetup();
      else toast(Sync.state().status === 'online' ? '실시간 동기화 중입니다' : '이 기기에만 저장됩니다');
    });

    $('#tabs').addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (b) setTab(b.dataset.tab);
    });

    /* --- 회원 추가 --- */
    $('#form-member').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const name = String(f.get('name')).trim();
      const msg = $('#member-msg');
      msg.className = 'form-msg';
      if (!name) { msg.textContent = '이름을 입력해주세요.'; return; }
      if (Store.members().some((m) => m.name === name)) {
        msg.textContent = '같은 이름이 이미 있습니다. 구분되도록 다르게 입력해주세요.';
        return;
      }
      const m = Store.addMember({ name, gender: f.get('gender'), grade: f.get('grade'), guest: f.get('kind') === 'guest' });
      msg.className = 'form-msg ok';
      msg.textContent = `${m.name} 추가 완료${m.guest ? ' (게스트 · 오늘 참석 처리)' : ''}`;
      // 성별·급수·구분은 그대로 두어 같은 급수를 연달아 넣기 쉽게 한다
      e.target.elements.name.value = '';
      e.target.elements.name.focus();
      commit();
    });

    $('#member-search').addEventListener('input', (e) => { ui.memberFilter = e.target.value; renderMembers(); });

    /* --- 명단 테이블 --- */
    $('#member-rows').addEventListener('change', (e) => {
      const tr = e.target.closest('tr'); if (!tr) return;
      const id = tr.dataset.mid;
      const act = e.target.dataset.act;
      if (act === 'attend') { Store.setAttendance(id, e.target.checked); commit(); }
      if (act === 'grade') { Store.updateMember(id, { grade: e.target.value }); commit(); }
    });

    $('#member-rows').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]'); if (!btn) return;
      const tr = e.target.closest('tr'); const id = tr.dataset.mid;
      if (btn.dataset.act === 'edit-member') openMemberEdit(id);
      if (btn.dataset.act === 'del-member') {
        const m = Store.memberById(id);
        if (await confirmModal('삭제 확인', `<b>${esc(m.name)}</b> 님을 명단에서 삭제할까요?`, '삭제', true)) {
          Store.removeMember(id); commit(); toast('삭제되었습니다');
        }
      }
    });

    /* --- 계정 관리 --- */
    $('#pending-list').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const u = b.dataset.u;
      if (b.dataset.act === 'approve') { Auth.setRole(u, b.dataset.r); commit(); toast(`@${u} 승인 완료`); }
      if (b.dataset.act === 'reject') {
        if (await confirmModal('가입 거절', `<b>@${esc(u)}</b> 계정을 삭제할까요?`, '거절', true)) {
          try { Auth.removeUser(u); commit(); toast('거절되었습니다'); }
          catch (err) { toast(err.message, 'err'); }
        }
      }
    });

    $('#user-rows').addEventListener('change', (e) => {
      const s = e.target.closest('[data-act="role"]'); if (!s) return;
      try { Auth.setRole(s.dataset.u, s.value); commit(); toast('권한이 변경되었습니다'); }
      catch (err) { toast(err.message, 'err'); renderAccounts(); }
    });

    $('#user-rows').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const u = b.dataset.u;
      if (b.dataset.act === 'del-user') {
        if (await confirmModal('계정 삭제', `<b>@${esc(u)}</b> 계정을 삭제할까요?`, '삭제', true)) {
          try { Auth.removeUser(u); commit(); toast('삭제되었습니다'); }
          catch (err) { toast(err.message, 'err'); }
        }
      }
      if (b.dataset.act === 'reset-pw') {
        if (await confirmModal('비밀번호 초기화', `<b>@${esc(u)}</b> 의 비밀번호를 <b>1111</b> 로 초기화할까요?`, '초기화')) {
          await Auth.resetPassword(u, '1111'); toast('1111 로 초기화되었습니다');
        }
      }
    });

    /* --- 전역 액션 --- */
    document.addEventListener('click', async (e) => {
      if (e.target.closest('[data-close]')) { closeModal(); return; }

      const b = e.target.closest('[data-action],[data-act]');
      if (!b) { if (ui.tab === 'board') handleTapMove(e); return; }
      const act = b.dataset.action || b.dataset.act;
      const i = Number(b.dataset.i);

      switch (act) {
        case 'logout': Auth.logout(); syncRole(); ui.selected = null; document.body.classList.remove('show-scores'); $('#toast').hidden = true; showView('gate'); return;
        case 'passwd': openPasswordModal(); return;
        case 'pick-attend': openAttendPicker(); return;

        case 'sync-connect': {
          const det = $('#sync-detail');
          try {
            const cfg = Sync.parseConfig($('#sync-config').value);
            Sync.saveConfig(cfg);
            Sync.disconnect();
            const ok = await Sync.setRole(dbRole());
            if (ok) toast('실시간 동기화에 연결했습니다');
          } catch (err) {
            if (det) det.textContent = err.message;
            toast(err.message, 'err');
          }
          return;
        }
        case 'sync-disconnect':
          if (await confirmModal('연결 끊기',
              '이 기기를 실시간 동기화에서 분리합니다.<br>서버의 데이터는 그대로 남고, 이후 변경은 이 기기에만 저장됩니다.', '연결 끊기', true)) {
            Sync.saveConfig(null);
            Sync.disconnect();
            Store.setPushRemote(null);
            toast('연결을 끊었습니다. 새로고침하면 완전히 반영됩니다.');
          }
          return;

        case 'finish': doFinish(i); return;
        case 'clear-court':
          if (await confirmModal(`${i + 1}번 코트 취소`,
              '경기 기록을 남기지 않고 코트를 비웁니다.<br>네 명은 미편성으로 돌아갑니다.', '취소하기', true)) {
            Store.clearCourt(i); commit(); toast(`${i + 1}번 코트 편성을 취소했습니다`);
          }
          return;
        case 'auto-court': doFillOne('c', i); return;
        case 'auto-queue': doFillOne('q', i, 'random'); return;
        case 'cancel-queue':
          if (await confirmModal(`${i + 1}번 대기 취소`,
              '이 줄의 편성을 지웁니다. 인원은 미편성으로 돌아갑니다.', '취소하기', true)) {
            Store.clearQueueRow(i); commit(); toast(`${i + 1}번 대기 편성을 취소했습니다`);
          }
          return;
        case 'push-queue': pushQueue(i); return;
        case 'auto-all': doAutoFill('auto'); return;
        case 'random-all': doAutoFill('random'); return;
        case 'clear-queues': Store.clearQueues(); commit(); return;

        case 'attend-all': Store.members().forEach((m) => Store.setAttendance(m.id, true)); commit(); return;
        case 'attend-none': Store.members().forEach((m) => Store.setAttendance(m.id, false)); commit(); return;
        case 'remove-guests':
          if (await confirmModal('게스트 삭제', '오늘 등록한 게스트를 모두 삭제합니다.', '삭제', true)) {
            Store.removeGuests(); commit(); toast('게스트를 삭제했습니다');
          }
          return;

        case 'reset-day':
          if (await confirmModal('오늘 기록 초기화', '오늘의 경기 기록 · 코트 · 대기가 모두 지워집니다.<br>참석 명단은 유지됩니다.', '초기화', true)) {
            Store.resetDay(); commit(); toast('초기화되었습니다');
          }
          return;
        case 'export':
          Util.download(`etoa-${Store.day().date}.json`, Store.exportJSON());
          return;
        case 'import': $('#import-file').click(); return;
        default: break;
      }

      if (ui.tab === 'board') handleTapMove(e);
    });

    $('#import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        Store.importJSON(await file.text());
        toast('가져오기 완료');
        route();
      } catch (err) { toast(`가져오기 실패: ${err.message}`, 'err'); }
      e.target.value = '';
    });

    /* --- 키보드 --- */
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeModal(); ui.selected = null; ui.selectedFrom = null; if (ui.tab === 'board') renderBoard(); }
    });

    /* --- 화면 폭이 바뀌면 코트 배치 갱신 --- */
    wideRow.addEventListener('change', () => { if (ui.tab === 'board') renderBoard(); });

    /* --- 다른 탭에서의 변경 반영 --- */
    window.addEventListener('storage', (e) => {
      if (e.key && e.key.startsWith('etoa.')) { Store.load(); route(); }
    });
  }

  /* =========================================================
     타이머 (경과 시간 표시)
     ========================================================= */
  function startTimers() {
    setInterval(() => {
      if (document.body.dataset.view !== 'app' || ui.tab !== 'board') return;
      const d = Store.day();
      $$('[data-timer]').forEach((el) => {
        const c = d.courts[Number(el.dataset.timer)];
        el.textContent = c && c.startedAt ? Util.clock(Date.now() - c.startedAt) : '';
      });
      // 자정을 넘기면 하루를 새로 시작
      if (d.date !== Util.todayStr()) { Store.rolloverIfNeeded(); Store.normalizeDay(); commit(); }
    }, 1000);
  }

  /* =========================================================
     시작
     ========================================================= */
  (async function boot() {
    Store.load();
    await Auth.ensureSeed();
    Store.refreshTimers();
    bindEvents();
    bindDnD();
    startTimers();
    startSync();
    route();
  })();
})();
