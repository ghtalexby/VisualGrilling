// RFC 6455 client over the owned app-server proxy's raw byte pipes.
import { createHash, randomBytes } from "node:crypto";

const MAX = 4 * 1024 * 1024;
const HEADER_MAX = 16384;
const decoder = new TextDecoder("utf-8", { fatal: true });
export class ProxyWebSocket {
  constructor({ write, onText, onError, timeoutMs = 15000 }) {
    Object.assign(this, { write, onText, onError });
    this.buffer = Buffer.alloc(0); this.parts = []; this.size = 0; this.fragmented = false; this.closed = false; this.open = false;
    this.key = randomBytes(16).toString("base64");
    this.ready = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    // Failure can precede the first RPC request.
    this.ready.catch(() => {});
    this.timer = setTimeout(() => this.fail(new Error("Codex WebSocket handshake timed out")), timeoutMs);
  }
  start() {
    this.write(Buffer.from(`GET /rpc HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${this.key}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
  }
  dispose(error = new Error("Codex transport closed")) {
    this.closed = true; clearTimeout(this.timer); this.reject(error);
    this.buffer = Buffer.alloc(0); this.parts = []; this.size = 0;
  }
  fail(error) { if (!this.closed) { this.dispose(error); this.onError(error); } }
  send(text) {
    if (!this.open || this.closed) throw new Error("Codex WebSocket unavailable");
    const payload = Buffer.from(text);
    if (payload.length > MAX) throw new Error("Codex request too large");
    this.frame(1, payload);
  }
  frame(opcode, payload) {
    const length = payload.length, header = Buffer.alloc(length < 126 ? 2 : length <= 65535 ? 4 : 10);
    header[0] = 0x80 | opcode; header[1] = 0x80 | (length < 126 ? length : length <= 65535 ? 126 : 127);
    if (header.length === 4) header.writeUInt16BE(length, 2);
    if (header.length === 10) header.writeBigUInt64BE(BigInt(length), 2);
    const mask = randomBytes(4), body = Buffer.from(payload);
    for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
    this.write(Buffer.concat([header, mask, body]));
  }
  feed(chunk) {
    if (this.closed) return;
    try {
      // Bounded slices allow arbitrarily coalesced frames without an unbounded copy.
      for (let offset = 0; offset < chunk.length && !this.closed; offset += 16384) {
        this.buffer = Buffer.concat([this.buffer, chunk.subarray(offset, offset + 16384)]);
        this.parse();
      }
    } catch { this.fail(new Error("Invalid Codex WebSocket protocol")); }
  }
  parse() {
    if (!this.open) {
      const end = this.buffer.indexOf("\r\n\r\n");
      if (end < 0) { if (this.buffer.length > HEADER_MAX) throw new Error(); return; }
      if (end + 4 > HEADER_MAX) throw new Error();
      const lines = this.buffer.subarray(0, end).toString("latin1").split("\r\n"), headers = new Map();
      if (!/^HTTP\/1\.1 101(?: [\x20-\x7e]*)?$/.test(lines.shift())) throw new Error();
      for (const line of lines) {
        const match = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*([^\x00-\x08\x0a-\x1f\x7f]*)$/.exec(line);
        if (!match || headers.has(match[1].toLowerCase())) throw new Error();
        headers.set(match[1].toLowerCase(), match[2].trim());
      }
      const accept = createHash("sha1").update(this.key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
      if (headers.get("upgrade")?.toLowerCase() !== "websocket" || !headers.get("connection")?.toLowerCase().split(/\s*,\s*/).includes("upgrade") || headers.get("sec-websocket-accept") !== accept || headers.has("sec-websocket-extensions") || headers.has("sec-websocket-protocol")) throw new Error();
      this.buffer = this.buffer.subarray(end + 4); this.open = true; clearTimeout(this.timer); this.resolve();
    }
    while (!this.closed && this.buffer.length >= 2) {
      const first = this.buffer[0], second = this.buffer[1], fin = !!(first & 128), opcode = first & 15;
      if ((first & 112) || (second & 128) || ![0, 1, 8, 9, 10].includes(opcode)) throw new Error();
      let length = second & 127, header = 2;
      if (length === 126) { if (this.buffer.length < 4) return; length = this.buffer.readUInt16BE(2); header = 4; if (length < 126) throw new Error(); }
      else if (length === 127) { if (this.buffer.length < 10) return; const big = this.buffer.readBigUInt64BE(2); if (big <= 65535n || big > BigInt(MAX)) throw new Error(); length = Number(big); header = 10; }
      if (length > MAX || (opcode >= 8 && (!fin || length > 125))) throw new Error();
      if (opcode < 8 && ((opcode === 0) !== this.fragmented || this.size + length > MAX)) throw new Error();
      if (this.buffer.length < header + length) return;
      const payload = this.buffer.subarray(header, header + length); this.buffer = this.buffer.subarray(header + length);
      if (opcode === 8) {
        if (length === 1) throw new Error();
        if (length >= 2) {
          const code = payload.readUInt16BE();
          if (!((code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)) || (code >= 3000 && code <= 4999))) throw new Error();
          decoder.decode(payload.subarray(2));
        }
        this.frame(8, payload); this.fail(new Error("Codex WebSocket closed")); return;
      }
      if (opcode === 9) { this.frame(10, payload); continue; }
      if (opcode === 10) continue;
      if (this.parts.length >= 65536) throw new Error();
      if (length) this.parts.push(Buffer.from(payload)); this.size += length; this.fragmented = !fin;
      if (fin) {
        const text = decoder.decode(Buffer.concat(this.parts, this.size)); this.parts = []; this.size = 0;
        this.onText(text);
      }
    }
  }
}
