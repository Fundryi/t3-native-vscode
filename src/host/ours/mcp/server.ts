/**
 * Stateless MCP server over Streamable HTTP, JSON responses only, on 127.0.0.1 (port of legacy mcp.js).
 * No vscode import, so server.test.ts can load it. Every tool result carries meta(cwd, fallback, worktree).
 */
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";

export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: { readonly type: "object"; readonly properties: Readonly<Record<string, unknown>>; readonly [key: string]: unknown };
  run(args: Readonly<Record<string, unknown>>, context: { readonly cwd: string | null }): unknown;
}
export type McpMeta = (cwd: string | null, fallback: boolean, worktree: boolean) => Record<string, unknown>;
export interface McpServer { readonly port: number; close(): void }

const VERSIONS = ["2025-11-25", "2025-06-18"]; // 2025-03-26 dropped with batches, which only it allows
const DEFAULT_VERSION = "2025-06-18";
const MAX_BODY = 2 * 1024 * 1024;
const READ_TIMEOUT = 10000;

type Json = Record<string, unknown>;
const isObj = (value: unknown): value is Json => value !== null && typeof value === "object" && !Array.isArray(value);
const validId = (id: unknown) => typeof id === "string" || (typeof id === "number" && Number.isFinite(id));
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: validId(id) ? id : null, error: { code, message } });
const invalidParams = (message: string) => Object.assign(new Error(message), { rpc: -32602 });
const messageOf = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The bridge sends its cwd base64url-encoded so any path is header-safe. */
const decodeCwd = (header: string | string[] | undefined) => typeof header === "string" && header ? Buffer.from(header, "base64url").toString("utf8") || null : null;

export function startMcpServer({ token, tools, meta, version }: { token: string; tools: ReadonlyArray<McpTool>; meta: McpMeta; version: string }): Promise<McpServer> {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  let port = 0;

  async function callTool(params: unknown, cwd: string | null, fallback: boolean, worktree: boolean): Promise<Json> {
    if (!isObj(params) || typeof params.name !== "string" || (params.arguments !== undefined && !isObj(params.arguments))) {
      throw invalidParams("tools/call needs { name: string, arguments?: object }");
    }
    const tool = byName.get(params.name);
    if (!tool) return { content: [{ type: "text", text: `Unknown tool: ${params.name}` }], isError: true };
    const args = (params.arguments ?? {}) as Json;
    const extra = Object.keys(args).filter((name) => !Object.hasOwn(tool.inputSchema.properties, name));
    if (extra.length) throw invalidParams(`Unknown argument: ${extra.join(", ")}`);
    try {
      const data = await tool.run(args, { cwd });
      const result = { ...meta(cwd, fallback, worktree), ...(isObj(data) ? data : { value: data }) };
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    } catch (cause) {
      return { content: [{ type: "text", text: messageOf(cause) }], isError: true };
    }
  }

  /** A response object, or undefined for notifications and client responses. */
  async function handle(msg: unknown, cwd: string | null, fallback: boolean, worktree: boolean): Promise<Json | undefined> {
    if (!isObj(msg) || msg.jsonrpc !== "2.0") return rpcError(isObj(msg) ? msg.id : null, -32600, "Invalid Request");
    if (msg.method === undefined && ("result" in msg || "error" in msg)) return undefined;
    const isNote = !("id" in msg);
    if (typeof msg.method !== "string" || (!isNote && !validId(msg.id)) || (msg.params !== undefined && (msg.params === null || typeof msg.params !== "object"))) {
      return rpcError(msg.id, -32600, "Invalid Request");
    }
    if (isNote) return undefined;
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
    try {
      switch (msg.method) {
        case "initialize": {
          const asked = isObj(msg.params) ? msg.params.protocolVersion : undefined;
          return ok({ protocolVersion: typeof asked === "string" && VERSIONS.includes(asked) ? asked : DEFAULT_VERSION, capabilities: { tools: {} }, serverInfo: { name: "t3-vscode", version } });
        }
        case "ping": return ok({});
        case "tools/list": return ok({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
        case "tools/call": return ok(await callTool(msg.params, cwd, fallback, worktree));
        default: return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
      }
    } catch (cause) {
      return rpcError(msg.id, isObj(cause) && typeof cause.rpc === "number" ? cause.rpc : -32603, messageOf(cause));
    }
  }

  const server = createServer((req, res) => {
    const reply = (status: number, body?: unknown, headers: Record<string, string> = {}) => {
      if (res.headersSent) return;
      const text = body === undefined ? "" : JSON.stringify(body);
      res.writeHead(status, { ...(text ? { "Content-Type": "application/json" } : {}), ...headers });
      res.end(text);
    };
    const refuse = (status: number, message: string, headers: Record<string, string> = {}) => { reply(status, { error: message }, { Connection: "close", ...headers }); req.resume(); };

    // Order matters: the caller is checked before a single body byte is buffered.
    if (req.headers.host !== `127.0.0.1:${port}`) return refuse(421, "wrong Host");
    if (req.headers.origin !== undefined) return refuse(403, "Origin not allowed");
    if (req.headers["sec-fetch-site"] !== undefined) return refuse(403, "browser requests not allowed"); // browsers always send it, the bridge never does
    if (req.url !== "/mcp") return refuse(404, "not found");
    if (req.method !== "POST") return refuse(405, "only POST", { Allow: "POST" });
    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Bearer ") || !sameToken(auth.slice(7), token)) return refuse(401, "bad token");
    if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) return refuse(415, "Content-Type must be application/json");
    const asked = req.headers["mcp-protocol-version"];
    if (asked !== undefined && (typeof asked !== "string" || !VERSIONS.includes(asked))) return refuse(400, `unsupported MCP-Protocol-Version ${String(asked)}`);
    if (Number(req.headers["content-length"]) > MAX_BODY) return refuse(413, "body too large");

    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => { reply(408, { error: "body read timeout" }, { Connection: "close" }); req.destroy(); }, READ_TIMEOUT);
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      // Past the cap keep reading but drop, and answer at the end: closing with unread bytes makes TCP reset and the client loses the 413.
      if (size <= MAX_BODY) chunks.push(chunk);
    });
    req.on("close", () => clearTimeout(timer));
    req.on("end", () => {
      clearTimeout(timer);
      if (res.headersSent) return;
      if (size > MAX_BODY) return reply(413, { error: "body too large" });
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return reply(200, rpcError(null, -32700, "Parse error")); }
      if (Array.isArray(body)) return reply(200, rpcError(null, -32600, "Batches are not supported")); // removed in MCP 2025-06-18
      handle(body, decodeCwd(req.headers["x-t3-cwd"]), req.headers["x-t3-fallback"] === "1", req.headers["x-t3-worktree"] === "1")
        .then((out) => out ? reply(200, out) : reply(202), (cause: unknown) => reply(500, { error: messageOf(cause) }));
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      port = (server.address() as AddressInfo).port;
      resolve({ port, close: () => { server.close(); server.closeAllConnections(); } });
    });
  });
}
