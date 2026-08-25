import { useEffect, useState } from "react";
import type {
  ProviderConnectionTestResult,
  ProviderModelSnapshot,
  ProviderProfileSnapshot,
  ProviderServiceType
} from "@lyra/contracts";
import type { ApiClient, ProviderCatalog } from "../lib/api-client.js";
import type { AppearanceMode } from "../lib/appearance.js";
import { AppearanceSettings } from "../features/settings/AppearanceSettings.js";
import { AgentPromptSettings } from "../features/settings/AgentPromptSettings.js";
import { AgentRuntimeSettings } from "../features/settings/AgentRuntimeSettings.js";
import { AgentSettingsOverview } from "../features/settings/AgentSettingsOverview.js";
import { CommunitySettings } from "../features/settings/CommunitySettings.js";
import {
  ModelDialog,
  ModelList
} from "../features/settings/ModelSettings.js";
import {
  ProviderConnectionSection,
  toErrorMessage,
  type ConnectionStatus,
  type ProviderFormValue
} from "../features/settings/ProviderConnectionSection.js";
import { ProviderRow } from "../features/settings/ProviderRow.js";
import { ProviderPickerDialog } from "../features/settings/ProviderPickerDialog.js";
import { ProviderModelSelects } from "../features/providers/ProviderModelSelects.js";
import { providerModelDisplayName } from "../features/providers/catalog-selectors.js";
import {
  adapterLabel,
  countServiceModels,
  findProfilePreset,
  isStarterProviderProfile,
  providerPresets,
  serviceSettings,
  type ProviderPreset
} from "../features/settings/provider-presets.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { Icon } from "./Icon.js";

interface SettingsPageProps {
  api: ApiClient;
  catalog: ProviderCatalog;
  appearanceMode: AppearanceMode;
  onChanged: (catalog: ProviderCatalog) => void;
  onError: (error: unknown) => void;
  onAppearanceChange: (mode: AppearanceMode) => void;
  onCommunityChanged: (url: string) => void;
}

type ProviderDialogState = {
  profile: ProviderProfileSnapshot | null;
  preset: ProviderPreset | null;
};

export function SettingsPage(props: SettingsPageProps) {
  const [serviceType, setServiceType] = useState<ProviderServiceType>("llm");
  const [specialSection, setSpecialSection] =
    useState<"agent" | "community" | "display" | null>(null);
  const [agentDetail, setAgentDetail] =
    useState<"prompts" | "runtime" | null>(null);
  const [detailTarget, setDetailTarget] = useState<ProviderDialogState | null>(null);
  const [modelDialog, setModelDialog] = useState<ProviderModelSnapshot | null>(null);
  const [deletingProvider, setDeletingProvider] = useState<ProviderProfileSnapshot | null>(null);
  const [deletingModel, setDeletingModel] = useState<ProviderModelSnapshot | null>(null);
  const [connectionFeedback, setConnectionFeedback] = useState<ConnectionStatus | null>(null);
  const [openProviderMenuId, setOpenProviderMenuId] = useState<string | null>(null);
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const activePresets = providerPresets[serviceType];
  const scopedProfiles = props.catalog.profiles.filter(
    (profile) => profile.serviceType === serviceType
  );
  const selected = detailTarget?.profile
    ? props.catalog.profiles.find((profile) => profile.id === detailTarget.profile?.id)
    : undefined;
  const detailPreset = detailTarget?.preset ?? null;
  const selectedModels = selected
    ? props.catalog.models.filter(
        (model) => model.providerProfileId === selected.id && model.serviceType === serviceType
      )
    : [];
  const availableDefaultModels = props.catalog.models.filter((model) => {
    const profile = props.catalog.profiles.find((item) => item.id === model.providerProfileId);
    return model.serviceType === serviceType && model.enabled && profile?.enabled;
  });
  const selectedDetailModel = selectedModels.find(
    (model) => model.id === props.catalog.defaults[serviceType]
  );
  const selectedDetailModelLabel = selectedDetailModel
    ? providerModelDisplayName(selectedDetailModel)
    : undefined;
  const availableDefaultProfiles = props.catalog.profiles.filter(
    (profile) =>
      profile.serviceType === serviceType &&
      profile.enabled &&
      availableDefaultModels.some(
        (model) => model.providerProfileId === profile.id
      )
  );
  const configuredPresetIds = new Set(scopedProfiles.flatMap((profile) => {
    const preset = findProfilePreset(profile);
    return preset ? [preset.id] : [];
  }));
  const availablePresets = activePresets.filter(
    (preset) => !configuredPresetIds.has(preset.id)
  );
  const orderedProfiles = [...scopedProfiles].sort((left, right) => {
    const leftPreset = findProfilePreset(left);
    const rightPreset = findProfilePreset(right);
    const leftIndex = leftPreset
      ? activePresets.findIndex((preset) => preset.id === leftPreset.id)
      : activePresets.length;
    const rightIndex = rightPreset
      ? activePresets.findIndex((preset) => preset.id === rightPreset.id)
      : activePresets.length;
    return leftIndex - rightIndex || left.createdAt.localeCompare(right.createdAt);
  });

  useEffect(() => {
    if (
      detailTarget?.profile &&
      !props.catalog.profiles.some((profile) => profile.id === detailTarget.profile?.id)
    ) {
      setDetailTarget(null);
    }
  }, [detailTarget, props.catalog.profiles]);

  useEffect(() => {
    const closeMenu = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".settings-provider-menu")) return;
      setOpenProviderMenuId(null);
    };
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, []);

  async function refresh(): Promise<ProviderCatalog> {
    const catalog = await props.api.listProviders();
    props.onChanged(catalog);
    return catalog;
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      props.onError(error);
    } finally {
      setBusy(false);
    }
  }

  async function setDefault(modelId: string) {
    await run(async () => {
      await props.api.setDefaultModel(serviceType, modelId || null);
      await refresh();
    });
  }

  function selectService(next: ProviderServiceType) {
    setSpecialSection(null);
    setAgentDetail(null);
    setServiceType(next);
    setDetailTarget(null);
    setConnectionFeedback(null);
    setOpenProviderMenuId(null);
    setProviderPickerOpen(false);
  }

  function openPreset(preset: ProviderPreset) {
    setOpenProviderMenuId(null);
    setProviderPickerOpen(false);
    setDetailTarget({ profile: null, preset });
    setConnectionFeedback(null);
  }

  function openDetail(profile: ProviderProfileSnapshot) {
    setOpenProviderMenuId(null);
    setDetailTarget({ profile, preset: findProfilePreset(profile) });
    setConnectionFeedback(null);
  }

  function toggleProfile(profile: ProviderProfileSnapshot) {
    if (isStarterProviderProfile(profile) && !profile.hasApiKey) {
      openDetail(profile);
      return;
    }
    void run(async () => {
      await props.api.updateProvider(profile.id, { enabled: !profile.enabled });
      await refresh();
    });
  }

  async function persistConnection(value: ProviderFormValue): Promise<ProviderProfileSnapshot> {
    let profile: ProviderProfileSnapshot;
    if (selected) {
      profile = await props.api.updateProvider(selected.id, {
        name: value.name,
        protocol: value.protocol,
        adapterType: value.adapterType,
        baseUrl: value.baseUrl,
        settings: value.settings,
        enabled: value.enabled,
        ...(value.clearApiKey
          ? { clearApiKey: true }
          : value.apiKey ? { apiKey: value.apiKey } : {}),
        ...(value.clearSecondaryApiKey
          ? { clearSecondaryApiKey: true }
          : value.secondaryApiKey
            ? { secondaryApiKey: value.secondaryApiKey }
            : {})
      });
    } else {
      profile = await props.api.createProvider({
        serviceType,
        name: value.name,
        protocol: value.protocol,
        adapterType: value.adapterType,
        baseUrl: value.baseUrl,
        settings: value.settings,
        enabled: value.enabled,
        ...(value.apiKey ? { apiKey: value.apiKey } : {}),
        ...(value.secondaryApiKey
          ? { secondaryApiKey: value.secondaryApiKey }
          : {})
      });
    }
    await refresh();
    setDetailTarget({ profile, preset: detailPreset });
    return profile;
  }

  async function saveConnection(value: ProviderFormValue): Promise<ProviderProfileSnapshot> {
    setBusy(true);
    try {
      return await persistConnection(value);
    } finally {
      setBusy(false);
    }
  }

  async function testConnection(value: ProviderFormValue): Promise<ProviderConnectionTestResult> {
    setBusy(true);
    setConnectionFeedback({ type: "testing", text: "正在保存最新配置并读取模型…" });
    try {
      const profile = await persistConnection(value);
      const result = await props.api.testProvider(profile.id);
      await refresh();
      setConnectionFeedback({
        type: "success",
        text: `连接成功，已同步 ${result.modelCount} 个可用模型，耗时 ${result.elapsedMs} ms`
      });
      return result;
    } catch (error) {
      setConnectionFeedback({ type: "error", text: toErrorMessage(error) });
      throw error;
    } finally {
      setBusy(false);
    }
  }

  function selectDetailModel(value: string) {
    void setDefault(value);
  }

  return (
    <section className="settings-page settings-page-stage">
      <div className="settings-window">
        <header className="settings-window-heading">
          <div><Icon name="settings" size={23} /><strong>设置与配置</strong></div>
        </header>

        <nav className="settings-service-tabs" aria-label="设置分类">
          {(Object.keys(serviceSettings) as ProviderServiceType[]).map((type) => (
            <button
              type="button"
              className={!specialSection && serviceType === type ? "active" : ""}
              key={type}
              onClick={() => selectService(type)}
            >
              {serviceSettings[type].label}
            </button>
          ))}
          <button
            type="button"
            className={specialSection === "community" ? "active" : ""}
            onClick={() => {
              setSpecialSection("community");
              setAgentDetail(null);
              setDetailTarget(null);
              setConnectionFeedback(null);
              setOpenProviderMenuId(null);
              setProviderPickerOpen(false);
            }}
          >
            社区设置
          </button>
          <button
            type="button"
            className={specialSection === "agent" ? "active" : ""}
            onClick={() => {
              setSpecialSection("agent");
              setAgentDetail(null);
              setDetailTarget(null);
              setConnectionFeedback(null);
              setOpenProviderMenuId(null);
              setProviderPickerOpen(false);
            }}
          >
            Agent 设置
          </button>
          <button
            type="button"
            className={specialSection === "display" ? "active" : ""}
            onClick={() => {
              setSpecialSection("display");
              setAgentDetail(null);
              setDetailTarget(null);
              setConnectionFeedback(null);
              setOpenProviderMenuId(null);
              setProviderPickerOpen(false);
            }}
          >
            显示设置
          </button>
        </nav>

        <div className="settings-window-content">
          {specialSection === "community" ? (
            <CommunitySettings
              api={props.api}
              onError={props.onError}
              onChanged={props.onCommunityChanged}
            />
          ) : specialSection === "display" ? (
            <AppearanceSettings
              mode={props.appearanceMode}
              onChange={props.onAppearanceChange}
            />
          ) : specialSection === "agent" ? (
            agentDetail === "prompts" ? (
              <AgentPromptSettings
                api={props.api}
                onBack={() => setAgentDetail(null)}
                onError={props.onError}
              />
            ) : agentDetail === "runtime" ? (
              <AgentRuntimeSettings
                api={props.api}
                onBack={() => setAgentDetail(null)}
                onError={props.onError}
              />
            ) : (
              <AgentSettingsOverview
                onOpenPrompts={() => setAgentDetail("prompts")}
                onOpenRuntime={() => setAgentDetail("runtime")}
              />
            )
          ) : !detailTarget ? (
            <>
              <section className="settings-overview-heading">
                <div>
                  <h2>{serviceSettings[serviceType].label}</h2>
                  <p>{serviceSettings[serviceType].description} 可以同时启用多个供应商，并指定默认供应商和模型。</p>
                </div>
                <ProviderModelSelects
                  className="settings-default-provider-model"
                  providers={availableDefaultProfiles.map((profile) => ({
                    id: profile.id,
                    name: profile.name
                  }))}
                  models={availableDefaultModels.map((model) => ({
                    id: model.id,
                    providerId: model.providerProfileId,
                    name: providerModelDisplayName(model)
                  }))}
                  modelId={props.catalog.defaults[serviceType] ?? ""}
                  providerLabel="默认供应商"
                  modelLabel="默认模型"
                  onModelChange={(modelId) => void setDefault(modelId)}
                />
              </section>

              <section className="settings-provider-table" aria-label="供应商列表">
                <header>
                  <span>模型服务商</span><span>接口类型</span><span>模型</span><span>是否启用</span><span>操作</span>
                </header>
                {orderedProfiles.map((profile) => {
                  const preset = findProfilePreset(profile);
                  const configured = !isStarterProviderProfile(profile) || profile.hasApiKey;
                  return (
                    <ProviderRow
                      key={profile.id}
                      menuOpen={openProviderMenuId === `${serviceType}:${profile.id}`}
                      name={profile.name}
                      shortName={preset?.shortName ?? "API"}
                      presetId={preset?.id ?? "custom"}
                      interfaceLabel={adapterLabel(profile.adapterType)}
                      enabled={profile.enabled}
                      configured={configured}
                      modelCount={countServiceModels(profile.id, serviceType, props.catalog.models)}
                      busy={busy}
                      onMenuToggle={() => setOpenProviderMenuId((current) =>
                        current === `${serviceType}:${profile.id}` ? null : `${serviceType}:${profile.id}`
                      )}
                      onToggle={() => toggleProfile(profile)}
                      onOpen={() => openDetail(profile)}
                      onDelete={() => {
                        setOpenProviderMenuId(null);
                        setDeletingProvider(profile);
                      }}
                    />
                  );
                })}
                {!scopedProfiles.length && (
                  <p className="settings-provider-empty">尚未添加供应商。</p>
                )}
              </section>
              <button
                type="button"
                className="button button-secondary settings-add-provider"
                onClick={() => setProviderPickerOpen(true)}
              >
                <Icon name="plus" size={15} />添加供应商
              </button>
            </>
          ) : (
            <>
              <header className="settings-detail-heading">
                <button type="button" className="icon-button" aria-label="返回供应商列表" onClick={() => setDetailTarget(null)}>
                  <Icon name="chevron" size={18} />
                </button>
                <div>
                  <h2>连接设置 - {selected?.name ?? detailPreset?.name ?? "自定义连接"}</h2>
                  <p>{serviceSettings[serviceType].label}</p>
                </div>
              </header>

              <ProviderConnectionSection
                key={selected?.id ?? detailPreset?.id ?? "custom"}
                profile={selected ?? null}
                preset={detailPreset}
                busy={busy}
                feedback={connectionFeedback}
                serviceType={serviceType}
                onSave={saveConnection}
                onTest={testConnection}
                afterConnection={selected ? (
                  <section className="settings-detail-section settings-model-section">
                    <header>
                      <div><strong>{serviceSettings[serviceType].label.replace("设置", "模型")}</strong><span>连通性测试成功后自动同步此能力可用的远程模型。</span></div>
                      <div className="settings-section-actions">
                        <button type="button" className="button button-secondary" disabled={busy} onClick={() => void run(async () => {
                          const result = await props.api.testProvider(selected.id);
                          await refresh();
                          setConnectionFeedback({
                            type: "success",
                            text: `已同步 ${result.modelCount} 个可用模型`
                          });
                        })}>检测并同步模型</button>
                      </div>
                    </header>
                    <label className="field settings-detail-default">
                      <span>当前使用模型</span>
                      <select
                        value={selectedModels.some((model) => model.id === props.catalog.defaults[serviceType]) ? props.catalog.defaults[serviceType] ?? "" : ""}
                        title={selectedDetailModelLabel}
                        onChange={(event) => selectDetailModel(event.target.value)}
                      >
                        <option value="">请选择模型</option>
                        {selectedModels.filter((model) => model.enabled).map((model) => (
                          <option value={model.id} key={model.id}>
                            {providerModelDisplayName(model)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <ModelList
                      models={selectedModels}
                      defaultId={props.catalog.defaults[serviceType]}
                      onToggle={(model) => void run(async () => {
                        await props.api.updateProviderModel(model.id, { enabled: !model.enabled });
                        await refresh();
                      })}
                      onEdit={setModelDialog}
                      onDelete={setDeletingModel}
                    />
                  </section>
                ) : (
                  <section className="settings-model-pending">
                    <Icon name="settings" size={24} />
                    <div><strong>等待自动保存</strong><span>填写完整连接信息后将自动创建供应商配置。</span></div>
                  </section>
                )}
              />
            </>
          )}
        </div>

      </div>

      {providerPickerOpen && (
        <ProviderPickerDialog
          presets={availablePresets}
          onClose={() => setProviderPickerOpen(false)}
          onSelectPreset={openPreset}
          onSelectCustom={() => {
            setProviderPickerOpen(false);
            setDetailTarget({ profile: null, preset: null });
            setConnectionFeedback(null);
          }}
        />
      )}

      {modelDialog && (
        <ModelDialog
          serviceType={serviceType}
          model={modelDialog}
          busy={busy}
          onClose={() => setModelDialog(null)}
          onSave={(value) => run(async () => {
            await props.api.updateProviderModel(modelDialog.id, {
              displayName: value.displayName,
              enabled: value.enabled,
              settings: value.settings
            });
            await refresh();
            setModelDialog(null);
          })}
        />
      )}
      {deletingProvider && (
        <ConfirmDialog
          title="删除供应商"
          text={`确认删除“${deletingProvider.name}”的配置？API Key、连接信息和该供应商下已同步的模型将一起清除。`}
          busy={busy}
          onClose={() => setDeletingProvider(null)}
          onConfirm={() => run(async () => {
            await props.api.deleteProvider(deletingProvider.id);
            await refresh();
            setDeletingProvider(null);
          })}
        />
      )}
      {deletingModel && (
        <ConfirmDialog
          title="删除模型"
          text={`确认删除“${deletingModel.displayName}”？`}
          busy={busy}
          onClose={() => setDeletingModel(null)}
          onConfirm={() => run(async () => {
            await props.api.deleteProviderModel(deletingModel.id);
            await refresh();
            setDeletingModel(null);
          })}
        />
      )}
    </section>
  );
}
