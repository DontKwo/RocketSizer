import type {
  AdvancedModelDefaults,
  ConstraintEnvelope,
  VehicleConfiguration,
  VehicleSizingResult,
} from "../types/sizing";
import { formatValueWithUnit, type UnitSystem } from "./units";

export const DEFAULT_ADVANCED_MODEL_DEFAULTS: AdvancedModelDefaults = {
  ullage_pressure_pa: 320_000,
  ullage_volume_frac: 0.03,
  burst_safety_factor: 1.40,
  buckling_knockdown_gamma: 0.38,
  cold_sep_ullage_s: 5.0,
  cold_interstage_mass_kg: 120.0,
  hot_staging_ring_mass_kg: 680.0,
  learning_rate: 0.85,
  launch_ops_base_usd: 3_500_000,
  range_fee_usd: 1_200_000,
  recovery_ops_per_flight_usd: 450_000,
  refurb_cost_frac_override: null,
  reusable_ddte_surcharge_frac: 0.18,
  tvc_angle_deg: 7.0,
  no_touch_margin_m: 0.10,
  skirt_clearance_m: 0.12,
  skirt_wall_thickness_m: 0.03,
  gimbal_lever_arm_ratio: 0.85,
};

export interface OrbitRegimeGuideEntry {
  id: string;
  name: string;
  perigeeNmi: number;
  apogeeNmi: number;
  perigeeKm: number;
  apogeeKm: number;
  eccentricity: number;
  inclinationDeg: number;
  nominalDvMs: number;
  notes: string;
}

export const ORBIT_REGIME_GUIDE: OrbitRegimeGuideEntry[] = [
  {
    id: "leo_100x100",
    name: "LEO (Standard Circular Reference)",
    perigeeNmi: 100,
    apogeeNmi: 100,
    perigeeKm: 185.2,
    apogeeKm: 185.2,
    eccentricity: 0.0,
    inclinationDeg: 28.5,
    nominalDvMs: 9250,
    notes: "Baseline due-east Kennedy reference orbit (100 x 100 nmi).",
  },
  {
    id: "leo_iss",
    name: "ISS Cargo / Crew Orbit",
    perigeeNmi: 220,
    apogeeNmi: 220,
    perigeeKm: 407.4,
    apogeeKm: 407.4,
    eccentricity: 0.0,
    inclinationDeg: 51.6,
    nominalDvMs: 9420,
    notes: "Typical 200-230 nmi high-inclination crewed station rendezvous.",
  },
  {
    id: "leo_sso",
    name: "SSO (Sun-Synchronous Polar)",
    perigeeNmi: 300,
    apogeeNmi: 300,
    perigeeKm: 555.6,
    apogeeKm: 555.6,
    eccentricity: 0.0,
    inclinationDeg: 97.6,
    nominalDvMs: 9650,
    notes: "Retrograde polar Earth-observation belt (270-430 nmi).",
  },
  {
    id: "meo_gps",
    name: "MEO / GPS Transfer",
    perigeeNmi: 100,
    apogeeNmi: 10900,
    perigeeKm: 185.2,
    apogeeKm: 20186.8,
    eccentricity: 0.6062,
    inclinationDeg: 55.0,
    nominalDvMs: 11250,
    notes: "Medium-Earth navigation transfer ellipse (1,100-11,000 nmi).",
  },
  {
    id: "gto",
    name: "GTO (Geostationary Transfer)",
    perigeeNmi: 100,
    apogeeNmi: 19323,
    perigeeKm: 185.2,
    apogeeKm: 35786.0,
    eccentricity: 0.7306,
    inclinationDeg: 27.0,
    nominalDvMs: 11700,
    notes: "Standard subsynchronous/nominal transfer toward 35,786 km ring.",
  },
  {
    id: "geo_direct",
    name: "Direct GEO (Circular Belt)",
    perigeeNmi: 19323,
    apogeeNmi: 19323,
    perigeeKm: 35786.0,
    apogeeKm: 35786.0,
    eccentricity: 0.0,
    inclinationDeg: 0.0,
    nominalDvMs: 13200,
    notes: "Direct geosynchronous injection requiring upper-stage circularization.",
  },
  {
    id: "tli_lunar",
    name: "TLI (Trans-Lunar Injection)",
    perigeeNmi: 100,
    apogeeNmi: 207000,
    perigeeKm: 185.2,
    apogeeKm: 383364.0,
    eccentricity: 0.9672,
    inclinationDeg: 28.5,
    nominalDvMs: 12450,
    notes: "Lunar free-return / apogee intercept departure orbit.",
  },
];

const TOKEN_MAP: Record<string, string> = {
  lox: "LOX",
  rp1: "RP-1",
  lh2: "LH2",
  ch4: "LCH4",
  htpb: "HTPB",
  nto: "NTO",
  udmh: "UDMH",
  mmh: "MMH",
  leo: "LEO",
  sso: "SSO",
  gto: "GTO",
  geo: "GEO",
  meo: "MEO",
  tli: "TLI",
  tmi: "TMI",
  asds: "ASDS",
  rtls: "RTLS",
  srb: "SRB",
  fsrb: "FSRB",
  cfrp: "CFRP",
  al: "Al",
  li: "Li",
  ti6: "Ti-6Al-4V",
  copv: "COPV",
  rs: "RS",
  rl: "RL",
  rd: "RD",
  nk: "NK",
  aj: "AJ",
  be: "BE",
  gem: "GEM",
  yf: "YF",
  hm7b: "HM7B",
  vac: "Vacuum",
  sl: "SL",
  karman: "Karman",
};

export function formatIdentifierLabel(raw: string | null | undefined, lookup?: Map<string, string>): string {
  if (!raw || raw.trim() === "" || raw === "none" || raw === "null") {
    return "None";
  }
  const trimmed = raw.trim();
  if (lookup && lookup.has(trimmed)) {
    return lookup.get(trimmed) ?? trimmed;
  }
  if (/^[A-Za-z0-9\s\-+./()]+$/.test(trimmed) && !trimmed.includes("_") && /[A-Z]/.test(trimmed)) {
    return trimmed;
  }
  const parts = trimmed.split(/[_\s-]+/).filter((p) => p.length > 0);
  const formatted = parts.map((token) => {
    const low = token.toLowerCase();
    if (TOKEN_MAP[low]) {
      return TOKEN_MAP[low];
    }
    if (/^[a-z]*\d+[a-z0-9]*$/i.test(token)) {
      return token.toUpperCase();
    }
    return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
  });
  return formatted.join(" ");
}

export function formatPropellant(prop: string | null | undefined): string {
  switch ((prop ?? "").toLowerCase()) {
    case "lox_rp1":
      return "LOX / RP-1";
    case "lox_lh2":
      return "LOX / LH2";
    case "lox_ch4":
      return "LOX / LCH4";
    case "hypergolic_nto_udmh":
      return "NTO / UDMH";
    case "solid_htpb":
      return "Solid HTPB";
    case "none":
    case "":
      return "None";
    default:
      return formatIdentifierLabel(prop);
  }
}

export function formatEngineCycle(cycle: string | null | undefined): string {
  switch ((cycle ?? "").toLowerCase()) {
    case "gas_generator":
      return "Gas Generator";
    case "staged_combustion":
      return "Staged Combustion";
    case "full_flow_staged_combustion":
      return "Full-Flow Staged";
    case "expander":
      return "Expander Cycle";
    case "electric_pump":
      return "Electric Pump";
    case "pressure_fed":
      return "Pressure-Fed";
    case "solid_motor":
      return "Solid Motor";
    default:
      return formatIdentifierLabel(cycle);
  }
}

export function formatTankMaterial(mat: string | null | undefined): string {
  switch ((mat ?? "").toLowerCase()) {
    case "al_li2195":
      return "Al-Li 2195";
    case "cfrp_composite":
      return "CFRP Composite";
    case "stainless304_l":
      return "304L Stainless";
    case "titanium_ti6_al4_v":
      return "Ti-6Al-4V";
    default:
      return formatIdentifierLabel(mat);
  }
}

export function formatRecoveryMode(mode: string | null | undefined): string {
  switch ((mode ?? "").toLowerCase()) {
    case "expendable":
      return "Expendable";
    case "downrange_landing_asds":
      return "Downrange Drone Ship (ASDS)";
    case "return_to_launch_site_rtls":
      return "Return to Launch Site (RTLS)";
    case "parachute_mid_air_catch":
      return "Parachute / Mid-Air Catch";
    default:
      return formatIdentifierLabel(mode);
  }
}

export function formatFairingProfile(prof: string | null | undefined): string {
  switch ((prof ?? "").toLowerCase()) {
    case "von_karman":
      return "Von Karman";
    case "tangent_ogive":
      return "Tangent Ogive";
    case "biconic":
      return "Biconic";
    default:
      return formatIdentifierLabel(prof);
  }
}

export function formatOperationalStatus(status: string | null | undefined): string {
  switch ((status ?? "").toLowerCase()) {
    case "active":
      return "Active";
    case "retired":
      return "Retired";
    case "development":
    case "in_development":
      return "In Development";
    case "cancelled":
    case "canceled":
      return "Canceled";
    default:
      return formatIdentifierLabel(status);
  }
}

export function formatBoosterType(btype: string | null | undefined): string {
  switch ((btype ?? "").toLowerCase()) {
    case "none":
    case "":
      return "None";
    case "solid":
      return "Solid Strap-On";
    case "liquid":
      return "Liquid Strap-On";
    default:
      return formatIdentifierLabel(btype);
  }
}

export function formatSuccessRatePct(raw: number | null | undefined): string {
  if (raw === null || raw === undefined || !Number.isFinite(raw)) {
    return "--";
  }
  const pct = raw > 1.0 ? raw : raw * 100.0;
  const clamped = Math.max(0.0, Math.min(100.0, pct));
  return `${clamped.toFixed(1)}%`;
}

export interface HeritageConstraintPreset {
  constraints: ConstraintEnvelope;
  heritageSource: string;
  rationale: string[];
}

export function computeDynamicConstraintDefaults(config: VehicleConfiguration): HeritageConstraintPreset {
  const payloadKg = config.payload_mass_kg;
  const apogeeKm = (config.orbit.apogee_altitude_m ?? config.orbit.altitude_m) / 1_000.0;
  const s1Recovery = config.stages[0]?.recovery_mode ?? "expendable";
  const reusable = s1Recovery !== "expendable";
  const highEnergy = apogeeKm > 5_000.0 || (config.required_delta_v_m_s ?? 0) > 10_800.0;

  let heritageSource = "Medium-Heavy Fleet (Falcon 9 / Atlas V / Vulcan Heritage)";
  let minGlowKg = 80_000;
  let maxGlowKg = 2_800_000;
  let maxCostUsd = 280_000_000;
  let maxDiaM = 10.5;
  let maxHeightM = 115.0;
  let maxCoreEngines = 16;
  let minLiftoffTw = 1.18;
  let maxLiftoffTw = 1.65;
  let minCoreOnlyTw = 0.72;
  let minUpperTw = 0.28;
  let maxUpperTw = 1.45;
  let minPayloadFrac = 0.008;

  if (payloadKg <= 1_500) {
    heritageSource = "Small-Lift Heritage (Electron / Firefly Alpha / Vega)";
    minGlowKg = 4_000;
    maxGlowKg = 220_000;
    maxCostUsd = 45_000_000;
    maxDiaM = 3.2;
    maxHeightM = 48.0;
    maxCoreEngines = 9;
    minLiftoffTw = 1.25;
    maxLiftoffTw = 1.75;
    minUpperTw = 0.35;
    minPayloadFrac = 0.006;
  } else if (payloadKg <= 25_000) {
    heritageSource = "Medium-Lift Heritage (Falcon 9 Block 5 / Soyuz-2 / Ariane 62)";
    minGlowKg = 120_000;
    maxGlowKg = 1_600_000;
    maxCostUsd = 185_000_000;
    maxDiaM = 6.2;
    maxHeightM = 82.0;
    maxCoreEngines = 12;
    minLiftoffTw = 1.20;
    maxLiftoffTw = 1.65;
  } else if (payloadKg <= 65_000) {
    heritageSource = "Heavy-Lift Heritage (Falcon Heavy / New Glenn / Ariane 5 / Vulcan VC6L)";
    minGlowKg = 350_000;
    maxGlowKg = 3_200_000;
    maxCostUsd = 380_000_000;
    maxDiaM = 8.5;
    maxHeightM = 105.0;
    maxCoreEngines = 27;
    minLiftoffTw = 1.18;
    maxLiftoffTw = 1.70;
  } else {
    heritageSource = "Super-Heavy Heritage (Saturn V / SLS Block 1 / Starship)";
    minGlowKg = 900_000;
    maxGlowKg = 6_500_000;
    maxCostUsd = 2_200_000_000;
    maxDiaM = 12.0;
    maxHeightM = 135.0;
    maxCoreEngines = 33;
    minLiftoffTw = 1.15;
    maxLiftoffTw = 1.65;
    minUpperTw = 0.20;
    maxUpperTw = 1.50;
  }

  if (reusable) {
    minLiftoffTw = Math.max(minLiftoffTw, 1.22);
    maxCoreEngines = Math.max(maxCoreEngines, 9);
  }
  if (highEnergy) {
    minPayloadFrac = 0.004;
    minUpperTw = Math.min(minUpperTw, 0.22);
  }

  const subcooled = config.cryo_state === "subcooled_densified";
  const scaleBonus = payloadKg <= 1_500 ? -0.025 : payloadKg > 45_000 ? 0.008 : 0.0;
  const subcoolBonus = subcooled ? 0.006 : 0.0;
  const mfLh2 = Number(Math.max(0.86, Math.min(0.93, 0.905 + scaleBonus)).toFixed(3));
  const mfRp1 = Number(Math.max(0.90, Math.min(0.955, 0.940 + scaleBonus + subcoolBonus)).toFixed(3));
  const mfCh4 = Number(Math.max(0.89, Math.min(0.95, 0.925 + scaleBonus + subcoolBonus)).toFixed(3));
  const mfSolid = Number(Math.max(0.85, Math.min(0.905, 0.880 + (payloadKg > 45_000 ? 0.005 : 0))).toFixed(3));

  const maxPayloadFrac = 0.08;
  const derivedMaxGlowKg = Math.max(maxGlowKg, Math.round(payloadKg / Math.max(0.001, minPayloadFrac)));
  const derivedMinGlowKg = Math.min(minGlowKg, Math.round(payloadKg / maxPayloadFrac));

  const rationale: string[] = [
    `Liftoff T/W0 [${minLiftoffTw.toFixed(2)}, ${maxLiftoffTw.toFixed(2)}] scaled for pad gravity-loss control & dynamic pressure`,
    `Core-only post-sep T/W0 >= ${minCoreOnlyTw.toFixed(2)} avoids gravity fall-back after booster jettison`,
    `Payload fraction floor ${(minPayloadFrac * 100).toFixed(2)}% tuned for ${highEnergy ? "high-energy GTO/TLI" : "LEO/MEO"} injection`,
    `Propellant tankage mass fractions set for ${payloadKg <= 1_500 ? "small-lift" : payloadKg > 45_000 ? "heavy/super-heavy" : "medium-lift"} (${subcooled ? "subcooled" : "normal boiling"})`,
  ];

  return {
    heritageSource,
    rationale,
    constraints: {
      ...config.constraints,
      max_cost_usd: maxCostUsd,
      max_glow_kg: derivedMaxGlowKg,
      min_glow_kg: derivedMinGlowKg,
      max_core_diameter_m: maxDiaM,
      max_total_height_m: maxHeightM,
      max_g_limit: 4.5,
      max_core_engines: maxCoreEngines,
      max_upper_engines: 6,
      allowed_booster_counts: [0, 2, 3, 4, 6],
      min_liftoff_tw0: minLiftoffTw,
      max_liftoff_tw0: maxLiftoffTw,
      min_upper_tw0: minUpperTw,
      max_upper_tw0: maxUpperTw,
      enforce_base_packing: true,
      min_payload_frac: minPayloadFrac,
      max_payload_frac: maxPayloadFrac,
      min_core_only_tw0: minCoreOnlyTw,
      max_core_only_tw0: 2.20,
      min_stage3_tw0: 0.20,
      max_stage3_tw0: 1.50,
      min_strapon_count: 0,
      max_strapon_count: 6,
      mf_lox_lh2: mfLh2,
      mf_lox_rp1: mfRp1,
      mf_lox_ch4: mfCh4,
      mf_solid: mfSolid,
      max_slenderness_ld: 22.0,
    },
  };
}

export interface ConstraintCheckItem {
  id: string;
  label: string;
  passed: boolean;
  actualStr: string;
  limitStr: string;
  detail: string;
}

export function buildConstraintCheckItems(
  result: VehicleSizingResult,
  config: VehicleConfiguration | null,
  unitSystem: UnitSystem
): ConstraintCheckItem[] {
  const c = config?.constraints;
  const s1 = result.stages[0];
  const s2 = result.stages[1];
  const s3 = result.stages[2];
  const items: ConstraintCheckItem[] = [];

  const minTw = c?.min_liftoff_tw0 ?? 1.15;
  const maxTw = c?.max_liftoff_tw0 ?? 1.75;
  items.push({
    id: "liftoff_tw",
    label: "Liftoff T/W0",
    passed: result.liftoff_tw0 >= minTw && result.liftoff_tw0 <= maxTw,
    actualStr: `${result.liftoff_tw0.toFixed(2)}`,
    limitStr: `${minTw.toFixed(2)} - ${maxTw.toFixed(2)}`,
    detail: "Pad liftoff thrust-to-weight ratio",
  });

  if (s1 && s1.strapon_count > 0 && s1.tw_after_booster_sep !== undefined && s1.tw_after_booster_sep !== null) {
    const minCoreTw = c?.min_core_only_tw0 ?? 0.70;
    const maxCoreTw = c?.max_core_only_tw0 ?? 2.20;
    items.push({
      id: "core_only_tw",
      label: "Post-Sep Core T/W",
      passed: s1.tw_after_booster_sep >= minCoreTw && s1.tw_after_booster_sep <= maxCoreTw,
      actualStr: `${s1.tw_after_booster_sep.toFixed(2)}`,
      limitStr: `${minCoreTw.toFixed(2)} - ${maxCoreTw.toFixed(2)}`,
      detail: "Sustainer core T/W immediately after strap-on jettison",
    });
  }

  if (s2) {
    const minU2 = c?.min_upper_tw0 ?? 0.20;
    const maxU2 = c?.max_upper_tw0 ?? 1.50;
    items.push({
      id: "stage2_tw",
      label: "Stage 2 T/W0",
      passed: s2.tw0_ignition >= minU2 && s2.tw0_ignition <= maxU2,
      actualStr: `${s2.tw0_ignition.toFixed(2)}`,
      limitStr: `${minU2.toFixed(2)} - ${maxU2.toFixed(2)}`,
      detail: "Stage 2 ignition thrust-to-weight",
    });
  }

  if (s3) {
    const minS3 = c?.min_stage3_tw0 ?? 0.20;
    const maxS3 = c?.max_stage3_tw0 ?? 1.50;
    items.push({
      id: "stage3_tw",
      label: "Stage 3 T/W0",
      passed: s3.tw0_ignition >= minS3 && s3.tw0_ignition <= maxS3,
      actualStr: `${s3.tw0_ignition.toFixed(2)}`,
      limitStr: `${minS3.toFixed(2)} - ${maxS3.toFixed(2)}`,
      detail: "Stage 3 ignition thrust-to-weight",
    });
  }

  const maxG = c?.max_g_limit ?? config?.g_limit ?? 4.5;
  items.push({
    id: "peak_accel",
    label: "Peak Axial Accel",
    passed: result.peak_accel_g <= maxG + 0.05,
    actualStr: `${result.peak_accel_g.toFixed(2)} g`,
    limitStr: `<= ${maxG.toFixed(2)} g`,
    detail: "Throttled burnout structural acceleration load",
  });

  const enforcePack = c?.enforce_base_packing ?? true;
  items.push({
    id: "base_packing",
    label: "Base Engine Packing",
    passed: !enforcePack || result.base_packing_fits,
    actualStr: formatValueWithUnit(result.base_required_dia_m, "length", unitSystem, 2),
    limitStr: `<= ${formatValueWithUnit(result.base_usable_dia_m, "length", unitSystem, 2)}`,
    detail: "Nozzle bell + TVC gimbal sweep fits inside core skirt",
  });

  const minPf = (c?.min_payload_frac ?? 0.005) * 100.0;
  const maxPf = (c?.max_payload_frac ?? 0.08) * 100.0;
  const pfPct = result.payload_fraction * 100.0;
  items.push({
    id: "payload_frac",
    label: "Payload Fraction",
    passed: pfPct >= minPf && pfPct <= maxPf,
    actualStr: `${pfPct.toFixed(2)}%`,
    limitStr: `${minPf.toFixed(2)}% - ${maxPf.toFixed(2)}%`,
    detail: "Payload mass divided by Gross Liftoff Weight",
  });

  const dvReq = result.delta_v_breakdown.total_required_dv_m_s;
  const dvDel = result.delta_v_breakdown.total_delivered_dv_m_s;
  items.push({
    id: "dv_closure",
    label: "Delta-V Closure",
    passed: dvDel >= dvReq - 10.0,
    actualStr: formatValueWithUnit(dvDel, "velocity", unitSystem, 0),
    limitStr: `>= ${formatValueWithUnit(dvReq, "velocity", unitSystem, 0)}`,
    detail: "Delivered ideal impulse vs mission + margin requirement",
  });

  const ld = result.total_height_m / Math.max(0.1, result.core_diameter_m);
  const maxLd = c?.max_slenderness_ld ?? 22.0;
  items.push({
    id: "slenderness_ld",
    label: "Vehicle Fineness L/D",
    passed: ld <= maxLd,
    actualStr: `${ld.toFixed(1)}`,
    limitStr: `<= ${maxLd.toFixed(1)}`,
    detail: "Total stack height over core tank diameter",
  });

  if (c?.max_total_height_m) {
    items.push({
      id: "height_cap",
      label: "Total Height Limit",
      passed: result.total_height_m <= c.max_total_height_m,
      actualStr: formatValueWithUnit(result.total_height_m, "length", unitSystem, 1),
      limitStr: `<= ${formatValueWithUnit(c.max_total_height_m, "length", unitSystem, 1)}`,
      detail: "Pad umbilical tower & integration bay clearance",
    });
  }

  if (c?.max_cost_usd) {
    items.push({
      id: "cost_cap",
      label: "Cost Ceiling",
      passed: result.cost_breakdown.reusable_flight_cost_usd <= c.max_cost_usd,
      actualStr: formatValueWithUnit(result.cost_breakdown.reusable_flight_cost_usd, "cost", unitSystem),
      limitStr: `<= ${formatValueWithUnit(c.max_cost_usd, "cost", unitSystem)}`,
      detail: "Amortized flight cost cap",
    });
  }

  for (let i = 0; i < result.violation_messages.length; i += 1) {
    const msg = result.violation_messages[i];
    const alreadyShown = items.some((it) => !it.passed && msg.toLowerCase().includes(it.label.split(" ")[0].toLowerCase()));
    if (!alreadyShown) {
      items.push({
        id: `extra_viol_${i}`,
        label: "Constraint Violation",
        passed: false,
        actualStr: "Failed",
        limitStr: "--",
        detail: msg,
      });
    }
  }

  return items.sort((a, b) => Number(a.passed) - Number(b.passed));
}
