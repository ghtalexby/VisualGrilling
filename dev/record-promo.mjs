#!/usr/bin/env node
// Record the README promo clip: the real map UI in headless Chromium, driven through CDP,
// with a scripted agent answering events over the real HTTP contract. No packages.
// Requires Node 22+, Chromium (GRILL_BROWSER) and ffmpeg (GRILL_FFMPEG or PATH).
//
//   node dev/record-promo.mjs [--out images/promo] [--mp4] [--work <dir>] [--no-encode]
//     --out        output path prefix; writes the animated <out>.webp
//     --mp4        also write <out>.mp4 (1920x1080), e.g. to upload as a GitHub attachment
//     --work       keep captured frames in this directory instead of a temporary one
//     --no-encode  capture frames only (use with --work)
//
// The demo project, its questions and every agent reply are fixed fixtures below:
// the clip shows the mechanics, not the reasoning quality of a real agent.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
// A mistyped option must not fall back to the default output and overwrite the tracked clip.
for (const [i, a] of argv.entries()) if (!["--out", "--work", "--mp4", "--no-encode"].includes(a) && !["--out", "--work"].includes(argv[i - 1])) { console.error("Unknown option: " + a); process.exit(1); }
function opt(n, d) {
  const i = argv.indexOf("--" + n); if (i < 0) return d;
  if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) { console.error(`--${n} needs a value`); process.exit(1); }
  return argv[i + 1];
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(opt("out", path.join(ROOT, "images", "promo")));
const ENCODE = !argv.includes("--no-encode");
const FFMPEG = process.env.GRILL_FFMPEG || "ffmpeg";
const WIDTH = 1280, HEIGHT = 720, SCALE = 1.5;

const executable = [process.env.GRILL_BROWSER, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(p => p && fs.existsSync(p));
if (!executable || typeof WebSocket === "undefined") { console.error("Promo recording needs Chromium (set GRILL_BROWSER) and Node 22+"); process.exit(1); }
if (ENCODE) {
  // Check the encoders up front: a failed encode would otherwise cost the whole recording.
  const probe = spawnSync(FFMPEG, ["-hide_banner", "-encoders"], { encoding: "utf8" });
  if (probe.status !== 0) { console.error("ffmpeg not found (set GRILL_FFMPEG)"); process.exit(1); }
  for (const encoder of ["libwebp_anim", ...(argv.includes("--mp4") ? ["libx264"] : [])]) if (!new RegExp(`\\s${encoder}\\s`).test(probe.stdout)) { console.error(`ffmpeg lacks the ${encoder} encoder`); process.exit(1); }
}

const cli = path.join(ROOT, "skills", "grill", "grill.mjs");
const KEEP = opt("work", null);
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-promo-")), dir = path.join(cwd, ".grill"), profile = path.join(cwd, "browser");
const work = KEEP ? path.resolve(KEEP) : path.join(cwd, "frames");
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- demo project ---------- */
const INIT = {
  title: "Tablekeep",
  brief: "Tablekeep lets small restaurants take a card deposit with every booking to cut no-shows. Restaurants pay $49 a month plus 1% of deposits. Guests book through a widget on the restaurant's site. The MVP is live in three pilot restaurants.",
  arch: "Next.js and Postgres in one region. Deposits go through Stripe, reminders through a single SMS provider; neither call has retries or a fallback.",
  questions: [
    { area: "Problem", q: "How do you know no-shows cost owners enough to pay $49 a month?", why: "The pitch assumes the loss is painful and measurable, but the README has no numbers.", options: ["We measured it in the pilots", "Owners told us it hurts", "Industry reports say so"] },
    { area: "Customer", q: "Will guests still book when asked for a card deposit up front?", why: "A deposit that scares guests away costs more than the no-shows it prevents.", options: ["A/B tested the booking widget", "Pilots have not complained", "Not measured yet"] },
    { area: "Monetization", q: "What does one restaurant bring in per month versus what it costs to onboard and support?", why: "At $49 a month, a few hours of hand-holding can erase the margin.", options: ["Tracked per account", "Rough estimate only"] },
    { area: "Technology", q: "What happens to a booking when Stripe or the SMS provider is down?", why: "The code calls a single provider with no retries or fallback.", options: ["Queued and retried", "The booking fails with an error", "It goes through without a deposit"] },
    { area: "Legal", q: "Who answers when a guest disputes a kept deposit: you or the restaurant?", why: "Chargebacks land on the merchant of record, and the README never names one.", options: ["The restaurant, by contract", "We absorb disputes", "Not decided"] },
  ],
};
const Q = Object.fromEntries(["problem", "customer", "money", "tech", "legal"].map((key, i) => [key, INIT.questions[i].q]));
const ANSWERS = {
  [Q.problem]: { status: "weak", verdict: "Opinions, not losses. Nobody has counted the missed covers or priced a no-show per table.", topics: ["no-shows", "pricing"],
    children: [
      { q: "How many no-shows a week did each pilot have before Tablekeep?", why: "Without a baseline the product cannot show that it works.", options: ["We have their booking logs", "Owners' estimates", "No baseline"] },
      { q: "What monthly loss makes $49 an obvious yes for an owner?", why: "The price needs an anchor in the owner's own numbers.", options: ["At least $300", "Any loss at all", "Never asked"] },
    ] },
  [Q.money]: { status: "ok", verdict: "Concrete per-account numbers. The margin holds while onboarding stays near two hours.", topics: ["unit economics"], children: [] },
  [Q.tech]: { status: "gap", verdict: "There is no failure path: an outage silently drops the deposit, or the whole booking.", topics: ["providers", "reliability"],
    children: [{ q: "On a Friday night, which is worse: a lost booking or a booking without a deposit?", why: "The answer decides whether to fail closed or fail open.", options: ["A lost booking", "A booking without a deposit", "Depends on the restaurant"] }] },
};
const TYPED = "Pilots pay $49 plus about $21 in fees: $70 a month. Onboarding takes 2 hours, support 20 minutes a month.";
const CHALLENGE = "We do have data: the 3 pilots logged 11 no-shows a week before us, about $640 a month each.";
const REPLY = { reply: "That is the measured baseline that was missing: $640 a month lost against a $49 fee is an easy yes. Three pilots is still a small sample, so I am moving this from Weak to Verify.",
  assessment: { status: "verify", verdict: "Measured in 3 pilots: about $640 a month lost per restaurant. Confirm on a wider sample before relying on it." } };
const SUMMARY = "Verdict: alive, if the no-show loss holds beyond three pilots.\n\nRisks:\n1. A provider outage drops deposits or bookings: there is no failure path.\n2. The loss baseline rests on three pilots.\n3. The effect of a deposit on guest conversion is unmeasured.\n\nChecks for the week:\n1. Pull booking logs from 10 more restaurants. Pass: median loss of $300 a month or more.\n2. Add a retry queue for Stripe and SMS, then kill each provider in staging.";

/* ---------- plumbing ---------- */
let server, browser, ws, url, sequence = 0, stopped = false, failure = null;
const pending = new Map(), frames = [];
let recordedUntil = 0;
async function until(fn, label = "condition") { for (let i = 0; i < 300; i++) { if (failure) throw failure; const value = await fn(); if (value) return value; await sleep(100); } throw new Error("Timed out: " + label); }
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (ws.readyState !== WebSocket.OPEN) { reject(failure || new Error("Browser connection is closed")); return; }
    const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
}
async function js(expression) {
  const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(expression.slice(0, 120) + ": " + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function api(route, body) {
  const r = await fetch(url + "api/" + route, { method: body === undefined ? "GET" : "POST", headers: { "x-grill": "1", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(r.status, 200, route + ": " + await r.clone().text()); return r.json();
}
async function end(child) { if (!child || child.exitCode !== null) return; const ended = new Promise(r => child.once("exit", r)); child.kill(); await ended; }

/* ---------- scripted agent ---------- */
// Holds a wait open like a real session, so the map shows a connected agent.
const THINK = { answer: 1900, discuss: 2200, finish: 1800 };
function respond(e) {
  const cards = [...(e.context?.focus || []), ...(e.context?.related || [])], focus = cards.find(n => n.id === e.id);
  if (e.type === "answer") {
    const a = ANSWERS[focus.q]; assert.ok(a, "No scripted verdict for: " + focus.q);
    return { type: "answer", id: e.id, token: e.token, status: a.status, verdict: a.verdict, ancestors: [],
      coverage: { resolved: a.status === "ok", reason: a.verdict, sources: [],
        gaps: a.children.map((q, i) => ({ gap: q.why, questionIds: ["$clarify" + i] })),
        questions: a.children.map((q, i) => ({ key: "$clarify" + i, ...q })) }, semantics: { topics: a.topics } };
  }
  if (e.type === "discuss") return { type: "discuss", id: e.id, token: e.token, ...REPLY,
    assessment: { ...REPLY.assessment, ancestors: [], coverage: { resolved: false, reason: "Three pilots establish a baseline but do not establish its prevalence.", sources: [],
      gaps: [{ gap: "The pilot sample may not represent other restaurants.", questionIds: ["$sample"] }],
      questions: [{ key: "$sample", q: "What larger sample confirms the pilot result?", why: "Check whether the measured loss generalizes beyond three pilots.", options: ["Ten more booking logs", "Only the original pilots", "Not measured"] }] } }, semantics: { topics: ["no-shows", "pricing"] } };
  if (e.type === "followup") {
    const cards = [...(e.context?.focus || []), ...(e.context?.related || [])], n = cards.find(n => n.id === e.id);
    const child = cards.find(n => n.parentId === e.id && n.kind === "q");
    return { type: "followup", id: e.id, token: e.token, status: n.status, verdict: n.verdict, coverage: { resolved: false, reason: "Demo clarification remains necessary", sources: [], gaps: [{ gap: n.verdict, questionIds: [child?.id || "$proof"] }], questions: child ? [] : [{ key: "$proof", q: "What larger sample confirms the pilot result?", why: "Check the pilot assumption", options: ["Measured", "Not measured"] }] } };
  }
  if (e.type === "reevaluate") return { type: "reevaluate", token: e.token, capturedForSpec: e.capturedForSpec,
    assessments: e.ids.map(id => {
      const n = e.nodes.find(n => n.id === id);
      assert.ok(n?.gapCoverage, "Missing scripted coverage for: " + id);
      return { id, status: n.status, verdict: n.verdict,
        coverage: { resolved: n.gapCoverage.resolved, reason: n.gapCoverage.reason, sources: [], gaps: n.gapCoverage.gaps } };
    }) };
  if (e.type === "knowledge") return { type: "knowledge", token: e.token, files: [] };
  if (e.type === "finish") return { type: "finish", token: e.token, summary: SUMMARY };
  // Anything else means the storyboard drifted: fail instead of improvising map content.
  throw new Error("Unscripted event: " + e.type);
}
async function agent() {
  while (!stopped) {
    let e;
    try { e = await api("wait?timeout=20"); } catch (error) { if (stopped) return; throw error; }
    if (e.type === "timeout") continue;
    await sleep(THINK[e.type] ?? 300);
    await api("apply", respond(e));
  }
}

/* ---------- stage directions ---------- */
let mouse = { x: WIDTH * 0.62, y: HEIGHT * 0.6 };
async function moveTo(x, y, ms = 650) {
  const from = { ...mouse }, steps = Math.max(2, Math.round(ms / 16)), t0 = Date.now();
  for (let i = 1; i <= steps; i++) {
    const k = i / steps, e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    mouse = { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e };
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: mouse.x, y: mouse.y });
    const due = t0 + ms * k - Date.now(); if (due > 0) await sleep(due);
  }
}
const point = selector => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:"nearest"});const r=e.getBoundingClientRect();return{x:r.left+Math.min(r.width/2,170),y:r.top+r.height/2}})()`);
async function click(selector, ms) {
  const p = await until(() => point(selector), selector);
  await moveTo(p.x, p.y, ms); await sleep(140);
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
  await sleep(70);
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
}
async function type(text, ms = 13) { for (const ch of text) { await cdp("Input.insertText", { text: ch }); await sleep(ms + (ch === " " ? 14 : 0)); } }
const caption = text => js(`promo.caption(${JSON.stringify(text)})`);
// Camera: null shows the whole map; an id keeps every column in view, centred on that card and its follow-ups.
const frame = id => js(`promo.frame(${JSON.stringify(id)})`);
async function openCard(id) {
  await frame(null); await sleep(500);
  await click(`#stage .node[data-id="${id}"] .node-main`, 650);
  // The previous card's panel may still be open: wait for this one before aiming at its controls.
  await until(() => js(`panel?.id===${JSON.stringify(id)}`), "panel " + id);
  await frame(id); await sleep(500);
}
async function graded(id, value) {
  await until(() => js(`get(${JSON.stringify(id)})?.status===${JSON.stringify(value)}&&!get(${JSON.stringify(id)}).pending`), "status " + value);
  await sleep(150); await frame(id);
}

// Cursor, captions, intro and outro live in one overlay outside the map's own DOM.
const OVERLAY = `(()=>{
  const css=document.createElement("style");css.textContent=\`
    #promoCursor{position:fixed;left:0;top:0;z-index:100000;pointer-events:none;width:22px;height:22px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.55))}
    #promoCursor.down{scale:.86}
    #promoRing{position:fixed;left:0;top:0;z-index:99999;pointer-events:none;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;border:2px solid #8fb0ff;opacity:0}
    #promoRing.go{animation:promoRing .45s ease-out}
    @keyframes promoRing{from{opacity:.9;scale:.3}to{opacity:0;scale:1.25}}
    #promoCaption{position:fixed;left:24px;bottom:22px;z-index:99998;pointer-events:none;max-width:560px;padding:11px 16px;border-radius:10px;background:rgba(10,13,22,.92);border:1px solid rgba(143,176,255,.5);color:#f2f5fb;font:500 16px/1.35 "Golos Text",system-ui,sans-serif;box-shadow:0 10px 34px rgba(0,0,0,.5);opacity:0;translate:0 8px;transition:opacity .3s,translate .3s}
    #promoCaption.on{opacity:1;translate:0 0}
    #stage{transition:transform .55s cubic-bezier(.3,.1,.2,1)}
    #viewport{transition:background-position .55s cubic-bezier(.3,.1,.2,1),background-size .55s cubic-bezier(.3,.1,.2,1)}
    .session-usage{display:none}
    .promoScene{position:fixed;inset:0;z-index:99990;background:#0b0e16;display:flex;align-items:center;justify-content:center;transition:opacity .55s;color:#e9edf5}
    .promoScene.off{opacity:0;pointer-events:none}
    #promoTerm{width:760px;border-radius:12px;border:1px solid #2a3144;background:#11151f;box-shadow:0 30px 80px rgba(0,0,0,.6);overflow:hidden}
    #promoTerm .bar{display:flex;gap:7px;align-items:center;padding:11px 14px;border-bottom:1px solid #222838;background:none}
    #promoTerm .bar i{width:11px;height:11px;border-radius:50%;background:#333b50}
    #promoTerm .bar span{margin-left:10px;font:12px "JetBrains Mono",monospace;color:#7c869c}
    #promoTerm pre{margin:0;padding:22px 24px 26px;min-height:236px;font:15px/1.75 "JetBrains Mono",monospace;white-space:pre-wrap}
    #promoTerm .p{color:#8fb0ff}#promoTerm .d{color:#7c869c}#promoTerm .ok{color:#5fd39a}
    #promoTerm .caret{display:inline-block;width:8px;height:17px;background:#e9edf5;vertical-align:-3px;animation:promoBlink 1s steps(1) infinite}
    @keyframes promoBlink{50%{opacity:0}}
    #promoOutro{flex-direction:column;gap:18px;text-align:center}
    #promoOutro h1{font:700 44px/1.1 "Unbounded",system-ui,sans-serif;letter-spacing:-.02em;margin:0}
    #promoOutro p{font:400 20px/1.4 "Golos Text",system-ui,sans-serif;color:#aab3c7;margin:0}
    #promoOutro code{margin-top:14px;padding:12px 20px;border-radius:9px;border:1px solid #2a3144;background:#11151f;font:16px "JetBrains Mono",monospace}
    #promoOutro code span{color:#8fb0ff}
  \`;document.head.appendChild(css);
  const add=(html)=>{const t=document.createElement("template");t.innerHTML=html;const e=t.content.firstElementChild;document.body.appendChild(e);return e};
  const cursor=add('<svg id="promoCursor" viewBox="0 0 22 22"><path d="M3 2l15 8.5-6.6 1.7L8.2 19z" fill="#fff" stroke="#10131c" stroke-width="1.4" stroke-linejoin="round"/></svg>');
  const ring=add('<div id="promoRing"></div>'),cap=add('<div id="promoCaption"></div>');
  const intro=add('<div class="promoScene" id="promoIntro"><div id="promoTerm"><div class="bar"><i></i><i></i><i></i><span>agent session · ~/tablekeep</span></div><pre></pre></div></div>');
  const outro=add('<div class="promoScene off" id="promoOutro"><h1>VisualGrilling</h1><p>Find the weak spots in your project before reality does.</p><code><span>&gt;</span> grill my project</code></div>');
  const place=e=>{cursor.style.translate=e.clientX+"px "+e.clientY+"px";ring.style.translate=e.clientX+"px "+e.clientY+"px"};
  document.addEventListener("mousemove",place,true);
  document.addEventListener("mousedown",e=>{place(e);cursor.classList.add("down");ring.classList.remove("go");void ring.offsetWidth;ring.classList.add("go")},true);
  document.addEventListener("mouseup",()=>cursor.classList.remove("down"),true);
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),pre=intro.querySelector("pre");
  const box=list=>{const l=Math.min(...list.map(e=>e.offsetLeft)),t=Math.min(...list.map(e=>e.offsetTop));return{l,t,w:Math.max(...list.map(e=>e.offsetLeft+e.offsetWidth))-l,h:Math.max(...list.map(e=>e.offsetTop+e.offsetHeight))-t}};
  window.promo={
    caption(text){cap.classList.remove("on");setTimeout(()=>{cap.textContent=text;cap.classList.add("on")},cap.textContent?260:0)},
    frame(id){
      stopGlide();
      const node=i=>document.querySelector('#stage .node[data-id="'+i+'"]'),all=box([...document.querySelectorAll("#stage .node")]);
      const focus=id?box([id,...kids(id).map(k=>k.id)].map(node).filter(Boolean)):all,vw=viewWidth(),vh=vp.clientHeight;
      zoom=Math.min(1,(vw-48)/all.w,(vh-48)/focus.h);
      px=(vw-all.w*zoom)/2-all.l*zoom;py=vh/2-(focus.t+focus.h/2)*zoom;
      // Never scroll past the map's own top or bottom edge.
      if(all.h*zoom<=vh-48)py=(vh-all.h*zoom)/2-all.t*zoom;
      else py=Math.max(vh-24-(all.t+all.h)*zoom,Math.min(24-all.t*zoom,py));
      applyView();
    },
    async intro(){
      cursor.style.opacity=0;
      pre.innerHTML='<span class="p">&gt; </span><span class="t"></span><span class="caret"></span>';
      const t=pre.querySelector(".t");await wait(700);
      for(const ch of "grill my project"){t.textContent+=ch;await wait(62)}
      await wait(520);pre.querySelector(".caret").remove();
      for(const [cls,line,ms] of [["d","\\n\\n● Reading README.md, src/, docs/ …",850],["d","\\n● Preparing five critical questions …",850],["ok","\\n● Map is open at http://127.0.0.1:4777",1000]]){const s=document.createElement("span");s.className=cls;s.textContent=line;pre.append(s);await wait(ms)}
      intro.classList.add("off");await wait(600);cursor.style.opacity=1;
    },
    async outro(){cap.classList.remove("on");cursor.style.opacity=0;outro.classList.remove("off");await wait(600)},
  };
})()`;

async function storyboard(ids, started) {
  await js("promo.intro()");
  await caption("The agent studies your project and maps five critical questions");
  await moveTo(430, 300, 800); await sleep(1300);

  // Weak answer: pick a ready-made option.
  await openCard(ids.problem);
  await caption("Answer right on the map: pick an option or write your own");
  await sleep(900);
  await click('[data-chip="Owners told us it hurts"]', 600); await sleep(450);
  await click('[data-act="answer"]', 500);
  await sleep(900);
  await caption("The agent grades the answer and digs into the weak spot");
  await graded(ids.problem, "weak"); await sleep(2500);

  // Closed answer: typed, with numbers.
  await openCard(ids.money);
  await click("#fAns", 600); await type(TYPED);
  await sleep(350); await click('[data-act="answer"]', 450);
  await sleep(700);
  await caption("Concrete numbers close a branch");
  await graded(ids.money, "ok"); await sleep(1800);

  // Gap: an honest "I don't know".
  await openCard(ids.tech);
  await click(".chip.idk", 600); await sleep(350);
  await click('[data-act="answer"]', 450);
  await sleep(700);
  await caption("\u201CI don\u2019t know\u201D is an honest gap, and it opens a follow-up");
  await graded(ids.tech, "gap"); await sleep(2200);

  // Challenge the verdict in discussion; the grade changes without a new submission.
  await openCard(ids.problem);
  await click('[data-tab="discuss"]', 600);
  await caption("Disagree with a verdict? Argue it out with the agent");
  await click("#fMsg", 500); await type(CHALLENGE);
  await sleep(350); await click('[data-act="discuss"]', 450);
  await graded(ids.problem, "verify");
  await js('document.querySelector("#panel .chat .msg.claude")?.scrollIntoView({block:"center",behavior:"smooth"})');
  await sleep(3600);

  // Finish: verdict, risks and checks.
  await frame(null);
  await click("#bStop", 800);
  await caption("Stop any time for a verdict, key risks and checks for the week");
  await until(() => js("!!S.summary"), "summary");
  if (!await js('panel?.mode==="summary"')) await js('openPanel({mode:"summary"})');
  await until(() => point("#panel .final"), "summary panel");
  await frame(null);
  await js('document.querySelector("#panel .final").scrollIntoView({block:"start",behavior:"smooth"})');
  await moveTo(1010, 420, 700); await sleep(4200);
  await js("promo.outro()"); await sleep(2600);
  console.log(`Storyboard: ${((Date.now() - started) / 1000).toFixed(1)} s, ${frames.length} frames`);
}

function encode() {
  // Screencast frames arrive only when the page changes, so each one carries its own duration;
  // the last one lasts until recording stopped, which keeps a static closing hold. The concat
  // demuxer needs the final file listed twice and then shows it for twice its duration, hence the half.
  const list = frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(.001, frames[i + 1] ? frames[i + 1].at - f.at : Math.max(recordedUntil - f.at, .5) / 2).toFixed(4)}`).join("\n") + `\nfile '${frames.at(-1).file}'\n`;
  fs.writeFileSync(path.join(work, "frames.txt"), list);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const run = args => { const r = spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "frames.txt", ...args], { cwd: work, stdio: "inherit" }); if (r.status !== 0) throw new Error("ffmpeg failed"); };
  if (argv.includes("--mp4")) run(["-vf", "fps=30,scale=1920:1080:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUT + ".mp4"]);
  run(["-vf", "fps=12,scale=1280:720:flags=lanczos", "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", "72", "-compression_level", "6", "-loop", "0", OUT + ".webp"]);
  for (const ext of [".webp", ".mp4"]) if (fs.existsSync(OUT + ext)) console.log(`${OUT + ext}: ${(fs.statSync(OUT + ext).size / 1048576).toFixed(2)} MB`);
}

try {
  // A kept work directory may hold other files: replace only this script's own frames.
  fs.mkdirSync(work, { recursive: true });
  for (const f of fs.readdirSync(work)) if (/^f\d{6}\.jpg$/.test(f) || f === "frames.txt") fs.rmSync(path.join(work, f));
  server = spawn(process.execPath, [cli, "serve", "--dir", dir, "--name", "tablekeep", "--port", "0", "--lang", "en"], { cwd, stdio: "ignore", windowsHide: true, env: { ...process.env, GRILL_DOUBLE_CLICK_MS: "250" } });
  await until(() => { try { url = JSON.parse(fs.readFileSync(path.join(dir, "tablekeep", "server.json"))).url; return true; } catch { return false; } }, "server");
  await api("init", INIT);
  const nodes = (await api("state")).nodes, ids = Object.fromEntries(Object.entries(Q).map(([key, q]) => [key, nodes.find(n => n.q === q).id]));
  const listening = agent(); listening.catch(error => { failure = new Error("Agent failed: " + error.message); });

  browser = spawn(executable, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", `--window-size=${WIDTH},${HEIGHT}`, "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore", windowsHide: true });
  const port = await until(() => { try { return Number(fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]); } catch { return false; } }, "browser");
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(pages.find(p => p.type === "page").webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r, { once: true }));
  // A crashed browser must fail the run instead of leaving a CDP call pending forever.
  ws.addEventListener("close", () => { if (!stopped) failure ||= new Error("Browser connection lost"); for (const p of pending.values()) p.reject(failure || new Error("Browser connection is closed")); pending.clear(); });
  ws.addEventListener("message", e => {
    const m = JSON.parse(e.data), p = pending.get(m.id);
    if (p) { pending.delete(m.id); if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result); }
    else if (m.method === "Page.screencastFrame") {
      const file = `f${String(frames.length).padStart(6, "0")}.jpg`;
      fs.writeFileSync(path.join(work, file), Buffer.from(m.params.data, "base64"));
      frames.push({ file, at: m.params.metadata.timestamp });
      cdp("Page.screencastFrameAck", { sessionId: m.params.sessionId }).catch(() => {});
    }
  });
  await cdp("Page.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: false });
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await cdp("Page.navigate", { url });
  await until(() => js("typeof loaded!=='undefined'&&loaded&&listening"), "map");
  await js("document.fonts.ready.then(()=>true)");
  await js(OVERLAY);
  await js("document.fonts.load('15px \"JetBrains Mono\"').then(()=>true)");
  await frame(null); await sleep(700);

  await cdp("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
  await storyboard(ids, Date.now());
  // Frame timestamps are epoch seconds, like this clock.
  recordedUntil = Date.now() / 1000;
  await cdp("Page.stopScreencast"); await sleep(200);
  assert.ok(frames.length > 100, "Too few frames captured");
  if (ENCODE) encode();
} finally {
  // Close Chromium normally so its profile-owning subprocesses exit on Windows.
  if (ws?.readyState === WebSocket.OPEN) {
    stopped = true;
    await Promise.race([cdp("Browser.close").catch(() => {}), sleep(2000)]);
    if (browser?.exitCode === null) await Promise.race([new Promise(resolve => browser.once("exit", resolve)), sleep(2000)]);
  }
  stopped = true; ws?.close(); await end(browser); await end(server);
  if (KEEP) console.log("Frames kept in " + work);
  try { fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
  catch (error) {
    if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(error.code)) throw error;
    console.warn(`Temporary directory cleanup deferred (${error.code}); retained ${cwd}`);
  }
}
