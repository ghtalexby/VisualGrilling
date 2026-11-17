const HOST = "com.visualgrilling.hub";
const METHODS = new Set(["list", "open", "play", "stop", "rebind", "chat", "sendChat", "login", "approval"]);
let binding = null;
let bindingPromise = null;
let port = null;
const pending = new Map();

function failure(code, message) { return Object.assign(new Error(message), { code }); }
function connect() {
  if (port) return port;
  const current = chrome.runtime.connectNative(HOST);
  port = current;
  current.onMessage.addListener(message => {
    const request = pending.get(message?.id);
    if (!request || message.v !== 1) return;
    clearTimeout(request.timer); pending.delete(message.id);
    if (message.ok === true) request.resolve(message.result);
    else request.reject(failure(message.error?.code || "NATIVE_ERROR", message.error?.message || "Локальный компонент отклонил запрос."));
  });
  current.onDisconnect.addListener(() => {
    const diagnostic = chrome.runtime.lastError?.message;
    if (port === current) port = null;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(failure("DISCONNECTED", "Связь с локальным компонентом прервалась. Результат команды неизвестен; обновите список перед повтором." + (diagnostic ? " " + diagnostic : "")));
    }
    pending.clear();
  });
  return current;
}
function native(method, params = {}, credentials = {}) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(failure("TIMEOUT", "Компонент не ответил вовремя. Результат команды неизвестен; обновите список перед повтором."));
    }, 120000);
    pending.set(id, { resolve, reject, timer });
    try { connect().postMessage({ v: 1, id, method, params, ...credentials }); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
}
async function bind() {
  if (!bindingPromise) bindingPromise = native("bind").then(value => {
    if (!value || typeof value.secret !== "string" || typeof value.installationId !== "string" || typeof value.epoch !== "string" || !value.epoch) throw failure("INVALID_BINDING", "Неверная привязка установки. Повторите установку компонента.");
    // Credentials are worker-memory only: no local/sync storage or page exposure.
    binding = { secret: value.secret, installationId: value.installationId, epoch: value.epoch };
    return binding;
  }).finally(() => { bindingPromise = null; });
  return bindingPromise;
}
async function command(method, params) {
  if (!binding) await bind();
  try { return await native(method, params, binding); }
  catch (error) {
    // Only explicit admission rejection proves that this command did not execute.
    if (error.code !== "REBIND_REQUIRED") throw error;
    binding = null; await bind();
    return native(method, params, binding);
  }
}
function validSender(sender) {
  if (sender.id !== chrome.runtime.id || !sender.url) return false;
  let url;
  try { url = new URL(sender.url); } catch { return false; }
  return ["index.html", "chat.html"].some(page => url.protocol + "//" + url.host + url.pathname === chrome.runtime.getURL(page));
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!validSender(sender) || !METHODS.has(message?.method) || !message.params || typeof message.params !== "object" || Array.isArray(message.params)) {
    respond({ ok: false, error: { code: "FORBIDDEN", message: "Недопустимый источник или команда." } }); return false;
  }
  command(message.method, message.params).then(result => respond({ ok: true, result }), error => respond({ ok: false, error: { code: error.code || "UNAVAILABLE", message: error.message } }));
  return true;
});
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL("index.html") }));
