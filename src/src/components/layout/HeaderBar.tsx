import React, { useRef } from "react";
import {
  Rocket,
  Scale,
  Database,
  Flame,
  TrendingUp,
  HelpCircle,
  Download,
  Upload,
} from "../common/Icons";
import {
  SUPPORTED_INFLATION_YEARS,
  adjustInflationUsd,
  formatValueWithUnit,
  type UnitSystem,
} from "../../config/units";
import type { VehicleConfiguration, VehicleSizingResult } from "../../types/sizing";
import { FeasibilityBadge } from "../common/FeasibilityBadge";

export type WorkspaceTab = "optimize" | "sizing" | "vehicles" | "engines" | "lineup";

export const UI_SCALE_STEPS: number[] = [85, 100, 115, 130];

interface HeaderBarProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  unitSystem: UnitSystem;
  onToggleUnits: () => void;
  currencyYear: number;
  onChangeCurrencyYear: (year: number) => void;
  projectTitle: string;
  onChangeProjectTitle: (title: string) => void;
  selectedPreset: string;
  onSelectPreset: (presetId: string) => void;
  onOpenHelp: () => void;
  config: VehicleConfiguration;
  sizingResult: VehicleSizingResult | null;
  uiScalePct: number;
  onChangeUiScale: (pct: number) => void;
  onSaveDesign: () => void;
  onLoadDesignFile: (file: File) => void;
}

export function HeaderBar({
  activeTab,
  onSelectTab,
  unitSystem,
  onToggleUnits,
  currencyYear,
  onChangeCurrencyYear,
  projectTitle,
  onChangeProjectTitle,
  selectedPreset,
  onSelectPreset,
  onOpenHelp,
  config,
  sizingResult,
  uiScalePct,
  onChangeUiScale,
  onSaveDesign,
  onLoadDesignFile,
}: HeaderBarProps): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const navItems: Array<{ id: WorkspaceTab; label: string; icon: typeof Rocket }> = [
    { id: "optimize", label: "Optimization Search", icon: TrendingUp },
    { id: "sizing", label: "Single Config Evaluator", icon: Rocket },
    { id: "vehicles", label: "Heritage Vehicles", icon: Database },
    { id: "engines", label: "Heritage Engines", icon: Flame },
    { id: "lineup", label: "Scale Lineup", icon: Scale },
  ];

  const showResultStrip = activeTab === "sizing";
  const showPreset = activeTab === "sizing";
  const adjustedCostUsd = sizingResult
    ? adjustInflationUsd(sizingResult.cost_breakdown.reusable_flight_cost_usd, 2026, currencyYear)
    : 0;

  const stepScale = (dir: -1 | 1): void => {
    const idx = UI_SCALE_STEPS.indexOf(uiScalePct);
    const base = idx >= 0 ? idx : 1;
    const next = Math.min(UI_SCALE_STEPS.length - 1, Math.max(0, base + dir));
    onChangeUiScale(UI_SCALE_STEPS[next]);
  };

  const selectClass =
    "input-field text-xs";

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/95 backdrop-blur px-4 py-2.5">
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/20 text-sky-400 border border-sky-500/40">
            <Rocket className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-bold tracking-wide text-slate-100">RocketSizer</div>
            <input
              id="header.project_title"
              type="text"
              value={projectTitle}
              onChange={(e) => onChangeProjectTitle(e.target.value)}
              aria-label="Active project title"
              className="w-48 bg-transparent text-xs text-slate-300 focus:outline-none focus:text-slate-100"
            />
          </div>
        </div>

        <nav className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-900 p-1 border border-slate-800">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                data-testid="header.nav_tab"
                key={item.id}
                type="button"
                title={`Switch to ${item.label} workspace`}
                onClick={() => onSelectTab(item.id)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  active ? "bg-sky-600 text-white shadow" : "text-slate-300 hover:bg-slate-800"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex flex-wrap items-center gap-2">
          {showResultStrip && sizingResult && (
            <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/90 px-3 py-1.5 text-xs">
              <div>
                <span className="text-slate-400">GLOW: </span>
                <span className="font-semibold text-slate-100">
                  {formatValueWithUnit(sizingResult.glow_kg, "mass", unitSystem, 0)}
                </span>
              </div>
              <div>
                <span className="text-slate-400">Payload: </span>
                <span className="font-semibold text-slate-100">
                  {formatValueWithUnit(sizingResult.payload_mass_kg, "mass", unitSystem, 0)}
                </span>
              </div>
              <div>
                <span className="text-slate-400">Cost: </span>
                <span className="font-semibold text-emerald-300">
                  {formatValueWithUnit(adjustedCostUsd, "cost", unitSystem, 1)}
                </span>
              </div>
              <FeasibilityBadge
                feasible={sizingResult.feasible}
                label={sizingResult.feasible ? "Feasible" : `${sizingResult.violation_messages.length} Violations`}
                result={sizingResult}
                config={config}
                unitSystem={unitSystem}
              />
            </div>
          )}

          {showPreset && (
            <select
              id="header.preset_select"
              value={selectedPreset}
              onChange={(e) => onSelectPreset(e.target.value)}
              title="Quick-load a validated historical launch vehicle architecture into the Single Config Evaluator (loads stages, engines, materials, and recovery modes)."
              aria-label="Load Vehicle Preset"
              className={selectClass}
            >
              <option value="custom">
                Custom: {config.name ? config.name.replace(/^Preset:\s*/i, "") : "Custom Vehicle"}
              </option>
              <option value="saturn_v">Preset: Saturn V (Apollo 3-Stage Heavy)</option>
              <option value="falcon_9">Preset: Falcon 9 Block 5 (Partial Reusable)</option>
              <option value="electron">Preset: Electron Light Class</option>
              <option value="sls_block_1">Preset: SLS Block 1 (Deep Space Heavy)</option>
              <option value="vulcan_vc6l">Preset: Vulcan Centaur VC6L</option>
              <option value="new_glenn">Preset: New Glenn</option>
              <option value="starship">Preset: Starship Super Heavy</option>
            </select>
          )}

          {showResultStrip && (
            <label
              className="flex items-center gap-1.5 text-xs text-slate-300"
              title="Costs are converted to the dollar value of the selected year using NASA New Start Inflation Index factors."
            >
              <span>Inflation Basis</span>
              <select
                id="header.currency_year"
                value={currencyYear}
                onChange={(e) => onChangeCurrencyYear(Number(e.target.value))}
                aria-label="Inflation basis year for all dollar costs"
                className={selectClass}
              >
                {[...SUPPORTED_INFLATION_YEARS].reverse().map((yr) => (
                  <option key={yr} value={yr}>
                    {yr} USD
                  </option>
                ))}
              </select>
            </label>
          )}

          <button
            id="header.unit_toggle"
            type="button"
            title="Switch display and input units between Imperial (lb, ft, nmi) and Metric (kg, m, km)."
            onClick={onToggleUnits}
            className="rounded-md border border-sky-500/50 bg-sky-500/15 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-500/25"
          >
            {unitSystem === "metric" ? "Metric (SI)" : "Imperial (US)"}
          </button>

          <div className="flex items-center overflow-hidden rounded-md border border-slate-700 bg-slate-900" role="group" aria-label="Interface scale">
            <button
              id="header.scale_down"
              type="button"
              title="Decrease interface font and control scale (85% to 130%)."
              onClick={() => stepScale(-1)}
              disabled={uiScalePct <= UI_SCALE_STEPS[0]}
              aria-label="Decrease interface size"
              className="px-2.5 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-40"
            >
              A-
            </button>
            <button
              id="header.scale_reset"
              type="button"
              title="Reset interface scale to 100%."
              onClick={() => onChangeUiScale(100)}
              aria-label="Reset interface size to 100 percent"
              className="border-x border-slate-700 px-2 py-1.5 font-mono text-xs text-slate-200 hover:bg-slate-800"
            >
              {uiScalePct}%
            </button>
            <button
              id="header.scale_up"
              type="button"
              title="Increase interface font and control scale (85% to 130%)."
              onClick={() => stepScale(1)}
              disabled={uiScalePct >= UI_SCALE_STEPS[UI_SCALE_STEPS.length - 1]}
              aria-label="Increase interface size"
              className="px-2.5 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-40"
            >
              A+
            </button>
          </div>

          <button
            id="header.save_design"
            type="button"
            onClick={onSaveDesign}
            title="Save the current vehicle design to a .rsizer file"
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5 text-emerald-300" />
            <span>Save</span>
          </button>
          <button
            id="header.load_design"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Load a vehicle design from a .rsizer file"
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
          >
            <Upload className="h-3.5 w-3.5 text-sky-300" />
            <span>Load</span>
          </button>
          <input
            ref={fileInputRef}
            id="header.load_design_input"
            type="file"
            accept=".rsizer,application/json"
            className="hidden"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onLoadDesignFile(file);
              e.target.value = "";
            }}
          />

          <button
            id="header.help_btn"
            type="button"
            title="Open Quick Start Guide explaining workflows, tools, and file saving."
            onClick={onOpenHelp}
            aria-label="Quick Start Guide"
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
          >
            <HelpCircle className="h-3.5 w-3.5 text-sky-400" />
            <span>Guide</span>
          </button>
        </div>
      </div>
    </header>
  );
}
