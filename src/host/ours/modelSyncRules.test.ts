import assert from "node:assert/strict";
import { test } from "node:test";
import { fromServer, toPatches } from "./modelSyncRules.js";

const model = (slug: string, isLegacy = false) => ({ slug, name: slug, isCustom: false, capabilities: null, ...(isLegacy ? { isLegacy } : {}) });
const providers = [{ instanceId: "codex", models: [model("a"), model("b"), model("old", true)] }] as never;

test("models: T3's shared preferences map to his shape, and stay his own while T3 has not migrated them", () => {
  assert.equal(fromServer(undefined), null);
  assert.equal(fromServer({ favorites: null, providerModelPreferences: {} } as never), null);
  assert.deepEqual(fromServer({ favorites: [{ provider: "codex", model: "a" }], providerModelPreferences: { codex: { hiddenModels: ["b"], modelOrder: [] } } } as never),
    { favoriteModels: [{ instanceId: "codex", model: "a" }], providerModelPreferences: { codex: { hiddenModels: ["b"], modelOrder: [] } } });
});

test("models: a save becomes only the deltas, compared with his legacy-hidden default for an instance T3 has no entry for", () => {
  const empty = { favoriteModels: [], providerModelPreferences: {} };
  // Hiding "a" on an instance without an entry: his record also carries the legacy slug, which must not go out.
  assert.deepEqual(toPatches(empty, { favoriteModels: [], providerModelPreferences: { codex: { hiddenModels: ["old", "a"], modelOrder: [] } } }, providers),
    [{ setModelsHidden: [{ provider: "codex", model: "a", hidden: true }] }]);
  const current = { favoriteModels: [{ instanceId: "codex", model: "a" }], providerModelPreferences: { codex: { hiddenModels: ["b"], modelOrder: [] } } };
  assert.deepEqual(toPatches(current, { favoriteModels: [{ instanceId: "codex", model: "b" }], providerModelPreferences: { codex: { hiddenModels: [], modelOrder: ["b", "a"] } } }, providers), [
    { setModelFavorites: [{ provider: "codex", model: "b", favorite: true }, { provider: "codex", model: "a", favorite: false }], setModelsHidden: [{ provider: "codex", model: "b", hidden: false }] },
    { setProviderModelOrder: { provider: "codex", modelOrder: ["b", "a"] } },
  ]);
  assert.deepEqual(toPatches(current, current, providers), []);
});
