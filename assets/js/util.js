/* ===========================================================
   util.js — 공용 유틸
   =========================================================== */
const Util = (() => {
  const pad = (n) => String(n).padStart(2, '0');

  function todayStr(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function prettyDate(str) {
    const [y, m, d] = str.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const w = ['일', '월', '화', '수', '목', '금', '토'][dt.getDay()];
    return `${y}년 ${m}월 ${d}일 (${w})`;
  }

  function clock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  }

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /** 비밀번호 해시(SHA-256). 정적 사이트라 강한 보안은 아니며 평문 저장만 피하는 용도. */
  async function hash(username, password) {
    const text = `etoa::${String(username).toLowerCase()}::${password}`;
    if (window.crypto && crypto.subtle && window.isSecureContext) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map((b) => pad(b.toString(16))).join('');
    }
    // https 가 아닌 환경(로컬 file:// 등) 대비 폴백
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < text.length; i++) {
      h1 = Math.imul(h1 ^ text.charCodeAt(i), 16777619) >>> 0;
      h2 = Math.imul(h2 + text.charCodeAt(i) * (i + 7), 2246822519) >>> 0;
    }
    return `fb${h1.toString(16)}${h2.toString(16)}`;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  /** 소수점 1자리까지, 불필요한 .0 은 유지(점수 표기 일관성) */
  const fmt = (n) => (Math.round(n * 10) / 10).toFixed(1);

  function download(filename, text) {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { pad, todayStr, prettyDate, clock, uid, esc, hash, shuffle, pick, fmt, download };
})();
