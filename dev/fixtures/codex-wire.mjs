// Independent miniature server fixture: proxy uses real HTTP upgrade/masked frames.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import readline from "node:readline";

export function frame(payload, opcode = 1, fin = true) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const header = Buffer.alloc(body.length < 126 ? 2 : body.length <= 65535 ? 4 : 10);
  header[0] = (fin ? 128 : 0) | opcode;
  header[1] = body.length < 126 ? body.length : body.length <= 65535 ? 126 : 127;
  if (header.length === 4) header.writeUInt16BE(body.length, 2);
  if (header.length === 10) header.writeBigUInt64BE(BigInt(body.length), 2);
  return Buffer.concat([header, body]);
}
export function upgrade(request) {
  const key = /Sec-WebSocket-Key: (.+)\r\n/i.exec(request)[1];
  const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  return Buffer.from(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
}
export function fakeCodexWire(onMessage) {
  const proxy = process.argv.includes("proxy");
  const send = value => process.stdout.write(proxy ? frame(JSON.stringify(value)) : JSON.stringify(value) + "\n");
  if (!proxy) readline.createInterface({ input: process.stdin }).on("line", line => onMessage(JSON.parse(line), send));
  else {
    let buffer = Buffer.alloc(0), open = false;
    process.stdin.on("data", chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!open) {
        const end = buffer.indexOf("\r\n\r\n"); if (end < 0) return;
        assert.match(buffer.toString(), /^GET \/rpc HTTP\/1.1\r\n/);
        process.stdout.write(upgrade(buffer.subarray(0, end + 4).toString()));
        buffer = buffer.subarray(end + 4); open = true;
      }
      while (buffer.length >= 2) {
        assert.equal(buffer[0], 129); assert.ok(buffer[1] & 128);
        let length = buffer[1] & 127, header = 2;
        if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); header = 4; }
        if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); header = 10; }
        if (buffer.length < header + 4 + length) return;
        const mask = buffer.subarray(header, header + 4), payload = Buffer.from(buffer.subarray(header + 4, header + 4 + length));
        for (let i = 0; i < length; i++) payload[i] ^= mask[i % 4];
        buffer = buffer.subarray(header + 4 + length);
        onMessage(JSON.parse(payload.toString()), send);
      }
    });
  }
}
