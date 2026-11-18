import assert from "node:assert/strict";
import { ProxyWebSocket } from "../skills/grill/hub/websocket.mjs";
import { frame, upgrade } from "./fixtures/codex-wire.mjs";

function fixture(open = true, timeoutMs = 1000) {
  const writes = [], messages = [], errors = [];
  const socket = new ProxyWebSocket({ write: bytes => writes.push(bytes), onText: text => messages.push(text), onError: error => errors.push(error), timeoutMs });
  socket.start();
  const handshake = upgrade(writes[0].toString());
  if (open) socket.feed(handshake);
  return { socket, writes, messages, errors, handshake };
}
function unmask(bytes) {
  assert.ok(bytes[1] & 128);
  const header = (bytes[1] & 127) === 127 ? 10 : (bytes[1] & 127) === 126 ? 4 : 2;
  const mask = bytes.subarray(header, header + 4), payload = Buffer.from(bytes.subarray(header + 4));
  for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  return payload;
}
{
  const f = fixture(false);
  const all = Buffer.concat([f.handshake, frame("first"), frame("second")]);
  for (const byte of all) f.socket.feed(Buffer.from([byte]));
  await f.socket.ready;
  assert.deepEqual(f.messages, ["first", "second"]);
  for (const size of [0, 125, 126, 65535, 65536]) {
    const text = "x".repeat(size); f.socket.send(text);
    assert.equal(unmask(f.writes.at(-1)).toString(), text);
    f.socket.feed(frame(text)); assert.equal(f.messages.at(-1), text);
  }
  const unicode = Buffer.from("🙂");
  f.socket.feed(frame(unicode.subarray(0, 2), 1, false));
  f.socket.feed(frame("ping", 9));
  assert.equal(f.writes.at(-1)[0], 138); assert.equal(unmask(f.writes.at(-1)).toString(), "ping");
  f.socket.feed(frame(unicode.subarray(2), 0)); assert.equal(f.messages.at(-1), "🙂");
  f.socket.feed(frame("", 10)); assert.equal(f.errors.length, 0);
  f.socket.feed(frame(Buffer.from([3, 232]), 8)); assert.equal(f.errors.length, 1);
  assert.equal(f.writes.at(-1)[0], 136); f.socket.dispose();
}
for (const bytes of [
  Buffer.from([0xc1, 0]), Buffer.from([0x81, 0x80]), frame("binary", 2), frame("orphan", 0),
  frame("bad", 9, false), frame("x".repeat(126), 9), frame(Buffer.from([0xff])),
  frame(Buffer.from([0]), 8), frame(Buffer.from([3, 237]), 8), frame(Buffer.from([3, 232, 0xff]), 8),
  Buffer.from([0x81, 126, 0, 5]), Buffer.from([0x81, 127, 0, 0, 0, 0, 0, 0, 0, 5]),
  Buffer.from([0x81, 127, 0, 0, 0, 0, 0, 64, 0, 1]),
  Buffer.concat([frame("part", 1, false), frame("new")]),
  Buffer.concat([frame("x".repeat(3 * 1024 * 1024), 1, false), frame("x".repeat(2 * 1024 * 1024), 0)])
]) {
  const f = fixture(); f.socket.feed(bytes); assert.equal(f.errors.length, 1); assert.equal(f.socket.closed, true); f.socket.dispose();
}
for (const mutate of [
  h => h.replace("101", "200"), h => h.replace("websocket", "http"), h => h.replace("Connection: Upgrade", "Connection: close"),
  h => h.replace(/Sec-WebSocket-Accept: .+\r\n/, "Sec-WebSocket-Accept: invalid\r\n"),
  h => h.replace("\r\n\r\n", "\r\nSec-WebSocket-Extensions: permessage-deflate\r\n\r\n"),
  h => h.replace("\r\n\r\n", "\r\nUpgrade: websocket\r\n\r\n"),
  () => "x".repeat(16385)
]) {
  const f = fixture(false); f.socket.feed(Buffer.from(mutate(f.handshake.toString())));
  await assert.rejects(f.socket.ready); assert.equal(f.errors.length, 1); f.socket.dispose();
}
{
  const f = fixture(false, 10); await assert.rejects(f.socket.ready, /timed out/); assert.equal(f.errors.length, 1);
}
console.log("Codex proxy WebSocket checks passed (bounded upgrade, framing, UTF-8, controls and failures).");
