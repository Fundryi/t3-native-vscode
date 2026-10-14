Source: scout notes of 2026-10-14, synthesized by the lead's writer agent.

# Port map: our nine features on top of his extension

For phase 3 (docs/STATUS.md "Run plan"). Code read at main 85f5846. T3 facts at `reference/t3code` tag `v0.0.46-nightly.20261014.3093` (commit 107f6024). Every his-file line below was re-opened by the writer; where scouts disagreed, the opened line wins (registry is extension.ts:53 not :50, bridge :57-62 not :54-60, openSession :244 not :229, activationEvents package.json:20 not :19).

Feature names (used in ids and settings): A `mcp`, B `approvals`, C `statusbar`, D `prompt`, E `tasks`, F `desktop`, G `links`, H `saveOnSend`, I `drop`.

Owner priority (2026-10-14): maximum compatibility with upstream merges. Our code lives in new files under src/host/ours/ and src/webview/ours/. His files get one-line hooks, landed once, in slice 0, ideally in one place (src/extension.ts). Where a feature could either touch his file or compose around it (a VS Code API, a wrapper, a listener on his state), it composes. package.json additions go FIRST in each array, right after the opening bracket, not at the end: appending would edit his closing line (0.9 says why; the goal, a clean 3-way merge, is the same).

## 0. Shared plumbing (slice 0, landed by the lead BEFORE the nine builders branch)

Why first: otherwise nine builders edit the same lines of his files. After slice 0 a builder touches only its own ours files, one line in src/host/ours/index.ts (its activate call), and the START of package.json arrays (0.9).

### 0.1 The hook into src/extension.ts (2 lines, one place)

- Import after :11 (his `./host/bridge.js` import): `import { activateOurs } from "./host/ours/index.js";`. Not after :29: that is his last import, where he adds new ones.
- Call on the blank line :139, between the `context.subscriptions.push(...)` that ends at :138 and `await hostState.start()` at :140:
  `context.subscriptions.push(activateOurs(context, { client, hostState, registry, provider, notifications }));`
- activateOurs is synchronous and returns one Disposable, so everything is registered before the await at :140 (which blocks through discovery and pairing, hostState.ts:318, :336-361) and before VS Code can call `resolveWebviewView`. Each feature's activate is wrapped in try/catch and logged; one broken feature never breaks his activation. The same holds for every entry point his code can call later (wrappers, listeners), see 0.2.

| Dep | Type | Where it comes from | Why ours needs it |
|---|---|---|---|
| context | ExtensionContext | extension.ts:33 | subscriptions, globalState, extension.id, extensionUri |
| client | T3Client | extension.ts:41 | B: `getThreadProjection` (t3Client.ts:123) and `dispatch` (:124-127) for ANY thread. `HostState.client` is private (hostState.ts:142) and `respondToRequest` (:813-825) throws "no longer pending" for a thread without a loaded projection (:817-818), the usual background-thread case |
| hostState | HostState | extension.ts:44 (module `let` at :31; narrowed, :140 compiles without a non-null assertion) | `onDidChangeState(listener, viewId)` :154 (calls the listener at once, then on every emit). `emit` (:1261-1265) is synchronous and has no error guard; only `scheduleEmit` (:1257-1260) debounces (32 ms), while `setPhase` (:1254-1256, called inside `connect`) and direct `this.emit()` calls such as :631 run our listener inside his methods, `snapshot(viewId)` :1080, `sendMessage` :636, `queueAction` :996, `uploadAttachment` :282, `composerState`, `webUiUrl` :1242 |
| registry | WebviewRegistry | extension.ts:53 (class at host/bridge.ts:16) | `focusedViewId` (:23, falls back to the sidebar), `postWhenReady(viewId, event, data)` :28-31 (queues until the view's first getState) |
| provider | T3WebviewProvider | declared :55, assigned :63; class NOT exported (:182) | typed structurally in src/host/ours/types.ts: `openSession(id)` :244, `insertReference(ref)` :251, `createPanel(sourceViewId?)` :261, `resolveWebviewView(view)` :197. A class instance with private fields is assignable to such an interface |
| notifications | InputNotificationTracker | extension.ts:64 (class at host/inputNotifications.ts:4-23) | B claims approval requests through its `update` (see 0.2) |

Not passed (not needed): `bridge` (:57), `meters` (:56; C only needs its priority, usageStatusBar.ts:38 uses `100 - index`).

### 0.2 Compose, do not edit: the wrapper rule

When a feature must change his behavior, wrap a PUBLIC member of an instance he passes us, all in one file, src/host/ours/wrap.ts:

```ts
const orig: typeof target.method = target.method.bind(target);
target.method = (...args) => { /* ours first */ return orig(...args); };
```

- Typed as `typeof target.method`, so a rename or a type-incompatible signature change upstream fails `pnpm run typecheck`. It does NOT catch a same-typed reorder of parameters that our code reads by position (H reads `text` and `action`); with a pass-through `(...args) => orig(...args)` everything else is forwarded untouched. Re-read those parameters on each merge (0.10).
- Every wrapper body and every ours listener catches ALL errors and logs them. His `emit` loop has no guard (hostState.ts:1264) and runs inside `connect` (via `setPhase`, :1255), and his own listener (extension.ts:65-76) calls `notifications.update` directly: one throw from ours would stop his loop and climb into his `connect`. A wrapper whose own code fails returns `orig(...args)` unchanged.
- Why not a line in his code instead: his notification loop (extension.ts:69-75), `updateTitles` (:208) and the sendMessage case (host/bridge.ts:184-189) are code he edits often; a hook there conflicts on many merges. A wrapper conflicts on none.
- The three wrappers, and nothing else:

| Wrapped member | Feature | Effect |
|---|---|---|
| `notifications.update` (inputNotifications.ts:6) | B | calls `orig(state)` first, then filters inside try/catch (on error it returns his list unfiltered, so his toast shows); returns his list minus threads whose `pendingRuntimeRequest.kind` is a ProviderRequestKind; ours toasts those. His `seen` set still dedups (key env:thread:request, :9-13), so never two toasts for one request |
| `provider.resolveWebviewView` (extension.ts:197) | C | captures the sidebar WebviewView for `view.badge`, then calls his |
| `hostState.sendMessage` (:636) and `hostState.queueAction` (:996) | H | awaits the save (errors caught), then calls his; `queueAction` only for `action === "edit"` (see H). His BridgeHandler calls the same instance (host/bridge.ts:188), so the wrapper sits in his send path |

Listeners need no wrapper: ours calls `hostState.onDidChangeState` itself (C, the A nudge, G), each listener body in try/catch.

### 0.3 All his-file touches (complete list; each is one line)

| His file:line | One-line edit | Why it cannot be composed |
|---|---|---|
| src/extension.ts after :11 and at :139 | the import and the activateOurs call (0.1) | the only entry point |
| src/shared/bridge.ts:21-35 (Methods) | a new line `ours: "ours",` right after `export const Methods = {` (:21), not at the end (:34, where he adds) | `validateRpcMessage` (:146-150) rejects at run time any method not in Methods |
| src/host/bridge.ts after :6 (import) and right after `switch (message.method) {` at :91 (the case) | `import { oursRpc } from "./ours/rpc.js";` and `case "ours": return { id: message.id, result: await oursRpc(params, viewId) };` | `handle` (:83-245) has no default branch; an unknown case falls through to the snapshot. Not after his last case (:241) or last import (:14): that is where he adds |
| src/webview/main.tsx after :1 (his first import; his last is :4) | `import "./ours/index";` | the only webview entry (vite single entry) |
| package.json:306 (scripts.test) | append ` src/host/ours/**/*.test.ts` | his globs are not recursive and do not see ours |
| package.json:20 (activationEvents, today `[]`) | `["onStartupFinished", "onUri"]` | A needs startup (discovery file), G needs onUri; landed once so A, C, E and G do not race on one line. Owner question 1 |
| scripts/commands.test.mjs:8 | read src/extension.ts plus every `.ts` under src/host/ours (readdir recursive) into `source` | the test asserts every contributed command is registered, scanning extension.ts only (:8, :12, :15) |
| package.json:37 (views.t3-sidebar, I only, if owner question 10 is yes) | his `}` becomes `},`, then our view object | array order is display order; his chat view stays first (0.9 exception) |

Dropped after review: the Events edit (shared/bridge.ts:39 is one line, so any edit rewrites his line; ours uses `const OURS_EVENT = "ours" as string as BridgeEvent` in src/host/ours and src/webview/ours, because bridge-client.ts:51-53 dispatches any event string and `postWhenReady`, host/bridge.ts:28-31, only queues and forwards; a direct `"ours" as BridgeEvent` fails the overlap check, TS2352), and the `.vscodeignore` line (A ships bridge.js as a string constant inside dist/extension.mjs, see A).

No other his-file edit without the lead. For the regex at commands.test.mjs:12, ours registers commands with a LITERAL id, `vscode.commands.registerCommand("t3-vscode.ours.x.y", ...)`, never a const.

### 0.4 The `ours` channel (webview and host)

- Host: src/host/ours/rpc.ts keeps `registerOursRpc(kind, handler)` and `oursRpc(params, viewId)`. It rejects a missing or unknown `kind` (the webview is a trust boundary); each handler validates its own params like `stringParam` (shared/bridge.ts:155). `viewId` comes from his attach (host/bridge.ts:75-82), never from params (comment :87).
- Host to webview: `registry.postWhenReady(viewId, OURS_EVENT, { kind, ...data })`.
- Webview: src/webview/ours/index.ts calls `bridge.on(OURS_EVENT, dispatch)` (bridge-client.ts:76-84 allows several handlers) and offers `registerOursEvent(kind, handler)`.
- Webview to host: `bridge.request<T>(Methods.ours, { kind, ... })` (bridge-client.ts:56-74). Never `useActions()` or `run`: they feed every result into `receive()` as a HostStateSnapshot (App.tsx:35-40).

### 0.5 Composer helper and shared helpers (slice 0; used by A, D, I)

src/host/ours/composer.ts:
- `insertFile(ref: FileReference, viewId?)`: with a `viewId` (I's drop into a known panel): `hostState.composerState(threadId, undefined, true, viewId)` as his :255, then `registry.postWhenReady(viewId, Events.insertReference, { draftKey, reference })` as :256, so that call lives once. Without: `provider.insertReference(ref)` (his path, extension.ts:251-259: focused panel, else `createPanel(SIDEBAR_VIEW_ID)`, then Events.insertReference with `draftKey = activeThreadId ?? "new"`). FileReference: shared/composerContext.ts:7-17; whole file = no range; build it like host/editorReference.ts:6-15 (label relative to the folder with `/`, else the basename). With a range and `text`, his send adds the "Selected range" block and a fenced snapshot (composerContext.ts:170-176).
- `insertText(text)`: target = `registry.focusedViewId` if it is not `SIDEBAR_VIEW_ID` (it only returns chat views, host/bridge.ts:23; the sidebar is added with `acceptsChatFocus = false`, extension.ts:201; no reliance on his `panel_` id prefix), else `await provider.createPanel(SIDEBAR_VIEW_ID)`; `hostState.composerState(threadId, undefined, true, id)` as at :255; post `{ kind: "insertText", draftKey, text }`.
- `isAttachableImage(name, size)`: `isProviderSendTurnSupportedImageMimeType(attachmentMimeType(name))` and size <= 10 MiB (as composerAttachments.ts:78-79). Callers (D row 1, I) check it BEFORE uploading; everything else becomes a reference, so a 20 MiB png is a reference. Needed because `attachmentUploadInput` (shared/composerAttachments.ts:76-83) is not image-only: it accepts any file as type `file` up to 50 MiB, only images stop at 10 MiB, and his `pickAttachments` (host/bridge.ts:146-151) attaches any file.
- `insertAttachments(viewId, paths)`: per local file `attachmentUploadInput` then `hostState.uploadAttachment(basename, "", bytes, viewId, threadId)` (hostState.ts:282), as his pickAttachments does (host/bridge.ts:141-155); post `{ kind: "addAttachments", draftKey, attachments, errors }`.
- Webview side src/webview/ours/composer.ts: insertText = `updateDraft(key, fn, "take-focus")` (composerDrafts.ts:41-48) with `insertComposerReferenceText` (shared/composerAttachments.ts:22-36) at `readDraftSelection(key)` (composerDrafts.ts:16) or the end; addAttachments = `addDraftAttachments(key, list)` (webview/composerAttachments.ts:14-25); both then dispatch the window event `t3-focus-composer` with `{ draftKey, cursor }` as App.tsx:53-57 does. The sidebar has no composer (App.tsx:73, ChatView.tsx:92), so the target is always a panel.
- Focus is lost on first use: in a panel that is still opening, the event fires before Composer mounts its listener (Composer.tsx:191). His reference path survives only through the private `editorFocus` map (composerDrafts.ts:13, :18, :25, read at Composer.tsx:192-193), which ours can reach only through `addEditorReference`. The lead picks one before D and I start: (a) re-dispatch the event on animation frames until a textarea in the panel has focus or 2 s pass; (b) weaken the acceptance of D rows 3, 4, 6, 7 and I's attachment path to "lands in the composer; on first open, focus may need a click".

Also slice 0: src/host/ours/log.ts (our own output channel "T3 VSCode (fork)"; his host has none, grep `createOutputChannel` is empty) and src/host/ours/terminalRuns.ts (last 20 shell-integration runs from `onDidStartTerminalShellExecution`/`onDidEndTerminalShellExecution` and `execution.read()`, 8192 chars each, exit code; legacy context.js:157-164, :406-440; read by A's `terminalOutput` and D's last command).

### 0.6 Commands, settings, menus

- Command id `t3-vscode.ours.<feature>.<verb>`, category "T3 VSCode" (his, package.json:41-110), codicon icons. Registered in the feature's own file. Internal commands get a `commandPalette` entry with `"when": "false"`.
- Each of our configuration sections gets `"order"` 10 or higher (his use 1, 2, 3 at package.json:166, :199, :222); without it ours mix in with his.
- Settings `t3-vscode.ours.<feature>.<name>`, `scope: "window"`, read with `getConfiguration("t3-vscode")`; our own `onDidChangeConfiguration` listener, never his (:125-137).
- Menu group `t3ours` (his is `t3`, package.json:137). Toolbar targets: sidebar `view == t3.webview` (package.json:35), editor tab `activeWebviewPanelId == 't3Panel'` (extension.ts:273).

### 0.7 Tests

- Runner: `tsx --test`, `node:test`, `node:assert/strict` (package.json:306). Slice 0 lands one test (oursRpc rejects an unknown kind) so the new glob matches a file; `pnpm test` must still show his 255 pass, 1 skipped (STATUS.md item 3), plus ours.
- There is NO vscode mock in src/host/testing/. What exists: `FakeTransport` (fakeTransport.ts:11, records `commands`), `harness` (:186) and `viewsHarness` (:190-201) build a real HostState without a server, `FakeWebview` (fakeWebview.ts:6-36), fixtures (activity, turn, scheduledTask). His vscode-using host modules (usageStatusBar.ts, nativeDiff.ts) have no tests; testable ones use `import type * as vscode` plus a lazy `await import("vscode")` (host/bridge.ts:4, :51-54) or `Pick` injection (editorReference.ts:1, :6).
- The test script (package.json:306) never runs src/webview, so the webview holds no parsing logic; parsers live on the host.
- Rule: logic worth a test lives in a file with no value import of vscode; glue that calls the VS Code API stays thin and is checked live. Owner rule: tests only where a section lists one (parsers, security checks); never a test that copies the logic.

### 0.8 Build

- Host: tsdown single entry `src/extension.ts`, ESM, `vscode` external (tsdown.config.ts:6, :16). Webview: vite single entry `src/webview/main.tsx`, IIFE (vite.config.ts:10-17). Ours files are bundled through the imports in 0.3; no config change.
- Typecheck `tsc --noEmit` over src and scripts (tsconfig.json:21) with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly` (no enums, no parameter properties). Host imports end in `.js`; webview imports have no suffix.
- Checks per slice: `pnpm run typecheck`, `pnpm test`, `pnpm run build`.

### 0.9 package.json merge rule

- Insert FIRST, not last: right after the opening `[` or `{`, each of our entries with its own trailing comma. Appending after his last element would turn his closing `}` into `},` (package.json:293 icons, :262 configuration, :160 view/title): an edit of his line, at the exact spot where he appends too. Inserting first touches no line of his. A conflict stays possible only when he edits his first entry in the same merge (adjacent hunks), which is rarer. This replaces "append at the end" in the owner priority; the goal is the same.
- Where:
  - contributes.commands: after :40
  - keybindings: after :112
  - menus.commandPalette: after :127
  - menus.view/title: after :140
  - configuration: after :163, one section object per feature `{ "title": "Fork: <Feature>", "order": 10+, "properties": {...} }` (0.6)
  - new contributes keys (`mcpServerDefinitionProviders`, `taskDefinitions`, `jsonValidation`, `viewsWelcome`): after `"contributes": {` at :21
  - new menu locations (`explorer/context`, `editor/title`, `editor/title/context`, `terminal/context`, `scm/title`; none exist today): after `"menus": {` at :126
- Exception: views.t3-sidebar (:32-38) is appended after his `t3.webview`, because array order is display order and his chat view stays on top. That turns his :37 into `},`, so it is listed in 0.3.
- Never reorder, reformat or edit his entries. Two builders inserting at the same spot still conflict with each other: the lead keeps both sides, in feature-letter order.
- Docs: our feature notes go into a new file docs/ours/FORK-FEATURES.md, not his docs/feature-history.md and not docs/ours/FEATURES.md (that is the old repo's comparison table and stays as it is). Owner question 12.

### 0.10 Merge and install hygiene (plans for files the lead writes; this map does not write them)

- One upstream-merge checklist, kept in docs/UPSTREAM.md and run after each `git merge upstream/main`:
  - the wrapped members still exist with the same parameter order: `notifications.update`, `provider.resolveWebviewView`, `hostState.sendMessage`, `hostState.queueAction` (`action`, `text`), plus the members typed in src/host/ours/types.ts
  - his test glob line (package.json:306) still carries ` src/host/ours/**/*.test.ts`
  - the `ours` key in Methods and the `case "ours"` in host/bridge.ts are still there
  - grep `registerUriHandler` in src (G breaks if he adds one)
  - his `insertReference` flow (extension.ts:251-259), the `Events.insertReference` handler (App.tsx:53-57) and `t3-focus-composer` still behave as 0.5 assumes; I uses no `.composer-box` selector, keep it that way
  - scripts/commands.test.mjs still scans src/host/ours
- t3-facts.json: each feature's "T3 facts relied on" gets an entry in the file's existing `{ id, used, path, grep }` shape, added by the builder of that feature (B: `runtime-request.respond` and the ProviderRequestKind list; C: the run status list; E: the t3.json max and schema URL; F: the `t3code` scheme and the `threads/` link shape; G: none beyond the descriptor). The lead checks each grep against `reference/t3code` before merging the slice.
- Installed build: the owner has `hungtienhuang.t3-vscode-0.1.21` from the Marketplace. The fork keeps that id and, by his rule, that version. A same-version VSIX install, or an auto-update when he publishes 0.1.22, quietly swaps ours out, and the owner's live tests then run his build. Before the first live test: auto-update off for this extension (owner question 15). After each VSIX install, check that the installed build is ours (for example, our output channel "T3 VSCode (fork)" exists).

## A. mcp-bridge

### Goal (owner's terms)
Every agent T3 starts (Claude Code, Codex) can ask THIS VS Code window about itself: folders, active file and selection, open tabs, Problems, git state, extensions, terminal output; and can ask it to open, reveal or diff a file. Registered both through CC Switch and natively (decision 16, docs/ours/HANDOFF.md:68; decision 6, :53; design docs/ours/PIECE2.md).

### Files to create
- src/host/ours/mcp/bridgeSource.ts: `export const BRIDGE_SOURCE = <JSON string>`, generated once from legacy/old-extension/bridge.js (CommonJS, node built-ins only) with JSON.stringify; the source contains backticks and `${`, so not a template literal. It is bundled into dist/extension.mjs, already allowlisted (.vscodeignore:9), so no .vscodeignore edit and no resources/ours file. At activation written to `~/.t3-vscode/bridge.js` when the content differs (legacy context.js:386-389).
- src/host/ours/mcp/server.ts: port of legacy mcp.js (no vscode import). Version from `context.extension.packageJSON.version`, not `require('./package.json')` (mcp.js:5, :65; fails in the ESM bundle).
- src/host/ours/mcp/tools.ts: the ten tools of legacy context.js:237-355 with their caps, the `meta` block (:356-365), the editor tracking that survives focus moving into a webview (:222-235), diagnostics, tabs, git via an untyped `getAPI(1)` behind a small local interface (:116-142), extensions, `terminalOutput` from slice 0 terminalRuns.
- src/host/ours/mcp/actions.ts: `openFile`, `revealInExplorer`, `showDiff`, ported from legacy extension.js:69-130 (`_open`, `_diff`, refuse with a 10 s toast throttle :53-61, 300 ms busy gate :50-51, inside window folders only, context.js:199-206). Called directly; no `_open`/`_diff` commands needed.
- src/host/ours/mcp/discovery.ts: `<HOME>/windows/<exthost pid>.json` `{version:1,pid,port,token,label,workspaceFile,folders,focusedAt,startedAt}`, atomic temp-plus-rename (context.js:44-48, :367-376), rewritten on focus and folder change (:402-405), stale files swept (:379-385), removed on dispose and exit (:532-539). Refuse to start in a remote or virtual window (:392-395).
- src/host/ours/mcp/setup.ts: setup document with the CC Switch JSON and Codex TOML and a "Copy CC Switch entry" button (context.js:483-530); "Add to Claude Code" / "Add to Codex" type the line into a new terminal named T3 with `sendText(line, false)`, never run (:446-451); read-only detection of existing entries, "ours" when the LAST arg equals the bridge path (:169-194); one-time nudge after the first `phase === "ready"` seen through `hostState.onDidChangeState`, "Not now" in globalState (:461-470); VS Code provider (:472-482) through a local narrow type and the runtime guard.
- src/host/ours/mcp/server.test.ts: the loopback rules (421 bad Host, 403 any Origin or Sec-Fetch-Site, 404 path, 405 non-POST, 401 bad bearer, 415, 413), ported from the HTTP part of legacy scripts/selfcheck-mcp.mjs (no vscode stub needed). Security check, so a test is justified.

### His files to touch
None beyond slice 0. Do not name any file `bridge.ts` (his src/host/bridge.ts and src/shared/bridge.ts are the webview RPC bridge).

### package.json contributions
- contributes key `mcpServerDefinitionProviders`: `[{ "id": "t3-vscode.ours.mcp", "label": "T3 VS Code context" }]` (legacy package.json:25-30).
- commands: `t3-vscode.ours.mcp.setup` "Set Up the VS Code Context Server", `.addClaude`, `.addCodex`, `.nudge` (palette `when: false`).
- activationEvents: `onStartupFinished` (landed in slice 0).

### T3 facts relied on
None: the bridge uses no T3 surface (context.js:2, PIECE2.md:23). Inferred from source only, not live: Claude gets T3's own server through `setMcpServers` over stdin and no `settingSources`/`strictMcpConfig`, so user-scope `~/.claude.json` entries load (apps/server ClaudeAdapterV2.ts:686-690, :725-731, :1125-1139); Codex layers thread `mcp_servers` above the user's config.toml (CodexAdapterV2.ts:1311, :1328-1342).

### Acceptance criteria
- The written `~/.t3-vscode/bridge.js` is byte-identical to legacy/old-extension/bridge.js.
- Server name stays `vscode`, path `~/.t3-vscode/bridge.js`, folder `~/.t3-vscode/windows/`, env `T3VSCODE_HOME`: the owner's live entries (`~/.claude.json` user scope `cmd /c node C:/Users/.../.t3-vscode/bridge.js`, `~/.codex/config.toml` `[mcp_servers.vscode]`) work with no edit.
- One window: the discovery file appears with port and token and disappears on window close.
- In a T3 Claude thread rooted in folder X and a Codex thread rooted in Y, `workspace` and `activeFile` return `match: cwd`, the right `cwdFolder`, and the selection text (8192 cap, `truncated: true` beyond) (PIECE2.md:151-152).
- Two windows: the window whose folder holds the cwd answers; no match gives `match: fallback` with a note (decision 10, HANDOFF.md:58). Window closed: a clear error, never another window's answer (PIECE2.md:154).
- `openFile` with a line opens it in window A while B has focus; a path outside the folders is refused (PIECE2.md:158).
- Setup offers CC Switch copy, Add to Claude Code, Add to Codex, and says per harness whether the entry exists (BACKLOG R18).

### Live test for the owner
In a T3 thread on this folder: "call the vscode tools workspace, openTabs, diagnostics and gitState and quote the raw results". Expected: your tabs, your Problems, branch main and the Source Control files.

### Risks and open questions
- `@types/vscode` is 1.100.0 (package.json:335) and lacks `McpStdioServerDefinition` and `lm.registerMcpServerDefinitionProvider` (1.101). Do not bump his devDependency; use a local narrow type plus the legacy runtime guard (context.js:472). Installed VS Code is 1.141.
- `onStartupFinished` makes his `connect(false)` run at every VS Code start in every window: discovery, and when unpaired the t3 pairing flow (hostState.ts:337-359). Owner question 1.
- No `extensionKind: ["ui"]` in his manifest (legacy had it, package.json:12-14): in a remote window the extension runs remotely; the remote refusal above covers it. Owner question 14.
- The VS Code MCP provider id changes from `t3vscode.mcp` (legacy package.json:27) to `t3-vscode.ours.mcp`: VS Code's own MCP list may ask the owner to trust or enable it again. Say so in the live test.
- Bridge runtime `node` on PATH vs `ELECTRON_RUN_AS_NODE` (PIECE2.md:173) undecided; the live entries use `node`. Owner question 6.
- Unverified, never run live: Codex per-key merge of `mcp_servers`, Claude `allowedTools` gating non-T3 MCP tools, the bridge cwd under each harness (PIECE2.md:202-206).

## B. approvals

### Goal (owner's terms)
When a T3 thread of this window waits for an approval, one VS Code notification says which thread, what kind and what command or prompt, with Approve, Deny and Show; clicking answers T3 (decision 15, HANDOFF.md:67; docs/ours/APPROVE.md:63-71).

### Files to create
- src/host/ours/approvals.ts: installs the `notifications.update` wrapper (0.2: `orig(state)` first, our filter in try/catch). Claim, synchronously, every returned thread whose `pendingRuntimeRequest.kind` is one of `command | file-read | file-change | mcp-elicitation | permission` (legacy APPROVABLE, extension.js:41); `user_input`, `dynamic_tool_call`, `auth_refresh` stay in his list and keep his "Open session" toast (extension.ts:69-75). For a claimed thread, async: `client.getThreadProjection(thread.id)` then `derivePendingThreadRequests(projection)` (import `@t3tools/client-runtime/state/thread-requests`, as hostState.ts:19; vendored type vendor/client-runtime/src/state/threadRequests.ts:11-21), find the approval with this `requestId`. Toast "T3: <title> needs approval (<kind>[ from <appName>]): <detail>". Buttons: Approve if the offered options (or the defaults when `options` is absent, PendingRequests.tsx:51-53) contain `accept`, Deny if they contain `decline`, always Show. Not found, not `live`, or no detail: Show only.
- On Approve or Deny: `client.dispatch({ type: "runtime-request.respond", commandId: randomUUID(), threadId, requestId, decision })` (same command his respondToRequest sends, hostState.ts:823). An "in flight" set per request: a second click says "An answer to this request is on its way to T3". Errors that mean already answered (APPROVE.md:70: is resolved, was not found, is expired, is cancelled) show "Already answered in T3"; any other error shows a warning with Retry and Show; never retry by itself (legacy extension.js:653-666).
- Show = `provider.openSession(thread.id)` guarded by `hostState.snapshot().threads.some(t => t.id === id)`, as extension.ts:71-72.
- src/host/ours/approvalText.ts and approvalText.test.ts: pure (request, kind, title) to toast text and buttons. Test: a request whose options lack `accept` gets no Approve button; `not_resumable` gets Show only.

### His files to touch
None beyond slice 0 (the wrapper replaces a 5-line edit of his loop at extension.ts:69-75 that the approvals and statusbar scouts proposed).

### package.json contributions
None required. (A setting to fall back to his toast is not asked for; skip.)

### T3 facts relied on
- `ProviderRequestKind` packages/contracts/src/providerPolicy.ts:38-44; `ProviderApprovalDecision` :50-56; `ProviderApprovalOption {decision,label,warning?}` :59-64.
- `OrchestrationV2RuntimeRequest` (kind, status pending/resolved/expired/cancelled, responseCapability live/message/not_resumable) orchestrationV2.ts:1114-1133; `approval_request` turn item (prompt, appName, options) :1550-1560.
- Commands `runtime-request.respond` :3059-3067 and `thread.user-input.dismiss` :3068-3073. Shell summary carries the NEWEST pending request per thread (apps/server/src/orchestration-v2/ProjectionStore.ts:1425-1431).

### Acceptance criteria
- One toast per request, never two (his "Open session" toast does not appear for a claimed kind).
- Approve or Deny answers T3; the T3 app shows the request answered or declined, his sidebar badge clears.
- Answered elsewhere first: "Already answered in T3". Double click: the "on its way" message. Failure: warning with Retry and Show, no automatic retry.
- Buttons only for offered decisions; `user_input` keeps his toast.
- No bearer token or ticket in our log.

### Live test for the owner
In the T3 app, in this project, ask for something that needs a shell-command approval; switch away from VS Code. Expect one toast with Approve, Deny, Show. Click Deny: T3 shows it declined.

### Risks and open questions
- The claim is decided before the projection arrives (`update` is sync): a claimed request whose projection fails still gets our Show-only toast, never his. Acceptable.
- Bypasses his `enqueue` serialisation (hostState.ts:310-317); fine for one stateless command, T3 refuses a second answer.
- His toast fires always (no away rule); legacy toasted only when away (extension.js:463). Owner question 3.
- `acceptForSession` as a button: owner question 4. Approve when the toast can only show a reason: owner question 5. Both windows on one folder both toast: owner question 7.
- Subagent requests (BACKLOG.md:207 Q4) not checked live. Not checked: whether `secretRequestAsPendingInput` (ProjectionStore.ts:1432+) can surface a summary with no runtime request.

## C. statusbar

### Goal (owner's terms)
Bottom right, next to his usage meters, one item says whether a T3 thread of this window is running or needs me; the T3 sidebar icon shows a badge with the number of threads waiting for me (docs/ours/QOL.md:77, :81; FEATURES.md:73; STATUS.md:37).

### Files to create
- src/host/ours/statusbar.ts: one item `createStatusBarItem("t3-vscode.ours.statusbar", Right, 101)` (101 sits directly left of his first meter at 100, usageStatusBar.ts:38; legacy used 100, extension.js:1110, which would collide), `name` "T3 VSCode Activity". Own listener `hostState.onDidChangeState(update)` (hostState.ts:154; fires at once, sidebar snapshot by default). Badge: through the `provider.resolveWebviewView` wrapper (0.2), set `view.badge = { value, tooltip }` or `undefined` (`WebviewView.badge` exists in @types/vscode 1.100, index.d.ts:10199).
- src/host/ours/activity.ts and activity.test.ts: pure `activity(state)` returning `{ wait, run }` and the text:
  - `live = threads.filter(t => !t.archived && !t.providerNativeSubagent)` (archived threads are in the snapshot, hostState.ts:1112; subagents at :1121-1123)
  - `wait = live.filter(t => t.pendingRuntimeRequest)`
  - `run = live.filter(t => !t.pendingRuntimeRequest && (threadIsWorking(t) || t.status === "queued"))`, `threadIsWorking` from shared/sessionTree.ts:40-42. "queued" is added HERE because his RUNNING_STATUSES (:34) omits it; do not edit his file.
  - Text: `$(warning) T3: needs you` with `statusBarItem.warningBackground`; else `$(sync~spin) T3: running` or `T3: N running`; else hidden. Phase not ready: "T3: not running" (`no-server`/`error`, click `t3.webview.focus`) or "T3: not paired" (`pairing`, click `t3-vscode.pair`) (legacy R8, extension.js:232-235). Phases: shared/bridge.ts:48.
  - Tooltip: one line per thread "<title>: waits for you" or "running", built with `MarkdownString.appendText` (titles escaped).
  - Test: a thread with both a pending request and a running status counts as waiting only; an archived one counts nowhere.
- Click: one waiting thread opens it (`provider.openSession`, command `t3-vscode.ours.statusbar.open`); otherwise `t3-vscode.showThreads` (his, extension.ts:88).

### His files to touch
None beyond slice 0 (replaces the 4-line edit of extension.ts:56-79 and the updateTitles line :209 the statusbar scout proposed).

### package.json contributions
- commands: `t3-vscode.ours.statusbar.open` (palette `when: false`).
- activationEvents `onStartupFinished` (slice 0) makes the item exist before the view is opened (legacy B7, BACKLOG.md:27).

### T3 facts relied on
- `OrchestrationV2RunStatus` includes "queued" (orchestrationV2.ts:455-466, :457); `OrchestrationV2ShellThreadStatus` = "idle" or a run status (:1904-1907); `activityRunStatus` only preparing/starting/running/waiting (:1957-1959).
- T3's own pill precedence: Pending Approval, Awaiting Input, Working, Connecting (incl. queued), ... (apps/web/src/components/Sidebar.logic.ts:1179-1250).

### Acceptance criteria
- Running thread: spinner text within one state push (shell updates are pushed, hostState.ts:367, :389-392; no polling needed). Waiting thread: warning text and background, badge with the count.
- Idle: item hidden; his meters unchanged and still in place.
- Works after a VS Code start before the T3 view was opened (the item; the badge needs the view resolved once).
- T3 down or unpaired shows the matching text and click.

### Live test for the owner
Send "count to 20 slowly" in a T3 chat. Bottom right shows "T3: running" with a spinner, then disappears when done; hover names the thread.

### Risks and open questions
- One extra `snapshot()` per emit for our listener (snapshot maps the active transcript, hostState.ts:1138). If profiling shows cost, read the state handed to the B wrapper instead.
- Legacy extras need fields his ThreadSummary lacks (hasActionableProposedPlan, unread, usage limit; orchestrationV2.ts:1950, :1961-1963, :1972, :2008): adding them touches his mapping (hostState.ts:1109-1129). Not in this port.
- Possible way without the `resolveWebviewView` wrapper: if owner question 10 is yes, I's TreeView also has `badge` (@types/vscode index.d.ts:12140). If a view badge shows on the activity bar icon (verify live), set the count there and drop the wrapper; the badge then exists only while that view exists. Unverified.
- Owner question 8 (subagents, queued, badge while focused); owner question 9 (finished/failed/limit toasts from legacy FEATURES.md:74).

## D. add-to-prompt (all seven entry points)

### Goal (owner's terms)
Put things from VS Code into the T3 chat box without typing: files, a selection, terminal text, the last command, a TODO, a Problem, my uncommitted changes. Never sends by itself (BACKLOG.md:46 B21). All seven end in his composer insert (STATUS.md:37), through the slice 0 helper (0.5).

### Files to create
src/host/ours/prompt.ts (commands and providers) and src/host/ours/promptText.ts with promptText.test.ts (pure: TODO regex, fence builder, ANSI strip, 4000-char tail). One row per entry point:

| # | Entry point | Command / provider | Ends in |
|---|---|---|---|
| 1 | Explorer, tab menu, multi-select, palette | `t3-vscode.ours.prompt.addFiles(uri, uris)`: uris (max 50), else uri, else the active editor, else "Open a file first." (legacy extension.js:1091-1096) | `isAttachableImage` true (0.5, checked before upload): `insertAttachments`; everything else (folders, a 20 MiB png): `insertFile` whole-file reference |
| 2 | Alt+K selection, editor right-click | HIS `t3-vscode.insertReference` (package.json:113-124, :133-138; extension.ts:102-107). Nothing to build | his `@label:a-b` with snapshot |
| 3 | Terminal selection | `t3-vscode.ours.prompt.addTerminalSelection`: save clipboard, clear, `workbench.action.terminal.copySelection`, read, restore; empty: "Select text in the terminal first." (extension.js:1061-1069) | `insertText` fenced, max 4000 |
| 4 | Last command | `t3-vscode.ours.prompt.addLastCommand`: newest run of the active terminal, else any (slice 0 terminalRuns); none: "No command recorded yet (shell integration needed)" (context.js:453-460) | `insertText` fence with `$ <command>`, output ANSI-stripped (:167), last 4000, `exit N` if non-zero |
| 5 | TODO lens | CodeLensProvider on `file`, regex legacy extension.js:188, max 50 lenses, files under 200 KB, "Implement with T3" (:187-202) | `insertFile` with the TODO line as range and text |
| 6 | Fix with T3 | CodeActionProvider on `file`, max 3 per spot, "Fix with T3: <message, 60 chars>" (:1156-1161), runs `t3-vscode.ours.prompt.fix(uri, range, message, source)` | `insertFile` (diagnostic range, snapshot), then `insertText` "<message> (<source>)" |
| 7 | Review changes | `t3-vscode.ours.prompt.reviewChanges` (:1076-1079) | `insertText` "Review my uncommitted changes in this repository." |

### His files to touch
None beyond slice 0. His insertReference ignores arguments (extension.ts:102-107), so Explorer and tab menus need our own command; do not change his.

### package.json contributions
- commands: the six `t3-vscode.ours.prompt.*` above (fix: palette `when: false`).
- menus: `explorer/context` and `editor/title/context` addFiles; `terminal/context` addTerminalSelection (`when: terminalTextSelected`) and addLastCommand; `scm/title` reviewChanges (`when: scmProvider == git`); group `t3ours`. None of these locations exists in his manifest.
- configuration "Fork: Add to prompt": `t3-vscode.ours.prompt.todoLens` boolean, default true.

### T3 facts relied on
None on the server for text. Attachment limits: image types gif/jpeg/png/webp, image max 10 MiB, file max 50 MiB, at most 100 (packages/contracts/src/chatAttachment.ts:14-22; vendored copy identical, vendor/contracts/src/chatAttachment.ts:13-35).

### Acceptance criteria
- Each entry point lands in the focused chat tab, or opens one (his rule, extension.ts:251-259), puts focus in the composer (on first open, per the lead's pick in 0.5) and sends nothing.
- First use with no panel open still lands (queued by `postWhenReady`, host/bridge.ts:28-37; BACKLOG R1).
- Several Explorer files all go in; a png goes in as an attachment chip; a 20 MiB png as a reference.
- Turning the TODO setting off removes the lenses at once.

### Live test for the owner
Right-click README.md in the Explorer, "Add to T3 Prompt": a reference shows in the chat box. Then select text in a terminal, right-click, "Add Terminal Selection to T3 Prompt": a code block shows.

### Risks and open questions
- Reference format: his `@label` token that becomes `[@label](uri#Lx-Ly)` on send (composerContext.ts:109-148) instead of legacy `[name](path) lines a-b` (extension.js:204-213). Owner question 2.
- The terminal clipboard dance overwrites the clipboard for a moment; `terminalTextSelected` context key not verified. `Terminal.selection` is not in @types/vscode 1.100 (installed VS Code 1.141): if it is a stable API in 1.141, a runtime guard (`"selection" in terminal`) can replace the dance; if it is still proposed, it is absent at run time and the dance stays. Unverified; default: keep the dance.

## E. tasks

### Goal (owner's terms)
The scripts in a folder's `t3.json` show up in "Tasks: Run Task" under T3 and run in a VS Code terminal in that folder, like T3 runs them (BACKLOG.md:131 R21).

### Files to create
- src/host/ours/tasks.ts: `vscode.tasks.registerTaskProvider("t3", { provideTasks, resolveTask: () => undefined })`. Per local workspace folder with a `t3.json` (skip over 256 KB): parse with the vendored `parseT3ProjectFile` (`@t3tools/shared/t3ProjectFile`, vendor/shared/package.json:146-148; lenient JSONC, null when invalid). A file with more than 50 scripts fails the vendored schema (`isMaxLength(50)`, vendor/contracts/src/t3ProjectFile.ts:101), so it decodes to null and lists nothing (it is not trimmed); log one line naming the limit; `new Task({ type: "t3", script: name }, folder, name, "T3", new ShellExecution(command, { cwd: folder, env: { T3CODE_PROJECT_ROOT: folder } }))`; detail "t3.json (scripts kept only in T3's settings are not listed): <command>" (port of legacy extension.js:950-973, fixing its two gaps: JSON.parse on JSONC, no env).

### His files to touch
None beyond slice 0.

### package.json contributions
- contributes key `taskDefinitions`: `[{ "type": "t3", "required": ["script"], "properties": { "script": { "type": "string", "description": "Script name in t3.json" } } }]` (legacy package.json:192-204).
- contributes key `jsonValidation`: `[{ "fileMatch": "t3.json", "url": "https://t3.codes/schema/t3.json" }]` (R11). Owner question 11.

### T3 facts relied on
- File `t3.json` at the workspace root, schema URL, max 50 scripts: packages/contracts/src/t3ProjectFile.ts:9, :12, :15; script fields name/command (trimmed, non-empty) :28-34, optional icon, runOnWorktreeCreate, runOnSettle (:46-51), async, previewUrl, autoOpenPreview.
- Lenient JSONC parse: packages/shared/src/t3ProjectFile.ts:12, :21-24. Env var: `projectScriptRuntimeEnv` packages/shared/src/projectScripts.ts:58-71 (also `T3CODE_WORKTREE_PATH` in a worktree). T3 runs with `cwd = gitCwd ?? workspaceRoot` and writes `command + "\r"` into a terminal (apps/web/src/components/ChatView.tsx:5010, :5082).
- T3 itself runs scripts from server settings or `project.scripts`, not from the file (projectScripts.ts:17-27; the file only feeds an import menu, useT3ProjectFileScripts.ts:55-65). Hence the detail text.

### Acceptance criteria
- "Tasks: Run Task" lists source T3 with one entry per script; running one runs its command in a terminal at the folder.
- A `t3.json` with comments and trailing commas works; an invalid one, or one with 51 or more scripts, lists nothing and logs one line.
- `{ "type": "t3", "script": "<name>" }` in tasks.json matches the task.

### Live test for the owner
In a folder whose t3.json has a script: Ctrl+Shift+P, "Tasks: Run Task", "T3", pick the script. A terminal runs it in that folder.

### Risks and open questions
- Unverified: does the vendored (0.0.45) schema accept the nightly key `runOnSettle` (Effect Schema excess-key default)? Test once with a real file; the re-vendor (J) removes the doubt.
- The task provider exists only after activation. If owner question 1 is no, E needs `workspaceContains:t3.json` in activationEvents; whether VS Code activates an extension for a task type by itself is unverified.
- Name clash: his sidebar "Tasks" tab means T3 scheduled tasks (docs/user-guide.md:34, :128-132); our source label stays "T3".

## F. desktop-app

### Goal (owner's terms)
One click brings the T3 desktop app to the front on the same thread I have open in VS Code (docs/ours/QOL.md:85-91).

### Files to create
- src/host/ours/desktop.ts: command `t3-vscode.ours.desktop.open`: `state = hostState.snapshot(registry.focusedViewId)`; link `t3code://threads/<enc(environment.environmentId)>/<enc(activeThreadId)>`, or `t3code://new` with no thread; `vscode.env.openExternal`; if it returns false: "The T3 app did not take the link. Is T3 Code installed?" (legacy extension.js:1012-1021, R17).

### His files to touch
None beyond slice 0. (An in-chat button next to his globe at ChatView.tsx:76 would touch his file; skip.)

### package.json contributions
- commands: `t3-vscode.ours.desktop.open` "Open This Thread in the T3 App", icon `$(link-external)`.
- menus: `view/title` `when: view == t3.webview`, group `navigation@5` (his globe is `navigation@4`, package.json:159); `editor/title` `when: activeWebviewPanelId == 't3Panel'`, group `navigation`.

### T3 facts relied on
- Link shapes `t3code://threads/<environmentId>/<threadId>` and `t3code://new` (packages/shared/src/promptLinks.ts:14), scheme regex :215, app path mapping :223-242, builder `promptLinkDeepLink` :245-249. Production scheme `t3code` (apps/desktop/src/electron/ElectronProtocol.ts:16; `t3code-dev` :17).
- Received from argv and `second-instance` (apps/desktop/src/app/DesktopClerk.ts:192-200, :222-228). This supersedes HANDOFF.md:111 and :297 ("no desktop deep link").

### Acceptance criteria
- With a thread open: the app comes to the front on that thread. Without: the app opens its new-thread page. `openExternal` returns false: the warning. On Windows an unregistered scheme likely shows the OS "pick an app" dialog and returns true, so the warning probably never shows there (unverified).

### Live test for the owner
With a thread open in the chat, click the new "open in app" icon in the T3 view title. The T3 app comes to the front on that thread (allow the t3code link if VS Code asks).

### Risks and open questions
- Unverified live: is the descriptor `environmentId` (hostState.ts:1102) the id the desktop app routes on? `webUiUrl` already builds `/<environmentId>/<threadId>` with it (hostState.ts:1242-1253), which supports it.
- Windows scheme registration is not in the nightly source (protocols only in mac/linux builder configs, scripts/build-desktop-artifact.ts:2841, :2908); only a registry read of 2026-10-12 shows `HKCU\Software\Classes\t3code` (QOL.md:87).

## G. deep-links

### Goal (owner's terms)
A link `vscode://hungtienhuang.t3-vscode/thread/<environmentId>/<threadId>` opens that thread in VS Code's T3 chat, even when VS Code or the chat was closed; a command copies such a link (BACKLOG.md:33 B13, :132 R22).

### Files to create
- src/host/ours/links.ts: `vscode.window.registerUriHandler({ handleUri })`. Path regex `^/thread/([^/]+)/([^/]+)$`, `decodeURIComponent`, thread id `^[A-Za-z0-9_-]{1,80}$` (legacy extension.js:37, :1146-1155). Wait for `phase === "ready"` with `hostState.onDidChangeState` (fires at once); then require `env === snapshot().environment?.environmentId` and the thread in `snapshot().threads`; then `provider.openSession(id)`. Malformed path: one log line, nothing opens. Wrong environment or unknown thread: a visible `showWarningMessage` ("This T3 thread is not in this window.") plus a log line, because VS Code hands the link to one window only and a thread of another folder's window would otherwise fail silently.
- Command `t3-vscode.ours.links.copy`: `${vscode.env.uriScheme}://${context.extension.id}/thread/<env>/<id>` to the clipboard, "Link copied."; no thread: "No thread open." (legacy :1022-1028 used a literal id).
- src/host/ours/linkParse.ts and linkParse.test.ts: the pure path parse and id check (a parser at a trust boundary).

### His files to touch
None beyond slice 0 (`onUri` is in the slice 0 activationEvents line).

### package.json contributions
- commands: `t3-vscode.ours.links.copy` "Copy Link to This Thread". menus `view/title` (`view == t3.webview`, group `1_thread`).

### T3 facts relied on
None beyond the descriptor `environmentId` (his hostState.ts:1102). T3's web route `/<environmentId>/<threadId>` (apps/web/src/routes/_chat.$environmentId.$threadId.tsx) is the same pair.

### Acceptance criteria
- A link to a thread of this window opens it; a cold link waits for the connection instead of being dropped (BACKLOG R1).
- A malformed path opens nothing and logs one line; a wrong environment or unknown thread opens nothing and shows the warning.
- Insiders builds `vscode-insiders://`.

### Live test for the owner
"Copy Link to This Thread", switch to another thread, Win+R, paste, Enter. VS Code shows the copied thread (VS Code may ask once whether to let the extension open the link; unverified).

### Risks and open questions
- `registerUriHandler` is once per extension: if he ever adds one, ours throws at activation. Check on every merge (grep `registerUriHandler`).

## H. save-on-send

### Goal (owner's terms)
When I send a prompt, my unsaved edits are saved first, so the agent reads what I see (BACKLOG.md:43 B18, :170 R29; FEATURES.md:40).

### Files to create
- src/host/ours/saveOnSend.ts: the `hostState.sendMessage` and `hostState.queueAction` wrappers (0.2; queueAction only when `action === "edit"`, the only action that carries text, hostState.ts:1013-1015; `steer` at :1009-1011 promotes an already queued run without text, and steering with new text goes through `sendMessage` mode steer, which the sendMessage wrapper covers). If `t3-vscode.ours.saveOnSend.enabled`: count `workspace.textDocuments` that are dirty and not untitled; if any, `await vscode.workspace.saveAll(false)` (untitled stay unsaved); log "Saved N file(s) before T3 sent the prompt" (legacy extension.js:176-185). A false result or an error: log and a warning toast, then send anyway (owner question 13).

### His files to touch
None beyond slice 0. The wrapper runs before his `enqueue`, so the save lands before `captureTurnBaseline` (hostState.ts:657-661), which snapshots the files on disk for his turn diff (turnBaseline.ts:13-14). A save after the baseline would count my edits as agent changes.

### package.json contributions
- configuration "Fork: Save on send": `t3-vscode.ours.saveOnSend.enabled` boolean, default true.

### T3 facts relied on
None.

### Acceptance criteria
- A dirty file is saved before the message is dispatched; untitled files stay unsaved; setting off: nothing saved.
- The turn diff of the reply does not contain my own unsaved edit.

### Live test for the owner
Type one character in a file without saving, send any prompt. The dirty dot disappears before the reply starts, and the reply's diff does not list that file.

### Risks and open questions
- Not covered: `forkFromResponse` (:860) and `runScheduledTask` (:1234); neither sends my text from the composer.

## I. drag-drop

### Goal (owner's terms)
Drag a file from the VS Code Explorer or a tab onto the chat box and it goes in: a reference, or an image as an attachment; a hint tells me to hold Shift; a "Drop files here" view takes a drag without Shift (STATUS.md:38; QOL.md item 1; SWITCH.md section 0). The owner's top pain.

### Files to create
- src/webview/ours/drop.ts (imported by src/webview/ours/index.ts): `dragover`/`drop` listeners on `window` in the CAPTURE phase, only in a panel document (`body.dataset.surface !== "sidebar"`). Act only when the types lack `Files` and carry `application/vnd.code.uri-list`, or `text/plain` drive paths (`^[A-Za-z]:[\/]`); then `preventDefault`, `dropEffect = "copy"`. Send the raw strings, `bridge.request(Methods.ours, { kind: "dropUris", uriList, text })`; the host parses them once (the test script never runs src/webview). The webview keeps only the `dataTransfer.types` filter; log `dataTransfer.types` live once before relying on it (if a VS Code Explorer drag also carries `Files`, the filter skips it). OS file drops (type `Files`) are left to his handler (Composer.tsx:290). Shift hint: dragenter then a dragleave without `relatedTarget` within 500 ms shows "Hold Shift while dragging files into T3 Code.", once per 5 s (legacy panel.js:208-221).
- src/host/ours/drop.ts: rpc `dropUris` (validates: strings, size cap) calls `dropParse`; `isAttachableImage` files through `insertAttachments(viewId, ...)`, the rest as whole-file references through `insertFile(ref, viewId)` (0.5, which calls `composerState` first as his extension.ts:255, then posts to THAT view). TreeView `t3-vscode.ours.drop.view` via `createTreeView` with a TreeDataProvider that returns no items, and a `TreeDragAndDropController` with `dropMimeTypes: ["text/uri-list"]` whose `handleDrop` accepts `target === undefined` (a drop on empty space), routing to `insertFile`/`insertAttachments` of the focused chat.
- src/host/ours/dropParse.ts and dropParse.test.ts: the only parser (a parser of outside input): uri-list, else text/plain lines, skip `#` lines, max 50 lines of 2000 chars (legacy t3.js:647-681), `file` scheme or drive path.

### His files to touch
None beyond slice 0 (a window capture listener replaces an edit of his composer-box handler at Composer.tsx:290; no `.composer-box` selector). The views line package.json:37 is the slice 0 touch in 0.3.

### package.json contributions
- views `t3-sidebar` (after his `t3.webview`, package.json:32-38, the 0.9 exception): `{ "id": "t3-vscode.ours.drop.view", "name": "Drop files here" }`. Owner question 10.
- contributes key `viewsWelcome` (0.9): `[{ "view": "t3-vscode.ours.drop.view", "contents": "Drop files here to add them to the T3 prompt." }]`; without it the empty tree shows nothing.

### T3 facts relied on
- Limits as D (chatAttachment.ts:14-22). T3's own web drop checks only `Files` (workspaceFileDrop.ts:26); its mention drag type does not apply here.

### Acceptance criteria
- Shift+drag of README.md from the Explorer onto the chat: a reference. Shift+drag of a png up to 10 MiB: an attachment chip. A Windows Explorer file drop works as before.
- A drag without Shift shows the hint, or lands on "Drop files here".

### Live test for the owner
Hold Shift, drag README.md from the Explorer onto the chat box, release: a reference shows. Drag it without Shift onto "Drop files here": the same.

### Risks and open questions
- Never seen working: VS Code blocks every webview drag unless Shift is held (QOL.md:14); nobody checked that the Shift-drag reaches his webview document, nor a TreeView drop with Explorer `text/uri-list`. The owner's hand is the test (SWITCH.md:68).

## J. re-vendor

Why: the nightly's new turn item `secret_request` breaks his pinned decoder for any thread that contains one (VENDOR-DRIFT.md section d); handshake protocol 2 unchanged. Own worktree, own slice, after slice 0 (VENDOR-DRIFT.md section e).
1. Pin `reference/t3code` at 107f6024ea47 (`v0.0.46-nightly.20261014.3093`); rsync contracts, shared (without `/testing/`) and client-runtime `src/` with `*.test.ts` excluded, copy the three package.json and LICENSE (vendor/README.md "Syncing from upstream"). Leave out `reviewGuideTour.ts` and `sourceControlClients.ts` (they pull seven source-control packages).
2. Re-apply README steps 1-5 by hand: drop devDependencies; resolve `catalog:` versions; add the adapter subpaths `./rpc/session`, `./rpc/http`, `./connection/model`, `./state/thread-history-merge`, `./state/server-config-projection`; the scheduled-task adapter in contracts/src/scheduledTask.ts.
3. His Windows shell fix (commit 5cc6a77): the nightly still has `command: escapeWindowsShellArg(resolvedCommand)` at packages/shared/src/shell.ts:784. Replace it with his form (vendor/shared/src/shell.ts:710-712): `command: resolvedCommand.replace(WINDOWS_SHELL_META_CHARS, "^$1")` with his two comment lines. src/host/pairing.test.ts covers it.
4. Effect `4.0.0-rc.115` to `4.0.2` in the three vendor package.json and the root: `effect/unstable/http` to `effect/http` in src/host/pairing.ts:14, serverDiscovery.ts:14, t3Client.ts:25; `effect/unstable/socket/Socket` to `effect/socket/Socket` in t3Client.ts:26 (the nightly paths, e.g. packages/client-runtime/src/rpc/http.ts:18).
5. Delete `client-runtime/src/remotePerformance.bench.ts` if it breaks typecheck; update the provenance block; re-run the README greps.
Files touched: vendor/**, package.json (effect), pnpm-lock.yaml, the three host files above, vendor/README.md, docs/UPSTREAM.md (entry). Checks: `pnpm install`, typecheck, `pnpm test` (255 pass, 1 skipped, plus ours), build, a live thread that contains a `secret_request` item, Windows pairing. Upstream merge rule: take his vendor/ wholesale, then re-apply this re-vendor if his pin is older (STATUS.md item 4).

## Open questions for the owner (default the lead takes if unanswered)

1. Start at VS Code startup (`onStartupFinished`)? His connect, and pairing when unpaired, then runs at every start in every window. Default: yes (A, C and E need it). If no: E needs `workspaceContains:t3.json`, and A and C start only when the T3 view opens.
2. Reference format for D and I: his `@file:a-b` token or the old markdown link? Default: his.
3. Approval toast only when I am away from VS Code, or always? Default: always, like his toast.
4. "Allow this session" (`acceptForSession`) as a toast button? Default: no; Approve = accept, Deny = decline.
5. Approve from a toast that shows only a reason, not the command? Default: no, Show only.
6. Bridge runtime: `node` on PATH or VS Code's own Node? Default: `node` (the live entries use it).
7. Two windows on one folder: both toast an approval? Default: yes; the second click says "Already answered in T3".
8. Status bar: count provider subagents, count "queued" as running, zero the badge while VS Code is focused? Default: no, yes, no.
9. Legacy "finished / failed / usage limit / plan to review" toasts? Default: not now (backlog).
10. Add a "Drop files here" view under his T3 sidebar (it splits that sidebar)? Default: yes.
11. t3.json schema validation (`jsonValidation`)? Default: yes.
12. Our feature notes in a new docs/ours/FORK-FEATURES.md instead of his docs/feature-history.md? (docs/ours/FEATURES.md is the old repo's comparison table and stays as it is.) Default: yes (merge-safe).
13. A save that fails before a send: still send? Default: send, with a warning.
14. Mark the extension UI-side (`extensionKind: ["ui"]`) for remote windows? Default: no (touches his manifest; A refuses remote windows itself).
15. Turn off auto-update for the Marketplace extension `hungtienhuang.t3-vscode` (installed 0.1.21, same id and version as the fork), so his next release does not replace our build? Default: yes; the lead checks the installed build after each VSIX install (0.10).
