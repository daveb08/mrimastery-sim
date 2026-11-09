// Hover / focus / tap explanations for page controls. No dependencies.
//
// attachHints({ controlId: "text", ... }) puts a small "?" button beside each control's label (label[for=id]), or
// beside the control itself when it has no such label. Hovering the label or the button, focusing the button, or
// tapping it opens one shared popup next to it; leaving, blur, Escape or a tap elsewhere closes it.

// Self-contained styles (not every page loads shared/style.css); the page's colour variables are used when present.
const CSS = `
button.hint-btn { display: inline-flex; align-items: center; justify-content: center; width: 1.15em; height: 1.15em;
  margin: 0 0 0 .4em; padding: 0; border: 1px solid var(--muted, #aaa); border-radius: 50%; background: transparent;
  color: var(--muted, #aaa); font: inherit; font-size: .75em; font-weight: 700; line-height: 1; cursor: help;
  vertical-align: .1em; min-width: 0; box-shadow: none; }
button.hint-btn:hover, button.hint-btn:focus-visible, button.hint-btn[aria-expanded="true"] {
  color: var(--text, #e6e6e6); border-color: var(--text, #e6e6e6); background: transparent; }
.hint-pop { position: fixed; z-index: 1000; max-width: min(300px, calc(100vw - 16px)); box-sizing: border-box;
  padding: 8px 10px; background: var(--panel, #242424); color: var(--text, #e6e6e6); border: 1px solid var(--border, #444);
  border-radius: 6px; box-shadow: 0 4px 14px rgba(0, 0, 0, .5); font-size: .85rem; line-height: 1.4; font-weight: 400;
  text-align: left; pointer-events: none; }
.hint-pop[hidden] { display: none; }`;

export function attachHints(texts, doc = document) {
  if (!doc.getElementById("hint-style")) {
    const style = doc.createElement("style");
    style.id = "hint-style";
    style.textContent = CSS;
    doc.head.append(style);
  }
  const pop = doc.createElement("div");
  pop.className = "hint-pop";
  pop.id = "hintPop";
  pop.setAttribute("role", "tooltip");
  pop.hidden = true;
  doc.body.append(pop);
  let owner = null;

  const close = () => {
    if (!owner) return;
    owner.setAttribute("aria-expanded", "false");
    owner.removeAttribute("aria-describedby");
    owner = null;
    pop.hidden = true;
  };
  const open = (btn, text) => {
    if (owner && owner !== btn) close();
    owner = btn;
    pop.textContent = text;
    pop.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    btn.setAttribute("aria-describedby", pop.id);
    // below the button, kept inside the viewport (above it when there is no room below)
    const view = doc.defaultView, b = btn.getBoundingClientRect(), margin = 8;
    pop.style.left = "0px"; pop.style.top = "0px";
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const left = Math.max(margin, Math.min(b.left + b.width / 2 - w / 2, view.innerWidth - w - margin));
    let top = b.bottom + 6;
    if (top + h > view.innerHeight - margin && b.top - h - 6 > margin) top = b.top - h - 6;
    pop.style.left = `${left}px`; pop.style.top = `${top}px`;
  };

  for (const [id, text] of Object.entries(texts)) {
    const el = doc.getElementById(id);
    if (!el) continue;
    const label = doc.querySelector(`label[for="${id}"]`);
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "hint-btn";
    btn.textContent = "?";
    btn.setAttribute("aria-label", "What is this?");
    btn.setAttribute("aria-expanded", "false");
    if (label) {
      // right after the label's own text, before any value read-out
      const first = label.firstChild;
      if (first && first.nodeType === 3) first.after(btn); else label.prepend(btn);
    } else {
      el.after(btn);
    }
    for (const t of new Set([label ?? btn, btn])) {
      t.addEventListener("mouseenter", () => open(btn, text));
      t.addEventListener("mouseleave", () => { if (owner === btn && doc.activeElement !== btn) close(); });
    }
    btn.addEventListener("focus", () => open(btn, text));
    btn.addEventListener("blur", () => { if (owner === btn) close(); });
    btn.addEventListener("click", (e) => {
      e.preventDefault(); // a "?" inside a label must not toggle or focus the control
      e.stopPropagation();
      if (owner === btn && !pop.hidden) close(); else open(btn, text);
    });
  }
  doc.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  doc.addEventListener("click", (e) => { if (owner && !owner.contains(e.target)) close(); });
  doc.defaultView.addEventListener("scroll", close, { passive: true });
}
