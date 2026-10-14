> Archived 2026-10-14. This extension (T3's web page inside VS Code) is retired by owner decision 17. The project continues as a fork of busFred/t3-vscode with our features on top: https://github.com/Fundryi/t3-native-vscode (on disk D:GIT	3-native-vscode). Nothing here is built on any more.

# Status

The one file to read after a restart, a compaction or a new chat. Keep it short. Newest entry first in "Log". "Now" is always the current truth.

## Resume notes (rewritten 2026-10-13 16:23, before a compaction)

Read this block first after a compaction or a new chat. Then "Now", "In flight", the Codex test list, "Log".

### Owner's standing orders (2026-10-13)

- "You continuously work on improving this nonstop." Work autonomously and in parallel (Opus builders in git worktrees, never Fable as a subagent, Sonnet only for mechanical edits), no permission prompts (.claude/settings.local.json sets bypassPermissions). Questions only for real owner decisions; batch them in the Log and in the last message.
- The owner came back to the PC at about 16:05 (Firefox, Discord). Pointer tests need an idle desktop: the cron job below restarts them; if the cron is gone after a restart, recreate it (every 30 min: run idle.ps1; idle over 10 min and the re-run still pending -> start the driver re-run agent with the brief in the Log entry "driver re-run brief").
- The owner's second Claude session leaves uncommitted edits in AGENTS.md, docs/DRIFT.md, docs/T3-UPDATES.md, scripts/references.mjs: never commit or touch those (always `git add <files>`, never `git commit -a`).

### How a worktree slice is merged (used eight times today, keep it)

1. `git -C <worktree> diff HEAD > %LOCALAPPDATA%/Temp/t3probe/wt-<name>.patch`, then in main `git apply --3way <patch>` (apply is atomic: when one file is still unmerged the whole patch is rejected; then apply the rest with `--exclude=<file>` after resolving).
2. Conflicts so far were only side-by-side edits in panel.js's header comment, its host whitelist, and track() in extension.js: keep both sides. Resolve with a node script using exact anchors, never a multi-line regex over a whole file.
3. Run with T3VSCODE_HOME set to a temp dir: the four selfchecks (ALL PASS), the ASCII scan of the changed files, the facts check (every t3-facts.json entry's grep string found under reference/t3code), `node scripts/livecheck.mjs` (0 failed), then the activation smoke when package.json changed.
4. `git add <the slice's files only>`, commit with the counts in the message, `git worktree remove --force <wt>`, `git branch -D <branch>`, mark the rows in docs/BACKLOG.md (edit the status cell by line), update STATUS, commit.

### State of the tree (20:02, before a compaction)

- Everything of ours up to 9154ba9 is committed; no worktree open. Release 0.1.1 is packaged (t3-vscode-0.1.1.vsix, gitignored) and installed in the owner's VS Code (fundryi.t3-vscode@0.1.1, live after a window reload); the owner uses it live now and reports what breaks. Checks at 65c50e5: selfcheck 100, mcp 66, panel 65, ext 114, livecheck 41, 198 facts.
- New reference (62491a1): reference/busFred-t3-vscode, another author's native T3 client (MIT, Marketplace hungtienhuang.t3-vscode). The owner wants its good ideas taken over (sessions navigation, pairing through the t3 CLI, usage meters). Round 3 from busFred is committed (BACKLOG rows Q1 to Q15). Nothing in flight. Next: build Q1 to Q5 top down with worktree builders (Q4 starts with a live check: our thread list drops subagent threads at t3.js:221, so a subagent approval may never toast); Q2 runs the t3 CLI only on the owner`s button press; then the rest of round 3.
- Owner questions open: (1) a real Shift-drag onto the T3 chat in our panel and onto the Claude Code input (asked 21:10; VS Code blocks every drag over a webview unless Shift is held, Log 21:26), plus the pick: Shift-drop with the hint (lead pick) or a native Drop files here strip (a tree view takes plain drags); (2) a LICENSE file (MIT suggested); (3) the Marketplace id and display name: t3-vscode and T3 VSCode are busFred`s, and our display name T3 Code is T3`s own product name; proposals t3code-companion / T3 Companion (lead pick) or t3-panel / T3 Panel for VS Code; (4) B24 panel side.
- Also pending: the driver re-run of tests A to K when the desktop is idle (cron 4d29a318); round 3 Q1 to Q5; R19, B32; the one full Codex review.
- Owner (21:50): "it is not working at all still"; proposes to fork busFred/t3-vscode, merge his upstream, and put our features on top; wants a plan and scope for tomorrow, nothing built today. The plan is docs/SWITCH.md (facts, three options, lead pick: not A, B plus a native drop strip; the first day if A). Owner (21:52): option A, a native VS Code UI, no web page in VS Code at all; decision 17 in HANDOFF; docs/KICKOFF.md section 6 is the start for 2026-10-14. Nothing built tonight. This repo becomes the archived old version once the fork runs. The pointer re-run cron (4d29a318) was deleted at 22:05: the old extension is not worth a driver run any more; the round 3 rows Q1 to Q15 go to the fork as feature ideas, not to this repo.

### Then, in this order

1. The pointer re-run when the desktop is idle (tests A to I). Fix what fails (small ones by the lead, bigger ones by an Opus builder in a worktree); R26 gets built only if test F shows no image chip.
2. R31 (T3 literals into t3.js), then R29 with a live test, then R30 if ever.
3. Keep STATUS, BACKLOG, FEATURES and the facts file current in the same commit as the code. Review any new `Status: unreviewed` block in docs/T3-UPDATES.md before touching t3.js (the second session usually does it within the hour; else the lead does, per AGENTS.md).

### Working rules that every run used (keep them)

- One writer per file per run; builders in git worktrees when another agent or Codex may be using the main tree. The owner must not get a worktree prompt (2026-10-13 evening): the lead creates the worktree itself with `git worktree add .claude/worktrees/<name> main` and hands the agent that path in the brief (no `isolation` flag on the Agent call); the allow rules `Agent(isolation:worktree)` and `EnterWorktree(*)` are in .claude/settings.local.json as a second guard; the lead merges by patch (`git -C <wt> diff HEAD | git apply --3way`), never `git merge` of a worktree branch with foreign files.
- Every slice: builder, then the lead runs the four selfchecks (T3VSCODE_HOME set to a temp dir), `node scripts/livecheck.mjs` (a real isolated VS Code, about 40 s, unpaired), the ASCII scan, the facts check and the activation smoke (%LOCALAPPDATA%/Temp/t3probe/vscode-smoke/launch.ps1, result.json), then commit. Decision 13: no Codex review per slice. Adversarial review by an Opus agent for anything touching auth, sockets or T3 writes (B14 got one).
- The Workflow tool's agent() inherits the main model (Fable): always pass model 'opus' and agentType 'general-purpose' there; builders there tend to skip StructuredOutput, so prefer plain Agent calls with worktree isolation for builds and use Workflow only for review fan-outs.
- Agents never run the t3 CLI, never POST to T3, never mint tokens, never touch reference/. Live checks use GET with bearer 'invalid'. The product itself may write (pairing, project create, approvals).
- Commit per passing step, never push. The privacy guard blocks real repo names and email-like strings (an at sign in a file name counts; spell it out).
- Read the dev window log from disk yourself: newest %APPDATA%/Code/logs/<session>/window<N>/exthost/output_logging_*/<N>-T3 Code.log. The render pipeline for panel design: node %LOCALAPPDATA%/Temp/t3probe/render.js -> shot/*.png.
- Shell gotchas: heredocs and sed mangle backslashes and quotes; write files with the Write tool and apply multi-line edits with a small node script using exact split/join anchors (the t3probe/*.js pattern); a regex over a whole markdown file once ate the file head (548036a repaired it): edit table cells by line, never by a multi-line regex.
- Live facts: T3 nightly .3042 is running at http://127.0.0.1:3773 (reference/t3code is at .3053, 6524a8d4, reviewed); `~/.t3/userdata/server-runtime.json` has the origin; the server log `~/.t3/userdata/logs/server.trace.ndjson` (UTC) shows auth events.

## Now (2026-10-12 evening, build phase, product usable, quality-of-life slices)

- Phase: build. Lead: Claude (Fable) orchestrating; subagents Opus/Sonnet; reviews by Codex (`gpt-6.1-sol`, fast, high effort).
- Sync contract (every shared state, build order): `docs/SYNC.md`. Decisions: `docs/HANDOFF.md` section 1.2. Goal map: 1.1. Feature checklist: `docs/FEATURES.md`. Spike plan and both Codex code reviews: `docs/PLAN.md`. Piece 2 design with the Codex review folded in: `docs/PIECE2.md`.
- Running T3 and reference commit: the newest block of `docs/T3-UPDATES.md` (its header is the reference, its Status line names the build the live facts were closed against).
- Code at commit ce22ce6: t3.js (T3 layer: discovery, session, pairing, forwarder with the injected script, projects, threads), panel.js (the page: header, quick pick, details, pairing form), extension.js (VS Code side: refresh, openFile, messages, ports, secrets), mcp.js, bridge.js, context.js (Piece 2). Selfchecks: 70 + 29 + 22 + 28.
- Quality of life (docs/QOL.md, ordered list at its end): items 2 (terminal toggle hidden) and 3 (remembered thread of a nested project or worktree survives a restart) built in ce22ce6; items 7 (Ctrl+Esc both ways), 1 base (T3: Add to prompt) and 4 (Alt+K selection) built in slice 2. Item 1 drop (Shift-drag onto the panel) built in 508bebd, item 6 (open in the T3 app, fourth toolbar icon) after it. Item 5 (status bar, badge, needs-you notification), then slice 3 (aa98b82: theme, Ctrl+Shift+P, New thread command, mention queue, status colour, openOnStartup). Piece 2 slice 1 tools built (faa01fd). None live-tested. Selfchecks now 78 + 40 + 36 + 50.
- Proven without the owner: the extension activates in an isolated VS Code; with a real bearer the forwarder passes `/ws` (101) and the real panel signs in, opens the socket and loads T3 on `/` and on a deep path; Electron sends `sec-fetch-dest: iframe`, so the browser-navigation guard stays.
- The temporary bearer file is deleted. The session "VS Code" minted at 09:35 still exists in T3 (Settings, Connections); the owner may revoke it.
- Not yet done by anyone: the owner's own test in their real VS Code (pair, send a message, see it stream, see it on the phone, reload). A1 (plain frame keeps the cookie) is untested and optional.

## Done

- 2026-10-11: HANDOFF Q1 and Q2 answered, PLAN.md written, Codex review R1 to R8, owner decisions 1 to 7. Commits 43b5d41 to 2122c2f.
- 2026-10-12 run 1: Codex review folded, `docs/FEATURES.md`, T3 research (open-in-editor truth, deep links, /mcp access levels, Piece 3 feed, pairing dialog), scaffold built and verified. f3dad48.
- 2026-10-12 run 2: fixes F1 to F5, S1, S6; bundle re-check for .2994; HANDOFF Q3, Q4, Q6, Q7 answered; smoke test activates. bde3bad.
- 2026-10-12 run 3: `onRequest` hook; A2 proven live; real panel signs in; Sec-Fetch verdict. dce3ffb, d8e4a6e.
- 2026-10-12: Codex code review 1 (3f4f2c3), Piece 2 design draft and HANDOFF Q5 answered (9bc6594), Codex design review folded (1b8214d, dde7283).
- 2026-10-12 run 4: C1 to C8 and N1 to N3 applied, re-verified. 539cbab.

## In flight

| Item | Who | Writes | State |
|---|---|---|---|
| cron 4d29a318 | lead | restarts the driver re-run (tests A to F plus G, H, I below) when the desktop is idle | every 30 min |
| R: Codex review fixes, two pages and roots (correctness 1, 2, 5, 6, 9, 10, 12) | Opus, worktree | extension.js Panel core, t3.js threadsFor and keydown, selfchecks | running since 18:44 |

## Waiting on the owner (the rundown)

1. Quick pick and fast switch: Ctrl+F5 in the t3-vscode window. Click the thread title in the panel header: a list opens with a search box. Type part of a title or the start of a thread id, pick with Enter or a click. Expected: the chat switches in about the time T3's own sidebar takes (no full page reload); the title in the header follows. Also: Escape closes the list; a click into the T3 page closes it. Report pass or fail, and say if a switch still feels slow (then the fallback reload fired; the T3 Code output log says "Panel: switch fell back to a reload").
2. Fresh project (if not done yet): in the T3 desktop app, Settings, Projects, delete the project t3-vscode; Ctrl+F5; expected "Opening the first thread in t3-vscode", then "What should we build in t3-vscode?".
3. Register our MCP server in CC Switch ("T3: Show MCP setup" shows the entry), or say that the extension should register itself.
4. Restart test (QOL item 3): in the panel, pick a thread; close VS Code fully; open it again on this folder. Expected: the panel opens on that thread. The lead reads the "Project: <folder> -> <path>" line from the dev window log on disk afterwards, so just say pass or fail. Also: T3's terminal button at the top right is gone (QOL item 2); say if it is still there.
5. Keys and prompt (slice 2): in an editor, press Ctrl+Esc: the cursor should land in T3's composer. Press Ctrl+Esc again inside T3: back in the editor. Right-click a file in the Explorer, "T3: Add to prompt": a file chip appears in the composer (if not, a message says it is on the clipboard: press Ctrl+V in the composer and say that). Select some lines in an editor, press Alt+K: the chip plus "lines a-b".
6. Drop: hold Shift, drag a file from the Explorer onto the T3 panel, release over the chat. Expected: a file chip in the composer. If nothing happens, say so; the lead reads the "drop types:" line from the dev window log on disk.
7. The fourth icon in the panel header (a box with an arrow) opens the current thread in the T3 desktop app. VS Code may ask once whether the extension may open a t3code: link; allow it.
8. Status: send a prompt in T3 that takes a while; the status bar item at the bottom right should read "T3: running" with a spinner within 4 s, and "T3" again when it ends. Hover it: one line per running thread. When T3 asks for an approval while the panel is hidden or VS Code is not the focused window, one notification "T3: <title> waits for you" with a Show button should appear, and the panel icon in the activity bar gets a badge. Say which of these you saw.

## Live test handoff for Codex (computer use), written 2026-10-12 20:47

The owner does not want to run these by hand. Hand them to Codex through /codex:handoff with computer use, one session, in this order; each test has the exact place and the expected result. Codex reads the dev window log on disk after each test (newest `%APPDATA%/Code/logs/<session>/window<N>/exthost/output_logging_*/<N>-T3 Code.log`) and reports the lines, so the lead never guesses. Codex must not change code, T3 settings or T3 data, and must not run the t3 CLI.

Proven without a pointer since 32d73ba by `npm run livecheck` (do not repeat by hand): activation and every command, the panel view, Fix with T3, the TODO lens and its setting, all ten MCP tools incl. the action tools, the palette commands unpaired. Codex computer use needs an idle desktop (2026-10-13 09:12: "failed to activate captured window" while the owner typed). What is left for a pointer: tests 1 to 10 and 12 to 16 below as far as they touch T3's page, keys, the status bar or the theme.

Setup: open D:/GIT/t3-vscode in VS Code, press Ctrl+F5 (not F5), wait for the dev window, open the T3 panel (activity bar icon "T3"). The pairing is stored; if the panel asks to pair, stop and report.

1. Drop (the owner's open complaint). Hold Shift, drag README.md from the Explorer onto the T3 chat area, release. Expected: a file chip in the composer. Then read the log: lines "panel drag types:", "drag types:", "drop types:" and "Add to prompt:". Report all of them verbatim. Repeat once without Shift and report whether any line appears.
2. Add to prompt: right-click README.md in the Explorer, "T3: Add to prompt". Expected: a chip. If an information message says "on the clipboard", report it, press Ctrl+V in the composer and report whether a chip appears.
3. Alt+K: open extension.js, select lines 10 to 12, press Alt+K. Expected: a chip followed by "lines 10-12". Report the exact text in the composer.
4. Ctrl+Esc: with the cursor in an editor press Ctrl+Esc. Expected: the cursor lands in T3's composer (type a letter to prove it, then delete it). Press Ctrl+Esc again: expected back in the editor. If the Windows Start menu opens, report that.
5. Quick pick: click the thread title in the panel header, type the first four characters of another thread's id, Enter. Expected: the chat switches in about one second without a full reload (the header title changes, the page does not flash white). Log line to report if present: "Panel: switch fell back to a reload".
6. Restart: pick a thread, close VS Code fully, start it again on the same folder (Ctrl+F5 again from the main window). Expected: the panel opens on that thread. Report the log line "Project: ... -> ...". Also report whether T3's terminal button (top right of T3's page, a panel icon) is visible.
7. Open in app: click the fourth header icon (box with arrow). Expected: the T3 desktop app comes to the front on the same thread. Allow the t3code: link if VS Code asks.
8. Status: send "count to 20 slowly" in T3. Expected: the status bar item at the bottom right reads "T3: running" with a spinner within 4 s, "T3" again at the end; hover it and report the tooltip text. Not tested: the needs-you notification (needs an approval request).
9. Theme: switch VS Code to a light theme (Ctrl+K Ctrl+T, pick "Light Modern"). Expected: T3 inside the panel turns light within a second; back to Dark Modern: dark again.
10. Palette: click into T3's page, press Ctrl+Shift+P. Expected: VS Code's command palette opens (not T3's "pin thread"). Escape. Then open the palette and run "T3: New thread". Expected: a new empty thread in the t3-vscode project, the header title changes.
11. MCP tools (needs the bridge registered in CC Switch, rundown item 4; skip if not): in a T3 thread of this project ask the agent to call the vscode MCP tools openTabs, diagnostics and gitState and to quote the raw results. Expected: the tabs you have open, the Problems panel entries, the branch "main" with the changed files of the Source Control view.
12. Keys and menus (slices 4 and 5): with the panel visible and the cursor in an editor, Ctrl+Esc and Alt+K are ours (test 3 and 4); close the panel, press Ctrl+Esc: expected the Claude Code extension's action, not ours. Right-click selected text in an editor: "T3: Add selection to prompt" is in the menu. Ctrl+Alt+T: the thread quick pick opens. Inside T3's page: Ctrl+P opens VS Code's quick open, Ctrl+J toggles VS Code's panel, Ctrl+Backquote the terminal. Palette: "T3: Show logs" shows the output channel; "T3: Open T3 settings" shows T3's settings page in the panel.
13. Fix with T3: open extension.js, add a line "const x = ;" to make a Problem, hover the squiggle, click the light bulb: "Fix with T3: ..." is listed; click it: the composer gets the file chip plus "line N: <message>". Undo the edit.
14. Relative chips: in a T3 reply that mentions a file by relative path (a mention chip in a message, or a file title in T3's diff panel), click it: the file opens in VS Code. Log line to report: "Click in T3 (no file chip)" if nothing opened.
15. Startup status: close the panel, close VS Code, open VS Code on this folder, do not open the panel, send a prompt from the T3 desktop app in this project. Expected: the status bar reads "T3: running" within 30 s without the panel ever opening. Then click into the terminal, select some text, right-click: "T3: Add terminal selection to prompt" puts it into the composer as a code block.
16. Slice 6: make a file dirty (type a character, do not save), send any prompt in T3: expected the file saves itself (the dirty dot goes away) and the log says "Saved 1 files before T3 sent the prompt". Open a file with a "// TODO" comment: expected an "Implement with T3" lens above it; click it: the composer gets the chip plus the TODO text. In T3's diff panel, Alt+click a file title: expected VS Code's diff view of that file (report if the plain file opened instead). Source Control view, the "..." menu: "Review changes with T3" puts a review prompt into the composer. The panel's view title shows three icons (plus, list, open external); click each once.
17. B9 and B11: in a T3 reply with a one-line shell code block, click its Run in terminal button: expected a VS Code terminal named T3 shows the command typed, not run. In T3's settings inside the panel, set Notifications to on, hide the panel, send a prompt from the T3 app and wait for it to finish: expected one VS Code notification with Show; the log has "T3 notification: ...". If T3's settings offer no notification mode, report that (isSecureContext).
18. Approval (B14): in the T3 desktop app start a prompt in this project that needs an approval (for example ask the agent to run a shell command with approvals on); hide the VS Code panel or unfocus VS Code; expected one notification "T3: <thread> needs approval (command): <command>" with Approve, Deny, Show; click Deny; expected the request in T3 shows as declined and the log has no bearer or ticket; click Show on a second one: the panel opens on that thread.
19. Fresh project (last, it changes T3 data; skip unless the owner allows): in the T3 app, Settings, Projects, delete the project t3-vscode; Ctrl+F5; expected "Opening the first thread in t3-vscode", then an empty composer.

## Next after the owner's test

- Run 7 (queued behind run 6, same file): decision 9, pairing and session status inside the panel, native look (HANDOFF 1.2).

- Decision 8: done in run 5 (00ca4c7), pending Codex review 3 and a live renewal test when a session gets near expiry.

- Hardening: done in run 5; a real T3 restart with the panel open is still untested.
- Piece 2 slice 0 per `docs/PIECE2.md`: server, stdio bridge, discovery, `workspace` and `activeFile`, exact Claude and Codex entries, real calls from T3-started threads.
- Decision 1 handling on our side (reveal listener), then Piece 3 polling of `/api/orchestration/shell`.

## Known issue: F5 closes the window

On 2026-10-12 the owner's F5 (debugger attached) opened the Extension Development Host and it closed itself within seconds. The main log shows the dev window's extension host crashed with code 134 twice (11:23:54, 11:24:01). Right before, the debugger's Node network inspector threw `TypeError: Missing dataLength in event` in `node:inspector` while other extensions made HTTP calls, before our panel was even open. Starting the same window without a debugger (Ctrl+F5, or `Code.exe --extensionDevelopmentPath=...`) does not crash. Workaround: Run Without Debugging (Ctrl+F5). If debugging is needed, try the user setting `debug.javascript.enableNetworkView: false` (name not verified on this build). Not caused by our code as far as the logs show.

## Log

- 2026-10-12 20:20 (real clock) owner: quick pick highlighted the wrong row (fixed, 1 line plus a check); wants drag and drop references, T3 chrome hidden (terminal button), state across restarts. QOL scoping agent started (docs/QOL.md).

- 2026-10-12 20:00 (real clock) owner: header looks better; switching reloads and is slow, wants a search list like Codex. Built: in-place switch with proof by the header title, quick pick with token search (NAV.md section 5). Rendered and checked.

- 2026-10-12 19:10 (real clock) owner: nav bar works (1 to 3 ok) but looks bad. Header restyled as one VS Code toolbar (837cb4b), rendered and checked through Edge headless.

- 2026-10-12 18:05 (real clock) navigation bar and landings committed (259c0c7). Drift block .3021 reviewed. Owner test next.

- 2026-10-12 17:50 (real clock) owner: the chip click works. New asks: a native navigation bar (this project's threads, New thread) and better landings (folder expand). docs/NAV.md written, decision 14, builder started.

- 2026-10-12 17:40 (real clock) chip click cause found in the dev-window log (plain link, no data-slot), fixed. Owner retest next.

- 2026-10-12 17:20 (real clock) owner: no Codex audit per slice any more (decision 13). Rules updated in AGENTS.md, HANDOFF 1.2 and this file.

- 2026-10-12 17:15 (real clock) palette flow committed (Codex review 2 folded: post-check, project row only, drive letter, open-palette guard). Codex code review started.

- 2026-10-12 17:10 (real clock) research 2 in (e7f31df): command palette flow, identity by root path. Builder and Codex design review started in parallel.

- 2026-10-12 17:00 (real clock) owner live test of row 1: project binding works after Reload; the first automatic thread failed once (index landed on the home project); Reload keeps state; the nightly box is gone; a plain click on a file chip still opens T3's preview (diagnostic added, owner to send the log line). Research 2 started.

- 2026-10-12 16:45 (real clock) Codex re-review 2: C2, C4 to C6 fixed; C1 fixed in the follow-up commit; C3 recorded as a limit. Row 1 closed on our side.

- 2026-10-12 16:30 (real clock) row 1 fixes committed. Codex re-review started.

- 2026-10-12 16:25 (real clock) row 1 verified (FAIL: silent timeout) and Codex-reviewed (C1, C2 block; C3 to C5 should fix). Fixer started.

- 2026-10-12 16:05 (real clock) row 1 committed (142b710). Verifier and Codex code review started.

- 2026-10-12 16:15 (real clock) Codex design review of PROJECT.md in (8 findings), lead decisions written (46d347d). Row 1 builder started.

- 2026-10-12 16:05 (real clock) docs/PROJECT.md: research done (projects over HTTP, no project URL, thread URL exists, home-folder project wins /). Lead decisions written. Codex design review started.

- 2026-10-12 15:50 (real clock) docs/SYNC.md written: the sync contract in both directions with build order; row 1 (the open folder) is first.

- 2026-10-12 15:40 (real clock) owner: new thread in the panel ran in the home folder, not the open VS Code folder. Decision 12 (panel follows the VS Code folder). Research started. launch.json now opens the project in the dev window (fcb4f0e).

- 2026-10-12 15:30 (real clock) Codex re-review 2: ready for the owner's click test. Slice 1 closed on our side.

- 2026-10-12 15:20 (real clock) slice 1 verified (one blocker: POSIX paths) and Codex-reviewed (10 findings); all fixed in fcca65e, 101 checks pass. Codex re-review started.

- 2026-10-12 16:00 injection slice 1 committed. Verifier and Codex code review started.

- 2026-10-12 16:45 drift check built (Codex review R1 to R12 folded, docs/DRIFT.md). First block .2980 -> .3010 reviewed: nothing to do. AGENTS rule added, CLAUDE.local.md points at the log.

- 2026-10-12 15:35 Codex design review of INJECT.md in (10 findings, 5 must change), lead decisions written (3cf4ab8). Slice 1 builder started.

- 2026-10-12 15:40 docs/DRIFT.md written: nightly drift check (owner request). Found that nobody reviewed the .2980 -> .2994 -> .3010 bumps; t3.js still rests on .2980. Codex review next, then build.

- 2026-10-12 15:20 proven in the isolated VS Code: iframe localStorage survives a restart (HANDOFF 5.2). Stable port design holds.

- 2026-10-12 15:00 docs/INJECT.md written (chips by data-slot and href, popup key seeded, stable port). Codex design review started.

- 2026-10-12 14:50 decision 10 built: bridge falls back to the last focused window, result says fallback (26a037c).

- 2026-10-12 14:35 Codex review 6 in: done, no blocker, G1 tradeoff accepted. Piece 1 closed.

- 2026-10-12 14:20 owner decisions: inject a smart script (file clicks, hide the nightly mobile box), stable forwarder port, unmatched window stays an error. Research for docs/INJECT.md started (Opus). MCP not yet registered in CC Switch.

- 2026-10-12 14:10 owner: stream, phone, reload, two-window Forget all pass. Piece 1 gates closed.

- 2026-10-12 13:55 the owner confirms the new panel works and looks right (paired, card, T3 page). Scope words for access:read and relay added (5afabae).

- 2026-10-12 13:45 review 5 in (55e57ee): F1 to F7 pass, G1 and G2 new. Fixed with the F7 origin guard (a5b5e23). Review 6 started.

- 2026-10-12 13:10 fixes F1 to F7 committed (a123ab8), Codex review 5 started.

- 2026-10-12 12:50 Codex review 4 in (e6fe89b): F1 still blocks (pair and renew races), F2 to F7 should fix. Two Opus fixers started.

- 2026-10-12 13:40 commits 20b5221 (Piece 2 slice 0) and 8b9d540 (panel UI, D1 to D4). Codex review 4 started. Panel ready for the owner to look at.

- 2026-10-12 12:30 Codex review 3 in: D1 blocks (late renewal can undo Forget or a new pairing). Queued behind run 7. Runs 6 and 7 in flight.

- 2026-10-12 12:05 run 5 committed (00ca4c7). Codex review 3 started.

- 2026-10-12 11:35 A1 failed as predicted in the owner's real VS Code; the forwarder stays. Owner revoked the morning session.

- 2026-10-12 11:30 F5 crash diagnosed as the debugger's network inspector; Ctrl+F5 is the workaround.

- 2026-10-12 11:20 Codex review 2 in (6aaaed0), selfcheck V1 repaired, entry points fixed (ac9ce7e). Run closed; rundown sent to the owner.
- 2026-10-12 10:55 commit dde7283 (PIECE2 folded), 539cbab (code after review), Codex re-review started.
- 2026-10-12 10:20 Codex design review of PIECE2 in; HANDOFF Q5 corrected (user MCP loads).
- 2026-10-12 10:00 run 3 done: A2 proven, panel signs in. Bearer file deleted.
- 2026-10-12 09:35 owner pasted a pairing code; exchanged for a bearer; session verified.
- 2026-10-12 09:30 bde3bad scaffold. 09:10 f3dad48 docs. 08:45 run 1 started.

### 2026-10-12 19:58, QOL slice 1 built (ce22ce6), slice 2 started

- docs/QOL.md committed (49f1ee3): seven items with facts from the T3 source and the installed VS Code, ordered by value for effort.
- Items 3 and 2 built by the lead (ce22ce6), checks 70 + 29 + 22 + 28, smoke ok. Item 3 was done as an override in refresh after ensureProject (the doc proposed threadsFor first; that would add a shell call on every failed bind and break the "no threadsFor without a bound project" rule).
- QOL slice 2 brief for the Opus builder: build items 7, 1 (base only: command t3vscode.addToPrompt in explorer/context and editor/title/context, the t3vscode:mention message through panel and script, T3's application/x-t3code-composer-mention drop on [data-chat-composer-form], the clipboard fallback) and 4 (t3vscode.addSelection, Alt+K when editorTextFocus, chip plus "lines a-b", then focus the composer) exactly as docs/QOL.md designs them. Every new message reaches the script, the panel's fromFrame branches and the host whitelist, the panel.js header comment, and onDidReceiveMessage. Facts for every new T3 selector or event. Extend the existing selfchecks (vm harnesses) for the new script branches, the panel relays and the extension commands. No drop handling yet (item 1 drop needs a live check of the drag types first). ASCII only, no em dashes, no curly quotes. Do not commit; the lead runs the checks and commits.

### 2026-10-12 20:08, QOL slice 2 committed

- Opus builder delivered items 7, 1 base and 4 as docs/QOL.md designs them. Lead reviewed the diff (clipboard writes only while a mention is pending; the one key name; host whitelist extended), ran the four selfchecks (73 + 29 + 24 + 33), the ASCII scan (the non-ASCII in two selfchecks is older test data) and the activation smoke (the three commands registered). Committed.
- Builder notes worth keeping: T3's link label is the escaped basename (`\ [ ]` escaped, the parser unescapes); a mention sent before the frame's script runs gets no result (shortcut comment in extension.js `mention`); ok:true means T3 canceled the drop, not that the chip rendered.
- Not live: frame.focus() across origins, a script-built DragEvent carrying a DataTransfer, the trailing "lines a-b" text staying after the chip, Ctrl+Esc reaching VS Code on this PC.

### 2026-10-12 20:20, QOL item 1 drop committed (508bebd)

- Opus builder delivered the drop. Lead changed two things before the commit: text/plain (every item) is read before text/uri-list (the first item only), and T3's own tree drag no longer logs a "drop types:" line. Checks 75 + 29 + 25 + 34, smoke ok.
- Open live questions: can the cross-origin T3 frame read VS Code's custom drag types; does dropEffect copy match the drag (a mismatch cancels the drop silently, then no "drop types:" line appears at all).

### 2026-10-12 20:35, QOL items 5 and 6 committed; the whole QOL list is built

- Item 6 by the lead (4d86bcb): a fourth toolbar icon and t3vscode.openInDesktop with t3code://threads/<env>/<thread>.
- Item 5 by an Opus builder, reviewed and committed by the lead. Builder notes worth keeping: activeRunId stays set for any interruptible run, so a failed latest run can still look active; the failed warning fires on the change only. The tooltip is a plain string with newlines (may need a MarkdownString if the hover shows them on one line). The baseline resets on every refresh, so a request arriving during a refresh is not announced.
- The owner's rundown now has eight tests. Nothing is live-tested since 53af874 (the quick pick highlight fix).

### 2026-10-12 20:47, drop did not work for the owner; tests go to Codex tomorrow

- Owner tried a drag and drop into the panel: nothing. The dev window started 20:39 (after the drop commit), its log has no drop or drag line, so no drop event reached the frame: either no Shift held (VS Code sets pointer-events none on webviews during a drag unless Shift is held, QOL.md item 1), or the cross-origin frame does not see VS Code's custom types and never prevented dragover. 093794c covers both views: text/plain alone with drive paths is accepted, and every drag logs its types once (frame and toolbar).
- Owner: no more long test lists; Codex with computer use runs them (handoff list above). Decision: live tests are Codex's job from now on, the owner only confirms the result.

### 2026-10-12 21:00, three agents in parallel (owner: parallelize, improve UX, Codex tests tomorrow)

- Owner: "work more on the UI/UX ... get information on how Claude and Codex work ... add it to an improvements list ... use the Opus sub-agent ... parallelize". Lead: one research agent (docs/BACKLOG.md), two builders on disjoint file sets (A: panel and extension side, B: MCP side). The lead keeps its hands off those files until each reports, then runs the checks and commits each separately.
- Decisions taken by the lead for slice 3: Ctrl+Shift+P inside the frame goes to VS Code (T3's pin-thread binding loses inside the panel); Ctrl+P stays T3's file picker. No "done" notification. openOnStartup default false.

### 2026-10-12 21:22, slices from builders A and B committed

- B (faa01fd): the three slice 1 MCP tools in context.js, selfcheck-mcp 40; PIECE2.md rows and SYNC row 5 updated to the built shapes. Not in a real window yet (Codex test 11).
- A (aa98b82): six items. Lead notes: the theme write overwrites T3's own appearance choice inside the panel (the panel follows VS Code, by design); the script uses stopImmediatePropagation for Ctrl+Shift+P because T3 has its own window capture listeners; t3vscode.newThread from a closed panel only focuses it (the bind comes later).
- Codex test list grew to 12 (theme, palette and New thread, MCP tools). Research agent R still running.

### 2026-10-12 21:25, backlog in, slice 4 and the FEATURES refresh started

- R delivered docs/BACKLOG.md: 32 rows in three groups, a do-not-redo list, five owner questions. Lead picks recorded in the file (keys stay with a panelVisible context key; VS Code wins four chords inside the panel; finished notification with a notify setting; placement later; MCP registration stays CC Switch only, B16 open).
- R's finding for the Codex tests: Ctrl+Esc is also bound by the Claude Code extension (same when) and by opencode (no when); Alt+K by Claude Code. B1 adds our context key; the Codex run shows who wins.
- Builders: P on the extension side (nine S rows), F on FEATURES.md. The lead keeps off those files.

### 2026-10-12 21:35, slice 4 and the FEATURES refresh committed; slice 5 and a docs pass started

- P delivered nine rows (06bc1bb). Lead changed one thing: the two commands that sit in right-click menus keep "T3: " in their title (VS Code shows the category only in the palette), the rest use category T3. Known limit: Switch thread and a vscode:// thread link from a closed panel only open the panel (the bind comes later); fix later with one pending slot if it bites.
- F refreshed FEATURES.md (de5f662) against c91b3b3; D now folds slice 4 into it and fixes the /mcp wording in SYNC row 13 and HANDOFF (the code polls the shell route).
- S builds slice 5. Codex test list: add slice 4 and 5 tests when S lands.

### 2026-10-12 21:57, slice 5 committed (866a038); slice 6 and the extra MCP reads started

- S delivered five rows. Lead changed one thing: the startup bind runs with read-only scopes, so no T3 project is created while the panel is closed (the panel's first open creates it as before). The builder's finding: T3 renders a message mention chip as a button (data-slot context-chip, label "Preview <path>"), diff titles as [data-title] text, and plain relative links only when T3 has no folder for the thread.
- Codex test list grew to 16 (keys and menus, Fix with T3, relative chips, startup status and terminal selection).
- U builds slice 6 (B18, B19, B20, B21, B30 and an internal open command so slice 2 can reuse openFile); Q builds B23 in context.js.

### 2026-10-12 22:13, slice 6 and B23 committed; stopped on the owner's word

- Owner (22:05): "do not start a new task. You can finish anything that you're still working on, but don't start new ones." The two running builders finished; both slices are committed (c90ae7b, c14d033). Nothing else was started.
- Slice 6 builder notes worth keeping: T3 sends without a form submit event (Enter calls submitComposer directly), so the sent hook watches the submit button click, Enter in the editor and a future submit; Enter in an empty composer also counts (an extra save is harmless). git.openChange returns silently for a committed file, so the diff command checks for a diff tab and falls back to vscode.open. The internal commands t3vscode._open and _diff are the plumbing for Piece 2 slice 2.
- Checks at c14d033: selfcheck 82, mcp 47, panel 41, ext 72; smoke ok; 106 facts found in the reference clone.

### 2026-10-13 09:11, Codex test run and three builders started in parallel

- Nightly bumped overnight to .3042; the owner's second session reviewed it (nothing to do), committed as 30e7937. Selfchecks at 30e7937: 82 + 47 + 41 + 72, 106 facts found at 5d6e4192.
- Owner: more parallel work. Lead: Codex tests the committed tree; two Opus builders work in git worktrees so the dev window Codex drives never sees half-done code; one research agent writes docs/APPROVE.md. Worktrees are merged after their checks pass.

### 2026-10-13 09:26, three results in, Codex blocked by the desktop, livecheck started

- W1 (a4e209b): the action tools openFile, revealInExplorer, showDiff; question 4 decided (never outside the workspace folders, normalized paths). Lead added the preview pass-through in extension.js.
- W2 (40d4c3f): Alt+click on Copy code inserts at the cursor; the walkthrough. Worktrees merged by patch and removed; .claude/worktrees gitignored.
- A (3a6ff08): docs/APPROVE.md. Finding: no HTTP route and no /mcp tool approves; the web UI sends runtime-request.respond over the orchestration WebSocket; the pairing bearer with orchestration:operate may do the same through a websocket ticket. HANDOFF section 5 and the B14 row were wrong about needing a second credential.
- Codex (09:12): zero tests ran; computer use cannot take the desktop while the owner uses it. Lead: a real-API check inside an isolated VS Code (livecheck) covers everything that needs no pointer or pairing; the pointer tests (drop, keys inside T3, chips) still need Codex when the PC is idle, or the owner for one minute.
- Owner: no permission prompts. .claude/settings.local.json sets bypassPermissions for this project.

### 2026-10-13 10:31, live check landed (32d73ba); B9 and B11 started

- The livecheck builder found no bug; 29 checks pass in a real isolated VS Code on a temp git repo, unpaired. The lead ran it on main before the commit. It is now part of every slice next to the four selfchecks.
- Not readable through the VS Code API: context key values, status bar items, real key presses. Those stay on the Codex pointer list.
- V builds B9 and B11 in a worktree.

### 2026-10-13 10:51, B9 and B11 committed (2d30433); the no-owner backlog is empty

- V's source finding: Run in terminal used to open T3's drawer and run the command at once on the T3 PC, with no toggle left to close the drawer (we hide it). Now it types into a VS Code terminal. The Notification shim only matters once the owner turns notifications on in T3's settings; T3 may hide that option when the frame is not a secure context (unverified).
- Every backlog row that needs no owner answer is built. Left: B14 (approve from a notification; question 1 in APPROVE.md), B16 (MCP button vs CC Switch), B24 (panel side), B32 (editor tab).

### 2026-10-13 12:55, owner decisions 15 and 16; B14 and B16 building

- Owner: approval notification with Approve, Deny and Show plus the request details; MCP registration native AND through CC Switch. Panel side not answered: stays.
- Lead: one Workflow run builds both rows in worktrees with an adversarial review and a fix pass each; the lead merges after its own checks.

### 2026-10-13 13:44, B14 merged (6a7cb70); Codex run 2 and backlog round 2 started

- B14 review: no logic bug; the fixer added the two missing facts, the nativeId guard, the late flag and ticket redaction, a warning with Show, Show only without request text, Already answered on a second click. Open: the request options are not checked (APPROVE.md step 3).
- The owner left; the desktop is idle; Codex drives the pointer tests now. Research round 2 runs in parallel (docs only).

### 2026-10-13 13:49, Codex run 2 blocked (native pipe gone); our own driver instead

- Codex report: %LOCALAPPDATA%/Temp/t3-vscode-live-run-2-2026-10-13.md, zero tests. The helper pipe of its computer use is gone (the owner probably closed the Codex app on leaving). Lead: build our own driver (PowerShell user32) and let an Opus agent run the pointer tests with screenshots; this removes the Codex dependency for good if it works. Code frozen meanwhile.

### 2026-10-13 14:03, round 2 backlog committed; X and Y building; D still driving the pointer tests

- Round 2 top finding (R1): a command used before the panel ever opened loses its action because refresh() clears the bind first; X builds the pending slot. R2: the Notification shim toasts every T3 thread and doubles the poll toasts. R3: the hidden terminal toggle leaves T3's drawer stuck open after a project script. R4: Run in terminal types into whatever terminal is active. R5: relative chips in a worktree thread open the main checkout's file.

### 2026-10-13 14:27, the pointer driver works; first live findings

- Our own driver (PowerShell + a small C# user32 helper, per-monitor DPI aware, screenshots viewed as one-frame videos because the agent has no image Read) opened the dev window with Ctrl+F5 and is past test 8. PASS so far: Add to prompt chip, Alt+K with lines, quick pick switch in 0.4 s without a reload, restart lands on the thread and the terminal button is hidden, open in app, status bar running. FAIL: test 1 drop (no "panel drag types" line even over our toolbar: the drag never reached the webview; a differential test against the Claude Code panel and the primary side bar was added) and test 4 Ctrl+Esc (Windows opens the Start menu; VS Code never sees Escape; builder K moves the chord to Ctrl+Alt+C as a toggle).
- Driver finding: the T3 desktop app runs elevated, so injected input never reaches it (UIPI); tests that say "from the T3 app" were done from the panel.
- X and Y are done in their worktrees; the main tree stays frozen until the driver closes the dev window; then merge Y, X, K by patch in that order (X and Y both touch extension.js; the builders kept their areas apart; K touches package.json keybindings and the script keydown).

### 2026-10-13 15:43, the live run is in; round 2 slices merged; fixes building

- The driver report settles most of yesterday's open questions. Drop: no "panel drag types" line even over our toolbar, the same for the Claude Code panel in the same side bar and with our view in the primary side bar; a synthetic Shift-drag into a text editor works. So either VS Code blocks drags into side-bar webviews, or synthetic drags differ from real ones. One real drag by the owner onto the Claude Code panel's input decides it (owner question).
- Ctrl+Esc: Windows takes it before VS Code; moved to Ctrl+Alt+C (also inside the frame). Claude Code's Ctrl+Esc has the same problem on this PC.
- Merge note: three worktrees merged by patch in one go; one conflict in track() (R2 and R5 both edited the seen map) resolved by hand; the key patch was rejected as a whole on the first apply because extension.js was still unmerged, so its other files landed in 3a8dc40.
- Driver re-run brief (for after F): same tools under %LOCALAPPDATA%/Temp/t3probe/drive (read report.md first for the lessons: DPI, stuck Alt, the elevated T3 app, code -r to recover focus); Ctrl+F5 from the main window; run only tests 4 (Ctrl+Alt+C both ways), 12 (Ctrl+Alt+T and Ctrl+Backquote from the frame), 11 (header after a new thread), 16 (Alt+click diff title), 17 (one toast only with T3 notifications on; Run in terminal into a T3 terminal); report per test with log lines; close the dev window; restore any T3 or VS Code setting changed.
- Side effects of the run, for the owner: two new threads in the t3-vscode project ("Capture VS Code Workspace State", "Echo Hello Command", the latter set to Supervised), prompts in two existing threads, two declined approvals, three prompts went to the per-token NanoGPT model, the clipboard was overwritten, the main window's panel views were moved and moved back.

### 2026-10-13 16:03, F merged (f067568); driver re-run D2 started; G building

- F found that the Alt+click diff fallback was by design: git.openChange shows a diff only for an uncommitted change; the test file had none. A log line now says which branch ran. The other four findings were real and are fixed.

### 2026-10-13 16:18, G merged (e06eb3b); the owner is back, the re-run waits for an idle desktop; H and I building

- The driver re-run stopped itself at 16:05 (foreground Firefox, then Discord, continuous input). Nothing was changed. A cron check restarts it when idle.
- G's five rows merged with two small conflicts in panel.js (header comment and whitelist; both sides kept).

### 2026-10-13 16:58, round 2 complete (H d79b96f, I cf4bbd5, J 86867fd); prepared for a compaction

- Merge notes: I was built on 3211d78 and J on ebfca74; both applied with keep-both conflicts in package.json (command lists, palette entries, menus), t3-facts.json and the livecheck id list; resolved by script. H's renewal path (checkExpiry swaps the forwarder token) and I's MCP nudge (right after setContext paired) sit next to each other in refresh() and merged cleanly.
- Builder findings worth keeping: both harnesses on this PC already have the bridge registered (CC Switch wrote ~/.claude.json mcpServers.vscode and ~/.codex/config.toml [mcp_servers.vscode]); the t3.json schema at https://t3.codes/schema/t3.json answers 200; a pairing-token renewal keeps the old T3 session alive, so the page need not reload; T3's palette row for a project opens its newest thread, so "new thread in" must press the header button afterwards.

### 2026-10-13 17:14, after the compaction: the second session's drift-log work committed (1220434); K, L, M started

- The owner asked to commit the four open files (AGENTS.md, DRIFT.md, T3-UPDATES.md, references.mjs): done as 1220434 after the pruneLog selftest passed. The standing rule "never commit the second session's files" is lifted for that commit only; keep asking before the next one.
- The desktop is in use (owner at the PC), so the driver re-run stays pending on the cron. Started three Opus workers in worktrees: K builds R19, L builds B32, M writes the round 3 rows. Merge each by patch (routine above), then build round 3 top down.

### 2026-10-13 17:23, K merged (R19)

- Applied cleanly, no conflicts. No new fact: the code reads git's own .git file format, not a T3 surface. Limit kept: gitState describes the main checkout.

### 2026-10-13 17:47, L merged (B32)

- Applied cleanly. Builder limits to know: opening the tab reloads the side view's page once; the tab does not come back after a window reload; one loaded flag for both pages (a shortcut comment marks it); a command's action may land in the tab when the side view is collapsed (harmless, live run only). Livecheck now 40 (openInEditor must not throw unpaired).

### 2026-10-13 18:01, M merged (round 3 rows R25 to R28, 239cadf), .3066 reviewed (2f14ac6), N and O building

- Round 3 found four rows; the rest is in its not-worth-it list. R26 (a pasted screenshot lands in T3's composer) starts with a live check, so it goes on the pointer-test queue as test F: Win+Shift+S, then Ctrl+V in the panel's composer; done if an image chip appears, else build the paste bridge in the injected script per the row.
- The updater appended the .3066 bump at 17:43; reviewed by the lead (nothing to do, sandbox attribute unchanged, running T3 still .3042).

### 2026-10-13 18:10, O merged (R28)

- Applied cleanly. Builder notes: staged and unstaged edits of one file become one diff from HEAD to the working file; renames are untested; the log line fires on the first repository the command opens. The smoke launcher returns before the window finishes: read test/result.json only after its last step is newer than the launch.

### 2026-10-13 18:15, N merged (R25, R27): round 3 built except R26 (live check pending)

- Applied cleanly next to R28. Builder decisions to know: the plan toast fires when the run ends (in place of "finished"), since a plan carries no request id; plan and usage-limit toasts pass under notify needsYou; a usage_limit failure without a reset time is a plain "failed" toast; the tooltip shows HH:MM only. Unread follows T3's rule exactly (false without lastVisitedAt).
- Left in the backlog: B24 (owner), R26 (pointer test F first). Next: the pointer re-run when the desktop is idle (tests A to F plus editor tab and show changes), then the one full Codex review (decision 13).

### 2026-10-13 18:17, round 3 done except R26; the Codex full review started (P)

- Codex reviews main at 2f6c6c9 (security boundaries, correctness, nightly fragility, simplification) and writes docs/REVIEW-2026-10-13.md. When it lands: fix the top findings (small ones by the lead, bigger ones by Opus builders in worktrees), record the rest as BACKLOG rows or "Not worth it" with the reason.
- Driver re-run brief, extended: after tests A to E, run F (Win+Shift+S, Ctrl+V in the panel's composer: image chip or not; R26), G ("T3: Open in editor tab": the tab shows the same thread, a thread switch in one page follows in the other, closing the tab keeps the side view working), H ("T3: Show this thread's changes" with one uncommitted edit: the multi-file diff opens titled "T3: <thread title>"), I (a finished run shows "T3: <title> finished: <first line>" once; the quick pick shows "new" on an unread finished thread).

### 2026-10-13 18:44, the Codex review is in (docs/REVIEW-2026-10-13.md, thread 01a1360d-84e4-7b40-ba18-f181a444c54a): 20 findings, triaged

- Verdict: sound; fix approval context, thread roots, B32 navigation first. Done by the lead (02d169b): the shadowed terminal/context menu, the unused busy message, three CSS snapshot asserts, a fact for the title chevron (nightly 1). Builders Q and R take 13 findings in two worktrees (regions split: approvals and routing vs the two-page Panel core). Deferred as rows R29 (save-on-send acknowledgement, needs a live test), R30 (correlation ids), R31 (T3 literals into t3.js).

### 2026-10-13 18:59, Q merged (362b4f8): six review findings fixed

- Builder choices to know: only command requests need their command item for Approve and Deny (file-read, file-change, permission and MCP questions keep their prompt-text rule); a second click while an answer is in flight says "An answer to this request is on its way to T3"; a lost loopback answer now shows "may have run, check before repeating" instead of a silent retry. Tie note added to PIECE2.

### 2026-10-13 19:14, R merged (0e50e63): all Codex review fixes in; resume notes rewritten

- One conflict in ask(): Q's toast text and buttons kept, R's event key at the top of ask() replaces the old per-thread toast line. NAV sections 6 and 7 and QOL item 1 updated for the per-page readiness, the empty diff entries and the thread-root mention rule (a main-checkout file mentioned in a worktree thread is read as that exact file).
- The owner asked which popup keeps asking for approval. Not found in the session log; waiting for the popup's text.

### 2026-10-13 19:42, release 0.1.0 installed in the owner's VS Code (c4490d2)

- Packaged with vsce 4.0.0 (`vsce package --allow-missing-repository --skip-license`, 16 files, 89 KB; *.vsix is gitignored) and installed with `code --install-extension t3-vscode-0.1.0.vsix --force`: fundryi.t3-vscode@0.1.0. The owner reloads the window to activate it. A dev window (Ctrl+F5) still runs the source copy instead. Repeat for every release: bump the version, checks, smoke, package, install.
- Open for the owner: a LICENSE (none yet, vsce was told to skip it); never pushed, so no GitHub release.
- Nothing built today is live-tested; the owner now uses 0.1.0 for real and reports what breaks, which replaces the pointer re-run for anything they hit first.

### 2026-10-13 20:02, busFred reference added; prepared for a compaction

- Owner: busFred/t3-vscode is worth mining, add it as a reference. Done (references.json, AGENTS, HANDOFF table). Research agent M writes BACKLOG round 3. The lead's verdict: it took the native-rebuild road we rejected (2.9 MB vendored T3 source, a hand sync per nightly), but its sessions tree, CLI pairing and usage meters are worth copying in our shape.

### 2026-10-13 21:26, drag and drop: the VS Code rule found; images, pasted paths and the Shift hint built (65c50e5, 0.1.1 at 9154ba9)

- Owner (21:00): drag and drop from the Explorer into the T3 chat must work like a native thing, also Ctrl+C/Ctrl+V of files, and images. Found in VS Code's own workbench code (workbench.desktop.main.js, class WebviewWindowDragMonitor): at every window dragstart it sets pointer-events none on every webview iframe and lifts it only on drag/dragover events with shiftKey. So no drag reaches any extension panel without Shift; Claude Code's webview shows "Hold Shift while dragging to drop files into Claude Code" for the same reason (its index.js: dragenter with Files/resourceurls/codeeditors, dragleave within 500 ms, once per 5 s). Explorer Ctrl+C writes only VS Code's private clipboard buffer code/file-list (NativeClipboardService.writeResources), no text and no OS files, so Ctrl+V of a copied Explorer file can reach no webview. Both told to the owner with the one-try request (Shift-drag onto our chat and onto Claude Code's input as the control); the driver's earlier FAIL on both panels is now read as a driver limit.
- Built by an Opus builder in a worktree and merged: (1) a dropped, pasted or Add-to-prompt gif/jpg/jpeg/png/webp up to 10 MiB is read by the extension and sent as base64 ({type:'t3vscode:attach'}), the frame builds File objects and dispatches T3's own OS file drop on [data-chat-workspace-drop-target] (workspaceFileDrop.ts checks only the "Files" type); on a page without a thread (draft) or before the frame is ready it falls back to a link chip with a log line, since T3's addComposerAttachments returns false without activeThreadId; (2) a paste inside the composer whose text is only absolute Windows paths (VS Code's Copy Path) is turned into chips through the same dropped path; (3) panel.js shows the Hold Shift notification like Claude Code (a dragleave with a relatedTarget is skipped, that is a Shift-drag moving on into the frame). Seven facts added. QOL item 1 states the two VS Code limits plainly.
- Not live-tested: the attach drop against the running nightly (webkitGetAsEntry on a built DataTransfer is assumed null, else T3 sorts the image as a folder), the paste chip, the hint. Driver re-run brief, extended again: J (right-click a png in the Explorer, "T3: Add to prompt": an image attachment in the composer, no link chip; log has no "image ... added as a link" line), K ("Copy Path" Shift+Alt+C on an Explorer file, click the composer, Ctrl+V: a file chip, no raw path text), L (optional: Shift-drag a png from a Windows Explorer window onto the chat: T3's own dashed drop overlay, then an image attachment). The owner's own Shift-drag answer comes first; read the T3 Code log for "panel drag types" and "drag types" lines.
