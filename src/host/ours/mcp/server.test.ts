/** The loopback gate of the context server (ported from the HTTP part of legacy scripts/selfcheck-mcp.mjs). */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { startMcpServer } from "./server.js";

const TOKEN = "a".repeat(64);
const server = await startMcpServer({
  token: TOKEN, version: "0.0.0-test", meta: (cwd) => ({ match: cwd ? "cwd" : "none" }),
  tools: [{ name: "workspace", description: "fake", inputSchema: { type: "object", properties: {} }, run: (_args, { cwd }) => ({ cwd }) }],
});
after(() => server.close());

interface Options { method?: string; path?: string; host?: string; headers?: Record<string, string>; body?: string; declaredLength?: number }
function send({ method = "POST", path = "/mcp", host = `127.0.0.1:${server.port}`, headers = {}, body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }), declaredLength }: Options = {}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const all: Record<string, string | number> = { host, authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...headers };
    if (declaredLength) all["content-length"] = declaredLength;
    const req = httpRequest({ host: "127.0.0.1", port: server.port, path, method, headers: all, agent: false }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { text += chunk; });
      res.on("end", () => { req.destroy(); resolve({ status: res.statusCode ?? 0, text }); });
    });
    req.on("error", reject);
    // A declared oversize body: send the headers only; the server must answer without reading a byte.
    if (declaredLength) req.flushHeaders(); else req.end(body);
  });
}

test("The context server answers only a loopback, non-browser, authorized JSON POST to /mcp", async () => {
  assert.equal((await send({ host: `localhost:${server.port}` })).status, 421);
  assert.equal((await send({ headers: { origin: "http://evil.example" } })).status, 403);
  assert.equal((await send({ headers: { "sec-fetch-site": "same-origin" } })).status, 403);
  assert.equal((await send({ path: "/other" })).status, 404);
  assert.equal((await send({ method: "GET", body: "" })).status, 405);
  assert.equal((await send({ headers: { authorization: "Bearer wrong" } })).status, 401);
  assert.equal((await send({ headers: { authorization: "" } })).status, 401);
  assert.equal((await send({ headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await send({ declaredLength: 3 * 1024 * 1024 })).status, 413);
  const good = await send({ headers: { "x-t3-cwd": Buffer.from("D:/x y", "utf8").toString("base64url") }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "workspace", arguments: {} } }) });
  assert.equal(good.status, 200);
  assert.deepEqual(JSON.parse(good.text).result.structuredContent, { match: "cwd", cwd: "D:/x y" });
});
