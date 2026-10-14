# Switch plan: fork busFred/t3-vscode and put our features on top

Written 2026-10-13 late evening, after the owner asked for it. Scope and plan only. Nothing was built. The owner decides on 2026-10-14.

## Decision (owner, 2026-10-13 21:52)

Option A. "It's definitely going to be a native Visual Studio. I never liked the web-based fork and using the web UI at all." Recorded as decision 17 in docs/HANDOFF.md. The lead's objection in section 0 and section 3 stands on record; the owner decided anyway. Day one is docs/KICKOFF.md section 6; nothing built on 2026-10-13.

## 0. The one fact to settle first

The owner's trigger was drag and drop. Switching does not fix it:

- VS Code blocks every drag over every extension webview unless Shift is held (its own workbench code, `WebviewWindowDragMonitor`). busFred's chat is a webview too, so the same rule applies to it.
- busFred's composer takes only OS file drops (`dataTransfer.files`, [Composer.tsx:290](../reference/busFred-t3-vscode/src/webview/components/Composer.tsx#L290)). A drag from VS Code's Explorer carries no files, only VS Code's text types, so his extension ignores an Explorer drag with or without Shift. Ours turns a Shift-drag from the Explorer into a chip. His has Ctrl+K for a file reference; ours has Alt+K, Add to prompt, pasted paths and the TODO lens.
- Explorer Ctrl+C writes only VS Code's private clipboard buffer. No extension can paste a copied Explorer file.

Our log shows no drag reaching the panel at all today (no "panel drag types" line in any T3 Code output log). That means either no Shift was held, or VS Code blocked the drag even with Shift on this machine. One real Shift-drag by the owner, then a look at the log, settles which. If it is the second case, a native "Drop files here" strip (a tree view with a drop controller, not a webview) is the only thing that takes a plain drag, in either extension.

## 1. What busFred's extension is (facts from the clone at 900a3d7, version 0.1.21)

- A native rebuild of T3's chat in React inside a webview, over 3.7 MB of vendored T3 packages (contracts, shared, client-runtime) pinned at T3 0.0.45 (2026-10-05). The vendored copy is updated by hand; the wire protocol is frozen until he re-vendors. This is the road our decision 2 rejected for us; for a fork it is his burden as long as he keeps going.
- 161 TypeScript files, 1.4 MB of source, 49 test files, pnpm, tsdown, Vite. MIT. Marketplace id hungtienhuang.t3-vscode (prerelease 0.1.19/0.1.21, release 0.1.18).
- Started 2026-10-06; 21 versions in one week; one author; "Linux is the first verified platform"; Windows pairing needed two fix rounds and "native Windows execution still needs verification"; "rendering is not full web-app parity"; no remote servers; no embedded terminal; "specialized tool previews and interactive checkpoint restore remain later work".
- Features we do not have: sessions sidebar (rename, pin, settle, archive, subagents), one conversation per editor tab with durable drafts, rich transcript rendering (Mermaid, KaTeX, media), Find in session, model picker with favorites, Cite a reply, agent-only response diffs in VS Code's diff editor, usage meters in the status bar, scheduled tasks tab, automatic pairing through the t3 CLI.
- Features we have that he does not: the MCP context bridge (workspace, active file, open tabs, diagnostics, git state, terminal output, open file, reveal, show diff, registered natively and offered to Claude Code and Codex), approvals as VS Code notifications with Approve, Deny, Show, status bar running state and badge, Fix with T3 code actions, Review changes from Source Control, TODO lens, t3.json scripts as tasks, Run in terminal from a code block, Open in the desktop app, thread deep links, theme follow, keys relayed to VS Code from inside the chat, save on send, Add to prompt from Explorer, editor selection, terminal selection and last command, the panel following the VS Code folder, the drift check against nightlies (t3-facts.json), the live check harness.
- The deep difference: his chat is his code, so it only shows what he rebuilt. Ours is T3's own page, so every T3 feature (checkpoints, tool previews, plans, settings, every nightly addition) works the day T3 ships it, with the cost that T3's page lives in an iframe we can only poke from outside.

## 2. Three ways forward

### A. Fork busFred and carry our features over (the owner's proposal)

- New repo from his, `upstream` remote on his GitHub, our work in clearly separate modules so his updates merge with few conflicts.
- Port, in this order: MCP bridge (its own files, no UI, ports as is); approvals notifications (his host already has approval state, add the notification layer); status bar running state (he has a usage status bar, add the running item); Add to prompt, Alt+K, terminal selection, last command, TODO lens, Fix with T3, Review changes (all end in "insert text into the composer", he has `insertReference`); t3.json tasks; Open in desktop; deep links; keys (not needed in the same way, his webview is not T3's page); theme follow (he has it).
- Lost for good: everything T3 adds that he has not rebuilt, until he rebuilds it. Checkpoint restore and tool previews are already on that list.
- Cost: 2 to 4 working days to a usable fork with the MCP bridge, approvals, status bar and the prompt helpers; the rest over a week. Then an ongoing cost per upstream release: merge, build, run his tests and our checks, retest our additions. He ships several versions a week right now.
- Risks: one author, one week old, Linux first, Windows pairing still fragile. If he stops, we own 161 files and a hand-vendored T3 protocol. Both the Windows path and the vendored pin need our attention on day one.

### B. Keep ours and take his good pieces (today's plan, BACKLOG round 3, Q1 to Q15)

- Usage meters, one-click pairing through the t3 CLI, last-turn diff, picker improvements, sessions-style navigation. The chat stays T3's own page.
- Cost: the backlog as listed, 1 to 2 days for Q1 to Q5. No upstream merge burden; the drift check already watches T3 nightlies.
- Does not change the drag and drop situation either (see section 0).

### C. Run both: his extension for the chat, ours as the tool belt

- Install his from the Marketplace for the chat view. Strip ours to the parts that need no chat panel: the MCP bridge, approvals notifications, status bar, code actions, tasks, deep links, Add to prompt (sent to his composer through his `t3-vscode.insertReference` command, to be verified).
- Cost: 1 day to strip and wire; near zero upstream cost (his updates arrive from the Marketplace).
- Risks: two extensions with two pairings and two settings pages; his composer command is an internal surface that can change; the panel-follows-folder behaviour and the file-link clicks are his to get right.

## 3. Lead pick

Not A today. The reason the owner is frustrated (drag and drop) is a VS Code rule that A does not change, and A trades T3's complete UI for a one-week-old rebuild that is Linux first. If the owner still wants A after reading section 0 and section 1, do it as a fork with the port order above and keep this repo as the archived old version.

My pick is B with one addition from C: the native "Drop files here" strip, built in ours, which is the only path to a plain drag in any extension. If the owner's Shift-drag works tonight, B alone; if it does not, B plus the strip.

## 4. If the owner picks A: the first day

1. Decide the repo name and whether it is pushed (ours never was). Clone his repo, add `upstream`, tag the start.
2. Build on Windows with pnpm, run his 49 tests, pair against the owner's nightly (3042). Note what fails; the Windows pairing fix is the first thing to verify.
3. Re-vendor against the owner's nightly if the frozen 0.0.45 protocol breaks against 0.0.46 (check first how he does it; vendor/README.md says by hand).
4. Port the MCP bridge as is (context.js, mcp.js, bridge.js are standalone).
5. Port approvals notifications onto his approval state.
6. Port the status bar running state and the prompt helpers.
7. Move docs/, the facts and the drift check idea over, archive this repo as "old version".

## 5. Open for the owner

- One real Shift-drag and the answer (section 0).
- A, B or C.
- If A: repo name, pushed or not, who merges upstream and how often.
