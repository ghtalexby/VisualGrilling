import { request, element, button, time, agentLabels, safeWebUrl } from "./common.js";

const $ = id => document.getElementById(id);
let snapshot = null;
let stale = true;
let refreshing = false;
const busy = new Set();
const feedback = new Map();
const drafts = new Map();
const expanded = new Set();
const STALE_AFTER = 30000;

export function selectBoards(boards, query, activeOnly) {
  const needle = query.trim().toLocaleLowerCase("ru-RU");
  return boards.filter(board => (!activeOnly || board.finished !== true) && [board.title, board.name, board.project, board.dir].some(value => String(value || "").toLocaleLowerCase("ru-RU").includes(needle)));
}
function reportError(error) { $("error").hidden = false; $("error").textContent = error.message; }
function markFreshness() {
  const expired = stale || !snapshot?.checkedAt || Date.now() - snapshot.checkedAt > STALE_AFTER;
  $("freshness").classList.toggle("stale", expired);
  $("freshness").textContent = snapshot ? `${expired ? "Данные устарели. Последний список" : "Список проверен"}: ${time(snapshot.checkedAt)}${refreshing ? " · Обновляем…" : ""}` : refreshing ? "Подключаем локальный компонент…" : "Список ещё не получен. Повторите подключение кнопкой «Обновить».";
  for (const node of document.querySelectorAll(".checked")) {
    const old = stale || node.dataset.stale === "true" || !Number(node.dataset.checked) || Date.now() - Number(node.dataset.checked) > STALE_AFTER;
    node.classList.toggle("warn", old);
    node.textContent = `${old ? "Устарело · " : ""}Проверка: ${time(Number(node.dataset.checked))}`;
  }
}
async function refresh() {
  if (refreshing) return;
  refreshing = true; $("refresh").disabled = true; markFreshness();
  try {
    const result = await request("list");
    if (!result || !Array.isArray(result.boards) || !Number.isFinite(result.checkedAt)) throw new Error("Компонент вернул неверный список. Повторите установку компонента.");
    snapshot = result; stale = result.stale === true;
    $("error").hidden = true;
    // The cache contains observations only; credentials never reach extension pages.
    await chrome.storage.local.set({ boardsCache: result });
    render();
  } catch (error) {
    stale = true; reportError(error); $("help").open = true;
    if (!snapshot) render();
  } finally { refreshing = false; $("refresh").disabled = false; markFreshness(); }
}
async function act(board, method, params = {}) {
  if (busy.has(board.id)) return;
  busy.add(board.id); feedback.set(board.id, "Выполняем…"); render();
  try {
    const result = await request(method, { boardId: board.id, ...params });
    if (method === "open") {
      const url = safeWebUrl(result?.url, true);
      if (!url) throw new Error("Компонент не вернул безопасный адрес работающей доски.");
      await chrome.tabs.create({ url });
    }
    if (method === "rebind") { expanded.delete(board.id); drafts.delete(board.id); }
    feedback.set(board.id, method === "open" ? "Доска открыта в новой вкладке." : method === "stop" ? "Остановка выполнена. Обновляем состояние." : method === "rebind" ? "Папка привязана после проверки ID." : "Запуск обработан. Подключение агента проверяется отдельно.");
    await refresh();
  } catch (error) { feedback.set(board.id, error.message); }
  finally { busy.delete(board.id); render(); }
}
function renderBoard(board) {
  const row = element("article", undefined, "board"); row.dataset.boardId = board.id;
  const identity = element("div", undefined, "identity");
  identity.append(element("h3", board.title || board.name || "Доска без названия"), element("p", board.dir || "Путь недоступен", "path"));
  const counts = element("div", undefined, "counts");
  for (const [key, label, cls] of [["closed", "закрыто", "closed"], ["open", "открыто", ""]]) {
    const value = element("span", undefined, cls); value.append(element("strong", Number.isInteger(board.counts?.[key]) ? String(board.counts[key]) : "—"), document.createTextNode(" " + label)); counts.append(value);
  }
  identity.append(counts);
  const state = element("div", undefined, "state"), dl = element("dl");
  const attachment = board.connected === true ? "подключён" : board.connection === "disconnected" || !board.connection && board.server === "stopped" ? "не подключён" : "подключение не подтверждено";
  const provider = ({ codex: "Codex", claude: "Claude", "claude-code": "Claude Code" })[board.provider] || board.provider;
  const agent = [provider, attachment, agentLabels[board.agent] || board.agent || "неизвестно"].filter((v, i, all) => v && all.indexOf(v) === i).join(" · ");
  const lines = [["Доска", board.finished === true ? "завершена" : board.finished === false ? "не завершена" : "состояние неизвестно"], ["Сервер", ({ running: "работает", stopped: "выключен", unknown: "неизвестно" })[board.server] || "неизвестно"], ["Агент", agent]];
  for (const [label, value] of lines) { const line = element("div", undefined, "status-line"); line.append(element("dt", label), element("dd", value)); dl.append(line); }
  state.append(dl);
  if (board.missing) state.append(element("p", "Папка не найдена · состояние доски сохранено ранее", "path warn"));
  const checked = element("p", "", "checked"); checked.dataset.checked = String(board.checkedAt || 0); checked.dataset.stale = String(board.stale === true); state.append(checked);
  const actions = element("div", undefined, "board-actions");
  const open = button("Открыть", () => act(board, "open"), board.server === "running" ? "primary" : ""); open.disabled = busy.has(board.id) || board.missing || board.server !== "running"; open.title = board.server !== "running" ? "Сначала запустите доску кнопкой Play" : "Открыть работающую доску";
  const play = button("Play", () => act(board, "play"), board.server !== "running" ? "primary" : ""); play.disabled = busy.has(board.id) || board.missing || board.unavailable; play.title = "Запустить сервер и продолжить грилинг в Codex";
  const stop = button("Stop", () => act(board, "stop")); stop.disabled = busy.has(board.id) || board.missing || board.unavailable; stop.title = "Остановить сервер и грилинг, сохранив доску";
  actions.append(open, play, stop);
  if (board.chatAvailable || ["waiting_permission", "waiting_input", "waiting_login"].includes(board.agent)) {
    const chat = element("a", "Чат Codex", "action-link"); chat.href = "chat.html?boardId=" + encodeURIComponent(board.id); actions.append(chat);
  }
  row.append(identity, state, actions);
  if (board.missing) {
    const recovery = element("details", undefined, "rebind"); recovery.open = expanded.has(board.id);
    recovery.addEventListener("toggle", () => recovery.open ? expanded.add(board.id) : expanded.delete(board.id));
    recovery.append(element("summary", "Указать новую папку"), element("p", "Выберите папку доски в Проводнике и скопируйте полный путь сюда. Папка должна содержать board.json с прежним ID. Chrome не передаёт полный путь из выбора файлов."));
    const label = element("label", "Полный путь к папке доски"); const input = element("input"); input.type = "text"; input.value = drafts.get(board.id) || ""; input.placeholder = "D:\\Проект\\.grill\\имя-карты"; input.required = true; input.addEventListener("input", () => drafts.set(board.id, input.value)); label.append(input);
    const form = element("form"); const submit = element("button", "Проверить ID и привязать"); submit.type = "submit"; submit.disabled = busy.has(board.id); form.append(label, submit); form.addEventListener("submit", event => { event.preventDefault(); act(board, "rebind", { dir: input.value.trim() }); }); recovery.append(form); row.append(recovery);
  }
  const note = feedback.get(board.id) || board.error;
  if (note) { const status = element("p", note, "row-feedback"); status.setAttribute("role", "status"); row.append(status); }
  return row;
}
function render() {
  const container = $("boards");
  const focus = document.activeElement;
  const focusBoard = focus?.closest(".board")?.dataset.boardId;
  const focusText = focus?.tagName === "BUTTON" ? focus.textContent : null;
  const focusInput = focus?.tagName === "INPUT" && focusBoard ? { start: focus.selectionStart, end: focus.selectionEnd } : null;
  container.replaceChildren();
  if (!snapshot) {
    const empty = element("section", undefined, "empty"); empty.append(element("h2", "Список пока недоступен"), element("p", "Не удалось проверить реестр досок. Подключите локальный компонент; существующие доски сохраняются на диске.")); container.append(empty); return;
  }
  const boards = selectBoards(snapshot.boards, $("search").value, $("active").checked);
  if (!boards.length) {
    const empty = element("section", undefined, "empty"); empty.append(element("h2", snapshot.boards.length ? "Нет подходящих досок" : stale ? "В сохранённом списке нет досок" : "В реестре пока нет досок"), element("p", snapshot.boards.length ? "Измените поиск или выключите фильтр активных досок." : "Запустите доску с новой версией VisualGrilling, затем обновите список.")); container.append(empty);
  }
  const groups = new Map();
  for (const board of boards) { const key = $("group").checked ? board.project || "Проект недоступен" : "Все доски"; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(board); }
  for (const [project, items] of groups) {
    const section = element("section", undefined, "project"); const heading = element("div", undefined, "project-heading");
    heading.append(element("h2", project.split(/[\\/]/).filter(Boolean).pop() || project)); if ($("group").checked) heading.append(element("p", project));
    section.append(heading, ...items.map(renderBoard)); container.append(section);
  }
  markFreshness();
  if (focusBoard && focusText) Array.from(container.querySelectorAll(".board")).find(row => row.dataset.boardId === focusBoard)?.querySelectorAll("button").forEach(node => { if (node.textContent === focusText && !node.disabled) node.focus(); });
  if (focusInput) {
    const input = Array.from(container.querySelectorAll(".board")).find(row => row.dataset.boardId === focusBoard)?.querySelector(".rebind input");
    if (input) { input.focus(); input.setSelectionRange(focusInput.start, focusInput.end); }
  }
}
$("filters").addEventListener("submit", event => event.preventDefault());
for (const id of ["search", "active", "group"]) $(id).addEventListener("input", render);
$("refresh").addEventListener("click", refresh);
try { const stored = await chrome.storage.local.get("boardsCache"); if (Array.isArray(stored.boardsCache?.boards)) { snapshot = stored.boardsCache; render(); } } catch {}
await refresh();
setInterval(markFreshness, 5000);
