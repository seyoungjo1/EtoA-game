/* ===========================================================
   util.js — 공용 유틸
   =========================================================== */
const Util = (() => {
  const pad = (n) => String(n).padStart(2, '0');

  /** 하루의 경계. 새벽 4시 전은 전날로 친다. (밤늦게까지 이어지는 모임 때문) */
  const DAY_START_HOUR = 4;

  function todayStr(d = new Date()) {
    const t = new Date(d.getTime());
    if (t.getHours() < DAY_START_HOUR) t.setDate(t.getDate() - 1);
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  }

  function clockTime(ts) {
    const t = new Date(ts);
    return `${pad(t.getHours())}:${pad(t.getMinutes())}`;
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

  /** 고른 그림을 정사각형으로 줄여 data URI 로 바꾼다. (모임 이미지용) */
  function imageToDataUrl(file, size = 160) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('그림 파일을 골라주세요.'));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('그림을 열지 못했습니다.'));
        img.onload = () => {
          const side = Math.min(img.width, img.height);
          const cv = document.createElement('canvas');
          cv.width = size; cv.height = size;
          const ctx = cv.getContext('2d');
          ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
          let out = cv.toDataURL('image/png');
          if (out.length > 40000) out = cv.toDataURL('image/jpeg', 0.85);   // 사진이면 더 줄인다
          if (out.length > 60000) return reject(new Error('그림이 너무 큽니다. 더 작은 파일을 써주세요.'));
          resolve(out);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { pad, DAY_START_HOUR, todayStr, clockTime, prettyDate, clock, uid, esc, hash, shuffle, pick, fmt, imageToDataUrl, download };
})();
