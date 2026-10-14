/**
 * Ours (I drop). Drags README.md from a real VS Code Explorer onto the T3 sidebar webview and records which layers see
 * the drag events: the workbench page, the webview's outer frame (pre/index.html) and its inner document (our app).
 * Usage: VSCODE_BIN=<Code.exe> node scripts/verify-drag.mjs. No T3 server is needed (the sidebar shows ServerSetup).
 * Limit: the drag is driven by CDP (Input.setInterceptDrags + dispatchDragEvent). That bypasses the browser-process
 * drag path, so it proves the VS Code JS layer (iframe pointer-events, Shift) but not what a real OS drag does; the
 * browser-side rule (WebContentsViewDragSecurityInfo::IsValidDragTarget) is only reached by a real OS drag.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { chromium } from "playwright-core";

const profile = await mkdtemp(join(tmpdir(), "t3-vscode-drag-"));
const workspace = join(profile, "workspace");
await mkdir(join(workspace, ".vscode"), { recursive: true });
await mkdir(join(profile, "User"), { recursive: true });
await mkdir(join(profile, "t3home"), { recursive: true });
await writeFile(join(workspace, "README.md"), "# drag test\n");
await writeFile(join(profile, "User/settings.json"), JSON.stringify({ "update.mode": "none", "extensions.autoUpdate": false, "window.zoomLevel": 0, "security.workspace.trust.enabled": false, "workbench.startupEditor": "none", "chat.disableAIFeatures": true }));
// An empty T3 home: never the owner's live ~/.t3.
await writeFile(join(workspace, ".vscode/settings.json"), JSON.stringify({ "t3-vscode.t3Home": join(profile, "t3home") }));
// A helper extension moves his view into the secondary side bar (next to the Debug Console) with VS Code's own command.
const helper = join(profile, "move-helper");
await mkdir(helper);
await writeFile(join(helper, "package.json"), JSON.stringify({ name: "move-helper", publisher: "test", version: "0.0.0", engines: { vscode: "^1.90.0" }, main: "./main.js", activationEvents: ["onStartupFinished"] }));
await writeFile(join(helper, "main.js"), `exports.activate = async () => { const vscode = require("vscode");
  await vscode.commands.executeCommand("vscode.moveViews", { viewIds: ["t3.webview"], destinationId: "workbench.panel.repl" });
  await vscode.commands.executeCommand("workbench.action.movePanelToSecondarySideBar");
  await vscode.commands.executeCommand("workbench.view.explorer"); };`);
const portServer = createServer();
await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
const port = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
const log = createWriteStream(join(profile, "code.log"));
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("T3") && key !== "ELECTRON_RUN_AS_NODE"));
const child = spawn(process.env.VSCODE_BIN ?? "/usr/share/code/code", [
  "--disable-gpu", "--new-window", "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust",
  `--user-data-dir=${profile}`, `--extensions-dir=${profile}/extensions`, `--shared-data-dir=${profile}/shared-data`, `--remote-debugging-port=${port}`,
  `--extensionDevelopmentPath=${fileURLToPath(new URL("..", import.meta.url))}`, `--extensionDevelopmentPath=${helper}`, workspace,
], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.pipe(log); child.stderr.pipe(log);
const origin = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Every execution context of every vscode-webview target: the outer pre/index.html and the inner app document.
async function webviewContexts() {
  const out = [];
  for (const target of (await (await fetch(`${origin}/json/list`)).json()).filter((t) => t.url.startsWith("vscode-webview:"))) {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let id = 0; const pending = new Map(); const contexts = [];
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === "Runtime.executionContextCreated") contexts.push(message.params.context.id);
      if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
    };
    const send = (method, params = {}) => new Promise((resolve) => { pending.set(++id, resolve); socket.send(JSON.stringify({ id, method, params })); });
    await send("Runtime.enable"); await sleep(300);
    const evaluate = async (expression, contextId) => (await send("Runtime.evaluate", { expression, contextId, returnByValue: true }))?.result?.result?.value;
    for (const contextId of contexts) {
      const kind = await evaluate(`document.getElementById("active-frame") ? "outer" : (document.body?.dataset.surface ? "inner:" + document.body.dataset.surface : "other")`, contextId);
      out.push({ target: target.id, contextId, kind, evaluate: (expression) => evaluate(expression, contextId), close: () => socket.close() });
    }
  }
  return out;
}
// Runs of the same event type and Shift state fold into one entry with a count.
const RECORD = `(() => { window.__drag = []; if (window.__dragHooked) return true; window.__dragHooked = true;
  for (const type of ["dragenter", "dragover", "dragleave", "drop"]) window.addEventListener(type, (e) => {
    const last = window.__drag.at(-1);
    if (last && last.type === type && last.shift === e.shiftKey) { last.count++; return; }
    window.__drag.push({ type, shift: e.shiftKey, count: 1, types: [...(e.dataTransfer?.types ?? [])].join(",") });
  }, true); return true; })()`;

let browser;
try {
  for (const deadline = Date.now() + 60_000; ; await sleep(250)) {
    if (child.exitCode !== null) throw new Error(`VS Code exited; see ${profile}/code.log`);
    if (Date.now() > deadline) throw new Error("No CDP endpoint");
    try { await fetch(`${origin}/json/version`); break; } catch {}
  }
  browser = await chromium.connectOverCDP(origin);
  let workbench;
  for (const deadline = Date.now() + 30_000; !workbench && Date.now() < deadline; await sleep(250)) workbench = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("workbench"));
  assert.ok(workbench, "no workbench page");
  await workbench.locator(".monaco-workbench").waitFor();
  // The owner's layout: T3 on the right (the helper extension moves it there), the Explorer on the left.
  await sleep(3000);
  await workbench.keyboard.press("Control+Shift+E");
  const row = workbench.locator(".explorer-folders-view .monaco-list-row").filter({ hasText: "README.md" }).first();
  await row.waitFor();
  let contexts = [];
  for (const deadline = Date.now() + 30_000; !contexts.some((c) => c.kind === "inner:sidebar") && Date.now() < deadline; await sleep(500)) {
    contexts.forEach((c) => c.close()); contexts = await webviewContexts();
  }
  const inner = contexts.find((c) => c.kind === "inner:sidebar");
  assert.ok(inner, `no sidebar webview: ${JSON.stringify(contexts.map((c) => c.kind))}`);
  const outer = contexts.find((c) => c.kind === "outer" && c.target === inner.target);
  const frames = () => workbench.evaluate(() => [...document.querySelectorAll("iframe.webview")].map((f) => { const r = f.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, pe: f.style.pointerEvents }; }));
  // Overlay webviews sit in a layer outside their part; the visible one furthest right is the secondary side bar.
  const frame = (await frames()).filter((f) => f.w > 50 && f.h > 50).sort((a, b) => b.x - a.x)[0];
  assert.ok(frame, "no visible webview iframe");
  const target = { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
  const source = await row.boundingBox();
  const from = { x: source.x + 30, y: source.y + source.height / 2 };
  await workbench.screenshot({ path: join(profile, "drag-layout.png") });
  console.log(JSON.stringify({ frame, from, target, at: await workbench.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e && `${e.tagName}.${e.className}`; }, target) }));

  const cdp = await workbench.context().newCDPSession(workbench);
  await cdp.send("Input.setInterceptDrags", { enabled: true });
  const mouse = (type, at, modifiers = 0, buttons = 1) => cdp.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", buttons, clickCount: 1, modifiers });
  const drag = (type, at, modifiers, data) => cdp.send("Input.dispatchDragEvent", { type, x: at.x, y: at.y, modifiers, data });

  async function run(name, shiftAtPickup) {
    await workbench.evaluate(RECORD); await outer?.evaluate(RECORD); await inner.evaluate(RECORD);
    const intercepted = new Promise((resolve) => { cdp.once("Input.dragIntercepted", ({ data }) => resolve(data)); setTimeout(() => resolve(undefined), 5000); });
    const pick = shiftAtPickup ? 8 : 0;
    await mouse("mouseMoved", from, pick, 0);
    await mouse("mousePressed", from, pick);
    for (let i = 1; i <= 10; i++) await mouse("mouseMoved", { x: from.x + i * 4, y: from.y + i }, pick);
    const data = await intercepted;
    const steps = [];
    if (data) {
      steps.push({ types: data.items.map((item) => item.mimeType).join(","), pe: (await frames()).map((f) => f.pe).join("|") });
      await drag("dragEnter", target, pick, data);
      await drag("dragOver", target, pick, data);
      steps.push({ after: "dragOver without Shift", pe: (await frames()).map((f) => f.pe).join("|") });
      for (let i = 0; i < 3; i++) { await drag("dragOver", { x: target.x + i, y: target.y }, 8, data); await sleep(50); }
      steps.push({ after: "3x dragOver with Shift", pe: (await frames()).map((f) => f.pe).join("|") });
      // DevTools sends dragOver to whatever widget is under the point now, without the dragEnter a real browser drag
      // sends when the target widget changes; send it, so the iframe's document gets a full enter, over, drop.
      await drag("dragEnter", target, 8, data);
      await drag("dragOver", target, 8, data);
      await drag("drop", target, 8, data);
    }
    await mouse("mouseReleased", target, 0, 0);
    await sleep(500);
    const read = (c) => c?.evaluate("JSON.stringify(window.__drag)").then((v) => JSON.parse(v ?? "null"));
    const result = { name, dragStarted: !!data, steps, workbench: JSON.parse(await workbench.evaluate("JSON.stringify(window.__drag)")), outer: await read(outer), inner: await read(inner) };
    console.log(JSON.stringify(result, null, 1));
    return result;
  }
  await run("Shift held before pick-up", true);
  await workbench.keyboard.press("Escape");
  const hover = await run("Shift pressed only while hovering", false);
  // Control: a drag with no source in this window (as from another app), straight onto the webview.
  await workbench.evaluate(RECORD); await outer?.evaluate(RECORD); await inner.evaluate(RECORD);
  const foreign = { items: [{ mimeType: "text/plain", data: "C:\outside\README.md" }], dragOperationsMask: 1 };
  for (const type of ["dragEnter", "dragOver", "drop"]) await drag(type, target, 0, foreign);
  await sleep(300);
  console.log(JSON.stringify({ name: "Control: drag from outside the window", outer: JSON.parse(await outer?.evaluate("JSON.stringify(window.__drag)") ?? "null"), inner: JSON.parse(await inner.evaluate("JSON.stringify(window.__drag)")) }, null, 1));
  console.log(`VERDICT (CDP-driven, VS Code JS layer only): inner document got ${hover.inner?.length ? hover.inner.map((e) => e.type).join(",") : "nothing"}`);
  // The VS Code half works: Shift unblocks the iframe and the chat document gets the drop with VS Code's own types.
  assert.equal(hover.steps.at(-1)?.pe, "auto", "Shift did not unblock the webview iframe");
  assert.ok(hover.inner?.some((e) => e.type === "drop" && e.types.includes("application/vnd.code.uri-list")), "no drop in the chat document");
  console.log(`Profile and screenshot: ${profile}`);
} catch (error) {
  const page = browser?.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("workbench"));
  await page?.screenshot({ path: join(profile, "drag-failure.png") }).catch(() => {});
  console.error(`Failure screenshot: ${profile}`);
  throw error;
} finally {
  await browser?.close().catch(() => {});
  if (child.pid && child.exitCode === null) spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
  log.end();
}
