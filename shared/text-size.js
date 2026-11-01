/*
 * Text-size control (A / A+ / A++) on every simulator page, matching the Interactive Physics Lab's control.
 *
 * A classic script loaded in <head>, so the saved size is applied before the page paints. Page text is sized in rem
 * from html { font-size: calc(16px * var(--ts, 1)) }, so one variable on <html> scales it all. Plotly fonts are scaled
 * by shared/plot.js, and pages that draw their own text listen for the "textsizechange" event.
 * The choice is kept in this browser only (localStorage, wrapped in try/catch because storage can be blocked).
 */
(function () {
  var KEY = "mms-text-size";
  var SIZES = [
    { id: "base", label: "A", name: "standard text", scale: 1 },
    { id: "large", label: "A+", name: "large text", scale: 1.15 },
    { id: "xlarge", label: "A++", name: "extra-large text", scale: 1.3 },
  ];
  var root = document.documentElement;

  function read() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function save(id) { try { localStorage.setItem(KEY, id); } catch (e) { /* storage unavailable: lasts for this page only */ } }
  function apply(id) {
    var size = SIZES.filter(function (s) { return s.id === id; })[0] || SIZES[0];
    root.style.setProperty("--ts", String(size.scale));
    root.dataset.textSize = size.id;
    return size.id;
  }
  var current = apply(read());

  var CSS = ".topbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px}"
    + ".topbar nav{margin:0}"
    + ".text-size{display:flex;align-items:center;gap:3px;background:#2c2c2c;border:1px solid #444;padding:2px;border-radius:7px;margin-left:auto}"
    + ".text-size-caption{font-size:.8rem;color:#aaa;padding:0 6px 0 4px}"
    + ".text-size button{background:transparent;border:1px solid transparent;color:#e6e6e6;padding:3px 9px;min-width:34px;min-height:30px;"
    + "line-height:1;font-weight:700;border-radius:5px;cursor:pointer;font-family:inherit}"
    + ".text-size .text-size-base{font-size:13px}.text-size .text-size-large{font-size:16px}.text-size .text-size-xlarge{font-size:19px}"
    + ".text-size button[aria-pressed=true]{background:#1a1a1a;border-color:#FFD700;color:#FFD700}"
    + ".text-size button:focus-visible{outline:2px solid #FFD700;outline-offset:2px}"
    + ".sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}";

  function build() {
    var main = document.querySelector("main");
    if (!main || main.querySelector(".text-size")) return;
    var style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    var group = document.createElement("div");
    group.className = "text-size";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Text size");
    var caption = document.createElement("span");
    caption.className = "text-size-caption";
    caption.textContent = "Text";
    caption.setAttribute("aria-hidden", "true");
    group.appendChild(caption);
    SIZES.forEach(function (size) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "text-size-" + size.id;
      button.textContent = size.label;
      var hint = document.createElement("span");
      hint.className = "sr-only";
      hint.textContent = " " + size.name;
      button.appendChild(hint);
      button.title = size.name.charAt(0).toUpperCase() + size.name.slice(1);
      button.setAttribute("aria-pressed", String(size.id === current));
      button.addEventListener("click", function () {
        current = apply(size.id);
        save(current);
        group.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b === button)); });
        window.dispatchEvent(new Event("textsizechange"));
        window.dispatchEvent(new Event("resize"));
      });
      group.appendChild(button);
    });

    // Top bar: the "All simulators" link (if any) on the left, the text-size control on the right.
    var bar = document.createElement("div");
    bar.className = "topbar";
    var nav = main.querySelector(":scope > nav");
    main.insertBefore(bar, main.firstChild);
    if (nav) bar.appendChild(nav);
    bar.appendChild(group);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
