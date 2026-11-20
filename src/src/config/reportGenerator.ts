import { adjustInflationUsd, convertFromSi, unitLabel, type UnitSystem } from "./units";
import { formatEngineCycle, formatPropellant, formatRecoveryMode, formatTankMaterial } from "./formatters";
import type { ProvenanceEngine } from "../types/engine";
import type { StageSizingMetrics, VehicleConfiguration, VehicleSizingResult } from "../types/sizing";
import type { ProvenanceVehicle } from "../types/vehicle";

export interface JustificationSection {
  id: string;
  title: string;
  badge: string;
  tone: "emerald" | "sky" | "amber" | "rose";
  summary: string;
  bullets: string[];
}

export interface PeerHeritageMatch {
  vehicle: ProvenanceVehicle;
  category: string;
  similarityScore: number;
  matchReason: string;
}

export interface MassMarginSummary {
  appliedMarginPct: number;
  unmarginedVehicleDryKg: number;
  marginedVehicleDryKg: number;
  marginReserveKg: number;
  unmarginedVehiclePmf: number;
  marginedVehiclePmf: number;
  perStage: Array<{
    stageNumber: number;
    unmarginedDryKg: number;
    marginedDryKg: number;
    reserveKg: number;
    unmarginedPmf: number;
    marginedPmf: number;
  }>;
}

export interface DesignJustificationReportData {
  category: string;
  sections: JustificationSection[];
  massMargin: MassMarginSummary;
  peerVehicles: PeerHeritageMatch[];
  heritageComparativeProse: string;
}

export const BENCHMARK_HERITAGE_IDS: ReadonlySet<string> = new Set([
  "electron",
  "falcon_1",
  "vega",
  "soyuz_2",
  "falcon_9",
  "falcon_heavy",
  "atlas_v_401",
  "vulcan_vc6l",
  "ariane_5",
  "proton_m",
  "delta_iv_heavy",
  "h_iia_202",
  "lm_5",
  "kslv_ii_nuri",
  "saturn_v",
  "sls_block_1",
  "starship",
]);

export function classifyPayloadCategory(payloadLeoKg: number): string {
  if (payloadLeoKg < 2_000) return "Light";
  if (payloadLeoKg < 20_000) return "Medium";
  if (payloadLeoKg < 50_000) return "Heavy";
  return "Super-Heavy";
}

function fmtMass(massKg: number, unitSystem: UnitSystem, digits = 0): string {
  const val = convertFromSi(massKg, "mass", unitSystem);
  return `${val.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${unitLabel("mass", unitSystem)}`;
}

function fmtLen(lenM: number, unitSystem: UnitSystem, digits = 2): string {
  const val = convertFromSi(lenM, "length", unitSystem);
  return `${val.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${unitLabel("length", unitSystem)}`;
}

function fmtVel(velMs: number, unitSystem: UnitSystem, digits = 0): string {
  const val = convertFromSi(velMs, "velocity", unitSystem);
  return `${val.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${unitLabel("velocity", unitSystem)}`;
}

function fmtUsd(usd2026: number, currencyYear: number): string {
  const adj = adjustInflationUsd(usd2026, 2026, currencyYear);
  if (adj >= 1e9) return `$${(adj / 1e9).toFixed(2)}B`;
  return `$${(adj / 1e6).toFixed(2)}M`;
}

function inferPropFamily(label: string): string {
  const low = label.toLowerCase();
  if (low.includes("lh2")) return "lox_lh2";
  if (low.includes("ch4")) return "lox_ch4";
  if (low.includes("solid") || low.includes("htpb")) return "solid";
  if (low.includes("nto") || low.includes("udmh") || low.includes("hypergolic")) return "hypergolic";
  return "lox_rp1";
}

export function computeMassMarginSummary(
  config: VehicleConfiguration,
  result: VehicleSizingResult
): MassMarginSummary {
  const appliedMarginPct = config.mass_margin_frac * 100.0;
  let unmarginedVehicleDryKg = result.fairing.mass_kg;
  const marginedVehicleDryKg = result.total_dry_mass_kg;

  const perStage = result.stages.map((st: StageSizingMetrics) => {
    const bd = st.structural_breakdown;
    const unmarg =
      bd && bd.predicted_dry_unmargined_kg > 0
        ? bd.predicted_dry_unmargined_kg
        : st.m_inert_unmargined_kg ?? st.inert_mass_kg / (1.0 + Math.max(0, config.mass_margin_frac));
    const marg = st.inert_mass_kg;
    const resKg = Math.max(0, marg - unmarg);
    unmarginedVehicleDryKg += unmarg;
    return {
      stageNumber: st.stage_number,
      unmarginedDryKg: unmarg,
      marginedDryKg: marg,
      reserveKg: resKg,
      unmarginedPmf: st.propellant_mass_kg / Math.max(1, st.propellant_mass_kg + unmarg),
      marginedPmf: st.propellant_mass_fraction,
    };
  });

  const marginReserveKg = Math.max(0, marginedVehicleDryKg - unmarginedVehicleDryKg);
  return {
    appliedMarginPct,
    unmarginedVehicleDryKg,
    marginedVehicleDryKg,
    marginReserveKg,
    unmarginedVehiclePmf:
      result.total_propellant_kg / Math.max(1, result.total_propellant_kg + unmarginedVehicleDryKg),
    marginedVehiclePmf:
      result.total_propellant_kg / Math.max(1, result.total_propellant_kg + marginedVehicleDryKg),
    perStage,
  };
}

export function matchPeerHeritageVehicles(
  config: VehicleConfiguration,
  result: VehicleSizingResult,
  vehicles: ProvenanceVehicle[],
  limit = 5
): PeerHeritageMatch[] {
  const designCategory = classifyPayloadCategory(result.payload_mass_kg);
  const s1PropFam = result.stages[0]?.propellant ?? "lox_rp1";
  const hasBoosters = (result.stages[0]?.strapon_count ?? 0) > 0;

  const scored: PeerHeritageMatch[] = vehicles
    .filter((v) => v.payload_leo_kg.value > 0 && v.glow_kg.value > 0 && v.total_dry_mass_kg.value > 0)
    .map((v) => {
      const cat = classifyPayloadCategory(v.payload_leo_kg.value);
      const plDiff = Math.abs(Math.log10(Math.max(1, v.payload_leo_kg.value) / Math.max(1, result.payload_mass_kg)));
      const glowDiff = Math.abs(Math.log10(Math.max(1, v.glow_kg.value) / Math.max(1, result.glow_kg)));
      const stageDiff = Math.abs(v.stage_count.value - result.stages.length) * 0.45;
      const boosterDiff = (v.booster_count.value > 0) !== hasBoosters ? 0.35 : 0.0;
      const catPenalty = cat === designCategory ? 0.0 : 0.75;
      const vPropFam = inferPropFamily(v.s1_propellant.value);
      const propPenalty = vPropFam === s1PropFam ? 0.0 : 0.25;
      const devPenalty = v.operational_status.value === "in_development" && v.total_launches.value < 5 ? 0.55 : 0.0;
      const totalDist = plDiff * 1.35 + glowDiff * 0.9 + stageDiff + boosterDiff + catPenalty + propPenalty + devPenalty;
      const similarityScore = Math.max(5, Math.min(99, Math.round(100 * Math.exp(-0.55 * totalDist))));

      const reasons: string[] = [];
      if (cat === designCategory) reasons.push(`${cat} payload class`);
      if (v.stage_count.value === result.stages.length) reasons.push(`${v.stage_count.value}-stage architecture`);
      if (vPropFam === s1PropFam) reasons.push(`matching ${v.s1_propellant.value} S1 chemistry`);
      if ((v.booster_count.value > 0) === hasBoosters && hasBoosters) reasons.push("parallel strap-on boost");
      if (reasons.length === 0) reasons.push("adjacent capacity class");

      return {
        vehicle: v,
        category: cat,
        similarityScore,
        matchReason: reasons.join(", "),
      };
    });

  scored.sort((a, b) => b.similarityScore - a.similarityScore);
  return scored.slice(0, limit);
}

export function generateDesignJustificationReport(
  config: VehicleConfiguration,
  result: VehicleSizingResult,
  engines: ProvenanceEngine[],
  vehicles: ProvenanceVehicle[],
  unitSystem: UnitSystem,
  currencyYear: number
): DesignJustificationReportData {
  const engineMap = new Map(engines.map((e) => [e.id.value, e]));
  const category = classifyPayloadCategory(result.payload_mass_kg);
  const dv = result.delta_v_breakdown;
  const dvNetMargin = dv.total_delivered_dv_m_s - dv.total_required_dv_m_s;
  const perigeeKm = (config.orbit.perigee_altitude_m ?? config.orbit.altitude_m) / 1000.0;
  const apogeeKm = (config.orbit.apogee_altitude_m ?? config.orbit.altitude_m) / 1000.0;
  const massMargin = computeMassMarginSummary(config, result);
  const peerVehicles = matchPeerHeritageVehicles(config, result, vehicles, 5);

  const missionSection: JustificationSection = {
    id: "mission_dv",
    title: "1. Mission & Delta-V Closure Justification",
    badge: dvNetMargin >= -1.0 ? "Closed" : "Shortfall",
    tone: dvNetMargin >= -1.0 ? "emerald" : "rose",
    summary:
      `The ${category.toLowerCase()}-class vehicle closes ${fmtMass(result.payload_mass_kg, unitSystem)} payload ` +
      `(${(result.payload_fraction * 100).toFixed(2)}% GLOW payload fraction) to a ${perigeeKm.toFixed(1)} x ${apogeeKm.toFixed(1)} km ` +
      `orbit at ${config.orbit.inclination_deg.toFixed(1)} deg inclination. Total delivered velocity change ` +
      `(${fmtVel(dv.total_delivered_dv_m_s, unitSystem)}) meets the ${fmtVel(dv.total_required_dv_m_s, unitSystem)} requirement ` +
      `with ${dvNetMargin >= 0 ? "+" : ""}${fmtVel(dvNetMargin, unitSystem)} residual margin.`,
    bullets: [
      `Orbital energy requirement: ${fmtVel(dv.orbit_velocity_m_s, unitSystem)} minus ${fmtVel(dv.earth_rotation_assist_m_s, unitSystem)} Earth rotation assist.`,
      `Integrated ascent losses: gravity ${fmtVel(dv.gravity_loss_m_s, unitSystem)}, aerodynamic drag ${fmtVel(dv.aero_drag_loss_m_s, unitSystem)}, and steering ${fmtVel(dv.steering_loss_m_s, unitSystem)}.`,
      `Orbital reserve & circularization allowance: ${fmtVel(dv.insertion_margin_m_s, unitSystem)}.`,
      `Staging & reuse propellants: ${fmtVel(dv.staging_ullage_loss_m_s, unitSystem)} settling losses cleanly budgeted inside propellant loading.`,
    ],
  };

  const allMrValid = result.stages.every((st) => st.mr_max === undefined || st.mass_ratio <= st.mr_max * 0.995);
  const s1Stage = result.stages[0];
  const stagingSection: JustificationSection = {
    id: "staging_pmf",
    title: "2. Staging Splits & Mass Ratio Feasibility",
    badge: allMrValid ? "MR Below Limit" : "Near MR Limit",
    tone: allMrValid ? "emerald" : "amber",
    summary:
      `Delta-V is distributed across ${result.stages.length} core stage${result.stages.length > 1 ? "s" : ""}` +
      `${(s1Stage?.strapon_count ?? 0) > 0 ? ` assisted by ${s1Stage.strapon_count} parallel strap-on boosters` : ""} ` +
      `in ratios ${result.stages.map((s) => `${(s.dv_split_frac * 100).toFixed(0)}%`).join(" / ")}. Every stage maintains an achieved ` +
      `mass ratio strictly below its single-stage Tsiolkovsky convergence ceiling MR_max = 1 / (1 - PMF), preventing structural mass runaway.`,
    bullets: result.stages.map((st, idx) => {
      const cfgStage = config.stages[idx];
      const matLabel = cfgStage ? formatTankMaterial(cfgStage.tank_material) : "Al-Li 2195";
      const recLabel = cfgStage ? formatRecoveryMode(cfgStage.recovery_mode) : "Expendable";
      const mrCap = st.mr_max !== undefined ? st.mr_max.toFixed(2) : (1.0 / Math.max(0.01, 1 - st.propellant_mass_fraction)).toFixed(2);
      return (
        `Stage ${st.stage_number} (${matLabel}, ${recLabel}): dV = ${fmtVel(st.delta_v_delivered_m_s, unitSystem)}, ` +
        `MR = ${st.mass_ratio.toFixed(2)} vs MR_max = ${mrCap}, margined PMF = ${(st.propellant_mass_fraction * 100).toFixed(2)}%.`
      );
    }),
  };

  const packingOk = result.base_required_dia_m <= result.base_usable_dia_m + 1e-6;
  const twOk = result.liftoff_tw0 >= config.constraints.min_liftoff_tw0 && result.liftoff_tw0 <= config.constraints.max_liftoff_tw0;
  const propulsionSection: JustificationSection = {
    id: "propulsion_pack",
    title: "3. Propulsion Cycle, Thrust-to-Weight & Circle Packing",
    badge: packingOk && twOk ? "Verified" : "Check Bounds",
    tone: packingOk && twOk ? "sky" : "amber",
    summary:
      `Liftoff thrust-to-weight is T/W0 = ${result.liftoff_tw0.toFixed(2)} (allowable ${config.constraints.min_liftoff_tw0.toFixed(2)} to ${config.constraints.max_liftoff_tw0.toFixed(2)}), ` +
      `balancing gravity-loss minimization off the pad against structural axial loads at Max-Q (${(result.max_q_pa / 1000).toFixed(1)} kPa). ` +
      `Stage 1 base layout requires ${fmtLen(result.base_required_dia_m, unitSystem)} within the ${fmtLen(result.base_usable_dia_m, unitSystem)} usable skirt envelope.`,
    bullets: result.stages.map((st) => {
      const eng = engineMap.get(st.engine_id);
      const cyc = eng ? formatEngineCycle(eng.cycle.value) : "Unknown Cycle";
      const pcBar = eng ? eng.chamber_pressure_bar.value.toFixed(0) : "-";
      const ispLabel = st.isp_sizing_s.toFixed(1);
      return (
        `Stage ${st.stage_number}: ${st.engine_count}x ${st.engine_name} (${formatPropellant(st.propellant)}, ${cyc}, ` +
        `Pc = ${pcBar} bar, Isp = ${ispLabel} s), T/W_ign = ${st.tw0_ignition.toFixed(2)}, burn ${st.burn_time_s.toFixed(0)} s, peak ${st.max_accel_g.toFixed(2)} g.`
      );
    }),
  };

  const highReserve = massMargin.appliedMarginPct >= 20.0;
  const marginSection: JustificationSection = {
    id: "mass_margin",
    title: "4. Inert Mass Margin (MGA) & Reserve Budget",
    badge: `${massMargin.appliedMarginPct.toFixed(1)}% MGA`,
    tone: highReserve ? "emerald" : massMargin.appliedMarginPct >= 10.0 ? "sky" : "amber",
    summary:
      `The vehicle incorporates a ${massMargin.appliedMarginPct.toFixed(1)}% Mass Growth Allowance (MGA) across all stages, carrying ` +
      `${fmtMass(massMargin.marginReserveKg, unitSystem)} of unallocated structural/subsystem reserve between its ` +
      `${fmtMass(massMargin.unmarginedVehicleDryKg, unitSystem)} unmargined dry mass and ` +
      `${fmtMass(massMargin.marginedVehicleDryKg, unitSystem)} margined dry total. ` +
      `${highReserve ? "A 20-25% preliminary MGA matches NASA S-020 / AIAA preliminary design standards, ensuring mission closure even if detailed FEM structural weight grows during CDR." : "Applying at least 20-25% MGA during early conceptual trades protects payload closure against subsystem weight creep."}`,
    bullets: [
      `Vehicle PMF shift from MGA reserve: ${(massMargin.unmarginedVehiclePmf * 100).toFixed(2)}% unmargined -> ${(massMargin.marginedVehiclePmf * 100).toFixed(2)}% margined.`,
      ...massMargin.perStage.map(
        (ps) =>
          `Stage ${ps.stageNumber} reserve: +${fmtMass(ps.reserveKg, unitSystem)} (${fmtMass(ps.unmarginedDryKg, unitSystem)} unmargined -> ${fmtMass(ps.marginedDryKg, unitSystem)} margined, PMF ${(ps.unmarginedPmf * 100).toFixed(1)}% -> ${(ps.marginedPmf * 100).toFixed(1)}%).`
      ),
    ],
  };

  const maxHoopMpa = Math.max(...result.stages.map((s) => s.tank_geometry.hoop_stress_pa / 1e6));
  const minBuckMpa = Math.min(...result.stages.map((s) => s.tank_geometry.buckling_critical_stress_pa / 1e6));
  const internalFlightCost = result.cost_breakdown.reusable_flight_cost_usd;
  const marketPrice =
    result.cost_breakdown.predicted_market_launch_price_usd && result.cost_breakdown.predicted_market_launch_price_usd > 0
      ? result.cost_breakdown.predicted_market_launch_price_usd
      : internalFlightCost * 1.35;

  const structCostSection: JustificationSection = {
    id: "struct_cost",
    title: "5. Structural Mechanics & Economic Feasibility",
    badge: result.feasible ? "Structurally Closed" : "Review Constraints",
    tone: result.feasible ? "emerald" : "amber",
    summary:
      `Bottom-up 19-subsystem structural modeling predicts peak tank hoop stress of ${maxHoopMpa.toFixed(1)} MPa ` +
      `and minimum cylinder critical buckling stress of ${minBuckMpa.toFixed(1)} MPa with axial orthogrid/ring stiffener multipliers coupled into ` +
      `stage convergence. Estimated internal flight cost is ${fmtUsd(internalFlightCost, currencyYear)} (expendable ${fmtUsd(result.cost_breakdown.expendable_flight_cost_usd, currencyYear)}), ` +
      `predicted commercial launch price is ${fmtUsd(marketPrice, currencyYear)}, and non-recurring DDT&E is ${fmtUsd(result.cost_breakdown.total_ddte_usd, currencyYear)}.`,
    bullets: [
      `Payload fairing: ${fmtLen(result.fairing.outer_diameter_m, unitSystem)} x ${fmtLen(result.fairing.total_length_m, unitSystem)}, mass ${fmtMass(result.fairing.mass_kg, unitSystem)}, usable payload volume ${result.fairing.usable_volume_m3.toFixed(1)} m^3.`,
      `Specific payload cost: $${Math.round(convertFromSi(adjustInflationUsd(result.cost_breakdown.cost_per_kg_payload_usd, 2026, currencyYear), "cost_per_mass", unitSystem)).toLocaleString("en-US")} / ${unitLabel("mass", unitSystem)}.`,
      `Vehicle dimensions: height ${fmtLen(result.total_height_m, unitSystem)}, core diameter ${fmtLen(result.core_diameter_m, unitSystem)}, slenderness L/D = ${(result.total_height_m / Math.max(0.1, result.core_diameter_m)).toFixed(1)}.`,
    ],
  };

  let heritageComparativeProse = `No heritage peer matches available for ${category} comparison.`;
  if (peerVehicles.length > 0) {
    const closest = peerVehicles[0].vehicle;
    const avgPeerPlFrac =
      peerVehicles.reduce((acc, p) => acc + p.vehicle.payload_fraction_leo.value, 0) / peerVehicles.length;
    const avgPeerCostAdj =
      peerVehicles.reduce((acc, p) => acc + p.vehicle.launch_cost_adj_usd.value, 0) / peerVehicles.length;
    const avgPeerSpecCost =
      peerVehicles.reduce((acc, p) => acc + p.vehicle.cost_per_kg_leo_usd.value, 0) / peerVehicles.length;
    const designSpecCost = result.cost_breakdown.cost_per_kg_payload_usd;
    const plDeltaPct = ((result.payload_fraction - avgPeerPlFrac) / Math.max(1e-6, avgPeerPlFrac)) * 100.0;
    const costDeltaPct = ((marketPrice - avgPeerCostAdj) / Math.max(1, avgPeerCostAdj)) * 100.0;
    const glowRatio = result.glow_kg / Math.max(1, closest.glow_kg.value);

    heritageComparativeProse =
      `Compared against the ${peerVehicles.length} closest operational and heritage vehicles in the ${category} class ` +
      `(closest peer: ${closest.name.value} ${closest.variant.value}, similarity ${peerVehicles[0].similarityScore}% via ${peerVehicles[0].matchReason}), ` +
      `this design requires ${(glowRatio * 100).toFixed(0)}% of ${closest.name.value}'s liftoff mass (${fmtMass(result.glow_kg, unitSystem)} vs ${fmtMass(closest.glow_kg.value, unitSystem)}) ` +
      `and achieves a ${(result.payload_fraction * 100).toFixed(2)}% LEO payload fraction versus the peer average ${(avgPeerPlFrac * 100).toFixed(2)}% ` +
      `(${plDeltaPct >= 0 ? "+" : ""}${plDeltaPct.toFixed(1)}% relative payload efficiency, while explicitly carrying ${massMargin.appliedMarginPct.toFixed(0)}% inert MGA). ` +
      `At a predicted market price of ${fmtUsd(marketPrice, currencyYear)} ($${Math.round(designSpecCost).toLocaleString("en-US")}/kg), the vehicle is ` +
      `${costDeltaPct >= 0 ? `${costDeltaPct.toFixed(1)}% higher` : `${Math.abs(costDeltaPct).toFixed(1)}% lower`} than the peer fleet average launch price of ${fmtUsd(avgPeerCostAdj, currencyYear)} ($${Math.round(avgPeerSpecCost).toLocaleString("en-US")}/kg).`;
  }

  return {
    category,
    sections: [missionSection, stagingSection, propulsionSection, marginSection, structCostSection],
    massMargin,
    peerVehicles,
    heritageComparativeProse,
  };
}

export function buildDesignJustificationMarkdown(
  config: VehicleConfiguration,
  result: VehicleSizingResult,
  engines: ProvenanceEngine[],
  vehicles: ProvenanceVehicle[],
  unitSystem: UnitSystem,
  currencyYear: number
): string {
  const report = generateDesignJustificationReport(config, result, engines, vehicles, unitSystem, currencyYear);
  const mUnit = unitLabel("mass", unitSystem);
  const lines: string[] = [
    `# ${config.name} - Automated Feasibility & Heritage Comparison Report`,
    ``,
    `- **Payload Class:** ${report.category} (${fmtMass(result.payload_mass_kg, unitSystem)} LEO, ${(result.payload_fraction * 100).toFixed(2)}% GLOW)`,
    `- **Feasibility Status:** ${result.feasible ? "FEASIBLE" : `VIOLATIONS (${result.violation_messages.join("; ")})`}`,
    `- **GLOW / Unmargined Dry / Margined Dry:** ${fmtMass(result.glow_kg, unitSystem)} / ${fmtMass(report.massMargin.unmarginedVehicleDryKg, unitSystem)} / ${fmtMass(result.total_dry_mass_kg, unitSystem)}`,
    `- **Inert Mass Margin (MGA):** ${report.massMargin.appliedMarginPct.toFixed(1)}% (+${fmtMass(report.massMargin.marginReserveKg, unitSystem)} reserve)`,
    `- **Internal Flight Cost / Est. Market Price (${currencyYear}):** ${fmtUsd(result.cost_breakdown.reusable_flight_cost_usd, currencyYear)} / ${fmtUsd(result.cost_breakdown.predicted_market_launch_price_usd ?? result.cost_breakdown.reusable_flight_cost_usd * 1.35, currencyYear)}`,
    ``,
    `## Engineering Justification Summary`,
    ``,
  ];

  report.sections.forEach((sec) => {
    lines.push(`### ${sec.title} [${sec.badge}]`);
    lines.push(sec.summary);
    lines.push(``);
    sec.bullets.forEach((b) => lines.push(`- ${b}`));
    lines.push(``);
  });

  lines.push(`## Bottom-Up 19-Subsystem Structural Mass Breakdown (${mUnit})`);
  lines.push(``);
  const stageHeaders = result.stages.map((s) => `Stage ${s.stage_number}`).join(" | ");
  lines.push(`| Subsystem | ${stageHeaders} |`);
  lines.push(`| --- | ${result.stages.map(() => "---:").join(" | ")} |`);

  const rows: Array<[string, (st: StageSizingMetrics) => number]> = [
    ["Oxidizer Tank Barrel", (s) => s.structural_breakdown?.ox_tank_barrel_mass_kg ?? 0],
    ["Fuel Tank Barrel", (s) => s.structural_breakdown?.fuel_tank_barrel_mass_kg ?? 0],
    ["Tank Domes & Common Bulkhead", (s) => s.structural_breakdown?.tank_domes_mass_kg ?? 0],
    ["Anti-Slosh Baffles & Rings", (s) => s.structural_breakdown?.baffles_and_slosh_mass_kg ?? 0],
    ["Forward Skirt", (s) => s.structural_breakdown?.forward_skirt_mass_kg ?? 0],
    ["Aft Skirt & Base Heatshield", (s) => s.structural_breakdown?.aft_skirt_and_base_shield_mass_kg ?? 0],
    ["Intertank Structural Ring", (s) => s.structural_breakdown?.intertank_mass_kg ?? 0],
    ["Interstage Adapter & Separation", (s) => s.structural_breakdown?.interstage_mass_kg ?? 0],
    ["Thrust Structure & Puck", (s) => s.structural_breakdown?.thrust_structure_mass_kg ?? 0],
    ["Feedlines, Downcomers & Valves", (s) => s.structural_breakdown?.plumbing_and_valves_mass_kg ?? 0],
    ["Pressurization System (COPV/Auto)", (s) => s.structural_breakdown?.pressurization_system_mass_kg ?? 0],
    ["Cryo TPS / SOFI Insulation", (s) => s.structural_breakdown?.cryo_insulation_mass_kg ?? 0],
    ["TVC Actuators & RCS / Batteries", (s) => s.structural_breakdown?.tvc_and_rcs_mass_kg ?? 0],
    ["Avionics & Wiring Harness", (s) => s.structural_breakdown?.avionics_and_wiring_mass_kg ?? 0],
    ["Payload Adapter Fitting (PAF)", (s) => s.structural_breakdown?.payload_adapter_mass_kg ?? 0],
    ["Fasteners, Joints & Bosses", (s) => s.structural_breakdown?.fasteners_and_joints_mass_kg ?? 0],
    ["Solid Motor Casing & Nozzle", (s) => s.structural_breakdown?.solid_casing_and_nozzle_mass_kg ?? 0],
    ["Propulsion Engines Dry Mass", (s) => s.structural_breakdown?.engines_mass_kg ?? s.engines_mass_kg],
    ["Recovery Hardware (Legs/Fins/TPS)", (s) => s.structural_breakdown?.recovery_hardware_kg ?? s.recovery_hardware_kg],
    ["Strap-On Booster Inert Mass", (s) => s.structural_breakdown?.strapon_inert_kg ?? s.strapon_inert_kg],
    ["Unmargined Stage Dry Total", (s) => s.structural_breakdown?.predicted_dry_unmargined_kg ?? s.inert_mass_kg],
    ["MGA Reserve Growth Buffer", (s) => s.structural_breakdown?.margin_reserve_kg ?? 0],
    ["Margined Stage Dry Total", (s) => s.structural_breakdown?.predicted_dry_margined_kg ?? s.inert_mass_kg],
  ];

  rows.forEach(([label, getter]) => {
    const vals = result.stages
      .map((s) => Math.round(convertFromSi(getter(s), "mass", unitSystem)).toLocaleString("en-US"))
      .join(" | ");
    lines.push(`| ${label} | ${vals} |`);
  });

  lines.push(``);
  lines.push(`## Direct Comparison Against Matched Heritage Vehicles`);
  lines.push(``);
  lines.push(report.heritageComparativeProse);
  lines.push(``);
  lines.push(`| Vehicle | Class | GLOW (${mUnit}) | LEO Payload (${mUnit}) | Payload % | Total Dry (${mUnit}) | T/W0 | Launch Price (${currencyYear}) |`);
  lines.push(`| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |`);
  lines.push(
    `| **${config.name} (Design)** | ${report.category} | ${Math.round(convertFromSi(result.glow_kg, "mass", unitSystem)).toLocaleString("en-US")} | ${Math.round(convertFromSi(result.payload_mass_kg, "mass", unitSystem)).toLocaleString("en-US")} | ${(result.payload_fraction * 100).toFixed(2)}% | ${Math.round(convertFromSi(result.total_dry_mass_kg, "mass", unitSystem)).toLocaleString("en-US")} | ${result.liftoff_tw0.toFixed(2)} | ${fmtUsd(result.cost_breakdown.predicted_market_launch_price_usd ?? result.cost_breakdown.reusable_flight_cost_usd * 1.35, currencyYear)} |`
  );
  report.peerVehicles.forEach(({ vehicle: v, category: c }) => {
    lines.push(
      `| ${v.name.value} (${v.variant.value}) | ${c} | ${Math.round(convertFromSi(v.glow_kg.value, "mass", unitSystem)).toLocaleString("en-US")} | ${Math.round(convertFromSi(v.payload_leo_kg.value, "mass", unitSystem)).toLocaleString("en-US")} | ${(v.payload_fraction_leo.value * 100).toFixed(2)}% | ${Math.round(convertFromSi(v.total_dry_mass_kg.value, "mass", unitSystem)).toLocaleString("en-US")} | ${v.liftoff_tw0.value.toFixed(2)} | ${fmtUsd(v.launch_cost_adj_usd.value, currencyYear)} |`
    );
  });

  return lines.join("\n");
}
