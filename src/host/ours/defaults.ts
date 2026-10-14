/**
 * R2 defaults. A new chat in VS Code starts with the model picked as default in T3 (project override first), like
 * T3 web, instead of his fallback (the chat in front or the first provider's model). The permission mode stays
 * "auto" unless the project in T3 overrides it (owner question 1 of QOL-ROUND-2). A model or mode the user picked in
 * the draft always stays; a T3 default that is hidden in the picker (X1) or unavailable is never used.
 */
import type { RuntimeMode } from "@t3tools/contracts";
import type { ConversationDraft, ModelSelection } from "../../shared/bridge.js";
import type { ModelPickerPreferences } from "../../shared/modelPreferences.js";
import type { LegacyProjectSettingsFields } from "@t3tools/shared/projectSettings";
import { firstVisible, isVisible, newChatDefaults } from "./defaultsRules.js";
import { log } from "./log.js";
import type { OursFeature } from "./types.js";
import { wrap } from "./wrap.js";

interface View { readonly draftModelSelection: ModelSelection | undefined; readonly draftRuntimeMode: RuntimeMode }
// shortcut: his private HostState members by name (TS private is compile-time only); an upstream rename turns the
// feature off with one log line. Swap to public hooks in his hostState.ts if the lead approves them.
interface His {
  conversationDraft(view: View): ConversationDraft;
  setModes(id: string | undefined, input: { runtimeMode?: unknown; interactionMode?: unknown }, viewId?: string): Promise<void>;
  availableModel(preferred?: ModelSelection | null): ModelSelection | null;
  compatibleRuntimeMode(selection: ModelSelection | null, preferred: RuntimeMode): RuntimeMode;
  visibleProjects(): ReadonlyArray<{ readonly id: string } & LegacyProjectSettingsFields>;
  modelPreferences(): ModelPickerPreferences;
  enqueue(action: () => Promise<void>): Promise<void>;
  readonly views: Map<string, View>;
}
const SIDEBAR_VIEW_ID = "sidebar"; // his default viewId (hostState.ts SIDEBAR_VIEW_ID); not imported, his module loads vscode

export const activateDefaults: OursFeature = ({ client, hostState }) => {
  const his = hostState as unknown as His;
  const methods = ["conversationDraft", "setModes", "availableModel", "compatibleRuntimeMode", "visibleProjects", "modelPreferences", "enqueue"] as const;
  if (methods.some((name) => typeof his[name] !== "function") || !(his.views instanceof Map)) {
    log.error("Defaults: HostState changed upstream; new chats keep his model and mode.");
    return { dispose: () => undefined };
  }
  // Views whose draft mode the user picked; the project's mode no longer replaces it.
  const pickedMode = new WeakSet<View>();
  const restoreModes = wrap(his, "setModes", (original) => async (id, input, viewId = SIDEBAR_VIEW_ID) => {
    const view = id === undefined && input.runtimeMode !== undefined ? his.views.get(viewId) : undefined;
    if (!view) return original(id, input, viewId);
    let fresh = false;
    // Marked in his queue right before his job: his job emits the user's mode at once, and a job queued earlier
    // (a send waiting on the project picker) still reads the project's mode.
    his.enqueue(async () => { fresh = !pickedMode.has(view); pickedMode.add(view); }).catch(() => undefined);
    try { await original(id, input, viewId); } catch (error) { if (fresh) pickedMode.delete(view); throw error; }
  });
  const restoreDraft = wrap(his, "conversationDraft", (original) => (view) => {
    const draft = original(view);
    const settings = client.config?.settings;
    if (!settings) return draft;
    const project = draft.projectId ? his.visibleProjects().find((item) => item.id === draft.projectId) : undefined;
    const providers = client.config?.providers ?? [];
    const preferences = his.modelPreferences().providerModelPreferences;
    const defaults = newChatDefaults(settings, draft.projectId, project, providers, preferences);
    const available = (selection: ModelSelection) => his.availableModel(selection) === selection;
    let model = draft.modelSelection;
    // Skipped while his project aggregate names a model: his createThread prefers it, so the draft would lie.
    if (view.draftModelSelection === undefined && !project?.defaultModelSelection) {
      if (defaults.model && available(defaults.model)) model = defaults.model;
      else if (model && !isVisible(providers, preferences, model)) model = firstVisible(providers, preferences, available) ?? model;
    }
    const mode = defaults.runtimeMode && !pickedMode.has(view) ? defaults.runtimeMode : view.draftRuntimeMode;
    if (model === draft.modelSelection && mode === view.draftRuntimeMode) return draft;
    return { ...draft, modelSelection: model, runtimeMode: his.compatibleRuntimeMode(model, mode) };
  });
  return { dispose: () => { restoreDraft(); restoreModes(); } };
};
