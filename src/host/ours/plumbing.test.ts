import test from "node:test";
import assert from "node:assert/strict";
import { oursRpc, registerOursRpc } from "./rpc.js";
import { Declined, wrap } from "./wrap.js";

test("The ours channel runs only registered kinds", async () => {
  const dispose = registerOursRpc("test.echo", (params, viewId) => ({ text: params.text, viewId }));
  try {
    assert.deepEqual(await oursRpc({ kind: "test.echo", text: "hi" }, "panel_1"), { text: "hi", viewId: "panel_1" });
    await assert.rejects(oursRpc({ kind: "test.unknown" }, "panel_1"), /Unknown fork request/);
    await assert.rejects(oursRpc({}, "panel_1"), /Unknown fork request/);
    await assert.rejects(oursRpc({ kind: "toString" }, "panel_1"), /Unknown fork request/);
    assert.throws(() => registerOursRpc("test.echo", () => undefined), /already registered/);
  } finally { dispose(); }
  await assert.rejects(oursRpc({ kind: "test.echo" }, "panel_1"), /Unknown fork request/);
});

test("A wrapper runs first, keeps his method bound to its instance, and unwraps only while outermost", () => {
  class His { private readonly sent: string[] = []; send(text: string): string[] { this.sent.push(text); return this.sent; } }
  const his = new His();
  const order: string[] = [];
  const unwrap = wrap(his, "send", (original) => (text) => { order.push(`ours:${text}`); return original(text); });
  assert.deepEqual(his.send("a"), ["a"]);
  assert.deepEqual(order, ["ours:a"]);
  const unwrapLater = wrap(his, "send", (original) => (text) => original(text.toUpperCase()));
  unwrap();
  assert.deepEqual(his.send("b"), ["a", "B"]);
  unwrapLater(); unwrap();
  assert.deepEqual(his.send("c"), ["a", "B", "c"]);
  assert.deepEqual(order, ["ours:a", "ours:B"]);
  // A failing replacement falls back to his method: before it ran, it runs now; after it ran, his result stands.
  const failing = new His();
  wrap(failing, "send", () => () => { throw new Error("ours broke"); });
  assert.deepEqual(failing.send("d"), ["d"]);
  wrap(failing, "send", (original) => (text) => { original(text); throw new Error("ours broke later"); });
  assert.deepEqual(failing.send("e"), ["d", "e"]);
  // Declined (the user said no) passes through and his method does not run.
  const declined = new His();
  const unwrapDeclined = wrap(declined, "send", () => () => { throw new Declined("no"); });
  assert.throws(() => declined.send("f"), Declined);
  unwrapDeclined();
  assert.deepEqual(declined.send("g"), ["g"]);
});
test("His async rejection stays his: rethrown as is, and still his when our replacement fails after it", async () => {
  const his = { async load(): Promise<string> { throw new Error("his"); } };
  wrap(his, "load", (original) => () => original());
  await assert.rejects(his.load(), /^Error: his$/);
  wrap(his, "load", (original) => async () => { await original().catch(() => undefined); throw new Error("ours"); });
  await assert.rejects(his.load(), /^Error: his$/);
});
