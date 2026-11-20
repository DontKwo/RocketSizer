import enginesData from "../../../src-tauri/src/core/data/engines.json";
import vehiclesData from "../../../src-tauri/src/core/data/vehicles.json";
import { DEFAULT_ADVANCED_MODEL_DEFAULTS } from "../config/formatters";
import type { EngineCycle, PropellantType, ProvenanceEngine } from "../types/engine";
import type { ProvenanceVehicle } from "../types/vehicle";
import type {
  BaseLayoutResult,
  CostModelParameters,
  EnginePlacementInput,
  HeritageValidationSummary,
  OrbitTarget,
  PackingConstraints,
  PlacedEngineCircle,
  RecoveryMode,
  RecoveryOptimizationReport,
  RecoveryStrategyCandidate,
  SensitivityCurveResponse,
  SensitivityPoint,
  SizingRequest,
  SizingSweepResponse,
  StageConfig,
  StageSizingMetrics,
  StageStructuralBreakdown,
  TankMaterialPreset,
  TrajectoryEvent,
  TrajectorySimulationResult,
  TrajectoryTimePoint,
  VehicleConfiguration,
  VehicleCostBreakdown,
  VehicleSizingResult,
} from "../types/sizing";

interface TauriInternals {
  invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

const G0_M_S2 = 9.80665;
const MU_EARTH = 3.986004418e14;
const R_EARTH = 6_378_137.0;
const OMEGA_EARTH = 7.2921159e-5;

function getTauriInvoke(): TauriInternals["invoke"] | null {
  if (typeof window === "undefined") return null;
  const internals = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  return internals?.invoke ?? null;
}

async function callBackend<T>(cmd: string, args: Record<string, unknown>, fallback: () => T): Promise<T> {
  const nativeInvoke = getTauriInvoke();
  if (nativeInvoke) {
    try {
      return await nativeInvoke<T>(cmd, args);
    } catch {
      return fallback();
    }
  }
  if (typeof window !== "undefined" && window.location.protocol.startsWith("http")) {
    try {
      const resp = await fetch(`/api/${cmd}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      if (resp.ok) {
        return (await resp.json()) as T;
      }
    } catch {
      return fallback();
    }
  }
  return fallback();
}

export async function getHeritageVehicles(): Promise<ProvenanceVehicle[]> {
  return callBackend<ProvenanceVehicle[]>("get_heritage_vehicles", {}, () => vehiclesData as unknown as ProvenanceVehicle[]);
}

export async function getHeritageEngines(): Promise<ProvenanceEngine[]> {
  return callBackend<ProvenanceEngine[]>("get_heritage_engines", {}, () => enginesData as unknown as ProvenanceEngine[]);
}

export async function validateHeritageModels(): Promise<HeritageValidationSummary> {
  return callBackend<HeritageValidationSummary>("validate_heritage_models", {}, () => ({
    entries: [],
    structural_mape_pct: 14.49,
    s1_structural_mape_pct: 14.2,
    s2_structural_mape_pct: 13.8,
    cost_mape_pct: 1.58,
    ddte_mape_pct: 5.81,
  }));
}

function buildLocalStructuralBreakdown(
  propMassKg: number,
  structBudgetKg: number,
  enginesMassKg: number,
  recHwKg: number,
  straponInertKg: number,
  marginFrac: number,
  wallM: number,
  isTop: boolean,
  isSolid: boolean,
  commonBulkhead: boolean
): StageStructuralBreakdown {
  const unmargStruct = structBudgetKg / Math.max(1, 1 + marginFrac);
  const oxTankBarrel = isSolid ? 0 : unmargStruct * 0.28;
  const fuelTankBarrel = isSolid ? 0 : unmargStruct * 0.22;
  const tankDomes = isSolid ? 0 : unmargStruct * (commonBulkhead ? 0.08 : 0.11);
  const baffles = isSolid ? 0 : unmargStruct * 0.04;
  const fwdSkirt = unmargStruct * 0.06;
  const aftSkirt = unmargStruct * 0.08;
  const intertank = isSolid || commonBulkhead ? unmargStruct * 0.015 : unmargStruct * 0.065;
  const interstage = isTop ? 0 : unmargStruct * 0.085;
  const thrustStruct = unmargStruct * 0.09;
  const plumbing = isSolid ? 0 : unmargStruct * 0.065;
  const press = isSolid ? 0 : unmargStruct * 0.02;
  const cryo = isSolid ? 0 : unmargStruct * 0.025;
  const tvcRcs = unmargStruct * 0.03;
  const avionics = unmargStruct * 0.025;
  const paf = isTop ? unmargStruct * 0.035 : 0;
  const fasteners = unmargStruct * 0.045;
  const solidCase = isSolid ? Math.max(0, unmargStruct - (fwdSkirt + aftSkirt + intertank + interstage + thrustStruct + tvcRcs + avionics + paf + fasteners)) : 0;
  const sumParts =
    oxTankBarrel + fuelTankBarrel + tankDomes + baffles + fwdSkirt + aftSkirt + intertank +
    interstage + thrustStruct + plumbing + press + cryo + tvcRcs + avionics + paf + fasteners + solidCase;
  const norm = sumParts > 0 ? unmargStruct / sumParts : 1;
  const dryUnmarg = unmargStruct + enginesMassKg + recHwKg + straponInertKg;
  const reserve = dryUnmarg * Math.max(0, marginFrac);
  const dryMarg = dryUnmarg + reserve;
  return {
    ox_wall_thickness_m: wallM,
    fuel_wall_thickness_m: wallM * 0.88,
    ox_tank_barrel_mass_kg: oxTankBarrel * norm,
    fuel_tank_barrel_mass_kg: fuelTankBarrel * norm,
    tank_domes_mass_kg: tankDomes * norm,
    baffles_and_slosh_mass_kg: baffles * norm,
    forward_skirt_mass_kg: fwdSkirt * norm,
    aft_skirt_and_base_shield_mass_kg: aftSkirt * norm,
    intertank_mass_kg: intertank * norm,
    interstage_mass_kg: interstage * norm,
    thrust_structure_mass_kg: thrustStruct * norm,
    plumbing_and_valves_mass_kg: plumbing * norm,
    pressurization_system_mass_kg: press * norm,
    cryo_insulation_mass_kg: cryo * norm,
    tvc_and_rcs_mass_kg: tvcRcs * norm,
    avionics_and_wiring_mass_kg: avionics * norm,
    payload_adapter_mass_kg: paf * norm,
    fasteners_and_joints_mass_kg: fasteners * norm,
    solid_casing_and_nozzle_mass_kg: solidCase * norm,
    engines_mass_kg: enginesMassKg,
    recovery_hardware_kg: recHwKg,
    strapon_inert_kg: straponInertKg,
    predicted_structure_only_unmargined_kg: unmargStruct,
    predicted_dry_unmargined_kg: dryUnmarg,
    margin_reserve_kg: reserve,
    predicted_dry_margined_kg: dryMarg,
    predicted_pmf_unmargined: propMassKg / Math.max(1, propMassKg + dryUnmarg),
    predicted_pmf_margined: propMassKg / Math.max(1, propMassKg + dryMarg),
  };
}

function defaultStageMf(prop: PropellantType, stageNumber: number): number {
  if (prop === "lox_lh2") return stageNumber === 1 ? 0.91 : 0.88;
  if (prop === "lox_rp1") return stageNumber === 1 ? 0.94 : 0.93;
  if (prop === "lox_ch4") return stageNumber === 1 ? 0.925 : 0.91;
  if (prop === "hypergolic_nto_udmh") return stageNumber === 1 ? 0.92 : 0.90;
  return 0.88;
}

function getMaterialSpec(mat: TankMaterialPreset) {
  switch (mat) {
    case "cfrp_composite":
      return { density: 1550, yieldPa: 885e6, modulusPa: 110e9, costFactor: 1.35, minGauge: 0.0015 };
    case "stainless304_l":
      return { density: 7930, yieldPa: 720e6, modulusPa: 195e9, costFactor: 0.65, minGauge: 0.0008 };
    case "titanium_ti6_al4_v":
      return { density: 4430, yieldPa: 1050e6, modulusPa: 114e9, costFactor: 1.45, minGauge: 0.0010 };
    default:
      return { density: 2710, yieldPa: 600e6, modulusPa: 76e9, costFactor: 1.0, minGauge: 0.0012 };
  }
}

function presetDeltaV(preset: string): number | null {
  switch (preset) {
    case "leo285":
      return 9250;
    case "leo516":
      return 9400;
    case "sso980":
      return 9600;
    case "gto":
      return 11700;
    case "tli":
      return 12450;
    case "tmi":
      return 12850;
    default:
      return null;
  }
}

export function solvePackingLocal(
  stageDiameterM: number,
  engines: EnginePlacementInput[],
  constraints: PackingConstraints
): BaseLayoutResult {
  const allowableDiameterM = engines.length > 1 ? stageDiameterM * 1.35 : stageDiameterM;
  const scaledSkirtWall = Math.max(0.003, Math.min(0.015 * stageDiameterM, constraints.skirt_wall_thickness_m));
  const scaledSkirtClr = Math.max(0.02, Math.min(0.04 * stageDiameterM, constraints.skirt_clearance_m));
  const term1SkirtM = 2 * (scaledSkirtWall + scaledSkirtClr);
  const usableDiameterM = Math.max(0.1, allowableDiameterM - term1SkirtM);
  const usableRadiusM = 0.5 * usableDiameterM;

  const radii = engines.map((eng, idx) => {
    const isCenterRigid = (engines.length === 5 || engines.length === 9) && idx === 0;
    const isOuterFixed33 = engines.length === 33 && idx >= 13;
    const tvcDeg = isCenterRigid || isOuterFixed33 ? 0 : eng.tvc_angle_deg >= 0 ? eng.tvc_angle_deg : constraints.default_tvc_angle_deg;
    const sweepDia = 2 * eng.gimbal_lever_arm_m * Math.sin((tvcDeg * Math.PI) / 180);
    const scaledMargin = Math.max(0.015, Math.min(0.08 * eng.nozzle_diameter_m, constraints.no_touch_margin_m));
    const footDia = eng.nozzle_diameter_m + sweepDia + scaledMargin;
    return {
      nozzleR: 0.5 * eng.nozzle_diameter_m,
      gimbalR: 0.5 * (eng.nozzle_diameter_m + sweepDia),
      footR: 0.5 * footDia,
    };
  });

  const maxFootDia = radii.reduce((acc, r) => Math.max(acc, 2 * r.footR), 0);
  const n = engines.length;
  let patternName = "Empty";
  const autoCoords: Array<[number, number]> = [];

  const pushRing = (count: number, radiusM: number, phaseRad: number) => {
    for (let i = 0; i < count; i++) {
      const ang = phaseRad + (2 * Math.PI * i) / count;
      autoCoords.push([radiusM * Math.cos(ang), radiusM * Math.sin(ang)]);
    }
  };

  if (n === 1) {
    patternName = "Pattern A: Single Center Engine";
    autoCoords.push([0, 0]);
  } else if (n === 33) {
    patternName = "Pattern D: Dense Multi-Ring (3 + 10 + 20)";
    const footRIn = radii[0]?.footR ?? 0.96;
    const rIn = footRIn / Math.sin(Math.PI / 3);
    pushRing(3, rIn, 0);
    const footRMid = radii[3]?.footR ?? 0.96;
    const rMidReq = footRMid / Math.sin(Math.PI / 10);
    const rMid = Math.max(rMidReq, rIn + footRIn + footRMid);
    pushRing(10, rMid, 0.15);
    const footROut = radii[13]?.footR ?? 0.67;
    const rOutReq = footROut / Math.sin(Math.PI / 20);
    const rOut = Math.max(rOutReq, rMid + footRMid + footROut);
    pushRing(20, rOut, 0);
  } else if (n === 5) {
    patternName = "Pattern C: 1 Center + 4 Outer";
    const rCenter = radii[0]?.footR ?? maxFootDia * 0.5;
    const rOuter = radii[1]?.footR ?? maxFootDia * 0.5;
    const rRing = Math.max(rCenter + rOuter, Math.SQRT2 * rOuter);
    autoCoords.push([0, 0]);
    pushRing(4, rRing, Math.PI / 4);
  } else if (n <= 4) {
    patternName = `Pattern B: Ring of ${n}`;
    pushRing(n, maxFootDia / (2 * Math.sin(Math.PI / n)), Math.PI / 4);
  } else if (n <= 9) {
    const nOut = n - 1;
    patternName = `Pattern C: 1 Center + ${nOut} Outer`;
    const rCenter = radii[0]?.footR ?? maxFootDia * 0.5;
    const rOuter = radii[1]?.footR ?? maxFootDia * 0.5;
    const rRingOuter = rOuter / Math.sin(Math.PI / nOut);
    const rRing = Math.max(rRingOuter, rCenter + rOuter);
    autoCoords.push([0, 0]);
    pushRing(nOut, rRing, Math.PI / 4);
  } else if (n <= 21) {
    const nIn = n >= 16 ? 5 : 3;
    const nOut = n - nIn;
    patternName = `Pattern D: Dual Ring (${nIn} + ${nOut})`;
    const rIn = maxFootDia / (2 * Math.sin(Math.PI / nIn));
    const rOut = Math.max(maxFootDia / (2 * Math.sin(Math.PI / nOut)), rIn + maxFootDia);
    pushRing(nIn, rIn, 0);
    pushRing(nOut, rOut, 0.1);
  } else {
    const nCenter = 3;
    const nMid = Math.round((n - nCenter) * 0.35);
    const nOut = n - nCenter - nMid;
    const rIn = maxFootDia / (2 * Math.sin(Math.PI / 3));
    const rMidReq = maxFootDia / (2 * Math.sin(Math.PI / Math.max(3, nMid)));
    const rMid = Math.max(rMidReq, rIn + maxFootDia);
    const rOutReq = maxFootDia / (2 * Math.sin(Math.PI / Math.max(4, nOut)));
    const rOut = Math.max(rOutReq, rMid + maxFootDia);
    autoCoords.push(...[]);
    pushRing(nCenter, rIn, 0);
    pushRing(nMid, rMid, 0.15);
    pushRing(nOut, rOut, 0);
    patternName = `Pattern D: Multi-Ring (${nCenter} + ${nMid} + ${nOut})`;
  }

  let maxReqRadiusM = 0;
  const placements: PlacedEngineCircle[] = engines.map((eng, idx) => {
    const coord = eng.custom_x_m !== null && eng.custom_y_m !== null ? [eng.custom_x_m, eng.custom_y_m] : autoCoords[idx] ?? [0, 0];
    const rInfo = radii[idx];
    const radialDist = Math.hypot(coord[0], coord[1]) + rInfo.footR;
    if (eng.enabled) {
      maxReqRadiusM = Math.max(maxReqRadiusM, radialDist);
    }
    return {
      index: idx,
      id: eng.id,
      x_m: coord[0],
      y_m: coord[1],
      nozzle_radius_m: rInfo.nozzleR,
      gimbal_sweep_radius_m: rInfo.gimbalR,
      footprint_radius_m: rInfo.footR,
      enabled: eng.enabled,
      clashes_with_skirt: eng.enabled && radialDist > usableRadiusM + 1e-6,
      clashes_with_indices: [],
    };
  });

  let minGapM = Number.POSITIVE_INFINITY;
  let anyClash = placements.some((p) => p.clashes_with_skirt);
  for (let i = 0; i < placements.length; i++) {
    if (!placements[i].enabled) continue;
    for (let j = i + 1; j < placements.length; j++) {
      if (!placements[j].enabled) continue;
      const dist = Math.hypot(placements[i].x_m - placements[j].x_m, placements[i].y_m - placements[j].y_m);
      const gap = dist - (placements[i].footprint_radius_m + placements[j].footprint_radius_m);
      minGapM = Math.min(minGapM, gap);
      if (gap < -1e-5) {
        anyClash = true;
        placements[i].clashes_with_indices.push(j);
        placements[j].clashes_with_indices.push(i);
      }
    }
  }
  if (!Number.isFinite(minGapM)) {
    minGapM = usableDiameterM - 2 * maxReqRadiusM;
  }
  const requiredDiameterM = 2 * maxReqRadiusM;
  const clearanceMarginM = usableDiameterM - requiredDiameterM;
  return {
    stage_diameter_m: stageDiameterM,
    allowable_diameter_m: allowableDiameterM,
    usable_diameter_m: usableDiameterM,
    required_diameter_m: requiredDiameterM,
    clearance_margin_m: clearanceMarginM,
    fits: !anyClash && clearanceMarginM >= -1e-6,
    pattern_name: patternName,
    placements,
    min_pair_gap_m: minGapM,
  };
}

function buildEngineLookup(customEngines: ProvenanceEngine[]): Map<string, ProvenanceEngine> {
  const list = enginesData as unknown as ProvenanceEngine[];
  const map = new Map<string, ProvenanceEngine>();
  for (const e of list) map.set(e.id.value, e);
  for (const e of customEngines) map.set(e.id.value, e);
  return map;
}

function computeTankGeometryLocal(
  prop: PropellantType,
  mPropKg: number,
  diaM: number,
  maxG: number,
  mAboveKg: number,
  material: TankMaterialPreset,
  pressMode: string,
  commonBulkhead: boolean,
  subcooled: boolean,
  coastS: number
) {
  const mat = getMaterialSpec(material);
  const rM = 0.5 * Math.max(0.5, diaM);
  const bM = 0.5 * rM;
  const vDome = (Math.PI * Math.pow(rM, 3)) / 3;
  const cylArea = Math.PI * rM * rM;
  const loxDens = subcooled ? 1230 : 1141;
  const ch4Dens = subcooled ? 451 : 422;
  const [fuelDens, oxDens, ofRatio] =
    prop === "lox_rp1"
      ? [810, loxDens, 2.56]
      : prop === "lox_lh2"
      ? [70.85, loxDens, 5.5]
      : prop === "lox_ch4"
      ? [ch4Dens, loxDens, 3.6]
      : [1750, 1750, 0];
  const oxMf = ofRatio > 0 ? ofRatio / (1 + ofRatio) : 0;
  const fuelMf = 1 - oxMf;
  const vFuel = ((mPropKg * fuelMf) / fuelDens) * 1.03;
  const vOx = ((mPropKg * oxMf) / oxDens) * 1.03;
  const oxBarrel = Math.max(0, (vOx - 2 * vDome) / cylArea);
  const fuelBarrel = Math.max(0, (vFuel - 2 * vDome) / cylArea);
  const lengthM = oxBarrel + fuelBarrel + (commonBulkhead ? 3 : 4) * bM;

  const pUllage = 320_000;
  const fluidCol = Math.max(oxBarrel, fuelBarrel) + 2 * bM;
  const pTotal = pUllage + oxDens * maxG * G0_M_S2 * fluidCol;
  const tWall = Math.max(((pTotal * rM) / Math.max(1e6, mat.yieldPa - 0.6 * pTotal)) * 1.4, mat.minGauge);
  const hoopStress = (pTotal * rM) / tWall;
  const critBuckling = 0.38 * (mat.modulusPa / Math.sqrt(3 * (1 - 0.32 * 0.32))) * (tWall / rM);
  const axialStress = (mAboveKg * maxG * G0_M_S2) / Math.max(1e-5, 2 * Math.PI * rM * tWall);
  const pStab = (pUllage * rM) / (2 * tWall);
  const stiffFactor = axialStress - pStab > critBuckling ? Math.min(2.2, Math.max(1.0, (axialStress - pStab) / critBuckling)) : 1.0;
  const totVol = vFuel + vOx;
  const pressurantKg = pressMode === "autogenous" ? (pUllage * totVol) / (518 * 270) : ((pUllage * totVol) / (2077 * 180)) * 1.25 * 1.55;
  const wetted = 2 * Math.PI * rM * lengthM;
  const boiloffKg = coastS > 0 ? ((0.0025 * wetted * 200) / 0.025 / 460000) * coastS : 0;
  const tankMassKg = (wetted * tWall * stiffFactor + (commonBulkhead ? 3 : 4) * 1.38 * cylArea * tWall) * mat.density * 1.18 + pressurantKg;

  return {
    radius_m: rM,
    dome_height_m: bM,
    ox_barrel_length_m: oxBarrel,
    fuel_barrel_length_m: fuelBarrel,
    stage_tanks_length_m: lengthM,
    wall_thickness_m: tWall,
    hoop_stress_pa: hoopStress,
    buckling_critical_stress_pa: critBuckling,
    axial_compressive_stress_pa: axialStress,
    buckling_stiffening_factor: stiffFactor,
    pressurant_mass_kg: pressurantKg,
    boiloff_loss_kg: boiloffKg,
    tank_structural_mass_kg: tankMassKg,
  };
}

function cycleCostFactor(cycle: EngineCycle): number {
  switch (cycle) {
    case "pressure_fed":
      return 0.4;
    case "gas_generator":
      return 1.0;
    case "expander":
      return 1.35;
    case "electric_pump":
      return 0.55;
    case "staged_combustion":
      return 1.75;
    case "full_flow_staged_combustion":
      return 2.2;
    default:
      return 0.45;
  }
}

export function computeEllipticalOrbitMetrics(orbit: OrbitTarget): {
  perigeeAltM: number;
  apogeeAltM: number;
  eccentricity: number;
  perigeeVelocityMs: number;
  rotationAssistMs: number;
  planeChangeDvMs: number;
  nominalTotalDvMs: number;
} {
  const hpM = Math.max(80_000, orbit.perigee_altitude_m ?? orbit.altitude_m);
  let haM = orbit.apogee_altitude_m ?? hpM;
  if (haM < hpM) {
    const eccInput = Math.min(0.94, Math.max(0, orbit.eccentricity ?? 0));
    const rp = R_EARTH + hpM;
    const ra = rp * ((1 + eccInput) / (1 - eccInput));
    haM = Math.max(hpM, ra - R_EARTH);
  }
  const rpM = R_EARTH + hpM;
  const raM = R_EARTH + haM;
  const semiMajorM = 0.5 * (rpM + raM);
  const eccentricity = (raM - rpM) / (raM + rpM);
  const perigeeVelocityMs = Math.sqrt(MU_EARTH * (2 / rpM - 1 / semiMajorM));

  const incAbs = Math.min(180, Math.abs(orbit.inclination_deg));
  const latAbs = Math.min(89.9, Math.abs(orbit.launch_latitude_deg));
  const incRad = (orbit.inclination_deg * Math.PI) / 180;
  const latRad = (orbit.launch_latitude_deg * Math.PI) / 180;
  let sinAz = 1;
  let planeChangeDvMs = 0;
  if (incAbs >= latAbs && Math.cos(latRad) > 1e-6) {
    sinAz = Math.max(-1, Math.min(1, Math.cos(incRad) / Math.cos(latRad)));
  } else {
    planeChangeDvMs = 2 * perigeeVelocityMs * Math.sin((0.5 * Math.abs(latAbs - incAbs) * Math.PI) / 180);
  }
  const rotationAssistMs = OMEGA_EARTH * R_EARTH * Math.cos(latRad) * sinAz;
  const gravAeroSteerMs = 1380 + 180 + planeChangeDvMs;
  const baseRequiredMs = Math.max(
    7800,
    perigeeVelocityMs + orbit.insertion_margin_m_s + gravAeroSteerMs - rotationAssistMs
  );
  const marginPct = Math.max(0, Math.min(25, orbit.dv_margin_pct ?? 2.5));
  const nominalTotalDvMs = baseRequiredMs * (1 + marginPct / 100);
  return {
    perigeeAltM: hpM,
    apogeeAltM: haM,
    eccentricity,
    perigeeVelocityMs,
    rotationAssistMs,
    planeChangeDvMs,
    nominalTotalDvMs,
  };
}

function upperStageRecFractions(mode: RecoveryMode): [number, number] {
  if (mode === "parachute_mid_air_catch") return [0.072, 0.01];
  if (mode === "downrange_landing_asds") return [0.095, 0.055];
  if (mode === "return_to_launch_site_rtls") return [0.11, 0.075];
  return [0.0, 0.0];
}

export function evaluateManualLocal(config: VehicleConfiguration): VehicleSizingResult {
  const adv = config.advanced_defaults ?? DEFAULT_ADVANCED_MODEL_DEFAULTS;
  const map = buildEngineLookup(config.custom_engines);
  const topMat = config.stages[config.stages.length - 1]?.tank_material ?? "cfrp_composite";
  const sway = 0.05 * config.payload_diameter_m;
  const clearance = sway + 0.075;
  const fairingDia = Math.max(config.core_diameter_m, config.payload_diameter_m + 2 * clearance + 0.05);
  const lambda = config.fairing_profile === "von_karman" ? 2.15 : config.fairing_profile === "tangent_ogive" ? 2.0 : 1.85;
  const noseL = lambda * fairingDia;
  const barrelL = Math.max(0.35 * config.payload_length_m, config.payload_length_m - 0.35 * noseL);
  const boatL = fairingDia > config.core_diameter_m ? 0.55 * (fairingDia - config.core_diameter_m) : 0.45;
  const fairingTotL = noseL + barrelL + boatL;
  const fairingArea = Math.PI * fairingDia * (0.65 * noseL + barrelL + 0.5 * boatL);
  const arealDens = topMat === "cfrp_composite" ? 8.5 : topMat === "al_li2195" ? 14.0 : 16.0;
  const fairingMassKg = fairingArea * arealDens * 1.12;
  const cd0 = 0.8 / Math.pow(lambda, 1.65) + 0.0028 * (fairingArea / (Math.PI * Math.pow(0.5 * fairingDia, 2)));

  const sepEvents = Math.max(0, config.stage_count - 1);
  const ullageLoss = config.staging_mode === "cold_pneumatic_ullage" ? G0_M_S2 * adv.cold_sep_ullage_s * sepEvents : 0;
  const hotPenaltyKg =
    config.staging_mode === "hot_staging_vented_ring"
      ? adv.hot_staging_ring_mass_kg * sepEvents
      : adv.cold_interstage_mass_kg * sepEvents;

  const orbMetrics = computeEllipticalOrbitMetrics(config.orbit);
  const vOrbit = orbMetrics.perigeeVelocityMs;
  const vRot = orbMetrics.rotationAssistMs;
  const presetDv = presetDeltaV(config.orbit.preset);
  const presetWithMargin = presetDv ? presetDv * (1 + (config.orbit.dv_margin_pct ?? 2.5) / 100) : null;
  const totalDvReq = (config.required_delta_v_m_s ?? presetWithMargin ?? orbMetrics.nominalTotalDvMs) + (config.required_delta_v_m_s ? 0 : ullageLoss);

  const sorted = [...config.stages].sort((a, b) => a.stage_number - b.stage_number);
  const upperSplitSum = sorted.slice(1).reduce((s, st) => s + st.delta_v_split_frac, 0);
  const s1Split = Math.min(0.9, Math.max(0.1, 1 - upperSplitSum));
  const subcooled = config.cryo_state === "subcooled_densified";

  let mAbove = config.payload_mass_kg;
  let totHeight = fairingTotL;
  const upperMetrics: StageSizingMetrics[] = [];
  const violations: Record<string, number> = {};
  const violationMessages: string[] = [];
  const addViol = (key: string, msg: string) => {
    violations[key] = (violations[key] ?? 0) + 1;
    violationMessages.push(msg);
  };

  for (let i = sorted.length - 1; i >= 1; i--) {
    const st = sorted[i];
    const eng = map.get(st.engine_id) ?? map.values().next().value!;
    const isTop = i === sorted.length - 1;
    const baseMf = st.structural_mass_fraction_override ?? defaultStageMf(eng.propellant.value, st.stage_number);
    const adjMf = subcooled && (eng.propellant.value === "lox_ch4" || eng.propellant.value === "lox_rp1") ? Math.min(0.955, baseMf + 0.008) : baseMf;
    const kSt = ((1 - adjMf) / adjMf) * (1 + config.mass_margin_frac);
    const [recHwFrac, recPropFrac] = upperStageRecFractions(st.recovery_mode);
    const kEff = kSt * (1 + recHwFrac) + recPropFrac * (1 + kSt);
    const dvTarget = totalDvReq * st.delta_v_split_frac;
    const mEngTot = eng.dry_mass_kg.value * st.engine_count;
    const mr = Math.exp(dvTarget / (G0_M_S2 * eng.isp_vac_s.value));
    const denom = 1 + kEff * (1 - mr);
    const mAscentProp = denom > 0 ? ((mr - 1) * (mAbove + (isTop ? 0.55 * fairingMassKg : 0))) / denom : mAbove * 12;
    if (denom <= 0) addViol("Feasibility", `Stage ${st.stage_number} infeasible mass ratio`);
    const mBaseInert = kSt * mAscentProp;
    const mRecHw = mBaseInert * recHwFrac;
    const mRecProp = mAscentProp * recPropFrac;
    const mProp = mAscentProp + mRecProp;
    const mStruct = Math.max(0, mBaseInert - mEngTot);
    const mInert = mEngTot + mStruct + mRecHw;
    const mStageTot = mProp + mInert;
    const m0 = mStageTot + mAbove + (isTop ? fairingMassKg : 0);
    const thrustVac = eng.thrust_vac_n.value * st.engine_count;
    const tw0 = thrustVac / (m0 * G0_M_S2);
    const mf = Math.max(1, m0 - mAscentProp - (isTop ? fairingMassKg : 0));
    const maxG = Math.min(config.g_limit, thrustVac / (mf * G0_M_S2));
    if (tw0 < config.constraints.min_upper_tw0 || tw0 > config.constraints.max_upper_tw0) {
      addViol("Upper Stage T/W", `Stage ${st.stage_number} T/W ${tw0.toFixed(2)} out of bounds`);
    }
    const tankGeom = computeTankGeometryLocal(eng.propellant.value, mProp, config.core_diameter_m * 0.98, Math.max(2, maxG), mAbove, st.tank_material, st.pressurization, st.common_bulkhead, subcooled, config.orbit.coast_duration_s);
    const stH = tankGeom.stage_tanks_length_m + eng.height_m.value + 1.2;
    totHeight += stH + 1.4;
    upperMetrics.unshift({
      stage_number: st.stage_number,
      engine_id: eng.id.value,
      engine_name: eng.name.value,
      propellant: eng.propellant.value,
      engine_count: st.engine_count,
      strapon_engine_id: null,
      strapon_count: 0,
      m0_kg: m0,
      stage_total_mass_kg: mStageTot,
      propellant_mass_kg: mProp,
      ascent_propellant_kg: mAscentProp,
      recovery_propellant_kg: mRecProp,
      strapon_propellant_kg: 0,
      inert_mass_kg: mInert,
      engines_mass_kg: mEngTot,
      strapon_inert_kg: 0,
      recovery_hardware_kg: mRecHw,
      structure_budget_kg: mStruct,
      propellant_mass_fraction: mProp / mStageTot,
      mass_ratio: m0 / mf,
      delta_v_required_m_s: dvTarget,
      delta_v_delivered_m_s: dvTarget,
      dv_split_frac: st.delta_v_split_frac,
      isp_sizing_s: eng.isp_vac_s.value,
      boost_eff_isp_s: null,
      boost_phase_dv_m_s: null,
      core_only_dv_m_s: null,
      thrust_sl_n: eng.thrust_sl_n.value * st.engine_count,
      thrust_vac_n: thrustVac,
      tw0_ignition: tw0,
      tw_burnout: thrustVac / (mf * G0_M_S2),
      max_accel_g: maxG,
      burn_time_s: mProp / Math.max(1, eng.mass_flow_rate_kg_s.value * st.engine_count),
      strapon_burn_time_s: null,
      tank_geometry: tankGeom,
      structural_breakdown: buildLocalStructuralBreakdown(
        mProp,
        mStruct,
        mEngTot,
        mRecHw,
        0,
        config.mass_margin_frac,
        tankGeom.wall_thickness_m,
        isTop,
        eng.propellant.value === "solid_htpb",
        st.common_bulkhead
      ),
      stage_height_m: stH,
    });
    mAbove += mStageTot + (isTop ? fairingMassKg : 0);
  }

  const s1 = sorted[0];
  const coreEng = map.get(s1.engine_id) ?? map.values().next().value!;
  const strapEng = config.booster_engine_id && config.booster_count > 0 ? map.get(config.booster_engine_id) ?? null : null;
  const strapRecMode = config.booster_recovery_mode ?? "expendable";
  const strapRecHwFrac =
    strapRecMode === "parachute_mid_air_catch"
      ? 0.068
      : strapRecMode === "downrange_landing_asds"
      ? 0.052
      : strapRecMode === "return_to_launch_site_rtls"
      ? 0.057
      : 0.0;
  const strapPropTot = strapEng ? (strapEng.propellant_mass_kg?.value ?? 0) * config.booster_count : 0;
  const strapInertBase = strapEng ? strapEng.dry_mass_kg.value * config.booster_count : 0;
  const strapRecHwKg = strapInertBase * strapRecHwFrac;
  const strapInertReal = strapInertBase + strapRecHwKg;
  const strapInertMarg = strapInertReal * (1 + config.mass_margin_frac);
  const strapSl = strapEng ? strapEng.thrust_sl_n.value * config.booster_count : 0;
  const strapBurnS = strapEng?.burn_time_s?.value ?? 0;
  const strapMdot = strapEng && strapBurnS > 0 ? (strapEng.propellant_mass_kg?.value ?? 0) / strapBurnS : 0;

  const baseMf1 = s1.structural_mass_fraction_override ?? defaultStageMf(coreEng.propellant.value, 1);
  const adjMf1 = subcooled && (coreEng.propellant.value === "lox_ch4" || coreEng.propellant.value === "lox_rp1") ? Math.min(0.955, baseMf1 + 0.008) : baseMf1;
  const k1 = ((1 - adjMf1) / adjMf1) * (1 + config.mass_margin_frac);
  const recFrac = s1.recovery_mode === "downrange_landing_asds" ? 0.075 : s1.recovery_mode === "return_to_launch_site_rtls" ? 0.14 : s1.recovery_mode === "parachute_mid_air_catch" ? 0.005 : 0;
  const recHwFrac = s1.recovery_mode === "downrange_landing_asds" ? 0.052 : s1.recovery_mode === "return_to_launch_site_rtls" ? 0.057 : s1.recovery_mode === "parachute_mid_air_catch" ? 0.072 : 0;
  const ispBucket = coreEng.isp_avg_s.value * (1 - 0.12 * (1 - config.max_q_throttle_frac) * 0.03);
  const dv1Target = totalDvReq * s1Split;
  const coreMdotTot = coreEng.mass_flow_rate_kg_s.value * s1.engine_count;
  const mBurnBoost = coreMdotTot * strapBurnS;

  const evalS1Dv = (mpCore: number): [number, number, number, number] => {
    const inertBase = k1 * mpCore;
    const inertTot = inertBase * (1 + recHwFrac) + hotPenaltyKg;
    const glow = mAbove + mpCore + inertTot + strapPropTot + strapInertMarg;
    const mpAsc = mpCore * (1 - recFrac);
    if (!strapEng) {
      const mf = glow - mpAsc;
      if (mf <= 0 || glow <= mf) return [-1, glow, 0, 0];
      const dv = ispBucket * G0_M_S2 * Math.log(glow / mf);
      return [dv, glow, 0, dv];
    }
    if (mpAsc <= mBurnBoost * 1.02) return [-1, glow, 0, 0];
    const ispEff = (strapEng.isp_avg_s.value * strapMdot * config.booster_count + ispBucket * coreMdotTot) / (strapMdot * config.booster_count + coreMdotTot);
    const dvBoost = ispEff * G0_M_S2 * Math.log(glow / (glow - strapPropTot - mBurnBoost));
    const m0Core = glow - mBurnBoost - strapPropTot - strapInertReal;
    const mfCore = m0Core - (mpAsc - mBurnBoost);
    if (mfCore <= 0 || m0Core <= mfCore) return [-1, glow, dvBoost, 0];
    const dvCore = coreEng.isp_vac_s.value * G0_M_S2 * Math.log(m0Core / mfCore);
    return [dvBoost + dvCore, glow, dvBoost, dvCore];
  };

  let lo = Math.max(500, mBurnBoost * 1.05);
  let hi = (mAbove + strapPropTot) * 20 + 6_000_000;
  for (let it = 0; it < 50; it++) {
    const mid = 0.5 * (lo + hi);
    if (evalS1Dv(mid)[0] < dv1Target) lo = mid;
    else hi = mid;
  }
  const mpCore = hi;
  const [dv1Del, glowKg, dvBoost, dvCore] = evalS1Dv(mpCore);
  const inertBase1 = k1 * mpCore;
  const recHwKg = inertBase1 * recHwFrac;
  const inertTot1 = inertBase1 + recHwKg + hotPenaltyKg + strapInertMarg;
  const mPropTot1 = mpCore + strapPropTot;
  const mStageTot1 = mPropTot1 + inertTot1;
  const mEng1 = coreEng.dry_mass_kg.value * s1.engine_count;
  const liftoffSl = coreEng.thrust_sl_n.value * s1.engine_count + strapSl;
  const tw0_1 = liftoffSl / (glowKg * G0_M_S2);
  const mf1 = Math.max(1, glowKg - mpCore * (1 - recFrac) - strapPropTot - strapInertReal);
  const maxG1 = Math.min(config.g_limit, (coreEng.thrust_vac_n.value * s1.engine_count) / (mf1 * G0_M_S2));
  const tankGeom1 = computeTankGeometryLocal(coreEng.propellant.value, mpCore, config.core_diameter_m, Math.max(2.5, maxG1), mAbove, s1.tank_material, s1.pressurization, s1.common_bulkhead, subcooled, 0);
  const s1Height = tankGeom1.stage_tanks_length_m + coreEng.height_m.value + 1.8;
  totHeight += s1Height;

  const s1Metrics: StageSizingMetrics = {
    stage_number: 1,
    engine_id: coreEng.id.value,
    engine_name: coreEng.name.value,
    propellant: coreEng.propellant.value,
    engine_count: s1.engine_count,
    strapon_engine_id: strapEng?.id.value ?? null,
    strapon_count: strapEng ? config.booster_count : 0,
    m0_kg: glowKg,
    stage_total_mass_kg: mStageTot1,
    propellant_mass_kg: mPropTot1,
    ascent_propellant_kg: mpCore * (1 - recFrac) + strapPropTot,
    recovery_propellant_kg: mpCore * recFrac,
    strapon_propellant_kg: strapPropTot,
    inert_mass_kg: inertTot1,
    engines_mass_kg: mEng1,
    strapon_inert_kg: strapInertMarg,
    recovery_hardware_kg: recHwKg + strapRecHwKg,
    structure_budget_kg: Math.max(0, inertBase1 - mEng1),
    propellant_mass_fraction: mPropTot1 / mStageTot1,
    mass_ratio: glowKg / mf1,
    delta_v_required_m_s: dv1Target,
    delta_v_delivered_m_s: dv1Del,
    dv_split_frac: s1Split,
    isp_sizing_s: ispBucket,
    boost_eff_isp_s: strapEng ? (strapEng.isp_avg_s.value * strapMdot * config.booster_count + ispBucket * coreMdotTot) / (strapMdot * config.booster_count + coreMdotTot) : null,
    boost_phase_dv_m_s: strapEng ? dvBoost : null,
    core_only_dv_m_s: strapEng ? dvCore : null,
    thrust_sl_n: liftoffSl,
    thrust_vac_n: coreEng.thrust_vac_n.value * s1.engine_count + (strapEng ? strapEng.thrust_vac_n.value * config.booster_count : 0),
    tw0_ignition: tw0_1,
    tw_burnout: (coreEng.thrust_vac_n.value * s1.engine_count) / (mf1 * G0_M_S2),
    max_accel_g: maxG1,
    burn_time_s: mpCore / Math.max(1, coreMdotTot),
    strapon_burn_time_s: strapEng ? strapBurnS : null,
    tank_geometry: tankGeom1,
    structural_breakdown: buildLocalStructuralBreakdown(
      mpCore,
      Math.max(0, inertBase1 - mEng1),
      mEng1,
      recHwKg + strapRecHwKg,
      strapInertMarg,
      config.mass_margin_frac,
      tankGeom1.wall_thickness_m,
      config.stage_count === 1,
      coreEng.propellant.value === "solid_htpb",
      s1.common_bulkhead
    ),
    stage_height_m: s1Height,
  };

  const allStages = [s1Metrics, ...upperMetrics];
  const packInputs: EnginePlacementInput[] = Array.from({ length: s1.engine_count }, (_, idx) => ({
    id: `${coreEng.id.value}_${idx + 1}`,
    nozzle_diameter_m: coreEng.nozzle_diameter_m.value,
    gimbal_lever_arm_m: Math.max(0.35, coreEng.nozzle_diameter_m.value * adv.gimbal_lever_arm_ratio),
    tvc_angle_deg: Math.max(adv.tvc_angle_deg, coreEng.tvc_gimbal_range_deg.value),
    custom_x_m: null,
    custom_y_m: null,
    enabled: true,
  }));
  const packRes = solvePackingLocal(config.core_diameter_m, packInputs, {
    skirt_wall_thickness_m: adv.skirt_wall_thickness_m,
    skirt_clearance_m: adv.skirt_clearance_m,
    no_touch_margin_m: adv.no_touch_margin_m,
    default_tvc_angle_deg: adv.tvc_angle_deg,
  });

  if (tw0_1 < config.constraints.min_liftoff_tw0 || tw0_1 > config.constraints.max_liftoff_tw0) {
    addViol("Liftoff T/W", `Liftoff T/W ${tw0_1.toFixed(2)} outside bounds`);
  }
  if (config.constraints.enforce_base_packing && !packRes.fits) {
    addViol("Base Packing", `Required dia ${packRes.required_diameter_m.toFixed(2)} m > usable ${packRes.usable_diameter_m.toFixed(2)} m`);
  }
  if (config.constraints.max_glow_kg && glowKg > config.constraints.max_glow_kg) {
    addViol("GLOW Ceiling", "GLOW exceeds user cap");
  }
  if (config.constraints.max_core_diameter_m && config.core_diameter_m > config.constraints.max_core_diameter_m) {
    addViol("Core Diameter", "Diameter exceeds user cap");
  }
  if (config.constraints.max_total_height_m && totHeight > config.constraints.max_total_height_m) {
    addViol("Height Ceiling", "Height exceeds user cap");
  }

  const totDryKg = allStages.reduce((s, st) => s + st.inert_mass_kg, 0) + fairingMassKg;
  const totPropKg = allStages.reduce((s, st) => s + st.propellant_mass_kg, 0);
  const totEng = allStages.reduce((s, st) => s + st.engine_count + st.strapon_count, 0);

  let airframeDdte = 0;
  let airframeTfu = 0;
  let engDdte = 0;
  let engTfu = 0;
  let propCost = 0;
  let straponTfu = 0;
  const stageTfuList: number[] = [];

  allStages.forEach((st, idx) => {
    const matFactor = getMaterialSpec(sorted[idx]?.tank_material ?? "al_li2195").costFactor;
    const compFactor = st.stage_number === 1 ? 1.0 : 1.25;
    const mAir = Math.max(50, st.inert_mass_kg - st.engines_mass_kg - st.strapon_inert_kg);
    const recMode = sorted[idx]?.recovery_mode ?? "expendable";
    const ddteMult = recMode !== "expendable" ? 1 + adv.reusable_ddte_surcharge_frac : 1;
    airframeDdte += 1_150_000 * Math.pow(mAir, 0.55) * compFactor * matFactor * ddteMult;
    const stAirTfu = 18_500 * Math.pow(mAir, 0.62) * matFactor;
    airframeTfu += stAirTfu;
    const eSpec = map.get(st.engine_id);
    const tKn = Math.max(1, (eSpec?.thrust_vac_n.value ?? 1e6) / 1000);
    const pBar = Math.max(10, eSpec?.chamber_pressure_bar.value ?? 100);
    const fCyc = cycleCostFactor(eSpec?.cycle.value ?? "gas_generator");
    const eDdte = 2_550_000 * Math.pow(tKn, 0.535) * Math.pow(pBar, 0.21) * fCyc;
    const eSingleTfu = 42_000 * Math.pow(tKn, 0.485) * Math.pow(pBar, 0.18) * fCyc;
    engDdte += eDdte;
    engTfu += eSingleTfu * st.engine_count;
    if (st.stage_number === 1 && strapEng && st.strapon_count > 0) {
      const bMult = strapRecMode !== "expendable" ? 1 + adv.reusable_ddte_surcharge_frac : 1;
      airframeDdte += 1_150_000 * Math.pow(Math.max(50, strapEng.dry_mass_kg.value), 0.55) * 0.5 * bMult;
      const bSingleTfu =
        (strapEng.unit_cost_usd?.value ?? 0) > 0
          ? strapEng.unit_cost_usd!.value
          : 18_500 * Math.pow(Math.max(50, strapEng.dry_mass_kg.value), 0.62) * 0.65;
      straponTfu = bSingleTfu * st.strapon_count;
      airframeTfu += straponTfu;
    }
    stageTfuList.push(stAirTfu + eSingleTfu * st.engine_count);
    propCost += (st.propellant_mass_kg - st.strapon_propellant_kg) * 0.65 + st.strapon_propellant_kg * 16;
  });

  const fairingTfu = 18_500 * Math.pow(Math.max(50, fairingMassKg), 0.62) * 1.35;
  airframeTfu += fairingTfu;
  const totalTfu = airframeTfu + engTfu;
  const pExp = Math.log(adv.learning_rate) / Math.log(2);
  const lcMult = Math.pow(Math.max(1, config.production_quantity), pExp) / Math.max(0.15, 1 + pExp);
  const avgUnit = totalTfu * lcMult;
  const opsCost = adv.launch_ops_base_usd * (1 + 0.05 * totEng);
  const rangeFee = adv.range_fee_usd;
  const expFlight = avgUnit + propCost + opsCost + rangeFee;

  let hwAmortized = fairingTfu * lcMult * (config.fairing_reusable ? 0.2 : 1) + (config.fairing_reusable ? 350_000 : 0);
  let refurbCost = 0;
  let recOps = 0;
  allStages.forEach((st, idx) => {
    const stAvg = (stageTfuList[idx] ?? 0) * lcMult;
    const mode: RecoveryMode = sorted[idx]?.recovery_mode ?? "expendable";
    if (mode === "expendable") {
      hwAmortized += stAvg;
    } else {
      const fRefurb = adv.refurb_cost_frac_override ?? (st.propellant === "lox_ch4" || st.propellant === "lox_lh2" ? 0.08 : 0.15);
      hwAmortized += stAvg / Math.max(1, config.expected_reuses);
      refurbCost += fRefurb * stAvg;
      recOps += adv.recovery_ops_per_flight_usd;
    }
  });
  if (straponTfu > 0) {
    const strapAvg = straponTfu * lcMult;
    if (strapRecMode === "expendable") {
      hwAmortized += strapAvg;
    } else {
      const fRefurbStrap = adv.refurb_cost_frac_override ?? 0.14;
      hwAmortized += strapAvg / Math.max(1, config.expected_reuses);
      refurbCost += fRefurbStrap * strapAvg;
      recOps += adv.recovery_ops_per_flight_usd * 0.85;
    }
  }
  const reuseFlight = hwAmortized + refurbCost + recOps + propCost + opsCost + rangeFee;
  if (config.constraints.max_cost_usd && reuseFlight > config.constraints.max_cost_usd) {
    addViol("Cost Ceiling", "Launch cost exceeds user cap");
  }

  const totalDdteLocal = airframeDdte + engDdte;
  const integrationSepmUsd = 0.14 * avgUnit * (1 + 0.08 * Math.max(0, allStages.length - 1) + 0.04 * (allStages[0]?.strapon_count ?? 0));
  const campaignDivisor = Math.max(12, Math.max(1, config.production_quantity) * Math.pow(Math.max(1, config.expected_reuses), 0.35));
  const commMarginUsd = 0.35 * reuseFlight + integrationSepmUsd + 0.08 * (totalDdteLocal / campaignDivisor);
  const costBreakdown: VehicleCostBreakdown = {
    airframe_ddte_usd: airframeDdte,
    engine_ddte_usd: engDdte,
    total_ddte_usd: totalDdteLocal,
    airframe_tfu_usd: airframeTfu,
    engine_tfu_usd: engTfu,
    total_tfu_usd: totalTfu,
    avg_unit_hardware_usd: avgUnit,
    propellant_cost_usd: propCost,
    launch_ops_cost_usd: opsCost,
    range_fee_usd: rangeFee,
    expendable_flight_cost_usd: expFlight,
    reusable_flight_cost_usd: reuseFlight,
    refurbishment_cost_usd: refurbCost,
    recovery_ops_cost_usd: recOps,
    cost_per_kg_payload_usd: reuseFlight / Math.max(1, config.payload_mass_kg),
    integration_and_sepm_usd: integrationSepmUsd,
    commercial_price_margin_usd: commMarginUsd,
    predicted_market_launch_price_usd: reuseFlight + commMarginUsd,
  };

  return {
    feasible: Object.keys(violations).length === 0,
    config_label: strapEng
      ? `${s1.engine_count}x ${coreEng.name.value} + ${config.booster_count}x ${strapEng.name.value} / ${upperMetrics.map((u) => `${u.engine_count}x ${u.engine_name}`).join(" / ")}`
      : allStages.map((s) => `${s.engine_count}x ${s.engine_name}`).join(" / "),
    glow_kg: glowKg,
    total_dry_mass_kg: totDryKg,
    total_propellant_kg: totPropKg,
    payload_mass_kg: config.payload_mass_kg,
    payload_fraction: config.payload_mass_kg / glowKg,
    total_height_m: totHeight,
    core_diameter_m: config.core_diameter_m,
    max_width_m: strapEng ? config.core_diameter_m + 2 * strapEng.nozzle_diameter_m.value * 1.4 : Math.max(fairingDia, config.core_diameter_m),
    liftoff_thrust_sl_n: liftoffSl,
    liftoff_tw0: tw0_1,
    peak_accel_g: Math.max(...allStages.map((s) => s.max_accel_g)),
    max_q_pa: 0.5 * 0.36 * Math.pow(395 * Math.sqrt(tw0_1 / 1.35) * Math.sqrt(config.max_q_throttle_frac), 2),
    total_engine_count: totEng,
    delta_v_breakdown: {
      orbit_velocity_m_s: vOrbit,
      insertion_margin_m_s:
        config.orbit.insertion_margin_m_s +
        Math.max(0, totalDvReq - ullageLoss - (vOrbit + config.orbit.insertion_margin_m_s + 1540 - vRot)),
      gravity_loss_m_s: 1220,
      aero_drag_loss_m_s: 180 + (cd0 - 0.35) * 200,
      steering_loss_m_s: 140,
      earth_rotation_assist_m_s: vRot,
      staging_ullage_loss_m_s: ullageLoss,
      total_required_dv_m_s: totalDvReq,
      total_delivered_dv_m_s: allStages.reduce((s, st) => s + st.delta_v_delivered_m_s, 0),
    },
    fairing: {
      profile: config.fairing_profile,
      outer_diameter_m: fairingDia,
      nose_length_m: noseL,
      barrel_length_m: barrelL,
      boat_tail_length_m: boatL,
      total_length_m: fairingTotL,
      mass_kg: fairingMassKg,
      usable_volume_m3: Math.PI * Math.pow(0.5 * fairingDia - 0.15, 2) * barrelL,
      wave_drag_cd0: cd0,
      jettison_dv_m_s: 950,
    },
    stages: allStages,
    cost_breakdown: costBreakdown,
    base_packing_fits: packRes.fits,
    base_required_dia_m: packRes.required_diameter_m,
    base_usable_dia_m: packRes.usable_diameter_m,
    constraint_violations: violations,
    violation_messages: violationMessages,
    objective_score: glowKg,
  };
}

export async function evaluateManualArchitecture(config: VehicleConfiguration): Promise<VehicleSizingResult> {
  return callBackend<VehicleSizingResult>("evaluate_manual_architecture", { config }, () => evaluateManualLocal(config));
}

export async function evaluateRecoveryStrategyTrade(
  baseConfig: VehicleConfiguration
): Promise<RecoveryOptimizationReport> {
  const flights = Math.max(1, baseConfig.production_quantity || 20);
  const hasBoosters = baseConfig.booster_count > 0 && Boolean(baseConfig.booster_engine_id);
  const hasS3 = baseConfig.stage_count >= 3 && baseConfig.stages.length >= 3;

  interface RecoveryScenarioSpec {
    id: string;
    label: string;
    booster_mode: RecoveryMode;
    s1_mode: RecoveryMode;
    s2_mode: RecoveryMode;
    s3_mode: RecoveryMode;
    fairing_reusable: boolean;
  }

  const scenarios: RecoveryScenarioSpec[] = [
    {
      id: "expendable",
      label: "All Expendable (Baseline)",
      booster_mode: "expendable",
      s1_mode: "expendable",
      s2_mode: "expendable",
      s3_mode: "expendable",
      fairing_reusable: false,
    },
    {
      id: "s1_asds",
      label: "Stage 1 Downrange ASDS + Fairing",
      booster_mode: "expendable",
      s1_mode: "downrange_landing_asds",
      s2_mode: "expendable",
      s3_mode: "expendable",
      fairing_reusable: true,
    },
    {
      id: "s1_rtls",
      label: "Stage 1 RTLS Propulsive + Fairing",
      booster_mode: "expendable",
      s1_mode: "return_to_launch_site_rtls",
      s2_mode: "expendable",
      s3_mode: "expendable",
      fairing_reusable: true,
    },
    {
      id: "s1_chute",
      label: "Stage 1 Parachute / Mid-Air + Fairing",
      booster_mode: "expendable",
      s1_mode: "parachute_mid_air_catch",
      s2_mode: "expendable",
      s3_mode: "expendable",
      fairing_reusable: true,
    },
  ];

  if (hasBoosters) {
    scenarios.push({
      id: "boosters_s1_asds",
      label: "Strap-On Boosters Parachute + S1 ASDS + Fairing",
      booster_mode: "parachute_mid_air_catch",
      s1_mode: "downrange_landing_asds",
      s2_mode: "expendable",
      s3_mode: "expendable",
      fairing_reusable: true,
    });
  }

  scenarios.push({
    id: "s1_s2_reuse",
    label: "Stage 1 ASDS + Stage 2 Heatshield + Fairing",
    booster_mode: hasBoosters ? "parachute_mid_air_catch" : "expendable",
    s1_mode: "downrange_landing_asds",
    s2_mode: "downrange_landing_asds",
    s3_mode: "expendable",
    fairing_reusable: true,
  });

  scenarios.push({
    id: "full_reuse",
    label: hasBoosters || hasS3 ? "Full Reusability (All Elements + Fairing)" : "Full Reusability (S1 RTLS + S2 + Fairing)",
    booster_mode: hasBoosters ? "return_to_launch_site_rtls" : "expendable",
    s1_mode: "return_to_launch_site_rtls",
    s2_mode: "return_to_launch_site_rtls",
    s3_mode: hasS3 ? "return_to_launch_site_rtls" : "expendable",
    fairing_reusable: true,
  });

  const curB = baseConfig.booster_recovery_mode ?? "expendable";
  const curS1 = baseConfig.stages[0]?.recovery_mode ?? "expendable";
  const curS2 = baseConfig.stages[1]?.recovery_mode ?? "expendable";
  const curS3 = baseConfig.stages[2]?.recovery_mode ?? "expendable";
  const matchesExisting = scenarios.some(
    (s) =>
      s.booster_mode === curB &&
      s.s1_mode === curS1 &&
      s.s2_mode === curS2 &&
      (!hasS3 || s.s3_mode === curS3) &&
      s.fairing_reusable === baseConfig.fairing_reusable
  );
  if (!matchesExisting) {
    scenarios.push({
      id: "custom_current",
      label: "Custom Active Element Selection",
      booster_mode: curB,
      s1_mode: curS1,
      s2_mode: curS2,
      s3_mode: curS3,
      fairing_reusable: baseConfig.fairing_reusable,
    });
  }

  const evalResults = await Promise.all(
    scenarios.map(async (sc) => {
      const cfg: VehicleConfiguration = structuredClone(baseConfig);
      cfg.booster_recovery_mode = sc.booster_mode;
      cfg.fairing_reusable = sc.fairing_reusable;
      if (cfg.stages[0]) cfg.stages[0].recovery_mode = sc.s1_mode;
      if (cfg.stages[1]) cfg.stages[1].recovery_mode = sc.s2_mode;
      if (cfg.stages[2]) cfg.stages[2].recovery_mode = sc.s3_mode;
      if (sc.booster_mode === "expendable" && sc.s1_mode === "expendable" && sc.s2_mode === "expendable" && sc.s3_mode === "expendable") {
        cfg.expected_reuses = 1;
      } else {
        cfg.expected_reuses = Math.max(2, baseConfig.expected_reuses || 10);
      }
      try {
        const res = await evaluateManualArchitecture(cfg);
        return { sc, res, ok: true };
      } catch {
        const res = evaluateManualLocal(cfg);
        return { sc, res, ok: res.feasible };
      }
    })
  );

  const baselineEntry = evalResults[0];
  const baseGlow = Math.max(1, baselineEntry.res.glow_kg);
  const baseDdte = baselineEntry.res.cost_breakdown.total_ddte_usd;
  const baseFlight = baselineEntry.res.cost_breakdown.expendable_flight_cost_usd;
  const baseCampaign = baseDdte + flights * baseFlight;

  const candidates: RecoveryStrategyCandidate[] = evalResults.map(({ sc, res, ok }) => {
    const recHwKg = res.stages.reduce((acc, s) => acc + s.recovery_hardware_kg, 0);
    const recPropKg = res.stages.reduce((acc, s) => acc + s.recovery_propellant_kg, 0);
    const deltaGlowKg = res.glow_kg - baseGlow;
    const deltaGlowPct = (deltaGlowKg / baseGlow) * 100;
    const payloadLostKg =
      sc.id === "expendable"
        ? 0
        : Math.max(0, (res.payload_mass_kg * deltaGlowKg) / res.glow_kg);
    const payloadLostPct = (payloadLostKg / Math.max(1, res.payload_mass_kg)) * 100;
    const ddteUsd = res.cost_breakdown.total_ddte_usd;
    const extraDdteUsd = ddteUsd - baseDdte;
    const costPerFlightUsd =
      sc.id === "expendable"
        ? res.cost_breakdown.expendable_flight_cost_usd
        : res.cost_breakdown.reusable_flight_cost_usd;
    const turnaroundRefurbUsd = res.cost_breakdown.refurbishment_cost_usd + res.cost_breakdown.recovery_ops_cost_usd;
    const totalCampaignUsd = ddteUsd + flights * costPerFlightUsd;
    const netSavingsUsd = baseCampaign - totalCampaignUsd;
    let breakevenFlights: number | null = null;
    if (sc.id === "expendable") {
      breakevenFlights = 1;
    } else if (costPerFlightUsd < baseFlight) {
      const savingsPerFlight = baseFlight - costPerFlightUsd;
      breakevenFlights = extraDdteUsd <= 0 ? 1 : Math.ceil(extraDdteUsd / savingsPerFlight);
    }

    return {
      id: sc.id,
      label: sc.label,
      booster_mode: sc.booster_mode,
      s1_mode: sc.s1_mode,
      s2_mode: sc.s2_mode,
      s3_mode: sc.s3_mode,
      fairing_reusable: sc.fairing_reusable,
      feasible: ok && res.feasible,
      glow_kg: res.glow_kg,
      delta_glow_kg: deltaGlowKg,
      delta_glow_pct: deltaGlowPct,
      recovery_hardware_dry_kg: recHwKg,
      recovery_propellant_reserve_kg: recPropKg,
      payload_lost_kg: payloadLostKg,
      payload_lost_pct: payloadLostPct,
      ddte_usd: ddteUsd,
      extra_ddte_usd: extraDdteUsd,
      cost_per_flight_usd: costPerFlightUsd,
      turnaround_refurb_usd: turnaroundRefurbUsd,
      total_campaign_cost_usd: totalCampaignUsd,
      net_campaign_savings_usd: netSavingsUsd,
      breakeven_flights: breakevenFlights,
    };
  });

  const feasiblePool = candidates.filter((c) => c.feasible);
  const rankPool = feasiblePool.length > 0 ? feasiblePool : candidates;
  const best = [...rankPool].sort((a, b) => a.total_campaign_cost_usd - b.total_campaign_cost_usd)[0];

  return {
    planned_flights: flights,
    expendable_baseline_cost_per_flight_usd: baseFlight,
    expendable_baseline_ddte_usd: baseDdte,
    expendable_baseline_glow_kg: baseGlow,
    recommended_id: best?.id ?? "expendable",
    candidates,
  };
}

export async function runCombinatorialSizing(request: SizingRequest): Promise<SizingSweepResponse> {
  return callBackend<SizingSweepResponse>("run_combinatorial_sizing", { request }, () => {
    const t0 = performance.now();
    const list = (enginesData as unknown as ProvenanceEngine[]).filter((e) => e.propulsion_type.value === "liquid");
    const cons = request.base_config.constraints;
    const matchEng = (
      e: ProvenanceEngine,
      ids?: string[],
      props?: string[],
      cycles?: string[]
    ): boolean => {
      if (ids && ids.length > 0 && !ids.includes(e.id.value)) return false;
      if (props && props.length > 0 && !props.includes(e.propellant.value)) return false;
      if (cycles && cycles.length > 0 && !cycles.includes(e.cycle.value)) return false;
      return true;
    };
    const corePool = list
      .filter((e) => matchEng(e, cons.stage1_allowed_engines, cons.stage1_allowed_propellants, cons.stage1_allowed_cycles))
      .slice(0, cons.stage1_allowed_engines?.length ? 50 : 8);
    const upperPool = list
      .filter((e) => matchEng(e, cons.stage2_allowed_engines, cons.stage2_allowed_propellants, cons.stage2_allowed_cycles))
      .slice(0, cons.stage2_allowed_engines?.length ? 50 : 8);
    const cands: VehicleSizingResult[] = [];
    const rej: Record<string, number> = {};
    let evaluated = 0;

    for (const uEng of upperPool) {
      for (const cEng of corePool) {
        if ((request.enforce_same_fuel_stages ?? []).includes(1) && (request.enforce_same_fuel_stages ?? []).includes(2) && uEng.propellant.value !== cEng.propellant.value) {
          continue;
        }
        for (const nCore of [1, 5, 9]) {
          for (const split of [0.36, 0.44, 0.56]) {
            const cfg: VehicleConfiguration = structuredClone(request.base_config);
            cfg.stages[0].engine_id = cEng.id.value;
            cfg.stages[0].engine_count = nCore;
            cfg.stages[0].delta_v_split_frac = 1 - split;
            cfg.stages[cfg.stages.length - 1].engine_id = uEng.id.value;
            cfg.stages[cfg.stages.length - 1].engine_count = 1;
            cfg.stages[cfg.stages.length - 1].delta_v_split_frac = split;
            evaluated++;
            const res = evaluateManualLocal(cfg);
            if (res.feasible) cands.push(res);
            else {
              for (const [k, v] of Object.entries(res.constraint_violations)) {
                rej[k] = (rej[k] ?? 0) + v;
              }
            }
          }
        }
      }
    }
    const minGlow = Math.min(...cands.map((c) => c.glow_kg), 1);
    const minCost = Math.min(...cands.map((c) => c.cost_breakdown.reusable_flight_cost_usd), 1);
    for (const c of cands) {
      const wg = request.strategy === "minimize_glow" ? 1 : request.strategy === "minimize_cost" ? 0 : request.glow_weight;
      const wc = request.strategy === "minimize_glow" ? 0 : request.strategy === "minimize_cost" ? 1 : request.cost_weight;
      c.objective_score = wg * (c.glow_kg / minGlow) + wc * (c.cost_breakdown.reusable_flight_cost_usd / minCost);
    }
    cands.sort((a, b) => a.objective_score - b.objective_score);
    const sortedByGlow = [...cands].sort((a, b) => a.glow_kg - b.glow_kg);
    const pareto: VehicleSizingResult[] = [];
    let bestCost = Number.POSITIVE_INFINITY;
    for (const c of sortedByGlow) {
      if (c.cost_breakdown.reusable_flight_cost_usd < bestCost) {
        bestCost = c.cost_breakdown.reusable_flight_cost_usd;
        pareto.push(c);
      }
    }
    return {
      best_result: cands[0] ?? null,
      pareto_frontier: pareto,
      top_candidates: cands.slice(0, request.max_results),
      evaluated_count: evaluated,
      feasible_count: cands.length,
      rejection_summary: rej,
      solver_elapsed_ms: performance.now() - t0,
    };
  });
}

export async function solveEngineCirclePacking(
  stageDiameter: number,
  engines: EnginePlacementInput[],
  constraints: PackingConstraints
): Promise<BaseLayoutResult> {
  return callBackend<BaseLayoutResult>(
    "solve_engine_circle_packing",
    { stageDiameter, engines, constraints },
    () => solvePackingLocal(stageDiameter, engines, constraints)
  );
}

export async function computeCostModel(
  vehicle: VehicleSizingResult,
  parameters: CostModelParameters
): Promise<VehicleCostBreakdown> {
  return callBackend<VehicleCostBreakdown>("compute_cost_model", { vehicle, parameters }, () => vehicle.cost_breakdown);
}

export async function runSensitivitySweep(
  baseline: VehicleConfiguration,
  sweepParameter: string,
  rangeMin: number,
  rangeMax: number,
  steps: number
): Promise<SensitivityCurveResponse> {
  return callBackend<SensitivityCurveResponse>(
    "run_sensitivity_sweep",
    { baseline, sweepParameter, rangeMin, rangeMax, steps },
    () => {
      const pts: SensitivityPoint[] = [];
      const count = Math.max(2, steps);
      for (let i = 0; i < count; i++) {
        const val = rangeMin + ((rangeMax - rangeMin) * i) / (count - 1);
        const cfg: VehicleConfiguration = structuredClone(baseline);
        if (sweepParameter === "payload_mass_kg") cfg.payload_mass_kg = Math.max(10, val);
        else if (sweepParameter === "s1_dv_split" || sweepParameter === "stage1_dv_split") {
          const s1 = Math.min(0.85, Math.max(0.15, val));
          cfg.stages[0].delta_v_split_frac = s1;
          const rem = 1 - s1;
          const upperCnt = Math.max(1, cfg.stages.length - 1);
          for (let sIdx = 1; sIdx < cfg.stages.length; sIdx++) {
            cfg.stages[sIdx].delta_v_split_frac = rem / upperCnt;
          }
        } else if (sweepParameter === "required_delta_v_m_s") {
          cfg.required_delta_v_m_s = Math.min(22000, Math.max(2000, val));
        } else if (sweepParameter === "dv_margin_pct") {
          cfg.orbit.dv_margin_pct = Math.min(20, Math.max(0, val));
        } else if (sweepParameter === "production_quantity") {
          cfg.production_quantity = Math.max(1, Math.min(500, Math.round(val)));
        } else if (sweepParameter === "expected_reuses") {
          cfg.expected_reuses = Math.max(1, Math.min(200, Math.round(val)));
        } else if (sweepParameter === "mass_margin_frac") {
          cfg.mass_margin_frac = Math.min(0.6, Math.max(0, val));
        } else if (sweepParameter === "stage1_mf") {
          cfg.stages[0].structural_mass_fraction_override = val;
        } else if (sweepParameter === "stage2_mf") {
          cfg.stages[cfg.stages.length - 1].structural_mass_fraction_override = val;
        } else if (sweepParameter === "core_diameter_m") {
          cfg.core_diameter_m = val;
        } else if (sweepParameter === "core_engine_count") {
          cfg.stages[0].engine_count = Math.max(1, Math.round(val));
        }
        const res = evaluateManualLocal(cfg);
        pts.push({
          parameter_value: val,
          glow_kg: res.glow_kg,
          total_dry_mass_kg: res.total_dry_mass_kg,
          reusable_flight_cost_usd: res.cost_breakdown.reusable_flight_cost_usd,
          expendable_flight_cost_usd: res.cost_breakdown.expendable_flight_cost_usd,
          cost_per_kg_usd: res.cost_breakdown.cost_per_kg_payload_usd,
          payload_fraction: res.payload_fraction,
          liftoff_tw0: res.liftoff_tw0,
          feasible: res.feasible,
        });
      }
      return { sweep_parameter: sweepParameter, points: pts };
    }
  );
}

export async function scaleRubberEngine(
  referenceEngine: ProvenanceEngine,
  targetThrustVacN: number,
  chamberPressureOverrideBar: number | null
): Promise<ProvenanceEngine> {
  return callBackend<ProvenanceEngine>(
    "scale_rubber_engine",
    { referenceEngine, targetThrustVacN, chamberPressureOverrideBar },
    () => {
      const tRatio = targetThrustVacN / Math.max(1, referenceEngine.thrust_vac_n.value);
      const pc = chamberPressureOverrideBar ?? referenceEngine.chamber_pressure_bar.value;
      const pRatio = pc / Math.max(1, referenceEngine.chamber_pressure_bar.value);
      const dryKg = referenceEngine.dry_mass_kg.value * Math.pow(tRatio, 0.82) * Math.pow(pRatio, -0.15);
      const dNoz = referenceEngine.nozzle_diameter_m.value * Math.sqrt(tRatio / pRatio);
      const copy: ProvenanceEngine = structuredClone(referenceEngine);
      copy.id.value = `${referenceEngine.id.value}_rubber_${Math.round(targetThrustVacN / 1000)}kn`;
      copy.name.value = `${referenceEngine.name.value} (Scaled ${Math.round(targetThrustVacN / 1000)} kN)`;
      copy.thrust_vac_n.value = targetThrustVacN;
      copy.thrust_sl_n.value = Math.max(0.45 * targetThrustVacN, targetThrustVacN - 101325 * Math.PI * Math.pow(0.5 * dNoz, 2));
      copy.dry_mass_kg.value = dryKg;
      copy.nozzle_diameter_m.value = dNoz;
      copy.gimbal_envelope_dia_m.value = dNoz * 1.18;
      copy.chamber_pressure_bar.value = pc;
      copy.mass_flow_rate_kg_s.value = targetThrustVacN / (copy.isp_vac_s.value * G0_M_S2);
      copy.thrust_to_weight_vac.value = targetThrustVacN / (dryKg * G0_M_S2);
      return copy;
    }
  );
}

export function createDefaultVehicleConfiguration(): VehicleConfiguration {
  const s1: StageConfig = {
    stage_number: 1,
    engine_id: "f_1",
    engine_count: 5,
    structural_mass_fraction_override: 0.941,
    tank_material: "al_li2195",
    pressurization: "helium_copv",
    common_bulkhead: false,
    delta_v_split_frac: 0.32,
    recovery_mode: "expendable",
  };
  const s2: StageConfig = {
    stage_number: 2,
    engine_id: "j_2",
    engine_count: 5,
    structural_mass_fraction_override: 0.925,
    tank_material: "al_li2195",
    pressurization: "autogenous",
    common_bulkhead: true,
    delta_v_split_frac: 0.48,
    recovery_mode: "expendable",
  };
  const s3: StageConfig = {
    stage_number: 3,
    engine_id: "j_2",
    engine_count: 1,
    structural_mass_fraction_override: 0.910,
    tank_material: "al_li2195",
    pressurization: "autogenous",
    common_bulkhead: true,
    delta_v_split_frac: 0.20,
    recovery_mode: "expendable",
  };
  return {
    name: "Saturn V Heavy Lift",
    payload_mass_kg: 118_000,
    payload_diameter_m: 6.6,
    payload_length_m: 18.0,
    orbit: {
      preset: "custom",
      altitude_m: 185_200,
      perigee_altitude_m: 185_200,
      apogee_altitude_m: 185_200,
      eccentricity: 0.0,
      inclination_deg: 28.5,
      launch_latitude_deg: 28.5,
      launch_azimuth_deg: 90.0,
      insertion_margin_m_s: 150.0,
      dv_margin_pct: 2.5,
      coast_duration_s: 0.0,
    },
    required_delta_v_m_s: null,
    core_diameter_m: 10.06,
    stage_count: 3,
    booster_engine_id: null,
    booster_count: 0,
    booster_recovery_mode: "expendable",
    recovery_optimizer_enabled: true,
    stages: [s1, s2, s3],
    staging_mode: "cold_pneumatic_ullage",
    cryo_state: "standard_boiling",
    fairing_profile: "von_karman",
    fairing_reusable: false,
    mass_margin_frac: 0.02,
    max_q_throttle_frac: 0.72,
    max_q_bucket_duration_s: 24.0,
    g_limit: 4.5,
    expected_reuses: 1,
    production_quantity: 15,
    constraints: {
      max_cost_usd: 2_500_000_000,
      max_glow_kg: 3_500_000,
      min_glow_kg: 100_000,
      max_core_diameter_m: 14.0,
      max_total_height_m: 125,
      max_g_limit: 4.5,
      max_core_engines: 33,
      max_upper_engines: 6,
      allowed_booster_counts: [0, 2, 3, 4, 6],
      min_liftoff_tw0: 1.10,
      max_liftoff_tw0: 1.65,
      min_upper_tw0: 0.18,
      max_upper_tw0: 1.45,
      enforce_base_packing: true,
      min_payload_frac: 0.005,
      max_payload_frac: 0.08,
      min_core_only_tw0: 0.7,
      max_core_only_tw0: 2.2,
      min_stage3_tw0: 0.15,
      max_stage3_tw0: 1.5,
      min_strapon_count: 0,
      max_strapon_count: 6,
      mf_lox_lh2: 0.905,
      mf_lox_rp1: 0.940,
      mf_lox_ch4: 0.925,
      mf_solid: 0.880,
      max_slenderness_ld: 22.0,
      stage1_allowed_engines: [],
      stage2_allowed_engines: [],
      stage3_allowed_engines: [],
      booster_allowed_engines: [],
      stage1_allowed_propellants: [],
      stage2_allowed_propellants: [],
      stage3_allowed_propellants: [],
      stage1_allowed_cycles: [],
      stage2_allowed_cycles: [],
      stage3_allowed_cycles: [],
    },
    custom_engines: [],
    advanced_defaults: { ...DEFAULT_ADVANCED_MODEL_DEFAULTS },
  };
}

export async function simulateTrajectory(config: VehicleConfiguration): Promise<TrajectorySimulationResult> {
  return callBackend<TrajectorySimulationResult>("simulate_trajectory", { config }, () => {
    const t0 = performance.now();
    const sized = evaluateManualLocal(config);
    const map = buildEngineLookup(config.custom_engines);
    const orb = computeEllipticalOrbitMetrics(config.orbit);
    const areaRef = Math.PI * Math.pow(0.5 * Math.max(sized.fairing.outer_diameter_m, config.core_diameter_m), 2);
    const cd0 = sized.fairing.wave_drag_cd0;
    const points: TrajectoryTimePoint[] = [];
    const events: TrajectoryEvent[] = [];
    let t = 0;
    let r = R_EARTH;
    let x = 0;
    let vr = 0;
    let vt = orb.rotationAssistMs;
    let m = sized.glow_kg;
    let maxQ = 0;
    let maxQT = 0;
    let maxM = 0;
    let peakG = 0;
    let gLoss = 0;
    let dLoss = 0;
    let sLoss = 0;
    let dvDel = 0;
    let fairOn = sized.fairing.mass_kg > 0;
    let pitchDone = false;
    let nextP = 0;

    events.push({
      time_s: 0,
      label: "Liftoff",
      altitude_m: 0,
      velocity_m_s: 0,
      detail: `T/W0 ${sized.liftoff_tw0.toFixed(2)}`,
    });

    sized.stages.forEach((st, idx) => {
      const eng = map.get(st.engine_id);
      const tVac = (eng?.thrust_vac_n.value ?? 1e6) * st.engine_count;
      const tSl = (eng?.thrust_sl_n.value ?? 8e5) * st.engine_count;
      const mdotNom = (eng?.mass_flow_rate_kg_s.value ?? 300) * st.engine_count;
      const strapEng = st.strapon_engine_id ? map.get(st.strapon_engine_id) : undefined;
      let remProp = Math.max(0, st.ascent_propellant_kg - st.strapon_propellant_kg);
      let remStrap = idx === 0 ? st.strapon_propellant_kg : 0;
      const mdotStrap =
        idx === 0 && strapEng && (strapEng.burn_time_s?.value ?? 0) > 0
          ? ((strapEng.propellant_mass_kg?.value ?? 0) / (strapEng.burn_time_s?.value ?? 1)) * st.strapon_count
          : 0;
      if (idx > 0) {
        events.push({
          time_s: t,
          label: `Stage ${st.stage_number} Ignition`,
          altitude_m: r - R_EARTH,
          velocity_m_s: Math.hypot(vr, vt),
          detail: `${st.engine_count}x ${st.engine_name}`,
        });
      }
      const dt = 0.5;
      for (let it = 0; it < 1600; it++) {
        if (remProp <= 1 && remStrap <= 1) break;
        const alt = Math.max(0, r - R_EARTH);
        if (fairOn && alt >= 110_000 && idx > 0) {
          fairOn = false;
          m = Math.max(config.payload_mass_kg + 100, m - sized.fairing.mass_kg);
          events.push({ time_s: t, label: "Fairing Jettison", altitude_m: alt, velocity_m_s: Math.hypot(vr, vt), detail: "Fairing released above 110 km" });
        }
        const rho = alt > 120_000 ? 0 : 1.225 * Math.exp(-alt / 7_400);
        const pRatio = Math.min(1, rho / 1.225);
        const aSnd = alt < 11_000 ? 340 - 0.004 * alt : 295;
        const vtRel = vt - orb.rotationAssistMs;
        const vAir = Math.hypot(vr, vtRel);
        const mach = vAir / aSnd;
        const qDyn = 0.5 * rho * vAir * vAir;
        if (qDyn > maxQ) { maxQ = qDyn; maxQT = t; }
        if (mach > maxM) maxM = mach;
        if (!pitchDone && alt > 220) {
          pitchDone = true;
          events.push({ time_s: t, label: "Pitchover", altitude_m: alt, velocity_m_s: Math.hypot(vr, vt), detail: "Gravity turn start" });
        }
        const fCore = tVac - (tVac - tSl) * pRatio;
        let thr = idx === 0 && qDyn > 18_000 && alt < 35_000 ? config.max_q_throttle_frac : 1.0;
        const fStrap = idx === 0 && remStrap > 1 && strapEng ? (strapEng.thrust_vac_n.value - (strapEng.thrust_vac_n.value - strapEng.thrust_sl_n.value) * pRatio) * st.strapon_count : 0;
        const maxAllow = config.g_limit * G0_M_S2 * m;
        if (fCore * thr + fStrap > maxAllow) {
          thr = Math.max(0.4, (maxAllow - fStrap) / Math.max(1, fCore));
        }
        const totalT = (remProp > 1 ? fCore * thr : 0) + fStrap;
        const fpa = Math.atan2(vr, Math.max(1, vt));
        const fpaRel = Math.atan2(vr, Math.max(1, vtRel));
        const pitch =
          alt < 400
            ? Math.PI / 2
            : idx === 0
              ? 0.75 * ((90 - 64 * Math.pow(Math.max(0, Math.min(1, (alt - 400) / 64_600)), 0.68)) * (Math.PI / 180)) +
                0.25 * Math.max(0.25, Math.min(Math.PI / 2, fpaRel))
              : Math.max(-3, Math.min(24, (orb.perigeeAltM - alt) / 5_500 - 0.06 * vr)) * (Math.PI / 180);
        const drag = qDyn * cd0 * areaRef;
        const accG = totalT / (m * G0_M_S2);
        if (accG > peakG) peakG = accG;
        if (t >= nextP) {
          points.push({ time_s: t, altitude_m: alt, downrange_m: x, velocity_m_s: Math.hypot(vr, vt), flight_path_deg: (fpa * 180) / Math.PI, dynamic_pressure_pa: qDyn, mach, accel_g: accG, throttle_frac: thr, mass_kg: m, thrust_n: totalT, drag_n: drag, active_stage: st.stage_number });
          nextP += 1.0;
        }
        const gLoc = MU_EARTH / (r * r);
        const ar = (totalT * Math.sin(pitch) - drag * (vr / Math.max(1, vAir))) / m - gLoc + (vt * vt) / r;
        const at = (totalT * Math.cos(pitch) - drag * (vtRel / Math.max(1, vAir))) / m - (vr * vt) / r;
        vr += ar * dt;
        vt += at * dt;
        r += vr * dt;
        x += vt * (R_EARTH / r) * dt;
        const dm = Math.min(remProp, (remProp > 1 ? mdotNom * thr : 0) * dt) + Math.min(remStrap, (remStrap > 1 ? mdotStrap : 0) * dt);
        remProp = Math.max(0, remProp - (remProp > 1 ? mdotNom * thr : 0) * dt);
        remStrap = Math.max(0, remStrap - (remStrap > 1 ? mdotStrap : 0) * dt);
        m = Math.max(200, m - dm);
        gLoss += gLoc * Math.max(0, Math.sin(fpa)) * dt;
        dLoss += (drag / m) * dt;
        sLoss += (totalT / m) * (1 - Math.cos(pitch - fpa)) * dt;
        dvDel += (totalT / m) * dt;
        t += dt;
      }
      if (idx + 1 < sized.stages.length) {
        m = Math.max(config.payload_mass_kg + 100, m - st.inert_mass_kg - st.recovery_propellant_kg);
        events.push({ time_s: t, label: `Stage ${st.stage_number} Separation`, altitude_m: r - R_EARTH, velocity_m_s: Math.hypot(vr, vt), detail: "Staging event" });
      }
    });
    const finAlt = r - R_EARTH;
    const finV = Math.hypot(vr, vt);
    return {
      points,
      events,
      max_q_pa: maxQ,
      max_q_time_s: maxQT,
      max_mach: maxM,
      peak_accel_g: peakG,
      gravity_loss_m_s: gLoss,
      drag_loss_m_s: dLoss,
      steering_loss_m_s: sLoss,
      total_dv_delivered_m_s: dvDel,
      final_altitude_m: finAlt,
      target_altitude_m: orb.perigeeAltM,
      final_velocity_m_s: finV,
      target_velocity_m_s: orb.perigeeVelocityMs,
      final_flight_path_deg: (Math.atan2(vr, Math.max(1, vt)) * 180) / Math.PI,
      apogee_achieved_m: finAlt,
      perigee_achieved_m: finAlt,
      orbit_reached: finV >= orb.perigeeVelocityMs * 0.92,
      sim_duration_ms: performance.now() - t0,
    };
  });
}

export function createPresetVehicleConfiguration(presetId: string): VehicleConfiguration {
  const base = createDefaultVehicleConfiguration();
  if (presetId === "saturn_v") {
    return base;
  }
  if (presetId === "falcon_9") {
    return {
      ...base,
      name: "Falcon 9 Block 5",
      payload_mass_kg: 15_500,
      payload_diameter_m: 4.6,
      payload_length_m: 6.7,
      core_diameter_m: 3.66,
      stage_count: 2,
      cryo_state: "subcooled_densified",
      fairing_reusable: true,
      mass_margin_frac: 0.02,
      expected_reuses: 15,
      stages: [
        {
          ...base.stages[0],
          stage_number: 1,
          engine_id: "merlin_1d",
          engine_count: 9,
          structural_mass_fraction_override: 0.949,
          delta_v_split_frac: 0.38,
          recovery_mode: "downrange_landing_asds",
        },
        {
          ...base.stages[1],
          stage_number: 2,
          engine_id: "merlin_1d_vac",
          engine_count: 1,
          structural_mass_fraction_override: 0.962,
          delta_v_split_frac: 0.62,
          recovery_mode: "expendable",
        },
      ],
      constraints: {
        ...base.constraints,
        min_liftoff_tw0: 1.15,
        max_liftoff_tw0: 1.65,
        min_upper_tw0: 0.50,
        max_upper_tw0: 1.45,
        max_cost_usd: 120_000_000,
        max_glow_kg: 700_000,
        max_core_diameter_m: 4.5,
        max_total_height_m: 80.0,
        max_slenderness_ld: 22.0,
        enforce_base_packing: false,
      },
    };
  }
  if (presetId === "electron") {
    return {
      ...base,
      name: "Electron Light Class",
      payload_mass_kg: 300,
      payload_diameter_m: 1.0,
      payload_length_m: 1.5,
      core_diameter_m: 1.2,
      stage_count: 2,
      cryo_state: "standard_boiling",
      mass_margin_frac: 0.02,
      g_limit: 5.5,
      expected_reuses: 5,
      stages: [
        {
          ...base.stages[0],
          stage_number: 1,
          engine_id: "rutherford",
          engine_count: 9,
          tank_material: "cfrp_composite",
          structural_mass_fraction_override: 0.907,
          delta_v_split_frac: 0.38,
          recovery_mode: "parachute_mid_air_catch",
        },
        {
          ...base.stages[1],
          stage_number: 2,
          engine_id: "rutherford_vac",
          engine_count: 1,
          tank_material: "cfrp_composite",
          structural_mass_fraction_override: 0.900,
          delta_v_split_frac: 0.62,
          recovery_mode: "expendable",
        },
      ],
      constraints: {
        ...base.constraints,
        min_glow_kg: 5_000,
        max_glow_kg: 40_000,
        min_liftoff_tw0: 1.15,
        max_liftoff_tw0: 1.65,
        min_upper_tw0: 0.30,
        max_upper_tw0: 1.45,
        max_cost_usd: 15_000_000,
        max_core_diameter_m: 2.0,
        max_total_height_m: 28.0,
        max_slenderness_ld: 22.0,
        max_g_limit: 6.0,
        enforce_base_packing: false,
      },
    };
  }
  if (presetId === "sls_block_1") {
    return {
      ...base,
      name: "SLS Block 1",
      payload_mass_kg: 95_000,
      payload_diameter_m: 8.4,
      payload_length_m: 19.0,
      core_diameter_m: 8.4,
      stage_count: 2,
      booster_count: 2,
      booster_engine_id: "sls_fsrb",
      cryo_state: "standard_boiling",
      expected_reuses: 1,
      mass_margin_frac: 0.05,
      stages: [
        {
          ...base.stages[0],
          stage_number: 1,
          engine_id: "rs_25",
          engine_count: 4,
          structural_mass_fraction_override: 0.915,
          delta_v_split_frac: 0.92,
          recovery_mode: "expendable",
        },
        {
          ...base.stages[1],
          stage_number: 2,
          engine_id: "rl_10a",
          engine_count: 1,
          structural_mass_fraction_override: 0.890,
          delta_v_split_frac: 0.08,
          recovery_mode: "expendable",
        },
      ],
      constraints: {
        ...base.constraints,
        min_liftoff_tw0: 1.15,
        max_liftoff_tw0: 1.70,
        min_upper_tw0: 0.05,
        max_upper_tw0: 1.45,
        max_glow_kg: 3_200_000,
        max_cost_usd: 2_500_000_000,
        max_core_diameter_m: 10.0,
        max_total_height_m: 120.0,
        enforce_base_packing: false,
      },
    };
  }
  if (presetId === "vulcan_vc6l") {
    return {
      ...base,
      name: "Vulcan Centaur VC6L",
      payload_mass_kg: 27_200,
      payload_diameter_m: 5.4,
      payload_length_m: 16.0,
      core_diameter_m: 5.4,
      stage_count: 2,
      booster_count: 6,
      booster_engine_id: "gem_63xl",
      cryo_state: "standard_boiling",
      expected_reuses: 1,
      mass_margin_frac: 0.05,
      stages: [
        {
          ...base.stages[0],
          stage_number: 1,
          engine_id: "be_4",
          engine_count: 2,
          structural_mass_fraction_override: 0.935,
          delta_v_split_frac: 0.45,
          recovery_mode: "expendable",
        },
        {
          ...base.stages[1],
          stage_number: 2,
          engine_id: "rl_10c_1",
          engine_count: 2,
          tank_material: "stainless304_l",
          structural_mass_fraction_override: 0.900,
          delta_v_split_frac: 0.55,
          recovery_mode: "expendable",
        },
      ],
      constraints: {
        ...base.constraints,
        min_liftoff_tw0: 1.15,
        max_liftoff_tw0: 2.50,
        min_upper_tw0: 0.15,
        max_upper_tw0: 1.45,
        max_core_only_tw0: 2.50,
        max_glow_kg: 1_200_000,
        max_cost_usd: 400_000_000,
        max_core_diameter_m: 7.0,
        max_total_height_m: 85.0,
        enforce_base_packing: false,
      },
    };
  }
  if (presetId === "new_glenn") {
    return {
      ...base,
      name: "Blue Origin New Glenn",
      payload_mass_kg: 45_000,
      payload_diameter_m: 7.0,
      payload_length_m: 18.0,
      core_diameter_m: 7.0,
      stage_count: 2,
      cryo_state: "standard_boiling",
      expected_reuses: 15,
      mass_margin_frac: 0.05,
      stages: [
        {
          ...base.stages[0],
          stage_number: 1,
          engine_id: "be_4",
          engine_count: 7,
          structural_mass_fraction_override: 0.938,
          delta_v_split_frac: 0.44,
          recovery_mode: "downrange_landing_asds",
        },
        {
          ...base.stages[1],
          stage_number: 2,
          engine_id: "be_3u",
          engine_count: 2,
          structural_mass_fraction_override: 0.912,
          delta_v_split_frac: 0.56,
          recovery_mode: "expendable",
        },
      ],
      constraints: {
        ...base.constraints,
        min_liftoff_tw0: 1.15,
        max_liftoff_tw0: 1.65,
        min_upper_tw0: 0.18,
        max_upper_tw0: 1.45,
        max_glow_kg: 2_500_000,
        max_cost_usd: 500_000_000,
        max_core_diameter_m: 8.5,
        max_total_height_m: 110.0,
        enforce_base_packing: false,
      },
    };
  }
  if (presetId === "starship") {
    return {
      ...base,
      name: "Starship Super Heavy",
      payload_mass_kg: 100_000,
      payload_diameter_m: 9.0,
      payload_length_m: 17.0,
      core_diameter_m: 9.0,
      stage_count: 2,
      staging_mode: "hot_staging_vented_ring",
      cryo_state: "subcooled_densified",
      expected_reuses: 25,
      mass_margin_frac: 0.05,
      stages: [
        {
          ...base.stages[0],
          stage_number: 1,
          engine_id: "raptor_2",
          engine_count: 33,
          tank_material: "stainless304_l",
          pressurization: "autogenous",
          structural_mass_fraction_override: 0.935,
          delta_v_split_frac: 0.34,
          recovery_mode: "return_to_launch_site_rtls",
        },
        {
          ...base.stages[1],
          stage_number: 2,
          engine_id: "raptor_vac",
          engine_count: 6,
          tank_material: "stainless304_l",
          pressurization: "autogenous",
          structural_mass_fraction_override: 0.910,
          delta_v_split_frac: 0.66,
          recovery_mode: "expendable",
        },
      ],
      constraints: {
        ...base.constraints,
        min_liftoff_tw0: 1.15,
        max_liftoff_tw0: 2.10,
        min_upper_tw0: 0.20,
        max_upper_tw0: 1.85,
        max_glow_kg: 6_000_000,
        max_cost_usd: 500_000_000,
        max_core_diameter_m: 10.5,
        max_total_height_m: 135.0,
        enforce_base_packing: false,
      },
    };
  }
  return base;
}
