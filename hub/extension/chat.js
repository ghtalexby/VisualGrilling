import { request, element, button, time, agentLabels, safeWebUrl } from "./common.js";
const $ = id => document.getElementById(id);
const boardId = new URL(location.href).searchParams.get("boardId");
let loading = false;
let sending = false;
let available = false;
let nextCursor = null;
let session = null;
let turns = [];
let requestSignature = "";
const validBoard = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(boardId || "");
function error(error) { $("error").textContent = error.message; $("error").hidden = false; }
function setSending(value) { sending = value; $("send").disabled = value || !available || session?.status !== "idle"; for (const node of $("requests").querySelectorAll("button")) node.disabled = value || !available; }
async function action(method, params = {}) {
  if (sending || !available) return;
  setSending(true);
  try { const result = await request(method, { boardId, ...params }); $("error").hidden = true; await refresh(); return result; }
  catch (failure) { error(failure); throw failure; }
  finally { setSending(false); }
}
function renderLogin(login) {
  $("login").replaceChildren();
  if (session?.status !== "waiting_login") return;
  const block = element("section", undefined, "pending-request"); block.append(element("h2", "Войдите в Codex"), element("p", "Сессия ожидает входа. Получение событий доски ещё не подтверждено."));
  const url = safeWebUrl(login?.authUrl || login?.verificationUrl || login?.verificationUri);
  if (url) { const link = element("a", "Открыть страницу входа", "action-link"); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; block.append(link); }
  if (login?.userCode) block.append(element("p", "Код: " + login.userCode));
  block.append(button("Начать / проверить вход", async () => {
    try { renderLogin(await action("login")); } catch {}
  })); $("login").append(block);
}
function renderRequests(requests) {
  const signature = JSON.stringify(requests);
  if (signature === requestSignature) return;
  requestSignature = signature; $("requests").replaceChildren();
  for (const pending of requests) {
    const block = element("section", undefined, "pending-request");
    block.append(element("h2", pending.method === "item/tool/requestUserInput" ? "Агенту нужен ваш ответ" : "Агент ожидает разрешения"));
    const params = pending.params || {};
    if (params.reason) block.append(element("p", params.reason));
    if (params.command) block.append(element("pre", params.command, "request-detail"));
    if (params.cwd) block.append(element("p", "Папка: " + params.cwd, "path"));
    if (params.changes) block.append(element("pre", JSON.stringify(params.changes, null, 2), "request-detail"));
    const details = element("details"); details.append(element("summary", "Все сведения запроса"), element("pre", JSON.stringify(params, null, 2), "request-detail")); block.append(details);
    const respond = async response => { try { await action("approval", { requestId: pending.id, response }); } catch {} };
    if (["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(pending.method)) {
      const controls = element("div", undefined, "chat-toolbar"); controls.append(button("Разрешить один раз", () => respond({ decision: "accept" })), button("Отклонить", () => respond({ decision: "decline" }))); block.append(controls);
    } else if (pending.method === "item/permissions/requestApproval" && params.permissions && typeof params.permissions === "object") {
      const permissions = Object.fromEntries(["network", "fileSystem"].filter(key => params.permissions[key] != null).map(key => [key, params.permissions[key]]));
      block.append(element("p", "Запрошенные права на время текущего хода:"), element("pre", JSON.stringify(permissions, null, 2), "request-detail"));
      const controls = element("div", undefined, "chat-toolbar");
      controls.append(button("Разрешить на этот ход", () => respond({ permissions, scope: "turn" })), button("Отклонить", () => respond({ permissions: {}, scope: "turn" }))); block.append(controls);
    } else if (pending.method === "item/tool/requestUserInput" && Array.isArray(pending.params?.questions)) {
      const form = element("form"), inputs = [];
      for (const question of pending.params.questions) {
        const label = element("label"); label.append(element("span", question.question || question.header));
        if (question.options?.length) label.append(element("p", question.options.map(option => option.label + (option.description ? ": " + option.description : "")).join("\n"), "request-detail"));
        const input = element("input"); input.type = question.isSecret ? "password" : "text"; input.required = true; input.autocomplete = "off"; label.append(input); form.append(label); inputs.push([question.id, input]);
      }
      const submit = element("button", "Отправить ответы", "primary"); submit.type = "submit"; form.append(submit); form.addEventListener("submit", event => { event.preventDefault(); respond({ answers: Object.fromEntries(inputs.map(([id, input]) => [id, { answers: [input.value] }])) }); }); block.append(form);
    } else block.append(element("p", "Этот тип запроса пока не поддерживается в расширении. Разрешение автоматически не выдаётся. Для фоновой сессии вернитесь к доскам, нажмите Stop и продолжите работу в совместимом клиенте Codex."));
    $("requests").append(block);
  }
}
function renderHistory() {
  $("messages").replaceChildren();
  for (const turn of [...turns].reverse()) for (const item of turn.items || []) {
    const text = item.text || (item.content || []).filter(part => part.type === "text" || part.type === "inputText").map(part => part.text).join("\n") || item.aggregatedOutput;
    if (!text) continue;
    const message = element("article", undefined, "message");
    message.append(element("h3", item.type === "userMessage" ? "Вы" : item.type === "agentMessage" ? "Codex" : item.type), element("pre", text)); $("messages").append(message);
  }
  if (!$("messages").childElementCount) $("messages").append(element("p", "В этой сессии пока нет доступных сообщений.", "muted"));
}
async function refresh(older = false) {
  if (loading || !validBoard) return;
  loading = true; $("refresh").disabled = true; $("older").disabled = true;
  try {
    const result = await request("chat", { boardId, ...(older && nextCursor ? { cursor: nextCursor } : {}) });
    if (!Array.isArray(result?.data) || !result.state) throw new Error("Неверный ответ истории Codex.");
    session = result.state; available = true;
    if (older) {
      const known = new Map(turns.map(turn => [turn.id, turn])); for (const turn of result.data) known.set(turn.id, turn); turns = [...known.values()];
    } else {
      const recent = new Set(result.data.map(turn => turn.id)); turns = [...result.data, ...turns.filter(turn => !recent.has(turn.id))];
    }
    if (older || !turns.length || nextCursor === null) nextCursor = result.nextCursor;
    $("older").hidden = !nextCursor;
    $("session").textContent = `${agentLabels[session.status] || session.status || "Состояние неизвестно"}${session.threadId ? " · " + session.threadId : ""}`;
    $("freshness").textContent = "История проверена: " + time(Date.now()); $("freshness").classList.remove("stale");
    $("error").hidden = true; renderHistory(); renderRequests(session.requests || []); renderLogin(session.login); setSending(sending);
  } catch (failure) { available = false; error(failure); $("freshness").textContent = "Данные устарели. Не удалось проверить сессию; повторите обновление."; $("freshness").classList.add("stale"); setSending(sending); }
  finally { loading = false; $("refresh").disabled = false; $("older").disabled = false; }
}
$("composer").addEventListener("submit", async event => {
  event.preventDefault(); if (sending || session?.status !== "idle") return;
  const text = $("message").value;
  try { await action("sendChat", { text }); if ($("message").value === text) $("message").value = ""; } catch {}
});
$("refresh").addEventListener("click", () => refresh()); $("older").addEventListener("click", () => refresh(true));
if (!validBoard) error(new Error("Не указан корректный ID доски. Вернитесь к списку досок и откройте чат оттуда."));
else { await refresh(); setInterval(() => { if (!document.hidden && !sending) refresh(); }, 5000); }
