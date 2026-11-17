export async function request(method, params = {}) {
  const reply = await chrome.runtime.sendMessage({ method, params });
  if (!reply?.ok) throw Object.assign(new Error(reply?.error?.message || "Локальный компонент недоступен."), { code: reply?.error?.code });
  return reply.result;
}
export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function button(label, action, className = "") {
  const node = element("button", label, className); node.type = "button";
  node.addEventListener("click", action); return node;
}
export function time(value) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "medium" }) : "ещё не проверено";
}
export const agentLabels = { attached: "подключён", connected: "подключён", idle: "сессия ожидает", working: "сессия работает", starting: "запускается", stopped: "остановлен", disconnected: "не подключён", waiting_login: "нужен вход", waiting_permission: "ждёт разрешения", waiting_input: "ждёт ответа", recently_seen: "недавно отвечал", monitor_armed: "монитор настроен", error: "ошибка", unknown: "неизвестно" };
export function safeWebUrl(value, local = false) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (local) return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname) ? url.href : null;
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
