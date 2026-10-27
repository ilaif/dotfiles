const log = (...a) => console.log("[share-nudge]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(label, fn, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(100);
  }
  throw new Error(`[share-nudge] timeout waiting for: ${label}`);
}

// Find the clickable element owning a visible text node that equals `text` (string) or matches it (RegExp).
const ORG = /^Anyone at /;

function byText(text) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const v = n.nodeValue.trim();
    if (text instanceof RegExp ? !text.test(v) : v !== text) continue;
    const el = n.parentElement;
    if (!el.getClientRects().length) continue;
    return el.closest("button, a, [role]") ?? el;
  }
}

// Radix-style menus open on pointerdown, so a bare .click() is not enough.
const click = (el) => {
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, view: window, button: 0 }));
};

const closePanel = () =>
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }),
  );

async function openShare() {
  if (byText("General access")) return;
  click(await waitFor("Share button", () => byText("Share")));
  await waitFor("General access", () => byText("General access"));
}

async function makeOrgCommenter() {
  click(await waitFor("Only you", () => byText("Only you")));
  click(await waitFor("Anyone at <org> option", () => byText(ORG)));
  await waitFor("role picker", () => byText("Commenter") || byText("Viewer") || byText("Editor"));
  if (!byText("Commenter")) {
    click(byText("Viewer") ?? byText("Editor"));
    click(await waitFor("Commenter option", () => byText("Commenter")));
  }
  await waitFor("final state", () => byText(ORG) && byText("Commenter"));
  closePanel();
}

function banner() {
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#1f2937;color:#fff;" +
    "padding:12px 16px;border-radius:8px;font:14px system-ui;box-shadow:0 4px 16px #0006;" +
    "display:flex;gap:12px;align-items:center";
  const msg = document.createElement("span");
  msg.textContent = "🔒 Only you can open this artifact";
  const btn = document.createElement("button");
  btn.textContent = "Share with org (Commenter)";
  btn.style.cssText =
    "background:#4086ff;color:#fff;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;font:inherit";
  const close = document.createElement("button");
  close.textContent = "✕";
  close.style.cssText = "background:none;color:#fff;border:0;cursor:pointer;font:inherit";
  close.onclick = () => {
    localStorage.setItem(dismissKey, "1");
    el.remove();
  };
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = "Sharing…";
    await openShare();
    await makeOrgCommenter();
    msg.textContent = "✅ Shared with org · Commenter";
    btn.remove();
    setTimeout(() => el.remove(), 3000);
  };
  el.append(msg, btn, close);
  document.body.append(el);
}

const dismissKey = `share-nudge:dismissed:${location.pathname}`;

(async () => {
  log("loaded", location.href);
  if (localStorage.getItem(dismissKey)) return log("dismissed for this artifact");
  await openShare();
  const priv = !!byText("Only you");
  log("private:", priv);
  closePanel();
  if (priv) banner();
})();
