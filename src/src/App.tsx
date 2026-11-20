import React, { useEffect, useState } from "react";
import type { UnitSystem } from "./config/units";
import {
  createDefaultVehicleConfiguration,
  createPresetVehicleConfiguration,
  evaluateManualArchitecture,
  getHeritageEngines,
  getHeritageVehicles,
  runCombinatorialSizing,
} from "./api/tauriClient";
import type { InspectorTarget } from "./types/provenance";
import type { ProvenanceEngine } from "./types/engine";
import type { ProvenanceVehicle } from "./types/vehicle";
import type {
  OptimizationStrategy,
  RocketSizerDesignFileV1,
  SizingSweepResponse,
  VehicleConfiguration,
  VehicleSizingResult,
} from "./types/sizing";
import { HeaderBar, UI_SCALE_STEPS, type WorkspaceTab } from "./components/layout/HeaderBar";
import { ProvenanceDrawer } from "./components/inspector/ProvenanceDrawer";
import { X } from "./components/common/Icons";
import { SizingStudioView } from "./views/SizingStudioView";
import { OptimizationSearchView } from "./views/OptimizationSearchView";
import { HeritageVehiclesView } from "./views/HeritageVehiclesView";
import { HeritageEnginesView } from "./views/HeritageEnginesView";
import { ScaleLineupView } from "./views/ScaleLineupView";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = { hasError: false, error: null };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("RocketSizer UI Error:", error, info);
  }

  public override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[50vh] flex-col items-center justify-center p-6 text-center">
          <div className="max-w-lg rounded-xl border border-rose-700 bg-rose-950/80 p-6 shadow-2xl">
            <h2 className="mb-2 text-lg font-bold text-rose-200">RocketSizer Rendering Error</h2>
            <p className="mb-4 text-xs font-mono text-rose-300">
              {this.state.error?.message || "An unexpected error occurred while rendering this view."}
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="rounded bg-rose-700 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-600"
            >
              Reload Workstation
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App(): React.ReactElement {
  const [activeTab, setActiveTabRaw] = useState<WorkspaceTab>("optimize");
  const setActiveTab = (next: WorkspaceTab | ((prev: WorkspaceTab) => WorkspaceTab)): void => {
    React.startTransition(() => {
      setActiveTabRaw(next);
    });
  };
  const [unitSystem, setUnitSystem] = useState<UnitSystem>("imperial");
  const [currencyYear, setCurrencyYear] = useState<number>(2026);
  const [selectedPreset, setSelectedPreset] = useState<string>("saturn_v");
  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);
  const [uiScalePct, setUiScalePct] = useState<number>(() => {
    const stored = typeof window !== "undefined" ? Number(window.localStorage.getItem("rocketsizer.ui_scale")) : 0;
    return UI_SCALE_STEPS.includes(stored) ? stored : 100;
  });
  const [config, setConfig] = useState<VehicleConfiguration>(() =>
    createDefaultVehicleConfiguration()
  );
  const [strategy, setStrategy] = useState<OptimizationStrategy>("balanced_trade");

  const [vehicles, setVehicles] = useState<ProvenanceVehicle[]>([]);
  const [engines, setEngines] = useState<ProvenanceEngine[]>([]);
  const [sizingResult, setSizingResult] = useState<VehicleSizingResult | null>(null);
  const [sweepResponse, setSweepResponse] = useState<SizingSweepResponse | null>(null);
  const [inspectorTarget, setInspectorTargetRaw] = useState<InspectorTarget | null>(null);
  const setInspectorTarget = (
    next: InspectorTarget | null | ((prev: InspectorTarget | null) => InspectorTarget | null)
  ): void => {
    React.startTransition(() => {
      setInspectorTargetRaw(next);
    });
  };
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.location.protocol.startsWith("http")) {
      return;
    }
    const ping = (): void => {
      void fetch("/api/heartbeat", { method: "POST" }).catch(() => {});
    };
    const handlePageHide = (): void => {
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon("/api/shutdown", "{}");
      }
    };
    ping();
    const timer = window.setInterval(ping, 2000);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([getHeritageVehicles(), getHeritageEngines()])
      .then(([loadedVehicles, loadedEngines]) => {
        if (!mounted) return;
        setVehicles(loadedVehicles);
        setEngines(loadedEngines);
      })
      .catch((err) => {
        if (!mounted) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load aerospace datasets");
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    evaluateManualArchitecture(config)
      .then((res) => {
        if (active) {
          setSizingResult(res);
        }
      })
      .catch((err) => {
        if (active) {
          setLoadError(err instanceof Error ? err.message : "Sizing evaluation error");
        }
      });
    return () => {
      active = false;
    };
  }, [config]);

  useEffect(() => {
    const clampedScale = Math.min(130, Math.max(85, uiScalePct));
    document.documentElement.style.fontSize = `${16 * (clampedScale / 100)}px`;
    window.localStorage.setItem("rocketsizer.ui_scale", String(clampedScale));
  }, [uiScalePct]);

  const handleSelectPreset = (presetId: string): void => {
    if (presetId === "custom") return;
    setSelectedPreset(presetId);
    setConfig(createPresetVehicleConfiguration(presetId));
    setActiveTab("sizing");
  };

  const handleConfigChange = (
    next: VehicleConfiguration | ((prev: VehicleConfiguration) => VehicleConfiguration)
  ): void => {
    setSelectedPreset("custom");
    setConfig(next);
  };

  const handleSaveDesign = (): void => {
    const file: RocketSizerDesignFileV1 = {
      schema: "rocketsizer.design.v1",
      saved_at_iso: new Date().toISOString(),
      project_title: config.name,
      unit_system: unitSystem,
      currency_year: currencyYear,
      strategy,
      config,
    };
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${config.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_") || "design"}.rsizer`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleLoadDesignFile = (file: File): void => {
    file
      .text()
      .then((text) => {
        const parsed = JSON.parse(text) as Partial<RocketSizerDesignFileV1>;
        if (parsed.schema !== "rocketsizer.design.v1" || !parsed.config || !Array.isArray(parsed.config.stages)) {
          throw new Error("Not a RocketSizer design file (expected schema rocketsizer.design.v1).");
        }
        setSelectedPreset("custom");
        setConfig(parsed.config);
        if (parsed.unit_system === "metric" || parsed.unit_system === "imperial") setUnitSystem(parsed.unit_system);
        if (typeof parsed.currency_year === "number") setCurrencyYear(parsed.currency_year);
        if (parsed.strategy) setStrategy(parsed.strategy);
        setLoadError(null);
        setActiveTab("sizing");
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? `Could not load design: ${err.message}` : "Could not load design file.");
      });
  };

  const handleSubmitCorrection = (
    target: InspectorTarget,
    correctedValue: string,
    rationale: string
  ): void => {
    const parsedNum = Number(correctedValue);
    setEngines((prev) =>
      prev.map((eng) => {
        if (eng.name.value !== target.entityName) return eng;
        if (target.fieldKey === "isp_vac_s" && !Number.isNaN(parsedNum)) {
          return {
            ...eng,
            isp_vac_s: {
              ...eng.isp_vac_s,
              value: parsedNum,
              notes: `User correction: ${rationale}`,
            },
          };
        }
        return eng;
      })
    );
    setInspectorTarget(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <HeaderBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        unitSystem={unitSystem}
        onToggleUnits={() => setUnitSystem((u) => (u === "metric" ? "imperial" : "metric"))}
        currencyYear={currencyYear}
        onChangeCurrencyYear={setCurrencyYear}
        projectTitle={config.name}
        onChangeProjectTitle={(title) => setConfig((prev) => ({ ...prev, name: title }))}
        selectedPreset={selectedPreset}
        onSelectPreset={handleSelectPreset}
        onOpenHelp={() => setShowHelpModal(true)}
        config={config}
        sizingResult={sizingResult}
        uiScalePct={uiScalePct}
        onChangeUiScale={setUiScalePct}
        onSaveDesign={handleSaveDesign}
        onLoadDesignFile={handleLoadDesignFile}
      />

      <ErrorBoundary>
        <main className="mx-auto max-w-[1600px] p-3">
          {loadError && (
            <div className="mb-3 rounded border border-rose-700 bg-rose-950/60 px-3 py-2 text-xs text-rose-200">
              {loadError}
            </div>
          )}

          {activeTab === "optimize" && (
            <OptimizationSearchView
              config={config}
              onChangeConfig={handleConfigChange}
              engines={engines}
              vehicles={vehicles}
              strategy={strategy}
              onChangeStrategy={setStrategy}
              unitSystem={unitSystem}
              currencyYear={currencyYear}
              onOpenInSingleConfig={(nextCfg, nextRes) => {
                setSelectedPreset("custom");
                setConfig(nextCfg);
                setSizingResult(nextRes);
                setActiveTab("sizing");
              }}
            />
          )}

          {activeTab === "sizing" && (
            <SizingStudioView
              config={config}
              onChangeConfig={handleConfigChange}
              engines={engines}
              vehicles={vehicles}
              result={sizingResult}
              unitSystem={unitSystem}
              currencyYear={currencyYear}
              onInspect={setInspectorTarget}
              onBackToSearch={() => setActiveTab("optimize")}
            />
          )}

          {activeTab === "vehicles" && (
            <HeritageVehiclesView
              vehicles={vehicles}
              engines={engines}
              unitSystem={unitSystem}
              currencyYear={currencyYear}
              onInspect={setInspectorTarget}
            />
          )}

          {activeTab === "engines" && (
            <HeritageEnginesView
              engines={engines}
              customEngines={config.custom_engines}
              onAddCustomEngine={(eng) =>
                setConfig((prev) => ({ ...prev, custom_engines: [...prev.custom_engines, eng] }))
              }
              unitSystem={unitSystem}
              onInspect={setInspectorTarget}
            />
          )}

          {activeTab === "lineup" && (
            <ScaleLineupView
              activeResult={sizingResult}
              activeLabel={config.name}
              heritageVehicles={vehicles}
              unitSystem={unitSystem}
            />
          )}
        </main>
      </ErrorBoundary>

      <ProvenanceDrawer
        target={inspectorTarget}
        onClose={() => setInspectorTarget(null)}
        onSubmitCorrection={handleSubmitCorrection}
      />

      {showHelpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between border-b border-slate-800 pb-2">
              <h2 className="text-base font-bold text-sky-300">RocketSizer In-App Quick Start Guide</h2>
              <button id="header.help_close_btn" type="button" onClick={() => setShowHelpModal(false)} aria-label="Close Quick Start Guide" title="Close the Quick Start Guide modal" className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 text-xs leading-relaxed text-slate-300">
              <p>
                <strong>1. Multi-Architecture Optimization Search (Main Page):</strong> Enter your payload mass, payload dimensions, target orbit, and vehicle constraints. RocketSizer automatically searches 2-Stage, 2.5-Stage, 3-Stage, and 3.5-Stage architectures and presents side-by-side winners.
              </p>
              <p>
                <strong>2. Single Config Evaluator (Tab 2):</strong> Click <em>Open in Single Config Evaluator</em> on any winner, load a historical preset from the top selector, or manually pick specific Stage 1 / Stage 2 / Stage 3 engines, strap-on boosters, tank materials, and recovery modes (supports Auto-Size dV and Fixed-GLOW modes).
              </p>
              <p>
                <strong>3. Edit 2D Engine Base Layout:</strong> Drag individual engine circles directly inside the 2D Engine Base Layout view to inspect skirt clearances and TVC gimbal envelopes, or double-click a nozzle to toggle it off.
              </p>
              <p>
                <strong>4. Scale Custom Engines:</strong> Open <em>Scale Rubber Engine</em> in Single Config Evaluator or Heritage Engines to scale any liquid reference engine to custom vacuum thrust and chamber pressure.
              </p>
              <p>
                <strong>5. Inspect Citations &amp; Export:</strong> Click any outlined cell in Heritage Vehicles or Heritage Engines to inspect verified source citations, and use Columns and Filters to narrow either table. Use <em>Export Brief</em>, <em>Export Lineup SVG</em>, or <em>Export CSV</em> across views to save results.
              </p>
              <p>
                <strong>6. Save &amp; Load Designs:</strong> Use <em>Save</em> and <em>Load</em> in the header to write or read a <code>.rsizer</code> design file. Use <em>A-</em> / <em>A+</em> to scale all text and layout.
              </p>
              <div className="rounded-lg border border-amber-800/40 bg-amber-950/25 p-3 text-[11px] leading-relaxed text-amber-200/90 space-y-1">
                <strong className="text-amber-300 block uppercase tracking-wide">7. Engineering Fidelity Scope &amp; Conceptual Boundaries:</strong>
                RocketSizer is preliminary conceptual architecture synthesis and trade-study software. Sizing utilizes closed-form Barlow pressure vessel mechanics, NASA SP-8007 cylinder buckling criteria, 2-DOF gravity-turn ascent integration, and calibrated TRANSCOST / NAFCOM Cost Estimating Relationships. Excludes 3D Finite Element Analysis (FEA), 6-DOF closed-loop guidance, and solid grain burn regression geometry. Not an authority for flight certification.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default App;
