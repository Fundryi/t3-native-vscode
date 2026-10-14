# Nightly drift check: know when a T3 update touches what we rely on

Scope of a small addition to `scripts/references.mjs` (owner request 2026-10-12). Design only; no code yet.

## The problem

The reference updater pulls every new T3 nightly into `reference/t3code` without asking. Nobody then checks whether the nightly moved or
renamed something our code or the injected script depends on. The gap is real today: `reference/t3code` holds `.2980`, `.2994` and `.3010`,
`CLAUDE.local.md` still names `.2980`, `docs/STATUS.md` names `.2994`, and `t3.js` was written against `.2980`. No one reviewed those bumps.

## What it does

One check, run by the updater right after it moves `t3code` from an old commit to a new one.

1. **A list of facts** we rely on, in `t3-facts.json` next to `references.json`. One entry per fact:
   `{ "id": "chip-href", "used": "t3.js inject", "path": "apps/web/src/components/ChatMarkdown.tsx", "grep": "data-slot=\"context-chip\"" }`.
   `grep` is one fixed string (no regex, no line numbers). `path` is the file where it lives today.
2. **Per fact, three git calls** against the new commit (no dependence on the checkout):
   `git grep -F -l <grep> <new> -- <path>` (still there?); if not, the same without `-- <path>` (moved, or gone);
   `git diff --numstat <old> <new> -- <path>` (how much the file changed).
   Verdict: `ok` (string present, file unchanged), `changed <n> lines` (string present, file edited), `moved -> <path>`, `gone`.
3. **Three outputs:**
   - Console: one line per fact that is not `ok`, then a count of `ok` facts. The task's terminal is hidden (`presentation.reveal: never`),
     so this is a courtesy, not the channel that reaches anyone.
   - `docs/T3-UPDATES.md`, committed: one dated block per bump, `old tag -> new tag`, one line per changed file with the fact ids in it,
     one line for the live-only facts, the diff command, and a last line `Status: unreviewed`. The script writes at the end and a reviewer
     edits only the Status line. On every append the script drops reviewed blocks beyond the newest three (`pruneLog`,
     `node scripts/references.mjs --selftest`); an unreviewed block is never dropped. Git history is the audit trail.
   - `CLAUDE.local.md`: one marked region `<!-- t3ref -->...<!-- /t3ref -->` rewritten with the sha, the tag and the update time,
     plus "unreviewed bumps in docs/T3-UPDATES.md" while any exist. Nothing else in that file is touched.
4. **Nag every round**, including the "up to date" round: `N T3 bumps await review: docs/T3-UPDATES.md` while the log holds an unreviewed block.
   `node scripts/selfcheck.mjs` prints the same as a WARN, so a "done" claim cannot miss it.
5. **No previous commit** (fresh clone, or the `--force` path after an interrupted download): write a block that says "no previous commit, review every fact".

## The review (what closes a block)

The lead, or any agent about to touch `t3.js`, `panel.js` or the injected script, reads the newest unreviewed block, opens the named files
in `reference/t3code`, fixes code or docs where needed, updates a moved `path` in `t3-facts.json`, and changes the last line of the block to
`Status: reviewed 2026-10-13: <at most three short sentences: the verdict, one clause per changed file, the build the live facts were
closed against>`. Details go into the commit message or the doc they belong to, never into the log. Same commit. One rule goes into `AGENTS.md` and the STATUS
resume notes: "If `docs/T3-UPDATES.md` has an unreviewed block, review it before touching T3-facing code."

## What the grep cannot see

Facts that live in the served response or the built bundles, not in the source tree: no CSP header, gzip on `/`, the open shadow root of the diff
viewer, bundle file names. Those stay manual re-checks, or `selfcheck --live`. The fact list says so in a `live: true` field with no `grep`,
so the block lists them as "re-check live" on every bump instead of pretending they passed.

## Seed list (first version of `t3-facts.json`)

| id | used in | path | grep |
|---|---|---|---|
| runtime-file | t3.js discover | apps/server/src/config.ts | `server-runtime.json` |
| runtime-origin | t3.js discover | apps/server/src/config.ts (or where the file is written; confirm) | `origin` |
| auth-session | t3.js | packages/contracts/src/environmentHttp.ts | `/api/auth/session` |
| auth-pairing | t3.js | packages/contracts/src/environmentHttp.ts | `/api/auth/pairing-token` |
| oauth-token | t3.js | packages/contracts/src/environmentHttp.ts | `/oauth/token` |
| mcp-route | mcp.js | apps/server/src/mcp/McpHttpServer.ts | `/mcp` |
| chip-href | inject | apps/web/src/components/ChatMarkdown.tsx | `data-slot="context-chip"` |
| chip-suffix | inject | packages/shared/src/fileLinks.ts | the `:line:col` regex |
| mention-chip | inject | apps/web/src/components/chat/MessagesTimeline.tsx | `aria-label={\`Preview ` |
| diff-header | inject | apps/web/src/components/DiffPanel.tsx | `data-title` |
| popup-key | inject | apps/web/src/components/NightlyMobileBeta.tsx | `t3code:nightly-mobile-beta-notice-dismissed:v1` |
| editor-key | inject | apps/web/src/editorPreferences.ts | `t3code:last-editor` |
| storage-json | inject | apps/web/src/hooks/useLocalStorage.ts | `fromJsonString` |
| preview-sandbox | inject | apps/web/src/components/files/BrowserDocumentFrame.tsx | `sandbox` |
| no-csp, gzip, shadow-root | inject | live only | (no grep) |

Paths checked against `.3010` on 2026-10-12 with `git grep`. Pass the string with `-e`: a pattern that starts with `/` is otherwise read as a path.

## Size

About 60 lines in `references.mjs` (one function plus three call sites), the JSON, one marked region in `CLAUDE.local.md`, one rule line in
`AGENTS.md`. No new dependency, no new script, no new task.

## First run

Baseline the list against the current HEAD (`.3010`). Then run the check once by hand for `.2994 -> .3010` to produce the first block.
That tests the code and closes the gap named above in one step. The `.2980 -> .2994` bump has no block; the `.2994 -> .3010` review covers it
because the diff is against the files, not the tags.

## Not built, on purpose

- No automatic edit of `docs/INJECT.md` or `docs/HANDOFF.md`. Their `file:line` cites go stale every nightly by design; the fact list is the
  machine copy of the INJECT fact table.
- No regex facts, no "which function changed" analysis. A changed file is enough to send a reviewer there.
- No check of the live nightly version against the reference tag. `selfcheck --live` could add it later in a few lines if the two drift apart.

## Open

- Open: commit `docs/T3-UPDATES.md` (lead: yes, it is the audit trail) or keep it local. Owner decides.
- Open: the ack is "edit the Status line" rather than a `--ack` flag, so the reviewer writes what was concluded. Owner decides.

## Decisions after the review (lead, 2026-10-12)

Built in the commit that carries this section. What changed against the design above:

- R2: `git grep` exit 1 is "no match", handled; missing old objects give "objects missing, review every fact", never `ok`.
- R3, R4: fact list corrected and extended (`t3-facts.json`, 18 grep facts, 4 live facts). `mcp-route` and `editor-key` dropped.
- R6, R7: the log is the state. Every round compares the checked-out commit with the newest block's target commit and fills the gap. The first
  block therefore ran from `.2980` (the hand-written baseline block) to `.3010` and covered the skipped `.2994` bump.
- R9: no lock. The rule says: read the log right before you edit it. The updater appends at most once an hour, so the window is seconds.
- R10: the updater does not touch `CLAUDE.local.md`. That file now points at the newest log block instead of naming a sha. This differs from the
  owner's words ("it changes the CLAUDE.local.md reference information"); the owner left the details to the lead, and the pointer gives agents the
  same information with no script writing into a private note.
- R11: the block lists live-only facts as "re-check live" every time; a review closes them against the running build, not the bundle.
- Owner decisions: the log is committed; the ack is the edited Status line.
- Owner, later the same day: the console prints one paste-ready message for the AI (what moved, how many facts changed, the diff command,
  where the block is). The block carries the same diff command. New rule in AGENTS.md: every new T3 surface we touch gets a fact in the
  same commit, or the checker is blind to it.

## Review (Codex, 2026-10-12)

1. **R1, fine: depth 1 does not prevent these comparisons.** Read-only checks at `d83929ad` confirmed that both older nightly commits and their trees exist and that `git diff --numstat <old> <new> -- <path>` works; this compares two trees without needing their parents or a merge base ([git diff](https://git-scm.com/docs/git-diff), [shallow commits](https://git-scm.com/docs/shallow)). The updater keeps distinct nightly tag refs, so normal garbage collection retains their reachable trees and blobs; deleting or replacing those refs and later pruning, recreating the clone, or repository damage can make an old recorded SHA unavailable ([git gc](https://git-scm.com/docs/git-gc)).

2. **R2, block: a missing grep match must not abort the check.** The existing `git()` helper throws on every nonzero exit, including the normal exit 1 for no match, so using it unchanged stops before the proposed moved-or-gone fallback and report. Use `-F -e` with an argument array, handle no match separately from Git errors, and report missing old objects as "comparison unavailable, review every fact" rather than `ok`, zero changed lines, or `gone` ([git grep](https://git-scm.com/docs/git-grep)).

3. **R3, block: two seed facts already fail on the claimed baseline.** At `.3010`, `config.ts` has no `origin` match, and `ChatMarkdown.tsx` has no literal `data-slot="context-chip"`; the actual owners are `apps/server/src/serverRuntimeState.ts:66` with `origin: runtimeOriginForConfig` and `apps/web/src/components/ContextChip.tsx:95` with `"data-slot": "context-chip"`. Keep a separate ChatMarkdown link-rendering fact as well, and replace "the :line:col regex" with the literal source string `const POSITION_SUFFIX_CAPTURE_PATTERN = /:(\d+)(?::(\d+))?$/;` before creating the JSON.

4. **R4, should fix: add the source owners our selectors and auth actually depend on.** Add the composer mention chip in `apps/web/src/components/ComposerPromptEditorTiptap.tsx:270`, the `data-diffs-header` guard in `DiffPanel.tsx:1125`, the `permissions` response field in `packages/contracts/src/auth.ts:149`, and the bearer-selection owner `selectRequestCredential` in `apps/server/src/auth/EnvironmentAuth.ts:663`; route declarations alone do not watch those behaviors. Drop `mcp-route` for now because our `mcp.js` serves our own MCP endpoint and never calls T3's, and drop `editor-key` unless the injected script actually starts writing it, since INJECT calls it only a side benefit.

5. **R5, should fix: fixed strings are useful tripwires, not proof that a fact still holds.** A helper or imported component can change while the watched file and string stay identical, and a whole-tree fallback can find only an old test, comment, or unrelated `sandbox` occurrence. Call `ok` "watched source unchanged", list all fallback matches as possible new locations for human review, and keep one entry per relevant source owner rather than adding a dependency scanner or semantic parser.

6. **R6, block: the first run does not cover the missed earlier bump.** A `.2994 -> .3010` diff excludes `.2980 -> .2994`, and read-only checks found changes to `http.ts` and `ws.ts` in that earlier interval even though the seeded route declarations stayed unchanged. Start from the last reviewed source SHA, currently `.2980`, compare it with `.3010`, and close every pending block covered by that review rather than only the newest block.

7. **R7, block: failure after checkout can permanently lose a bump.** If checking a fact or writing `T3-UPDATES.md` fails after `update()` succeeds, the next round sees the clone as up to date and never retries the missing report. On every round, compare the checked-out SHA with the last successfully recorded SHA in the log and fill any gap before taking the up-to-date return; this reuses the log instead of adding a job system.

8. **R8, fine: the file, selfcheck warning, and agent rule are enough for this workflow.** The hidden task terminal cannot notify the lead, but an explicit rule to read pending blocks before T3 edits, source-based reviews, or completion claims gives the log a reader without building notifications or a VS Code UI. Print the nag before the updater's early returns and remote calls, and describe a selfcheck WARN as a reminder rather than a guarantee that nobody can miss it.

9. **R9, should fix: append-only does not enforce one writer.** A reviewer saving a Status edit can overwrite a block the updater appended meanwhile, and opening the current checkout can review a different nightly from the SHA named in the block. The smallest rule is to stop the watcher while reviewing and acknowledging, read the recorded commit, and resume afterward; do not add a lock service or an ack command for this slice.

10. **R10, should fix: do not make the updater rewrite private instruction notes.** Markers limit which bytes are replaced but do not protect a concurrent human save, malformed markers, or the existing unmarked stale SHA line in `CLAUDE.local.md`. Put full old/new SHAs, tags, and update time in the existing generated `T3-UPDATES.md` blocks and point the agent rule there, which removes the third output and needs no separate generated file.

11. **R11, should fix: a reference bump is not evidence about the installed nightly.** Keep the source-only check, but label the reported version as the reference version and require live rechecks against the running build before closing a block; the current `selfcheck --live` does not validate the injected DOM, popup, gzip negotiation, or open shadow root. Add the actual chip href/button shapes, diff title shape, and usable HTML insertion point to the manual live checklist rather than grepping built bundles or adding version synchronization now.

12. **R12, fine: keep the remaining scope small.** A short fact list, Git comparisons, one log, one selfcheck reminder, and one agent rule are sufficient once the blockers above are fixed. Recommend the committed log with manual Status edits, subject to the owner's existing decision, and skip the private-note rewrite, automatic doc repairs, semantic analysis, extra scripts, and extra tasks.
