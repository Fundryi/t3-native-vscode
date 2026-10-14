/**
 * X1 models. His picker kept favorites, hidden models and order in VS Code only (ModelPreferenceStore), defaulting to
 * "hide legacy", so it listed every model T3's own picker hides. T3 keeps these in its server settings, "shared by
 * clients connected to the same environment" (contracts settings.ts ModelFavorite). This feature makes his host read
 * them from T3's live config and write his Manage models and star changes back as T3's delta patches, so both
 * pickers show the same list. While T3 has not migrated them (null) or no server is connected, his VS Code store runs.
 */
import { ServerSettingsPatch, WS_METHODS, type ServerSettings } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { log } from "./log.js";
import { fromServer, toPatches } from "./modelSyncRules.js";
import type { OursFeature } from "./types.js";
import { wrap } from "./wrap.js";

export const activateModelSync: OursFeature = ({ client, hostState }) => {
  // options is private in his HostState and read on every call; element access keeps it type-checked without a line in his file.
  const options = hostState["options"];
  // T3 answers a write with the new settings before its settingsUpdated event reaches client.config; use the answer until then.
  let written: { readonly base: ServerSettings | undefined; readonly result: ServerSettings } | null = null;
  const settings = (): ServerSettings | undefined => {
    const live = client.config?.settings;
    if (written && written.base !== live) written = null;
    return written?.result ?? live;
  };
  const restoreRead = wrap(options, "modelPreferences", (original) => () => fromServer(settings()) ?? original!());
  const restoreSave = wrap(options, "saveModelPreferences", (original) => async (next) => {
    const base = client.config?.settings;
    const current = fromServer(settings());
    if (!current) return original!(next);
    let result: ServerSettings | undefined;
    for (const patch of toPatches(current, next, client.config?.providers ?? [])) {
      result = await client["run"](client["requireSession"]().client[WS_METHODS.serverUpdateSettings]({ patch: Schema.decodeUnknownSync(ServerSettingsPatch)(patch) }));
    }
    if (result) { written = { base, result }; log.info("Model preferences saved to T3."); }
  });
  return { dispose: () => { restoreSave(); restoreRead(); } };
};
