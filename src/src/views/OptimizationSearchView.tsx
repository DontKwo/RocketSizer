import React, { useEffect, useMemo, useRef, useState } from "react";
import { adjustInflationUsd, convertFromSi, convertToSi, unitLabel, type UnitSystem } from "../config/units";
import {
  computeEllipticalOrbitMetrics,
  evaluateRecoveryStrategyTrade,
  runCombinatorialSizing,
} from "../api/tauriClient";
import type { ProvenanceEngine } from "../types/engine";
import type { ProvenanceVehicle } from "../types/vehicle";
import type {
  OptimizationStrategy,
  SizingSweepResponse,
  StageConfig,
  VehicleConfiguration,
  VehicleSizingResult,
} from "../types/sizing";
import { RocketSchematic } from "../components/visualizers/RocketSchematic";
import { DeltaVWaterfallChart, MassTreemapChart } from "../components/charts/TradeCharts";
import { DesignInspectorPanel } from "../components/inspector/DesignInspectorPanel";
import { DesignJustificationReport } from "../components/inspector/DesignJustificationReport";
import { OrbitGuideModal } from "../components/inputs/OrbitGuideModal";
import { StageCommonalityControl } from "../components/inputs/StageCommonalityControl";
import { ConstraintOverridePanel } from "../components/inputs/ConstraintOverridePanel";
import { RecoveryOptimizerPanel } from "../components/inputs/RecoveryOptimizerPanel";
import { AdvancedStageConstraintsPanel } from "../components/inputs/AdvancedStageConstraintsPanel";
import { AdvancedDefaultsPanel } from "../components/inputs/AdvancedDefaultsPanel";
import { FeasibilityBadge } from "../components/common/FeasibilityBadge";
import type { OrbitRegimeGuideEntry } from "../config/formatters";

export type ArchitectureClassKey = "2_stage" | "2_5_stage" | "3_stage" | "3_5_stage";

export interface ArchitectureSearchEntry {
  key: ArchitectureClassKey;
  title: string;
  subtitle: string;
  stageCount: 2 | 3;
  includeBoosters: boolean;
  config: VehicleConfiguration;
  response: SizingSweepResponse | null;
}

interface OptimizationSearchViewProps {
  config: VehicleConfiguration;
  onChangeConfig: (next: VehicleConfiguration) => void;
  engines: ProvenanceEngine[];
  vehicles: ProvenanceVehicle[];
  strategy: OptimizationStrategy;
  onChangeStrategy: (next: OptimizationStrategy) => void;
  unitSystem: UnitSystem;
  currencyYear: number;
  onOpenInSingleConfig: (cfg: VehicleConfiguration, res: VehicleSizingResult) => void;
}

const ARCH_DEFS: Array<{
  key: ArchitectureClassKey;
  title: string;
  subtitle: string;
  stageCount: 2 | 3;
  includeBoosters: boolean;
}> = [
  {
    key: "2_stage",
    title: "2-Stage",
    subtitle: "Core + Upper Stage",
    stageCount: 2,
    includeBoosters: false,
  },
  {
    key: "2_5_stage",
    title: "2.5-Stage",
    subtitle: "Core + Boosters + Upper",
    stageCount: 2,
    includeBoosters: true,
  },
  {
    key: "3_stage",
    title: "3-Stage",
    subtitle: "Core + S2 + S3",
    stageCount: 3,
    includeBoosters: false,
  },
  {
    key: "3_5_stage",
    title: "3.5-Stage",
    subtitle: "Core + Boosters + S2 + S3",
    stageCount: 3,
    includeBoosters: true,
  },
];

const EARTH_RADIUS_M = 6_378_137.0;

function buildArchConfig(
  base: VehicleConfiguration,
  stageCount: 2 | 3,
  includeBoosters: boolean
): VehicleConfiguration {
  const s1Template: StageConfig = base.stages[0] ?? {
    stage_number: 1,
    engine_id: "merlin_1d",
    engine_count: 9,
    structural_mass_fraction_override: null,
    tank_material: "al_li2195",
    pressurization: "helium_copv",
    common_bulkhead: true,
    delta_v_split_frac: 0.38,
    recovery_mode: "expendable",
  };
  const s2Template: StageConfig = base.stages[base.stages.length - 1] ?? {
    stage_number: 2,
    engine_id: "merlin_1d_vac",
    engine_count: 1,
    structural_mass_fraction_override: null,
    tank_material: "al_li2195",
    pressurization: "helium_copv",
    common_bulkhead: true,
    delta_v_split_frac: 0.62,
    recovery_mode: "expendable",
  };

  const stages: StageConfig[] =
    stageCount === 2
      ? [
          { ...s1Template, stage_number: 1, delta_v_split_frac: 0.4 },
          { ...(base.stages[1] ?? s2Template), stage_number: 2, delta_v_split_frac: 0.6 },
        ]
      : [
          { ...s1Template, stage_number: 1, delta_v_split_frac: 0.38 },
          { ...(base.stages[1] ?? s2Template), stage_number: 2, delta_v_split_frac: 0.34 },
          {
            ...(base.stages[2] ?? s2Template),
            stage_number: 3,
            engine_id: base.stages[2]?.engine_id ?? "rl_10c_1",
            engine_count: 1,
            delta_v_split_frac: 0.28,
            recovery_mode: base.stages[2]?.recovery_mode ?? "expendable",
          },
        ];

  return {
    ...base,
    stage_count: stageCount,
    booster_count: includeBoosters ? 2 : 0,
    booster_engine_id: includeBoosters ? base.booster_engine_id ?? "gem_63xl" : null,
    stages,
  };
}

function materializeCandidateConfig(
  archCfg: VehicleConfiguration,
  result: VehicleSizingResult
): VehicleConfiguration {
  const mappedStages: StageConfig[] = result.stages.map((st, idx) => ({
    ...(archCfg.stages[idx] ?? archCfg.stages[0]),
    stage_number: st.stage_number,
    engine_id: st.engine_id,
    engine_count: st.engine_count,
    delta_v_split_frac: st.dv_split_frac,
  }));
  return {
    ...archCfg,
    name: `${result.config_label}`,
    stage_count: result.stages.length,
    booster_count: result.stages[0]?.strapon_count ?? 0,
    booster_engine_id: result.stages[0]?.strapon_engine_id ?? null,
    stages: mappedStages,
  };
}

function rankCandidatesForBalance(
  candidates: VehicleSizingResult[],
  glowWeight: number,
  costWeight: number
): VehicleSizingResult[] {
  if (candidates.length <= 1) return candidates;
  const minGlow = Math.max(1, Math.min(...candidates.map((c) => c.glow_kg)));
  const minCost = Math.max(1, Math.min(...candidates.map((c) => c.cost_breakdown.reusable_flight_cost_usd)));
  const sum = Math.max(1e-6, glowWeight + costWeight);
  const wG = glowWeight / sum;
  const wC = costWeight / sum;
  return [...candidates].sort((a, b) => {
    const scoreA = wG * (a.glow_kg / minGlow) + wC * (a.cost_breakdown.reusable_flight_cost_usd / minCost);
    const scoreB = wG * (b.glow_kg / minGlow) + wC * (b.cost_breakdown.reusable_flight_cost_usd / minCost);
    return scoreA - scoreB;
  });
}

export function OptimizationSearchView({
  config,
  onChangeConfig,
  engines,
  vehicles,
  strategy,
  onChangeStrategy,
  unitSystem,
  currencyYear,
  onOpenInSingleConfig,
}: OptimizationSearchViewProps): React.ReactElement {
  const [enabledArchs, setEnabledArchs] = useState<Record<ArchitectureClassKey, boolean>>({
    "2_stage": true,
    "2_5_stage": true,
    "3_stage": true,
    "3_5_stage": true,
  });
  const [costWeightPct, setCostWeightPct] = useState<number>(() =>
    strategy === "minimize_glow" ? 0 : strategy === "minimize_cost" ? 100 : 35
  );
  const [enforceEngineStages, setEnforceEngineStages] = useState<number[]>([]);
  const [enforceFuelStages, setEnforceFuelStages] = useState<number[]>([]);
  const [autoConstraints, setAutoConstraints] = useState<boolean>(true);
  const [showOrbitGuide, setShowOrbitGuide] = useState<boolean>(false);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [archResults, setArchResults] = useState<Record<ArchitectureClassKey, ArchitectureSearchEntry | null>>({
    "2_stage": null,
    "2_5_stage": null,
    "3_stage": null,
    "3_5_stage": null,
  });
  const [selectedArchKey, setSelectedArchKey] = useState<ArchitectureClassKey>("2_stage");
  const [detailTab, setDetailTab] = useState<"visuals" | "tables">("visuals");
  const [hasAutoRun, setHasAutoRun] = useState<boolean>(false);
  const searchRunRef = useRef<number>(0);

  const glowWeightPct = 100 - costWeightPct;
  const mUnit = unitLabel("mass", unitSystem);
  const lenUnit = unitLabel("length", unitSystem);
  const altUnit = unitLabel("altitude", unitSystem);
  const velUnit = unitLabel("velocity", unitSystem);
  const costPerMassUnit = unitLabel("cost_per_mass", unitSystem);

  const engineLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const eng of engines) map.set(eng.id.value, eng.name.value);
    for (const eng of config.custom_engines) map.set(eng.id.value, eng.name.value);
    return map;
  }, [engines, config.custom_engines]);

  const orbitMetrics = useMemo(() => computeEllipticalOrbitMetrics(config.orbit), [config.orbit]);
  const perigeeM = orbitMetrics.perigeeAltM;
  const apogeeM = orbitMetrics.apogeeAltM;
  const eccentricityVal = orbitMetrics.eccentricity;
  const rpDisplay = convertFromSi(EARTH_RADIUS_M + perigeeM, "altitude", unitSystem);
  const raDisplay = convertFromSi(EARTH_RADIUS_M + apogeeM, "altitude", unitSystem);

  const handleBalanceChange = (nextCostPct: number): void => {
    const clamped = Math.max(0, Math.min(100, Math.round(nextCostPct)));
    setCostWeightPct(clamped);
    if (clamped === 0) onChangeStrategy("minimize_glow");
    else if (clamped === 100) onChangeStrategy("minimize_cost");
    else onChangeStrategy("balanced_trade");
  };

  const updatePerigeeApogee = (nextPerigeeM: number, nextApogeeM: number): void => {
    const safePerigee = Math.max(80_000, nextPerigeeM);
    const safeApogee = Math.max(safePerigee, nextApogeeM);
    const rp = EARTH_RADIUS_M + safePerigee;
    const ra = EARTH_RADIUS_M + safeApogee;
    const nextEcc = (ra - rp) / (ra + rp);
    onChangeConfig({
      ...config,
      orbit: {
        ...config.orbit,
        preset: "custom",
        altitude_m: safePerigee,
        perigee_altitude_m: safePerigee,
        apogee_altitude_m: safeApogee,
        eccentricity: Number(nextEcc.toFixed(5)),
      },
    });
  };

  const updateEccentricity = (nextEccRaw: number): void => {
    const eClamped = Math.max(0, Math.min(0.92, nextEccRaw));
    const rp = EARTH_RADIUS_M + perigeeM;
    const ra = rp * ((1 + eClamped) / (1 - eClamped));
    const nextApogee = Math.max(perigeeM, ra - EARTH_RADIUS_M);
    onChangeConfig({
      ...config,
      orbit: {
        ...config.orbit,
        preset: "custom",
        altitude_m: perigeeM,
        perigee_altitude_m: perigeeM,
        apogee_altitude_m: nextApogee,
        eccentricity: eClamped,
      },
    });
  };

  const handleApplyOrbitGuide = (entry: OrbitRegimeGuideEntry): void => {
    const perigeeAltM = entry.perigeeNmi * 1852.0;
    const apogeeAltM = entry.apogeeNmi * 1852.0;
    const rp = EARTH_RADIUS_M + perigeeAltM;
    const ra = EARTH_RADIUS_M + apogeeAltM;
    onChangeConfig({
      ...config,
      required_delta_v_m_s: null,
      orbit: {
        ...config.orbit,
        preset: "custom",
        altitude_m: perigeeAltM,
        perigee_altitude_m: perigeeAltM,
        apogee_altitude_m: apogeeAltM,
        eccentricity: Number(((ra - rp) / (ra + rp)).toFixed(5)),
        inclination_deg: entry.inclinationDeg,
      },
    });
  };

  const runMultiArchSearch = async (overrideCfg?: VehicleConfiguration, overrideCostPct?: number): Promise<void> => {
    let activeCfg = overrideCfg ?? config;
    if (activeCfg.recovery_optimizer_enabled ?? true) {
      try {
        const recReport = await evaluateRecoveryStrategyTrade(activeCfg);
        const optChoice =
          recReport.candidates.find((c) => c.id === recReport.recommended_id) ??
          recReport.candidates[0];
        if (optChoice) {
          const allExp =
            optChoice.booster_mode === "expendable" &&
            optChoice.s1_mode === "expendable" &&
            optChoice.s2_mode === "expendable" &&
            optChoice.s3_mode === "expendable";
          activeCfg = {
            ...activeCfg,
            booster_recovery_mode: optChoice.booster_mode,
            fairing_reusable: optChoice.fairing_reusable,
            expected_reuses: allExp ? 1 : Math.max(2, activeCfg.expected_reuses || 10),
            stages: activeCfg.stages.map((st, idx) => ({
              ...st,
              recovery_mode:
                idx === 0
                  ? optChoice.s1_mode
                  : idx === 1
                  ? optChoice.s2_mode
                  : optChoice.s3_mode,
            })),
          };
        }
      } catch {
        // Keep current recovery configuration if pre-screen trade call fails.
      }
    }
    const activeCostPct = overrideCostPct ?? costWeightPct;
    const activeGlowW = (100 - activeCostPct) / 100;
    const activeCostW = activeCostPct / 100;
    const activeStrat: OptimizationStrategy =
      activeCostPct === 0 ? "minimize_glow" : activeCostPct === 100 ? "minimize_cost" : "balanced_trade";
    const keysToRun = ARCH_DEFS.filter((d) => enabledArchs[d.key]);
    if (keysToRun.length === 0) {
      setSearchError("Select at least one vehicle architecture class to search.");
      return;
    }

    const currentRun = ++searchRunRef.current;
    setIsSearching(true);
    setSearchError(null);
    try {
      const nextEntries: Record<ArchitectureClassKey, ArchitectureSearchEntry | null> = {
        "2_stage": null,
        "2_5_stage": null,
        "3_stage": null,
        "3_5_stage": null,
      };
      let firstFeasible: ArchitectureClassKey | null = null;

      for (const def of keysToRun) {
        if (searchRunRef.current !== currentRun) return;
        const archCfg = buildArchConfig(activeCfg, def.stageCount, def.includeBoosters);
        const resp = await runCombinatorialSizing({
          base_config: archCfg,
          strategy: activeStrat,
          glow_weight: activeGlowW,
          cost_weight: activeCostW,
          dry_mass_weight: 0.05,
          allow_same_engine_stages: true,
          enforce_same_engine_stages: enforceEngineStages,
          enforce_same_fuel_stages: enforceFuelStages,
          include_boosters: def.includeBoosters,
          dv_grid_steps: 5,
          max_results: 24,
        });
        nextEntries[def.key] = {
          ...def,
          config: archCfg,
          response: resp,
        };
        if (!firstFeasible && resp.best_result) {
          firstFeasible = def.key;
        }
        setArchResults({ ...nextEntries });
      }
      if (firstFeasible && !nextEntries[selectedArchKey]?.response?.best_result) {
        setSelectedArchKey(firstFeasible);
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Optimization search failed.");
    } finally {
      if (searchRunRef.current === currentRun) {
        setIsSearching(false);
      }
    }
  };

  useEffect(() => {
    if (!hasAutoRun && engines.length > 0) {
      setHasAutoRun(true);
      void runMultiArchSearch();
    }
  }, [engines.length, hasAutoRun]);

  const rankedWinners = useMemo(() => {
    const out: Record<ArchitectureClassKey, VehicleSizingResult | null> = {
      "2_stage": null,
      "2_5_stage": null,
      "3_stage": null,
      "3_5_stage": null,
    };
    const wG = glowWeightPct / 100;
    const wC = costWeightPct / 100;
    for (const def of ARCH_DEFS) {
      const entry = archResults[def.key];
      const resp = entry?.response;
      if (!resp) continue;
      const pool = resp.top_candidates.length > 0 ? resp.top_candidates : resp.best_result ? [resp.best_result] : [];
      const sorted = rankCandidatesForBalance(pool, wG, wC);
      out[def.key] = sorted[0] ?? resp.best_result ?? null;
    }
    return out;
  }, [archResults, glowWeightPct, costWeightPct]);

  const activeEntry = archResults[selectedArchKey] ?? null;
  const activeWinner = rankedWinners[selectedArchKey] ?? null;
  const activeMaterializedConfig = activeEntry && activeWinner
    ? materializeCandidateConfig(activeEntry.config, activeWinner)
    : config;

  const combinedCandidates: Array<{ archTitle: string; res: VehicleSizingResult; entry: ArchitectureSearchEntry }> = [];
  for (const def of ARCH_DEFS) {
    const entry = archResults[def.key];
    if (entry?.response?.top_candidates) {
      for (const cand of entry.response.top_candidates.slice(0, 6)) {
        combinedCandidates.push({ archTitle: def.title, res: cand, entry });
      }
    }
  }
  const minAllGlow = Math.max(1, Math.min(...combinedCandidates.map((c) => c.res.glow_kg), 1e12));
  const minAllCost = Math.max(
    1,
    Math.min(...combinedCandidates.map((c) => c.res.cost_breakdown.reusable_flight_cost_usd), 1e12)
  );
  combinedCandidates.sort((a, b) => {
    const wG = glowWeightPct / 100;
    const wC = costWeightPct / 100;
    const sA = wG * (a.res.glow_kg / minAllGlow) + wC * (a.res.cost_breakdown.reusable_flight_cost_usd / minAllCost);
    const sB = wG * (b.res.glow_kg / minAllGlow) + wC * (b.res.cost_breakdown.reusable_flight_cost_usd / minAllCost);
    return sA - sB;
  });

  const activeTotalEvaluated = ARCH_DEFS.reduce((acc, d) => acc + (archResults[d.key]?.response?.evaluated_count ?? 0), 0);
  const activeTotalFeasible = ARCH_DEFS.reduce((acc, d) => acc + (archResults[d.key]?.response?.feasible_count ?? 0), 0);

  return (
    <div className="mx-auto max-w-[1640px] px-4 py-5 grid grid-cols-1 gap-6 lg:grid-cols-[24rem_1fr]">
      {/* Left Column: Spacious Direct Mission & Vehicle Inputs */}
      <aside className="space-y-5">
        {/* Card 1: Payload & Vehicle Envelope */}
        <section className="panel-card p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-100">
                1. Payload &amp; Envelope
              </h2>
              <p className="text-xs text-slate-400">Cargo mass, fairing bounds, and tank core size</p>
            </div>
            <button
              id="opt.run_search_btn"
              type="button"
              disabled={isSearching}
              title="Run combinatorial sizing across all enabled architecture classes (2-stage through 3.5-stage)."
              onClick={() => void runMultiArchSearch()}
              className="btn-primary shrink-0 whitespace-nowrap px-4 py-2 text-xs font-semibold shadow-sm"
            >
              {isSearching ? "Searching..." : "Run Search"}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="text-xs text-slate-300" title="Target payload mass delivered into the specified orbit injection conditions.">
              Payload Mass ({mUnit})
              <input
                id="opt.payload_mass"
                type="number"
                title="Target payload mass delivered into the specified orbit injection conditions."
                onWheel={(e) => e.currentTarget.blur()}
                value={Math.round(convertFromSi(config.payload_mass_kg, "mass", unitSystem))}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    payload_mass_kg: Math.max(50, convertToSi(Number(e.target.value), "mass", unitSystem)),
                  })
                }
                className="input-dark mt-1.5"
              />
            </label>
            <label className="text-xs text-slate-300" title="Outer cylindrical diameter of the rocket first stage core and propellant tanks, determining aerodynamic drag, fineness ratio, and engine base packaging area.">
              Core Diameter ({lenUnit})
              <input
                id="opt.core_diameter"
                type="number"
                step="0.2"
                title="Outer cylindrical diameter of the rocket first stage core and propellant tanks, determining aerodynamic drag, fineness ratio, and engine base packaging area."
                onWheel={(e) => e.currentTarget.blur()}
                value={Number(convertFromSi(config.core_diameter_m, "length", unitSystem).toFixed(2))}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    core_diameter_m: Math.max(1.0, convertToSi(Number(e.target.value), "length", unitSystem)),
                  })
                }
                className="input-dark mt-1.5"
              />
            </label>
            <label className="text-xs text-slate-300" title="Usable diameter of the spacecraft envelope inside the payload fairing shell.">
              Payload Dia ({lenUnit})
              <input
                id="opt.payload_dia"
                type="number"
                step="0.2"
                title="Usable diameter of the spacecraft envelope inside the payload fairing shell."
                onWheel={(e) => e.currentTarget.blur()}
                value={Number(convertFromSi(config.payload_diameter_m, "length", unitSystem).toFixed(2))}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    payload_diameter_m: Math.max(0.5, convertToSi(Number(e.target.value), "length", unitSystem)),
                  })
                }
                className="input-dark mt-1.5"
              />
            </label>
            <label className="text-xs text-slate-300" title="Length of the payload cylindrical envelope section enclosed by the fairing.">
              Payload Len ({lenUnit})
              <input
                id="opt.payload_len"
                type="number"
                step="0.5"
                title="Length of the payload cylindrical envelope section enclosed by the fairing."
                onWheel={(e) => e.currentTarget.blur()}
                value={Number(convertFromSi(config.payload_length_m, "length", unitSystem).toFixed(2))}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    payload_length_m: Math.max(1.0, convertToSi(Number(e.target.value), "length", unitSystem)),
                  })
                }
                className="input-dark mt-1.5"
              />
            </label>
          </div>
        </section>

        {/* Card 2: Direct Elliptical Orbit Target */}
        <section className="panel-card p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-100">
                2. Target Orbit
              </h2>
              <p className="text-xs text-slate-400">Perigee x apogee altitude, inclination, site latitude</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                id="opt.orbit_guide_btn"
                type="button"
                title="View standard orbital regimes (LEO, SSO, MEO, GTO, GEO) and auto-populate perigee/apogee altitudes."
                onClick={() => setShowOrbitGuide(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-sky-500/50 bg-sky-500/15 px-2.5 py-1 text-xs font-semibold text-sky-200 hover:bg-sky-500/25"
              >
                <span aria-hidden="true">?</span> Orbit Guide
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="text-xs text-slate-300" title="Perigee altitude: Altitude of closest approach to Earth's surface. Must exceed ~160 km to avoid immediate atmospheric entry.">
              Perigee Alt ({altUnit})
              <input
                id="opt.perigee_alt"
                type="number"
                step="10"
                title="Perigee altitude: Altitude of closest approach to Earth's surface. Must exceed ~160 km to avoid immediate atmospheric entry."
                onWheel={(e) => e.currentTarget.blur()}
                value={Math.round(convertFromSi(perigeeM, "altitude", unitSystem))}
                onChange={(e) => {
                  const nextP = convertToSi(Number(e.target.value), "altitude", unitSystem);
                  updatePerigeeApogee(nextP, Math.max(nextP, apogeeM));
                }}
                className="input-dark mt-1.5"
              />
            </label>
            <label className="text-xs text-slate-300" title="Apogee altitude: Farthest orbital point from Earth's surface. Higher apogees require greater orbital injection energy and stage delta-V.">
              Apogee Alt ({altUnit})
              <input
                id="opt.apogee_alt"
                type="number"
                step="10"
                title="Apogee altitude: Farthest orbital point from Earth's surface. Higher apogees require greater orbital injection energy and stage delta-V."
                onWheel={(e) => e.currentTarget.blur()}
                value={Math.round(convertFromSi(apogeeM, "altitude", unitSystem))}
                onChange={(e) => {
                  const nextA = convertToSi(Number(e.target.value), "altitude", unitSystem);
                  updatePerigeeApogee(perigeeM, nextA);
                }}
                className="input-dark mt-1.5"
              />
            </label>
          </div>

          <div
            className="rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-300 flex items-center justify-between"
            title="Geocentric orbital radii from Earth's center: rp = R_earth + perigee, ra = R_earth + apogee."
          >
            <span>Orbit Radii (rp x ra)</span>
            <span className="font-mono text-sky-300">
              {Math.round(rpDisplay).toLocaleString("en-US")} x {Math.round(raDisplay).toLocaleString("en-US")} {altUnit}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-slate-300" title="Orbital eccentricity: 0.0 is circular, 0 < e < 1 is elliptical (e.g. standard GTO ~0.72). Computed automatically from perigee and apogee radii.">
              Eccentricity
              <input
                id="opt.eccentricity"
                type="number"
                step="0.005"
                min="0"
                max="0.92"
                title="Orbital eccentricity: 0.0 is circular, 0 < e < 1 is elliptical (e.g. standard GTO ~0.72). Computed automatically from perigee and apogee radii."
                onWheel={(e) => e.currentTarget.blur()}
                value={Number(eccentricityVal.toFixed(4))}
                onChange={(e) => updateEccentricity(Number(e.target.value))}
                className="input-dark mt-1.5"
              />
            </label>
            <label className="text-xs text-slate-300" title="Orbital plane tilt relative to the equator. Inclinations lower than the launch latitude require expensive dogleg plane-change burns.">
              Inclination (deg)
              <input
                id="opt.inclination"
                type="number"
                step="0.5"
                min="0"
                max="180"
                title="Orbital plane tilt relative to the equator. Inclinations lower than the launch latitude require expensive dogleg plane-change burns."
                onWheel={(e) => e.currentTarget.blur()}
                value={config.orbit.inclination_deg}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    orbit: { ...config.orbit, preset: "custom", inclination_deg: Number(e.target.value) },
                  })
                }
                className="input-dark mt-1.5"
              />
            </label>
            <label className="text-xs text-slate-300" title="Geographic latitude of launch site (e.g. 28.5 deg Cape Canaveral). Eastward launches capture Earth's surface rotational velocity (up to 465 m/s at equator).">
              Site Lat (deg)
              <input
                id="opt.launch_lat"
                type="number"
                step="0.5"
                min="-85"
                max="85"
                title="Geographic latitude of launch site (e.g. 28.5 deg Cape Canaveral). Eastward launches capture Earth's surface rotational velocity (up to 465 m/s at equator)."
                onWheel={(e) => e.currentTarget.blur()}
                value={config.orbit.launch_latitude_deg}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    orbit: { ...config.orbit, preset: "custom", launch_latitude_deg: Number(e.target.value) },
                  })
                }
                className="input-dark mt-1.5"
              />
            </label>
            <label
              className="text-xs text-slate-300"
              title="Extra velocity budget reserve applied on top of orbital energy and ascent losses (default 2.5%)."
            >
              Delta-V Margin (%)
              <input
                id="opt.dv_margin_pct"
                type="number"
                step="0.5"
                min="0"
                max="25"
                title="Percentage reserve added to total required delta-V (default 2.5%)."
                onWheel={(e) => e.currentTarget.blur()}
                value={Number((config.orbit.dv_margin_pct ?? 2.5).toFixed(1))}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    orbit: {
                      ...config.orbit,
                      dv_margin_pct: Math.min(25, Math.max(0, Number(e.target.value) || 0)),
                    },
                  })
                }
                className="input-dark mt-1.5"
              />
            </label>
          </div>
        </section>

        {/* Card 3: Recovery Strategy Optimizer & Reusability Matrix */}
        <section className="panel-card p-5 space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-100">
            3. Recovery Strategy &amp; Reuse
          </h2>
          <RecoveryOptimizerPanel
            config={config}
            onChangeConfig={onChangeConfig}
            unitSystem={unitSystem}
            inflationFactor={adjustInflationUsd(1, 2026, currencyYear)}
            currencyYear={currencyYear}
            idPrefix="opt"
          />
        </section>

        {/* Card 4: Optimization Balance, Mass Margin & Classes */}
        <section className="panel-card p-5 space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-100">
            4. Objective Balance &amp; Margin
          </h2>

          {/* GLOW vs Cost Interactive Slider */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3.5 space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-sky-300">Min GLOW: {glowWeightPct}%</span>
              <span className="text-emerald-300">Min Cost: {costWeightPct}%</span>
            </div>
            <input
              id="opt.glow_cost_slider"
              type="range"
              min={0}
              max={100}
              step={5}
              value={costWeightPct}
              aria-label="Balance between minimizing GLOW and minimizing flight cost"
              onChange={(e) => handleBalanceChange(Number(e.target.value))}
              className="w-full accent-sky-400 cursor-pointer"
            />
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { label: "All GLOW", pct: 0 },
                { label: "65 / 35", pct: 35 },
                { label: "50 / 50", pct: 50 },
                { label: "All Cost", pct: 100 },
              ].map((snap) => (
                <button
                  key={snap.label}
                  type="button"
                  title={`Set optimization objective weight to ${100 - snap.pct}% Min GLOW and ${snap.pct}% Min Cost.`}
                  onClick={() => handleBalanceChange(snap.pct)}
                  className={`whitespace-nowrap rounded border px-1.5 py-1.5 text-xs font-medium transition ${
                    costWeightPct === snap.pct
                      ? "border-sky-500 bg-sky-500/20 text-sky-200"
                      : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  {snap.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 items-end">
            <label className="text-xs text-slate-300">
              Inert Mass Margin (%)
              <input
                id="opt.mass_margin"
                type="number"
                step="1"
                min="0"
                max="60"
                onWheel={(e) => e.currentTarget.blur()}
                value={Math.round(config.mass_margin_frac * 100)}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    mass_margin_frac: Math.max(0, Math.min(0.6, Number(e.target.value) / 100)),
                  })
                }
                className="input-dark mt-1.5"
              />
            </label>
            <p className="pb-2 text-xs text-slate-400">Default 25%. Applied to every stage inert mass.</p>
          </div>

          <StageCommonalityControl
            enforceEngineStages={enforceEngineStages}
            enforceFuelStages={enforceFuelStages}
            onChangeEngineStages={setEnforceEngineStages}
            onChangeFuelStages={setEnforceFuelStages}
          />

          {/* Vehicle Classes */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-300">Architecture Classes to Compare</div>
            <div className="grid grid-cols-2 gap-2">
              {ARCH_DEFS.map((def) => (
                <label
                  key={def.key}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs cursor-pointer ${
                    enabledArchs[def.key]
                      ? "border-sky-500/60 bg-sky-500/10 text-slate-100"
                      : "border-slate-800 bg-slate-950 text-slate-400"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={enabledArchs[def.key]}
                    onChange={(e) =>
                      setEnabledArchs((prev) => ({ ...prev, [def.key]: e.target.checked }))
                    }
                    className="h-3.5 w-3.5"
                  />
                  <span className="font-medium">{def.title}</span>
                </label>
              ))}
            </div>
          </div>

          <details className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
            <summary
              title="Customize delta-V override, structural/T/W0 limits, and stage mass fraction defaults."
              className="cursor-pointer text-sm font-semibold text-slate-100 hover:text-white"
            >
              Constraints &amp; Delta-V Override
            </summary>
            <div className="mt-3 space-y-4">
              <label className="block text-xs text-slate-200">
                Delta-V Override ({velUnit})
                <input
                  id="opt.dv_override"
                  type="number"
                  placeholder="Auto from orbit"
                  onWheel={(e) => e.currentTarget.blur()}
                  value={
                    config.required_delta_v_m_s != null
                      ? Math.round(convertFromSi(config.required_delta_v_m_s, "velocity", unitSystem))
                      : ""
                  }
                  onChange={(e) =>
                    onChangeConfig({
                      ...config,
                      required_delta_v_m_s:
                        e.target.value === "" ? null : convertToSi(Number(e.target.value), "velocity", unitSystem),
                    })
                  }
                  className="input-dark mt-1"
                />
              </label>
              <ConstraintOverridePanel
                config={config}
                onChangeConfig={onChangeConfig}
                unitSystem={unitSystem}
                autoDefaults={autoConstraints}
                onChangeAutoDefaults={setAutoConstraints}
              />
            </div>
          </details>

          <details className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
            <summary
              title="Restrict individual stages (Stage 1, Stage 2, Stage 3, Boosters) to specific engines, propellants, or cycles."
              className="cursor-pointer text-sm font-semibold text-slate-100 hover:text-white"
            >
              Per-Stage Engine &amp; Fuel Filters
            </summary>
            <div className="mt-3">
              <AdvancedStageConstraintsPanel
                config={config}
                engines={[...engines, ...config.custom_engines]}
                onChangeConfig={onChangeConfig}
              />
            </div>
          </details>

          <details className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
            <summary
              title="Adjust underlying trajectory losses, structural safety factors, packing clearances, and cost rates."
              className="cursor-pointer text-sm font-semibold text-slate-100 hover:text-white"
            >
              Advanced Physics, Packing &amp; Cost Defaults
            </summary>
            <div className="mt-3">
              <AdvancedDefaultsPanel
                config={config}
                onChangeConfig={onChangeConfig}
                unitSystem={unitSystem}
              />
            </div>
          </details>
        </section>
      </aside>

      {showOrbitGuide && (
        <OrbitGuideModal
          unitSystem={unitSystem}
          onApply={handleApplyOrbitGuide}
          onClose={() => setShowOrbitGuide(false)}
        />
      )}

      {/* Right Column: Visual-First Architecture Gallery + Progressive Details */}
      <div className="space-y-6">
        {searchError && (
          <div className="rounded-lg border border-rose-500/50 bg-rose-950/60 px-4 py-3 text-xs text-rose-200">
            {searchError}
          </div>
        )}

        {/* Top Summary Status Bar */}
        <div className="panel-card px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
            <span className="font-semibold text-slate-100">
              {Math.round(convertFromSi(config.payload_mass_kg, "mass", unitSystem)).toLocaleString("en-US")} {mUnit} to{" "}
              {Math.round(convertFromSi(perigeeM, "altitude", unitSystem))} x{" "}
              {Math.round(convertFromSi(apogeeM, "altitude", unitSystem))} {altUnit}
            </span>
            <span className="text-slate-500">|</span>
            <span>e = {eccentricityVal.toFixed(4)}</span>
            <span className="text-slate-500">|</span>
            <span>i = {config.orbit.inclination_deg.toFixed(1)} deg</span>
            <span className="text-slate-500">|</span>
            <span>{Math.round(config.mass_margin_frac * 100)}% inert margin</span>
          </div>
          <div className="font-mono text-xs text-slate-400">
            {isSearching
              ? "Evaluating vehicle combinations..."
              : `${activeTotalFeasible} feasible of ${activeTotalEvaluated} evaluated`}
          </div>
        </div>

        {/* 2x2 Visual Architecture Winner Gallery */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {ARCH_DEFS.map((def) => {
            const entry = archResults[def.key];
            const best = rankedWinners[def.key];
            const resp = entry?.response;
            const isSelected = selectedArchKey === def.key;
            const disabled = !enabledArchs[def.key];

            const bestCostUsd = best
              ? adjustInflationUsd(best.cost_breakdown.reusable_flight_cost_usd, 2026, currencyYear)
              : 0;
            const bestSpecCost = best
              ? convertFromSi(
                  adjustInflationUsd(best.cost_breakdown.cost_per_kg_payload_usd, 2026, currencyYear),
                  "cost_per_mass",
                  unitSystem
                )
              : 0;
            const archMatCfg = entry && best ? materializeCandidateConfig(entry.config, best) : buildArchConfig(config, def.stageCount, def.includeBoosters);

            return (
              <div
                key={def.key}
                className={`panel-card p-5 transition flex flex-col justify-between gap-4 ${
                  isSelected
                    ? "border-sky-500/80 ring-1 ring-sky-500/40 bg-slate-900"
                    : "hover:border-slate-700"
                } ${disabled ? "opacity-50" : ""}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-slate-100">{def.title}</h3>
                    <p className="text-xs text-slate-400">{def.subtitle}</p>
                  </div>
                  <FeasibilityBadge
                    feasible={Boolean(best)}
                    label={
                      best
                        ? `${resp?.feasible_count ?? 1} feasible`
                        : isSearching
                        ? "Searching..."
                        : disabled
                        ? "Disabled"
                        : "0 feasible"
                    }
                    result={best ?? null}
                    config={archMatCfg}
                    rejectionSummary={resp?.rejection_summary}
                    unitSystem={unitSystem}
                  />
                </div>

                {best ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-[10.5rem_1fr] items-center">
                    <RocketSchematic
                      config={archMatCfg}
                      result={best}
                      engines={engines}
                      unitSystem={unitSystem}
                      compact
                    />
                    <div className="flex flex-col justify-between gap-3 h-full">
                      <div className="grid grid-cols-2 gap-2.5">
                        <div
                          className="rounded-lg border border-slate-800 bg-slate-950/75 p-2.5"
                          title="Gross Liftoff Weight (GLOW): Total wet mass at pad ignition including propellant, dry structure, engines, fairings, and payload."
                        >
                          <div className="text-xs text-slate-400">GLOW ({mUnit})</div>
                          <div className="mt-0.5 font-mono text-sm font-bold text-slate-100">
                            {Math.round(convertFromSi(best.glow_kg, "mass", unitSystem)).toLocaleString("en-US")}
                          </div>
                        </div>
                        <div
                          className="rounded-lg border border-slate-800 bg-slate-950/75 p-2.5"
                          title="Cost per Flight: Estimated amortized cost per launch including hardware amortization, turnaround refurbishment, recovery operations, propellant, and range fees."
                        >
                          <div className="text-xs text-slate-400">Cost / Flight</div>
                          <div className="mt-0.5 font-mono text-sm font-bold text-emerald-300">
                            ${(bestCostUsd / 1e6).toFixed(2)}M
                          </div>
                        </div>
                        <div
                          className="rounded-lg border border-slate-800 bg-slate-950/75 p-2.5"
                          title="Specific Launch Cost: Total flight cost divided by net deliverable payload mass to target orbit. Lower is commercially superior."
                        >
                          <div className="text-xs text-slate-400">Specific Cost</div>
                          <div className="mt-0.5 font-mono text-sm font-semibold text-sky-300">
                            ${Math.round(bestSpecCost).toLocaleString("en-US")} {costPerMassUnit}
                          </div>
                        </div>
                        <div
                          className="rounded-lg border border-slate-800 bg-slate-950/75 p-2.5"
                          title="Liftoff Thrust-to-Weight (T/W0) and Payload Mass Fraction (Payload / GLOW %). Liftoff T/W0 must exceed 1.15 to clear launch pad safely."
                        >
                          <div className="text-xs text-slate-400">T/W0 | PL %</div>
                          <div className="mt-0.5 font-mono text-sm font-semibold text-amber-300">
                            {best.liftoff_tw0.toFixed(2)} | {(best.payload_fraction * 100).toFixed(2)}%
                          </div>
                        </div>
                      </div>

                      {/* Propulsion Lineup Badges */}
                      <div className="flex flex-wrap gap-1.5 text-xs">
                        {best.stages.map((st) => (
                          <span
                            key={st.stage_number}
                            title={`Stage ${st.stage_number}: ${st.engine_count}x ${engineLookup.get(st.engine_id) ?? st.engine_name} burning ${st.propellant}. Structural ratio: ${((st.k_structural ?? (1 - st.propellant_mass_fraction)) * 100).toFixed(1)}%.`}
                            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200"
                          >
                            S{st.stage_number}: {st.engine_count}x {engineLookup.get(st.engine_id) ?? st.engine_name}
                          </span>
                        ))}
                        {best.stages[0]?.strapon_count > 0 && (
                          <span
                            title={`Strap-on Boosters: ${best.stages[0].strapon_count}x parallel booster motors providing initial liftoff thrust and jettisoned at burnout.`}
                            className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-300"
                          >
                            +{best.stages[0].strapon_count}x{" "}
                            {engineLookup.get(best.stages[0].strapon_engine_id ?? "") ?? best.stages[0].strapon_engine_id}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          title={`Open technical blueprint, stage mass breakdowns, and engineering telemetry for ${def.title} below.`}
                          onClick={() => setSelectedArchKey(def.key)}
                          className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold transition ${
                            isSelected
                              ? "bg-sky-600 text-white"
                              : "border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                          }`}
                        >
                          {isSelected ? "Active Blueprint" : "View Blueprint & Breakdown"}
                        </button>
                        <button
                          type="button"
                          title={`Load this ${def.title} candidate into Single Config Evaluator for fine-tuning and trajectory simulation.`}
                          onClick={() => onOpenInSingleConfig(archMatCfg, best)}
                          className="rounded-md border border-sky-500/50 bg-sky-500/15 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/25"
                        >
                          Customize
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-slate-800 bg-slate-950/40 px-4 text-center text-xs text-slate-400">
                    {isSearching
                      ? `Optimizing ${def.title} combinations...`
                      : disabled
                      ? "Enable this architecture class in the sidebar to evaluate."
                      : "No feasible solution matched constraints. Try relaxing upper T/W0, lowering margin, or expanding core diameter."}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Lower Section: Visual Comparison vs Detailed Tables */}
        {activeWinner && activeEntry && (
          <section className="panel-card p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-bold text-slate-100">
                    Selected Winner: {activeEntry.title} ({activeWinner.config_label})
                  </h2>
                  <FeasibilityBadge
                    feasible={activeWinner.feasible}
                    label={activeWinner.feasible ? "Feasible" : "Violations"}
                    result={activeWinner}
                    config={activeMaterializedConfig}
                    rejectionSummary={activeEntry.response?.rejection_summary}
                    unitSystem={unitSystem}
                  />
                </div>
                <p className="text-xs text-slate-400">
                  Height {convertFromSi(activeWinner.total_height_m, "length", unitSystem).toFixed(1)} {lenUnit} | Core Dia{" "}
                  {convertFromSi(activeWinner.core_diameter_m, "length", unitSystem).toFixed(2)} {lenUnit} | Peak Accel{" "}
                  {activeWinner.peak_accel_g.toFixed(2)} g
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-1">
                  <button
                    id="opt.tab_visuals"
                    type="button"
                    title="Inspect vehicle schematic, mass share, delta-V waterfall, and per-stage cards."
                    onClick={() => setDetailTab("visuals")}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                      detailTab === "visuals"
                        ? "bg-sky-600 text-white"
                        : "text-slate-300 hover:text-slate-100"
                    }`}
                  >
                    Visual Comparison
                  </button>
                  <button
                    id="opt.tab_tables"
                    type="button"
                    title="View full structural, propulsion, mass, cost tables and ranked alternatives."
                    onClick={() => setDetailTab("tables")}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                      detailTab === "tables"
                        ? "bg-sky-600 text-white"
                        : "text-slate-300 hover:text-slate-100"
                    }`}
                  >
                    Engineering Tables &amp; Candidates
                  </button>
                </div>
                <button
                  type="button"
                  title="Open this winning configuration in Single Config Evaluator for full editing and trajectory sim."
                  onClick={() => onOpenInSingleConfig(activeMaterializedConfig, activeWinner)}
                  className="btn-primary px-3.5 py-2 text-xs font-semibold"
                >
                  Open in Single Config Evaluator
                </button>
              </div>
            </div>

            {detailTab === "visuals" ? (
              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-[25rem_1fr]">
                  <RocketSchematic
                    config={activeMaterializedConfig}
                    result={activeWinner}
                    engines={engines}
                    unitSystem={unitSystem}
                  />
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 gap-3">
                      <MassTreemapChart result={activeWinner} unitSystem={unitSystem} />
                      <DeltaVWaterfallChart breakdown={activeWinner.delta_v_breakdown} unitSystem={unitSystem} />
                    </div>

                    {/* Visual Stage Cards */}
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      {activeWinner.stages.map((st) => (
                        <div key={st.stage_number} className="rounded-lg border border-slate-800 bg-slate-950 p-4 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-sky-300">Stage {st.stage_number}</span>
                            <span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-xs text-slate-300">
                              {(st.dv_split_frac * 100).toFixed(0)}% dV
                            </span>
                          </div>
                          <div className="text-xs font-semibold text-slate-100">
                            {st.engine_count}x {engineLookup.get(st.engine_id) ?? st.engine_name}
                          </div>
                          <div className="space-y-1.5 text-xs text-slate-300 pt-1.5 border-t border-slate-800/80">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-400">Stage Mass</span>
                              <span className="font-mono whitespace-nowrap text-slate-100">
                                {Math.round(convertFromSi(st.stage_total_mass_kg, "mass", unitSystem)).toLocaleString("en-US")} {mUnit}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-400">Propellant</span>
                              <span className="font-mono whitespace-nowrap text-slate-100">
                                {Math.round(convertFromSi(st.propellant_mass_kg, "mass", unitSystem)).toLocaleString("en-US")} {mUnit}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-400">T/W0</span>
                              <span className="font-mono text-amber-300">{st.tw0_ignition.toFixed(2)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-400">Burn Time</span>
                              <span className="font-mono text-slate-100">{st.burn_time_s.toFixed(0)} s</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <DesignJustificationReport
                  config={activeMaterializedConfig}
                  result={activeWinner}
                  engines={engines}
                  vehicles={vehicles}
                  unitSystem={unitSystem}
                  currencyYear={currencyYear}
                />
              </div>
            ) : (
              <div className="space-y-5">
                <DesignInspectorPanel
                  config={activeMaterializedConfig}
                  result={activeWinner}
                  engines={engines}
                  vehicles={vehicles}
                  unitSystem={unitSystem}
                  currencyYear={currencyYear}
                  rejectionBreakdown={activeEntry.response?.rejection_summary ?? null}
                  onOpenInSingleConfig={() => onOpenInSingleConfig(activeMaterializedConfig, activeWinner)}
                />

                {/* Top Ranked Alternatives */}
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-200">
                    Top Ranked Alternatives (Sorted by {glowWeightPct}% GLOW / {costWeightPct}% Cost)
                  </div>
                  <div className="max-h-72 overflow-auto">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead className="bg-slate-900 text-slate-300 border-b border-slate-800">
                        <tr>
                          <th className="px-3 py-2">Class</th>
                          <th className="px-3 py-2">Configuration</th>
                          <th className="px-3 py-2">GLOW ({mUnit})</th>
                          <th className="px-3 py-2">Cost ($M)</th>
                          <th className="px-3 py-2">{costPerMassUnit}</th>
                          <th className="px-3 py-2">T/W0</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Action</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono text-slate-200">
                        {combinedCandidates.slice(0, 14).map((item, idx) => {
                          const rowCfg = materializeCandidateConfig(item.entry.config, item.res);
                          return (
                            <tr key={idx} className="border-b border-slate-900 hover:bg-slate-900/60">
                              <td className="px-3 py-2 font-sans text-sky-300">{item.archTitle}</td>
                              <td className="px-3 py-2">{item.res.config_label}</td>
                              <td className="px-3 py-2">
                                {Math.round(convertFromSi(item.res.glow_kg, "mass", unitSystem)).toLocaleString("en-US")}
                              </td>
                              <td className="px-3 py-2 text-emerald-300">
                                ${(adjustInflationUsd(item.res.cost_breakdown.reusable_flight_cost_usd, 2026, currencyYear) / 1e6).toFixed(2)}M
                              </td>
                              <td className="px-3 py-2">
                                ${Math.round(
                                  convertFromSi(
                                    adjustInflationUsd(item.res.cost_breakdown.cost_per_kg_payload_usd, 2026, currencyYear),
                                    "cost_per_mass",
                                    unitSystem
                                  )
                                ).toLocaleString("en-US")}
                              </td>
                              <td className="px-3 py-2">{item.res.liftoff_tw0.toFixed(2)}</td>
                              <td className="px-3 py-2 font-sans">
                                <FeasibilityBadge
                                  feasible={item.res.feasible}
                                  label={item.res.feasible ? "Feasible" : "Violations"}
                                  result={item.res}
                                  config={rowCfg}
                                  unitSystem={unitSystem}
                                />
                              </td>
                              <td className="px-3 py-2 font-sans">
                                <button
                                  type="button"
                                  title={`Open ${item.res.config_label} in Single Config Evaluator.`}
                                  onClick={() => onOpenInSingleConfig(rowCfg, item.res)}
                                  className="rounded border border-sky-500/50 bg-sky-500/15 px-2.5 py-1 text-xs text-sky-300 hover:bg-sky-500/25"
                                >
                                  Customize
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
          </section>
        )}
      </div>
    </div>
  );
}
