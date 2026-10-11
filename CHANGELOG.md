# Changelog

## 0.1.20 — Unpublished

- Write a file chosen from the `@` menu as the same plain `@path` token the editor's Ctrl/Cmd+K uses, with a removable chip. It previously inserted a bare Markdown link that had no reference behind it, so clicking it in the message box did nothing.
- Keep the `@` visible in the sent message. File references now send as `[@path:12-40](uri#L12-L40)` rather than dropping the prefix. A path chosen from the menu is labelled with its workspace-relative path, as editor selections already were, so files that share a name stay apart.
- Open a referenced file from its draft token, its chip or the sent message. Directories now reveal in the Explorer instead of failing to open as a document.
- Send quoted assistant text verbatim. The previous escaping turned `(text)` into `\(text\)`, which the Markdown math normalizer then rendered as KaTeX, so quotes containing parentheses appeared as run-together italics or red errors; `[text]` became display math and broke the quote block apart.
- Replace the repeated `Assistant quote` links and the duplicated quote block below them with one numbered card per quote, collapsed to two lines, with an expand control and a source link. The message still carries a readable quote block for providers and other clients, which never expand `t3-citation:` links; the transcript hides it.
- Label quote tokens and chips with a preview of the quoted text instead of the word `Assistant quote`, and shorten quote reference ids so the draft stays readable.
- Collapse the runs of blank lines a quote carries when it spans blocks. A quote of a paragraph followed by a list arrived with four blank lines in it: the collapsed card now reads as one flowing paragraph, so neither visible line is spent on a blank, and the expanded card keeps one blank line per break along with any code indentation. Done when the card renders, which also fixes quotes saved earlier; changing the capture instead stopped this client resolving whole-message quotes that the T3 app keeps producing, so the capture is left as the faithful port it is.
- Search a quoted message as the transcript renders it, so results, previews and match order agree with what is on screen; open a result inside a quote and the quote expands to show it.
- Copy a message as it reads, with quotes in readable form rather than their citation URLs.
- Keep a quote expanded once opened, including while the transcript unmounts and remounts its row.
- Draw thematic breaks (`---`), which previously rendered as an unstyled browser default.
- Restore the composer caret in the same update that inserts a reference instead of a frame later, so typing immediately after pasting an image no longer lands back at the insertion point. Long-standing; `scripts/verify-ui.mjs` reproduced it at v0.1.19 and now pins the caret position in both directions.
- Pass 228 deterministic tests, TypeScript checking, full builds and the headless webview regression suite. Four rounds of fresh-context regression review found four blocking defects, all introduced by this change set: a whole-file `@` token claimed a longer path that extended it at a `.` boundary, so picking `@.env` then `@.env.local` sent two links to `.env`; the quote-stripping pattern exceeded the regular-expression size limit for a quote of a few thousand short lines, which would have thrown during transcript render; the line-based replacement for it then failed to hide the readable block whenever a comment contained a newline, which Shift+Enter in the comment box produces; and a change to how quotes are captured stopped 17 of 37 real message shapes resolving a whole-message quote saved by an earlier version or by the T3 app, which was withdrawn in favour of collapsing the blank lines at render. Known limitations: a quote chip no longer marks that a comment is attached except in its tooltip; the message navigation rail still previews raw message text, so it shows a quote's citation URL where search and Copy now show the quote; search still indexes Markdown source, so a match inside link or emphasis syntax can preview text that is not on screen; and two pre-existing timing flakes in `scripts/verify-response-layout.ts` and the queued-message reorder check fail roughly one run in five, at this version and at v0.1.19 alike.

## 0.1.19 — Alpha prerelease

- Stop the periodic usage refresh from delaying sent messages. A refresh that falls due while a message is being sent or a response is running now waits for the session to go idle instead of competing with it, and is forced through only once the meters are five intervals stale.
- Refresh just the provider behind a single displayed meter instead of every configured provider; keep sweeping every provider when several meters are shown, so pinned accounts still advance.
- Pause automatic refreshes while no meter is displayed, and run the waiting refresh as soon as one appears instead of an interval later. Account & Usage then updates only when you refresh it.
- Spread each refresh with up to 20% random jitter, and raise the `t3-vscode.usage.refreshIntervalSeconds` default from 60 to 300 seconds. An interval you have already set is unchanged.
- Pass 222 deterministic tests, TypeScript checking and full builds. Fresh-context regression review found nothing blocking across three rounds. The first round's two behaviour findings (a swallowed connect refresh and starved pinned meters) are resolved above, and its optional suggestions are applied: a reconnect or a reappearing meter during a hung refresh is no longer swallowed by that refresh completing, and the archived-session and disabled-instance cases are now covered by tests. The third round reviewed that final state against `7e19b2d` and approved it; its remaining notes are non-blocking. Published to the Marketplace prerelease channel.

## 0.1.18 — Release

- Fix chat rows occasionally drawing over each other while a reply streams, such as a new question or response header covering the end of an earlier response with images.
- Clear leftover blank space below the last response after resizing a session.
- Refresh provider usage meters automatically once the extension connects and on an interval; add `t3-vscode.usage.refreshIntervalSeconds` (default 60, minimum 15; `0` disables periodic refresh).
- Pass 204 deterministic tests and TypeScript checking. Fresh-context regression review found no blocking regressions; published to the Marketplace release channel from `251cfec`.

## 0.1.17 — Alpha prerelease

- Show one changes box per response only when the agent made file changes; hide empty, loading and unavailable diff placeholders.
- Remove all manual-edit lists and counts from chat while continuing to exclude pre-response edits from agent diffs.
- Compare the final response checkpoint against its saved start snapshot so the single box includes the response's complete file changes.
- Pass 200 deterministic tests, TypeScript checking, full builds and browser regressions, including delayed completion and a single combined changes box. Fresh-context regression review against `b71e129` found no blocking regressions.

## 0.1.16 — Local response diff fix, unpublished

- Exclude saved manual edits made between responses from new response diffs, including edits within the same file; list pre-existing edits separately.
- Retain immutable native diffs across reloads. Mark attribution unavailable for responses without a pre-message snapshot, including older, queued, steered and externally started responses.
- Pass 198 deterministic tests, TypeScript, full builds and browser regression checks; obtain independent final regression approval before local packaging.

## 0.1.16 — Local resize fix, unpublished

- Fix persistent blank space below the last chat response after resizing a session by clearing temporary scroll-adjustment padding reliably.

## 0.1.16 — Alpha, release channel

- Add separate Sessions and Tasks managers with their own new-item buttons, independent project tasks and session groups for subagents and scheduled tasks.
- Remove the repeated project name above Tasks in a single-project workspace; retain project selection when multiple projects are available.
- Edit task prompts, models, ordinary advertised effort, schedules and result destinations on a sidebar page; preserve chat drafts and keep task saving separate from running.
- Show compact session activity ages and support model ordering with drag handles or Alt+Up/Down.
- Remove the T3 Web import button, Command Palette command and JSON import path; keep existing saved favorites, visibility and ordering.
- Match queued-message editing to the main composer's prompt font size and line spacing while retaining compact previews and the current draft.
- Preserve task drafts across reconnect and native sidebar navigation, and reject newly selected prompt-driven effort values that cannot be applied as saved task options.
- Pass 193 deterministic tests, TypeScript checking, full builds, browser suites and isolated native/task checks, including one GPT-6 Luna Low scheduled run; obtain independent regression signoff before packaging.
- Publish the reviewed v0.1.16 VSIX to the stable release channel by owner request, with manifest `preview: false` and no version bump; public Marketplace metadata now lists it with the uploaded package checksum.

## 0.1.16 — Initial local installer, unpublished

- Use selected composer text as a pasted image's description, preserving the filename when no text is selected and retaining attachment ownership and inline positions.
- Add model visibility and ordering controls, accurate visible-model counts and an explicit import of T3 Web's device-local favorites and model preferences.
- Pass 183 deterministic tests and both browser regression suites; resolve independent review findings for custom provider IDs and failed native preference writes before local packaging.

## 0.1.15 — Alpha, release channel

- Make the Windows `t3.cmd` and `.bat` pairing fix available on the release channel, using the same runtime as the working 0.1.14 preview.

## 0.1.14 — Alpha prerelease

- Publish the Windows pairing fix from the local 0.1.13 revision to the preview channel; the release channel remains on 0.1.13.
- Resolve Windows `t3.cmd` and `.bat` launchers through the command shell with escaped paths and arguments, while retaining direct execution for native executables, Linux and macOS.
- Cover CLI resolution, paths with spaces, pairing failures and the bearer exchange with regression tests; native Windows execution still needs verification.

## 0.1.13 — Local Windows pairing revision

- Fix automatic pairing with Windows `t3.cmd` and `.bat` launchers by resolving the CLI and escaping the shell command; retain direct execution for native executables, Linux and macOS.
- Keep version 0.1.13 for the local installer; this revision does not update the Marketplace package.

## 0.1.13 — Alpha, release channel

- Guide first connection through T3’s web/provider setup, keep the background service optional and enter Sessions automatically after connecting.
- Show accurate discovery/pairing diagnostics and copy startup commands for the configured T3 directory, preserving isolated development setup.
- Rename conversations by double-clicking the title; browse tab-local History and create fresh editor chats from the header, sidebar or Command Palette.
- Keep a permanent grouped Markdown toolbar, high-contrast input, model/effort/mode controls inside the composer, and a stationary Send button beside the existing Stop style.
- Add selection wrapping, automatic list numbering with undo, list continuation and indentation while preserving literal Markdown, paste, IME, autocomplete and send/queue/steer shortcuts.
- Recover text, references, cursor position and attachments after closing tabs or restarting; concurrent tab drafts and web UI drafts stay separate.
- Search complete history with one row per occurrence, matching chat fonts, persistent source/content filters and compact controls.
- Collapse search to a floating bar without blank pane space; switch Above/Side, expand directly to Side, and stack automatically in narrow editors.
- Show Working as soon as dispatch succeeds, keep all assistant prose visible, and fold only thought/tool groups separated by messages and steers.
- Use one assistant header per run, a status-only pinned Working header, dense message gaps and one capability-gated fork at the end of a settled run.
- Keep the account refresh/update time and shorten its settings link to **Status meters**.
- Release version 0.1.13 on the Marketplace release channel; no new prerelease is published.

## 0.1.12 — Alpha prerelease

- Insert editor selections at the last-used chat's prompt cursor with Ctrl+K (Cmd+K on macOS), retaining Alt+K.
- Show readable file/range references inside the prompt and preserve exact unsaved source text when sending.
- Exclude removed file references from the sent context and keep each chat's draft independent.
- Move development setup and VS Code testing instructions into a separate guide.
- Set the Marketplace publisher to `hungtienhuang` for the first public prerelease.

## 0.1.11 — Alpha preview

- Insert assistant quotes at the prompt cursor and preserve inline source links when sending, queueing or steering.
- Keep comments editable and remove quote references without sending unused quote data.
- Use one version from package.json throughout documentation, installers and Marketplace metadata.
- Add screenshots captured from the extension with prepared demo conversations.

## 0.1.10 — Alpha preview

- Remove the two-column reader, its layout controls and its settings to keep chat virtualized at every editor size.
- Retain wide-equation scrolling, floating previews and LaTeX/MathML copying.
- Use localhost for local browser links so an existing paired browser session can be reused.
- Prepare numeric status versioning, prerelease packaging, listing metadata, licensing and support documentation.

## 0.0.9 — Local preview

- Move chat into independent editor tabs and consolidate account usage in the sessions sidebar.
- Reveal existing conversation tabs from session links and input notifications.
- Fix saved-turn diff ranges and improve expanded command readability.
- Add image references at the cursor and preserve attachment ownership when inserting another image.
- Show only reported usage windows and group native settings by purpose.
- Introduce the two-column reader experiment, removed in 0.1.10 after performance feedback.

## 0.0.8 — Local preview

- Add interactive HTML, Mermaid, KaTeX and authenticated media rendering.
- Add image clipboard paste, local file picking and sent-image thumbnails.
- Add nested subagents, live status cards and parent conversation navigation.
- Add the versioned feature inventory and fresh-context regression review requirement.

Earlier changes are recorded in [the feature history](docs/feature-history.md).
