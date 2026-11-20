import React, { useEffect, useState } from "react";
import { evaluateRecoveryStrategyTrade } from "../../api/tauriClient";
import { DEFAULT_ADVANCED_MODEL_DEFAULTS, formatRecoveryMode } from "../../config/formatters";
import { formatValueWithUnit, type UnitSystem } from "../../config/units";
import type {
  AdvancedModelDefaults,
  RecoveryMode,
  RecoveryOptimizationReport,
  RecoveryStrategyCandidate,
  VehicleConfiguration,
} from "../../types/sizing";

interface RecoveryOptimizerPanelProps {
  config: VehicleConfiguration;
  onChangeConfig: (next: VehicleConfiguration) => void;
  unitSystem: UnitSystem;
  inflationFactor: number;
  currencyYear: number;
  idPrefix: string;
}

const MODE_OPTIONS: Array<{ value: RecoveryMode; label: string }> = [
  { value: "expendable", label: "Expendable" },
  { value: "downrange_landing_asds", label: "Downrange Barged (ASDS)" },
  { value: "return_to_launch_site_rtls", label: "Return to Launch Site (RTLS)" },
  { value: "parachute_mid_air_catch", label: "Parachute / Mid-Air Catch" },
];

export const RecoveryOptimizerPanel: React.FC<RecoveryOptimizerPanelProps> = ({
  config,
  onChangeConfig,
  unitSystem,
  inflationFactor,
  currencyYear,
  idPrefix,
}) => {
  const [report, setReport] = useState<RecoveryOptimizationReport | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [showTable, setShowTable] = useState<boolean>(false);
  const [showAdvancedFleet, setShowAdvancedFleet] = useState<boolean>(false);

  const payloadKg = config.payload_mass_kg ?? 5000;
  const heritageReuses = payloadKg > 40000 ? 10 : payloadKg > 10000 ? 15 : payloadKg > 2000 ? 10 : 5;
  const heritageRefurbPct = payloadKg > 40000 ? 4.0 : payloadKg > 10000 ? 5.0 : payloadKg > 2000 ? 8.0 : 12.0;
  const heritageOpsM = payloadKg > 40000 ? 2.5 : payloadKg > 10000 ? 1.2 : payloadKg > 2000 ? 0.8 : 0.4;

  const optimizerEnabled = config.recovery_optimizer_enabled !== false;
  const adv: AdvancedModelDefaults = config.advanced_defaults ?? DEFAULT_ADVANCED_MODEL_DEFAULTS;

  const updateStageRec = (stageIdx: number, mode: RecoveryMode): void => {
    const nextStages = config.stages.map((st, idx) =>
      idx === stageIdx ? { ...st, recovery_mode: mode } : st
    );
    const anyReusable =
      mode !== "expendable" ||
      nextStages.some((s) => s.recovery_mode !== "expendable") ||
      (config.booster_recovery_mode ?? "expendable") !== "expendable";
    onChangeConfig({
      ...config,
      stages: nextStages,
      expected_reuses: anyReusable ? Math.max(2, config.expected_reuses) : 1,
    });
  };

  const updateBoosterRec = (mode: RecoveryMode): void => {
    const anyReusable =
      mode !== "expendable" || config.stages.some((s) => s.recovery_mode !== "expendable");
    onChangeConfig({
      ...config,
      booster_recovery_mode: mode,
      expected_reuses: anyReusable ? Math.max(2, config.expected_reuses) : 1,
    });
  };

  const applyCandidate = (cand: RecoveryStrategyCandidate): void => {
    const nextStages = config.stages.map((st, idx) => {
      if (idx === 0) return { ...st, recovery_mode: cand.s1_mode };
      if (idx === 1) return { ...st, recovery_mode: cand.s2_mode };
      if (idx === 2) return { ...st, recovery_mode: cand.s3_mode };
      return st;
    });
    const isAllExp =
      cand.booster_mode === "expendable" &&
      cand.s1_mode === "expendable" &&
      cand.s2_mode === "expendable" &&
      cand.s3_mode === "expendable";
    onChangeConfig({
      ...config,
      booster_recovery_mode: cand.booster_mode,
      fairing_reusable: cand.fairing_reusable,
      stages: nextStages,
      expected_reuses: isAllExp ? 1 : Math.max(2, config.expected_reuses || 10),
    });
  };

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      evaluateRecoveryStrategyTrade(config)
        .then((res) => {
          if (!active) return;
          setReport(res);
          if (optimizerEnabled) {
            const rec = res.candidates.find((c) => c.id === res.recommended_id);
            if (rec) {
              const s1 = config.stages[0]?.recovery_mode ?? "expendable";
              const s2 = config.stages[1]?.recovery_mode ?? "expendable";
              const s3 = config.stages[2]?.recovery_mode ?? "expendable";
              const bst = config.booster_recovery_mode ?? "expendable";
              const differs =
                s1 !== rec.s1_mode ||
                s2 !== rec.s2_mode ||
                s3 !== rec.s3_mode ||
                bst !== rec.booster_mode ||
                Boolean(config.fairing_reusable) !== Boolean(rec.fairing_reusable);
              if (differs) {
                applyCandidate(rec);
              }
            }
          }
        })
        .catch(() => {});
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    optimizerEnabled,
    config.payload_mass_kg,
    config.production_quantity,
    config.expected_reuses,
    config.booster_count,
    config.booster_engine_id,
    config.booster_recovery_mode,
    config.fairing_reusable,
    config.stage_count,
    config.stages.map((s) => `${s.engine_id}:${s.recovery_mode}:${s.delta_v_split_frac}`).join("|"),
    adv.reusable_ddte_surcharge_frac,
    adv.recovery_ops_per_flight_usd,
    adv.refurb_cost_frac_override,
  ]);

  const recommended = report?.candidates.find((c) => c.id === report.recommended_id) ?? null;
  const s1Mode = config.stages[0]?.recovery_mode ?? "expendable";
  const s2Mode = config.stages[1]?.recovery_mode ?? "expendable";
  const s3Mode = config.stages[2]?.recovery_mode ?? "expendable";
  const bstMode = config.booster_recovery_mode ?? "expendable";

  const fmtUsd = (val: number): string => formatValueWithUnit(val * inflationFactor, "cost", unitSystem);

  return (
    <div className="surface-card p-3 space-y-3 border border-cyan-800/50 bg-slate-900/50">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-100">
            Recovery Strategy Optimizer &amp; Element Recoverability Matrix
          </h3>
          <p className="text-xs text-slate-400">
            Optimizer mode automatically finds the lowest lifecycle cost configuration based on planned flights and reuses.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            id={`${idPrefix}.rec_opt_auto`}
            onClick={() => onChangeConfig({ ...config, recovery_optimizer_enabled: true })}
            title="Automatically evaluate all combinations of stage/booster/fairing reuse and select the lowest campaign cost mode"
            className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold border transition shadow-sm ${
              optimizerEnabled
                ? "border-cyan-500 bg-cyan-600 text-white shadow-cyan-900/30"
                : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500 hover:text-white"
            }`}
          >
            Optimizer (Recommended)
          </button>
          <button
            type="button"
            id={`${idPrefix}.rec_opt_manual`}
            onClick={() => onChangeConfig({ ...config, recovery_optimizer_enabled: false })}
            title="Enable manual element-by-element recovery buttons for each booster, stage core, and fairing"
            className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold border transition shadow-sm ${
              !optimizerEnabled
                ? "border-amber-500 bg-amber-600 text-white shadow-amber-900/30"
                : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500 hover:text-white"
            }`}
          >
            Manual Selection
          </button>
        </div>
      </div>

      {/* Campaign Operations & Fleet Economics - Always shown by default */}
      <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between border-b border-slate-800 pb-2 gap-2">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-sky-300">
              Campaign Operations &amp; Fleet Economics
            </span>
            <p className="text-[11px] text-slate-400">
              Total flight cadence, core reuse thresholds, and turnaround refurbishment economics
            </p>
          </div>
          <button
            type="button"
            id={`${idPrefix}.toggle_advanced_fleet`}
            onClick={() => setShowAdvancedFleet((v) => !v)}
            title="Toggle advanced core reuse, refurbishment fraction, and recovery fleet cost overrides"
            className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white"
          >
            <span>{showAdvancedFleet ? "Hide Advanced Options" : "Show Advanced Options"}</span>
            <span className="text-[11px] text-sky-400 font-mono">
              (Heritage: {heritageReuses}x, {heritageRefurbPct}%)
            </span>
          </button>
        </div>

        {/* Primary Campaign Parameters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
            <label
              className="text-[11px] font-semibold text-slate-300 leading-tight mb-1 min-h-[2.25rem] flex items-center"
              title="Total planned launches across program lifetime for amortizing development and ground infrastructure costs."
            >
              Planned Program Launches
            </label>
            <div className="mt-auto">
              <input
                type="number"
                min={1}
                max={500}
                value={config.production_quantity}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    production_quantity: Math.max(1, Math.min(500, Math.round(Number(e.target.value) || 1))),
                  })
                }
                title="Total planned launches across program lifetime for amortizing development and ground infrastructure costs."
                className="input-field w-full font-mono text-xs"
              />
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
            <label
              className="text-[11px] font-semibold text-slate-300 leading-tight mb-1 min-h-[2.25rem] flex items-center"
              title="Target flight count before hardware retirement for each recovered booster or stage core."
            >
              Target Flights per Core
            </label>
            <div className="mt-auto">
              <input
                type="number"
                min={1}
                max={200}
                value={config.expected_reuses}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    expected_reuses: Math.max(1, Math.min(200, Math.round(Number(e.target.value) || 1))),
                  })
                }
                title="Target flight count before hardware retirement for each recovered booster or stage core."
                className="input-field w-full font-mono text-xs"
              />
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
            <label
              className="text-[11px] font-semibold text-slate-300 leading-tight mb-1 min-h-[2.25rem] flex items-center"
              title="Turnaround inspection and replacement cost per flight as a percentage of first-unit stage hardware cost."
            >
              Turnaround Refurbishment (%)
            </label>
            <div className="mt-auto">
              <input
                type="number"
                min={1}
                max={60}
                step={0.5}
                value={
                  adv.refurb_cost_frac_override !== null && adv.refurb_cost_frac_override !== undefined
                    ? Number((adv.refurb_cost_frac_override * 100).toFixed(1))
                    : heritageRefurbPct
                }
                onChange={(e) => {
                  const frac = Math.max(0.01, Math.min(0.6, (Number(e.target.value) || heritageRefurbPct) / 100));
                  onChangeConfig({
                    ...config,
                    advanced_defaults: { ...adv, refurb_cost_frac_override: frac },
                  });
                }}
                title="Turnaround inspection and replacement cost per flight as a percentage of first-unit stage hardware cost."
                className="input-field w-full font-mono text-xs"
              />
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
            <label
              className="text-[11px] font-semibold text-slate-300 leading-tight mb-1 min-h-[2.25rem] flex items-center"
              title="Autonomous spaceport drone ship, tugboat fleet, or landing pad recovery crew operations cost per flight."
            >
              Recovery Fleet Operations ($M/flt)
            </label>
            <div className="mt-auto">
              <input
                type="number"
                min={0}
                max={25}
                step={0.05}
                value={Number((adv.recovery_ops_per_flight_usd / 1e6).toFixed(2))}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    advanced_defaults: {
                      ...adv,
                      recovery_ops_per_flight_usd: Math.max(0, (Number(e.target.value) || 0) * 1e6),
                    },
                  })
                }
                title="Autonomous spaceport drone ship, tugboat fleet, or landing pad recovery crew operations cost per flight."
                className="input-field w-full font-mono text-xs"
              />
            </div>
          </div>
        </div>

        {/* Expandable Advanced Fleet Parameters */}
        {showAdvancedFleet && (
          <div className="rounded-lg border border-slate-800/90 bg-slate-900/40 p-3 space-y-2.5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
                Heritage Baseline Overrides &amp; Development Surcharges
              </span>
              <button
                type="button"
                onClick={() =>
                  onChangeConfig({
                    ...config,
                    expected_reuses: heritageReuses,
                    advanced_defaults: {
                      ...adv,
                      refurb_cost_frac_override: null,
                      recovery_ops_per_flight_usd: heritageOpsM * 1e6,
                      reusable_ddte_surcharge_frac: 0.18,
                    },
                  })
                }
                title="Restore fleet economics parameters to validated heritage values matching this vehicle payload class"
                className="btn-secondary text-[11px] px-2 py-0.5"
              >
                Reset to Heritage Defaults
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
              <div className="flex flex-col justify-between rounded border border-slate-800/80 bg-slate-950/60 p-2">
                <span className="text-[11px] text-slate-300 font-medium">Core Lifetime Limit</span>
                <span className="text-[11px] text-slate-400">Class heritage: {heritageReuses} reuses</span>
                <span className="mt-1 font-mono text-xs text-sky-300">Active: {config.expected_reuses} flights/core</span>
              </div>
              <div className="flex flex-col justify-between rounded border border-slate-800/80 bg-slate-950/60 p-2">
                <span className="text-[11px] text-slate-300 font-medium">Refurbishment Rate</span>
                <span className="text-[11px] text-slate-400">Class heritage: {heritageRefurbPct}% hardware/flt</span>
                <span className="mt-1 font-mono text-xs text-amber-300">
                  Active: {adv.refurb_cost_frac_override !== null ? `${(adv.refurb_cost_frac_override * 100).toFixed(1)}%` : `${heritageRefurbPct}% (Default)`}
                </span>
              </div>
              <div className="flex flex-col justify-between rounded border border-slate-800/80 bg-slate-950/60 p-2">
                <span className="text-[11px] text-slate-300 font-medium">Recovery Fleet &amp; Pad Cost</span>
                <span className="text-[11px] text-slate-400">Class heritage: ${heritageOpsM}M / flight</span>
                <span className="mt-1 font-mono text-xs text-emerald-300">
                  Active: ${(adv.recovery_ops_per_flight_usd / 1e6).toFixed(2)}M / launch
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Per-Element Recoverability Matrix - Hidden when Optimizer is enabled */}
      {!optimizerEnabled && (
        <div className="rounded-lg border border-amber-800/40 bg-slate-950/70 p-3 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
              Manual Element Recoverability Matrix
            </span>
            <span className="text-[11px] text-slate-400">
              Explicit element-by-element recovery mode assignments
            </span>
          </div>

          <div className="space-y-2.5 pt-1">
            {/* Boosters Row */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="min-w-[160px]">
                <div className="text-xs font-bold text-slate-100">Strap-On Boosters</div>
                <div className="text-[11px] text-slate-400">
                  {config.booster_count > 0 ? `${config.booster_count}x boosters configured` : "0 boosters active"}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 flex-1 justify-start md:justify-end">
                {[
                  {
                    value: "expendable" as RecoveryMode,
                    label: "Expendable",
                    tooltip: "Expendable: Boosters separate after burnout and impact downrange ocean. Zero recovery mass penalty, maximum liftoff delta-V.",
                  },
                  {
                    value: "downrange_landing_asds" as RecoveryMode,
                    label: "Downrange Barge (ASDS)",
                    tooltip: "Autonomous Spaceport Drone Ship (ASDS): Boosters land on autonomous barge downrange. Low delta-V penalty (~15% fuel reserve).",
                  },
                  {
                    value: "return_to_launch_site_rtls" as RecoveryMode,
                    label: "Return to Site (RTLS)",
                    tooltip: "Return to Launch Site (RTLS): Boosters burn reverse boostback to pad. Eliminates marine recovery ship ops, ~25% fuel reserve.",
                  },
                  {
                    value: "parachute_mid_air_catch" as RecoveryMode,
                    label: "Parachute / Catch",
                    tooltip: "Parachute Deceleration: Parachutes deploy for splashdown or mid-air catch (e.g. Electron, Space Shuttle SRBs).",
                  },
                ].map((opt) => {
                  const isSelected = bstMode === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      title={opt.tooltip}
                      onClick={() => updateBoosterRec(opt.value)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md border text-center transition shadow-sm whitespace-nowrap ${
                        isSelected
                          ? "border-amber-400 bg-amber-500/25 text-amber-200 ring-1 ring-amber-400"
                          : "border-slate-700 bg-slate-900/90 text-slate-300 hover:bg-slate-800 hover:border-slate-500 hover:text-white"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Stage 1 Core Row */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="min-w-[160px]">
                <div className="text-xs font-bold text-slate-100">Stage 1 Booster Core</div>
                <div className="text-[11px] text-slate-400">Primary ascent first stage</div>
              </div>
              <div className="flex flex-wrap items-center gap-2 flex-1 justify-start md:justify-end">
                {[
                  {
                    value: "expendable" as RecoveryMode,
                    label: "Expendable",
                    tooltip: "Expendable: Stage 1 is discarded after burnout and disintegrates on re-entry. Zero recovery dry mass penalty.",
                  },
                  {
                    value: "downrange_landing_asds" as RecoveryMode,
                    label: "Downrange Barge (ASDS)",
                    tooltip: "Autonomous Spaceport Drone Ship (ASDS): Booster performs boostback, entry, and landing burns to touch down on drone ship.",
                  },
                  {
                    value: "return_to_launch_site_rtls" as RecoveryMode,
                    label: "Return to Site (RTLS)",
                    tooltip: "Return to Launch Site (RTLS): Booster burns back to coastal launch pad. Eliminates marine recovery fleet ops.",
                  },
                  {
                    value: "parachute_mid_air_catch" as RecoveryMode,
                    label: "Parachute / Catch",
                    tooltip: "Parachute / Mid-Air Catch: Aerodynamic parachute recovery for splashdown or helicopter capture.",
                  },
                ].map((opt) => {
                  const isSelected = s1Mode === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      title={opt.tooltip}
                      onClick={() => updateStageRec(0, opt.value)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md border text-center transition shadow-sm whitespace-nowrap ${
                        isSelected
                          ? "border-amber-400 bg-amber-500/25 text-amber-200 ring-1 ring-amber-400"
                          : "border-slate-700 bg-slate-900/90 text-slate-300 hover:bg-slate-800 hover:border-slate-500 hover:text-white"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Stage 2 Core Row */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="min-w-[160px]">
                <div className="text-xs font-bold text-slate-100">Stage 2 Upper Core</div>
                <div className="text-[11px] text-slate-400">Orbital insertion stage</div>
              </div>
              <div className="flex flex-wrap items-center gap-2 flex-1 justify-start md:justify-end">
                {[
                  {
                    value: "expendable" as RecoveryMode,
                    label: "Expendable",
                    tooltip: "Expendable: Upper stage enters orbit and re-enters destructively into South Pacific Ocean. Standard industry practice.",
                  },
                  {
                    value: "downrange_landing_asds" as RecoveryMode,
                    label: "Orbital Heatshield (ASDS)",
                    tooltip: "Orbital Re-entry Landing: Upper stage requires heavy heat shield, deorbit propellant, and propulsive landing legs.",
                  },
                  {
                    value: "return_to_launch_site_rtls" as RecoveryMode,
                    label: "Deorbit Return (RTLS)",
                    tooltip: "Return To Launch Site: Upper stage completes orbit and burns deorbit propellant for precision pad landing.",
                  },
                ].map((opt) => {
                  const isSelected = s2Mode === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      title={opt.tooltip}
                      onClick={() => updateStageRec(1, opt.value)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md border text-center transition shadow-sm whitespace-nowrap ${
                        isSelected
                          ? "border-amber-400 bg-amber-500/25 text-amber-200 ring-1 ring-amber-400"
                          : "border-slate-700 bg-slate-900/90 text-slate-300 hover:bg-slate-800 hover:border-slate-500 hover:text-white"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Stage 3 Core Row (if 3-stage) */}
            {config.stages.length >= 3 && (
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <div className="min-w-[160px]">
                  <div className="text-xs font-bold text-slate-100">Stage 3 Upper Core</div>
                  <div className="text-[11px] text-slate-400">Escape / kick stage</div>
                </div>
                <div className="flex flex-wrap items-center gap-2 flex-1 justify-start md:justify-end">
                  {[
                    {
                      value: "expendable" as RecoveryMode,
                      label: "Expendable",
                      tooltip: "Expendable: Stage 3 is expended into final orbit or heliocentric disposal.",
                    },
                    {
                      value: "downrange_landing_asds" as RecoveryMode,
                      label: "Orbital Re-entry (ASDS)",
                      tooltip: "Downrange ASDS Landing: High energy orbital recovery requiring atmospheric thermal protection.",
                    },
                    {
                      value: "return_to_launch_site_rtls" as RecoveryMode,
                      label: "Deorbit Return (RTLS)",
                      tooltip: "Return to Launch Site: Complete orbital deorbit burn for landing at launch pad.",
                    },
                  ].map((opt) => {
                    const isSelected = s3Mode === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        title={opt.tooltip}
                        onClick={() => updateStageRec(2, opt.value)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md border text-center transition shadow-sm whitespace-nowrap ${
                          isSelected
                            ? "border-amber-400 bg-amber-500/25 text-amber-200 ring-1 ring-amber-400"
                            : "border-slate-700 bg-slate-900/90 text-slate-300 hover:bg-slate-800 hover:border-slate-500 hover:text-white"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Payload Fairing Row */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="min-w-[160px]">
                <div className="text-xs font-bold text-slate-100">Payload Fairing</div>
                <div className="text-[11px] text-slate-400">Aerodynamic composite shell</div>
              </div>
              <div className="flex flex-wrap items-center gap-2 flex-1 justify-start md:justify-end">
                <button
                  type="button"
                  title="Expendable Fairing: Halves are jettisoned at stage separation and impact the ocean unrecovered. Zero recovery mass penalty."
                  onClick={() => onChangeConfig({ ...config, fairing_reusable: false })}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-md border text-center transition shadow-sm whitespace-nowrap ${
                    !config.fairing_reusable
                      ? "border-amber-400 bg-amber-500/25 text-amber-200 ring-1 ring-amber-400"
                      : "border-slate-700 bg-slate-900/90 text-slate-300 hover:bg-slate-800 hover:border-slate-500 hover:text-white"
                  }`}
                >
                  Expendable Shell
                </button>
                <button
                  type="button"
                  title="Reusable Fairing: Carbon-composite halves are equipped with cold-gas thrusters and steerable parafoils for soft ocean or ship catch, saving ~$6M per launch."
                  onClick={() => onChangeConfig({ ...config, fairing_reusable: true })}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-md border text-center transition shadow-sm whitespace-nowrap ${
                    config.fairing_reusable
                      ? "border-amber-400 bg-amber-500/25 text-amber-200 ring-1 ring-amber-400"
                      : "border-slate-700 bg-slate-900/90 text-slate-300 hover:bg-slate-800 hover:border-slate-500 hover:text-white"
                  }`}
                >
                  Steerable Parafoil &amp; Thrusters
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Optimizer Recommendation KPI Summary */}
      {recommended && report && (
        <div className="p-3 rounded-lg bg-slate-950/80 border border-cyan-700/60 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge badge-cyan">OPTIMAL FOR {report.planned_flights} FLIGHTS</span>
              <span className="text-sm font-bold text-slate-100">{recommended.label}</span>
              <span className="text-xs font-mono text-emerald-300">
                Break-Even: {recommended.breakeven_flights !== null ? `${recommended.breakeven_flights} launches` : "Never"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowTable((v) => !v)}
              title="Expand or collapse detailed strategy comparison table"
              className="btn-secondary text-xs px-2.5 py-1"
            >
              {showTable ? "Hide Trade Matrix" : "Show Trade Matrix"}
            </button>
          </div>

          {recommended.id === "expendable" ? (
            <div className="space-y-2">
              <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3 text-xs text-slate-300">
                <div className="font-semibold text-sky-200 mb-1">Optimal Baseline: All-Expendable Architecture</div>
                <p>
                  For this target payload mass of {config.payload_mass_kg.toLocaleString("en-US")} kg, allocating propellant for atmospheric deceleration and boostback burns would reduce orbital delivery capacity below target. An all-expendable baseline achieves the mission with minimum liftoff GLOW and lowest total campaign development expenditure.
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="p-2 rounded bg-slate-900/90 border border-slate-800">
                  <div className="text-[11px] uppercase text-slate-400">Baseline Flight Cost</div>
                  <div className="font-mono font-bold text-sm text-cyan-300">{fmtUsd(recommended.cost_per_flight_usd)}</div>
                  <div className="text-[11px] text-slate-400">Recurring per launch</div>
                </div>
                <div className="p-2 rounded bg-slate-900/90 border border-slate-800">
                  <div className="text-[11px] uppercase text-slate-400">Total Program DDT&amp;E</div>
                  <div className="font-mono font-bold text-sm text-amber-300">{fmtUsd(recommended.ddte_usd)}</div>
                  <div className="text-[11px] text-slate-400">Expendable baseline dev</div>
                </div>
                <div className="p-2 rounded bg-slate-900/90 border border-slate-800">
                  <div className="text-[11px] uppercase text-slate-400">Total Campaign Cost</div>
                  <div className="font-mono font-bold text-sm text-slate-100">{fmtUsd(recommended.total_campaign_cost_usd)}</div>
                  <div className="text-[11px] text-slate-400">Over {report.planned_flights} flights</div>
                </div>
                <div className="p-2 rounded bg-slate-900/90 border border-slate-800">
                  <div className="text-[11px] uppercase text-slate-400">Ascent Prop Fraction</div>
                  <div className="font-mono font-bold text-sm text-emerald-300">100.0%</div>
                  <div className="text-[11px] text-slate-400">0 kg recovery reserve</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              <div
                className="p-2 rounded bg-slate-900/90 border border-slate-800"
                title="Total program lifecycle cost difference across all planned launches compared to an all-expendable baseline."
              >
                <div className="text-[11px] uppercase text-slate-400">Net Program Savings</div>
                <div className={`font-mono font-bold text-sm ${recommended.net_campaign_savings_usd >= 0 ? "text-emerald-300" : "text-amber-300"}`}>
                  {recommended.net_campaign_savings_usd >= 0 ? "+" : "-"}{fmtUsd(Math.abs(recommended.net_campaign_savings_usd))}
                </div>
                <div className="text-[11px] text-slate-400">Over {report.planned_flights} flights (FY{currencyYear})</div>
              </div>
              <div
                className="p-2 rounded bg-slate-900/90 border border-slate-800"
                title="Additional upfront Design, Development, Test, and Evaluation (DDT&E) investment required to engineer landing gear, grid fins, and recovery software."
              >
                <div className="text-[11px] uppercase text-slate-400">Extra Dev Cost (DDT&amp;E)</div>
                <div className="font-mono font-bold text-sm text-amber-300">
                  +{fmtUsd(recommended.extra_ddte_usd)}
                </div>
                <div className="text-[11px] text-slate-400">Total DDT&amp;E: {fmtUsd(recommended.ddte_usd)}</div>
              </div>
              <div
                className="p-2 rounded bg-slate-900/90 border border-slate-800"
                title="Increase in vehicle liftoff mass (GLOW) necessary to deliver identical target payload to orbit while carrying extra recovery structural dry hardware and landing propellant reserves."
              >
                <div className="text-[11px] uppercase text-slate-400">Extra GLOW vs Expendable</div>
                <div className="font-mono font-bold text-sm text-slate-100">
                  +{formatValueWithUnit(recommended.delta_glow_kg, "mass", unitSystem, 0)}
                </div>
                <div className="text-[11px] text-slate-400">+{recommended.delta_glow_pct.toFixed(1)}% liftoff mass</div>
              </div>
              <div
                className="p-2 rounded bg-slate-900/90 border border-slate-800"
                title="Reduction in payload deliverable to orbit when holding vehicle GLOW constant at expendable size."
              >
                <div className="text-[11px] uppercase text-slate-400">Payload Penalty (Fixed GLOW)</div>
                <div className="font-mono font-bold text-sm text-rose-300">
                  -{formatValueWithUnit(recommended.payload_lost_kg, "mass", unitSystem, 0)}
                </div>
                <div className="text-[11px] text-slate-400">-{recommended.payload_lost_pct.toFixed(1)}% payload capacity</div>
              </div>
              <div
                className="p-2 rounded bg-slate-900/90 border border-slate-800"
                title="Structural and mechanical hardware added to the stage for recovery: deployable landing legs, aerodynamic titanium grid fins, RCS cold-gas thrusters, and thermal protection base heat shields."
              >
                <div className="text-[11px] uppercase text-slate-400">Recovery Dry HW Mass</div>
                <div className="font-mono font-bold text-sm text-slate-100">
                  {formatValueWithUnit(recommended.recovery_hardware_dry_kg, "mass", unitSystem, 0)}
                </div>
                <div className="text-[11px] text-slate-400">Legs + grid fins + TPS/chutes</div>
              </div>
              <div
                className="p-2 rounded bg-slate-900/90 border border-slate-800"
                title="Liquid propellant reserved in main tanks for atmospheric recovery burns: boostback burn, supersonic re-entry burn, and terminal landing burn."
              >
                <div className="text-[11px] uppercase text-slate-400">Landing Prop Reserve</div>
                <div className="font-mono font-bold text-sm text-cyan-300">
                  {formatValueWithUnit(recommended.recovery_propellant_reserve_kg, "mass", unitSystem, 0)}
                </div>
                <div className="text-[11px] text-slate-400">Boostback / entry / landing</div>
              </div>
            </div>
          )}

          {showTable && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
              onClick={() => setShowTable(false)}
            >
              <div
                className="panel-card w-full max-w-7xl max-h-[85vh] overflow-y-auto p-4 space-y-3"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">
                      Recovery Strategy Trade Matrix ({report.planned_flights} Flights, FY{currencyYear})
                    </h3>
                    <p className="text-xs text-slate-400">
                      Comparing break-even launch count, extra GLOW, recovery hardware, reserve propellant, and lifecycle cost.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowTable(false)}
                    title="Close recovery strategy trade matrix"
                    className="btn-secondary px-2.5 py-1 text-xs"
                  >
                    Close
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] uppercase text-slate-400">
                    <th className="py-1.5 pr-1.5">Strategy</th>
                    <th className="py-1.5 px-1.5">Elements</th>
                    <th className="py-1.5 px-1.5 text-right">Break-Even</th>
                    <th className="py-1.5 px-1.5 text-right">+GLOW vs Exp</th>
                    <th className="py-1.5 px-1.5 text-right">Rec HW+Prop</th>
                    <th className="py-1.5 px-1.5 text-right">Payload Lost</th>
                    <th className="py-1.5 px-1.5 text-right">+DDT&amp;E</th>
                    <th className="py-1.5 px-1.5 text-right">Flight Cost</th>
                    <th className="py-1.5 px-1.5 text-right">Refurb</th>
                    <th className="py-1.5 px-1.5 text-right">Total ({report.planned_flights}x)</th>
                    <th className="py-1.5 pl-1.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {report.candidates.map((cand) => {
                    const isRec = cand.id === report.recommended_id;
                    const isCurrent =
                      cand.booster_mode === bstMode &&
                      cand.s1_mode === s1Mode &&
                      cand.s2_mode === s2Mode &&
                      cand.fairing_reusable === config.fairing_reusable;
                    const activeEls = [
                      cand.booster_mode !== "expendable" ? `Bst:${formatRecoveryMode(cand.booster_mode).split(" ")[0]}` : null,
                      cand.s1_mode !== "expendable" ? `S1:${formatRecoveryMode(cand.s1_mode).split(" ")[0]}` : null,
                      cand.s2_mode !== "expendable" ? `S2:${formatRecoveryMode(cand.s2_mode).split(" ")[0]}` : null,
                      cand.s3_mode !== "expendable" ? `S3:${formatRecoveryMode(cand.s3_mode).split(" ")[0]}` : null,
                      cand.fairing_reusable ? "Fairing" : null,
                    ]
                      .filter(Boolean)
                      .join(", ") || "None (Expendable)";

                    return (
                      <tr
                        key={cand.id}
                        className={
                          isRec
                            ? "bg-emerald-950/35"
                            : isCurrent
                            ? "bg-cyan-950/30"
                            : "hover:bg-slate-900/60"
                        }
                      >
                        <td className="py-1.5 pr-1.5 font-semibold text-slate-100 whitespace-nowrap">
                          {cand.label}
                          {isRec && <span className="ml-1.5 badge badge-emerald">Best</span>}
                          {!cand.feasible && <span className="ml-1.5 badge badge-amber">Constraint</span>}
                        </td>
                        <td className="py-1.5 px-1.5 text-slate-300">{activeEls}</td>
                        <td className="py-1.5 px-1.5 text-right font-mono text-emerald-300 whitespace-nowrap">
                          {cand.breakeven_flights !== null ? `${cand.breakeven_flights} flt` : "--"}
                        </td>
                        <td className="py-1.5 px-1.5 text-right font-mono text-slate-200 whitespace-nowrap">
                          {cand.delta_glow_kg > 1
                            ? `+${formatValueWithUnit(cand.delta_glow_kg, "mass", unitSystem, 0)} (${cand.delta_glow_pct.toFixed(1)}%)`
                            : "Baseline"}
                        </td>
                        <td className="py-1.5 px-1.5 text-right font-mono text-slate-300 whitespace-nowrap">
                          {formatValueWithUnit(
                            cand.recovery_hardware_dry_kg + cand.recovery_propellant_reserve_kg,
                            "mass",
                            unitSystem,
                            0
                          )}
                        </td>
                        <td className="py-1.5 px-1.5 text-right font-mono text-rose-300 whitespace-nowrap">
                          {cand.payload_lost_kg > 1
                            ? `-${formatValueWithUnit(cand.payload_lost_kg, "mass", unitSystem, 0)} (${cand.payload_lost_pct.toFixed(1)}%)`
                            : "0"}
                        </td>
                        <td className="py-1.5 px-1.5 text-right font-mono text-amber-300 whitespace-nowrap">
                          {cand.extra_ddte_usd > 1 ? `+${fmtUsd(cand.extra_ddte_usd)}` : "Baseline"}
                        </td>
                        <td className="py-1.5 px-1.5 text-right font-mono text-cyan-300 whitespace-nowrap">
                          {fmtUsd(cand.cost_per_flight_usd)}
                        </td>
                        <td className="py-1.5 px-1.5 text-right font-mono text-slate-300 whitespace-nowrap">
                          {fmtUsd(cand.turnaround_refurb_usd)}
                        </td>
                        <td className="py-1.5 px-1.5 text-right font-mono font-semibold text-slate-100 whitespace-nowrap">
                          {fmtUsd(cand.total_campaign_cost_usd)}
                        </td>
                        <td className="py-1.5 pl-1.5 text-right">
                          <button
                            type="button"
                            onClick={() => applyCandidate(cand)}
                            title={`Apply ${cand.label} to active vehicle configuration`}
                            className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                              isCurrent
                                ? "bg-cyan-700 border-cyan-400 text-white"
                                : "bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800"
                            }`}
                          >
                            {isCurrent ? "Active" : "Apply"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
