/**
 * X1 models, the rules without vscode: T3's shared model preferences in his picker's shape, and his full saved
 * record turned back into the delta patches T3 applies under its settings lock (setModelFavorites, setModelsHidden,
 * setProviderModelOrder; packages/shared/src/serverSettings.ts applyServerSettingsPatch).
 */
import type { ServerProvider, ServerSettings } from "@t3tools/contracts";
import { defaultProviderModelPreference, getProviderModelPreference, type ModelPickerPreferences, type ProviderModelPreferences } from "../../shared/modelPreferences.js";

type Shared = Pick<ServerSettings, "favorites" | "providerModelPreferences">;

/** null while T3 still keeps the preferences per client (not yet migrated to the server). */
export function fromServer(settings: Shared | undefined): ModelPickerPreferences | null {
  if (!settings?.favorites || !settings.providerModelPreferences) return null;
  return {
    favoriteModels: settings.favorites.map(({ provider, model }) => ({ instanceId: provider, model })),
    providerModelPreferences: settings.providerModelPreferences as ProviderModelPreferences,
  };
}

const favoriteKey = (instanceId: string, model: string) => JSON.stringify([instanceId, model]);

/**
 * The patches that turn `current` into `next`. An instance T3 has no entry for is compared with his default (legacy
 * hidden), the same baseline his setModelVisibility starts from, so only the model the user toggled goes out.
 * T3 takes one setProviderModelOrder per patch, so each changed order is its own patch.
 */
export function toPatches(current: ModelPickerPreferences, next: ModelPickerPreferences,
  providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "models">>): Array<Record<string, unknown>> {
  const before = new Set(current.favoriteModels.map((item) => favoriteKey(item.instanceId, item.model)));
  const after = new Set(next.favoriteModels.map((item) => favoriteKey(item.instanceId, item.model)));
  const setModelFavorites = [
    ...next.favoriteModels.filter((item) => !before.has(favoriteKey(item.instanceId, item.model))).map((item) => ({ provider: item.instanceId, model: item.model, favorite: true })),
    ...current.favoriteModels.filter((item) => !after.has(favoriteKey(item.instanceId, item.model))).map((item) => ({ provider: item.instanceId, model: item.model, favorite: false })),
  ];
  const setModelsHidden: Array<{ provider: string; model: string; hidden: boolean }> = [];
  const orders: Array<Record<string, unknown>> = [];
  for (const [instanceId, wanted] of Object.entries(next.providerModelPreferences)) {
    const provider = providers.find((entry) => entry.instanceId === instanceId);
    const base = getProviderModelPreference(current.providerModelPreferences, instanceId)
      ?? (provider ? defaultProviderModelPreference(provider) : { hiddenModels: [], modelOrder: [] });
    for (const model of wanted.hiddenModels) if (!base.hiddenModels.includes(model)) setModelsHidden.push({ provider: instanceId, model, hidden: true });
    for (const model of base.hiddenModels) if (!wanted.hiddenModels.includes(model)) setModelsHidden.push({ provider: instanceId, model, hidden: false });
    if (JSON.stringify(wanted.modelOrder) !== JSON.stringify(base.modelOrder)) orders.push({ setProviderModelOrder: { provider: instanceId, modelOrder: [...wanted.modelOrder] } });
  }
  const first = { ...(setModelFavorites.length ? { setModelFavorites } : {}), ...(setModelsHidden.length ? { setModelsHidden } : {}) };
  return [...(Object.keys(first).length ? [first] : []), ...orders];
}
