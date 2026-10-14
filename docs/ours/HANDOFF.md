# Handoff: T3 Code inside VS Code

Written 2026-10-11 at the end of the first scoping session, updated 2026-10-12 with a second research round. Round 1 was read from GitHub or from a T3 Code source clone of 2026-10-09 (`ec80933a`). Citations added on 2026-10-12 point to `reference/t3code` at `d07a07f3`, the same commit as the live nightly `.2994`; their line numbers are against that commit. **A scaffold is built and its offline self-checks pass (section 6). It has run inside an isolated VS Code profile with a real bearer (2026-10-12, section 5 question 2); the owner has not used the real panel yet.** Treat every claim marked "unverified" as a hypothesis to check against the live nightly first.

## 1. What the owner wants

- The owner uses **T3 Code nightly** daily and likes how it works: threads, orchestration, all the harnesses (Claude, Codex, Cursor, OpenCode, Pi, ...), remote control from the phone.
- What T3 lacks for them is the developer UI of VS Code: **`.code-workspace` multi-root workspaces**, the Explorer tree, folder navigation, source control view. T3 is deliberately minimal.
- Goal: **VS Code is the IDE. T3 keeps running in the background on the PC.** Inside VS Code there is a T3 chat that:
  - uses every T3 feature unchanged (threads, orchestration, harnesses, remote access from the phone),
  - understands the VS Code side: the workspace and its folders, the open file, the selection, errors.
- Constraints from the owner:
  - stays on nightly, so **T3 itself cannot be modified** (no fork, no patch);
  - no overengineering;
  - "we still have to try it at least": a working first slice matters more than a perfect design.

### 1.1 What "integrated" means (owner, 2026-10-11, late evening)

The bar is the Claude Code and Codex extensions for VS Code. The owner wants a T3 chat in VS Code that feels like those, with T3's features behind it:

- The chat window is T3, nearly all its functions and navigation, connected to the T3 backend on the PC, so the phone still controls it.
- Click a file or link in the T3 chat: it opens in VS Code as a normal editor tab, and the Explorer jumps to that file and selects it. Not in T3's own viewer, not "in a weird way".
- T3 (the agents it runs) understands VS Code: the file tree, the open file, the selection, source control, what is installed, which options exist. Basic facts about the IDE it sits in.
- Everything else Claude Code and Codex do as VS Code extensions is the checklist to compare against. That comparison is not done yet; it is the first task of the build phase.

The spike in `docs/PLAN.md` is the first brick, not the product. This table maps each wish to a mechanism and says how sure we are:

| Wish | Mechanism | Piece | Confidence |
|---|---|---|---|
| T3 chat with all its features, same backend, phone still works | T3's own served web page in a VS Code panel | 1 | High once the sign-in test passes |
| Click a file link in the chat, it opens in VS Code | A plain click opens T3's own file preview panel, never the editor (`apps/web/src/components/ChatMarkdown.tsx:2226-2237`). Only Ctrl+click and the right-click menus (`Open in <editor>`, `Open with`, Reveal) run T3's editor command, and only when the page origin is loopback (127.0.0.1, ::1, localhost) and the session has `orchestration:operate` (`ChatMarkdown.tsx:2346-2351`, `apps/web/src/remoteOpen.ts:73-84`, `apps/web/src/fileContextMenu.ts:79-108`). A forwarder on 127.0.0.1 passes the loopback gate | 1 | Low for plain clicks (see decision 1). Medium for Ctrl+click and the menus; Windows bug #14624 for nested files |
| Click a file in the chat, the Explorer reveals and selects it | T3 has no custom URI target: its editor list is fixed (`packages/contracts/src/editor.ts:28-163`), and the only `vscode://` URL it builds is SSH-remote, for non-loopback browsers (`editor.ts:199-235`). So the `vscode://t3-vscode/...` handler idea is dead. What remains is a listener on our side that reveals any file VS Code just opened. On Windows T3 runs `cmd.exe /d /s /c "code.cmd" "--goto" "<path>:<line>:<col>"`, detached (`apps/server/src/process/externalLauncher.ts:742-752`, `packages/shared/src/shell.ts:786-796`) | 2 | Medium: only for the clicks that reach the editor (row above). Which window `code --goto` picks when several VS Code windows are open is untested |
| Open a thread by URL | Answered: the web build uses path routes, so a thread is `/<environmentId>/<threadId>` (`apps/web/src/main.tsx:21`, `apps/web/src/routes/_chat.$environmentId.$threadId.tsx:5`). The desktop app has no thread deep link (section 5, question 4) | 1 | High for the page in our panel. Unverified that the route's id equals the descriptor's `environmentId` |
| VS Code follows the agent: edited files open, the diff shows, the Explorer highlights | VS Code watches the thread through `/mcp` and git, then opens and reveals files itself | 3 | High, no T3 change needed |
| Approvals as VS Code prompts, running threads in the status bar | Poll `GET /api/orchestration/shell` (thread status, pending request) with the pairing bearer; `/mcp` only for actions such as `t3_pending_request_respond` (section 5, question 6) | 3 | High, but `/mcp` needs a second credential (section 4) |
| Agents know the workspace, open file, selection, errors, source control, installed extensions | Our small MCP server that every agent T3 starts can call | 2 | High, T3-independent |
| Click a file in the Explorer, T3 jumps to it | Needs a way to drive T3's UI from outside | none | Low: a thread can be opened by URL (question 4), but no route opens a file inside T3. Would need upstream |

Two ways to learn what the owner clicked inside T3's frame: (a) rely on T3's own "Open in editor" action only, nightly-safe but limited to the clicks T3 routes there; (b) the forwarder adds one small script to T3's page in transit, which watches clicks and messages VS Code. T3 on disk stays untouched, but the script depends on T3's page structure and will rot with nightly, as VSmux's did.

Finding of 2026-10-12: option (a) never sees a plain click, because a plain click stays in T3's preview panel. Only (b) catches plain clicks. See decision 1.

### 1.2 Decisions (owner, 2026-10-12)

1. **File clicks.** A plain website wrapper is not enough. Use T3's "Open in editor" action as the entry point, but our extension must handle what happens next well: the file opens in a VS Code editor tab, the Explorer reveals and selects it, and focus lands in the right window. If T3's action alone behaves badly, we fix it on our side, never in T3. Ideas to check first: a `vscode://t3-vscode/...` URI handler as the editor command, so T3 hands the file to our extension instead of to a bare `code --goto`; and a listener on the active editor that reveals the file in the Explorer after T3 opened it.
   - **Finding (2026-10-12, from source):** plain clicks on a file chip never reach the editor. They open T3's own preview panel. Only Ctrl+click and the right-click menus run the editor command (section 1.1 table). The `vscode://t3-vscode/...` idea is dead: T3 has no custom URI target. The active-editor listener still works for every click that does reach VS Code.
   - **Decided 2026-10-12 afternoon: position B, done smartly.** The forwarder injects one small script into T3's page. It hooks file chips and links by their meaning (the path they carry, their link role), never by styling classes, so small nightly changes do not break it; a major T3 redesign may, and then a thread fixes it. Plain clicks on files open the file in VS Code and reveal it in the Explorer. The same script hides the "Nightly needs the beta mobile app" box, which the owner wants gone. With this, T3's "Open in" picker stops mattering inside VS Code (decision 5 hint goes away). Design: `docs/INJECT.md`.
   - **Also decided: stable forwarder origin.** The forwarder keeps one port per VS Code install (stored in globalState, random fallback when taken), so T3's per-origin localStorage (dismissed boxes, editor choice) survives a panel reload.
2. **Placement.** Exactly like Claude Code, Codex and Claude show today: a side panel view, not an editor tab. The spike may prove sign-in in an editor tab if that is faster, but the product lives in a side panel from the first usable version.
3. **Permissions.** Default to the full pairing scopes (edit everything). Add an extension setting for the scopes later; the default stays "all".
4. **Starting T3.** The extension may start the T3 desktop app, but only after the owner presses a button. Never auto-start when VS Code opens.
5. **Editor choice in T3** (corrected 2026-10-12). T3 has no "Open in editor" settings page. The choice is a per-origin browser localStorage value, `t3code:last-editor` (`apps/web/src/editorPreferences.ts:22`), written when the owner picks an editor in the "Open in" picker (`apps/web/src/components/chat/OpenInPicker.tsx:240`, `:277`). The picker sits in the thread toolbar (`ThreadDetailsPanel.tsx:121-122`) and in the file preview (`FilePreviewPanel.tsx:1276-1282`). With nothing stored, T3 takes the first available editor in its fixed order and saves it (`editorPreferences.ts:51-66`). Cursor comes before vscode in that order (`packages/contracts/src/editor.ts:30`, `:41`), so with Cursor installed the default is Cursor. The forwarder origin is a new origin, so it starts with an empty value, separate from the desktop app. Our extension cannot write T3's settings (hard rule), but it must handle every state well: value missing, set to VS Code, or set to another editor. We cannot read the value from outside T3's page without the injected script of decision 1, position B. Show a one-time hint that points at the "Open in" picker, not at a settings page, and still behave sensibly when the owner leaves another editor selected. File-click handling must not depend on this one value being right.
6. **MCP registration for Piece 2.** The owner registers our MCP server through CC Switch (not done as of 2026-10-12 afternoon; the command "T3: Show MCP setup" gives the entry). The extension must make this easy: show the exact entry, a copy button, and an "add to Claude Code / Codex / other" helper for people who do not use CC Switch.
7. **Commits.** Commit regularly, not after every tiny change. Claude decides the cadence: one commit per step that passes its check, and one when a day ends with work in progress.
8. **Session renewal (2026-10-12, after the first live test).** A pairing becomes a fixed 30-day session; T3 has no refresh and no sliding expiry. The extension renews itself when its session carries the "Manage access" scope (`access:write`): a few days before expiry it mints its own next pairing link (`POST /api/auth/pairing-token`), exchanges it and stores the new session. Without that scope it cannot renew, so it reminds the owner a few days before expiry with a "Pair again" button that runs the pairing input (paste a new link from T3 Settings, Connections). The scope decides; no setting. Check when VS Code starts and once a day. After a renewal the old session stays listed in T3 until it expires; no revoke call.
9. **Pairing and status live inside the panel (2026-10-12, after seeing the first panel).** No VS Code input box. The not-paired state shows a text field in the panel: paste the pairing link or just the code (the link contains the code), press Pair, errors show inline under the field. After pairing, the panel shows what the session may do in plain words (edit files, run commands, change settings, manage access), the end date, and the renewal mode: with "Manage access" it renews itself, without it the owner must pair again before the end date, and the panel says so. Keep the Reload and Forget actions in the panel too. The panel uses VS Code's own colours and fonts (the `--vscode-*` CSS variables), so it looks native next to Claude Code and Codex. Still no settings UI.

10. **Window choice for agents (Piece 2), decided 2026-10-12 afternoon.** The agent never manages windows, because every extra agent call costs tokens. The bridge picks the window itself: the one whose folder contains the agent's working folder; if none or several do, the one the owner used last. The result then says `match: fallback` with a note naming the folder, so nobody is fooled silently. `--workspace` stays for explicit binding. Codex's position (an error until bound) is recorded in docs/PIECE2.md. Commit 26a037c.

11. **Nightly drift check, decided 2026-10-12 afternoon.** Design in `docs/DRIFT.md`. The updater checks a list of facts we rely on after every T3 nightly bump and appends a block to `docs/T3-UPDATES.md` that ends with `Status: unreviewed`. The owner left both details to the lead: the log file is committed (it is the audit trail), and a review closes a block by editing that Status line to `Status: reviewed <date>: <what was done>`, no `--ack` flag.

12. **The panel follows the VS Code folder (owner, 2026-10-12 afternoon, after the first click test).** Opening a thread in the panel ran it in the home folder although VS Code had D:GIT	3-vscode open, so the agent searched the whole home directory. The owner's words: "there is no smart communication". Decision: when the panel shows T3, it is on the project whose folder is the open VS Code folder (first folder of a multi-root workspace); a new thread starts there; if T3 has no such project, the extension creates it; no clicks, no AI calls. Design: docs/PROJECT.md (research first).

13. **Codex use (owner, 2026-10-12 evening).** Codex is slow, so it is no longer a gate per plan or slice. The lead uses it only for clearly adversarial or advisory questions that are worth the wait, and asks for one full review (simplify, harden) once the product runs end to end. Verification stays: offline selfchecks, the activation smoke in an isolated VS Code, an independent Opus verifier where a mistake would be expensive, and the owner's live test.

14. **Navigation and landings (owner, 2026-10-12 evening, after the chip click worked).** The panel gets its own native bar: New thread in this project, and a list of only this project's threads (plus threads of projects nested in the workspace folders and threads working inside them; never the home-folder project). Redirected items land well: a folder chip reveals and expands the folder, media opens in VS Code's viewer. Design: `docs/NAV.md`.
15. **Approvals from the notification (owner, 2026-10-13).** The VS Code notification for a pending T3 request gets three buttons: Approve, Deny, Show. It carries the request details (thread, kind, the command or reason text). Approve and Deny send T3's own runtime-request.respond command over the orchestration WebSocket with the pairing bearer (research: `docs/APPROVE.md`); Show opens the thread in the panel as before.
16. **MCP registration both ways (owner, 2026-10-13).** The CC Switch path stays (the owner uses it for every harness). Next to it, a native way adds the context server straight into the harnesses: buttons that type the exact `claude mcp add` or `codex mcp add` line into a VS Code terminal for the owner to run, and VS Code's own MCP server definition provider. Decision 6 is widened, not replaced.
17. **Native VS Code UI: fork busFred/t3-vscode (owner, 2026-10-13 21:52).** The owner never liked T3's web page inside VS Code and does not find it usable; the embedded web UI road (decision 2) ends. The new base is a fork of busFred/t3-vscode (MIT, native React chat over vendored T3 packages), with his repo as `upstream` merged regularly, and our features put on top in separate modules. This repo becomes the archived old version. The plan, the facts and the port order are in docs/SWITCH.md; the first day starts on 2026-10-14 with docs/KICKOFF.md section 6. The lead's objection (drag and drop is a VS Code rule the fork does not change; his rebuild lags T3's own UI) was stated and the owner decided anyway.

## 2. Research findings

### 2.1 Upstream T3 Code (pingdotgg/t3code)

- T3 already has a **Files tab** in the right sidebar with a file tree. Open issues about it are bugs, not missing features: #12041 (forgets expanded folders, fix in PR #18211), #14066 (layout shift while loading), #6452 and #15739 (stale after outside changes).
- **"Open in VS Code"** exists. Windows bug: #14624 opens an empty file at the workspace root instead of the nested file.
- **Multi-root workspaces:** #1453 (VS Code workspace with several repos, 16 comments, closed). #14267 closed as **not planned**, consolidated by maintainer juliusmarminge into **discussion #7041**. A thread stays bound to one project root.
- **VS Code extension:** #2713, closed as **not planned**. So upstream will not build this.
- **No plugin or mod system.** The extension points that exist are listed in 2.3.

### 2.2 Related projects

| Project | What | State (2026-10-11) | Use for us |
|---|---|---|---|
| [maddada/VSmux](https://github.com/maddada/VSmux) | VS Code extension: T3 chats and agent CLIs as panels, splits, sessions | **Stalled.** Last code 2026-05-06, release 5.1.0 on 2026-04-29, 3 unanswered issues. Bundles its own T3 build from about April, started with `npx t3` on its own port, so it likely cannot use the owner's nightly server (unverified) | Read for ideas: `extension/t3-runtime-supervisor.ts` (starting T3), `extension/t3-webview-manager/`, `workspace/t3-frame-host.ts`, `workspace/t3-pane.tsx` (embedding T3 in a webview), `extension/t3-rpc-protocol.ts` |
| VSmux forks | 7 forks | Only `MiquelGomezCorral/VSmux` is active (26 commits ahead, last 2026-08-05), but notifications and terminal fixes only, no T3 changes | Nothing |
| [maddada/t3code-extensions](https://github.com/maddada/t3code-extensions) | Add-ons that open inside T3's preview panel via `t3.json` scripts. `@t3ex/code` = CodeMirror editor with tree, tabs, git gutters, search | Last commit 2026-07-25. Not published on npm (build from source). Does **not** modify T3, so it works on nightly | Proof that the `t3.json` `previewUrl` hook works. Optional quick win inside T3 itself |
| [busFred/t3-vscode](https://github.com/busFred/t3-vscode) | VS Code client that rebuilds T3 chat natively (React, vendored contracts, shared and client-runtime, WebSocket RPC); sessions sidebar, editor tabs, Markdown, Mermaid, KaTeX, response diffs, find in session, usage meters, scheduled tasks | Active (2026-10-06 to 2026-10-13, 118 commits, Marketplace 0.1.18 release, 0.1.21 prerelease, MIT, one author). Its own docs: not full web-app parity, no terminal, Linux first; its iframe spike timed out on auth, which our forwarder solves | Added as reference/busFred-t3-vscode on 2026-10-13. Read for: `src/host/pairing.ts` (pairing by shelling out to `t3 pair` plus the token exchange), usage meters, `src/host/hostState.ts` (subscriptions), the sessions sidebar tree. Backlog section "Round 3 (busFred)" |
| [Noisemaker111/t3code-canvas](https://github.com/Noisemaker111/t3code-canvas) | Full T3 fork: tldraw canvas with IDE, explorer/editor, git panels | Active (2026-08-27) | Not usable: it is a fork, so not nightly |
| [Marve10s/simple-t3code](https://github.com/Marve10s/simple-t3code) | T3 fork with a Codex-style UI | Active (2026-09-30) | Not usable: a fork, and even more minimal |
| zaxovaiko/treeix | Separate agent workspace app | Mac only | Not usable |

### 2.3 What an unmodified T3 nightly exposes

Paths are relative to the T3 repo root (clone of 2026-10-09; items 3 and 7 re-read at `d07a07f3` on 2026-10-12).

1. **Served web UI over HTTP.** The server serves the built web client from a static dir (`apps/server/src/http.ts`, `handleStaticAndDevRequest`). Phone and browser access use this. The main UI sets no `frame-ancestors`, so embedding it in a frame looks possible (unverified).
2. **Auth and pairing.** `t3 pair` mints a pairing token for a running server (`apps/server/src/cli/pair.ts`). `t3 auth` manages bearer sessions.
3. **MCP endpoint `/mcp`** (`apps/server/src/mcp/McpHttpServer.ts`). Streamable HTTP, protocol 2025-06-18 (`McpHttpServer.ts:861-867`). Outside clients sign in with OAuth (`apps/server/src/auth/McpOAuth.ts`). Redirect URIs must be https or loopback http, so it is built for local CLI agents and tools. Each outside client is approved in T3 with one access level. Every tool is listed to every client; the check happens at call time (`apps/server/src/mcp/McpToolAccess.ts:136-264`). Line numbers below are against `d07a07f3`; per-tool lines are in section 5, question 3.
   - **Access levels.** The approver picks one of five: `read-only`, `approval-required`, `auto-accept-edits`, `auto`, `full-access` (`packages/contracts/src/auth.ts:475-481`). `read-only` gives `orchestration:read`. `full-access` gives read, operate, `settings:write` and `source-control:write`. The other three give read and operate (`apps/server/src/auth/EnvironmentAuth.ts:87-99`), and every level except read-only also caps the run mode of the threads the client may write (`:1239`). A session lasts 30 days (`:85`).
   - read-only and up: `t3_environment_read`, `orchestrator_capabilities`, `list_scheduled_tasks`, `t3_thread_list`, `t3_thread_read`, `t3_thread_wait`, `t3_thread_search`, `t3_thread_transfers`, `t3_thread_configuration`, `t3_project_list`, `t3_project_read`, `t3_pending_request_list`, `t3_pending_request_read`, `t3_queue_list`, `t3_queue_read`, `t3_worktree_list`, `list_thread_pull_requests`, `read_pull_request_guide`
   - every level except read-only, within the mode ceiling: `t3_thread_launch`, `t3_thread_send`, `t3_thread_send_attachments`, `t3_thread_interrupt`, `t3_thread_fork`, `t3_thread_configure`, `t3_thread_update`, `t3_thread_organize`, `t3_thread_merge_back`, `t3_pending_request_respond`, `t3_queue_edit`, `t3_queue_cancel`, `t3_queue_reorder`, `t3_queue_promote_to_steer`, `t3_attachment_prepare_upload`, `t3_attachment_discard`, `t3_workflow_stop`, `schedule_task`, `update_scheduled_task`, `delete_scheduled_task`, `link_pull_request`, `unlink_pull_request`, `watch_pull_request`, `unwatch_pull_request`, `write_pull_request_guides`. An outside client must pass a `threadId` (`threadAccess.ts:162-170`).
   - full-access only: `t3_project_create`, `t3_project_update`, `t3_project_delete`, `t3_project_clone`, `t3_environment_preferences_update`, `run_scheduled_task_now`
   - inside a T3 thread only, so not for us: `t3_worktree_status`, `t3_worktree_handoff` (`apps/server/src/mcp/toolkits/worktree/handlers.ts:39-46`), `delegate_task`, `task_status`, `task_cancel`, `request_secret`, `create_threads`, `t3_preview_list`, `t3_preview_close`, and all `preview_*`, `device_*` and `html_*` tools
   - `t3_thread_start` no longer exists; a test asserts it is absent (`core.test.ts:122`). `t3_thread_launch` replaces it.
   - **MCP sessions and pairing sessions cannot stand in for each other.** `/mcp` accepts only sessions whose subject is `mcp-client` (`EnvironmentAuth.ts:1208-1229`), and an MCP session is refused everywhere else (`:624-631`, `:718`, `:1193`). So the MCP bearer works only on `/mcp`, and the pairing bearer never works on `/mcp`.
   - These tools are written for AI agents, so they are likely more stable across nightlies than the internal RPC (an assumption, not a promise).
4. **Internal WebSocket RPC.** 185 methods in `packages/contracts/src/rpc.ts` (Effect RPC). Only the orchestration protocol has a version (`ORCHESTRATION_PROTOCOL_VERSION = 2` in `packages/contracts/src/environment.ts`). Not a public API. **Avoid**: it changes with nightly.
5. **`t3` CLI:** `project`, `pair`, `auth`, `session`, `status`, `connect`, `serve`, `service`, `theme`, `update`, ... (`apps/server/src/cli/`).
6. **`t3.json` project scripts** with `previewUrl` + `autoOpenPreview` open a URL in T3's preview panel (`packages/contracts/src/t3ProjectFile.ts`). Desktop build only.
7. **Deep links.** The web build uses path routes, so a thread is `/<environmentId>/<threadId>` (section 5, question 4). The desktop app has a `t3code://app` scheme for its own renderer only and no thread deep link (`apps/desktop/src/app/DesktopClerk.ts:199-218`).

## 3. Proposed design

```
                 T3 server on the PC (nightly, unmodified)
      threads · orchestration · all harnesses · remote access
        ▲                  ▲                         ▲
   T3 desktop app       phone                VS Code (this extension)
                                              ├─ Piece 1: T3 chat panel = T3's own web page
                                              ├─ Piece 2: VS Code context bridge (MCP server)
                                              └─ Piece 3: workspace -> T3 project sync (optional)
```

All state lives in the T3 server. A thread started in VS Code shows up on the phone and in the desktop app, and the other way round, with no work from us.

### Piece 1: T3 chat in VS Code (estimate 1-2 days)

- A webview panel that loads T3's served web UI from the running nightly server.
- Gives every T3 feature for free and follows nightly automatically.
- File links: Ctrl+click and the right-click menus open the file in the editor chosen in T3's "Open in" picker (decision 5). A plain click opens T3's own preview panel (decision 1). Windows bug #14624 for nested files.
- **Main risk: auth inside the webview** (pairing token, session cookie in a framed page, VS Code webview CSP and `asExternalUri`). VSmux solved this for its bundled T3: study how, then design our own. The owner wants this to be clearly better than VSmux, not a copy of it.
- **Do this first.** It is the riskiest piece; if it fails, the design changes.

### Piece 2: VS Code context bridge (estimate 1-2 days)

- The extension runs a small local MCP server that exposes VS Code state to agents:
  - workspace folders and the `.code-workspace` structure,
  - active file, selection, open tabs,
  - diagnostics (errors, warnings),
  - actions: open a file at a line, show a diff in VS Code.
- Register it in each harness's MCP config (on the owner's PC through CC Switch). Every agent T3 starts can then call it, so "fix the error in this file" works from the T3 chat.
- Does not depend on T3 at all, so nightly cannot break it.
- Idea to check: the official Claude Code VS Code extension already runs an IDE MCP server that the Claude CLI connects to. It may cover part of this for the Claude harness only (unverified whether it works when T3 launches Claude).

### Piece 3: workspace -> T3 project sync (optional, estimate half a day)

- On workspace open, make sure each folder exists as a T3 project via `/mcp` (`t3_project_list`, `t3_project_create`; create needs a full-access MCP client) or `t3 project`.
- Could also add a "T3 Threads" tree view per folder, a status bar item for running threads, and approval prompts (`t3_pending_request_respond`). Only if Piece 1 is not enough. The feed for these is a poll of `GET /api/orchestration/shell` (section 5, question 6).

### Rejected

- **Native rebuild of T3's chat in VS Code** on the internal RPC: weeks of work, breaks with every nightly.
- **Forking T3 or VSmux's bundled T3:** violates the nightly rule.
- **Step 0 alone** (just adding T3's `/mcp` to VS Code's `mcp.json` so Copilot/Claude chat in VS Code can drive T3): the owner judged it too thin. Still a useful smoke test for Piece 3's auth.

## 4. Known limits

- **One thread spans one project root.** With Piece 2 an agent can see and read other workspace folders, but T3's git, diff and worktree features only track the thread's own root. Real multi-root threads need upstream (discussion #7041).
- **Nightly break points:** Piece 1 (web UI routes, auth), Piece 3 (`/mcp` tool shapes, `/api/orchestration/*` shapes). Piece 2 is independent.
- **Two credentials.** The pairing bearer serves `/api` and `/ws`; `/mcp` needs its own OAuth client session (section 2.3, item 3). Piece 3 can use the pairing bearer on `/api/orchestration/shell` and needs `/mcp` only for actions those routes lack. Update 2026-10-13: docs/APPROVE.md found that /mcp cannot approve at all and that the web UI sends `runtime-request.respond` over the orchestration WebSocket, which the pairing bearer with `orchestration:operate` may do too.
- **The server runs only while the T3 desktop window is open** (seen live on 2026-10-11: closing the window stopped the backend). The VS Code panel dies with it. `t3 service` may be the answer; not tried.
- **The `t3` CLI shows no output from a shell on this PC** (section 5, question 1). Anything we build must not read CLI output.

## 5. Open questions (check first, against the live nightly)

Round 1 (2026-10-11) checked 1 and 2 read-only against the owner's running nightly `0.0.46-nightly.20261011.2980` (build commit `ed0f7b908b2e`, read from `resources/app.asar` `package.json`). Only GET, HEAD and OPTIONS requests were sent to the server, plus reads of local config files. Nothing in T3 was changed and no pairing token was minted. Source references point to `reference/t3code` at `ed0f7b90`, which is the same commit as the live build, so source and live agree for this round. The live JSON matched the contracts.

The T3 desktop app quit at about 23:10 while the probes ran (`~/.t3/userdata/logs/desktop.trace.ndjson` ends with `windowAllClosed`, then `backendInstance.stop`, then `beforeQuit`: a normal quit, not a crash). Our agents only sent GET requests. Checks after that point could not be repeated, and the agents did not restart T3. Claims marked "live" below were recorded before 23:10.

Round 2 (2026-10-12): the owner restarted T3, which is now nightly `.2994` (build commit `d07a07f33c0a`), and `reference/t3code` moved to `d07a07f3`, the same commit. A read-only re-probe (GET and HEAD only) is recorded under question 1. Questions 3, 4, 6 and 7 were answered from source at `d07a07f3`, not yet live. Round 1 citations point to `ed0f7b90` and may have shifted by a few lines.

### 1. Port, URL, plain HTTP: ANSWERED

- **The desktop app's own process is the server.** PID 17940 (`T3 Code (Nightly).exe`) listens on `0.0.0.0:3773` (`Get-NetTCPConnection`). `~/.t3/userdata/server-runtime.json` agrees: `host 0.0.0.0`, `port 3773`, `origin http://127.0.0.1:3773`, `pid 17940`. `desktop-settings.json` has `serverExposureMode: network-accessible`, which is why it is also reachable from the LAN (and the phone).
- **It serves the web UI over plain HTTP.** `GET http://127.0.0.1:3773/` returns 200 `text/html` (the SPA `index.html`, 19 KB). So `t3code://app` is not the only way in, and no `t3 serve` or extra remote mode is needed on this PC.
- **No framing protection.** The response headers of `/` carry no `X-Frame-Options` and no `Content-Security-Policy`. The server code only sets `frame-ancestors 'none'` plus `X-Frame-Options: DENY` on the MCP OAuth approval page (`apps/server/src/auth/mcpOAuthHttp.ts:20-23`), the same on the Codex ChatGPT auth page (`provider/CodexChatGptAuth.ts:712`), and a sandbox CSP on served attachments and previews (`apps/server/src/http.ts:110-135`). The SPA handler sends only cache headers (`http.ts:546-660`). So the server does not block a frame.
- **CORS is open:** `access-control-allow-origin: *`; the preflight allows `authorization, content-type, dpop, b3, traceparent, x-t3-orchestration-protocol`.
- **Discovery for the extension:** read `~/.t3/userdata/server-runtime.json` (`origin`, `pid`), check that the pid is alive, then confirm with `GET /.well-known/t3/environment` (contract `packages/contracts/src/environmentHttp.ts:450`, "descriptor": `environmentId`, `label`, `serverVersion`, `orchestrationProtocolVersion`, `capabilities`). `t3 pair` discovers a server the same way (`apps/server/src/cli/pair.ts:58`). The live GET of this endpoint was not recorded in round 1; it was verified live on 2026-10-12 (re-probe below). Do not hard-code 3773: port and cookie name come from the running instance. `server-runtime.json` is not deleted on quit, so it goes stale (it still named pid 17940 after the app was gone). A restart rewrites it with the new pid. On Windows, Node's `process.kill(pid, 0)` once reported the live T3 pid as dead, so do not trust that check alone; the GET is the real test.
- **The server lives only as long as the desktop window.** The quit above proves it: close the T3 window and the server is gone. `t3 service` exists in the CLI (`apps/server/src/cli/`) and may keep a server up without the window; not tried.
- **The `t3` CLI prints nothing from Git Bash, `cmd` or `powershell.exe` on this PC.** `t3 --help` and `t3 status` exit 0 with empty output and an empty redirect file. `~/.t3/bin/t3.cmd` runs the Electron exe with `ELECTRON_RUN_AS_NODE=1`, so this looks like the GUI-subsystem console problem. Unverified from a Windows Terminal tab opened by hand. The spike must not depend on reading CLI output.
- **Not T3:** port 8377 is the Codex live-viewer node process.

**Re-probe 2026-10-12 (GET and HEAD only, nothing written):**

- The app is now `0.0.46-nightly.20261011.2994`, build commit `d07a07f33c0a` (from `resources/app.asar`), running under a new pid. `server-runtime.json` and the live server agree: `0.0.0.0:3773`, origin `http://127.0.0.1:3773`. The round 1 quit is over.
- `GET /.well-known/t3/environment`: 200 `application/json`, no redirect. It carries `environmentId` (a UUID), `label`, `platform`, `serverVersion` `0.0.46-nightly.20261011.2994`, `orchestrationProtocolVersion` 2, and about 45 capability flags. New flags include `threadSnooze`, `threadPinning`, `serverBrowser` and `threadPullRequestWatch`.
- `GET /` returns 200 with the entry script `/assets/index-CnuT95qQ.js` (round 1 had `index-CCp79p89.js`). `HEAD /pair` and `HEAD /settings` return 200 HTML.
- A bare `GET /ws` still returns 426 `orchestration_protocol_incompatible`, protocol 2.
- `GET /api/auth/session` is unchanged (policy, bootstrap methods, session methods, cookie name `t3_session_3773`), plus a field `"serverUpdateScope":"environment:maintain"`. The round 1 excerpt was cut, so this field may not be new.
- This probe did not check response headers. Headers and the bundle claims of question 2, item 11 were re-checked for `.2994` by a separate agent (see there).

### 2. Webview and sign-in: ANSWERED on the T3 side, mostly ANSWERED on the VS Code side (live, 2026-10-12)

How a client signs in (verified live, `GET /api/auth/session` while unauthenticated):

```
{"authenticated":false,"auth":{"policy":"remote-reachable",
 "bootstrapMethods":["desktop-bootstrap","one-time-token"],
 "sessionMethods":["browser-session-cookie","bearer-access-token","dpop-access-token"],
 "sessionCookieName":"t3_session_3773", ...}}
```

1. A one-time pairing token (5 min default TTL, `t3 pair --ttl`, `PairingGrantStore.ts:254`) is minted by `t3 pair` or in T3's settings. The pairing URL is `<origin>/pair#token=<token>` (`startupAccess.ts:92-98`). The token sits in the URL fragment, so it never goes to the server in a request line.
2. The web UI reads it (`packages/shared/src/remote.ts:144`, `getPairingTokenFromUrl`) and POSTs `{"credential": "<token>"}` to `/api/auth/browser-session` (`environmentHttp.ts:464`).
3. The server answers with an **HttpOnly, `SameSite=Lax`, path `/` cookie**, 30 day TTL, no `Secure`, no `Partitioned` (`auth/http.ts:319-324` for this route, `:204-209` for the legacy migration, `SessionStore.ts:432`). The name is `t3_session_<port>` only in desktop mode; a `t3 serve` or `t3 service` server uses a hashed name (`auth/utils.ts:32-50`). Always read `sessionCookieName` from `/api/auth/session`.
4. The `/pair` page submits a token from the URL by itself, with no user input (`apps/web/src/components/auth/PairingRouteSurface.tsx:78-86`), then polls `/api/auth/session` for up to 2 s and reloads to `/` (`environments/primary/auth.ts:250-269`, `routes/pair.tsx:44-50`). The grant is one-time (`PairingGrantStore.ts:455-575`): a token that was spent on a failed attempt is gone.
5. WebSocket: the same-origin web client opens `/ws` with **no ticket**; the cookie rides on the upgrade (`packages/client-runtime/src/connection/resolver.ts:74-102`, bearer token absent). Only bearer clients first POST `/api/auth/websocket-ticket` and then open `/ws?wsTicket=...` (`client-runtime/src/authorization/remote.ts:170-247`). The server checks `wsTicket` first and falls back to cookie or bearer on the upgrade (`EnvironmentAuth.ts:1185-1205`). Live: a bare `GET /ws` returns 426 `orchestration_protocol_incompatible`, protocol version 2.
6. Credential order on every HTTP request: session cookie, then `Authorization: Bearer`, then DPoP, then the legacy cookie (`EnvironmentAuth.ts:662-688`). **The first credential present wins.** An invalid cookie is not rescued by a valid bearer (`:666-669`, `:745-748`). Cookies are scoped by host, not port, so a stale `t3_session_3773` for `127.0.0.1` would be sent to any forwarder port and hide the bearer.
7. A pairing token can also be exchanged for a **bearer** at `POST /oauth/token`, form-urlencoded, four required fields: `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, `subject_token=<pairing token>`, `subject_token_type=urn:t3:params:oauth:token-type:environment-bootstrap`, `requested_token_type=urn:ietf:params:oauth:token-type:access_token`; optional `scope`, `client_label`, `client_device_type`, `client_os` (`packages/contracts/src/auth.ts:227-231`, `:298-308`; handler `auth/http.ts:350-412`). The exchange spends the one-time grant (`EnvironmentAuth.ts:885-887`). The Bearer's `expires_in` is the session expiry, 30 days (`EnvironmentAuth.ts:946-960`); a DPoP token lives 1 hour (`:925-930`). The session gets the grant's scopes, or the requested subset (`:913-916`). A pairing link from Settings defaults to `AuthStandardClientScopes` (`auth/http.ts:435`, `apps/web/src/components/settings/ConnectionsSettings.tsx:1065-1067`), which includes `terminal:operate`, `filesystem:write`, `settings:write`, `providers:manage` and `source-control:write` (`auth.ts:205-219`). That is owner-equivalent for code execution; admin rights add only access management and relay write (`:220-225`). Settings has a "Read only" preset (`ConnectionsSettings.tsx:1150-1163`).
8. **How the web client picks its server:** the nightly bundle ships empty `VITE_HTTP_URL` and `VITE_WS_URL`, so with no `window.desktopBridge` the primary target is `window.location.origin` for HTTP and `/ws` (`apps/web/src/environments/primary/target.ts:226-247`, `:307-316`; `httpLayer.ts:9-18`). A page served from a forwarder therefore talks only to that forwarder. `/.well-known` is not used to pick the origin.
9. `desktop-bootstrap` exists only for the Electron shell via `window.desktopBridge`; we cannot use it. The web UI itself uses a bearer only when `window.desktopBridge` is present (`desktopAuth.ts:5-10`). Otherwise it runs `credentials: "include"` and relies on the cookie (`apps/web/src/environments/primary/httpLayer.ts:9-54`). Nothing in the bundle reads `document.cookie` (0 hits), so the client never handles the credential itself. It does not care how a request got authenticated, only that `/api/auth/session` says `authenticated:true`.
10. Live: `GET /api/auth/session` with `Authorization: Bearer invalid` returns 200 `authenticated:false`, not 401. Only `/mcp` answers 401 for a bad credential.
11. Live: no `Set-Cookie`, CSP, `X-Frame-Options` or redirect on any probed path. The SPA fallback returns 200 HTML for every unknown path, including `/api/auth/browser-session` on GET, so a 200 proves nothing about a route. No service worker (`serviceWorker`, `workbox`: 0 hits in the bundle). No frame-busting code (`window.top`, `window.parent`, `self!==top`: 0 hits). These were checked on round 1's bundle `index-CCp79p89.js`. On 2026-10-12 the headers and these bundle claims were re-checked for `.2994` (`index-CnuT95qQ.js`) by a separate agent.

    Bundle re-check for .2994 (2026-10-12, GET only, entry `index-CnuT95qQ.js`, 153 chunks): all five claims still hold. `document.cookie`, `window.top`, `window.parent`, `self!==top`, `frame-ancestors`, `serviceWorker`, `workbox`: 0 hits each. `VITE_HTTP_URL` and `VITE_WS_URL` are empty strings. `/` and `/pair` send no CSP, no `X-Frame-Options`, no `Set-Cookie`, `access-control-allow-origin: *`. The thread route `/$environmentId/$threadId` has 20 hits. Only `self!==top` was checked literally; a minified `top!==self` would not have matched.

**Live results 2026-10-12** (build run 3, nightly `.2994`, our commit `dce3ffb`). The list below was "Still open (cannot be settled without running something in a real VS Code webview, which is the spike)". Each item now carries ANSWERED or OPEN with its evidence.

How the tests got a credential: at about 09:35 the owner pasted a one-time pairing code. The extension's own `exchange()` in `t3.js` turned it into a 30-day bearer. Session label "VS Code", scopes: the owner's full admin set including `access:write`, expiry 2026-11-11. The bearer lived only in a temp file for the tests and was deleted after run 3. The owner can revoke the session in T3 Settings, Connections.

- **OPEN (PLAN check A1, a plain frame keeps the cookie).** Still untested on 2026-10-12: it needs a second pairing code. It only decides whether the forwarder could be removed later. The forwarder path works (next items), so nothing waits on it. Original note: **Likely problem, not yet tested:** a frame inside a VS Code webview sits under the `vscode-webview://` origin, which is cross-site to `http://127.0.0.1:3773`. Chromium drops a `SameSite=Lax` cookie that a cross-site frame tries to set or send. So a plain `<iframe src="http://127.0.0.1:3773/pair#token=...">` probably loads the page, spends the one-time token, and then fails with "Timed out waiting for authenticated session after bootstrap". This is reasoning from source, not a test. The spike tests it first (PLAN step 2), with a token the owner can afford to lose, then applies the fix (steps 3 and 4).
- **ANSWERED: webview CSP and `frame-src`.** Original note: we write the host HTML ourselves, so we can allow the frame. Not yet tried. Live: in an isolated VS Code 1.141 profile (Extension Development Host), with the same CSP, `allow` and `sandbox` values as `extension.js`, an iframe to the forwarder root loaded T3's web UI. The forwarder's `frame-ancestors vscode-webview: vscode-file:` header let the frame render in Electron. T3 sends no frame-blocking header of its own (re-checked for `.2994`).
- **ANSWERED: WebSocket from a frame in a webview, and the panel signs in (PLAN check A2).**
  - Raw handshake through the forwarder with only the bearer (no `wsTicket`, no cookie): `GET /ws?orchestrationProtocol=2` returned 101 Switching Protocols. The query parameter name is `orchestrationProtocol`, value 2. Without it the server answered 426 and the forwarder recorded kind "protocol". After `close()` no sockets to 3773 remained from our process.
  - Real panel frame (the profile above), seen through the forwarder's `onRequest` hook: 299 HTTP requests, `GET /api/auth/session` 200, upgrade `/ws` 101 at 0.9 s, then 17 more HTTP requests. Zero 403, zero upgrade failures. The SPA also fetched `/`, `/.well-known/t3/environment`, `/api/orchestration/shell` and `/api/connect/link-state` with 200, and posted its own telemetry to `/api/observability/v1/traces` (204).
  - Deep path: a second frame pointed at `/settings/connections` loaded too (200 HTML, 248 requests, a second `/ws` 101). So the app works on a deep path.
  - Sec-Fetch headers Electron sends for the panel frame: navigation `sec-fetch-dest: iframe`, `sec-fetch-site: cross-site`, `sec-fetch-mode: navigate`. Scripts and styles: `same-origin` + `cors`. Images: `same-origin` + `no-cors`. API calls: `same-origin` + `cors`, dest `empty`. The `/ws` upgrades carry only `origin: http://127.0.0.1:<port>` and no sec-fetch headers. The rule "refuse `sec-fetch-dest: document`" never fired and stays: a top-level browser navigation sends `document`, the frame sends `iframe`.
- **OPEN: clipboard, paste, focus, drag and drop.** Not tried yet; needs the owner in the panel. VSmux needed a clipboard bridge because Ctrl+C and Ctrl+V did not reach its frame (`reference/VSmux/workspace/t3-frame-host.ts:321-433`).
- **ANSWERED: the forwarder was needed and does all three from day one.** `t3.js` strips the inbound `Cookie`, drops `Set-Cookie`, refuses a foreign `Origin` with 403, sends its own origin in `access-control-allow-origin`, and records a non-101 upgrade answer with a kind. Live: the panel ran with zero 403, and the 426 above was recorded as kind "protocol". Original note: **If a forwarder is needed, three things it must do from day one** (found in review, from source): strip the inbound `Cookie` header and drop `Set-Cookie` from replies, because a stale cookie wins over the bearer with no fallback (item 6); refuse requests that carry an `Origin` other than its own and replace `access-control-allow-origin: *`, because T3 has no Origin check on `/api/*` or `/ws` (`apps/server/src/http.ts:239-262`), so any web page in the owner's browser could otherwise drive a bearer-injecting forwarder; and surface a non-101 answer to the `/ws` upgrade as an error, because the bearer-on-upgrade fallback is internal server code that no first-party client uses (`EnvironmentAuth.ts:1185-1205`), so a nightly can drop it and the UI would spin on "connecting" forever.

One hook bug was found and fixed in run 3: when the page cancelled a request mid-flight, the hook reported 502. Now a 502 is reported only when the client is still connected.

Still OPEN after run 3 (needs the owner in the real panel):

- Send a message and see the reply stream.
- The same thread is visible in the T3 desktop app and on the phone.
- The panel survives a VS Code window reload with the real, activated extension. Run 3 used a copy of the page, not the activated extension.
- Clipboard, paste and focus (item above).
- The "Open in" picker (Cursor is the default when installed, decision 5) and file clicks (decision 1).
- A1 (item above), only if the owner can spare a second pairing code. It only decides whether the forwarder could be removed later.

How VSmux got T3 into a webview (read from `reference/VSmux`, MIT, last code 2026-05-06):

- **It does not frame the running T3.** It starts its own T3 (`npx --yes t3`) through a supervisor process on its own `T3CODE_PORT` and its own `T3CODE_HOME` (`extension/t3-runtime-supervisor.ts`), and ships a copy of T3's built web bundle (`index.html`, scripts, CSS) inside the extension.
- **A local asset server** (`extension/workspace-asset-server.ts`) serves that bundle and **reverse-proxies** the T3 API and WebSocket upgrades to its own T3, adding `Authorization: Bearer <ownerBearerToken>` (`setT3ProxyAuthorizationToken`, `createProxyRequestHeaders`). The owner token comes from `auth-state.json` after a `POST /api/auth/bootstrap/bearer` desktop-bootstrap exchange against its own T3 (`extension/t3-runtime-manager.ts:676-790`).
- **The webview is a thin host page** (`extension/t3-webview-manager/html.ts`): a strict meta CSP, a JSON bootstrap block, one script. The iframe loads this page, and `workspace/t3-frame-host.ts` (1146 lines) **fakes `window.desktopBridge`** (`getLocalEnvironmentBootstrap`, `getWsUrl`, notifications, update state, `pickFolder`, many stubs) so T3's React app thinks it runs in Electron and signs in with the bootstrap token and bearer. It also polls the frame's location and history for thread ids and working state.
- **Why that cannot work for us:** it needs the bundle and the server to be the same T3 build (they pin one and ship its assets), it needs a private T3 home, and it fakes an Electron API surface that changes with every nightly. The fake is already stale: upstream now calls `getLocalEnvironmentBootstraps` (plural, `apps/web/src/environments/primary/auth.ts:174`), VSmux stubs the singular. Our server is the owner's nightly, which updates itself.
- **Weak spots we saw:** a fixed port 3774 (`extension/t3-runtime-manager.ts:27-28`); the full owner token on every proxied request (`workspace-asset-server.ts:581-582`); CORS that reflects any `Origin` with credentials (`:498-508`); a second listener on `0.0.0.0:45438` (`:30`, `:163-166`); `postMessage` to `"*"` (`workspace/t3-pane.tsx:326`); zoom by writing into the frame's `contentDocument` CSS and composer focus by `data-testid` selector (`t3-pane.tsx:286-310`, `t3-frame-host.ts:449-480`); `script-src ... 'unsafe-eval' http://127.0.0.1:*` in the webview CSP (`extension/workspace-panel.ts:483`).
- **What it got right:** `retainContextWhenHidden: true` so the socket survives tab switches (`workspace-panel.ts:254`); `iframe.allow = "clipboard-read; clipboard-write"` and a sandbox with `allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads` (`workspace/t3-runtime-cache.ts:63-66`); streaming is where it is weaker, it buffers proxied bodies through `fetch` (`workspace-asset-server.ts:305-337`); a visible "Loading T3 Code" page and a "assets are missing" page (`t3-webview-manager/html.ts:113-122`), so the user is never left with a blank frame.

What we do differently:

| VSmux | Ours |
|---|---|
| Starts and owns a private T3 server | Never starts or stops T3. Attach to the running nightly. If it is down, say so and offer to start the desktop app |
| Ships a copy of T3's web bundle | Ship no T3 code. The UI is whatever the live server serves, so it always matches the server after a nightly update |
| Fakes `window.desktopBridge` | Fake nothing. Use the sign-in a browser or phone uses: a one-time pairing token from T3's own pairing UI |
| Proxy injects the full owner bearer on a fixed port, plus a LAN listener | Only if the bare frame cannot keep the cookie: a small forwarder on `127.0.0.1`, random port, alive only while the panel is open. It adds `Authorization: Bearer <token>` where the token came from exchanging the user's pairing token at `/oauth/token`. The owner picks the scopes when minting the link in T3's settings; the default set can run terminals and write files, so the forwarder also strips cookies and refuses foreign origins. WebSocket upgrade pass-through, streamed, never buffered. No change to T3's UI |
| Pairing is a bootstrap it controls | The user pastes a one-time token once. The bearer is kept in VS Code `SecretStorage`. Re-pair only when `/api/auth/session` says `authenticated:false` |
| Polls the frame's URL and DOM from outside | The spike does not touch the page. Thread awareness comes later from `/mcp` or the context bridge, not from scraping |
| About 3000 lines across supervisor, manager, host | Target: under 300 lines for the spike (see `docs/PLAN.md`) |

What we keep from VSmux is the idea of a local forwarder in front of T3 so the webview talks to an origin we control. Not copied: its code, its structure, its fake bridge.


- **A1 ANSWERED on 2026-10-12 at 11:28 local, in the owner's real VS Code (Extension Development Host, no debugger): the plain frame does NOT keep the cookie.** Server log (`~/.t3/userdata/logs/server.trace.ndjson`, UTC 09:28:33 to 09:28:36): `GET /pair` 200, `POST /api/auth/browser-session` 200 with `PairingGrantStore.consume` and `SessionStore.issue` (the cookie was issued), then `authenticateWebSocketUpgrade` failed with `ServerAuthMissingCredentialError` (no cookie on the upgrade), and `GET /api/auth/session` was polled every 100 ms for 2 s without a credential. The page then reported the code as wrong, because the one-time grant was already spent. Conclusion: the `SameSite=Lax` cookie is dropped inside a `vscode-webview://` frame, exactly as reasoned on 2026-10-11. The bearer forwarder stays; the direct-pairing test tab can be removed from the extension.

- **Webview message senders, checked live on 2026-10-12 at 13:14 local in an isolated VS Code (WebviewPanel with a child http iframe, probe outside the repo):** inside the webview page `window.parent === window` and `window.top !== window` (VS Code's preload script sets them). A message from the extension host arrives with `e.source !== window.parent`, `e.source !== window` and `e.origin === location.origin` (`vscode-webview://<id>`). A message from the child http frame arrives with `e.source === frame.contentWindow` and its http origin. So a panel page must filter host messages by origin, never by `e.source === window.parent`. Second probe, 14:18 local, same harness: an http iframe on a fixed port inside the webview wrote localStorage, VS Code was closed and started again with the same user data dir, and the frame read the value back. So with a stable forwarder port, T3 keeps its per-origin localStorage (editor choice, dismissed boxes) across VS Code restarts.

- **Owner test of the panel, 2026-10-12 about 13:55 local, in the owner's VS Code (Extension Development Host, code at a5b5e23):** PASS. The panel paired from a pasted link, shows "Paired as VS Code, renews itself, until 11 Nov 2026", the scope list in words, "Renewal: automatic (Manage access granted)", the Open in hint, and T3's own page below it with the "New thread" view of a project. The owner's words: "the new design for pairing, etc., looks good, and it also works." Then, about 14:10: a message sent from the panel streamed its reply and the thread showed on the phone (PASS), a window reload kept the session (PASS), and Forget in one of two VS Code windows flipped the other to unpaired (PASS, so the secret change event does cross windows). Piece 1 gates 1 to 4 are closed.

### 3. `/mcp` tools for an outside OAuth client: ANSWERED (from source, 2026-10-12)

Round 1 did not work on this, but the live metadata came for free: `GET /mcp` without a credential returns 401 with `www-authenticate: Bearer resource_metadata="http://127.0.0.1:3773/.well-known/oauth-protected-resource/mcp"`. That document lists the authorization server `http://127.0.0.1:3773` and `scopes_supported: ["orchestration:read", "orchestration:operate"]`. The authorization server metadata offers dynamic client registration at `/oauth/mcp/register`, authorization code with PKCE `S256` only, and `token_endpoint_auth_methods_supported: ["none"]`.

Round 2 answer, from source at `d07a07f3`. Tool handler paths are under `apps/server/src/mcp/toolkits/`:

- **Tool lists by access level:** section 2.3, item 3. Source lines: reads at `orchestrator/handlers.ts:12,70,105,115,140`, `environment/handlers.ts:44`, `project/handlers.ts:187,197`, `pullRequests/handlers.ts:433,493`, `thread/handlers.ts:100,157,172,203,213,234,249`, `worktree/handlers.ts:14`. Operate at `orchestrator/handlers.ts:40-147`, `project/handlers.ts:56`, `attachment/handlers.ts:54-80`, `thread/handlers.ts:117-293`, `pullRequests/handlers.ts:368-440`. Full-access at `project/handlers.ts:209-269`, `environment/handlers.ts:57`, `thread/handlers.ts:79`. Inside-thread only at `orchestrator/handlers.ts:19-98`, `worktree/handlers.ts:39-46`.
- **How a call is checked:** each tool declares what it does. `reads` is open to anyone. `readsAsCaller` and `actsAsCaller` need an agent inside a T3 thread (`apps/server/src/mcp/McpToolAccess.ts:131-154`, `McpInvocationContext.ts:124-130`). Any write refuses read-only (`McpToolAccess.ts:100-113`). Thread writes must stay within the client's mode ceiling (`:174-188`, `threadAccess.ts:109-118`). Environment writes need full-access (`McpToolAccess.ts:246-263`). Outside clients get the capabilities orchestration, worktree and pull-requests, and no calling thread (`apps/server/src/auth/McpOAuth.ts:572-585`).
- **`t3_thread_wait`:** input `{threadId, runId?, timeoutMs?}`, output `{threadId, runId|null, status, timedOut}`, where `status` is `idle` or a run status (`packages/contracts/src/orchestratorMcp.ts:445-458`, `:278-281`). It is a long poll for the end of a run: 10 minutes by default, 60 at most (`apps/server/src/mcp/OrchestratorMcpService.ts:98-99`, `:2591-2610`). An idle thread returns at once. A timeout does not stop the work (`orchestrator/tools.ts:247-259`). There is no event stream for file edits or tool calls; poll `t3_thread_read` for those. No rate limit found.
- **Transport:** Effect `McpServer.layerHttp`, protocol 2025-06-18, path `/mcp`, `allowSessionTermination: true` (`apps/server/src/mcp/McpHttpServer.ts:861-867`). That is Streamable HTTP. T3's own bridge sends `accept: application/json, text/event-stream` (`AcpMcpStdioBridge.ts:100`).
- **OAuth approval flow for a local client:**
  1. Register at `POST /oauth/mcp/register`. Redirect URIs must be https, or http on localhost, 127.0.0.1 or [::1]. Loopback redirects match on everything except the port (`McpOAuth.ts:109-139`).
  2. `GET /oauth/mcp/authorize` validates, then redirects to the web page `/connect-agent?<same query>` (`apps/server/src/auth/mcpOAuthHttp.ts:18`, `:90-100`).
  3. That page (`apps/web/src/components/auth/ConnectAgentSurface.tsx`) shows `Connect <clientName>` with a note that the agent chose the name (`:188-208`), where approval returns to (`:199-200`), a "What it may do" choice of the five access levels with "Read only" as default (`:107`, `:220-233`), a pairing code field, Approve and Deny (`:240-277`).
  4. The decision goes to `POST /oauth/mcp/decision`. The browser is sent to the loopback URI with `code`, `state` and `iss` (`McpOAuth.ts:463-473`). The code lives 60 seconds (`:55`). Exchange it at `POST /oauth/mcp/token` with PKCE S256 (`:483-541`).
- **One-click approval needs `access:write`.** Only a browser session that holds `access:write` and `orchestration:read` can approve without a code (`McpOAuth.ts:399-402`), and only for an access level whose scopes that session holds (`:450-457`). The Standard pairing scopes lack `access:write` (`packages/contracts/src/auth.ts:205-219`). So a panel signed in with Standard must paste a fresh one-time pairing token as the code (`EnvironmentAuth.ts:1265-1285`). Only the desktop app's admin session approves in one click.
- **Still open:** whether `GET /mcp` serves an SSE stream for server notifications (only "a POST may answer with SSE" is suggested); the full `t3_thread_read` output; server-side rate limits on `/mcp`.

### 4. Deep link to one thread: ANSWERED (from source, 2026-10-12)

- **Routes.** The web build uses path routes, the desktop hash routes: `isElectron ? createHashHistory() : createBrowserHistory()` (`apps/web/src/main.tsx:21`). The thread route is `/_chat/$environmentId/$threadId`, so the URL is `/<environmentId>/<threadId>` (`apps/web/src/routes/_chat.$environmentId.$threadId.tsx:5`). The app itself navigates that way (`ChatView.tsx:7433`, `AssistantCitationChip.tsx:107`). The thread route takes no search parameters. A draft is `/draft/<draftId>` (`_chat.draft.$draftId.tsx:5`).
- **Which environmentId.** The server's `environmentId` is a UUID stored on disk (`apps/server/src/environment/ServerEnvironment.ts`, about `:155-161`) and is the descriptor's `environmentId`. Unverified that the web route uses that same id for the primary environment; check live.
- **Projects and settings.** `/projects/<projectKey>` only redirects to `/settings/projects?project=<key>` (`routes/projects.$projectKey.tsx:3-15`); there is no project chat route. Settings routes such as `/settings/connections` and `/settings/general` accept `?project=`, `?machine=` and `?environmentId=` (`components/settings/settingsScopeNavigation.ts:6-12`).
- **Index behaviour.** Loading `/` starts a new draft thread in the most recently updated project (`routes/_chat.index.tsx:50-69`), or shows a "no projects" screen when there is none (`:88`). It does not restore the last thread. Every `_chat` route redirects to `/pair` when not signed in (`_chat.tsx:233-238`).
- **No desktop deep link.** The desktop app's `open-url` and `second-instance` handlers only handle provider sign-in and web links (`apps/desktop/src/app/DesktopClerk.ts:199-218`).

### 5. Claude Code IDE connection for a T3-started Claude: ANSWERED from source, one live check pending

Read on 2026-10-12 from the installed Claude Code extension 2.1.296 and its bundled CLI (details in `docs/PIECE2.md`). The extension runs a WebSocket MCP server on a random loopback port and writes a lock file under `~/.claude/ide/<port>.lock` with the workspace folders and an auth token. The CLI only auto-connects to it inside a VS Code terminal (it checks the lock file pid among its ancestors) or when `CLAUDE_CODE_SSE_PORT` is set, which the extension only injects into VS Code terminals. So a Claude session that T3 starts does not get the extension's IDE tools. That is why Piece 2 is our own bridge with its own window discovery.

Refuted on the same day by the Codex design review (`docs/PIECE2.md`, finding 1): the Claude CLI bundled with the extension enables all settings sources by default (`userSettings`, `projectSettings`, `localSettings`, ...) and only narrows them when `--setting-sources` is passed; user-scope MCP servers come from `~/.claude.json` and stay enabled. The pinned Claude Agent SDK 0.3.276 passes `--setting-sources` only when the caller sets it, and T3's thread runs do not (`ClaudeAdapterV2.ts:1007-1067` at d07a07f3). So a T3-started Claude should see the CC Switch MCP entries. Still unverified live: a real `workspace` tool call from inside a T3-started Claude thread and a T3-started Codex thread; that is acceptance check 1 and 2 of Piece 2.

### 6. Piece 3 feed: ANSWERED (from source, 2026-10-12)

Update 2026-10-12: the earlier plan to read thread status through `/mcp` was replaced by the shell route. The code polls `GET /api/orchestration/shell` with the pairing bearer and never calls `/mcp` for status (status bar, badge and notifications built in cf14a81 and 06bc1bb).

- **No SSE.** The server has no `text/event-stream` outside the MCP bridge. Live updates exist only on the internal WebSocket RPC (`orchestration-v2/ShellStream.ts`; `getTurnDiff` and `getFullThreadDiff` at `packages/contracts/src/rpc.ts:1626-1636`). Avoid them.
- **Poll `GET /api/orchestration/shell`** (`packages/contracts/src/environmentHttp.ts:610`). It needs `orchestration:read` (`orchestration-v2/http.ts:156`) and returns the projects and a shell per thread. Each thread shell has `status` (idle or a run status), `pendingRuntimeRequest {id, kind, createdAt}`, `branch`, `worktreePath`, `latestRunId` and the latest run timestamps (`packages/contracts/src/orchestrationV2.ts:1904-1916`, `:1927-1964`, `:2030-2033`). This is the poll target for the status bar and approval prompts.
- **Thread routes:** `GET /api/orchestration/threads/:threadId` (`environmentHttp.ts:617`), `.../bounded` (`:625`) and `.../history` (`:634`), all `orchestration:read` (`orchestration-v2/http.ts:169`, `:184`, `:205`).
- **Other routes:** `GET /api/projects` (`environmentHttp.ts:645`, `orchestration:read`), `POST /api/projects/mutate` (`:652`, scope depends on the mutation), `POST /api/pull-requests/diff` (`:662`, `orchestration:read`).
- **Auth routes** (`environmentHttp.ts`): session (`:457`), browser-session (`:464`), `/oauth/token` (`:471`), websocket-ticket (`:479`), pairing-token (`:486`, needs `access:write`, `apps/server/src/auth/http.ts:434`), pairing-links (`:494`, needs `access:read`, `auth/http.ts:459`), clients and revoke (`:509-527`). Discovery is `/.well-known/t3/environment` (`:450`).
- **Gaps:** no HTTP route for a per-thread git diff or worktree status. Answering an approval is not among these routes; `t3_pending_request_respond` on `/mcp` does it (section 4, two credentials). Update 2026-10-13: docs/APPROVE.md found that /mcp cannot approve at all and that the web UI sends `runtime-request.respond` over the orchestration WebSocket, which the pairing bearer with `orchestration:operate` may do too.
- **Still open:** whether `/api/orchestration/threads/:threadId` lists the files the agent changed.

### 7. Pairing link dialog: ANSWERED (from source, 2026-10-12)

- **Where:** Settings, Connections, "Create link" (`apps/web/src/components/settings/ConnectionsSettings.tsx:1110-1215`).
- **Fields:** "Client label (optional)" (`:1127-1138`) and scope checkboxes (`:1182-1202`). There is no TTL field; the server default of 5 minutes applies (`apps/server/src/auth/PairingGrantStore.ts:254`, `:408-410`). The request body is `{label?, scopes?}` (`packages/contracts/src/auth.ts:455-458`).
- **Presets:** "Read only" = `orchestration:read`, `filesystem:read`, `diagnostics:read`, `terminal:read` (`ConnectionsSettings.tsx:1148-1164`). "Standard" = `AuthStandardClientScopes` (`:1165-1178`): `orchestration:read`, `orchestration:operate`, `settings:write`, `providers:manage`, `environment:maintain`, `preview:operate`, `diagnostics:read`, `terminal:read`, `terminal:operate`, `source-control:write`, `filesystem:read`, `filesystem:write`, `relay:read` (`auth.ts:205-219`). Standard is the dialog default (`ConnectionsSettings.tsx:1044-1046`).
- **Limits:** the checkboxes offer only the creator's own scopes (`delegatableScopes`, `:1047`, `:1182`). Creating a link needs `access:write`, in the page (`:1054`) and on the server (`apps/server/src/auth/http.ts:434-445`). With no scopes sent, the server uses Standard (`:435`).
- **For us:** decision 3 (full scopes) means the Standard default, minted from the desktop app, whose session has `access:write`. A panel signed in with Standard cannot mint links or approve `/mcp` clients in one click (question 3).

## 6. Next steps

1. Done (round 1, 2026-10-11): questions 1 and 2 answered as far as reading and GET probes allow. The frame-in-webview cookie question needs the spike.
2. Done: Codex reviewed `docs/PLAN.md` (review R1 to R8 in that file). The build phase started on 2026-10-12.
3. Done (round 2, 2026-10-12): questions 3, 4, 6 and 7 answered from source at `d07a07f3`; live re-probe of `.2994` (question 1).
4. Done (build run 3, 2026-10-12, commit `dce3ffb`): the first gates of spike Piece 1 per `docs/PLAN.md`. The scaffold is committed: `package.json`, `extension.js`, `t3.js` (the T3-facing layer: discovery, session check, token exchange, forwarder) and `scripts/selfcheck.mjs`, plus `.vscode/launch.json`, `.vscodeignore` and `media/t3.svg`. Real pairing worked, and the spike gates "panel loads signed in" and "WebSocket works" are proven live without the owner (section 5, question 2, live results). Current state lives in `docs/STATUS.md`; the Codex plan review in `docs/PLAN.md`.
5. Next: the owner's test session in the real panel for the remaining gates (section 5, question 2, "Still OPEN after run 3"). The owner also decides decision 1 (plain clicks).
6. Then harden `t3.js`: the re-pair flow when the session ends, and T3 restarts.
7. Then build Piece 2 (the VS Code context MCP server) and the file-click handling of decision 1. Then decide whether Piece 3 is needed; its feed is question 6.

## 7. Sources

- Issues: https://github.com/pingdotgg/t3code/issues/2713, /1453, /14267, /14624, /12041
- Discussion: https://github.com/pingdotgg/t3code/discussions/7041
- VSmux: https://github.com/maddada/VSmux
- t3code-extensions: https://github.com/maddada/t3code-extensions
- t3code-canvas: https://github.com/Noisemaker111/t3code-canvas
