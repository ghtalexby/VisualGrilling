import { randomUUID } from "node:crypto";

// Only this trusted renderer runs in the iframe. Project JavaScript runs in a worker
// without a DOM or navigation capability; inherited CSP denies network access.
export function previewDocument(project, instance) {
  const nonce = randomUUID();
  const data = Buffer.from(JSON.stringify({ ...project, instance })).toString("base64");
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; worker-src blob:; connect-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>body{margin:24px;font:16px system-ui}#camera{transform-origin:0 0}button,input,select{font:inherit}#tools{position:fixed;right:8px;top:8px;z-index:10000;background:white}</style><div id="tools"><button id="minus">−</button><button id="plus">+</button><button id="left">←</button><button id="right">→</button><button id="up">↑</button><button id="down">↓</button></div><div id="camera"></div><script nonce="${nonce}">(${runtime.toString()})(${JSON.stringify(data)})</script>`;
}

function runtime(encoded) {
  const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0))));
  const send = (type, extra = {}) => parent.postMessage({ type, instance: p.instance, ...extra }, "*");
  const camera = document.querySelector("#camera");
  const template = document.createElement("template"); template.innerHTML = p.files["index.html"];
  const tags = new Set("DIV SPAN P H1 H2 H3 H4 LABEL INPUT SELECT OPTION BUTTON OUTPUT SECTION MAIN HEADER FOOTER UL OL LI TABLE THEAD TBODY TR TD TH BR HR IMG SVG G PATH RECT CIRCLE LINE POLYLINE POLYGON TEXT DEFS MARKER".split(" "));
  const attrs = new Set("id class title role aria-label type min max step value checked selected name data-bind data-text data-width data-height data-radius data-color data-action viewbox d x y x1 x2 y1 y2 cx cy r width height fill stroke stroke-width points transform marker-end markerwidth markerheight refx refy orient".split(" "));
  for (const el of [...template.content.querySelectorAll("*")]) {
    if (!tags.has(el.tagName.toUpperCase())) { el.remove(); continue; }
    for (const a of [...el.attributes]) if (!attrs.has(a.name.toLowerCase()) && !(el.tagName === "IMG" && a.name === "src") || /url\s*\(|\\/i.test(a.value)) el.removeAttribute(a.name);
    if (el.tagName === "IMG") {
      const name = el.getAttribute("src"), image = p.files[name];
      if (name?.startsWith("images/") && image) el.src = "data:image/" + (name.endsWith(".jpg") ? "jpeg" : name.split(".").pop()) + ";base64," + image;
      else el.removeAttribute("src");
    }
    if (el.tagName === "INPUT" && !["range", "number", "text", "checkbox", "color"].includes(el.type)) el.type = "text";
  }
  const css = document.createElement("style"); css.textContent = p.files["style.css"] || ""; document.head.append(css); camera.append(template.content);
  let current = null, ready = false, pending = 0, serial = 0, fatal = null, timer;
  const events = [];
  const checked = value => value && typeof value === "object" && !Array.isArray(value) && JSON.stringify(value).length <= 60000 && Object.values(value).every(v => v === null || ["string", "boolean"].includes(typeof v) || typeof v === "number" && Number.isFinite(v));
  const paint = state => {
    current = state;
    for (const el of camera.querySelectorAll("[data-bind]")) {
      const v = state[el.dataset.bind];
      if (el.type === "checkbox") el.checked = !!v; else if (v != null) el.value = String(v);
    }
    for (const el of camera.querySelectorAll("[data-text]")) el.textContent = state[el.dataset.text] ?? "";
    for (const [key, prop] of [["width", "width"], ["height", "height"], ["radius", "borderRadius"]]) for (const el of camera.querySelectorAll("[data-" + key + "]")) {
      const v = Number(state[el.dataset[key]]); if (Number.isFinite(v)) el.style[prop] = Math.max(0, Math.min(10000, v)) + "px";
    }
    for (const el of camera.querySelectorAll("[data-color]")) { const v = state[el.dataset.color]; if (/^#[a-f0-9]{6}$/i.test(v)) el.style.backgroundColor = v; }
  };
  const source = p.files["script.js"] + "\n;onmessage = e => { try { const m=e.data; const next=m.event.type==='init' ? (m.state || initialState) : update(m.state,m.event); postMessage({seq:m.seq,state:next}); } catch(e) { postMessage({seq:e.data?.seq,error:String(e)}); } };";
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const worker = new Worker(url); URL.revokeObjectURL(url);
  const error = () => { clearTimeout(timer); fatal = "Preview script failed or timed out"; pending = 0; worker.terminate(); send("error", { error: fatal }); };
  const run = event => {
    if (fatal) return;
    if (pending) {
      // Coalesce only adjacent inputs to the same control; preserve action ordering.
      const last = events.at(-1);
      if (event.type === "input" && last?.type === "input" && last.name === event.name) events[events.length - 1] = event;
      else if (events.length < 100) events.push(event); else error();
      return;
    }
    pending = ++serial; worker.postMessage({ seq: pending, state: current, event }); timer = setTimeout(error, 3000);
  };
  worker.onerror = error;
  worker.onmessage = e => {
    if (!pending || e.data?.seq !== pending || !checked(e.data.state)) { error(); return; }
    clearTimeout(timer); pending = 0; paint(e.data.state);
    if (!ready) { ready = true; send("ready"); } else send("dirty");
    if (events.length) run(events.shift());
  };
  current = p.savedState; run({ type: "init" });
  camera.addEventListener("input", e => { if (!ready || !e.target.dataset.bind) return; send("dirty"); run({ type: "input", name: e.target.dataset.bind, value: e.target.type === "checkbox" ? e.target.checked : ["number", "range"].includes(e.target.type) ? Number(e.target.value) : e.target.value }); });
  camera.addEventListener("click", e => { const name = e.target.closest("[data-action]")?.dataset.action; if (ready && name) { send("dirty"); run({ type: "action", name }); } });
  let scale = 1, x = 0, y = 0;
  const transform = () => camera.style.transform = "translate(" + x + "px," + y + "px) scale(" + scale + ")";
  for (const [id, action] of Object.entries({ plus: () => scale = Math.min(4, scale * 1.2), minus: () => scale = Math.max(.2, scale / 1.2), left: () => x -= 60, right: () => x += 60, up: () => y -= 60, down: () => y += 60 })) document.getElementById(id).onclick = () => { action(); transform(); };
  addEventListener("message", e => {
    const m = e.data;
    if (e.source !== parent || m?.instance !== p.instance || typeof m.requestId !== "string") return;
    if (!["save", "export"].includes(m.type)) return;
    if (!ready || pending || fatal) { send("error", { requestId: m.requestId, error: fatal || "Preview is not ready" }); return; }
    if (m.type === "save") send("saved", { requestId: m.requestId, state: current });
    else {
      const clone = camera.cloneNode(true);
      const originals = [camera, ...camera.querySelectorAll("*")], copies = [clone, ...clone.querySelectorAll("*")];
      // Freeze computed values instead of replaying animations or depending on hover/focus.
      originals.forEach((original, i) => {
        const computed = getComputedStyle(original);
        for (const property of computed) if (!property.startsWith("animation") && !property.startsWith("transition")) copies[i].style.setProperty(property, computed.getPropertyValue(property));
        copies[i].style.animation = "none"; copies[i].style.transition = "none";
      });
      for (const el of clone.querySelectorAll("input,select,button")) {
        const span = document.createElement("span"); span.style.cssText = el.style.cssText;
        span.textContent = el.type === "checkbox" ? (el.checked ? "☑" : "☐") : el.tagName === "SELECT" ? el.selectedOptions[0]?.textContent || el.value : el.value || el.textContent;
        el.replaceWith(span);
      }
      const wrap = document.createElement("div"); wrap.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      wrap.append(clone);
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + innerWidth + '" height="' + innerHeight + '"><foreignObject width="100%" height="100%">' + new XMLSerializer().serializeToString(wrap) + '</foreignObject></svg>';
      send("exported", { requestId: m.requestId, svg });
    }
  });
}
