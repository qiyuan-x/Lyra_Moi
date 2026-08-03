import { useEffect, useRef, useState } from "react";
import type { AssetSnapshot } from "@lyra/contracts";
import { Icon } from "./Icon.js";
import type {
  ModelStats,
  ModelViewerAdapter,
  ViewerLighting,
  ViewerLightingSettings,
  ViewerStatus
} from "./viewer/model-viewer-types.js";
import {
  readViewerPreferences,
  saveViewerPreferences,
  type ViewerPreferences
} from "./viewer/viewer-preferences.js";
import {
  ModelViewerHeader,
  ViewerStatistics
} from "./viewer/ModelViewerChrome.js";
import {
  ViewerDisplayPanel,
  ViewerLightingPanel
} from "./viewer/ModelViewerPanels.js";

export function ModelViewer(props: {
  asset: AssetSnapshot | null;
  contentUrl: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const lightingPanelRef = useRef<HTMLDivElement>(null);
  const lightingButtonRef = useRef<HTMLButtonElement>(null);
  const adapterRef = useRef<ModelViewerAdapter | null>(null);
  const [adapterReady, setAdapterReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lightingOpen, setLightingOpen] = useState(false);
  const [preferences, setPreferences] = useState<ViewerPreferences>(readViewerPreferences);
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [status, setStatus] = useState<ViewerStatus>("idle");
  const lighting = preferences.lighting[preferences.lightingMode];

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let disposed = false;
    let adapter: ModelViewerAdapter | null = null;
    void import("./viewer/three-viewer-adapter.js")
      .then(({ ThreeViewerAdapter }) => {
        if (disposed) return;
        adapter = new ThreeViewerAdapter(host);
        adapterRef.current = adapter;
        setAdapterReady(true);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        console.error("Failed to initialize 3D viewer.", error);
        setStatus("error");
        setAdapterReady(false);
      });
    return () => {
      disposed = true;
      adapter?.dispose();
      adapterRef.current = null;
    };
  }, []);

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || !adapterReady || !props.asset || !props.contentUrl) {
      if (!props.asset) {
        setStatus("idle");
        setStats(null);
      }
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    setStats(null);
    void adapter.load(props.contentUrl, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setStats(value);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Failed to load GLB model.", error);
        setStatus("error");
      });
    return () => controller.abort();
  }, [adapterReady, props.asset?.id, props.contentUrl]);

  useEffect(() => {
    saveViewerPreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    adapterRef.current?.setAutoRotate(preferences.autoRotate);
  }, [adapterReady, preferences.autoRotate]);

  useEffect(() => {
    adapterRef.current?.setGridVisible(preferences.gridVisible);
  }, [adapterReady, preferences.gridVisible]);

  useEffect(() => {
    adapterRef.current?.setWireframeVisible(preferences.topologyVisible);
  }, [adapterReady, preferences.topologyVisible]);

  useEffect(() => {
    adapterRef.current?.setTextureVisible(preferences.textureVisible);
  }, [adapterReady, preferences.textureVisible]);

  useEffect(() => {
    adapterRef.current?.setLighting(lighting);
  }, [adapterReady, lighting]);

  useEffect(() => {
    adapterRef.current?.setExposure(preferences.exposure);
  }, [adapterReady, preferences.exposure]);

  useEffect(() => {
    adapterRef.current?.setFov(preferences.fov);
  }, [adapterReady, preferences.fov]);

  useEffect(() => {
    if (!settingsOpen && !lightingOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        settingsPanelRef.current?.contains(target) ||
        settingsButtonRef.current?.contains(target) ||
        lightingPanelRef.current?.contains(target) ||
        lightingButtonRef.current?.contains(target)
      ) {
        return;
      }
      setSettingsOpen(false);
      setLightingOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [lightingOpen, settingsOpen]);

  function updatePreferences(patch: Partial<ViewerPreferences>) {
    setPreferences((current) => ({ ...current, ...patch }));
  }

  function updateLighting(patch: Partial<ViewerLightingSettings>) {
    setPreferences((current) => {
      const mode = current.lightingMode;
      return {
        ...current,
        lighting: {
          ...current.lighting,
          [mode]: { ...current.lighting[mode], ...patch, mode }
        }
      };
    });
  }

  function selectLightingMode(mode: ViewerLighting) {
    setPreferences((current) => ({ ...current, lightingMode: mode }));
  }

  return (
    <section className="model-viewer-card" ref={containerRef}>
      <ModelViewerHeader
        asset={props.asset}
        stats={stats}
        contentUrl={props.contentUrl}
        onResetCamera={() => adapterRef.current?.resetCamera()}
        onFullscreen={() => void containerRef.current?.requestFullscreen()}
      />

      <div className="model-viewer-stage">
        <div className="three-viewer-canvas" ref={canvasHostRef} />

        {props.asset && (
          <div className="model-viewer-floating-tools">
            <button
              ref={settingsButtonRef}
              type="button"
              className={settingsOpen ? "active" : ""}
              title="显示设置"
              aria-expanded={settingsOpen}
              onClick={() => {
                setSettingsOpen((value) => !value);
                setLightingOpen(false);
              }}
            >
              <Icon name="display" size={17} />
            </button>
            <button
              type="button"
              className={preferences.topologyVisible ? "active" : ""}
              title={preferences.topologyVisible ? "关闭拓扑显示" : "显示模型拓扑"}
              aria-pressed={preferences.topologyVisible}
              onClick={() => updatePreferences({
                topologyVisible: !preferences.topologyVisible
              })}
            >
              <Icon name="wireframe" size={17} />
            </button>
          </div>
        )}

        {props.asset && (
          <div className="model-viewer-lighting-tools">
            <button
              ref={lightingButtonRef}
              type="button"
              className={lightingOpen ? "active" : ""}
              title="光照设置"
              aria-expanded={lightingOpen}
              onClick={() => {
                setLightingOpen((value) => !value);
                setSettingsOpen(false);
              }}
            >
              <Icon name="sun" size={18} />
            </button>
          </div>
        )}

        {props.asset && settingsOpen && (
          <div className="model-viewer-display-panel" ref={settingsPanelRef}>
            <ViewerDisplayPanel
              preferences={preferences}
              onUpdate={updatePreferences}
            />
          </div>
        )}

        {props.asset && lightingOpen && (
          <div className="model-viewer-lighting-panel" ref={lightingPanelRef}>
            <ViewerLightingPanel
              preferences={preferences}
              lighting={lighting}
              onModeChange={selectLightingMode}
              onUpdate={updateLighting}
            />
          </div>
        )}

        {props.asset && preferences.statisticsVisible && stats && (
          <ViewerStatistics stats={stats} />
        )}

        {!props.asset && (
          <div className="model-viewer-empty">
            <span><Icon name="cube" size={42} /></span>
            <h2>还没有可查看的 GLB 模型</h2>
            <p>选择建模任务输出后，可在这里检查实体、线框和模型统计。</p>
          </div>
        )}
        {props.asset && status === "loading" && (
          <div className="model-viewer-overlay" role="status">正在加载模型…</div>
        )}
        {props.asset && status === "error" && (
          <div className="model-viewer-overlay model-viewer-overlay-error" role="alert">
            模型加载失败，请检查 GLB 文件或浏览器 WebGL 设置。
          </div>
        )}
      </div>
    </section>
  );
}
