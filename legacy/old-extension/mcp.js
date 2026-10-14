// Stateless MCP server over Streamable HTTP, JSON responses only. No vscode import: scripts/selfcheck-mcp.mjs requires it.
// tools: [{ name, description, inputSchema, run(args, { cwd }) }]. meta(cwd, fallback, worktree) -> { window, match } goes into every result.
const http = require('http');
const crypto = require('crypto');
const { version } = require('./package.json');

const VERSIONS = ['2025-11-25', '2025-06-18']; // 2025-03-26 dropped with batches, which only it allows
const DEFAULT_VERSION = '2025-06-18';
const MAX_BODY = 2 * 1024 * 1024;
const READ_TIMEOUT = 10000;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const validId = (id) => typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: validId(id) ? id : null, error: { code, message } });
const invalidParams = (message) => Object.assign(new Error(message), { rpc: -32602 });

function sameToken(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// The bridge sends its cwd base64url-encoded so any path is header-safe.
function decodeCwd(h) {
  return h ? Buffer.from(String(h), 'base64url').toString('utf8') || null : null;
}

function startMcpServer({ token, tools, meta = () => ({}) }) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  let port;

  async function callTool(params, cwd, fallback, worktree) {
    if (!isObj(params) || typeof params.name !== 'string' || (params.arguments !== undefined && !isObj(params.arguments))) {
      throw invalidParams('tools/call needs { name: string, arguments?: object }');
    }
    const tool = byName.get(params.name);
    if (!tool) return { content: [{ type: 'text', text: `Unknown tool: ${params.name}` }], isError: true };
    const args = params.arguments || {};
    const allowed = Object.keys((tool.inputSchema && tool.inputSchema.properties) || {});
    const extra = Object.keys(args).filter((k) => !allowed.includes(k));
    if (extra.length) throw invalidParams(`Unknown argument: ${extra.join(', ')}`);
    try {
      const data = await tool.run(args, { cwd });
      const result = { ...meta(cwd, fallback, worktree), ...(isObj(data) ? data : { value: data }) };
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (e) {
      return { content: [{ type: 'text', text: String((e && e.message) || e) }], isError: true };
    }
  }

  // A response object, or undefined for notifications and client responses.
  async function handle(msg, cwd, fallback, worktree) {
    if (!isObj(msg) || msg.jsonrpc !== '2.0') return rpcError(isObj(msg) ? msg.id : null, -32600, 'Invalid Request');
    if (msg.method === undefined && ('result' in msg || 'error' in msg)) return undefined;
    const isNote = !('id' in msg);
    if (typeof msg.method !== 'string' || (!isNote && !validId(msg.id)) || (msg.params !== undefined && (msg.params === null || typeof msg.params !== 'object'))) {
      return rpcError(msg.id, -32600, 'Invalid Request');
    }
    if (isNote) return undefined;
    const ok = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
    try {
      switch (msg.method) {
        case 'initialize': {
          const asked = isObj(msg.params) ? msg.params.protocolVersion : undefined;
          return ok({ protocolVersion: VERSIONS.includes(asked) ? asked : DEFAULT_VERSION, capabilities: { tools: {} }, serverInfo: { name: 't3-vscode', version } });
        }
        case 'ping': return ok({});
        case 'tools/list': return ok({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
        case 'tools/call': return ok(await callTool(msg.params, cwd, fallback, worktree));
        default: return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
      }
    } catch (e) {
      return rpcError(msg.id, e.rpc || -32603, e.message);
    }
  }

  const server = http.createServer((req, res) => {
    const reply = (status, body, headers = {}) => {
      if (res.headersSent) return;
      const text = body === undefined ? '' : JSON.stringify(body);
      res.writeHead(status, { ...(text ? { 'Content-Type': 'application/json' } : {}), ...headers });
      res.end(text);
    };
    const refuse = (status, message, headers) => { reply(status, { error: message }, { Connection: 'close', ...headers }); req.resume(); };

    // Order matters: the caller is checked before a single body byte is buffered.
    if (req.headers.host !== `127.0.0.1:${port}`) return refuse(421, 'wrong Host');
    if (req.headers.origin !== undefined) return refuse(403, 'Origin not allowed');
    if (req.headers['sec-fetch-site'] !== undefined) return refuse(403, 'browser requests not allowed'); // browsers always send it, the bridge never does
    if (req.url !== '/mcp') return refuse(404, 'not found');
    if (req.method !== 'POST') return refuse(405, 'only POST', { Allow: 'POST' });
    const auth = String(req.headers.authorization || '');
    if (!auth.startsWith('Bearer ') || !sameToken(auth.slice(7), token)) return refuse(401, 'bad token');
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return refuse(415, 'Content-Type must be application/json');
    const pv = req.headers['mcp-protocol-version'];
    if (pv !== undefined && !VERSIONS.includes(pv)) return refuse(400, `unsupported MCP-Protocol-Version ${pv}`);
    if (Number(req.headers['content-length']) > MAX_BODY) return refuse(413, 'body too large');

    const chunks = [];
    let size = 0;
    const abort = (status, message) => { clearTimeout(timer); reply(status, { error: message }, { Connection: 'close' }); req.destroy(); };
    const timer = setTimeout(() => abort(408, 'body read timeout'), READ_TIMEOUT);
    req.on('data', (c) => {
      size += c.length;
      // Past the cap keep reading but drop, and answer at the end: closing with unread bytes makes TCP reset and the client loses the 413. The timer bounds it.
      if (size <= MAX_BODY) chunks.push(c);
    });
    req.on('close', () => clearTimeout(timer));
    req.on('end', async () => {
      clearTimeout(timer);
      if (res.headersSent) return;
      if (size > MAX_BODY) return reply(413, { error: 'body too large' });
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(200, rpcError(null, -32700, 'Parse error')); }
      const cwd = decodeCwd(req.headers['x-t3-cwd']);
      if (Array.isArray(body)) return reply(200, rpcError(null, -32600, 'Batches are not supported')); // removed in MCP 2025-06-18
      const out = await handle(body, cwd, req.headers['x-t3-fallback'] === '1', req.headers['x-t3-worktree'] === '1');
      return out ? reply(200, out) : reply(202);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve({ port, close: () => { server.close(); server.closeAllConnections(); } });
    });
  });
}

module.exports = { startMcpServer };
