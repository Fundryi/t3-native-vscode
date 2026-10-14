# Navigation in the panel: this project's threads, new thread, good landings

Owner, 2026-10-12 evening, after the chip click worked: "we need a simple way to create new chats and only navigate our chats related to this Visual Studio project", and "the small quality-of-life things, like how items in T3 get redirected to Visual Studio in a good way" (a folder chip selected the folder in the Explorer but did not expand it). Rows 1, 10 and 12 of `docs/SYNC.md`.

## 1. A native bar above T3's page

Under the session line (Paired as ..., Details, Reload, Forget) the panel gets one row in VS Code's own style:

```
[ + New thread ]  [ Current Working Directory            v ]  [ this project: 3 threads ]
```

- **New thread** starts a thread in the bound project. Implementation: the extension posts `{type:'t3vscode:new-thread', root, title}` into the frame as today. The injected script first tries the header button with aria-label exactly `New thread in <title>` (the project is already active in the frame: one click); only when that button is absent it runs the palette flow of `docs/PROJECT.md` Research 2 (select the project by root, which starts a thread when the project has none). Result messages as today.
- **The thread dropdown** lists this project's threads, newest first, with T3's title; the current one is selected. Picking one navigates the frame to `/<environmentId>/<threadId>`. The list comes from `GET /api/orchestration/shell` (bearer, `x-t3-orchestration-protocol: 2`), fetched when the panel renders and again each time the dropdown is opened (the webview posts `{cmd:'threads'}`, the extension answers `{type:'threads', items, current}`). No polling.
- **The current thread** is known two ways: the path the extension navigated to, and `{type:'t3vscode:location', pathname}` that the injected script posts to the parent on every `popstate` and on history pushes (it wraps `history.pushState` and `replaceState` once). The panel keeps the last known pathname; the dropdown selects the thread whose id is in it. The extension stores it per project in `workspaceState`, so Reload and a VS Code restart land on the thread the owner was in, not on the newest one (ensureProject takes an optional `preferThread` and uses it when it is still an open thread of the project).

## 2. Which threads belong to this project

"Related to this VS Code project" means, for the window's workspace folders F (all of them, not only the first):

1. Threads of the bound project (its root is the first folder).
2. Threads of any other T3 project whose root is inside one of F (a subproject, a nested repo), or equal to one of F (a multi-root workspace with several projects).
3. Threads whose own working folder (`lineage` worktree path or the thread's `cwd` field, whichever the shell exposes) is inside one of F.

Excluded: archived threads, subagent threads (`lineage.relationshipToParent === "subagent"`), threads of projects whose root is a parent of F (the home-folder project would otherwise swallow everything). Order: `latestUserMessageAt`, then `updatedAt`, then `createdAt`, newest first, same as T3. The count in the bar says how many.

Path rules as in `ensureProject`: compare `normalizeRoot` values, directory boundary only (`a/b` is inside `a`, `a/bc` is not).

## 3. Landings for redirected items (quality of life)

When a T3 chip is clicked and the extension opens it:

- **File:** open the editor tab at the line and column, reveal and select it in the Explorer, focus stays in the editor (as today).
- **Folder:** reveal and select it in the Explorer, then expand it (`revealInExplorer`, then `list.expand` on the focused Explorer item) and keep focus in the Explorer so the arrow keys work. Do not open anything else.
- **File outside every workspace folder:** open the tab (the Explorer cannot show it); the log says so.
- **A file that does not exist (deleted, or a path from another machine):** one warning naming the path, as today.
- **Media and binary files:** VS Code's own viewer opens them (`vscode.open` instead of `showTextDocument`, so images show as images).

Not in this slice: diff headers and relative mentions (they need the thread root; the bound project gives it now, so a later slice can resolve relative paths against `root`).

## 4. Facts for t3-facts.json

Shell thread fields used for the list (title, cwd or worktree path), the `history.pushState` use in the router (to confirm the location hook fires), the header New thread button (exists).

## Open

- Open: show threads of other projects (rule 2 and 3) in the same dropdown with the project name as prefix, or in a second group. Lead: same list, prefix `<project> / ` when the project is not the bound one.
- Open: a thread picked from another project switches T3's active project too (T3 does that itself when navigating to the thread). The New thread button then still targets the bound project (the root is fixed), which is what the owner expects for "this project".

## 5. Thread switching without a reload, and a search list (owner, 2026-10-12 evening)

Owner: switching through our picker reloads the whole page and takes about three times as long as T3's own sidebar; the picker needs a search that is not stupid, including thread ids; look at the Codex panel.

**Switch in place.** The panel no longer changes the iframe src for a switch. It posts `{type:'t3vscode:go', pathname}` into the frame; the injected script runs `history.pushState(null, '', pathname)` and dispatches a `popstate` event, which T3's router (TanStack browser history) picks up like a back or forward step, so only the thread view re-renders. The script's existing location hook reports the new pathname. If no location message with the thread id arrives within 1.5 s, the panel falls back to setting the iframe src (the old full load) and logs it, so a router change in a nightly degrades to slow, never to broken.

**The picker becomes a quick pick.** Clicking the title in the toolbar opens a popover under it, styled like VS Code's quick pick (`--vscode-quickInput-background`, `--vscode-widget-border`, `--vscode-list-hoverBackground`, `--vscode-list-activeSelectionBackground/Foreground`, `--vscode-input-*`):

```
| Search threads by title or id                      |
| Current Working Directory                      now |
| Add the navigation bar to the panel             5m |
| other-project / Repowise hosting                3h |
```

- The input has focus when the popover opens. Typing filters as you type. Escape closes. Up and Down move, Enter opens. Click opens. A click outside closes.
- Rows: the title ("Untitled" when empty), the project prefix for threads of other projects, and a relative time on the right (now, 5m, 3h, 2d) from `latestUserMessageAt`, else `updatedAt`, else `createdAt`.
- Search is token based: every space separated token must match, case-insensitive, as a substring of the title, the project title, or the thread id. A token that equals the start of a thread id ranks that thread first. No match: one muted row "No threads match". The list order otherwise stays T3's (newest first).
- The list is refreshed from `GET /api/orchestration/shell` each time the popover opens (the `threads` message as today); while the fresh list loads, the last one shows.
- The toolbar title shows the current thread's title (or "No thread" and the folder name).

Not built: archive and delete actions in the rows (T3's own UI has them), environment filters.

## 6. Editor tab (B32)

`T3: Open in editor tab` (`t3vscode.openInEditor`; palette, and the panel's `...` title menu) opens the same panel page in an editor tab beside the current editor (`WebviewPanel`, viewType `t3vscode.editor`, `retainContextWhenHidden`). A second run reveals the open tab. No default key: Windows takes Ctrl+Shift+Escape (Claude Code's key) for the Task Manager before VS Code sees it; the owner can bind one in Keyboard Shortcuts.

- The side view and the tab are pages of one `Panel`: one html (`page.render`), one message handler, one forwarder, one bind. The tab works without the side view ever opening.
- State goes to every page: the thread list, a thread switch (`navigate`), theme, settings, the session line. Actions go to one page, because two frames would each start the thread or insert the mention (same forwarder origin, shared drafts): an answer or an action a page asked for (New thread button, a file drop, pairing error, clipboard prefill, the first thread of a fresh project) goes back to that page; a command's action (mention, New thread, Switch thread, focus composer, T3 palette, T3 settings, a notification's Show) goes to the side view if it shows, else the tab if it shows, else the side view, or the tab when there is no side view.
- Opening the tab refreshes, so the side view's frame loads again once. The badge and the status bar stay on the side view. `t3vscode.panelVisible` is true while either page shows.
- Closing one page keeps the other served; the last page closed stops the forwarder and the watch, as closing the side view did before.
- Limits: the tab does not come back after a window reload (no serializer). Readiness is tracked per page (Codex review 2026-10-13): a deferred action waits for the page it goes to, and a thread switch in one page is sent to the other once, with a guard so the other page's report of the thread it leaves does not bounce the switch back.

## 7. A thread's changes (R28)

`T3: Show this thread's changes` (`t3vscode.showChanges`; palette, and the panel's `...` title menu) opens every index, working-tree and untracked change of the shown thread's worktree (else the bound project's root) in VS Code's multi-file diff, through the git extension's API (`openRepository`, `toGitUri(uri, 'HEAD')`) and the core command `vscode.changes` titled "T3: <thread title>". A worktree repository opened this way also shows in Source Control from then on (one log line says so); no repository, no changes or no bound project each give one information message. An entry with neither side to show (a file added and deleted again) is left out; when none remain the message says so.
