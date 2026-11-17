import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { dispatch } from "../hub/native.mjs";

const base = new URL("../hub/extension/", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL("manifest.json", base), "utf8").replace(/^\uFEFF/, ""));
const key = JSON.parse(fs.readFileSync(new URL("../hub/extension-key.json", import.meta.url)));
assert.equal(manifest.key, key.key);
assert.deepEqual(manifest.permissions.sort(), ["nativeMessaging", "storage"]);
assert.ok(!manifest.host_permissions && !manifest.externally_connectable && !manifest.content_scripts);
assert.equal(manifest.manifest_version, 3);
const extensionId = key.extensionId;
const origin = `chrome-extension://${extensionId}/`;
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "grill-extension-native-"));
const configPath = path.join(fixtureDir, "installation.json");
const config = { installationId: crypto.randomUUID(), epoch: crypto.randomUUID(), secret: "a".repeat(64), extensionId, nodePath: process.execPath, servicePath: path.join(fixtureDir, "service.mjs"), dataDir: fixtureDir };
fs.writeFileSync(configPath, JSON.stringify(config));
const events = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, fire(...args) { for (const fn of this.listeners) fn(...args); } });
const calls = [], onMessage = events(), onClicked = events();
let port;
let behavior = "success";
let bindings = 0;
let disconnects = 0;
const chrome = {
  runtime: { id: extensionId, getURL: page => origin + page, onMessage, connectNative(host) {
    assert.equal(host, "com.visualgrilling.hub");
    port = { onMessage: events(), onDisconnect: events(), postMessage(message) {
      calls.push(message);
      queueMicrotask(async () => {
        if (message.method === "bind") bindings++;
        if (behavior === "rotate") { behavior = "success"; config.epoch = crypto.randomUUID(); config.secret = "b".repeat(64); fs.writeFileSync(configPath, JSON.stringify(config)); }
        if (behavior === "disconnect") { disconnects++; port.onDisconnect.fire(); return; }
        port.onMessage.fire(await dispatch(message, configPath, origin, async (_config, command) => ({ method: command.method })));
      });
    } }; return port;
  } }, action: { onClicked }, tabs: { create: async () => {} }
};
vm.runInNewContext(fs.readFileSync(new URL("background.js", base), "utf8"), { chrome, crypto, URL, setTimeout, clearTimeout, console });
const send = (method, sender = { id: extensionId, url: origin + "index.html" }) => new Promise(resolve => onMessage.fire({ method, params: method === "list" ? {} : { boardId: "11111111-1111-4111-8111-111111111111" } }, sender, resolve));
assert.equal((await send("list")).ok, true); assert.equal(bindings, 1);
assert.equal(calls[1].secret, "a".repeat(64));
for (const sender of [{ id: "other", url: origin + "index.html" }, { id: extensionId, url: "https://evil.test/index.html" }, { id: extensionId, url: origin + "wrong.html" }, { id: extensionId, url: "broken url" }]) assert.equal((await send("play", sender)).error.code, "FORBIDDEN");
assert.equal((await send("unknown")).error.code, "FORBIDDEN");
behavior = "rotate";
assert.equal((await send("play")).ok, true); assert.equal(bindings, 2);
assert.deepEqual(calls.slice(-3).map(call => call.method), ["play", "bind", "play"]);
assert.equal(calls.at(-1).secret, "b".repeat(64));
behavior = "disconnect";
const before = calls.length;
assert.equal((await send("stop")).error.code, "DISCONNECTED");
assert.equal(calls.length, before + 1, "Ambiguous commands are not replayed"); assert.equal(disconnects, 1);
behavior = "success";
assert.equal((await send("chat", { id: extensionId, url: origin + "chat.html?boardId=fixture" })).ok, true);
assert.equal(bindings, 2);
for (const file of ["index.js", "chat.js", "common.js"]) assert.ok(!/innerHTML|insertAdjacentHTML|eval\(/.test(fs.readFileSync(new URL(file, base), "utf8")), file);
fs.unlinkSync(configPath); fs.rmdirSync(fixtureDir);
console.log("Hub extension PASS: manifest scope, exact sender/page rejection, real native dispatch/config binding rotation, credential isolation, no ambiguous replay. Browser cache/navigation/chat checks run separately.");
