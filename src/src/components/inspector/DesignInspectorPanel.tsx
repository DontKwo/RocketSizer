import React, { useMemo } from "react";
import {
  formatEngineCycle,
  formatFairingProfile,
  formatIdentifierLabel,
  formatPropellant,
  formatRecoveryMode,
  formatTankMaterial,
} from "../../config/formatters";
import { adjustInflationUsd, convertFromSi, unitLabel, type UnitSystem } from "../../config/units";
import type { ProvenanceEngine } from "../../types/engine";
import type { InspectorTarget } from "../../types/provenance";
import type { StageSizingMetrics, VehicleConfiguration, VehicleSizingResult } from "../../types/sizing";
import type { ProvenanceVehicle } from "../../types/vehicle";
import { FeasibilityBadge } from "../common/FeasibilityBadge";
import { DesignJustificationReport } from "./DesignJustificationReport";

interface DesignInspectorPanelProps {
  config: VehicleConfiguration;
  result: VehicleSizingResult;
  engines: ProvenanceEngine[];
  vehicles?: ProvenanceVehicle[];
  unitSystem: UnitSystem;
  currencyYear: number;
  rejectionBreakdown?: Record<string, number> | null;
  onOpenInSingleConfig?: () => void;
  onInspectProvenance?: (target: InspectorTarget) => void;
}

interface StageTableRow {
  label: string;
  getValue: (stage: StageSizingMetrics, idx: number) => string;
}

function fmtNum(val: number | null | undefined, digits = 0): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "-";
  if (Math.abs(val) >= 1000 && digits === 0) {
    return Math.round(val).toLocaleString("en-US");
  }
  return val.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtUsd(usd2026: number, targetYear: number): string {
  const adj = adjustInflationUsd(usd2026, 2026, targetYear);
  if (adj >= 1e9) return `$${(adj / 1e9).toFixed(2)}B`;
  return `$${(adj / 1e6).toFixed(2)}M`;
}

export function DesignInspectorPanel({
  config,
  result,
  engines,
  vehicles = [],
  unitSystem,
  currencyYear,
  rejectionBreakdown = null,
  onOpenInSingleConfig,
  onInspectProvenance,
}: DesignInspectorPanelProps): React.ReactElement {
  const mUnit = unitLabel("mass", unitSystem);
  const fUnit = unitLabel("force", unitSystem);
  const vUnit = unitLabel("velocity", unitSystem);
  const lUnit = unitLabel("length", unitSystem);
  const pUnit = unitLabel("pressure", unitSystem);
  const mfUnit = unitLabel("mass_flow", unitSystem);
  const volUnit = unitSystem === "imperial" ? "ft^3" : "m^3";
  const densUnit = unitSystem === "imperial" ? "lb/ft^3" : "kg/m^3";
  const costMassUnit = unitLabel("cost_per_mass", unitSystem);

  const volFactor = unitSystem === "imperial" ? 35.3146667 : 1.0;
  const densFactor = unitSystem === "imperial" ? 0.06242796 : 1.0;

  const engineMap = useMemo(() => {
    const map = new Map<string, ProvenanceEngine>();
    for (const eng of engines) map.set(eng.id.value, eng);
    for (const eng of config.custom_engines) map.set(eng.id.value, eng);
    return map;
  }, [engines, config.custom_engines]);

  const engineLookupNames = useMemo(() => {
    const map = new Map<string, string>();
    engineMap.forEach((eng, id) => map.set(id, eng.name.value));
    return map;
  }, [engineMap]);

  // Extract unique core + strap-on engines installed across all stages.
  const vehicleEngines = useMemo(() => {
    const list: Array<{ eng: ProvenanceEngine; role: string }> = [];
    const seen = new Set<string>();
    result.stages.forEach((stg, idx) => {
      const coreId = stg.engine_id || config.stages[idx]?.engine_id;
      if (coreId) {
        const core = engineMap.get(coreId);
        if (core && !seen.has(core.id.value)) {
          seen.add(core.id.value);
          list.push({ eng: core, role: `Stage ${stg.stage_number} Core` });
        } else if (core && seen.has(core.id.value)) {
          const item = list.find((it) => it.eng.id.value === core.id.value);
          if (item && !item.role.includes(`S${stg.stage_number}`)) {
            item.role = `${item.role}, S${stg.stage_number}`;
          }
        }
      }
      const strapId =
        stg.strapon_count > 0
          ? stg.strapon_engine_id ?? config.booster_engine_id
          : idx === 0 && config.booster_count > 0
            ? config.booster_engine_id
            : null;
      if (strapId) {
        const strap = engineMap.get(strapId);
        if (strap && !seen.has(strap.id.value)) {
          seen.add(strap.id.value);
          list.push({ eng: strap, role: "Strap-On Booster" });
        }
      }
    });
    return list;
  }, [result.stages, config.stages, config.booster_count, config.booster_engine_id, engineMap]);

  // First-order rocket-equation exchange ratios around active stage stack.
  const sensitivityRatios = useMemo(() => {
    const glow = Math.max(result.glow_kg, 1);
    const pay = Math.max(result.payload_mass_kg, 1);
    const totalDv = Math.max(result.delta_v_breakdown.total_delivered_dv_m_s, 1);
    const g0 = 9.80665;
    const meanIsp =
      result.stages.reduce(
        (acc, s) => acc + s.isp_sizing_s * (s.delta_v_delivered_m_s / totalDv),
        0
      ) || 320;
    const dvGrowthPerMs = (glow / (g0 * meanIsp)) * 0.92;
    const dvStepSi = unitSystem === "imperial" ? 30.48 : 100.0;
    const ispStepS = 10.0;
    const dGlowPerIspS = -(glow * (totalDv / (g0 * meanIsp * meanIsp))) * 0.95;

    return {
      glowPerPayloadUnit: glow / pay,
      glowPerDvStepDisp: convertFromSi(dvGrowthPerMs * dvStepSi, "mass", unitSystem),
      dvStepLabel: unitSystem === "imperial" ? "+100 ft/s" : "+100 m/s",
      glowPer10sIspDisp: convertFromSi(dGlowPerIspS * ispStepS, "mass", unitSystem),
      glowPer1PctMarginDisp: convertFromSi(glow * 0.032, "mass", unitSystem),
    };
  }, [result, unitSystem]);

  const stageSections: Array<{ title: string; rows: StageTableRow[] }> = useMemo(() => {
    const convM = (kg: number): string => fmtNum(convertFromSi(kg, "mass", unitSystem), 0);
    const convF = (n: number): string => fmtNum(convertFromSi(n, "force", unitSystem), 0);
    const convV = (ms: number): string => fmtNum(convertFromSi(ms, "velocity", unitSystem), 0);
    const convL = (m: number): string => fmtNum(convertFromSi(m, "length", unitSystem), 2);
    const totalDv = Math.max(result.delta_v_breakdown.total_delivered_dv_m_s, 1);

    return [
      {
        title: "Configuration & Physical Envelope",
        rows: [
          { label: "Core Engines", getValue: (s) => `${s.engine_count} x ${s.engine_name}` },
          {
            label: "Strap-On Boosters",
            getValue: (s) =>
              s.strapon_count > 0
                ? `${s.strapon_count} x ${s.strapon_engine_name ?? formatIdentifierLabel(s.strapon_engine_id ?? "", engineLookupNames)}`
                : "-",
          },
          { label: "Total Ignition Engines", getValue: (s) => `${s.engine_count + s.strapon_count}` },
          {
            label: "Propellant / Tank Material",
            getValue: (s, i) =>
              `${formatPropellant(s.propellant)} / ${formatTankMaterial(config.stages[i]?.tank_material)}`,
          },
          {
            label: "Recovery Mode",
            getValue: (_, i) => formatRecoveryMode(config.stages[i]?.recovery_mode),
          },
          {
            label: `Stage Diameter / Height (${lUnit})`,
            getValue: (s) =>
              `${convL(s.stage_diameter_m ?? result.core_diameter_m)} x ${convL(s.stage_height_m)}`,
          },
          {
            label: "Slenderness Ratio (L/D)",
            getValue: (s) =>
              fmtNum(
                s.slenderness_ld ?? s.stage_height_m / Math.max(s.stage_diameter_m ?? result.core_diameter_m, 0.2),
                2
              ),
          },
        ],
      },
      {
        title: `Mass Breakdown (${mUnit})`,
        rows: [
          { label: "m0 (GLOW / Stage Ignition)", getValue: (s) => convM(s.m0_kg) },
          { label: "Stage Total Mass", getValue: (s) => convM(s.stage_total_mass_kg) },
          { label: "Total Propellant", getValue: (s) => convM(s.propellant_mass_kg) },
          {
            label: "  Strap-On Solid Propellant",
            getValue: (s) => (s.strapon_propellant_kg > 0 ? convM(s.strapon_propellant_kg) : "-"),
          },
          {
            label: "  Core Liquid Propellant",
            getValue: (s) => convM(s.m_liquid_prop_kg ?? s.ascent_propellant_kg),
          },
          {
            label: "  Liquid Burned During Boost",
            getValue: (s) =>
              s.strapon_count > 0 && s.m_liquid_burned_boost_kg !== undefined
                ? convM(s.m_liquid_burned_boost_kg)
                : "-",
          },
          {
            label: "Recovery Reserve Propellant",
            getValue: (s) => (s.recovery_propellant_kg > 0 ? convM(s.recovery_propellant_kg) : "-"),
          },
          {
            label: `Inert Mass (w/ ${(config.mass_margin_frac * 100).toFixed(0)}% Margin)`,
            getValue: (s) => convM(s.inert_mass_kg),
          },
          {
            label: "Inert Mass (Unmargined)",
            getValue: (s) => convM(s.m_inert_unmargined_kg ?? s.inert_mass_kg / (1 + config.mass_margin_frac)),
          },
          { label: "  Core Engine Assembly", getValue: (s) => convM(s.engines_mass_kg) },
          {
            label: "  Strap-On Booster Inert",
            getValue: (s) => (s.strapon_inert_kg > 0 ? convM(s.strapon_inert_kg) : "-"),
          },
          {
            label: "  Tank, Interstage & Recovery",
            getValue: (s) => convM(s.structure_budget_kg + s.recovery_hardware_kg),
          },
          {
            label: "Core Burnout Mass",
            getValue: (s) => convM(s.m_core_burnout_kg ?? Math.max(s.m0_kg - s.propellant_mass_kg - s.strapon_inert_kg, 0)),
          },
          { label: "Propellant Fraction (PMF)", getValue: (s) => `${(s.propellant_mass_fraction * 100).toFixed(2)}%` },
          {
            label: "Structural Coefficient k",
            getValue: (s) => fmtNum(s.k_structural ?? s.inert_mass_kg / Math.max(s.propellant_mass_kg, 1), 4),
          },
          {
            label: "Max Theoretical MR (1 + 1/k)",
            getValue: (s) =>
              fmtNum(s.mr_max ?? 1 + s.propellant_mass_kg / Math.max(s.inert_mass_kg, 1), 2),
          },
        ],
      },
      {
        title: `Thrust (${fUnit}) & Thrust-to-Weight`,
        rows: [
          {
            label: "Core Thrust (SL @ S1 / Vac Upper)",
            getValue: (s, i) => convF(i === 0 ? s.thrust_core_sl_n ?? s.thrust_sl_n : s.thrust_core_vac_n ?? s.thrust_vac_n),
          },
          {
            label: "Strap-On Thrust (Peak SL)",
            getValue: (s) => (s.strapon_count > 0 ? convF(s.thrust_strapon_sl_n ?? 0) : "-"),
          },
          {
            label: "Total Thrust at Ignition",
            getValue: (s, i) => convF(i === 0 ? s.thrust_sl_n : s.thrust_vac_n),
          },
          { label: "T/W at Stage Ignition", getValue: (s) => fmtNum(s.tw0_ignition, 2) },
          {
            label: "T/W Before Booster Sep",
            getValue: (s) => (s.tw_before_booster_sep != null ? fmtNum(s.tw_before_booster_sep, 2) : "-"),
          },
          {
            label: "T/W After Booster Sep",
            getValue: (s) => (s.tw_after_booster_sep != null ? fmtNum(s.tw_after_booster_sep, 2) : "-"),
          },
          { label: "T/W at Core Burnout", getValue: (s) => fmtNum(s.tw_burnout, 2) },
        ],
      },
      {
        title: `Delta-V (${vUnit}) & Isp`,
        rows: [
          { label: "Required Delta-V", getValue: (s) => convV(s.delta_v_required_m_s) },
          { label: "Delivered Delta-V", getValue: (s) => convV(s.delta_v_delivered_m_s) },
          {
            label: "Delta-V Margin",
            getValue: (s) => convV(s.dv_margin_m_s ?? s.delta_v_delivered_m_s - s.delta_v_required_m_s),
          },
          {
            label: "Stage Split Fraction",
            getValue: (s) => `${((s.delta_v_delivered_m_s / totalDv) * 100).toFixed(1)}%`,
          },
          {
            label: "  Boost Phase Delta-V",
            getValue: (s) => (s.boost_phase_dv_m_s != null ? convV(s.boost_phase_dv_m_s) : "-"),
          },
          {
            label: "  Core-Only Phase Delta-V",
            getValue: (s) => (s.core_only_dv_m_s != null ? convV(s.core_only_dv_m_s) : "-"),
          },
          {
            label: "Sizing Isp (s)",
            getValue: (s) => `${s.isp_sizing_s.toFixed(1)} s`,
          },
          {
            label: "Boost Phase Eff Isp (s)",
            getValue: (s) => (s.boost_eff_isp_s != null ? `${s.boost_eff_isp_s.toFixed(1)} s` : "-"),
          },
          { label: "Achieved Mass Ratio (MR)", getValue: (s) => fmtNum(s.mass_ratio, 3) },
        ],
      },
      {
        title: "Burn Timing & Axial Acceleration",
        rows: [
          {
            label: "Strap-On Burn Time (s)",
            getValue: (s) => (s.strapon_burn_time_s != null && s.strapon_burn_time_s > 0 ? `${s.strapon_burn_time_s.toFixed(1)} s` : "-"),
          },
          { label: "Core Liquid Burn Time (s)", getValue: (s) => `${s.burn_time_s.toFixed(1)} s` },
          {
            label: "Core Burn Margin After Sep (s)",
            getValue: (s) => (s.core_burn_margin_s != null ? `${s.core_burn_margin_s.toFixed(1)} s` : "-"),
          },
          {
            label: "g @ Boost End (Unmargined / Margined)",
            getValue: (s) =>
              s.accel_boost_end_unmargined_g != null
                ? `${s.accel_boost_end_unmargined_g.toFixed(2)} / ${(s.accel_boost_end_margined_g ?? s.accel_boost_end_unmargined_g).toFixed(2)} g`
                : "-",
          },
          {
            label: "g @ Core Burnout (Min-Thr / Peak)",
            getValue: (s) =>
              `${(s.accel_core_burnout_unmargined_g ?? s.max_accel_g).toFixed(2)} / ${(s.accel_core_burnout_margined_g ?? s.max_accel_g).toFixed(2)} g`,
          },
        ],
      },
      {
        title: "Propellant Tank Envelope & Mixture",
        rows: [
          { label: "Mixture Ratio (O/F)", getValue: (s) => fmtNum(s.of_ratio, 2) },
          { label: `Oxidizer Mass (${mUnit})`, getValue: (s) => (s.ox_mass_kg != null ? convM(s.ox_mass_kg) : "-") },
          { label: `Fuel Mass (${mUnit})`, getValue: (s) => (s.fuel_mass_kg != null ? convM(s.fuel_mass_kg) : "-") },
          { label: `Oxidizer Volume (${volUnit})`, getValue: (s) => (s.ox_volume_m3 != null ? fmtNum(s.ox_volume_m3 * volFactor, 0) : "-") },
          { label: `Fuel Volume (${volUnit})`, getValue: (s) => (s.fuel_volume_m3 != null ? fmtNum(s.fuel_volume_m3 * volFactor, 0) : "-") },
          { label: `Bulk Prop Density (${densUnit})`, getValue: (s) => (s.bulk_density_kg_m3 != null ? fmtNum(s.bulk_density_kg_m3 * densFactor, 1) : "-") },
        ],
      },
    ];
  }, [unitSystem, mUnit, fUnit, vUnit, lUnit, volUnit, densUnit, volFactor, densFactor, result.delta_v_breakdown.total_delivered_dv_m_s, result.core_diameter_m, config, engineLookupNames]);

  const rejectionRows = useMemo(() => {
    if (!rejectionBreakdown) return [];
    const entries = Object.entries(rejectionBreakdown).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((sum, [, cnt]) => sum + cnt, 0);
    return entries.map(([reason, count]) => ({
      reason,
      count,
      pct: total > 0 ? (count / total) * 100 : 0,
    }));
  }, [rejectionBreakdown]);

  const splitFracs =
    result.stages
      .map(
        (s) =>
          `${((s.delta_v_delivered_m_s / Math.max(result.delta_v_breakdown.total_delivered_dv_m_s, 1)) * 100).toFixed(0)}%`
      )
      .join(" / ");

  return (
    <div className="space-y-4">
      {/* Top Vehicle Summary Banner */}
      <div className="panel-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wide text-sky-300">
              Vehicle Engineering Inspection: {config.name}
            </h3>
            <p className="text-xs text-slate-400">
              {result.stages.length}-Stage Stack | {formatFairingProfile(config.fairing_profile)} Fairing | Inert Margin {(config.mass_margin_frac * 100).toFixed(0)}% | Cost Basis {currencyYear} USD
            </p>
          </div>
          <div className="flex items-center gap-2">
            <FeasibilityBadge
              feasible={result.feasible}
              label={result.feasible ? "FEASIBLE" : `${result.violation_messages.length} VIOLATION(S)`}
              result={result}
              config={config}
              rejectionSummary={rejectionBreakdown ?? undefined}
              unitSystem={unitSystem}
            />
            {onOpenInSingleConfig && (
              <button
                id="inspector.open_single_config"
                type="button"
                title="Load this inspected design into Single Config Evaluator for manual editing and trajectory analysis."
                onClick={onOpenInSingleConfig}
                className="btn-primary px-3 py-1.5 text-xs"
              >
                Open in Single Config Evaluator
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
            <div className="text-xs text-slate-400">GLOW</div>
            <div className="font-mono text-base font-bold text-sky-300">
              {fmtNum(convertFromSi(result.glow_kg, "mass", unitSystem), 0)} {mUnit}
            </div>
            <div className="font-mono text-xs text-slate-400">
              Dry: {fmtNum(convertFromSi(result.total_dry_mass_kg, "mass", unitSystem), 0)} {mUnit}
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
            <div className="text-xs text-slate-400">Payload &amp; Fraction</div>
            <div className="font-mono text-base font-bold text-emerald-300">
              {fmtNum(convertFromSi(result.payload_mass_kg, "mass", unitSystem), 0)} {mUnit}
            </div>
            <div className="font-mono text-xs text-slate-400">
              {(result.payload_fraction * 100).toFixed(2)}% of GLOW
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
            <div className="text-xs text-slate-400">Delta-V &amp; Splits</div>
            <div className="font-mono text-base font-bold text-slate-100">
              {fmtNum(convertFromSi(result.delta_v_breakdown.total_delivered_dv_m_s, "velocity", unitSystem), 0)} {vUnit}
            </div>
            <div className="font-mono text-xs text-slate-400">
              Req {fmtNum(convertFromSi(result.delta_v_breakdown.total_required_dv_m_s, "velocity", unitSystem), 0)} ({splitFracs})
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
            <div className="text-xs text-slate-400">Envelope &amp; Liftoff</div>
            <div className="font-mono text-base font-bold text-slate-100">
              {fmtNum(convertFromSi(result.total_height_m, "length", unitSystem), 1)} {lUnit} H
            </div>
            <div className="font-mono text-xs text-slate-400">
              Dia {fmtNum(convertFromSi(result.core_diameter_m, "length", unitSystem), 1)} {lUnit} | T/W0 {result.liftoff_tw0.toFixed(2)}
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
            <div className="text-xs text-slate-400">Cost ({currencyYear} USD)</div>
            <div className="font-mono text-base font-bold text-amber-300">
              {fmtUsd(result.cost_breakdown.reusable_flight_cost_usd, currencyYear)}
            </div>
            <div className="font-mono text-xs text-slate-400">
              Exp {fmtUsd(result.cost_breakdown.expendable_flight_cost_usd, currencyYear)} | ${fmtNum(convertFromSi(adjustInflationUsd(result.cost_breakdown.cost_per_kg_payload_usd, 2026, currencyYear), "cost_per_mass", unitSystem), 0)} {costMassUnit}
            </div>
          </div>
        </div>

        <div className="mt-2.5 rounded border border-slate-800 bg-slate-950/50 px-3 py-1.5 font-mono text-xs text-slate-300">
          Delta-V Budget = Orbital {fmtNum(convertFromSi(result.delta_v_breakdown.orbit_velocity_m_s, "velocity", unitSystem), 0)} + Gravity {fmtNum(convertFromSi(result.delta_v_breakdown.gravity_loss_m_s, "velocity", unitSystem), 0)} + Drag {fmtNum(convertFromSi(result.delta_v_breakdown.aero_drag_loss_m_s, "velocity", unitSystem), 0)} + Steering {fmtNum(convertFromSi(result.delta_v_breakdown.steering_loss_m_s, "velocity", unitSystem), 0)} - Rot Assist {fmtNum(convertFromSi(result.delta_v_breakdown.earth_rotation_assist_m_s, "velocity", unitSystem), 0)} {vUnit}
        </div>
      </div>

      {result.violation_messages.length > 0 && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 p-3 text-xs text-rose-200">
          <div className="mb-1 font-semibold text-rose-300">Active Constraint Violations:</div>
          <ul className="list-disc pl-4">
            {result.violation_messages.map((v, idx) => (
              <li key={idx}>{v}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Side-by-Side Stage Comparison Table */}
      <div className="panel-card overflow-hidden">
        <div className="border-b border-slate-800 px-4 py-2.5">
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-200">
            Stage-by-Stage Engineering Breakdown
          </h4>
        </div>
        <div className="overflow-x-auto p-3">
          <table className="w-full min-w-[680px] border-collapse text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-slate-700 text-sky-300">
                <th className="py-1.5 pr-4">Parameter</th>
                {result.stages.map((s) => (
                  <th key={s.stage_number} className="px-3 py-1.5 text-right">
                    STAGE {s.stage_number}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stageSections.map((sec) => (
                <React.Fragment key={sec.title}>
                  <tr className="bg-slate-800/50">
                    <td
                      colSpan={result.stages.length + 1}
                      className="border-y border-slate-700/80 px-2 py-1.5 font-sans text-xs font-bold uppercase tracking-wide text-amber-300"
                    >
                      {sec.title}
                    </td>
                  </tr>
                  {sec.rows.map((row) => (
                    <tr key={row.label} className="border-b border-slate-800/60 hover:bg-slate-800/40">
                      <td className="py-1.5 pr-4 text-slate-300">{row.label}</td>
                      {result.stages.map((stg, sIdx) => (
                        <td key={stg.stage_number} className="px-3 py-1.5 text-right text-slate-100">
                          {row.getValue(stg, sIdx)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Side-by-Side Engines & Boosters Table */}
      <div className="panel-card overflow-hidden">
        <div className="border-b border-slate-800 px-4 py-2.5">
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-200">
            Installed Engines &amp; Strap-On Boosters
          </h4>
        </div>
        <div className="overflow-x-auto p-3">
          <table className="w-full min-w-[680px] border-collapse text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-slate-700 text-sky-300">
                <th className="py-1.5 pr-4">Engine Spec</th>
                {vehicleEngines.map(({ eng }) => (
                  <th key={eng.id.value} className="px-3 py-1.5 text-right">
                    {eng.name.value}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-800/60">
                <td className="py-1.5 pr-4 text-slate-300">Vehicle Role</td>
                {vehicleEngines.map(({ eng, role }) => (
                  <td key={eng.id.value} className="px-3 py-1.5 text-right text-amber-300">{role}</td>
                ))}
              </tr>
              <tr className="border-b border-slate-800/60">
                <td className="py-1.5 pr-4 text-slate-300">Type / Propellant</td>
                {vehicleEngines.map(({ eng }) => (
                  <td key={eng.id.value} className="px-3 py-1.5 text-right text-slate-100">
                    {eng.propulsion_type.value === "solid" ? "Solid" : "Liquid"} ({formatPropellant(eng.propellant.value)})
                  </td>
                ))}
              </tr>
              <tr className="border-b border-slate-800/60">
                <td className="py-1.5 pr-4 text-slate-300">Power Cycle</td>
                {vehicleEngines.map(({ eng }) => (
                  <td key={eng.id.value} className="px-3 py-1.5 text-right text-slate-100">
                    {formatEngineCycle(eng.cycle.value)}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-slate-800/60">
                <td className="py-1.5 pr-4 text-slate-300">Thrust SL ({fUnit})</td>
                {vehicleEngines.map(({ eng }) => (
                  <td key={eng.id.value} className="px-3 py-1.5 text-right text-slate-100">
                    {fmtNum(convertFromSi(eng.thrust_sl_n.value, "force", unitSystem), 0)}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-slate-800/60">
                <td className="py-1.5 pr-4 text-slate-300">Thrust Vac ({fUnit})</td>
                {vehicleEngines.map(({ eng }) => (
                  <td key={eng.id.value} className="px-3 py-1.5 text-right text-slate-100">
                    {fmtNum(convertFromSi(eng.thrust_vac_n.value, "force", unitSystem), 0)}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-slate-800/60">
                <td className="py-1.5 pr-4 text-slate-300">Min Throttle %</td>
                {vehicleEngines.map(({ eng }) => {
                  const pct = eng.min_throttle_pct.value > 1 ? eng.min_throttle_pct.value : eng.min_throttle_pct.value * 100;
                  return (
                    <td key={eng.id.value} className="px-3 py-1.5 text-right text-slate-100">
                      {pct.toFixed(0)}%
                    </td>
                  );
                })}
              </tr>
              <tr className="border-b border-slate-800/60">
                <td className="py-1.5 pr-4 text-slate-300">Min Thrust SL / Vac ({fUnit})</td>
                {vehicleEngines.map(({ eng }) => {
                  const frac = eng.min_throttle_pct.value > 1 ? eng.min_throttle_pct.value / 100 : eng.min_throttle_pct.value;
                  return (
                    <td key={eng.id.value} className="px-3 py-1.5 text-right text-slate-100">
                      {fmtNum(convertFromSi(eng.thrust_sl_n.value * frac, "force", unitSystem), 0)} / {fmtNum(convertFromSi(eng.thrust_vac_n.value * frac, "force", unitSystem), 0)}
                    </td>
                  );
                })}
              </tr>
              <tr className="border-b border-slate-800/60">
                <td className="py-1.5 pr-4 text-slate-300">Isp SL / Vac (s)</td>
                {vehicleEngines.map(({ eng }) => (
                  <td key={eng.id.value} className="px-3 py-1.5 text-right text-sky-300">
                    {eng.isp_sl_s.value.toFixed(1)} / {eng.isp_vac_s.value.toFixed(1)}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-slate-800/60">
                <td className="py-1.5 pr-4 text-slate-300">Chamber Pressure ({pUnit})</td>
                {vehicleEngines.map(({ eng }) => (
                  <td key={eng.id.value} className="px-3 py-1.5 text-right text-slate-100">
                    {fmtNum(convertFromSi(eng.chamber_pressure_bar.value * 1e5, "pressure", unitSystem), 0)}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-slate-800/60">
                <td className="py-1.5 pr-4 text-slate-300">Expansion Ratio / O/F</td>
                {vehicleEngines.map(({ eng }) => (
                  <td key={eng.id.value} className="px-3 py-1.5 text-right text-slate-100">
                    {eng.expansion_ratio.value.toFixed(1)} : 1 / {eng.oxidizer_fuel_ratio.value.toFixed(2)}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-slate-800/60">
                <td className="py-1.5 pr-4 text-slate-300">Mass Flow mdot ({mfUnit})</td>
                {vehicleEngines.map(({ eng }) => (
                  <td key={eng.id.value} className="px-3 py-1.5 text-right text-slate-100">
                    {fmtNum(convertFromSi(eng.mass_flow_rate_kg_s.value, "mass_flow", unitSystem), 1)}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-slate-800/60">
                <td className="py-1.5 pr-4 text-slate-300">Inert / Dry Mass ({mUnit})</td>
                {vehicleEngines.map(({ eng }) => (
                  <td key={eng.id.value} className="px-3 py-1.5 text-right text-slate-100">
                    {fmtNum(convertFromSi(eng.dry_mass_kg.value, "mass", unitSystem), 0)}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-slate-800/60">
                <td className="py-1.5 pr-4 text-slate-300">Nozzle Dia ({lUnit}) / TVC</td>
                {vehicleEngines.map(({ eng }) => (
                  <td key={eng.id.value} className="px-3 py-1.5 text-right text-slate-100">
                    {fmtNum(convertFromSi(eng.nozzle_diameter_m.value, "length", unitSystem), 2)} / {eng.tvc_gimbal_range_deg.value.toFixed(1)} deg
                  </td>
                ))}
              </tr>
              <tr className="border-b border-slate-800/60">
                <td className="py-1.5 pr-4 text-slate-300">Unit Cost ({currencyYear} USD)</td>
                {vehicleEngines.map(({ eng }) => (
                  <td key={eng.id.value} className="px-3 py-1.5 text-right text-emerald-300">
                    {onInspectProvenance ? (
                      <button
                        type="button"
                        title={`Inspect source citations and basis year for ${eng.name.value} unit cost.`}
                        onClick={() =>
                          onInspectProvenance({
                            entityName: eng.name.value,
                            fieldLabel: "Unit Cost",
                            fieldKey: "unit_cost_usd",
                            provenance: eng.unit_cost_usd,
                          })
                        }
                        className="underline decoration-dotted hover:text-sky-300"
                      >
                        {fmtUsd(eng.unit_cost_usd.value, currencyYear)}
                      </button>
                    ) : (
                      fmtUsd(eng.unit_cost_usd.value, currencyYear)
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Exchange Ratios & Optional Optimization Rejection Breakdown */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="panel-card p-3.5">
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-200">
            Design Sensitivity Exchange Ratios
          </h4>
          <div className="grid grid-cols-2 gap-2 font-mono text-xs">
            <div className="rounded border border-slate-800 bg-slate-950/60 p-2.5">
              <div className="text-slate-400">Payload Gear Ratio</div>
              <div className="text-sm font-bold text-sky-300">
                {sensitivityRatios.glowPerPayloadUnit.toFixed(1)} {mUnit} GLOW / {mUnit} Pay
              </div>
            </div>
            <div className="rounded border border-slate-800 bg-slate-950/60 p-2.5">
              <div className="text-slate-400">Delta-V Exchange ({sensitivityRatios.dvStepLabel})</div>
              <div className="text-sm font-bold text-amber-300">
                +{fmtNum(sensitivityRatios.glowPerDvStepDisp, 0)} {mUnit} GLOW
              </div>
            </div>
            <div className="rounded border border-slate-800 bg-slate-950/60 p-2.5">
              <div className="text-slate-400">Isp Exchange (+10 s Mean)</div>
              <div className="text-sm font-bold text-emerald-300">
                {fmtNum(sensitivityRatios.glowPer10sIspDisp, 0)} {mUnit} GLOW
              </div>
            </div>
            <div className="rounded border border-slate-800 bg-slate-950/60 p-2.5">
              <div className="text-slate-400">Structural / Inert Margin (+1%)</div>
              <div className="text-sm font-bold text-rose-300">
                +{fmtNum(sensitivityRatios.glowPer1PctMarginDisp, 0)} {mUnit} GLOW
              </div>
            </div>
          </div>
        </div>

        {rejectionRows.length > 0 && (
          <div className="panel-card p-3.5">
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-200">
              Sweep Rejection Breakdown (Why Candidates Were Discarded)
            </h4>
            <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1 font-mono text-xs">
              {rejectionRows.map((item) => (
                <div key={item.reason} className="space-y-0.5">
                  <div className="flex justify-between text-slate-300">
                    <span>{item.reason}</span>
                    <span>
                      {item.count.toLocaleString("en-US")} ({item.pct.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded bg-slate-800">
                    <div
                      className="h-full bg-sky-500"
                      style={{ width: `${Math.min(100, Math.max(2, item.pct))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <DesignJustificationReport
        config={config}
        result={result}
        engines={engines}
        vehicles={vehicles}
        unitSystem={unitSystem}
        currencyYear={currencyYear}
      />
    </div>
  );
}
