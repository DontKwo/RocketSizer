import React, { useEffect, useMemo, useState } from "react";
import { validateHeritageModels } from "../../api/tauriClient";
import {
  BENCHMARK_HERITAGE_IDS,
  buildDesignJustificationMarkdown,
  generateDesignJustificationReport,
} from "../../config/reportGenerator";
import { adjustInflationUsd, convertFromSi, unitLabel, type UnitSystem } from "../../config/units";
import type { ProvenanceEngine } from "../../types/engine";
import type {
  HeritageValidationSummary,
  HeritageVehicleValidationEntry,
  StageSizingMetrics,
  VehicleConfiguration,
  VehicleSizingResult,
} from "../../types/sizing";
import type { ProvenanceVehicle } from "../../types/vehicle";

interface DesignJustificationReportProps {
  config: VehicleConfiguration;
  result: VehicleSizingResult;
  engines: ProvenanceEngine[];
  vehicles: ProvenanceVehicle[];
  unitSystem: UnitSystem;
  currencyYear: number;
}

type ValidationFilterMode =
  | "benchmark"
  | "calibration"
  | "holdout"
  | "category"
  | "operational";

interface SubsystemRowDef {
  label: string;
  emphasis?: boolean;
  getMassKg: (stage: StageSizingMetrics, marginFrac: number) => number;
}

function fmtMassVal(valKg: number, unitSystem: UnitSystem, digits = 0): string {
  const conv = convertFromSi(valKg, "mass", unitSystem);
  return conv.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtUsdShort(usd2026: number, currencyYear: number): string {
  const adj = adjustInflationUsd(usd2026, 2026, currencyYear);
  if (adj <= 0) return "-";
  if (adj >= 1e9) return `$${(adj / 1e9).toFixed(2)}B`;
  return `$${(adj / 1e6).toFixed(2)}M`;
}

function errClass(errPct: number): string {
  const abs = Math.abs(errPct);
  if (abs <= 12) return "text-emerald-300";
  if (abs <= 25) return "text-sky-300";
  if (abs <= 38) return "text-amber-300";
  return "text-rose-300";
}

function badgeClasses(tone: "emerald" | "sky" | "amber" | "rose"): string {
  if (tone === "emerald") return "border-emerald-700 bg-emerald-950/50 text-emerald-300";
  if (tone === "sky") return "border-sky-700 bg-sky-950/50 text-sky-300";
  if (tone === "amber") return "border-amber-700 bg-amber-950/40 text-amber-300";
  return "border-rose-700 bg-rose-950/50 text-rose-300";
}

export function DesignJustificationReport({
  config,
  result,
  engines,
  vehicles,
  unitSystem,
  currencyYear,
}: DesignJustificationReportProps): React.ReactElement {
  const [validation, setValidation] = useState<HeritageValidationSummary | null>(null);
  const [validationLoading, setValidationLoading] = useState<boolean>(false);
  const [filterMode, setFilterMode] = useState<ValidationFilterMode>("benchmark");
  const [copiedDeck, setCopiedDeck] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    setValidationLoading(true);
    validateHeritageModels()
      .then((res) => {
        if (!cancelled) setValidation(res);
      })
      .finally(() => {
        if (!cancelled) setValidationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const report = useMemo(
    () => generateDesignJustificationReport(config, result, engines, vehicles, unitSystem, currencyYear),
    [config, result, engines, vehicles, unitSystem, currencyYear]
  );

  const mUnit = unitLabel("mass", unitSystem);
  const engineMap = useMemo(() => new Map(engines.map((e) => [e.id.value, e])), [engines]);

  const subsystemRows: SubsystemRowDef[] = useMemo(
    () => [
      { label: "Oxidizer Tank Barrel", getMassKg: (s) => s.structural_breakdown?.ox_tank_barrel_mass_kg ?? 0 },
      { label: "Fuel Tank Barrel", getMassKg: (s) => s.structural_breakdown?.fuel_tank_barrel_mass_kg ?? 0 },
      { label: "Tank Domes & Common Bulkhead", getMassKg: (s) => s.structural_breakdown?.tank_domes_mass_kg ?? 0 },
      { label: "Anti-Slosh Baffles & Rings", getMassKg: (s) => s.structural_breakdown?.baffles_and_slosh_mass_kg ?? 0 },
      { label: "Forward Skirt Shell", getMassKg: (s) => s.structural_breakdown?.forward_skirt_mass_kg ?? 0 },
      { label: "Aft Skirt & Base Heatshield", getMassKg: (s) => s.structural_breakdown?.aft_skirt_and_base_shield_mass_kg ?? 0 },
      { label: "Intertank Structural Ring", getMassKg: (s) => s.structural_breakdown?.intertank_mass_kg ?? 0 },
      { label: "Interstage Adapter & Separation", getMassKg: (s) => s.structural_breakdown?.interstage_mass_kg ?? 0 },
      { label: "Thrust Structure & Puck", getMassKg: (s) => s.structural_breakdown?.thrust_structure_mass_kg ?? 0 },
      { label: "Feedlines, Downcomers & Valves", getMassKg: (s) => s.structural_breakdown?.plumbing_and_valves_mass_kg ?? 0 },
      { label: "Pressurization System (COPV/Auto)", getMassKg: (s) => s.structural_breakdown?.pressurization_system_mass_kg ?? 0 },
      { label: "Cryogenic SOFI / MLI Insulation", getMassKg: (s) => s.structural_breakdown?.cryo_insulation_mass_kg ?? 0 },
      { label: "TVC Actuators, RCS & Batteries", getMassKg: (s) => s.structural_breakdown?.tvc_and_rcs_mass_kg ?? 0 },
      { label: "Avionics & Wiring Harness", getMassKg: (s) => s.structural_breakdown?.avionics_and_wiring_mass_kg ?? 0 },
      { label: "Payload Adapter Fitting (PAF)", getMassKg: (s) => s.structural_breakdown?.payload_adapter_mass_kg ?? 0 },
      { label: "Fasteners, Flanges & Joint Bosses", getMassKg: (s) => s.structural_breakdown?.fasteners_and_joints_mass_kg ?? 0 },
      { label: "Solid Motor Casing & Nozzle", getMassKg: (s) => s.structural_breakdown?.solid_casing_and_nozzle_mass_kg ?? 0 },
      {
        label: "Structure-Only Subtotal (Unmargined)",
        emphasis: true,
        getMassKg: (s, mf) =>
          s.structural_breakdown?.predicted_structure_only_unmargined_kg ??
          s.structure_budget_kg / Math.max(1, 1 + mf),
      },
      {
        label: "Propulsion Engines Dry Mass",
        getMassKg: (s) => s.structural_breakdown?.engines_mass_kg ?? s.engines_mass_kg,
      },
      {
        label: "Recovery HW (Legs / Fins / TPS)",
        getMassKg: (s) => s.structural_breakdown?.recovery_hardware_kg ?? s.recovery_hardware_kg,
      },
      {
        label: "Strap-On Booster Inert Allocation",
        getMassKg: (s) => s.structural_breakdown?.strapon_inert_kg ?? s.strapon_inert_kg,
      },
      {
        label: "Stage Dry Total (Unmargined)",
        emphasis: true,
        getMassKg: (s, mf) =>
          s.structural_breakdown?.predicted_dry_unmargined_kg ?? s.inert_mass_kg / Math.max(1, 1 + mf),
      },
      {
        label: `Inert Mass Margin Reserve (+${(config.mass_margin_frac * 100).toFixed(1)}% MGA)`,
        getMassKg: (s, mf) =>
          s.structural_breakdown?.margin_reserve_kg ??
          s.inert_mass_kg - s.inert_mass_kg / Math.max(1, 1 + mf),
      },
      {
        label: "Stage Dry Total (Margined Flight Spec)",
        emphasis: true,
        getMassKg: (s) => s.structural_breakdown?.predicted_dry_margined_kg ?? s.inert_mass_kg,
      },
    ],
    [config.mass_margin_frac]
  );

  const filteredValidationEntries = useMemo((): HeritageVehicleValidationEntry[] => {
    if (!validation) return [];
    if (filterMode === "benchmark") {
      return validation.entries.filter((e) => BENCHMARK_HERITAGE_IDS.has(e.vehicle_id));
    }
    if (filterMode === "calibration") {
      return validation.entries.filter((e) => e.is_calibration_set);
    }
    if (filterMode === "holdout") {
      return validation.entries.filter((e) => !e.is_calibration_set && e.total_launches > 0);
    }
    if (filterMode === "category") {
      return validation.entries.filter((e) => e.category === report.category);
    }
    return validation.entries.filter((e) => e.total_launches > 0);
  }, [validation, filterMode, report.category]);

  const filteredMape = useMemo(() => {
    if (filteredValidationEntries.length === 0) {
      return { struct: 0, cost: 0, ddte: 0 };
    }
    const meanAbs = (vals: number[]): number =>
      vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    return {
      struct: meanAbs(filteredValidationEntries.map((e) => Math.abs(e.total_dry_error_pct))),
      cost: meanAbs(
        filteredValidationEntries
          .filter((e) => e.actual_launch_cost_adj_usd > 0)
          .map((e) => Math.abs(e.launch_cost_error_pct))
      ),
      ddte: meanAbs(
        filteredValidationEntries
          .filter((e) => e.actual_ddte_usd > 0)
          .map((e) => Math.abs(e.ddte_error_pct))
      ),
    };
  }, [filteredValidationEntries]);

  const handleDownloadReport = (): void => {
    const md = buildDesignJustificationMarkdown(config, result, engines, vehicles, unitSystem, currencyYear);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${config.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_feasibility_report.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyInputDeck = async (): Promise<void> => {
    const deck = {
      vehicle_configuration: config,
      sizing_metrics: {
        glow_kg: result.glow_kg,
        total_dry_mass_kg: result.total_dry_mass_kg,
        total_propellant_kg: result.total_propellant_kg,
        liftoff_thrust_sl_n: result.liftoff_thrust_sl_n,
        liftoff_tw0: result.liftoff_tw0,
        total_height_m: result.total_height_m,
        core_diameter_m: result.core_diameter_m,
        max_width_m: result.max_width_m,
        delivered_delta_v_m_s: result.delta_v_breakdown.total_delivered_dv_m_s,
        required_delta_v_m_s: result.delta_v_breakdown.total_required_dv_m_s,
        market_launch_price_usd: marketPriceUsd,
        ddte_usd: result.cost_breakdown.total_ddte_usd,
        uncertainty_p10_p50_p90: result.uncertainty,
      },
      provenance_metadata: {
        generated_by: "RocketSizer Conceptual Architecture Solver",
        fidelity_level: "Conceptual / Preliminary Trade-Study",
        model_assumptions: [
          "Barlow thin-wall + SP-8007 axial buckling structural synthesis",
          "2-DOF gravity turn trajectory integration with transonic drag divergence",
          "TRANSCOST 8.2 & NAFCOM Cost Estimating Relationships (FY2026 USD)",
          "AIAA S-020 Mass Growth Allowance contingency synthesis",
        ],
        exclusions: [
          "No full 3D Finite Element Analysis (FEA)",
          "No 6-DOF closed-loop trajectory guidance",
          "No solid motor grain regression geometry",
          "Not certified for flight hardware authority",
        ],
      },
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(deck, null, 2));
      setCopiedDeck(true);
      setTimeout(() => setCopiedDeck(false), 2500);
    } catch (err) {
      console.error("Clipboard copy failed:", err);
    }
  };

  const marketPriceUsd =
    result.cost_breakdown.predicted_market_launch_price_usd && result.cost_breakdown.predicted_market_launch_price_usd > 0
      ? result.cost_breakdown.predicted_market_launch_price_usd
      : result.cost_breakdown.reusable_flight_cost_usd * 1.35;

  return (
    <div className="space-y-4 mt-4">
      {/* Header + Export Action */}
      <div className="panel-card p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-2.5">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wide text-sky-300">
              Design Feasibility &amp; Heritage Validation Report
            </h3>
            <p className="text-xs text-slate-400">
              Automated engineering justification for {config.name} ({report.category}-Class) covering delta-V closure, propulsion physics,
              {report.massMargin.appliedMarginPct.toFixed(1)}% inert mass margin, 19-subsystem structural breakdown, and heritage validation.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded border px-2.5 py-1 text-xs font-semibold ${
                result.feasible
                  ? "border-emerald-700 bg-emerald-950/50 text-emerald-300"
                  : "border-rose-700 bg-rose-950/50 text-rose-300"
              }`}
            >
              {result.feasible ? "Feasible Design" : "Constraint Violations"}
            </span>
            <button
              type="button"
              onClick={handleCopyInputDeck}
              title="Copy complete machine-readable configuration and sizing metrics JSON to clipboard"
              className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
            >
              {copiedDeck ? "Copied Sizing Deck JSON!" : "Copy Input Deck (JSON)"}
            </button>
            <button
              type="button"
              onClick={handleDownloadReport}
              title="Download full Markdown engineering feasibility and heritage comparison report"
              className="btn-primary px-3 py-1.5 text-xs font-semibold"
            >
              Download Feasibility Report (.md)
            </button>
          </div>
        </div>

        {/* Dedicated Mass Margin (MGA) Highlight Callout */}
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <div className="rounded border border-slate-800 bg-slate-950/70 p-2.5">
            <div className="text-[11px] uppercase text-slate-400">Applied Inert Mass Margin</div>
            <div className="font-mono text-base font-bold text-emerald-300">
              {report.massMargin.appliedMarginPct.toFixed(1)}% MGA
            </div>
            <div className="text-[11px] text-slate-500">Preliminary design growth allowance</div>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/70 p-2.5">
            <div className="text-[11px] uppercase text-slate-400">Unmargined Dry Mass</div>
            <div className="font-mono text-base font-bold text-slate-100">
              {fmtMassVal(report.massMargin.unmarginedVehicleDryKg, unitSystem)} {mUnit}
            </div>
            <div className="text-[11px] text-slate-500">
              PMF {(report.massMargin.unmarginedVehiclePmf * 100).toFixed(2)}%
            </div>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/70 p-2.5">
            <div className="text-[11px] uppercase text-slate-400">MGA Reserve Buffer</div>
            <div className="font-mono text-base font-bold text-amber-300">
              +{fmtMassVal(report.massMargin.marginReserveKg, unitSystem)} {mUnit}
            </div>
            <div className="text-[11px] text-slate-500">Unallocated structural growth budget</div>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/70 p-2.5">
            <div className="text-[11px] uppercase text-slate-400">Margined Dry Mass</div>
            <div className="font-mono text-base font-bold text-sky-300">
              {fmtMassVal(report.massMargin.marginedVehicleDryKg, unitSystem)} {mUnit}
            </div>
            <div className="text-[11px] text-slate-500">
              PMF {(report.massMargin.marginedVehiclePmf * 100).toFixed(2)}%
            </div>
          </div>
        </div>

        {/* 5 Justification Prose Cards */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {report.sections.map((sec) => (
            <div key={sec.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-bold uppercase tracking-wide text-slate-100">{sec.title}</h4>
                <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${badgeClasses(sec.tone)}`}>
                  {sec.badge}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-slate-300">{sec.summary}</p>
              <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-400">
                {sec.bullets.map((b, bIdx) => (
                  <li key={bIdx}>{b}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Table 1: Bottom-Up 19-Subsystem Structural Mass Estimator */}
      <div className="panel-card p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wide text-sky-300">
              Table 1 - Bottom-Up 19-Subsystem Structural Mass Estimator ({mUnit})
            </h4>
            <p className="text-[11px] text-slate-400">
              Physics-coupled component weights from tapered hydrostatic hoop stress, Farrar wide-column skirt buckling, engine thrust/flow scaling, and applied MGA.
            </p>
          </div>
        </div>
        <div className="overflow-x-auto rounded border border-slate-800">
          <table className="w-full min-w-[680px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/90 text-[11px] uppercase text-slate-400">
                <th className="sticky-col-head px-3 py-2">Structural Subsystem / Mass Line</th>
                {result.stages.map((st) => (
                  <th key={st.stage_number} className="px-3 py-2 text-right">
                    Stage {st.stage_number} ({st.engine_name})
                  </th>
                ))}
                <th className="px-3 py-2 text-right">Fairing / PLF</th>
                <th className="px-3 py-2 text-right">Vehicle Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono text-slate-200">
              {subsystemRows.map((row) => {
                const isDryLine = row.label.startsWith("Stage Dry Total");
                const isMarginLine = row.label.startsWith("Inert Mass Margin");
                const fairingContrib = isDryLine ? result.fairing.mass_kg : 0;
                const stageSum = result.stages.reduce(
                  (acc, st) => acc + row.getMassKg(st, config.mass_margin_frac),
                  0
                );
                const total = stageSum + fairingContrib;
                return (
                  <tr
                    key={row.label}
                    className={
                      row.emphasis
                        ? "bg-slate-900/80 font-semibold text-sky-200"
                        : isMarginLine
                        ? "bg-amber-950/40 text-amber-200"
                        : "hover:bg-slate-800/40"
                    }
                  >
                    <td className="sticky-col-cell px-3 py-1.5 font-sans text-slate-200">{row.label}</td>
                    {result.stages.map((st) => (
                      <td key={st.stage_number} className="px-3 py-1.5 text-right">
                        {fmtMassVal(row.getMassKg(st, config.mass_margin_frac), unitSystem)}
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-right text-slate-400">
                      {fairingContrib > 0 ? fmtMassVal(fairingContrib, unitSystem) : "-"}
                    </td>
                    <td className="px-3 py-1.5 text-right font-semibold">{fmtMassVal(total, unitSystem)}</td>
                  </tr>
                );
              })}
              <tr className="bg-slate-950/50 text-slate-300">
                <td className="sticky-col-cell px-3 py-1.5 font-sans">Ox / Fuel Wall Gauge (mm)</td>
                {result.stages.map((st) => {
                  const oxMm = ((st.structural_breakdown?.ox_wall_thickness_m ?? st.tank_geometry.wall_thickness_m) * 1000).toFixed(2);
                  const fuMm = ((st.structural_breakdown?.fuel_wall_thickness_m ?? st.tank_geometry.wall_thickness_m) * 1000).toFixed(2);
                  return (
                    <td key={st.stage_number} className="px-3 py-1.5 text-right">
                      {oxMm} / {fuMm}
                    </td>
                  );
                })}
                <td className="px-3 py-1.5 text-right">-</td>
                <td className="px-3 py-1.5 text-right">-</td>
              </tr>
              <tr className="bg-slate-950/50 text-emerald-300">
                <td className="sticky-col-cell px-3 py-1.5 font-sans">Unmargined / Margined PMF</td>
                {result.stages.map((st, idx) => {
                  const ps = report.massMargin.perStage[idx];
                  const uPmf = ps ? (ps.unmarginedPmf * 100).toFixed(2) : "-";
                  const mPmf = ps ? (ps.marginedPmf * 100).toFixed(2) : "-";
                  return (
                    <td key={st.stage_number} className="px-3 py-1.5 text-right">
                      {uPmf}% / {mPmf}%
                    </td>
                  );
                })}
                <td className="px-3 py-1.5 text-right">-</td>
                <td className="px-3 py-1.5 text-right">
                  {(report.massMargin.unmarginedVehiclePmf * 100).toFixed(2)}% / {(report.massMargin.marginedVehiclePmf * 100).toFixed(2)}%
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Table 2: Direct Comparison Against Peer Heritage Vehicles */}
      <div className="panel-card p-3.5 space-y-2.5">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wide text-sky-300">
            Table 2 - Direct Comparison vs Matched Peer Heritage Rockets ({report.category}-Class)
          </h4>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">{report.heritageComparativeProse}</p>
        </div>
        <div className="overflow-x-auto rounded border border-slate-800">
          <table className="w-full min-w-[1100px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/90 text-[11px] uppercase text-slate-400">
                <th className="sticky-col-head px-3 py-2">Vehicle</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Config</th>
                <th className="px-3 py-2">S1 / S2 Engines</th>
                <th className="px-3 py-2 text-right">GLOW ({mUnit})</th>
                <th className="px-3 py-2 text-right">Payload LEO ({mUnit})</th>
                <th className="px-3 py-2 text-right">PL %</th>
                <th className="px-3 py-2 text-right">S1 Dry ({mUnit})</th>
                <th className="px-3 py-2 text-right">S2 Dry ({mUnit})</th>
                <th className="px-3 py-2 text-right">Total Dry ({mUnit})</th>
                <th className="px-3 py-2 text-right">T/W0</th>
                <th className="px-3 py-2 text-right">Price ({currencyYear})</th>
                <th className="px-3 py-2 text-right">$/kg</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono text-slate-200">
              <tr className="bg-sky-950/40 font-semibold text-sky-100">
                <td className="sticky-col-cell px-3 py-2 font-sans text-sky-300">
                  {config.name} (Current Design)
                </td>
                <td className="px-3 py-2 font-sans">{report.category}</td>
                <td className="px-3 py-2 font-sans">
                  {result.stages.length}S{(result.stages[0]?.strapon_count ?? 0) > 0 ? ` + ${result.stages[0].strapon_count}B` : ""}
                </td>
                <td className="px-3 py-2 font-sans">
                  {result.stages.map((s) => `${s.engine_count}x ${s.engine_name}`).join(" / ")}
                </td>
                <td className="px-3 py-2 text-right">{fmtMassVal(result.glow_kg, unitSystem)}</td>
                <td className="px-3 py-2 text-right">{fmtMassVal(result.payload_mass_kg, unitSystem)}</td>
                <td className="px-3 py-2 text-right">{(result.payload_fraction * 100).toFixed(2)}%</td>
                <td className="px-3 py-2 text-right">{fmtMassVal(result.stages[0]?.inert_mass_kg ?? 0, unitSystem)}</td>
                <td className="px-3 py-2 text-right">
                  {result.stages[1] ? fmtMassVal(result.stages[1].inert_mass_kg, unitSystem) : "-"}
                </td>
                <td className="px-3 py-2 text-right">{fmtMassVal(result.total_dry_mass_kg, unitSystem)}</td>
                <td className="px-3 py-2 text-right">{result.liftoff_tw0.toFixed(2)}</td>
                <td className="px-3 py-2 text-right text-emerald-300">{fmtUsdShort(marketPriceUsd, currencyYear)}</td>
                <td className="px-3 py-2 text-right">
                  ${Math.round(marketPriceUsd / Math.max(1, result.payload_mass_kg)).toLocaleString("en-US")}
                </td>
              </tr>
              {report.peerVehicles.map(({ vehicle: v, category: c, similarityScore }) => {
                const s1EngName = engineMap.get(v.s1_engine_id.value)?.name.value ?? v.s1_engine_id.value;
                const s2EngName = engineMap.get(v.s2_engine_id.value)?.name.value ?? v.s2_engine_id.value;
                return (
                  <tr key={v.id.value} className="hover:bg-slate-800/40">
                    <td className="sticky-col-cell px-3 py-2 font-sans">
                      <div className="font-semibold text-slate-100">{v.name.value}</div>
                      <div className="text-[11px] text-slate-400">
                        {v.variant.value} ({similarityScore}% match)
                      </div>
                    </td>
                    <td className="px-3 py-2 font-sans text-slate-300">{c}</td>
                    <td className="px-3 py-2 font-sans text-slate-300">
                      {v.stage_count.value}S{v.booster_count.value > 0 ? ` + ${v.booster_count.value}B` : ""}
                    </td>
                    <td className="px-3 py-2 font-sans text-slate-300">
                      {v.s1_engine_count.value}x {s1EngName}
                      {v.s2_prop_mass_kg.value > 0 ? ` / ${v.s2_engine_count.value}x ${s2EngName}` : ""}
                    </td>
                    <td className="px-3 py-2 text-right">{fmtMassVal(v.glow_kg.value, unitSystem)}</td>
                    <td className="px-3 py-2 text-right">{fmtMassVal(v.payload_leo_kg.value, unitSystem)}</td>
                    <td className="px-3 py-2 text-right">{(v.payload_fraction_leo.value * 100).toFixed(2)}%</td>
                    <td className="px-3 py-2 text-right">{fmtMassVal(v.s1_dry_mass_kg.value, unitSystem)}</td>
                    <td className="px-3 py-2 text-right">
                      {v.s2_dry_mass_kg.value > 0 ? fmtMassVal(v.s2_dry_mass_kg.value, unitSystem) : "-"}
                    </td>
                    <td className="px-3 py-2 text-right">{fmtMassVal(v.total_dry_mass_kg.value, unitSystem)}</td>
                    <td className="px-3 py-2 text-right">{v.liftoff_tw0.value.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{fmtUsdShort(v.launch_cost_adj_usd.value, currencyYear)}</td>
                    <td className="px-3 py-2 text-right">
                      ${Math.round(v.cost_per_kg_leo_usd.value).toLocaleString("en-US")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Table 3: In-App Heritage Validation Matrix */}
      <div className="panel-card p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wide text-sky-300">
              Table 3 - Heritage Fleet Structural &amp; Cost Model Validation Matrix
            </h4>
            <p className="text-[11px] text-slate-400">
              Live comparison of the bottom-up 19-subsystem structural estimator and TRANSCOST-derived cost CERs against flight-proven heritage vehicles.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ["benchmark", "16-Vehicle Benchmark Fleet"],
                ["calibration", "In-Sample Calibration Set"],
                ["holdout", "Independent Holdouts"],
                ["category", `${report.category}-Class Peers`],
                ["operational", "All Operational Vehicles"],
              ] as Array<[ValidationFilterMode, string]>
            ).map(([modeKey, label]) => (
              <button
                key={modeKey}
                type="button"
                onClick={() => setFilterMode(modeKey)}
                className={`rounded border px-2.5 py-1 text-xs font-medium ${
                  filterMode === modeKey
                    ? "border-sky-500 bg-sky-500/20 text-sky-200"
                    : "border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* MAPE Summary Badges */}
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-6">
          <div className="rounded border border-slate-800 bg-slate-950/70 p-2.5">
            <div className="text-[11px] text-slate-400">Calibration MAPE</div>
            <div className="font-mono text-base font-bold text-sky-300">
              {validation?.in_sample_structural_mape_pct ? `${validation.in_sample_structural_mape_pct.toFixed(2)}%` : "-"}
            </div>
            <div className="text-[11px] text-slate-500">In-sample tuned baseline</div>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/70 p-2.5">
            <div className="text-[11px] text-slate-400">Holdout MAPE</div>
            <div className="font-mono text-base font-bold text-emerald-300">
              {validation?.out_of_sample_structural_mape_pct ? `${validation.out_of_sample_structural_mape_pct.toFixed(2)}%` : "-"}
            </div>
            <div className="text-[11px] text-slate-500">Untuned holdout cases</div>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/70 p-2.5">
            <div className="text-[11px] text-slate-400">Dry Mass MdAPE</div>
            <div className="font-mono text-base font-bold text-emerald-300">
              {validation?.structural_mdape_pct ? `${validation.structural_mdape_pct.toFixed(2)}%` : "-"}
            </div>
            <div className="text-[11px] text-slate-500">Fleet median error</div>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/70 p-2.5">
            <div className="text-[11px] text-slate-400">Flight Cost MAPE</div>
            <div className="font-mono text-base font-bold text-emerald-300">{filteredMape.cost.toFixed(2)}%</div>
            <div className="text-[11px] text-slate-500">MdAPE: {validation?.cost_mdape_pct ? `${validation.cost_mdape_pct.toFixed(1)}%` : "-"}</div>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/70 p-2.5">
            <div className="text-[11px] text-slate-400">DDT&amp;E MAPE</div>
            <div className="font-mono text-base font-bold text-sky-300">{filteredMape.ddte.toFixed(2)}%</div>
            <div className="text-[11px] text-slate-500">MdAPE: {validation?.ddte_mdape_pct ? `${validation.ddte_mdape_pct.toFixed(1)}%` : "-"}</div>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/70 p-2.5">
            <div className="text-[11px] text-slate-400">90% Confidence Bounds</div>
            <div className="font-mono text-xs font-bold text-slate-200">
              {validation?.p10_structural_error_pct !== undefined
                ? `${validation.p10_structural_error_pct.toFixed(1)}% to +${validation.p90_structural_error_pct?.toFixed(1)}%`
                : "-"}
            </div>
            <div className="text-[11px] text-slate-500">P10 to P90 interval</div>
          </div>
        </div>

        {validationLoading ? (
          <div className="rounded border border-slate-800 bg-slate-950/60 p-4 text-xs text-slate-400">
            Computing heritage fleet structural and cost validation...
          </div>
        ) : filteredValidationEntries.length === 0 ? (
          <div className="rounded border border-slate-800 bg-slate-950/60 p-4 text-xs text-slate-400">
            Backend validation telemetry unavailable in standalone fallback mode. Run desktop app binary for full fleet validation.
          </div>
        ) : (
          <div className="max-h-96 overflow-auto rounded border border-slate-800">
            <table className="w-full min-w-[1100px] border-collapse text-left text-xs">
              <thead>
                <tr className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950 text-[11px] uppercase text-slate-400">
                  <th className="sticky-col-head px-3 py-2">Heritage Vehicle</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Class</th>
                  <th className="px-3 py-2 text-right">S1 Dry Act / Pred ({mUnit})</th>
                  <th className="px-3 py-2 text-right">S1 Err</th>
                  <th className="px-3 py-2 text-right">S2 Dry Act / Pred ({mUnit})</th>
                  <th className="px-3 py-2 text-right">Total Dry Act / Pred ({mUnit})</th>
                  <th className="px-3 py-2 text-right">Tot Err</th>
                  <th className="px-3 py-2 text-right">Flight Cost Act / Pred</th>
                  <th className="px-3 py-2 text-right">Cost Err</th>
                  <th className="px-3 py-2 text-right">DDT&amp;E Act / Pred</th>
                  <th className="px-3 py-2 text-right">DDT&amp;E Err</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 font-mono text-slate-200">
                {filteredValidationEntries.map((ev) => (
                  <tr key={ev.vehicle_id} className="hover:bg-slate-800/40">
                    <td className="sticky-col-cell px-3 py-1.5 font-sans font-semibold text-slate-100">
                      {ev.vehicle_name}
                    </td>
                    <td className="px-3 py-1.5 font-sans">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium border ${
                          ev.is_calibration_set
                            ? "border-sky-700/60 bg-sky-950/50 text-sky-300"
                            : "border-emerald-700/60 bg-emerald-950/50 text-emerald-300"
                        }`}
                      >
                        {ev.is_calibration_set ? "Calibration" : "Holdout"}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-sans text-slate-400">{ev.category}</td>
                    <td className="px-3 py-1.5 text-right">
                      {fmtMassVal(ev.actual_s1_dry_kg, unitSystem)} / {fmtMassVal(ev.predicted_s1_dry_kg, unitSystem)}
                    </td>
                    <td className={`px-3 py-1.5 text-right font-semibold ${errClass(ev.s1_dry_error_pct)}`}>
                      {ev.s1_dry_error_pct >= 0 ? "+" : ""}
                      {ev.s1_dry_error_pct.toFixed(1)}%
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {ev.actual_s2_dry_kg > 0
                        ? `${fmtMassVal(ev.actual_s2_dry_kg, unitSystem)} / ${fmtMassVal(ev.predicted_s2_dry_kg, unitSystem)}`
                        : "-"}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {fmtMassVal(ev.actual_total_dry_kg, unitSystem)} / {fmtMassVal(ev.predicted_total_dry_kg, unitSystem)}
                    </td>
                    <td className={`px-3 py-1.5 text-right font-semibold ${errClass(ev.total_dry_error_pct)}`}>
                      {ev.total_dry_error_pct >= 0 ? "+" : ""}
                      {ev.total_dry_error_pct.toFixed(1)}%
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {ev.actual_launch_cost_adj_usd > 0
                        ? `${fmtUsdShort(ev.actual_launch_cost_adj_usd, currencyYear)} / ${fmtUsdShort(ev.predicted_launch_cost_adj_usd, currencyYear)}`
                        : fmtUsdShort(ev.predicted_launch_cost_adj_usd, currencyYear)}
                    </td>
                    <td className={`px-3 py-1.5 text-right font-semibold ${ev.actual_launch_cost_adj_usd > 0 ? errClass(ev.launch_cost_error_pct) : "text-slate-500"}`}>
                      {ev.actual_launch_cost_adj_usd > 0
                        ? `${ev.launch_cost_error_pct >= 0 ? "+" : ""}${ev.launch_cost_error_pct.toFixed(1)}%`
                        : "-"}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {ev.actual_ddte_usd > 0
                        ? `${fmtUsdShort(ev.actual_ddte_usd, currencyYear)} / ${fmtUsdShort(ev.predicted_ddte_usd, currencyYear)}`
                        : fmtUsdShort(ev.predicted_ddte_usd, currencyYear)}
                    </td>
                    <td className={`px-3 py-1.5 text-right font-semibold ${ev.actual_ddte_usd > 0 ? errClass(ev.ddte_error_pct) : "text-slate-500"}`}>
                      {ev.actual_ddte_usd > 0
                        ? `${ev.ddte_error_pct >= 0 ? "+" : ""}${ev.ddte_error_pct.toFixed(1)}%`
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Table 4: Statistical Uncertainty Quantification & Confidence Intervals */}
      {result.uncertainty && (
        <div className="panel-card p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wide text-sky-300">
                Table 4 - Statistical Uncertainty Quantification &amp; Confidence Intervals
              </h4>
              <p className="text-[11px] text-slate-400">
                Propagated design distributions accounting for specific impulse variance, AIAA S-020 structural growth allowance, trajectory flight dispersions, and CER standard error.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded border border-slate-800">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950 text-[11px] uppercase text-slate-400">
                  <th className="px-3 py-2">Vehicle Performance Metric</th>
                  <th className="px-3 py-2 text-right">P10 (Optimistic)</th>
                  <th className="px-3 py-2 text-right">P50 (Nominal / Median)</th>
                  <th className="px-3 py-2 text-right">P90 (Design Guarantee)</th>
                  <th className="px-3 py-2">Unit</th>
                  <th className="px-3 py-2">Primary Uncertainty Driver</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 font-mono text-slate-200">
                <tr className="hover:bg-slate-800/40">
                  <td className="px-3 py-2 font-sans font-semibold text-slate-100">Gross Liftoff Weight (GLOW)</td>
                  <td className="px-3 py-2 text-right text-emerald-300">{fmtMassVal(result.uncertainty.glow.p10_optimistic, unitSystem)}</td>
                  <td className="px-3 py-2 text-right text-sky-300 font-bold">{fmtMassVal(result.uncertainty.glow.p50_median, unitSystem)}</td>
                  <td className="px-3 py-2 text-right text-amber-300">{fmtMassVal(result.uncertainty.glow.p90_conservative, unitSystem)}</td>
                  <td className="px-3 py-2 text-slate-400">{mUnit}</td>
                  <td className="px-3 py-2 font-sans text-slate-400">Upper stage dry growth allowance &amp; Isp shortfall</td>
                </tr>
                <tr className="hover:bg-slate-800/40">
                  <td className="px-3 py-2 font-sans font-semibold text-slate-100">Total Vehicle Dry Mass</td>
                  <td className="px-3 py-2 text-right text-emerald-300">{fmtMassVal(result.uncertainty.dry_mass.p10_optimistic, unitSystem)}</td>
                  <td className="px-3 py-2 text-right text-sky-300 font-bold">{fmtMassVal(result.uncertainty.dry_mass.p50_median, unitSystem)}</td>
                  <td className="px-3 py-2 text-right text-amber-300">{fmtMassVal(result.uncertainty.dry_mass.p90_conservative, unitSystem)}</td>
                  <td className="px-3 py-2 text-slate-400">{mUnit}</td>
                  <td className="px-3 py-2 font-sans text-slate-400">AIAA S-020 Mass Growth Allowance contingency (-5% to +15%)</td>
                </tr>
                <tr className="hover:bg-slate-800/40">
                  <td className="px-3 py-2 font-sans font-semibold text-slate-100">Commercial Market Launch Price</td>
                  <td className="px-3 py-2 text-right text-emerald-300">{fmtUsdShort(result.uncertainty.launch_price_usd.p10_optimistic, currencyYear)}</td>
                  <td className="px-3 py-2 text-right text-sky-300 font-bold">{fmtUsdShort(result.uncertainty.launch_price_usd.p50_median, currencyYear)}</td>
                  <td className="px-3 py-2 text-right text-amber-300">{fmtUsdShort(result.uncertainty.launch_price_usd.p90_conservative, currencyYear)}</td>
                  <td className="px-3 py-2 text-slate-400">USD</td>
                  <td className="px-3 py-2 font-sans text-slate-400">TRANSCOST learning curve slope &amp; flight cadence variance</td>
                </tr>
                <tr className="hover:bg-slate-800/40">
                  <td className="px-3 py-2 font-sans font-semibold text-slate-100">Program DDT&amp;E Development Cost</td>
                  <td className="px-3 py-2 text-right text-emerald-300">{fmtUsdShort(result.uncertainty.ddte_usd.p10_optimistic, currencyYear)}</td>
                  <td className="px-3 py-2 text-right text-sky-300 font-bold">{fmtUsdShort(result.uncertainty.ddte_usd.p50_median, currencyYear)}</td>
                  <td className="px-3 py-2 text-right text-amber-300">{fmtUsdShort(result.uncertainty.ddte_usd.p90_conservative, currencyYear)}</td>
                  <td className="px-3 py-2 text-slate-400">USD</td>
                  <td className="px-3 py-2 font-sans text-slate-400">First-time engine qualification &amp; schedule slip risk</td>
                </tr>
                <tr className="hover:bg-slate-800/40">
                  <td className="px-3 py-2 font-sans font-semibold text-slate-100">Total Delivered Delta-V</td>
                  <td className="px-3 py-2 text-right text-emerald-300">{result.uncertainty.delivered_delta_v_m_s.p10_optimistic.toFixed(0)}</td>
                  <td className="px-3 py-2 text-right text-sky-300 font-bold">{result.uncertainty.delivered_delta_v_m_s.p50_median.toFixed(0)}</td>
                  <td className="px-3 py-2 text-right text-amber-300">{result.uncertainty.delivered_delta_v_m_s.p90_conservative.toFixed(0)}</td>
                  <td className="px-3 py-2 text-slate-400">m/s</td>
                  <td className="px-3 py-2 font-sans text-slate-400">Engine vacuum specific impulse dispersion (±1.5%)</td>
                </tr>
                <tr className="hover:bg-slate-800/40">
                  <td className="px-3 py-2 font-sans font-semibold text-slate-100">Payload Insertion Capacity</td>
                  <td className="px-3 py-2 text-right text-emerald-300">{fmtMassVal(result.uncertainty.payload_capacity_kg.p10_optimistic, unitSystem)}</td>
                  <td className="px-3 py-2 text-right text-sky-300 font-bold">{fmtMassVal(result.uncertainty.payload_capacity_kg.p50_median, unitSystem)}</td>
                  <td className="px-3 py-2 text-right text-amber-300">{fmtMassVal(result.uncertainty.payload_capacity_kg.p90_conservative, unitSystem)}</td>
                  <td className="px-3 py-2 text-slate-400">{mUnit}</td>
                  <td className="px-3 py-2 font-sans text-slate-400">Guaranteed insertion under 90th percentile growth</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="rounded border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400 space-y-1.5">
            <div className="font-semibold text-slate-300">Model Uncertainty Assumptions &amp; Dispersion Bounds:</div>
            <ul className="list-disc pl-5 space-y-0.5 text-[11px] text-slate-400">
              {result.uncertainty.dispersion_assumptions.map((asm, idx) => (
                <li key={idx}>{asm}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Engineering Scope and Conceptual Boundary Notice */}
      <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-3.5 text-xs text-amber-200/90 space-y-1.5">
        <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-amber-300">
          <span>Engineering Fidelity Scope &amp; Conceptual Model Boundaries</span>
        </div>
        <p className="text-[11px] leading-relaxed text-amber-200/80">
          RocketSizer is preliminary conceptual architecture synthesis and trade-study software. Sizing utilizes closed-form Barlow pressure vessel mechanics, NASA SP-8007 cylinder buckling criteria, 2-DOF gravity-turn ascent integration, and calibrated TRANSCOST / NAFCOM Cost Estimating Relationships. Excludes 3D Finite Element Analysis (FEA), 6-DOF closed-loop guidance, and solid grain burn regression geometry. Not an authority for flight certification.
        </p>
      </div>
    </div>
  );
}
