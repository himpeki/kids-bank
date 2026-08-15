// 共通UIヘルパ: トースト・確認モーダル・表示フォーマット・紙吹雪。

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

export const fmtYen = (n) => `${Number(n).toLocaleString("ja-JP")}えん`;
export const fmtPt = (n) => `${Number(n).toLocaleString("ja-JP")}pt`;
export const fmtAmount = (currency, n) => (currency === "yen" ? fmtYen(n) : fmtPt(n));

export function fmtDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : ts;
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function toast(message, kind = "info") {
  let box = document.getElementById("toast-box");
  if (!box) {
    box = document.createElement("div");
    box.id = "toast-box";
    document.body.appendChild(box);
  }
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.classList.add("show"), 10);
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

/** 確認モーダル。ok を押したら true */
export function confirmModal({ title, body = "", okLabel = "OK", cancelLabel = "やめる" }) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `
      <div class="modal">
        <h3>${esc(title)}</h3>
        <div class="modal-body">${body}</div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-act="cancel">${esc(cancelLabel)}</button>
          <button class="btn btn-primary" data-act="ok">${esc(okLabel)}</button>
        </div>
      </div>`;
    wrap.addEventListener("click", (e) => {
      const act = e.target.dataset?.act;
      if (act || e.target === wrap) {
        wrap.remove();
        resolve(act === "ok");
      }
    });
    document.body.appendChild(wrap);
  });
}

/** 入力欄つきモーダル。okで入力文字列(空可)、キャンセルで null */
export function promptModal({ title, body = "", placeholder = "", okLabel = "OK", cancelLabel = "やめる" }) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `
      <div class="modal">
        <h3>${esc(title)}</h3>
        <div class="modal-body">${body}</div>
        <input type="text" class="pm-input" placeholder="${esc(placeholder)}" maxlength="100">
        <div class="modal-actions" style="margin-top:14px">
          <button class="btn btn-ghost" data-act="cancel">${esc(cancelLabel)}</button>
          <button class="btn btn-primary" data-act="ok">${esc(okLabel)}</button>
        </div>
      </div>`;
    const input = wrap.querySelector(".pm-input");
    wrap.addEventListener("click", (e) => {
      const act = e.target.dataset?.act;
      if (act === "ok") {
        wrap.remove();
        resolve(input.value.trim());
      } else if (act === "cancel" || e.target === wrap) {
        wrap.remove();
        resolve(null);
      }
    });
    document.body.appendChild(wrap);
    input.focus();
  });
}

/** ボタン連打防止: 実行中は disabled にする */
export async function withBusy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    return await fn();
  } finally {
    btn.disabled = false;
  }
}

/**
 * 画像ファイルを縮小して data URL (JPEG) にする。
 * Firestore の1ドキュメント上限(1MiB)に収まるよう、寸法と画質を段階的に落とす。
 */
export async function fileToResizedDataUrl(file, maxChars = 650000) {
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("ファイルを読み込めませんでした"));
    r.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("画像として読み込めませんでした"));
    i.src = dataUrl;
  });
  for (const maxDim of [1200, 900, 600, 400]) {
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // PNGの透過はJPEG化で白背景に
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const q of [0.85, 0.75, 0.6, 0.45]) {
      const out = canvas.toDataURL("image/jpeg", q);
      if (out.length <= maxChars) return out;
    }
  }
  throw new Error("画像が大きすぎて保存できませんでした");
}

/** 紙吹雪。durationMs のあいだ舞って自動で消える */
export function confetti(durationMs = 2500) {
  const canvas = document.createElement("canvas");
  canvas.className = "confetti-canvas";
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const colors = ["#ff6b6b", "#ffd93d", "#6bcB77", "#4d96ff", "#ff8fab", "#b980f0"];
  const parts = Array.from({ length: 120 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * canvas.height * 0.5,
    w: 6 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    vy: 2 + Math.random() * 3,
    vx: -1 + Math.random() * 2,
    rot: Math.random() * Math.PI,
    vr: -0.1 + Math.random() * 0.2,
    color: colors[(Math.random() * colors.length) | 0],
  }));
  const start = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (t - start < durationMs) requestAnimationFrame(frame);
    else canvas.remove();
  })(start);
}
