# Plan: Piece 1 spike (T3 chat in a VS Code panel)

Status: Codex review (R1 to R8) and the owner's decisions of 2026-10-12 (HANDOFF section 1.2) folded in on 2026-10-12. No code exists. Written 2026-10-11 from `docs/HANDOFF.md` section 5. Questions 1 and 2 were checked against the live nightly `0.0.46-nightly.20261011.2980` (commit `ed0f7b90`) on `http://127.0.0.1:3773`. The reference clone moved to nightly .2994 (`d07a07f3`) on 2026-10-12, so the source line numbers cited here and in the review may drift by a few lines.

## Goal and non-goals

Goal of the spike: one command, "T3: Open", reveals a side panel view in VS Code (like the Claude Code extension, not an editor tab, decision 2) that shows the owner's running T3 nightly, already signed in, usable (read threads, send a message, live updates). That proves Piece 1 is possible and tells us which sign-in design survives. It is the first brick of the integrated product described in HANDOFF section 1.1, not the product.

## Before the spike starts

1. Done 2026-10-12: the Codex review is folded into this plan body.
2. Done: the feature checklist is `docs/FEATURES.md` (written 2026-10-12 from the installed Claude Code 2.1.296 and Codex 26.51007 extensions). Its item 4 (a URI handler as the editor command) is dead: T3 has a fixed editor list and no custom command, see HANDOFF 1.2 decision 1.
3. Done 2026-10-12: click capture is decided (decision 1). T3's own "Open in editor" action is the entry point and our extension handles what follows. No script is injected into T3's page.

Not in the spike: Piece 2 and 3, thread awareness, deep links, status bar, more than one panel, packaging to a `.vsix`, tests, settings UI, starting or stopping T3 for the owner, file-click handling (see "After the spike").

## Preconditions

- The T3 desktop window is open. The server lives only as long as the window (HANDOFF section 4).
- The owner is present for step 0 (right before step 2, and again before step 3 on the bearer branch) and for step 5. Both need the T3 desktop app or the phone.
- Nothing in this plan reads `t3` CLI output. On this PC the CLI prints nothing (HANDOFF section 5, question 1).

## What we know and what we assume

Known (live or source, see HANDOFF section 5, question 2):

- The server serves the web UI over plain HTTP, sends no frame-blocking headers, no `Set-Cookie` on GET, and `access-control-allow-origin: *`. It checks neither `Origin` nor `Host` on `/api/*` or `/ws`.
- Sign-in: a one-time pairing token (5 min, one use), delivered as `<origin>/pair#token=<token>`. The `/pair` page submits it by itself and the server sets an HttpOnly `SameSite=Lax` cookie (30 days). The name comes from `sessionCookieName` in `/api/auth/session`. The page also has a form to paste a token by hand.
- The same-origin web client opens `/ws` with no ticket; the cookie rides on the upgrade.
- The server accepts, in this order, the session cookie, `Authorization: Bearer`, DPoP, on HTTP and on the `/ws` upgrade. The first credential present wins; an invalid cookie is not rescued by a valid bearer. Codex traced the ticketless bearer path on the upgrade and found it supported at this commit (R2).
- `POST /oauth/token` exchanges a pairing token for a Bearer that lives as long as the session, 30 days. It needs four form fields (HANDOFF question 2, item 7). The session gets the scopes and the label the owner chose when minting the link.
- The web client's primary origin is `window.location.origin`, because the nightly bundle has empty `VITE_HTTP_URL` and `VITE_WS_URL`. A page served from a forwarder talks only to that forwarder, for HTTP and `/ws`. Before the socket it fetches the environment descriptor over HTTP.
- The web UI never reads `document.cookie` and never uses a bearer unless `window.desktopBridge` exists. It only cares that `/api/auth/session` says `authenticated:true`. We do not fake `desktopBridge`.

Assumed, to be proven by the spike:

- A1. A frame under `vscode-webview://` will not keep a `SameSite=Lax` cookie from the T3 origin (cross-site). So direct pairing in the panel fails to stay signed in.
- A2. A forwarder in the extension host that adds `Authorization: Bearer <token>` upstream makes the frame behave like a normal signed-in browser tab, including the WebSocket. The source supports it; the open part is the real webview and proxy transport, and nightly churn.

## Design, kept small

```
VS Code side panel view  --iframe-->  http://127.0.0.1:<fwdPort>/      (extension host, Node http)
                                          | Host must be 127.0.0.1:<fwdPort>, foreign Origin refused (HTTP and upgrade)
                                          | strips Cookie, adds Authorization: Bearer <token>
                                          | adds CSP frame-ancestors to HTML responses
                                          | pipes WebSocket upgrades, tracks and closes them
                                          v
                                      <discovered T3 origin>             (T3 nightly, untouched)
```

The forwarder exists only if A1 holds. If direct pairing in the panel stays signed in, the iframe points at the T3 origin and there is no forwarder. That is the smallest possible result.

Files (plain JavaScript, no build step, no dependencies):

- `package.json`: extension manifest, a view container with one webview view, one command "T3: Open" (`t3vscode.open`) that reveals the view (`<viewId>.focus`), `"extensionKind": ["ui"]` so a WSL or SSH window still runs this on the PC that has T3.
- `extension.js`: activate, register the command and the view provider (`registerWebviewViewProvider` with `webviewOptions.retainContextWhenHidden`), render the iframe, dispose the forwarder when the view is disposed.
- `t3.js`: the only file that knows T3. Discover the server, check it, exchange the token, forward. If a nightly breaks us, this is the file that changes.

Target about 300 lines in total; up to 400 is fine now that R1 and R3 add real code. The number is a review prompt: past it, stop and ask what is extra. It is not a test for copying VSmux.

## Steps

Every step has a pass condition. Do them in order. Step 2 has three outcomes and picks the branch; outside that, stop at the first failure and write down what happened in HANDOFF section 5. Commit once per step that passes its check (decision 7).

### Step 0. Owner action: get a pairing link (the only writes to T3)

Minting a pairing token creates a grant in T3's database. It is a write and needs the owner's OK. The owner creates a pairing link in the T3 desktop app (Settings, Connections; the page's search text is "pairing links qr code authorized clients"), labels it "VS Code", and copies the whole link. Lifetime is 5 minutes, one use, so mint it right before step 2 needs it.

Scopes: keep the default full set (decision 3). It includes terminal, file write and settings write, so this credential can run code. The "Read only" preset is not enough to chat.

One link for step 2. A second link only if step 2 selects the bearer branch (steps 3 and 4).

Pass: the owner has a pairing link.

### Step 1. Scaffold the real panel and discovery (read-only)

- `package.json` with `engines.vscode`, `main: extension.js`, `extensionKind: ["ui"]`, the view container, the view and the command "T3: Open".
- `t3.js: discover()`: read `<T3CODE_HOME or ~/.t3>/userdata/server-runtime.json` (`origin`). Parse it once. Refuse a scheme other than `http:` or a host that is not loopback, before any bearer exists. Then `GET <origin>/api/auth/session` with a 2 s timeout. Accept only `content-type: application/json`; the SPA fallback returns 200 HTML for any unknown path, so a JSON parse error means "route moved", not "T3 down". Distinguish "no file" from "no answer": the file is not removed when T3 quits.
- The view shows "Connected to T3 at <origin>" or a clear error "T3 is not running. Open the T3 desktop app."
- View HTML: CSP `default-src 'none'; frame-src http://127.0.0.1:*; style-src 'unsafe-inline'`, no `localResourceRoots`. One full-size `<iframe allow="clipboard-read; clipboard-write" sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads">`.

Pass: F5 (Extension Development Host), run "T3: Open", the side panel opens with the message. Fails closed with a readable message when T3 is quit.

### Step 2. Direct pairing in the real panel (tests A1)

"T3: Open" asks for the pairing link and points the iframe at it, fragment intact (`<origin>/pair#token=...`). Never move the token into a query string. If the fragment gets lost, point the iframe at `<origin>/pair` and paste the token into T3's own form. Redact pairing URLs and request targets in every note. Open "Developer: Open Webview Developer Tools" and record:

- Does the T3 page render in the frame at all?
- Network tab: does `POST /api/auth/browser-session` return 200 with a `Set-Cookie`, and does the next `GET /api/auth/session` say `authenticated:true`?
- Chromium console: any "cookie was blocked because SameSite" warning.

Three outcomes:

- Signed in, and still signed in after reloading the VS Code window: A1 is false. Keep this panel pointed at the T3 origin, skip steps 3 and 4, go to step 5.
- Page renders but stays `authenticated:false` (expected by A1, for example "Timed out waiting for authenticated session after bootstrap"): not a failure. Mint a fresh link and continue to step 3.
- The frame does not render: framing is blocked. Stop and use the decision rules.

### Step 3. Bearer branch only: exchange the token, keep the bearer

- Input box asks for the pairing link once. `t3.js: pair(link)` POSTs form-urlencoded `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, `subject_token=<token>`, `subject_token_type=urn:t3:params:oauth:token-type:environment-bootstrap`, `requested_token_type=urn:ietf:params:oauth:token-type:access_token`, `client_label=VS Code` to `<origin>/oauth/token` (`packages/contracts/src/auth.ts:227-231`, `:298-308`). Reads `access_token`; stores it in `context.secrets`. Never log the token. Show the JSON error body on failure, because the one-time token is probably spent.
- On start, `GET /api/auth/session` with `Authorization: Bearer <token>`; if `authenticated:false`, ask for a new pairing link.

Pass: `authenticated:true` from `/api/auth/session` with the stored bearer. The owner sees the client in T3's Connections list under the grant's label ("VS Code", or whatever label the owner gave the link; the grant label wins over `client_label`). The restart check moved to step 5.

### Step 4. Bearer branch only: the forwarder (A2)

`t3.js: startForwarder({origin, token})`: Node `http` server on `127.0.0.1:0` (random port). Upstream hostname, port and `Host` come from the discovered origin, for HTTP and upgrades alike; never hard-code a port. Per request and per upgrade:

- Inbound `Host` must equal `127.0.0.1:<fwdPort>`, else 403. This blocks DNS rebinding.
- If an `Origin` header is present and is not `http://127.0.0.1:<fwdPort>`, answer 403. Same check in the `upgrade` handler.
- Drop the inbound `Cookie` header (a stale `t3_session_*` would win over the bearer and fail with no fallback). Set upstream `Host` and `Authorization: Bearer <token>`. Keep the full path and query.
- HTTP: stream the request upstream (`req.pipe`), stream the response back (`upstream.pipe(res)`), never buffer. Drop `Set-Cookie`, replace `access-control-allow-origin` with the forwarder's own origin. On HTML responses add `Content-Security-Policy: frame-ancestors vscode-webview: vscode-file:` as an extra header, keeping any CSP T3 sends. A normal browser page then cannot frame the forwarder. Check the real ancestor chain in the panel's developer tools; never use `*`.
- Upgrade: `http.request` upstream with the same header changes, WebSocket negotiation headers kept. Write the inbound `head` buffer upstream; on the upstream `upgrade` event write the `101` line and headers back, then the upstream `head`, then pipe both sockets. Handle upstream `response` (non-101), `error`, timeout and early close by destroying both ends. Track every upgraded socket.
- Classify a failed upgrade and show it with the status and a short redacted body: descriptor (the HTTP descriptor fetch failed before any socket), protocol (426: check the forwarded query, reload the bundle), auth (401/403), transport (error, timeout, close). Never spend a pairing grant because of a non-101 alone.
- Dispose: close the listener and destroy every tracked socket. A closed listener alone does not end an established socket.

The iframe points at `http://127.0.0.1:<fwdPort>/`, with no token in the URL.

Pass: the T3 UI renders with all threads visible and no pairing screen, and a reply streams (WebSocket through the forwarder).

### Step 5. Prove it works (the acceptance run)

Run all of this by hand, with the owner's real T3, and write the result per line (pass / fail / note) into HANDOFF section 5:

1. The panel loads, signed in, shows the same project and thread list as the desktop app.
2. Create a thread in the panel, send "reply with the word ok". The reply streams in the panel (this proves the WebSocket path). The same thread, with the same messages, shows in the desktop app and on the phone (T3 stays the only owner of state).
3. Send a message from the desktop app into an existing thread; it appears live in the panel.
4. Persistence: reload the VS Code window and run "T3: Open": signed in, no pairing prompt (cookie, or SecretStorage plus a forwarder restarted on a new port).
5. Bearer branch only, guard checks while the panel is open:
   - Wrong Host: `curl -i -H "Host: evil.example:<fwdPort>" http://127.0.0.1:<fwdPort>/api/auth/session` returns 421 (misdirected request).
   - Foreign-Origin upgrade: `curl -i -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Origin: https://evil.example" "http://127.0.0.1:<fwdPort>/ws"` returns 403.
   - Foreign-page embedding: a local HTML file opened in a normal browser with `<iframe src="http://127.0.0.1:<fwdPort>/">` shows a blocked frame (frame-ancestors).
   - Socket disposal: with a reply streamed, close the view so VS Code disposes it (record which action does that). `netstat -ano` then shows no ESTABLISHED connection on `<fwdPort>` and none from the extension host to the T3 port, and the port refuses new connections.
6. Quit and restart the T3 desktop app: the panel reconnects after a reload, still signed in (session survives, 30 day TTL; record if it does not).
7. Plain `curl http://127.0.0.1:<fwdPort>/api/auth/session` returns `authenticated:true`. Known hole: a local process can use the forwarder. Record it.
8. "Developer: Open Webview Developer Tools": no CSP errors, no cookie warnings, no repeated 401s.
9. UX smoke test: typing, paste, Ctrl+V of an image, focus in and out of the panel, file link click, dark theme, `window.confirm` dialogs (T3 uses them). Record each as pass or ugly; do not fix them in the spike.

The spike is done when 1 to 5 pass (5 only on the bearer branch). 6 to 9 are findings, not gates.

## Decision rules after the spike

- Gates pass: Piece 1 is viable. Next: harden `t3.js` (re-pair UX, server restarts, T3 down), then Piece 2.
- Panel loads but the WebSocket fails through the forwarder: classify first (step 4). Fix a protocol or transport failure in the forwarder. Only if a valid-protocol upgrade with a known-valid bearer is rejected for auth (401/403), try the cookie as one experiment: the host POSTs a fresh pairing token to `/api/auth/browser-session`, keeps the `Set-Cookie` value, and the forwarder sends it as `Cookie` instead of the bearer. The cookie path on the upgrade is what the phone uses, so it is the stable one.
- Framing itself is blocked by VS Code or T3: stop. Fallback: open the T3 URL externally with a small status bar launcher. Report to the owner before choosing.

## After the spike (not now)

- File clicks (decision 1): handle T3's "Open in editor" on our side. Ideas to check: a `vscode://` URI handler as the editor command, and an active-editor listener that reveals the file in the Explorer and fixes focus.
- Start T3 (decision 4): a "Start T3" button in the view when T3 is not running. Never auto-start.
- Editor setting (decision 5): detect T3's "Open in editor" setting (missing, VS Code, another editor), show a one-time hint with a button that opens T3's settings in the panel, and work sensibly in every state.
- MCP registration (decision 6): a helper for Piece 2 that shows the exact server entry, a copy button, and "add to Claude Code / Codex / other".
- Scopes (decision 3): an extension setting for the pairing scopes. The default stays the full set.
- `t3 service` so the server outlives the desktop window.
- `GET /.well-known/t3/environment` for a label and version in the status message (contract `packages/contracts/src/environmentHttp.ts:450`, no auth). Left out of the spike to keep one nightly surface fewer.
- A per-launch secret hostname (`<random>.localhost`) is no longer planned; the plain Host check in step 4 covers rebinding.

## Risks and what we do about them

| Risk | Handling |
|---|---|
| The forwarder exposes a signed-in T3 on a local port. With the default scopes that bearer can run terminals and write files | Bind `127.0.0.1` only, random port, forwarder lives only while the view is open, sockets destroyed on dispose. Exact Host required (no rebinding), foreign `Origin` refused on HTTP and upgrades, `frame-ancestors` stops a normal browser page from framing it. Bearer in SecretStorage, never logged. A local process can still use it (step 5.7) |
| A stale `t3_session_*` cookie in the webview jar hides the bearer | The forwarder strips `Cookie` and drops `Set-Cookie` |
| The `/ws` bearer path on the upgrade is unused by first-party clients, so a nightly can drop it. The UI would then spin on "connecting" with no error | The forwarder classifies every non-101 answer. Only an auth rejection leads to the cookie experiment |
| The web client stops using `window.location.origin` as its server | Visible as a pairing or error page in the frame, not detectable by our code. Noted; nothing to do in the spike |
| Nightly changes auth routes or response shapes | Routes are the public ones the phone and browser use and live in `packages/contracts`. Content-type checks turn "route moved" into a readable error. All of it sits in `t3.js` |
| Pairing token mint is a write to T3 | Owner does it, on purpose (step 0). One grant for step 2; a second only on the bearer branch |
| The server stops when the T3 window closes | Step 1 fails closed with a clear message. `t3 service` is a follow-up |
| `server-runtime.json` is stale after a quit | The HTTP probe with a timeout in step 1, and a message that tells "no file" from "no answer" apart |

## What this plan deliberately takes from VSmux and what not

Taken as ideas only (MIT, nothing copied): a local forwarder so the webview talks to an origin we control; `allow="clipboard-read; clipboard-write"` and the sandbox list on the iframe; `retainContextWhenHidden`; a visible loading and error state. The forwarder shape (Node `http` server, `upgrade` event, pipe both ways) is the standard Node reverse-proxy pattern, not VSmux structure. VSmux's local listener already uses a random port on `127.0.0.1`; the fixed port 3774 and `0.0.0.0` belong to its separate shared listener. Where we differ on purpose: VSmux buffers bodies through `fetch`, fakes `window.desktopBridge`, ships its own T3 build and uses a broad script CSP; we use the live served UI, stream, check Host and Origin, restrict framing and strip cookies. Not taken: bundled T3 build, private T3 server and home, faked `window.desktopBridge`, DOM and URL polling of the frame. See HANDOFF section 5, question 2.

## Review (Codex)

Folded into the plan body on 2026-10-12.

Reviewed against `reference/t3code` at `ed0f7b908b2e7b3a22e6fd82a73794c2fe6ee06e` (clean checkout). This is source review, using only the previously recorded live observations in HANDOFF section 5. No T3 execution, HTTP probes, pairing, builds or installs were performed. Browser behaviour described below remains unverified on this PC unless explicitly attributed to those recorded observations.

**Verdict: No. Cut the separate Simple Browser experiment and the pre-panel restart milestone; test A1 in the actual minimal panel, add the forwarder only if needed, and test persistence after chat works. Keep the security and socket-disposal checks as gates.**

### R1. The Origin guard does not establish the claimed browser boundary

**Severity: blocks the spike. Target:** step 4, step 5.7, and the claim that refusing foreign `Origin` means a web page cannot use the forwarder.

**Evidence:** `reference/t3code/apps/server/src/http.ts:625-627` sets cache headers on the SPA, not a framing restriction; HANDOFF section 5.1 records: "The response headers of `/` carry no `X-Frame-Options` and no `Content-Security-Policy`." A bearer is sufficient for authenticated session state (`reference/t3code/apps/server/src/auth/EnvironmentAuth.ts:672-675`, `:782-792`), and the default grant includes terminal operation and file writes (`reference/t3code/packages/contracts/src/auth.ts:205-219`).

**Finding:** the proposed rule explicitly accepts requests without `Origin`. A foreign page's iframe navigation can reach the signed-in UI that way; requests subsequently made by that framed UI originate at the forwarder's own origin and pass the guard. This creates a clickjacking exposure, even though the parent cannot read the frame directly. There is also no inbound Host validation to exclude a rebinding hostname. These are design-level attack paths, not browser exploits demonstrated in this review; browser local-network restrictions are not verified protection. Changing CORS does not restrict document embedding. Merely demonstrating that one cross-origin `fetch` fails is insufficient.

**Concrete fix:** before using the real bearer, validate the inbound Host against the exact forwarder authority, apply the Origin check in both HTTP and upgrade handlers, and restrict framing through a response `frame-ancestors` policy to the actual VS Code ancestor origins. Verify that ancestor chain in the real panel; do not guess it or use `*`. Retain stricter upstream CSP where present. Make wrong-Host, foreign-Origin upgrade, foreign-page embedding, and disposal checks gates. This needs neither the deferred secret hostname nor a new auth framework. The already acknowledged local-process access remains a separate limitation.

### R2. A non-101 response does not mean bearer-on-upgrade is broken

**Severity: should fix. Target:** A2, step 4 error handling, and the cookie fallback decision rule.

**Evidence:** the `/ws` handler checks the orchestration query parameter before authentication and returns 426 on mismatch (`reference/t3code/apps/server/src/ws.ts:606-610`, `:3149-3178`). With no nonempty `wsTicket`, authentication falls through to `authenticateRequest`, which selects and verifies the bearer after cookies (`reference/t3code/apps/server/src/auth/EnvironmentAuth.ts:1185-1205`, `:662-688`, `:729-779`). No application-level Origin or Host rejection occurs on this traced upgrade path: `ws.ts:3179-3188` proceeds to RPC; `readClientConnectionOrigin` only reads attribution query parameters (`:622-636`). The common route wiring installs CORS, not an authentication origin allowlist (`reference/t3code/apps/server/src/server.ts:710`, `:737-738`; `apps/server/src/http.ts:239-260`).

**Finding:** bearer without a ticket is supported by this commit. A2's remaining uncertainty is the actual webview/proxy transport and future compatibility. A 426 may instead mean a lost query string or stale bundle. Failure can also precede any upgrade: the web client fetches the environment descriptor during primary registration (`reference/t3code/apps/web/src/connection/platform.ts:344-360`, `:613-618`) and checks it before opening the socket (`reference/t3code/packages/client-runtime/src/connection/resolver.ts:291-316`). Deferring our own descriptor request does not remove that dependency from the spike.

**Concrete fix:** classify failures as discovery/descriptor, protocol, authentication, or transport; retain the status and a bounded, redacted error body. For 426, inspect the forwarded query and reload the served bundle. Try a fresh browser-session credential only after a valid-protocol request with a known-valid bearer is actually rejected for authentication. Do not spend another pairing grant merely because a response was not 101.

### R3. Specify the small but necessary WebSocket forwarding and shutdown contract

**Severity: should fix. Target:** step 4's "write the 101 line and headers back, then pipe both sockets" and "close the forwarder".

**Evidence:** the browser adds client parameters and then the required protocol parameter to the socket URL (`reference/t3code/packages/client-runtime/src/connection/resolver.ts:74-83`, `:314-316`; `packages/client-runtime/src/connection/compatibility.ts:38-41`). The server requires that parameter (`reference/t3code/apps/server/src/ws.ts:3153-3163`) and keeps an authenticated RPC connection alive until the transport ends or the session is invalidated (`:3238-3251`). HANDOFF section 5 records the live sequence "windowAllClosed", "backendInstance.stop", "beforeQuit", so an upstream disappearance is a real condition for this spike.

**Finding:** the sketch leaves the raw request target, upgrade head buffers, error paths and upgraded-socket disposal unspecified. These are transport correctness requirements, not optional hardening. A Node server's listener closing is not proof that an already upgraded authenticated socket has closed.

**Concrete fix:** preserve the complete request pathname and query; forward both upgrade `head` buffers in the correct direction before piping; preserve WebSocket negotiation headers. Handle upstream `response`, `error`, timeout and early close, and destroy both socket ends on failure. Track upgraded sockets and destroy them on panel disposal, alongside closing the listener. Add a manual check that an established connection stops on disposal; a refused new connection alone does not prove cleanup. Do not add retries, a WebSocket library, or RPC parsing for this spike.

### R4. Discovery and forwarding disagree about the server authority

**Severity: should fix. Target:** step 1's discovered `origin` versus step 4's hard-coded `Host: 127.0.0.1:3773`.

**Evidence:** runtime state records the actual port and constructs the origin from it (`reference/t3code/apps/server/src/serverRuntimeState.ts:48-53`, `:56-66`). HANDOFF section 5.1 explicitly says: "Do not hard-code 3773: port and cookie name come from the running instance."

**Finding:** using a discovered destination with a different hard-coded Host is internally inconsistent. This commit's upgrade auth does not reject that mismatch, but it unnecessarily depends on that permissiveness and is wrong as soon as the running authority changes.

**Concrete fix:** parse and validate the discovered URL once; for this local-only spike, fail clearly for an unsupported scheme or non-loopback target before attaching a bearer. Use that URL's hostname, port and `host` consistently for both HTTP and upgrades, while preserving the incoming path/query. Keep the inbound forwarder Host validation from R1 separate from the upstream Host rewrite. No general remote-server configuration is needed.

### R5. Prove the real panel first, and make the two sign-in branches executable

**Severity: should fix. Target:** steps 0-3, the A1-success instruction to delete step 4, and the smallest-spike claim.

**Evidence:** on a fresh `/` load, the root route awaits the auth gate (`reference/t3code/apps/web/src/routes/__root.tsx:88-118`). Its module caches start empty (`apps/web/src/environments/primary/auth.ts:142-144`); it fetches session state and accepts `authenticated:true` without a bootstrap credential (`:181-188`, `:312-323`, `:447-468`). The same-origin HTTP layer uses `credentials: "include"`, without requiring a cookie to exist (`apps/web/src/environments/primary/httpLayer.ts:9-18`, `:33-41`). With no bridge, the bearer provider returns null (`apps/web/src/environments/primary/desktopAuth.ts:3-10`; `apps/web/src/connection/platform.ts:265-273`), and the broker prepares a ticketless socket (`packages/client-runtime/src/connection/resolver.ts:94-103`). The source therefore supports signed-in first render and reload through bearer injection; it does not prove VS Code storage or framing behaviour. Pairing instead sets a Lax cookie (`apps/server/src/auth/http.ts:319-324`) and the `/pair` route reloads to `/` after success (`apps/web/src/routes/pair.tsx:44-49`).

**Finding:** Simple Browser's equivalence to our eventual panel, including storage persistence, is unverified. It adds a separate surface without proving that panel's reopen acceptance condition. Also, deleting all of step 4 on A1 success deletes the only explicit panel implementation step, and the global "stop at the first failure" conflicts with the expected cookie failure that is supposed to select the forwarder branch.

**Concrete fix:** scaffold the final one-command panel and discovery, then mint a link immediately before testing direct pairing in that panel. If direct pairing survives reopen/reload, keep that panel and omit only exchange/forwarding. If the page renders but cookie auth fails, continue to the bearer branch with a fresh grant; distinguish that expected outcome from a framing failure. Open the bearer-backed frame at `/` without a pairing token. Move the separate step-3 restart check into the final panel acceptance run, keeping SecretStorage and one real persistence check. Request a second link only if that branch is selected. Do not fake `desktopBridge` or rebuild the auth UI.

### R6. Do not put the pairing secret into a query-string workaround

**Severity: should fix. Target:** step 2's fallback from `#token=` to `?token=`.

**Evidence:** T3 deliberately constructs pairing links with a fragment and removes a query token (`reference/t3code/apps/server/src/startupAccess.ts:92-97`). Its parser does accept both forms (`reference/t3code/packages/shared/src/remote.ts:144-151`), but stripping the token happens in the loaded page (`reference/t3code/apps/web/src/components/auth/PairingRouteSurface.tsx:78-86`), after the initial document request. That component also provides manual credential submission (`:70-75`, `:97-99`).

**Finding:** parser support does not make the two URLs equivalent for secret handling: a query token goes into the initial HTTP request target, where a diagnostic capture can record it. No claim is made that such a capture is currently enabled.

**Concrete fix:** keep the fragment. If the host drops it, open `/pair` and paste the token into T3's existing form. Redact pairing URLs and request targets from spike notes and diagnostics.

### R7. The literal client-label acceptance check can fail despite correct pairing

**Severity: note. Target:** step 3's requirement that Connections show a client named "VS Code".

**Evidence:** the token handler accepts `client_label` (`reference/t3code/apps/server/src/auth/http.ts:387-395`), but session issuance spreads the grant's label after that metadata (`reference/t3code/apps/server/src/auth/EnvironmentAuth.ts:934-937`). Settings allows the owner to supply that grant label (`reference/t3code/apps/web/src/components/settings/ConnectionsSettings.tsx:1043`, `:1060-1062`).

**Concrete fix:** create the grant with the label "VS Code", or accept the owner's grant label in the check. Do not diagnose a different label as failed authentication or add relabeling code.

### R8. Correct the VSmux comparison and remove the line-count copying test

**Severity: note. Target:** "If t3.js grows past [300 lines], we are copying VSmux" and the fixed-port/LAN-listener comparison.

**Evidence:** VSmux's asset server already binds its **local** listener to port `0` on `127.0.0.1`; the fixed port and `0.0.0.0` apply to a separate shared listener (`reference/VSmux/extension/workspace-asset-server.ts:163-176`). Its distinctive implementation buffers responses (`:305-337`), installs a fake bridge (`reference/VSmux/workspace/t3-frame-host.ts:708-725`), and uses a much broader script CSP (`reference/VSmux/extension/workspace-panel.ts:480-488`).

**Concrete fix:** describe the two VSmux listeners accurately. Keep 300 lines as a review prompt, not evidence of copying or a reason to omit R1/R3. No wholesale-copy concern is established by this plan; assess actual borrowed code and attribution when a diff exists. The proposed use of the live served UI, without the fake bridge or shipped bundle, is the meaningful design distinction.

## Code review (Codex), 2026-10-12

Reviewed `package.json`, `extension.js`, `t3.js` and `scripts/selfcheck.mjs` at **`bde3bad`**. All extension file:line citations below refer to that commit, including where the working tree has since changed. Scope assumes one local user and one retained side panel. No code was edited, no commit was made, and no live T3 request, CLI, real credential, build or install was used. Additional probes loaded committed source in memory and used fake loopback upstreams and invented credential strings.

**Verdict: fix C1 and C2 before calling this slice done; the passing baseline misses these failure paths.** The real Electron panel, its Fetch Metadata headers, actual ancestor chain, pairing and signed-in chat remain **unverified by this review**. The other agent's live run must supply that evidence. No ordinary-browser bypass of the existing root-HTML guards was demonstrated here.

### C1. Truncation defeats secret redaction

**Severity: blocks. Evidence:** `t3.js:17-20`, `t3.js:96-98`, `t3.js:162-164`, `t3.js:185-189`; diagnostic sinks at `extension.js:92`, `extension.js:110-112`.

**Reproduced:** a refused upgrade body containing 290 spaces followed by the exact synthetic bearer exposes its first ten characters in both the failure callback and the downstream response. The code slices to 300 characters before looking for the full secret; the leftover prefix is too short for the fallback regex. The non-JSON exchange error takes the same unsafe slice-before-redact path for the pairing token. Separately, a non-200 JSON response with a letters-only `access_token` exposes the whole value, because only the pairing token is explicitly removed and the fallback requires a digit. Such a response from the real nightly is **unverified**; the sanitizer failure is reproduced. The JSON error branch is also not limited to 300 characters.

**Concrete fix:** remove known credential fields from parsed exchange errors, redact the exact pairing token before limiting the displayed text, and bound the final JSON diagnostic too. For refused upgrades, retain only a bounded diagnostic prefix plus enough lookahead to finish a known bearer that crosses the boundary; redact before taking the final 300 characters. Do not use the letters-plus-digits heuristic as the guarantee for credential fields. Extend the existing selfcheck with these boundary cases; no real tokens are needed.

### C2. A response that starts and then fails never completes the operation

**Severity: blocks. Evidence:** `t3.js:47-54`, `t3.js:181-191`; caller awaiting session state at `extension.js:68`.

**Reproduced:** the fake server sent JSON headers, part of its advertised body, then reset the connection. `session()` neither resolved nor rejected. The request error handler does not handle failure of the separate response stream. The same partial 403 on an upgrade left the downstream socket open and recorded no failure. The upgrade timer is cleared at response headers, so a refusal body that stalls also has no remaining deadline. No uncaught exception was observed in these probes; the verified failure is a pending operation/socket.

**Concrete fix:** reject `call()` on response-stream error/abort. In the non-101 upgrade path, handle response-stream failure through the same transport-failure cleanup as request failure, destroying both ends. Keep the existing deadline until the refusal body finishes or fails, rather than clearing it on headers. Extend the existing partial-body check to the buffered session/exchange and upgrade-refusal paths; its current streamed-HTTP case does not exercise them.

### C3. An abandoned handshake can leave an upstream WebSocket alive

**Severity: should fix. Evidence:** `t3.js:154-170`, `t3.js:175-179`.

**Reproduced:** the client disconnected while T3's fake upgrade was pending. A later upstream 101 still left the upstream socket alive. Tracking the client only removes it from the set on close; the listener that kills both ends is installed after that close has already happened, and the 101 clears the timer. Repeated frame reloads can therefore accumulate authenticated upstream connections until the whole forwarder closes.

**Concrete fix:** attach client close/error cleanup as soon as the outbound request exists, cancelling that request and its timer. In the upstream upgrade callback, destroy `upSocket` immediately if the client is already destroyed. Keep the existing pair cleanup for established connections. Add this early-disconnect sequence to the existing pending-upgrade check.

### C4. The refresh generation check protects HTML but not the forwarder

**Severity: should fix. Evidence:** `extension.js:60-77`, `extension.js:48-50`.

**Reproduced with the committed Panel and mocked VS Code/T3:** refresh A waited for session state; refresh B authenticated and installed a new forwarder; A then returned `authenticated:false` and closed B's forwarder. The HTML guard correctly left B's iframe displayed, now pointing at a dead port. A stale successful refresh can likewise close a newer listener before reaching the check after `startForwarder()`.

**Concrete fix:** after the asynchronous credential/session reads, check both the generation and view before any `closeForwarder()` or creation. Apply the same check before catch-path side effects. Increment the generation on disposal to invalidate pending work. Keep the existing post-listen check, which handles a refresh becoming stale while listening starts. No refresh queue or retry layer is needed.

### C5. An error page leaves the previous authenticated listener running

**Severity: should fix. Evidence:** `extension.js:64-68`, `extension.js:81-87`.

**Reproduced with the committed Panel:** with an existing forwarder, a discovery/session error replaced the iframe with an error message but did not close the forwarder. After the old upstream recovers, that port can again forward signed-in requests even though the panel displays an error and no T3 frame. This contradicts the intended fail-closed error state; it is not a new browser exploit or an expansion of the accepted local-process access while the panel is open.

**Concrete fix:** after C4's generation check, close the forwarder in the current refresh's catch path before showing the error state. Preserve it only for a refresh that successfully revalidates the current session.

### C6. The added framing policy rejects T3's own nested HTML previews

**Severity: should fix. Evidence:** `t3.js:10`, `t3.js:141-142`, outer T3 iframe at `extension.js:80`.

**Static finding; actual preview rendering in Electron is unverified:** every forwarded HTML response gets a policy allowing only `vscode-webview:` and `vscode-file:` ancestors. A nested preview also has the T3 page at the forwarder's HTTP origin as an ancestor, which neither source allows. The read-only reference at `d07a07f3` confirms URL-based HTML preview iframes in `reference/t3code/apps/web/src/components/files/BrowserDocumentFrame.tsx:53-58`; this is not a claim based on a live panel run. The root-only selfcheck cannot catch that nested chain.

**Concrete fix:** include the exact forwarder origin in the additional `frame-ancestors` policy alongside the verified VS Code ancestors. Ancestor checks still apply to every ancestor, so allowing this intermediate frame does not allow a foreign browser page to frame the root. Preserve T3's sandbox/CSP. Check one HTML preview in the live panel without broadening the policy to `*`.

### C7. Upgrade requests with an HTTP body wait for bytes the forwarder withholds

**Severity: should fix. Evidence:** `t3.js:125-130`, `t3.js:154-159`, `t3.js:177`, `t3.js:197`.

**Reproduced:** an upgrade with `Content-Length: 4` and four body bytes in the incoming head reached the fake upstream with that length but zero body bytes. The bytes are sent only after the upstream returns 101. An upstream that reads its HTTP body before deciding the upgrade therefore waits until timeout. Browser WebSocket handshakes have no such body; this is a malformed/local-client case, not a demonstrated browser exploit.

**Concrete fix:** reject upgrades with a nonzero `Content-Length` or a `Transfer-Encoding` before opening the upstream request. Keep early WebSocket bytes in `head` for bodyless handshakes; those are a different case and their forwarding was checked successfully.

### C8. A malformed percent escape bypasses the pairing command's error handling

**Severity: note. Evidence:** `t3.js:76-77`, `extension.js:99-104`, `extension.js:118-121`.

**Reproduced:** a pasted link ending in `#token=%` throws `URIError` instead of returning no token. `askToken()` is awaited outside the pairing command's try block, so it skips the intended readable invalid-input message. The actual VS Code notification for that rejected command is **unverified**.

**Concrete fix:** catch decoding failure in `tokenFromLink()` and return `null`, using the existing invalid-input message. Add the malformed escape to the existing parsing check.

### Simplifications

- **Delete unused discovery result fields** at `t3.js:42`: return only `{ origin: url.origin }`. Committed callers at `extension.js:66`, `extension.js:122`, `extension.js:134`, `scripts/selfcheck.mjs:212` and `scripts/selfcheck.mjs:219` consume only `origin`; retain the local `file` variable for the discovery error. An in-memory variant passed all 20 offline checks.
- **Use the existing failure callback instead of a production history/getter solely for checks:** `t3.js:111`, `t3.js:164`, `t3.js:208`. Production already consumes `onUpgradeFailure` at `extension.js:75`. Let each selfcheck branch capture the callback, preserving the status/body/classification and close assertions at `scripts/selfcheck.mjs:167-182` and the live diagnostic at `scripts/selfcheck.mjs:233`. The in-memory offline variant passed all 20 checks. The live branch was not run.
- **Delete the empty `deactivate()` and its export** at `extension.js:176-178`. The actual cleanup is already registered in `context.subscriptions` at `extension.js:167-172`; preserve that disposer. This is a static no-op deletion, not a claim that shutdown was tested inside VS Code.

Keep the explicit Host/Origin guards, streaming and partial-stream abort, own Agent, tracked upgraded sockets and close-time destruction. Their behaviour is checked; deleting them would lose it. No dependency, WebSocket library, RPC parsing, general proxy framework or T3 modification is needed for the fixes above.

### Checks and limits

- `node --check extension.js`: **pass**, exit 0.
- `node --check t3.js`: **pass**, exit 0.
- `node --check scripts/selfcheck.mjs`: **pass**, exit 0.
- `node scripts/selfcheck.mjs` (offline, no `--live`): **pass**, exit 0, 20 PASS lines. All three files matched `bde3bad` before and after these commands. Last output line:

  ```text
  ALL PASS
  ```

- Additional committed-source Node probes: **pass** for the reproduced failures above, refresh mocks, malformed token input and in-memory offline simplifications. A separate raw transport probe verified preserved Connection/Upgrade and WebSocket negotiation headers, plus both directions of early head bytes in order. This is transport evidence, not a real WebSocket/RPC session.
- Initial partial-response probe: **failed**, because its assertion incorrectly expected an uncaught exception; the process was terminated at its timeout. The corrected probe passed and established hangs instead. An initial `rg` caller lookup **failed** with an invalid regex, and two guessed reference-file lookups **failed** because the paths had moved; corrected searches passed. A KB `rg` search returned no matching project notes (exit 1), and MCP discovery returned no matching vault search tool; local vault instructions/profile were read instead. A later context-mode memory re-read was blocked by that tool's workspace boundary; the earlier native reads had already supplied the relevant notes.
- Only this new section was authored by Codex. The other agent concurrently modified `extension.js`, `t3.js` and `scripts/selfcheck.mjs`; those changes were left untouched and had been committed by final verification. Final `git diff --stat` shows only `docs/PLAN.md` changed. The pre-section document content was verified identical to `bde3bad`.
- Not checked: live T3, real credentials, browser/Electron guard enforcement, actual UI and nightly reconnect. Security/privacy fixes C1 and transport completion C2 remain blockers; concurrent code changes need their own review.

## Code review 2 (Codex), 2026-10-12

Reviewed **`539cbab`**; all file:line evidence below refers to that commit. Only this section was written; the first review remains unchanged.

- **C1 FIXED:** exact-secret masking precedes the cap, refusal collection retains lookahead, and exchange errors drop credential fields before rendering (`t3.js:18-22`, `t3.js:106-109`, `t3.js:184`, `t3.js:219-220`); boundary and nested-field checks pass.
- **C2 FIXED:** buffered response error/incomplete-close paths reject, and refusal failure/deadline destroys both sides (`t3.js:49-60`, `t3.js:178-189`, `t3.js:216-229`); an additional stalled-body probe confirmed the actual 10-second deadline and exactly one failure callback.
- **C3 FIXED:** early client end/close abandons the outbound request; a destroyed client cannot retain a late upgraded socket (`t3.js:190-205`); the early-disconnect check passes.
- **C4 FIXED:** generation checks follow every await, stale catch paths cannot close the current forwarder, and view disposal invalidates pending work (`extension.js:48-51`, `extension.js:64-89`); committed-Panel mocks confirmed stale-refresh and disposal cases.
- **C5 FIXED:** a current refresh error closes the authenticated forwarder before the error page (`extension.js:86-93`); the committed-Panel error-state probe passes.
- **C6 FIXED in code:** the additional ancestor policy includes the exact forwarder origin and preserves upstream CSP (`t3.js:154-157`); actual nested HTML preview rendering in Electron remains **unverified by this review**.
- **C7 FIXED:** nonzero Content-Length and Transfer-Encoding upgrades are rejected before connecting upstream (`t3.js:173-176`); both body cases pass, and a separate probe confirms bodyless early head bytes remain intact.
- **C8 FIXED:** malformed percent decoding returns null (`t3.js:78-87`); the existing malformed-link assertion passes (`scripts/selfcheck.mjs:302`).
- **N1 FIXED:** same-length masks cannot pull a second, truncated echo into the visible window (`t3.js:17-22`); the double-echo check passes (`scripts/selfcheck.mjs:215-222`).
- **N2 FIXED:** the stringify replacer removes listed credential keys recursively (`t3.js:9`, `t3.js:107-108`); the nested refresh-token check passes (`scripts/selfcheck.mjs:331-345`).
- **N3 FIXED:** early-byte accounting includes head and rejects a subsequent buffer exceeding 64 KB (`t3.js:193-197`); the 70 KB flood check passes (`scripts/selfcheck.mjs:257-267`).
- **Three simplifications confirmed:** discovery returns only origin (`t3.js:44`); failure checks use the callback (`t3.js:179-186`, `scripts/selfcheck.mjs:136-137`); the empty deactivate export is gone while the registered disposer remains (`extension.js:174-183`).
- **New V1, should fix:** the shutdown check awaits `u.s` after `u` was reassigned to a rejected body upgrade (`scripts/selfcheck.mjs:269-280`); in-memory instrumentation confirmed that socket was already destroyed before `fwd.close()`. **Fix:** save the established 101 socket at `scripts/selfcheck.mjs:200`, assert it is still open immediately before close, then await that saved socket. A separate real fake-upstream probe verified that the current implementation does close both established ends; this is a verifier regression, not an observed runtime failure.

**Checks:** all three `node --check` commands and offline `node scripts/selfcheck.mjs` passed against files verified to match `539cbab` before/after; **29 PASS lines**, last line **`ALL PASS`**. Additional stalled-refusal, Panel lifecycle, head-buffer and established-socket shutdown probes passed. No command failed in this follow-up. Document-prefix preservation and `git diff --check` passed; final `git diff --stat` shows only `docs/PLAN.md` changed.

**Verdict: the runtime slice is ready pending the owner's live test; no new runtime/security blocker was found, and V1 is a non-blocking verifier repair.** Live T3, real credentials, signed-in chat, Electron guard enforcement and nested previews were not checked here.

## Code review 3 (Codex), 2026-10-12

Reviewed **`00ca4c7` against `539cbab`**; all extension file:line citations below refer to `00ca4c7`. Race probes executed the committed extension with mocked VS Code, SecretStorage and T3 using invented credentials. No live T3 request, CLI, real credential, code edit or commit was made.

- **OK, renewal protocol and scope ceiling:** `t3.js:66`, `t3.js:118-139` use the full grant for legacy metadata, preserve explicitly supplied scopes including access:write, omit review:write, and exchange the returned credential; sessions without access:write send no mint request. Offline checks pass; pinned `d07a07f3` confirms the delegated-scope gate and full OAuth scope result. Real renewal remains **unverified**.
- **OK, owner controls/startup:** `package.json:11-17`, `extension.js:184-204`, `extension.js:219-228` activate background checks without invoking Open or Start; spawning remains confined to the explicit Start command with environment filtering. Mock startup/renewal/reminder checks created no panel or forwarder and ran no Start/Open/Pair command. Actual startup in VS Code is **unverified**.
- **OK, reminder and removed A1:** `extension.js:151-175` use the five-day threshold and a calendar-day reminder latch; dismissal runs no command and the Pair button requires an owner click. `package.json:26-30` and `extension.js:183-211` have no direct-pairing command. Repeated same-day reminder probes passed.
- **OK, forwarder ownership:** `extension.js:78-81`, `extension.js:107-112`, `t3.js:156`, `t3.js:192`, `t3.js:212` distinguish own transport failures from upstream 502 answers and bind callbacks to their forwarder. Probes confirmed three own misses refresh, upstream 502 does not, and late callbacks cannot disturb a successor.
- **OK, new diagnostics and earlier verifier repair:** `t3.js:98`, `t3.js:116`, `t3.js:137` reuse bounded credential redaction; new success logs contain expiry/scope count, not the bearer (`extension.js:163`, `extension.js:192`). The selfcheck now saves and checks the established 101 socket before shutdown (`scripts/selfcheck.mjs:195`, `scripts/selfcheck.mjs:283-286`); its check passes.

- **D1, blocks: asynchronous credential writers undo Forget or a new pairing.** `extension.js:149-165` save migration/renewal results without checking that the originating credential is still current; the revoked-session branch also awaits a re-read without rechecking its generation (`extension.js:98-103`). **Reproduced:** late renewal and legacy metadata replies restore a forgotten credential; late renewal overwrites a newly paired read-only session with the old stronger grant; a delayed revoked-session re-read deletes a fresh pairing while its newer forwarder survives. **Fix:** coordinate the writers at `extension.js:23-25`, `extension.js:102`, `extension.js:156-162`, `extension.js:185-211` with a small credential generation and serialized guarded save/delete. Capture the generation before network work and discard results invalidated by Pair/Forget/revocation/disposal; recheck `live()` after the revoked branch's awaits. Keep this separate from the panel refresh generation, which cannot fence background renewal. No general session framework is needed.
- **D2, should fix: revocation while the frame is open never triggers the new revocation path.** `extension.js:80-81` treats 401 as an ordinary upstream answer, and `extension.js:130-135` only warns of a possible nightly auth change; deletion at `extension.js:98-103` happens only when refresh is separately invoked. A current-forwarder 401/auth-refusal probe produced no session revalidation or credential deletion. **Fix:** revalidate the current stored session once on an HTTP 401 or auth upgrade refusal; when authenticated:false, enter the D1-guarded clear-and-pair state. If the session is still authenticated, retain the warning instead of rebuilding repeatedly. Do not treat every operation's 403 as revocation.
- **D3, should fix: stopping the reconnect interval does not cancel its pending probe.** `extension.js:69-74`, `extension.js:86-87` allow a successful old probe to call refresh after a manual reload has already restored a healthy frame. The probe reproduced an extra refresh after the poll was stopped, unnecessarily replacing the iframe and risking unsent input. **Fix:** capture the poll identity/generation at each probe and invoke refresh only if that same poll is still active and the view exists; invalidate it on stop/disposal. Do not add another retry layer.
- **D4, note: "choose VS Code once" lasts for an origin, not this activation.** The activation-wide latch (`extension.js:13`, `extension.js:116`) stays set across renewal/restart, but every replacement forwarder chooses a new port (`t3.js:264-269`). T3's editor choice is per-origin (`docs/HANDOFF.md:51`), so its previous choice is lost without another hint. A rebuild probe confirmed the new URL and suppressed hint; actual picker behaviour after restart is **unverified**. **Fix:** move the hint into the newly created forwarder branch, say "for this connection", and delete the global latch. Do not inject scripts or write T3's storage.

**Checks:** `node --check extension.js`, `node --check t3.js`, `node --check scripts/selfcheck.mjs` and offline `node scripts/selfcheck.mjs` all passed against files verified to match `00ca4c7` before/after; **34 PASS lines**, last line **`ALL PASS`**. Additional committed-source race, revocation, poll, hint, reminder and callback-ownership probes passed their assertions. No command failed. Pinned reference reads used `git show d07a07f3:...` because the read-only reference checkout had advanced. Only this new section was written; concurrent code edits were left untouched.

**Scope check:** previous PLAN content is preserved and `git diff --check` passes. The final full-worktree `git diff --stat` also includes another agent's `extension.js` and `package.json` changes, so the requested document-only diff gate is **not met**; concurrent tracked and untracked code was neither edited nor reverted.

**Verdict: not done; fix D1 before shipping, address D2/D3, then run the owner's live renewal, revocation, restart and startup checks.** Offline transport checks do not establish the new SecretStorage/VS Code lifecycle; no new direct diagnostic secret leak or implicit Start/Open action was observed.

## Code review 4 (Codex), 2026-10-12

Reviewed **`20b5221` and `8b9d540`**. All code file:line citations below use `8b9d540`; its MCP/bridge/context files are unchanged from `20b5221`. Additional probes loaded committed source in memory with invented credentials, mocked VS Code/discovery/HTTP where stated, and an owned fake loopback MCP server. No live T3 request, CLI, real token, code edit or commit was made.

- **D1 NOT FIXED:** the generation/queue fixes the previously checked late-renewal-after-Forget case, but Pair claims its generation after exchange (`extension.js:59-65`), and renewal does not advance it (`extension.js:172-186`). Three remaining races are reproduced in F1.
- **D2 FIXED for current-session cases:** HTTP 401 and auth upgrades revalidate with a 30-second debounce, retaining a valid frame and refreshing/clearing an invalid session (`extension.js:87-104`, `extension.js:158-166`). Independent probes and the existing burst/revocation check passed; F1 still affects concurrent credential replacement.
- **D3 FIXED:** stopped polls cannot refresh after their pending probe finishes (`extension.js:77-83`); the independent stopped-probe check passed.
- **D4 FIXED:** each paired render contains the connection-specific picker hint (`panel.js:129`, `extension.js:144`), including a rebuilt forwarder. The activation-wide hint latch is gone.

- **OK, MCP entry checks:** exact Host, any-Origin rejection, browser-header rejection, path, method, constant-time bearer comparison, content type, protocol version and declared body limit precede buffering (`mcp.js:18-21`, `mcp.js:87-98`). Current empty tool schemas reject unknown keys and non-object arguments (`mcp.js:33-42`). Guard and argument checks passed.
- **OK, request limits/notifications:** the accumulated body is bounded at 2 MB, over-limit chunks are dropped, reading has a deadline, batches are capped at 20, and notifications produce 202 without a JSON-RPC reply (`mcp.js:100-123`). Offline body/batch/notification checks passed; the modern-version batch mismatch is F6.
- **OK, initial bridge routing:** deepest directory-boundary match, explicit binding, initial ambiguity errors and no-match errors avoid a last-focused fallback (`bridge.js:21-67`); fixed loopback destination and base64url cwd encoding keep paths out of header syntax (`bridge.js:76-95`). Reconnect pinning needs F2.
- **OK, credential separation:** the renderer receives only expiry/scopes/label (`panel.js:24-25`, `extension.js:144`); no direct bearer or MCP-token leak into HTML, setup text or success logs was observed. The MCP capability token is intentionally in the discovery file (`context.js:107`), not the T3 bearer, and setup contains only the bridge path (`context.js:141-168`). Real discovery-file ACLs on Windows were not checked.
- **OK, renderer/CSP and owner actions:** untrusted origin/error/label/scope text is escaped, posted errors use textContent, and the page uses a fresh matching script nonce (`panel.js:17`, `panel.js:78`, `panel.js:113-162`). The raw frame-src interpolation is supplied only by the internally generated numeric loopback URL (`t3.js:264-269`), not discovery or pasted input; no reachable markup/script injection was demonstrated. Start remains an explicit command; Pair/Open require an owner action (`extension.js:210-247`). F7 concerns message senders, not HTML escaping.

- **F1, blocks: late Pair and stale revocation can still replace/delete the current credential.** A pending Pair completed after Forget and restored a paired frame; two Pair calls stored the slower older grant last (`extension.js:59-68`). A revoked-session re-read captured the old bearer, then renewal stored a new bearer without changing credGen, and the delayed re-read deleted that renewal (`extension.js:129-131`, `extension.js:172-189`). **Fix:** claim/capture Pair's generation before awaiting exchange and save only that generation, checking the save result before UI effects. Advance credential identity on a successful bearer replacement, or perform the expected-bearer comparison and delete inside the existing serialized mutation queue. Recheck the generation after an awaited store before applying stale side effects. Extend selfcheck-ext with these three cases; no additional session framework is needed.
- **F2, should fix: a 401 reconnect can silently jump to another live window.** The pin omits pid, and repin chooses the newest matching workspace identity without an ambiguity check (`bridge.js:67-74`, `bridge.js:116`). A mocked 401 from still-live A followed by a newer B on the same folders routed the retry to B. **Fix:** retain the selected pid and prefer its current descriptor; after it disappears, accept a replacement only when exactly one descriptor has the pinned identity. Return an ambiguity error instead of sorting competing live windows by startedAt. Keep the same rule for connection-error retries.
- **F3, should fix: malformed discovery can win selection rather than being skipped.** `bridge.js:37-40` admit a port of 0 and an object-valued workspaceFile. A crafted deeper-folder descriptor with those fields beat a valid window and failed in norm/identity (`bridge.js:46`, `bridge.js:60-67`). **Fix:** validate version, port range 1..65535, optional workspaceFile type, absolute folder strings and header-safe nonempty token before admitting a descriptor. Normalize/select only validated records, inside the per-file failure boundary. This is a robustness finding under the documented same-user discovery trust model, not a demonstrated remote exploit.
- **F4, should fix: parseable JSON is treated as a valid MCP reply.** `bridge.js:139-146` forward any HTTP-200 JSON to stdout without validating jsonrpc, response shape or request-id correlation. An owned fake response `{notRpc:"anything"}` was written as the answer to request 7. **Fix:** require a JSON-RPC 2.0 response envelope, a matching pending id and exactly one result/error before writing; convert malformed/unmatched replies to an error for the original request. Preserve notification silence. No SDK is needed for this small check.
- **F5, should fix: a background editor's selection can become activeFile.** The selection listener switches the remembered document for every event (`context.js:57-62`). A mocked selection event from B changed activeFile to B while activeTextEditor remained A. **Fix:** update from the active editor, or update the already remembered document's selection while focus is in the webview; do not switch remembered documents on a background selection event. The real VS Code background-event sequence remains unverified; the handler's acceptance of it is reproduced.
- **F6, note/simplification: batches are accepted for a protocol that removed them.** `mcp.js:7-8`, `mcp.js:117-120` and `bridge.js:128-146` implement batching even for the default/explicit 2025-06-18 version; an owned loopback request confirmed that acceptance. The [official MCP 2025-06-18 changelog](https://modelcontextprotocol.io/specification/2025-06-18/changelog) removes batching. **Fix:** reject array bodies for modern versions; retain a batch branch only for explicitly supported 2025-03-26 compatibility. If that compatibility is unnecessary, delete the old version and batch branches together and replace the existing positive modern-batch assertions with rejection checks.
- **F7, should fix: child frames can spoof extension-only UI messages.** `panel.js:102-106` discard source/origin and trust any message's type. A client-function DOM probe with a child-frame sender replaced the pairing error, re-enabled its busy button and opened Details. **Fix:** check the sender and message shape before handling it; the [official VS Code preload](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/webview/browser/pre/index.html) forwards host messages from the parent frame, so require event.source === window.parent and ignore T3/preview-frame senders. Verify that source value on the installed VS Code's smoke test. Actual paired-Electron exploitation, credential reads and script execution were not demonstrated.

**Lean:** besides F6's batch cleanup, remove the unused Panel.context field/constructor argument (`extension.js:38-39`, `extension.js:206`). Keep the nonce, socket cleanup, body caps and explicit routing/credential guards; their checked behaviour is needed.

**Checks:** all ten reviewed JS files passed `node --check`; the four offline selfchecks passed with **34 + 24 + 9 + 6 = 73 PASS lines**, each ending **`ALL PASS`**, and their files matched `8b9d540` before/after. Independent D1-D4, bridge, editor tracking, modern-batch and renderer-message probes passed their reproduction assertions. No command failed. Previous PLAN content is preserved; final `git diff --check` passes and `git diff --stat` shows only `docs/PLAN.md` changed.

**Verdict: not done; D1/F1 still blocks the slice, and repair F2-F5/F7 before relying on the new bridge/panel.** Paired bar/Details, real renewal/revocation/restart and T3-started Claude/Codex calls remain live gates; provided isolated-window observations were not re-run here.

## Code review 5 (Codex), 2026-10-12

Re-reviewed **`a123ab8`** against every F1-F7 reproduction from review 4. Citations below refer to this commit. Original input/event schedules were replayed with assertions for the corrected result, using committed source, mocked hosts/discovery/HTTP/DOM and invented credentials; the batch probe also used an owned loopback server. No live T3 request, T3/Claude/Codex CLI, real token, code edit, commit or reference-tree mutation was made.

- **F1 FIXED for the original single-host reproductions:** Pair claims its generation before exchange, every write advances it, and post-store side effects are suppressed if another action intervened (`extension.js:23-35`, `extension.js:60-70`, `extension.js:132`, `extension.js:173-188`). Pair-after-Forget stayed unpaired; slower older Pair could not replace newer Pair; the delayed revoked-session read could not delete a completed renewal. A separate cross-host case still fails in G1.
- **F2 FIXED:** pin includes pid, retains that pid's descriptor on a 401 and accepts a replacement only when it is unique (`bridge.js:70-79`, `bridge.js:122`). Replaying A's 401 with newer B present stayed on A and re-read A's token; one replacement was accepted and two replacements failed closed.
- **F3 FIXED:** version, port range, token header safety, optional workspaceFile type and absolute folders are checked before selection (`bridge.js:37-44`). The original deeper malformed descriptor was skipped and valid A selected; bad port/type/path/token/version variants were skipped too.
- **F4 original cases FIXED, validation still incomplete:** malformed JSON-RPC envelope, wrong id, wrong version and dual result/error replies now become errors for the original request (`bridge.js:132-147`). G2 covers a malformed error object that this check still forwards.
- **F5 FIXED:** background selection cannot replace the remembered active document (`context.js:61-63`). The original B event left A selected; A's remembered selection still updated with webview focus.
- **F6 FIXED as deliberately scoped:** server and bridge reject batches, and the server advertises only 2025-11-25 and 2025-06-18 (`mcp.js:7-8`, `mcp.js:96`, `mcp.js:116`, `bridge.js:135`). The original modern-version batch produced -32600; both retained initialization versions succeeded and an explicit March header returned 400. Client compatibility is assessed below.
- **F7 FIXED in the replayed handler:** only parent-frame messages with known types are accepted (`panel.js:102-108`). The original child messages could not alter error/busy/Details state; parent messages still worked and null/unknown messages were ignored. The installed Electron host's actual sender value was not exercised here.
- **Lean FIXED:** unused Panel.context and its constructor argument are gone (`extension.js:38-40`, `extension.js:208`); the unused legacy version/batch paths are removed.

- **New G1, blocks: independent extension hosts can still undo Forget in shared SecretStorage.** The key is shared while credGen and queue are module-local (`extension.js:8`, `extension.js:16-18`, `extension.js:25-35`); background renewal checks only its own generation (`extension.js:174-188`), and Forget invalidates only its host (`extension.js:233-238`). **Reproduced:** two independently loaded committed extension instances shared one store; A forgot the session, then B's pending renewal restored it. B needed no panel open. This extends the original race to the multi-window architecture, not a real T3 call; native cross-window IPC timing remains unverified. **Fix:** coordinate credential commits using a user-wide revision and an exclusive per-user commit lock, checking the captured revision under that lock before replacing/deleting the secret. Do not hold the lock across T3 requests. Observe SecretStorage changes to invalidate other hosts and close their stale forwarders. A local counter or unlocked re-read alone is insufficient; add this two-host schedule to the existing extension selfcheck.
- **G2, should fix: malformed error objects still pass reply validation.** `bridge.js:145` checks only envelope/version/id and result/error exclusivity. Replies with `error:null` or `{code:"bad",message:7}` reached stdout unchanged in the new probe, although the [JSON-RPC error-object contract](https://www.jsonrpc.org/specification#error_object) requires an object with an integer code and string message. **Fix:** validate that error shape before write(out); on failure use the existing original-id transport error. Add these two replies beside the existing malformed-envelope checks. No SDK or broad result-schema validation is needed.

**Dropping 2025-03-26:** this intentionally removes support for clients restricted to that version; there is no common negotiated version with this server, consistent with the [MCP negotiation rules](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle#version-negotiation). Static inspection of installed Claude Code **2.1.296** found its bundled SDK supported-version lists containing both retained versions, so removal alone does not remove its common version. Installed Codex extension **26.51007.21434** bundles Codex **0.162.0-alpha.17.2**; its executable contains both retained protocol strings, but strings do not prove client acceptance policy. **Real Codex compatibility remains UNKNOWN**, and neither real client's handshake was run under the no-CLI rule. These are VS Code bundle observations, not proof of which binaries/configuration T3 launches. No real-client regression was demonstrated; do not report real harness compatibility as passed.

**Checks:** a fresh, owned temporary T3VSCODE_HOME was supplied to all four offline selfchecks. `node scripts/selfcheck.mjs`: **34 PASS**; `node scripts/selfcheck-mcp.mjs`: **29 PASS**; `node scripts/selfcheck-panel.mjs`: **10 PASS**; `node scripts/selfcheck-ext.mjs`: **9 PASS**. All exited 0 and ended **`ALL PASS`**, **82 PASS lines total**. Ten JS syntax checks passed; checked files matched `a123ab8` before/after. All seven original probes were rerun and passed their corrected assertions; G1/G2 probes passed assertions demonstrating the remaining failures. One recursive cleanup command **failed before execution**, rejected by automatic approval review with only "blocked by policy"; all steps in that rejected call were unrun. A separate inspection proved the directory empty and non-recursive removal passed. Previous PLAN content is preserved; `git diff --check` passes and only this new PLAN section changes.

**Verdict: not done; G1 still blocks shared multi-window credentials, and complete F4 with G2.** The original F1-F7 fixtures are repaired, but real Claude/Codex integration, paired Electron UI and real renewal/revocation/restart remain unverified.

## Code review 6 (Codex), 2026-10-12

Re-reviewed **`a5b5e23`**; all file:line evidence below refers to that commit. Replayed the earlier fixtures with committed source, invented credentials and mocked VS Code/SecretStorage/discovery/HTTP/DOM, plus an owned loopback MCP server. No live T3 request, T3/Claude/Codex CLI, real token, code edit, commit or reference-tree change was made.

- **G1 original schedule FIXED:** the serialized queue now checks the bearer being replaced, for revocation, legacy fill-in and renewal (`extension.js:30-41`, `extension.js:138`, `extension.js:188`, `extension.js:194`). A's Forget followed by B's late renewal left the shared store empty, including a replay with change events withheld. Foreign-change notification also closed B's existing forwarder and rendered it unpaired (`extension.js:264-272`).
- **G1 residual, note and accepted decision:** the compare and store are not atomic (`extension.js:26`, `extension.js:33-38`). Forcing a pause after the check but before the fake store committed let another window's Forget lose once: the late renewal restored the stored session and the existing panel became paired again. This introduced no secret leak; the bearer stayed in SecretStorage/extension-host transport and did not enter rendered HTML. This is **acceptable for the stated single-user desktop**, with best-effort Forget rather than a strict cross-window revocation guarantee. Retry Forget after that concurrent write. No lock is required to complete this slice; upgrade to the documented per-user lock if the race appears in normal use or atomic semantics become required. The probe deliberately stretched the interval and did not measure its duration or probability.
- **G2 FIXED:** error responses require an object, integer code and string message (`bridge.js:145-146`). Both previous malformed error objects now became valid transport errors for the original request id; a correctly shaped JSON-RPC error remained unchanged.
- **F1 FIXED in the original fixtures:** Pair after Forget stayed unpaired, a slower older Pair could not replace the newer Pair, and a delayed revoked read could not delete a completed renewal (`extension.js:30-41`, `extension.js:71-76`, `extension.js:138`, `extension.js:194`). The remaining cross-window interval is the accepted G1 note above, not a claim of complete atomicity.
- **F2 FIXED:** A's 401 retained its pid and re-read only its token despite newer B; one replacement was accepted, competing replacements rejected (`bridge.js:70-79`, `bridge.js:122`).
- **F3 FIXED:** the original malformed deeper descriptor and bad port/type/path/token/version variants were skipped before selection (`bridge.js:37-44`).
- **F4 FIXED in the exercised reply contract:** malformed envelopes, versions, ids, dual result/error and malformed error objects are rejected; valid errors pass (`bridge.js:132-148`). G2 completes the missing error-object check.
- **F5 FIXED:** a background B selection did not replace A; A's remembered selection still updated while webview focus was active (`context.js:61-63`).
- **F6 FIXED:** server and bridge reject modern-version batches, both retained initialization versions work, and an explicit March header is rejected (`mcp.js:7-8`, `mcp.js:96`, `mcp.js:116`, `bridge.js:135`). Real client compatibility was not re-tested; the limitations in review 5 remain.
- **F7 CORRECTED AND FIXED:** my earlier sender === window.parent recommendation was wrong for this installed VS Code host. The lead's supplied real isolated-window probe found parent === window, unequal host sender, matching host origin and a different HTTP-child origin. The new guard follows those facts (`panel.js:102-109`). Replaying that layout accepted host error/focus messages and rejected HTTP-child, opaque-origin-child, null and unknown messages. The live observation is the lead's evidence, not an independent live run by this review.

**Checks:** with a fresh owned temporary T3VSCODE_HOME, `node scripts/selfcheck.mjs`: **34 PASS**; `node scripts/selfcheck-mcp.mjs`: **29 PASS**; `node scripts/selfcheck-panel.mjs`: **10 PASS**; `node scripts/selfcheck-ext.mjs`: **10 PASS**. All exited 0 and ended **`ALL PASS`**, **83 PASS lines total**. Ten JS syntax checks and all F1-F7/G1/G2 replays passed; the forced-shortcut probe passed assertions demonstrating the accepted remaining race. Checked files matched `a5b5e23` before/after. No command failed. The empty temporary home was removed without recursion. Previous PLAN content is unchanged; final unstaged `git diff --stat` contains only `docs/PLAN.md`. Other agents' documentation changes were left alone.

**Verdict: done for this slice pending the owner's live tests; no concrete code blocker remains, and the documented G1 desktop tradeoff is acceptable.** This does not prove real renewal/revocation/restart, paired Electron UI or T3-started Claude/Codex interoperability.
