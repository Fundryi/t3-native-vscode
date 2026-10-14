# Piece 2: the VS Code context bridge

Written 2026-10-12. Slice 0 is built (`mcp.js`, `context.js`, `bridge.js`); where design and code differed, this body now describes the code. Read `docs/HANDOFF.md` 1.2 (decision 6) and section 4 first. The Codex review at the end is folded into this body; the body is the current design.

## 1. Goal

Every agent T3 starts can ask VS Code about the IDE it sits in: folders, open file, selection, tabs, errors, git state. Later it can also ask VS Code to open a file, reveal it, or show a diff.

The first claim covers only the two harnesses checked live: Claude Code and Codex. OpenCode, Cursor CLI and others stay unverified until their entry format and a real call are checked.

Not in any slice yet: installed extensions, settings, saving files, terminals, language server queries (definitions, references), Jupyter, blocking accept/reject diffs, closing tabs, push events (selection changed). All of these are "later" in `docs/FEATURES.md`.

## 2. Shape

```
agent (started by T3, cwd = thread root)
  -> stdio -> node <home>/.t3-vscode/bridge.js        (one entry, same for every harness)
       reads <home>/.t3-vscode/windows/*.json, picks a window by cwd, pins it
  -> HTTP POST http://127.0.0.1:<port>/mcp + bearer    (one server per VS Code window)
       MCP server inside our extension host, answers from the VS Code API
```

**Server.** Each window's extension host runs a small MCP server on 127.0.0.1, port picked by the OS (`listen(0)`). Transport is Streamable HTTP, stateless, JSON responses only: `initialize`, `notifications/initialized` (202), `ping`, `tools/list`, `tools/call`. Every method other than POST returns 405. `initialize` answers with the client's protocol version when it is 2025-11-25 or 2025-06-18, else with 2025-06-18; a later `MCP-Protocol-Version` header outside that list gets 400. The HTTP server is `mcp.js` (no `vscode` import, so the selfcheck can load it); the tools, the discovery writer and the setup command are in `context.js`. Neither uses a T3 surface. That keeps T3 churn out of it, but harness and nightly updates can still change how agents load and start it (section 6, risk 1).

**Loopback limits.** Checked in this order, before a single body byte is buffered:

1. `Host` other than `127.0.0.1:<port>`: 421.
2. Any `Origin` header: 403.
3. Any `Sec-Fetch-Site` header: 403. Browsers always send it; the bridge never does.
4. Path other than `/mcp`: 404.
5. Method other than POST: 405.
6. Missing or wrong bearer token: 401.
7. Content type other than `application/json`: 415.
8. `MCP-Protocol-Version` outside the accepted list: 400.
9. Declared `Content-Length` over 2 MB: 413.

Then:

- The body is read with a 2 MB cap (above the largest tool input) and a 10 s read timeout (408). A chunked body over the cap is read to its end and dropped, then answered 413, so the client gets the answer instead of a connection reset.
- Validate the JSON-RPC shape, the method, the tool name, and that arguments are an object with only known keys. Batches (an array body) get -32600: MCP 2025-06-18 removed them, so 2025-03-26 is not offered either. Later tools with number inputs check that every number is a finite integer in range. Hard caps apply server-side, whatever the agent asks for.
- Only local `file:` workspaces take part. A remote or virtual window (`remoteName` set, or any non-`file:` folder) starts no server and logs why. A window without folders writes no discovery file, so no bridge reaches it. `activeFile` ignores editors on other URI schemes.
- Relative path inputs resolve only against the matched folder (`cwdFolder`). No match is an error, never folder zero.
- The token says who calls. The cwd header is a routing hint, not proof of file authority.

**Why a stdio bridge in front.** A config entry is static, but the port and token change on every window reload, and a URL cannot pick a window. The bridge is plain Node, no SDK, about 160 lines. It reads JSON-RPC lines from stdin, POSTs each one, and knows just enough MCP to be a correct transport (MCP 2025-06-18, transports):

- It sends `Content-Type: application/json` and `Accept: application/json` (the server never streams).
- It remembers the protocol version from the `initialize` result and sends `MCP-Protocol-Version` on every later request.
- A 202 (the answer to a notification) writes nothing to stdout. Notifications never get a JSON-RPC response.
- stdout carries only valid JSON-RPC responses with the original request id. Discovery failures, HTTP errors, a timeout (every fetch is bounded, 30 s) and malformed answers become a JSON-RPC error for that id.
- It sends its cwd in `X-T3-Cwd`, base64url of the UTF-8 path, so any path is header-safe. The server decodes it once.

No SSE, no sessions. The extension copies `bridge.js` to `<home>/.t3-vscode/` on activate (only when the content differs), so the path in the entry never changes.

**Window discovery.** One file per window: `<home>/.t3-vscode/windows/<extension-host-pid>.json`.

```json
{ "version": 1, "pid": 1234, "port": 51234, "token": "<32 random bytes, hex>",
  "label": "app", "workspaceFile": "D:/work/app.code-workspace",
  "folders": ["D:/work/app", "D:/work/lib"],
  "focusedAt": "2026-10-12T09:00:00.000Z", "startedAt": "2026-10-12T08:59:00.000Z" }
```

- `label` is the workspace file name without `.code-workspace`, else the first folder's name. `workspaceFile` is null without one. `focusedAt` is null until the window has had focus. Paths use forward slashes and an upper-case drive letter.
- Written once the server listens, rewritten when folders change (`onDidChangeWorkspaceFolders`) and when the window gains focus (`onDidChangeWindowState`, sets `focusedAt`). Deleted on deactivate and on process exit.
- Written atomically: a temp file in the same folder, then a rename over the target. A reader never sees half a token or port.
- On activate the extension deletes files whose pid is dead (crash leftovers). The bridge skips files whose pid is dead and files that are malformed (bad JSON, missing or invalid fields: version 1, port 1 to 65535, absolute folder paths, a header-safe token), without hanging. A pid that is not a positive integer counts as dead: `kill(0, 0)` succeeds and would make a pid-0 file look alive.
- Discovery needs the extension active in every window. The extension activates on `onStartupFinished`, so a window publishes without the T3 panel open.

**Test hooks.** `T3VSCODE_HOME` replaces `<home>/.t3-vscode` in the extension and the bridge. `T3VSCODE_BRIDGE_TIMEOUT_MS` replaces the bridge's 30 s bound. Both exist for the selfcheck.

**Auth.** The token sits in the discovery file and goes out as `Authorization: Bearer <token>`. The Host and Origin checks above stop web pages (DNS rebinding, CSRF). Files are written with mode 0600 in a 0700 folder. On Windows those bits do nothing; the profile folder ACL (owner, SYSTEM, Administrators) is the real guard. Same trust model as the Claude Code extension.

**How a T3-started agent reaches it.** The owner registers one user-scope stdio entry per harness through CC Switch (decision 6). From source, not yet live:

- Claude: the CLI bundled with Claude Code 2.1.296 enables all settings sources by default and narrows them only when `--setting-sources` is passed. The pinned Agent SDK (0.3.276) passes that flag only when the caller sets `settingSources`, and T3's thread runs do not. So user-scope MCP servers from `~/.claude.json` load.
- Codex: T3 injects its own `mcp_servers` table and may point Codex at a different `CODEX_HOME`. Whether the user's entry survives is a live gate.

The gate for both is a real `workspace` call from a T3-started thread (section 5, check 3). A harness or nightly update can change any of this.

**Setup command (slice 0).** "T3: Show MCP setup" opens an untitled Markdown document with the exact entries to copy: the Claude JSON (`mcpServers.vscode`, `command: node`, `args: [<home>/.t3-vscode/bridge.js]`), the Codex TOML block (`[mcp_servers.vscode]`, `command`, `args`) and the terminal line `codex mcp add vscode -- node "<home>/.t3-vscode/bridge.js"`. We never edit harness config files ourselves.

Built 2026-10-13 (B16, decision 16): the per-harness buttons type the claude or codex add line into a terminal (never run), plus VS Code's own MCP server definition provider; O‍penCode left out (its pwsh shim drops the -- token). Deferred: other harness formats (a VS Code terminal with `claude mcp add --scope user ...` or `codex mcp add ...` typed in, not run; decision 6 still wants them for the first usable version), a direct HTTP entry as a debug path, and a fallback runtime (question 1).

**Dependency.** Hand-roll, no `@modelcontextprotocol/sdk`. The extension has zero dependencies and no build step today, and the stateless JSON-only server is five methods. Revisit the SDK only if we need server-to-client notifications, resources or sessions.

## 3. Tools

Every result is one text content item with a JSON object, also sent as `structuredContent`. The object is flat: `{window: {label, workspaceFile, folders}, match, ...fields}`. `match` is `cwd` (a window folder contains the agent's cwd), `bound` (no folder contains the cwd, so the bridge reached this window through `--workspace`, section 4), `fallback` (no single window matched, so the bridge took the last focused one and adds a `note` saying so; decision 10) or `none` (no cwd was sent). The Fields column below lists what follows `window` and `match`. Lines and characters are 1-based. Paths are absolute, with forward slashes and an upper-case drive letter. Errors come back as `isError: true` with one plain sentence.

### Slice 0 (the proof)

| Tool | Description | Input | Fields | Cap |
|---|---|---|---|---|
| `workspace` | Folders of this VS Code window and which one holds your cwd | none | `folders: [{name, path}], workspaceFile, cwd, cwdFolder` | 50 folders |
| `activeFile` | The last file you worked in, cursor and selection | none | `path, languageId, dirty, cursor: {line, character}, selection: {start, end, text, truncated}`, or only `path: null` when there is no file | text 8192 chars |

`activeFile` keeps the last text editor with a `file:` document inside the window's folders and its selection (`onDidChangeActiveTextEditor`, `onDidChangeTextEditorSelection`). Focus moving into the T3 panel does not clear it. On each call it refreshes the range against the current document and reads the text fresh. It clears when that document closes or leaves the workspace folders.

### Slice 1 (more reads, after the slice 0 gate)

| Tool | Description | Input | Fields | Cap |
|---|---|---|---|---|
| `openTabs` | Tabs open in all editor groups | none | `{total, truncated, tabs: [{path, label, group, active, dirty, kind}]}` (`kind`: text, diff, other; the tab the user looks at first) | 200 tabs |
| `diagnostics` | Problems panel entries | `{path?, minSeverity?: error, warning, info, hint, max?}` | `{total, truncated, items: [{path, line, column, severity, message, source, code}]}` | default 100, hard cap 500; message 500 chars |
| `gitState` | Branch and changed files per repo, from the built-in Git extension (`vscode.git`, `getAPI(1)`) | `{path?}` (only the deepest repo holding it) | `{available, truncated, repos: [{root, branch, upstream, ahead, behind, staged: [{path, status}], changes: [{path, status}], truncated}]}` | 200 files per repo, 20 repos |

`gitState` returns `{available: false}` when the Git extension is off.

Built 2026-10-12 (slice 1, Opus builder): all three in context.js, selfcheck-mcp 40 checks. Status words follow the Git extension Status enum; changes = merge, then working tree, then untracked; 200 files per repo in total, staged first. Not in a real window yet: Codex test run.

### Slice 2 (actions)

| Tool | Description | Input | Fields | Cap |
|---|---|---|---|---|
| `openFile` | Open a file in this window, cursor at a line, the Explorer reveals it | `{path, line?, column?, preview?}` | `{ok, reason?}` (reason: busy, refused or not found, outside the workspace folders, ...) | inside a workspace folder; 300 ms gate |
| `revealInExplorer` | Select a file or folder in the Explorer, no editor | `{path}` | `{ok, reason?}` | inside a workspace folder |
| `showDiff` | Open the working-tree change of a file in the Git diff editor (git.openChange), else the file | `{path}` | `{ok, reason?}` | inside a workspace folder |

`showDiff` does not wait for accept or reject. A blocking review diff (like Claude Code's `openDiff`) is later. Built 2026-10-13 (B22, Opus builder): the three tools call the internal commands t3vscode._open and t3vscode._diff, which run the same landing rules as a chip click (extension.js openFile, openDiff). Question 4 decided: never outside the window's workspace folders; the check compares normalized paths (not canonical: a symlink inside a folder pointing outside passes). Actions are never retried. selfcheck-mcp 52.

Built 2026-10-12 (B23, Opus builder): `extensions` ({query?} -> {total, truncated, items: [{id, name, version, active}]}, non-builtin only, disabled ones never appear, cap 300) and `terminalOutput` ({count? 1..20, terminal?} -> {supported, items: [{terminal, cwd, commandLine, exitCode, startedAt, endedAt, output, truncated}]}, the last 20 finished shell-integration executions, output capped at 8 KB with colour codes left in). Later, not in any slice: `settings`, `saveFile`, `closeDiffTabs`, `runInTerminal`, `references`, `definitions`.

## 4. Multi-window and multi-root rules

- **Path match.** Normalize both sides (resolve, forward slashes, no trailing separator). On Windows compare case-insensitively over the whole path; output keeps the original case, except that the drive letter is upper-cased. A folder contains the cwd only when the cwd equals it or starts with it plus a separator, so `D:/work/app2` is not inside `D:/work/app`. Deepest folder wins.
- **Two windows on the same deepest folder:** an ambiguity error naming both windows, unless an explicit binding picks one. Focus never breaks the tie.
- **Explicit binding:** a `--workspace <folder or .code-workspace path>` argument on the bridge entry. The bridge then accepts only the window with that folder or workspace file. Used for ties, and for the proof if a harness starts the bridge in the wrong cwd.
- **No matching window, or a tie (decided by the owner 2026-10-12, HANDOFF 1.2 decision 10):** the agent never manages windows. The bridge takes the last focused window (`focusedAt`, else `startedAt`) and every result carries `match: "fallback"` plus a `note` naming the cwd, so the agent and the owner can see it. The bridge's fallback flag wins over the cwd match (Codex review 2026-10-13, security 3): a tie between two windows on the same folder reports `fallback` with the note "Several VS Code windows have <cwd> open; this is the one the owner used last", a no-match reports "No VS Code window has <cwd> open". Codex's position (an error until bound) is recorded in its review below; the owner chose fewer agent round trips. `--workspace` still binds explicitly.
- **Git worktrees (R19):** T3 puts worktrees under `<T3 home>/worktrees`, outside every VS Code folder. When no window folder holds the cwd, the bridge walks up from the cwd to the first `.git`. When that is a file reading `gitdir: <main>/.git/worktrees/<name>` (a relative gitdir resolves against the folder that holds the file), it matches `<main>` by the same path and depth rules. A hit is not a fallback: the bridge sends `X-T3-Worktree: 1`, and results carry `match: "worktree"` plus a `note`. A `.git` directory, a submodule gitdir or no window on `<main>` keeps the fallback above; a tie on `<main>` is still a fallback. Known limit: `gitState` describes the main checkout, not the worktree, because the `vscode.git` API knows only open repositories; the note says so.
- **Pinning.** On the first request the bridge pins the selected workspace identity (workspace file, else the sorted folder list) together with its pid, port and token. Later requests go only to that window, so answers never jump when focus changes.
- **Reload and connection errors.** The bridge re-reads the discovery files and reconnects only to the pinned pid while its file exists; once it is gone, only to the single window with the pinned identity (two such windows give an ambiguity error). It retries for up to 10 s, then returns a clear error ("VS Code window <name> is gone"). It never switches to another window.
- **401 (stale token).** Treated as reselection within the pin: re-read discovery, take the current port and token by the same rule as a reload, retry once.
- **Uncertain answers.** A read may be retried. An action (slice 2) is never re-sent automatically after a timeout or a lost answer.
- **One window, many folders (`.code-workspace`):** one server answers for all folders. `workspace` lists them and names the one with the cwd (`cwdFolder`).
- **Folders vs T3 projects:** a T3 thread spans one project root (HANDOFF section 4). That root is the agent's cwd, so it maps to one folder. The agent may still read other folders with its own tools; our tools give it their paths, diagnostics and git state. T3's diff and worktree features still see only the thread root.
- **Precedent:** the Claude CLI picks an IDE lock file whose folders contain its cwd, and the Codex extension answers `ide-context` only when a window folder contains the asked root, using a separator-qualified prefix test. Our rule is the same.

## 5. Slices and how to prove them

**Slice 0 build:** `mcp.js` (server, limits), `context.js` (`workspace`, `activeFile`, the discovery writer, the setup command), `bridge.js`, startup activation, and `scripts/selfcheck-mcp.mjs`. About 480 lines without the selfcheck. Nothing else until slice 0 passes.

**Status 2026-10-12.** Proven in an isolated VS Code 1.141: startup activation without the panel, discovery, the bridge, both tools. Still untested: the 401 re-read, `--workspace` binding, two-window ambiguity in a real host, and real calls from T3-started Claude and Codex (acceptance checks 3 to 6).

**Setup for the checks:** window A opens a multi-root workspace with folders X and Y. Window B opens folder Z. A's T3 panel is never opened (A is active through startup activation only). Entries registered through CC Switch.

Checks, in order. Checks 1 and 2 are scripts and run before any human check. `node scripts/selfcheck-mcp.mjs` covers them except the slow-body timeout and the discovery-writer race.

1. **Transport self-check.** Drive the bridge over stdio: `initialize`, `notifications/initialized` (nothing on stdout), `ping`, one `tools/call`, a stalled server (timeout becomes a JSON-RPC error with the right id), malformed input (bad JSON line, bad JSON-RPC shape, unknown tool, wrong argument types). The bridge never hangs and never writes anything but JSON-RPC responses to stdout.
2. **Security self-check.** No token: 401. Token plus `Origin`: 403. Token plus `Sec-Fetch-Site`: 403. Wrong `Host`: 421. GET: 405. Oversized declared body: 413 without reading it. Oversized chunked body: a readable 413. A pid-0 discovery file is skipped, no ambiguity error. Slow body: read timeout. A reader racing the discovery writer never sees a partial file. Good request: 200.
3. **Real calls, both harnesses.** A fresh T3-started Claude thread rooted in X and a fresh T3-started Codex thread rooted in Y each call `workspace` and `activeFile`. Pass: `cwd` equals the thread root, `cwdFolder` is the right folder, `match` is `cwd`, folders and `workspaceFile` match window A. Listing tools is not enough. For Codex this also proves the user entry survives T3's `mcp_servers` override and `CODEX_HOME`. If the cwd is wrong: bind explicitly for the proof and record the failure. Never pass on a focus fallback.
4. **Selection survives T3 focus.** In A, select lines in a file, click into the T3 composer, send "call activeFile". Path, range and text match, in both harnesses. A 50,000 character selection returns `truncated: true`.
5. **Two windows.** B has focus; a thread rooted in X gets window A. Then open a second window on Z: a thread rooted in Z gets the ambiguity error, and works once bound.
6. **Reload and gone.** Reload A mid-thread: the next call reaches A again (new port and token, same entry, pin holds). Close A for good: after the bounded retry the call fails with a clear error and does not answer from B. Close all windows: the call fails fast.

**Slice 1 checks:** a TypeScript type error in an open file shows up in `diagnostics` with `minSeverity: error`; `gitState` shows the same branch and changed files as the Source Control view; `openTabs` matches the editor groups.

**Slice 2 check:** `openFile` with a line opens the file at that line in A while B has focus; `showDiff` with `rightContent` shows the diff in A.

## 6. Risks

1. **Harness and nightly changes.** The Claude loading path and Codex's `mcp_servers` override are read from the source of specific versions. A CLI, SDK or T3 nightly update can change how entries load or where the bridge starts. Repeat check 3 after such updates. If it fails, report upstream; never patch T3.
2. **Bridge cwd unverified.** We assume harnesses start stdio MCP servers in the agent's cwd. If not, matching fails and the explicit binding carries the proof. MCP `roots` is an unverified alternative: it needs an advertised client capability and request handling, which the line forwarder does not have.
3. **Port clashes:** none by design, the OS picks a free port. Discovery files carry the port, so nothing is hard-coded.
4. **Stale discovery files** after a crash: pid check in the bridge, sweep on activate. A reused pid could match a dead window's file; the token then fails with 401 and the bridge reselects within its pin.
5. **No VS Code window, or the extension not active in it:** a clear error that says which ("no VS Code window with t3-vscode active"), no hang. If the harness only connects at startup, the thread needs a restart after VS Code opens.
6. **Window focus:** `openFile` cannot bring the VS Code window to the front; the OS may only flash it in the taskbar.
7. **Claude Code extension's own IDE server:** we coexist. Facts from the installed extension 2.1.296: it writes `<home>/.claude/ide/<port>.lock`, listens on a random loopback port over WebSocket, checks `x-claude-code-ide-authorization`, and keeps one client at a time. The Claude CLI connects only with `autoConnectIde`, `CLAUDE_CODE_AUTO_CONNECT_IDE`, inside a VS Code terminal, or with `CLAUDE_CODE_SSE_PORT`; a T3-started Claude has none of these by default (source only). Different folder, port and tool names (`mcp__ide__...` vs `mcp__vscode__...`). If the owner turns on `autoConnectIde`, Claude sees both tool sets, and a T3 Claude could kick another Claude client off that window's IDE server.
8. **Windows file permissions:** mode bits are ignored; we rely on the profile ACL. Anyone who can read the user's profile can call the tools. Same as Claude Code's lock files.

## 7. Open questions for the owner

1. **Bridge runtime.** (a) `node` on PATH. (b) VS Code's own executable with `ELECTRON_RUN_AS_NODE=1`, no Node install needed, but the path changes with VS Code installs. Recommend (a) for slice 0; (b) is deferred and offered later only when `node` is missing.
2. **No matching window.** Open: owner decides, both positions in section 4.
3. **Codex's experimental LSP MCP** (`chatgpt.useExperimentalLspMcpServer`, off by default). (a) Ignore it, ours covers diagnostics. (b) Also tell users to enable it for references and symbols. Recommend (a); add `references` and `definitions` to our server later instead, because its socket path changes on every activation and a copied entry goes stale.
4. **Actions outside the workspace roots** (before slice 2). May `openFile`, `revealInExplorer` and `showDiff` touch existing files outside the window's folders? Recommend no for slice 2, with canonical-path checks; widen only on a real need. Decided 2026-10-13 (lead): no; normalized-path check.

Registration scope is settled: user scope through CC Switch (decision 6, section 2).

## Review (Codex), 2026-10-12

Folded into the design body on 2026-10-12.

Static review against `reference/t3code` at `d07a07f33c0a1b317dea6234636976231c3688b5`. Installed-artifact labels below mean the read-only extension directories `anthropic.claude-code-2.1.296-win32-x64` (Claude) and `openai.chatgpt-26.51007.21434-win32-x64` (Codex). Binary evidence is extracted strings, never execution. No live T3/harness check, config inspection, token use, build or install was performed; live behavior remains **unverified**.

### 1. should fix: replace the Claude settings hypothesis with the verified loading path

**Evidence.** Risk 1 (`docs/PIECE2.md:104`) borrows Cursor's behavior. T3's Claude options omit both `settingSources` and `strictMcpConfig` (`reference/t3code/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts:1007-1067`), strip their explicit MCP map before `query`, then register T3 over stdin (`:690-731`). The capability probe explicitly uses `strictMcpConfig: true`, separately from its setting sources (`reference/t3code/apps/server/src/provider/ClaudeProvider.ts:231-240`). Cursor's different SDK explicitly loads its named layers (`reference/t3code/packages/provider-cursor/src/server/adapter.ts:289-328`).

In Claude's `resources/native-binary/claude.exe`, exact strings are:

- `function dn(){return["userSettings","projectSettings","localSettings","flagSettings","policySettings"]` and `#u=dn()` establish the default source list.
- `function cbr(){let e=UA("--setting-sources");if(e!==void 0)c(e);` applies a source override only when present; restricted launches have a separate exclusion path.
- `function cn(e){return No().includes(e)}` and `if(e in r&&!(e==="local"?kRt():cn(r[e])))return{servers:mT(),errors:[]};` gate MCP scopes by the enabled settings sources.
- `case"user":{let s=ce().mcpServers;` reads user MCP definitions from the global config. The bundled path helper distinguishes `globalConfig:it(e||zt(),".claude.json")` from `userSettings:it(e||it(zt(),".claude"),"settings.json")`.
- Bundled SDK code contains `if(ae!==void 0)b.push(sE("--setting-sources",ae.join(",")));if(Ne)b.push("--strict-mcp-config")`.

The pinned SDK is `0.3.276` (`reference/t3code/pnpm-lock.yaml:1946`). Read-only inspection of its published npm archive, `package/sdk.mjs:127,228`, independently confirms no default source override: `settingSources:O` is passed through and `if(O!==void 0)q.push(` followed by the `--setting-sources` argument. Nothing was installed.

**Conclusion and fix.** For these inspected versions, omission leaves user-scope MCP loading enabled, including `~/.claude.json`; it does not merely suppress `settings.json` while independently allowing every MCP scope. Explicitly excluding `user` also gates user MCP. Remove the omission-based warning and the speculative automatic project-config fallback. Keep user registration through CC Switch, with a live T3-started `workspace` call as the remaining gate. Actual T3-selected executable, environment/config directory, policy, connection and tool permissions remain **unverified**. Do not extrapolate Cursor's defaults to Claude or claim Piece 2 cannot be affected by harness/nightly changes (`docs/PIECE2.md:21,41`).

### 2. blocks: establish bridge cwd in both harnesses before relying on automatic routing

**Evidence.** The bridge sends its own process cwd (`docs/PIECE2.md:23`), but acceptance check 2 verifies it only with Claude (`:94`). T3 sets Claude query cwd (`reference/t3code/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts:1061-1067`). Codex receives thread cwd in a protocol request (`reference/t3code/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts:1312-1328`), while T3's production Codex process launch supplies no cwd (`:1520-1527`); these are different facts. Claude's bundled stdio transport uses `cwd:this._serverParams.cwd`; its stdio config schema starts `type:C("stdio").optional(),command:o().min(1,"Command cannot be empty"),args:T(o()).default([]),env:ue(o(),o()).optional()` with no cwd field. Neither observation establishes the final MCP child cwd in every harness.

**Fix.** Make two actual tool calls, `workspace` and `activeFile`, in fresh T3-started Claude **and Codex** threads rooted in different multi-root folders. Require the bridge-reported cwd to equal each thread root; listing tools alone (`docs/PIECE2.md:93`) is insufficient. Treat Codex user-config survival under T3's override as a live gate too: T3 injects an `mcp_servers` table and may select a different `CODEX_HOME` (`CodexAdapterV2.ts:1321-1328,1516-1519`). If cwd is wrong, use an explicit workspace binding for the proof, not a silent focus fallback. MCP `roots` is an **unverified** alternative and needs an advertised client capability, a server request and response handling; it is not available from the current line-forwarder design (`docs/PIECE2.md:23,105`; bundled Claude string `Client does not support roots list changed notifications`). Limit the initial compatibility claim to the two harnesses actually checked; other registration formats remain unverified (`:7,45`).

### 3. blocks: unmatched cwd and reload must not silently select another window

**Evidence.** No match selects the last-focused window; only `workspace` reports `matchedCwd` (`docs/PIECE2.md:37,58-64,80-85`). Other calls can therefore return an unrelated window's selection without that warning. Connection failure re-runs selection (`:23`), including during A's reload (`:98`), when only B's discovery file may be available. Two windows on one root are resolved by focus, not a T3-thread/window association (`:81`); the Codex precedent explicitly tests containment with `r===n||r.startsWith(n.endsWith(PR.sep)?n:` followed by the separator-qualified prefix in `out/extension.js`, rather than accepting an unrelated root.

**Fix.** Pin the chosen workspace identity as well as the connection credentials. On reload, reconnect only to that workspace; use a bounded retry and then a clear error if it has not returned. Handle stale-token 401 separately: risk 4 promises reselection after 401 (`:107`), but section 2 specifies only connection errors. Do not reissue a future action automatically after an uncertain response. Every tool should expose its selected window and match status. Compare normalized paths by directory boundary, handle Windows path case consistently, and return an ambiguity error or require an explicit binding when two windows share the root.

**Open:** the lead recommends last-focused fallback for worktree threads (`:116`); this review recommends a no-match error by default, with explicit window binding if needed. The former is convenient, but cwd cannot identify the intended IDE window in that case and the fallback exposes unrelated context. Git-common-dir matching can remain deferred.

### 4. blocks: the stdio bridge needs a small amount of MCP transport knowledge

**Evidence.** The server checks the negotiated HTTP version while the bridge claims to know no MCP and only forwards lines (`docs/PIECE2.md:21-23`). A stdio client has no HTTP header to forward. Claude's bundled HTTP client explicitly sets `if(this._protocolVersion)e["mcp-protocol-version"]=this._protocolVersion`; its receive path contains `if(w.status===202){...return}`. Thus an empty notification response cannot be parsed and emitted as a JSON-RPC reply. The [2025-06-18 transport specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) confirms notification/response POSTs have empty 202 responses and subsequent requests carry the negotiated version (Sending Messages, items 2-5; Protocol Version Header). This confirms the installed strings rather than adding a different transport.

**Fix.** Parse enough to retain the `initialize` result's version, set `MCP-Protocol-Version` thereafter, send the required Accept/JSON headers, suppress stdout on 202, and emit only valid JSON-RPC responses with the original request id. Bound fetch duration and translate discovery, HTTP and malformed-response failures into request errors; notifications receive no JSON-RPC response. Encode cwd as ASCII in the custom header and decode once, rather than assuming every workspace path is header-safe. Add a focused transport self-check covering initialization, initialized notification, ping, one tool call, timeout and malformed input before the human harness check. Stateless JSON responses and GET 405 are sufficient; this does not require SSE, sessions or an SDK.

### 5. should fix: define bounded parsing and file/URI policy at the loopback boundary

**Evidence.** Auth, Origin and Host checks are specified (`docs/PIECE2.md:39`), but the only size limits are tool-output caps and diff content (`:56-72`); there is no request-body limit, read deadline or input schema policy. Relative paths can fall through to the first root, and action paths merely have to exist (`:52,70-72`). These omissions are design gaps, not an observed exploit. `package.json:10` places the extension in the UI host, while discovery stores only filesystem paths (`docs/PIECE2.md:30-32`), leaving remote/virtual URI interpretation unspecified.

**Fix.** Authenticate and validate Host/Origin before buffering a body; accept only POST `/mcp` JSON with a fixed byte limit and read timeout. Validate JSON-RPC shape, tool names, object arguments, finite integer ranges and hard caps server-side. Publish discovery files by atomic replacement so a concurrent reader cannot observe a partial token/port record; skip malformed files without hanging. For the local proof, reject remote/virtual workspaces and unsupported editor URI schemes explicitly. Resolve relative file inputs only against a verified `cwdFolder`; on no match, error instead of using root zero. Before slice 2, specify whether actions permit existing files outside workspace roots and validate canonical paths accordingly. A token authenticates the caller; the cwd header is a routing hint, not proof of file authority. No broader permission framework is needed.

### 6. should fix: selection must survive the user moving into T3's panel

**Evidence.** `activeFile` describes only the file in focus and may return null (`docs/PIECE2.md:59`); the acceptance check reads a selection without explicitly moving to chat (`:96`). The checklist calls for selection events (`docs/FEATURES.md:29`). Claude's installed `extension.js` has `function C$1(){return R7}`, writes `R7=U` from `onDidChangeTextEditorSelection`, and describes `getLatestSelection` as `Get the most recent text selection (even if not in the active editor)`. Codex's `out/extension.js` also handles `onDidChangeTextEditorSelection` and keeps `this.ideContext`. Exact panel-focus behavior in our extension is **unverified**.

**Fix.** Define `activeFile` to retain the last relevant text editor/selection when focus enters T3, refresh the range against the current document when called, and clear it when that document closes or leaves the allowed workspace. Keep this within the existing tool; no push events or additional tool are necessary. Acceptance should select text, focus the T3 composer, send the request, then verify path, range and selected text through both harnesses.

### 7. should fix: a window without an activated panel has no discovery file

**Evidence.** The current activation events are the panel and commands (`package.json:11-17`), while the design publishes discovery only on activation and assumes each window has a server (`docs/PIECE2.md:21,35,97`). A bare workspace window is not guaranteed to activate this extension. Runtime activation in multiple windows is **unverified**.

**Fix.** Either add startup activation when implementing discovery, or explicitly limit the proof to windows where the T3 panel/setup command has been opened. Test A with its panel unopened while B is active before claiming arbitrary open windows are discoverable. Do not confuse an inactive extension with a dead window or a harness-config failure.

### 8. should fix: separate the smallest bridge proof from the first usable feature list

**Evidence.** Slice 1 includes five tools, Git-extension integration and setup UI (`docs/PIECE2.md:58-62,89`). `docs/FEATURES.md:100-102` labels the broader list the first usable version, while the bridge's critical unknowns are loading and routing (`docs/PIECE2.md:93-94,97-98`). Additional read tools do not resolve those unknowns.

**Fix.** First prove the server, stdio bridge and discovery with only `workspace` and `activeFile`, exact Claude/Codex entries presented through a minimal setup command, two windows and a multi-root workspace. Include the transport/security checks above and real tool calls in both T3-started harnesses. Add diagnostics, tabs and git state after that gate; defer fallback runtimes, direct-HTTP debug setup and per-harness terminal-command buttons. Keep slice 2 separate. The final usable-version checklist can stay broader without making all of it a prerequisite to prove the bridge.

**Verdict:** No, slice 1 as written is larger than the smallest proof; two read tools through the full authenticated discovery/stdio path in T3-started Claude and Codex are sufficient once cwd, window identity and protocol handling are demonstrated.
