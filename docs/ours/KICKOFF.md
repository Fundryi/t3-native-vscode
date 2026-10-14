# Kickoff

Paste these to start the next phase. Order: Claude scopes, Codex reviews, Claude builds.

## 1. Claude (Fable), in VS Code with `t3-vscode.code-workspace` open

```
Read AGENTS.md and docs/HANDOFF.md. We are in phase "scope", no extension code yet.

Goal of this round: answer HANDOFF open questions 1 and 2 against my running T3 nightly,
read-only. Find which port and URL the nightly's server listens on, whether it serves the
web UI over plain HTTP, and how a client signs in (pairing token, session cookie). Then read
reference/VSmux (t3-webview-manager, t3-frame-host, t3-runtime-supervisor) only to learn how
it got T3's page into a VS Code webview, and say what we would do differently and better.

Do not change anything in T3, its settings or its data. Ask before any command that
writes. Write the findings into docs/HANDOFF.md (section 5, mark each question answered or
still open with evidence), then write docs/PLAN.md: the smallest Piece 1 spike, its exact
steps and how we prove it works. Stop there and hand the plan to Codex for review.
```

## 2. Codex (`astra`), after Claude committed docs/PLAN.md

```
Read AGENTS.md, docs/HANDOFF.md and docs/PLAN.md. You are the second opinion, not the
builder. Review the plan against the live code in reference/t3code (newest nightly tag):
wrong assumptions about T3's server, auth or web UI, anything that breaks on the next
nightly, anything copied from VSmux instead of designed, and anything bigger than the
smallest spike that proves Piece 1. Do not edit code. Put your findings at the end of
docs/PLAN.md under "Review (Codex)", each with evidence (file and line) and a concrete fix.
```

## 3. Claude (Fable), build phase, 2026-10-12, fully autonomous

Both earlier prompts are done (commit 43b5d41 and the Codex review in docs/PLAN.md). This prompt started the build on 2026-10-12 (runs 1 to 4, see docs/STATUS.md). Keep it for reference; use section 4 to continue.

```
Read AGENTS.md, docs/HANDOFF.md (section 1.1 is the goal in my words, 1.2 the decisions
I made) and docs/PLAN.md.
Phase "build". Run autonomously; I am not watching. Orchestrate with Workflow, Opus or
Sonnet subagents only, never Fable as a subagent.

Order:
1. PLAN.md "Before the spike starts": fold the Codex review into the plan (R1 and R5 change
   the design and the step order), write the Claude Code and Codex VS Code extension feature
   checklist into HANDOFF 1.1 with a "how we get it with T3" column, commit.
2. Run the spike per PLAN.md. Scaffold the real panel first. Stop only for step 0 (I mint
   the pairing link) and for anything that writes to T3; everything else, decide yourself.
3. Record every acceptance result in HANDOFF section 5, commit after each step that works.
4. If the spike passes gates 1 to 4, start Piece 2 (the VS Code context MCP server) the
   same way: smallest slice, real check, commit.

Rules that stay: never modify T3, nothing under reference/ is edited or built, T3-facing
code in one file, under 300 lines for the spike, no new dependencies, privacy guard on
every commit, no push.
```

## 4. Resume (any later session)

Paste this to continue where the last session stopped:

```
Read AGENTS.md, then docs/STATUS.md. Continue from its "In flight", "Waiting on the owner" and
"Next" sections. Same rules as kickoff 3: autonomous, Opus or Sonnet subagents, never Fable as a
subagent, no Codex review per slice (decision 13: Codex only for clearly adversarial or advisory
questions), run the four selfchecks, the live check (npm run livecheck) and the activation smoke after every slice, update STATUS.md and
commit after each step that passes its check, never push. Collect every question for me into one
rundown at the end.
```

## 5. Codex live test run (computer use), from 2026-10-13

The owner does not run live test lists; Codex does, with computer use. Start it through `/codex:handoff`
with this text. The list itself lives in `docs/STATUS.md` under "Live test handoff for Codex", so it
stays current without editing this file.

```
You test the VS Code extension in D:\GIT\t3-vscode with computer use. Read AGENTS.md, then the section
"Live test handoff for Codex" in docs/STATUS.md: it has the setup, the tests in order, the exact place to
click and the expected result for each. Run them in that order. After each test read the dev window's
output log on disk (newest file matching
%APPDATA%\Code\logs\<session>\window<N>\exthost\output_logging_*\<N>-T3 Code.log) and copy the lines the
test names. Do not change code, settings, T3's settings or T3's data; do not run the t3 CLI; skip test 9
unless the owner says otherwise. Report per test: pass or fail, what you saw, the log lines verbatim. If
the panel asks to pair, stop and report. Finish with a list of failures, one line each, so the lead can
fix them without asking.
```

## 6. Day one of the fork (Claude, Fable, from 2026-10-14)

Read docs/SWITCH.md (the facts and the port order), HANDOFF decision 17, then this. Rules that carry over unchanged: never modify T3 Code; reference/ is read-only; never push without the owner's word; commit author 19733372+Fundryi@users.noreply.github.com; privacy guard; no permission prompts (bypassPermissions in .claude/settings.local.json, copy it to the new repo); Opus builders in worktrees, never Fable as a subagent; ASCII only; ELI5 replies.

Steps, in order, each one committed in the new repo before the next:

1. Clone https://github.com/busFred/t3-vscode.git to D:\GIT\t3-native (the owner may rename it), add his repo as the remote `upstream`, tag the start `fork-start`. Copy AGENTS.md's hard rules into his AGENTS.md shape (keep his build and test rules). Add CLAUDE.md as the stub, CLAUDE.local.md to .gitignore, .claude/settings.local.json.
2. Build on Windows: pnpm install, pnpm run build, pnpm test (49 test files), pnpm run package. Note every failure in docs/STATUS.md of the new repo. Do not touch reference/busFred-t3-vscode in the old repo for this; it is the read-only clone.
3. Install the built vsix into the owner's VS Code (code --install-extension --force), uninstall fundryi.t3-vscode, pair against the running nightly (3042). His pairing runs the t3 CLI itself (that is his product flow, allowed). Verify on Windows: pairing, a thread, a reply, a file reference (Ctrl+K), an image paste, the usage meter. Write the result down before porting anything.
4. Check the vendored T3 pin (vendor/README.md, 0.0.45) against the owner's nightly (0.0.46): if the wire protocol broke, re-vendor the three packages the way his vendor/README.md says, as the first real commit. Keep t3-facts.json's idea: a facts file for the T3 surfaces the fork relies on, checked by the old repo's drift script moved over.
5. Port in this order, one Opus builder per item in a worktree, our code in files under src/host/ours/ (or a name that keeps his files untouched where possible): the MCP context bridge (context.js, mcp.js, bridge.js from the old repo, standalone, plus the setup command with the CC Switch and native paths, decision 16); approvals as notifications with Approve, Deny, Show on his approval state (decision 15); the status bar running state and badge next to his usage item; Add to prompt from Explorer, editor selection (Alt+K), terminal selection, last command, TODO lens, Fix with T3, Review changes, all ending in his composer insert; t3.json scripts as tasks; Open in the desktop app; thread deep links; save on send.
6. Drag and drop: his composer takes OS files only. Add the Explorer Shift-drag (VS Code's text types: application/vnd.code.uri-list, text/plain paths) to his composer drop handler, images as attachments through his own addFiles, plus the Hold Shift hint, and a native "Drop files here" tree view with a drop controller (text/uri-list) for drags without Shift. Verify with a real hand, not the driver.
7. Upstream routine, written into the new repo's AGENTS.md: `git fetch upstream`, merge upstream/main, build, his tests, our checks, the live list; a docs/UPSTREAM.md log entry per merge with what broke. Do it on his next release to prove the routine.
8. Mark this repo archived: a line at the top of README.md and STATUS.md pointing at the fork; no further slices here.

Open for the owner before step 1: the folder and repo name; whether the fork is pushed to GitHub (as a public fork of his, with the guard) or stays local like this repo.
