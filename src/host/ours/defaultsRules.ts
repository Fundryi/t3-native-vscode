/**
 * R2 defaults, the rule without vscode: what a new chat starts with, as T3 web decides it (reference
 * apps/web/src/components/ChatView.tsx: resolveProjectSettings(...).settings.defaultModelSelection for a draft).
 */
import type { ModelSelection, ProjectId, RuntimeMode, ServerProvider, ServerSettings } from "@t3tools/contracts";
import type { ModelSelection as Selection } from "../../shared/bridge.js";
import { resolveProjectSettings, type LegacyProjectSettingsFields } from "@t3tools/shared/projectSettings";
import { getProviderModelPreference, visibleProviderModels, type ProviderModelPreferences } from "../../shared/modelPreferences.js";

export interface NewChatDefaults {
  /** T3's default model (project override first), only when the picker shows it. */
  readonly model?: ModelSelection;
  /** Only a project override: T3's environment mode decodes to full-access when never set, so it is not followed. */
  readonly runtimeMode?: RuntimeMode;
}

type Providers = ReadonlyArray<Pick<ServerProvider, "instanceId" | "models">>;

/** Whether the picker lists this model (X1: T3's hidden models, or his legacy rule without preferences). */
export function isVisible(providers: Providers, preferences: ProviderModelPreferences, selection: Selection): boolean {
  const provider = providers.find((item) => item.instanceId === selection.instanceId);
  return !!provider && visibleProviderModels(provider, getProviderModelPreference(preferences, provider.instanceId)).some((item) => item.slug === selection.model);
}

/** His fallback without hidden models: per provider the default model if shown, else the first shown one. */
export function firstVisible(providers: Providers, preferences: ProviderModelPreferences, available: (selection: Selection) => boolean): Selection | undefined {
  for (const provider of providers) {
    const shown = visibleProviderModels(provider, getProviderModelPreference(preferences, provider.instanceId));
    const model = shown.find((item) => item.isDefault) ?? shown[0];
    const selection = model ? { instanceId: provider.instanceId, model: model.slug } : undefined;
    if (selection && available(selection)) return selection;
  }
  return undefined;
}

export function newChatDefaults(settings: ServerSettings, projectId: string | null, project: LegacyProjectSettingsFields | undefined,
  providers: Providers, preferences: ProviderModelPreferences): NewChatDefaults {
  const resolved = resolveProjectSettings(settings, projectId as ProjectId | null, project);
  const model = resolved.settings.defaultModelSelection;
  return {
    ...(model && isVisible(providers, preferences, model) ? { model } : {}),
    ...(resolved.sources.defaultRuntimeMode === "project" ? { runtimeMode: resolved.settings.defaultRuntimeMode } : {}),
  };
}
