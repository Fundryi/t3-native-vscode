import test from "node:test";
import assert from "node:assert/strict";
import { viewsHarness } from "../testing/fakeTransport.js";
import { publishTurn, turnPatch } from "../testing/turnFixture.js";
import { activateDiffcard } from "./diffcard.js";
import type { OursDeps } from "./types.js";

test("A turn without a baseline falls back to its checkpoint range and is marked; other errors stay his", async (t) => {
  const { host, client } = await viewsHarness(); t.after(() => host.dispose());
  await host.selectThread("first"); publishTurn(client, "first");
  client.findTurnBaseline = async () => null;
  client.getSavedTurnDiff = async (range) => { client.savedDiffRequests.push(range); return turnPatch; };
  const posted: unknown[] = [];
  const registry = { postWhenReady: (viewId: string, _event: unknown, data: unknown) => posted.push([viewId, data]) };
  const ours = activateDiffcard({ hostState: host, client, registry } as unknown as OursDeps);
  t.after(() => ours.dispose());
  const diff = await host.prepareTurnDiff("first", "first", "changes-first");
  assert.ok(diff.files.length > 0);
  assert.equal(client.savedDiffRequests.at(-1)?.baseRef, diff.baseRef);
  assert.match(diff.baseRef, /^refs\/t3\/checkpoints\//);
  assert.equal(posted.length, 1);
  assert.deepEqual((posted[0] as [string, { kind: string }])[0], "sidebar");
  assert.equal((posted[0] as [string, { kind: string }])[1].kind, "diffcard.mixed");
  await assert.rejects(host.prepareTurnDiff("first", "first", "invented"), /checkpoint/);
  assert.equal(posted.length, 1);
});
