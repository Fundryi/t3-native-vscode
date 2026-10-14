import assert from "node:assert/strict";
import { test } from "node:test";
import { ServerSettings } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { firstVisible, newChatDefaults } from "./defaultsRules.js";

const model = (slug: string, isLegacy = false) => ({ slug, name: slug, isCustom: false, capabilities: null, ...(isLegacy ? { isLegacy } : {}) });
const providers = [{ instanceId: "claude", models: [model("opus"), model("old", true)] }, { instanceId: "codex", models: [model("luna")] }] as never;
const settings = (input: Record<string, unknown>) => Schema.decodeUnknownSync(ServerSettings)(input);

test("defaults: T3's default model starts a new chat, unless the picker hides it", () => {
  const opus = { instanceId: "claude", model: "opus" };
  assert.deepEqual(newChatDefaults(settings({ defaultModelSelection: opus }), null, undefined, providers, {}), { model: opus });
  assert.deepEqual(newChatDefaults(settings({}), null, undefined, providers, {}), {});
  // Hidden in T3, legacy without preferences, or an unknown instance: no substitute, his fallback runs.
  assert.deepEqual(newChatDefaults(settings({ defaultModelSelection: opus }), null, undefined, providers, { claude: { hiddenModels: ["opus"], modelOrder: [] } }), {});
  assert.deepEqual(newChatDefaults(settings({ defaultModelSelection: { instanceId: "claude", model: "old" } }), null, undefined, providers, {}), {});
  assert.deepEqual(newChatDefaults(settings({ defaultModelSelection: { instanceId: "gone", model: "x" } }), null, undefined, providers, {}), {});
});

test("defaults: a project override wins, and only a project override sets the permission mode", () => {
  const luna = { instanceId: "codex", model: "luna" };
  const base = { defaultModelSelection: { instanceId: "claude", model: "opus" }, defaultRuntimeMode: "full-access", projectSettingsFolded: true };
  assert.deepEqual(newChatDefaults(settings(base), "p1", undefined, providers, {}).runtimeMode, undefined);
  assert.deepEqual(newChatDefaults(settings({ ...base, projectSettingsOverrides: { p1: { defaultModelSelection: luna, defaultRuntimeMode: "approval-required" } } }), "p1", undefined, providers, {}),
    { model: luna, runtimeMode: "approval-required" });
});

test("defaults: without a usable T3 default, the fallback skips hidden models and unavailable providers", () => {
  const hideOpus = { claude: { hiddenModels: ["opus", "old"], modelOrder: [] } };
  assert.deepEqual(firstVisible(providers, hideOpus, () => true), { instanceId: "codex", model: "luna" });
  assert.deepEqual(firstVisible(providers, {}, (selection) => selection.instanceId !== "claude"), { instanceId: "codex", model: "luna" });
  assert.deepEqual(firstVisible(providers, {}, () => true), { instanceId: "claude", model: "opus" });
  assert.equal(firstVisible(providers, {}, () => false), undefined);
});
