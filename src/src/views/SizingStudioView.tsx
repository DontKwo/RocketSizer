import React, { useMemo, useState } from "react";
import { adjustInflationUsd, convertFromSi, convertToSi, unitLabel, type UnitSystem } from "../config/units";
import {
  computeEllipticalOrbitMetrics,
  evaluateManualArchitecture,
  scaleRubberEngine,
  solveEngineCirclePacking,
} from "../api/tauriClient";
import type { InspectorTarget, ProvenanceValue } from "../types/provenance";
import type { ProvenanceEngine } from "../types/engine";
import type { ProvenanceVehicle } from "../types/vehicle";
import type {
  BaseLayoutResult,
  CryoStateMode,
  EnginePlacementInput,
  FairingProfile,
  PackingConstraints,
  PressurizationMode,
  RecoveryMode,
  StagingArchitectureMode,
  TankMaterialPreset,
  VehicleConfiguration,
  VehicleSizingResult,
} from "../types/sizing";
import { BaseLayoutView } from "../components/visualizers/BaseLayoutView";
import { RocketSchematic } from "../components/visualizers/RocketSchematic";
import { DeltaVWaterfallChart, MassTreemapChart } from "../components/charts/TradeCharts";
import { DesignInspectorPanel } from "../components/inspector/DesignInspectorPanel";
import { DesignJustificationReport } from "../components/inspector/DesignJustificationReport";
import { TrajectoryAnalysisPanel } from "../components/visualizers/TrajectoryAnalysisPanel";
import { OrbitGuideModal } from "../components/inputs/OrbitGuideModal";
import { ConstraintOverridePanel } from "../components/inputs/ConstraintOverridePanel";
import { RecoveryOptimizerPanel } from "../components/inputs/RecoveryOptimizerPanel";
import { AdvancedStageConstraintsPanel } from "../components/inputs/AdvancedStageConstraintsPanel";
import { AdvancedDefaultsPanel } from "../components/inputs/AdvancedDefaultsPanel";
import { FeasibilityBadge } from "../components/common/FeasibilityBadge";
import { buildDesignJustificationMarkdown } from "../config/reportGenerator";
import {
  computeDynamicConstraintDefaults,
  DEFAULT_ADVANCED_MODEL_DEFAULTS,
  formatPropellant,
  type OrbitRegimeGuideEntry,
} from "../config/formatters";

type StudioSubTab = "design" | "inspect" | "trajectory";

const EARTH_RADIUS_M = 6_371_000.0;

interface SizingStudioViewProps {
  config: VehicleConfiguration;
  onChangeConfig: (next: VehicleConfiguration) => void;
  engines: ProvenanceEngine[];
  vehicles: ProvenanceVehicle[];
  result: VehicleSizingResult | null;
  unitSystem: UnitSystem;
  currencyYear: number;
  onInspect: (target: InspectorTarget) => void;
  onBackToSearch?: () => void;
}

export function SizingStudioView({
  config,
  onChangeConfig,
  engines,
  vehicles,
  result,
  unitSystem,
  currencyYear,
  onInspect,
  onBackToSearch,
}: SizingStudioViewProps): React.ReactElement {
  const [customPlacements, setCustomPlacements] = useState<EnginePlacementInput[] | null>(null);
  const [packingResult, setPackingResult] = useState<BaseLayoutResult | null>(null);
  const [showRubberModal, setShowRubberModalRaw] = useState<boolean>(false);
  const [showRubberGuide, setShowRubberGuide] = useState<boolean>(false);
  const setShowRubberModal = (next: boolean | ((prev: boolean) => boolean)): void => {
    React.startTransition(() => {
      setShowRubberModalRaw(next);
    });
  };
  const [rubberRefId, setRubberRefId] = useState<string>(engines[0]?.id.value ?? "merlin_1d");
  const [rubberThrustN, setRubberThrustN] = useState<number>(1_200_000);
  const [rubberPcBar, setRubberPcBar] = useState<number>(120);
  const [rubberTargetStageIdx, setRubberTargetStageIdx] = useState<number>(0);
  const [fixedGlowMode, setFixedGlowMode] = useState<boolean>(false);
  const [targetGlowKg, setTargetGlowKg] = useState<number>(550_000);
  const [isSolvingGlow, setIsSolvingGlow] = useState<boolean>(false);
  const [subTab, setSubTab] = useState<StudioSubTab>("design");
  const [showOrbitGuide, setShowOrbitGuide] = useState<boolean>(false);
  const [autoConstraints, setAutoConstraints] = useState<boolean>(true);

  const allEngines = useMemo(
    () => [...engines, ...config.custom_engines],
    [engines, config.custom_engines]
  );

  const engineById = useMemo(() => {
    const map = new Map<string, ProvenanceEngine>();
    for (const eng of allEngines) {
      map.set(eng.id.value, eng);
    }
    return map;
  }, [allEngines]);

  const advDefaults = config.advanced_defaults ?? DEFAULT_ADVANCED_MODEL_DEFAULTS;
  const packingConstraints = useMemo<PackingConstraints>(
    () => ({
      skirt_wall_thickness_m: advDefaults.skirt_wall_thickness_m,
      skirt_clearance_m: advDefaults.skirt_clearance_m,
      no_touch_margin_m: advDefaults.no_touch_margin_m,
      default_tvc_angle_deg: advDefaults.tvc_angle_deg,
    }),
    [
      advDefaults.skirt_wall_thickness_m,
      advDefaults.skirt_clearance_m,
      advDefaults.no_touch_margin_m,
      advDefaults.tvc_angle_deg,
    ]
  );

  const s1Stage = config.stages[0];
  const s1Engine = engineById.get(s1Stage?.engine_id ?? "");

  const derivedPlacements = useMemo<EnginePlacementInput[]>(() => {
    if (customPlacements && customPlacements.length === (s1Stage?.engine_count ?? 0)) {
      return customPlacements;
    }
    const count = Math.max(1, s1Stage?.engine_count ?? 1);
    const nozDia = s1Engine?.nozzle_diameter_m.value ?? 1.0;
    const armRatio = advDefaults.gimbal_lever_arm_ratio || 0.85;
    const arm = nozDia * armRatio;
    const engineTvc = s1Engine?.tvc_gimbal_range_deg.value;
    const baseTvc = engineTvc !== undefined ? engineTvc : (advDefaults.tvc_angle_deg ?? 6.0);
    return Array.from({ length: count }).map((_, idx) => {
      const isCenterRigid = (count === 5 || count === 9) && idx === 0;
      const isOuterFixed33 = count === 33 && idx >= 13;
      const tvc = isCenterRigid || isOuterFixed33 ? 0 : baseTvc;
      return {
        id: `${s1Stage?.engine_id ?? "eng"}_${idx + 1}`,
        nozzle_diameter_m: nozDia,
        gimbal_lever_arm_m: arm,
        tvc_angle_deg: tvc,
        custom_x_m: null,
        custom_y_m: null,
        enabled: true,
      };
    });
  }, [
    customPlacements,
    s1Stage?.engine_count,
    s1Stage?.engine_id,
    s1Engine,
    advDefaults.gimbal_lever_arm_ratio,
    advDefaults.tvc_angle_deg,
  ]);

  React.useEffect(() => {
    let active = true;
    solveEngineCirclePacking(config.core_diameter_m, derivedPlacements, packingConstraints).then(
      (res) => {
        if (active) {
          setPackingResult(res);
        }
      }
    );
    return () => {
      active = false;
    };
  }, [config.core_diameter_m, derivedPlacements, packingConstraints]);

  const handleSetStageCount = (count: 2 | 3): void => {
    if (count === config.stages.length && config.stage_count === count) return;
    if (count === 2) {
      const s1 = { ...config.stages[0], stage_number: 1, delta_v_split_frac: 0.40 };
      const s2 = { ...(config.stages[1] ?? config.stages[0]), stage_number: 2, delta_v_split_frac: 0.60 };
      onChangeConfig({ ...config, stage_count: 2, stages: [s1, s2] });
      return;
    }
    const s1 = { ...config.stages[0], stage_number: 1, delta_v_split_frac: 0.36 };
    const s2 = { ...(config.stages[1] ?? config.stages[0]), stage_number: 2, delta_v_split_frac: 0.34 };
    const s3 = {
      ...(config.stages[2] ?? config.stages[1] ?? config.stages[0]),
      stage_number: 3,
      engine_id: config.stages[2]?.engine_id ?? "rl_10c_1",
      engine_count: 1,
      delta_v_split_frac: 0.30,
    };
    onChangeConfig({ ...config, stage_count: 3, stages: [s1, s2, s3] });
  };

  const handleSolveFixedGlow = async (): Promise<void> => {
    setIsSolvingGlow(true);
    try {
      let lo = 100;
      let hi = Math.max(targetGlowKg * 0.2, 5_000);
      for (let iter = 0; iter < 12; iter += 1) {
        const mid = 0.5 * (lo + hi);
        const probe = await evaluateManualArchitecture({ ...config, payload_mass_kg: mid });
        if (probe.glow_kg < targetGlowKg) {
          lo = mid;
        } else {
          hi = mid;
        }
      }
      onChangeConfig({ ...config, payload_mass_kg: Math.round(0.5 * (lo + hi)) });
    } finally {
      setIsSolvingGlow(false);
    }
  };

  const handleStageUpdate = (idx: number, patch: Partial<typeof config.stages[number]>): void => {
    const nextStages = config.stages.map((st, sIdx) => (sIdx === idx ? { ...st, ...patch } : st));
    if (idx === 0 && (patch.engine_count !== undefined || patch.engine_id !== undefined)) {
      setCustomPlacements(null);
    }
    onChangeConfig({ ...config, stages: nextStages });
  };

  const handleApplyRubberEngine = async (): Promise<void> => {
    const refEng = engineById.get(rubberRefId) ?? engines[0];
    if (!refEng) return;
    const scaled = await scaleRubberEngine(refEng, rubberThrustN, rubberPcBar);
    const nextCustom = [...config.custom_engines.filter((e) => e.id.value !== scaled.id.value), scaled];
    const nextStages = config.stages.map((st, idx) =>
      idx === rubberTargetStageIdx ? { ...st, engine_id: scaled.id.value } : st
    );
    onChangeConfig({ ...config, custom_engines: nextCustom, stages: nextStages });
    setCustomPlacements(null);
    setShowRubberModal(false);
  };

  const orbitMetrics = useMemo(() => computeEllipticalOrbitMetrics(config.orbit), [config.orbit]);

  const handlePerigeeChange = (nextPerigeeM: number): void => {
    const clampedHp = Math.max(80_000, nextPerigeeM);
    const nextHa = Math.max(clampedHp, orbitMetrics.apogeeAltM);
    const rp = EARTH_RADIUS_M + clampedHp;
    const ra = EARTH_RADIUS_M + nextHa;
    const ecc = (ra - rp) / (ra + rp);
    onChangeConfig({
      ...config,
      orbit: {
        ...config.orbit,
        preset: "custom",
        altitude_m: clampedHp,
        perigee_altitude_m: clampedHp,
        apogee_altitude_m: nextHa,
        eccentricity: ecc,
      },
    });
  };

  const handleApogeeChange = (nextApogeeM: number): void => {
    const clampedHa = Math.max(orbitMetrics.perigeeAltM, nextApogeeM);
    const rp = EARTH_RADIUS_M + orbitMetrics.perigeeAltM;
    const ra = EARTH_RADIUS_M + clampedHa;
    const ecc = (ra - rp) / (ra + rp);
    onChangeConfig({
      ...config,
      orbit: {
        ...config.orbit,
        preset: "custom",
        altitude_m: orbitMetrics.perigeeAltM,
        perigee_altitude_m: orbitMetrics.perigeeAltM,
        apogee_altitude_m: clampedHa,
        eccentricity: ecc,
      },
    });
  };

  const handleEccentricityChange = (nextEcc: number): void => {
    const ecc = Math.min(0.94, Math.max(0, nextEcc));
    const rp = EARTH_RADIUS_M + orbitMetrics.perigeeAltM;
    const ra = rp * ((1 + ecc) / (1 - ecc));
    const haM = Math.max(orbitMetrics.perigeeAltM, ra - EARTH_RADIUS_M);
    onChangeConfig({
      ...config,
      orbit: {
        ...config.orbit,
        preset: "custom",
        altitude_m: orbitMetrics.perigeeAltM,
        perigee_altitude_m: orbitMetrics.perigeeAltM,
        apogee_altitude_m: haM,
        eccentricity: ecc,
      },
    });
  };

  const handleExportBrief = (): void => {
    if (!result) return;
    const markdown = buildDesignJustificationMarkdown(
      config,
      result,
      engines,
      vehicles,
      unitSystem,
      currencyYear
    );
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${config.name.toLowerCase().replace(/\s+/g, "_")}_brief.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const inspectResultMetric = (label: string, key: string, value: number, unit: string, eq: string): void => {
    const prov: ProvenanceValue<number> = {
      value,
      canonical_unit: unit,
      status: "derived",
      derivation: {
        governing_equation: eq,
        input_parameters: {
          payload_kg: config.payload_mass_kg,
          core_diameter_m: config.core_diameter_m,
          stage_count: config.stage_count,
        },
        assumptions: ["Closed-form aerospace sizing solver"],
        solver_method: "Tsiolkovsky & Roark structural closure",
        confidence_rating: "high",
      },
    };
    onInspect({
      entityName: config.name,
      fieldLabel: label,
      fieldKey: key,
      provenance: prov,
    });
  };

  const mUnit = unitLabel("mass", unitSystem);
  const lenUnit = unitLabel("length", unitSystem);
  const altUnit = unitLabel("altitude", unitSystem);
  const forceUnit = unitLabel("force", unitSystem);
  const pressUnit = unitLabel("pressure", unitSystem);
  const costUnit = unitLabel("cost_per_mass", unitSystem);

  const applyOrbitGuide = (entry: OrbitRegimeGuideEntry): void => {
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

  const subTabs: Array<{ id: StudioSubTab; label: string }> = [
    { id: "design", label: "Design & Layout" },
    { id: "inspect", label: "Inspect Design Stats" },
    { id: "trajectory", label: "Full Trajectory Analysis" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 p-1.5">
        {subTabs.map((tab) => (
          <button
            key={tab.id}
            id={`sizing_studio.subtab_${tab.id}`}
            type="button"
            title={`Switch to ${tab.label}`}
            onClick={() => setSubTab(tab.id)}
            className={`rounded-md px-4 py-2 text-sm font-semibold transition ${
              subTab === tab.id ? "bg-sky-600 text-white shadow" : "text-slate-200 hover:bg-slate-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
        <button
          id="sizing_studio.orbit_guide_btn"
          type="button"
          title="Open standard orbit regime table (LEO, SSO, MEO, GTO, GEO) to auto-fill target orbit altitudes."
          onClick={() => setShowOrbitGuide(true)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-sky-500/50 bg-sky-500/15 px-3 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-500/25"
        >
          <span aria-hidden="true">?</span> Orbit Guide
        </button>
      </div>

      {showOrbitGuide && (
        <OrbitGuideModal unitSystem={unitSystem} onApply={applyOrbitGuide} onClose={() => setShowOrbitGuide(false)} />
      )}

      {subTab === "inspect" &&
        (result ? (
          <DesignInspectorPanel
            config={config}
            result={result}
            engines={engines}
            vehicles={vehicles}
            unitSystem={unitSystem}
            currencyYear={currencyYear}
            onInspectProvenance={onInspect}
          />
        ) : (
          <div className="panel-card p-6 text-sm text-slate-300">Evaluating configuration...</div>
        ))}

      {subTab === "trajectory" && <TrajectoryAnalysisPanel config={config} unitSystem={unitSystem} />}

      {subTab === "design" && (
    <>
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      {/* Left Configuration Column */}
      <div className="space-y-3 lg:col-span-4">
        <div className="panel-card space-y-2.5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-sky-300">
                Single Config Evaluator
              </h2>
              <p className="text-[11px] text-slate-400">
                Evaluate one specific stage &amp; engine configuration
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <label htmlFor="sizing_studio.vehicle_name" className="text-xs font-medium text-slate-300">
                Name:
              </label>
              <input
                id="sizing_studio.vehicle_name"
                type="text"
                title="Vehicle design title. When custom, this name is displayed in the preset dropdown."
                value={config.name}
                onChange={(e) => onChangeConfig({ ...config, name: e.target.value })}
                className="input-field text-xs font-medium px-2 py-0.5 w-40 text-slate-100"
                placeholder="Vehicle Name"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 bg-slate-950/60 p-2">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-300">Stages:</span>
              <button
                id="sizing_studio.stages_2" title="Configure vehicle for a 2-stage liquid core + upper architecture"
                type="button"
                onClick={() => handleSetStageCount(2)}
                className={`rounded border px-2 py-0.5 text-xs ${
                  config.stages.length === 2 ? "border-sky-400 bg-sky-600 text-white" : "border-slate-700 bg-slate-900 text-slate-300"
                }`}
              >
                2-Stage
              </button>
              <button
                id="sizing_studio.stages_3" title="Configure vehicle for a 3-stage liquid core + upper + kick architecture"
                type="button"
                onClick={() => handleSetStageCount(3)}
                className={`rounded border px-2 py-0.5 text-xs ${
                  config.stages.length === 3 ? "border-sky-400 bg-sky-600 text-white" : "border-slate-700 bg-slate-900 text-slate-300"
                }`}
              >
                3-Stage
              </button>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-slate-200 cursor-pointer">
              <input
                id="sizing_studio.fixed_glow_toggle"
                type="checkbox"
                checked={fixedGlowMode}
                onChange={(e) => setFixedGlowMode(e.target.checked)}
                className="accent-sky-500"
              />
              <span>Fixed GLOW Solve</span>
            </label>
          </div>

          {fixedGlowMode && (
            <div className="flex items-end gap-2 rounded border border-sky-800 bg-slate-950 p-2">
              <div className="flex-1">
                <label className="text-xs text-slate-300">Target GLOW ({mUnit})</label>
                <input
                  id="sizing_studio.target_glow"
                  type="number"
                  min={5000}
                  step={5000}
                  value={Math.round(convertFromSi(targetGlowKg, "mass", unitSystem))}
                  onChange={(e) => setTargetGlowKg(Math.max(5000, convertToSi(Number(e.target.value) || 50000, "mass", unitSystem)))}
                  className="input-field w-full font-mono text-xs"
                />
              </div>
              <button
                id="sizing_studio.solve_max_payload" title="Solve for maximum deliverable orbit payload given the fixed GLOW cap"
                type="button"
                disabled={isSolvingGlow}
                onClick={() => void handleSolveFixedGlow()}
                className="btn-primary px-3 py-1.5 text-xs font-semibold"
              >
                {isSolvingGlow ? "Solving..." : "Solve Max Payload"}
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="text-xs text-slate-300" title="Perigee altitude: Altitude of closest approach to Earth's surface. Must exceed 160 km to avoid immediate atmospheric decay.">
                Perigee Alt ({altUnit})
              </label>
              <input
                id="sizing_studio.perigee_alt"
                type="number"
                min={50}
                step={10}
                title="Perigee altitude: Altitude of closest approach to Earth's surface. Must exceed 160 km to avoid immediate atmospheric decay."
                onWheel={(e) => e.currentTarget.blur()}
                value={Math.round(convertFromSi(orbitMetrics.perigeeAltM, "altitude", unitSystem))}
                onChange={(e) => handlePerigeeChange(convertToSi(Number(e.target.value) || 0, "altitude", unitSystem))}
                className="input-field w-full font-mono text-xs"
              />
            </div>
            <div>
              <label className="text-xs text-slate-300" title="Apogee altitude: Farthest point from Earth's surface in the target orbit. Demands additional stage propellant energy.">
                Apogee Alt ({altUnit})
              </label>
              <input
                id="sizing_studio.apogee_alt"
                type="number"
                min={50}
                step={10}
                title="Apogee altitude: Farthest point from Earth's surface in the target orbit. Demands additional stage propellant energy."
                onWheel={(e) => e.currentTarget.blur()}
                value={Math.round(convertFromSi(orbitMetrics.apogeeAltM, "altitude", unitSystem))}
                onChange={(e) => handleApogeeChange(convertToSi(Number(e.target.value) || 0, "altitude", unitSystem))}
                className="input-field w-full font-mono text-xs"
              />
            </div>
            <div>
              <label className="text-xs text-slate-300" title="Orbital eccentricity: 0.0 is circular, 0 < e < 1 is elliptical. Derived from apogee and perigee radii.">
                Eccentricity (e)
              </label>
              <input
                id="sizing_studio.eccentricity"
                type="number"
                min={0}
                max={0.94}
                step={0.001}
                title="Orbital eccentricity: 0.0 is circular, 0 < e < 1 is elliptical. Derived from apogee and perigee radii."
                onWheel={(e) => e.currentTarget.blur()}
                value={Number(orbitMetrics.eccentricity.toFixed(4))}
                onChange={(e) => handleEccentricityChange(Number(e.target.value) || 0)}
                className="input-field w-full font-mono text-xs"
              />
            </div>
            <div>
              <label className="text-xs text-slate-300" title="Orbital inclination in degrees relative to the equator. Determines ground track latitude coverage.">
                Inclination (deg)
              </label>
              <input
                id="sizing_studio.inclination"
                type="number"
                min={0}
                max={180}
                step={0.1}
                title="Orbital inclination in degrees relative to the equator. Determines ground track latitude coverage."
                onWheel={(e) => e.currentTarget.blur()}
                value={Number(config.orbit.inclination_deg.toFixed(1))}
                onChange={(e) => onChangeConfig({ ...config, orbit: { ...config.orbit, preset: "custom", inclination_deg: Math.min(180, Math.max(0, Number(e.target.value) || 0)) } })}
                className="input-field w-full font-mono text-xs"
              />
            </div>
            <div>
              <label className="text-xs text-slate-300" title="Launch site latitude in degrees. Launches due east capture Earth's peripheral rotational velocity.">
                Launch Lat (deg)
              </label>
              <input
                id="sizing_studio.launch_lat"
                type="number"
                min={-90}
                max={90}
                step={0.1}
                title="Launch site latitude in degrees. Launches due east capture Earth's peripheral rotational velocity."
                onWheel={(e) => e.currentTarget.blur()}
                value={Number(config.orbit.launch_latitude_deg.toFixed(1))}
                onChange={(e) => onChangeConfig({ ...config, orbit: { ...config.orbit, preset: "custom", launch_latitude_deg: Math.min(90, Math.max(-90, Number(e.target.value) || 0)) } })}
                className="input-field w-full font-mono text-xs"
              />
            </div>
            <div>
              <label className="text-xs text-slate-300" title="Target payload mass delivered into the target orbit. Automatically updates heritage limits and envelopes when auto-defaults is enabled.">
                Payload ({mUnit})
              </label>
              <input
                id="sizing_studio.payload_mass"
                type="number"
                min={100}
                step={250}
                title="Target payload mass delivered into the target orbit. Automatically updates heritage limits and envelopes when auto-defaults is enabled."
                onWheel={(e) => e.currentTarget.blur()}
                value={Math.round(convertFromSi(config.payload_mass_kg, "mass", unitSystem))}
                onChange={(e) => {
                  const newPayload = Math.max(50, convertToSi(Number(e.target.value) || 0, "mass", unitSystem));
                  if (!autoConstraints) {
                    onChangeConfig({ ...config, payload_mass_kg: newPayload });
                    return;
                  }
                  let coreDia = config.core_diameter_m;
                  let payDia = config.payload_diameter_m;
                  let payLen = config.payload_length_m;
                  let reuses = config.expected_reuses;
                  let prodQty = config.production_quantity;

                  if (newPayload <= 1_500) {
                    if (coreDia > 3.0 || coreDia < 1.0) coreDia = 1.2;
                    payDia = Math.max(1.0, Math.min(2.0, Number((coreDia * 1.0).toFixed(2))));
                    payLen = 2.5;
                    reuses = 5;
                    prodQty = 30;
                  } else if (newPayload <= 25_000) {
                    if (coreDia > 6.0 || coreDia < 2.5) coreDia = 3.7;
                    payDia = Math.max(3.5, Math.min(5.2, Number((coreDia * 1.25).toFixed(2))));
                    payLen = 8.5;
                    reuses = 15;
                    prodQty = 20;
                  } else if (newPayload <= 65_000) {
                    if (coreDia > 8.5 || coreDia < 4.0) coreDia = 5.4;
                    payDia = Math.max(5.0, Math.min(7.0, Number((coreDia * 1.0).toFixed(2))));
                    payLen = 14.0;
                    reuses = 15;
                    prodQty = 15;
                  } else {
                    if (coreDia < 6.5) coreDia = 9.0;
                    payDia = Math.max(6.6, Math.min(10.0, Number((coreDia * 0.95).toFixed(2))));
                    payLen = 18.0;
                    reuses = 25;
                    prodQty = 10;
                  }

                  const candidate: VehicleConfiguration = {
                    ...config,
                    payload_mass_kg: newPayload,
                    core_diameter_m: coreDia,
                    payload_diameter_m: payDia,
                    payload_length_m: payLen,
                    expected_reuses: reuses,
                    production_quantity: prodQty,
                  };
                  const dynamicPreset = computeDynamicConstraintDefaults(candidate);
                  onChangeConfig({
                    ...candidate,
                    constraints: dynamicPreset.constraints,
                    g_limit: dynamicPreset.constraints.max_g_limit ?? candidate.g_limit,
                  });
                }}
                className="input-field w-full font-mono text-xs"
              />
            </div>
            <div>
              <label className="text-xs text-slate-300" title="Usable diameter of the payload compartment inside the protective fairing.">
                Payload Dia ({lenUnit})
              </label>
              <input
                id="sizing_studio.payload_dia"
                type="number"
                step={0.1}
                title="Usable diameter of the payload compartment inside the protective fairing."
                onWheel={(e) => e.currentTarget.blur()}
                value={Number(convertFromSi(config.payload_diameter_m, "length", unitSystem).toFixed(2))}
                onChange={(e) => onChangeConfig({ ...config, payload_diameter_m: Math.max(0.5, convertToSi(Number(e.target.value) || 1, "length", unitSystem)) })}
                className="input-field w-full font-mono text-xs"
              />
            </div>
            <div>
              <label className="text-xs text-slate-300" title="Extra velocity budget reserve added on top of ideal orbital velocity plus ascent losses.">
                Delta-V Margin (%)
              </label>
              <input
                id="sizing_studio.dv_margin_pct"
                type="number"
                min={0}
                max={25}
                step={0.5}
                title="Percentage margin added to total required mission delta-V (default 2.5%)."
                onWheel={(e) => e.currentTarget.blur()}
                value={Number((config.orbit.dv_margin_pct ?? 2.5).toFixed(1))}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    orbit: { ...config.orbit, dv_margin_pct: Math.min(25, Math.max(0, Number(e.target.value) || 0)) },
                  })
                }
                className="input-field w-full font-mono text-xs"
              />
            </div>
            <div>
              <label className="text-xs text-slate-300" title="First stage core structural diameter, setting frontal aerodynamic area and rocket base packaging area.">
                Core Dia ({lenUnit})
              </label>
              <input
                id="sizing_studio.core_dia"
                type="number"
                step={0.1}
                title="First stage core structural diameter, setting frontal aerodynamic area and rocket base packaging area."
                onWheel={(e) => e.currentTarget.blur()}
                value={Number(convertFromSi(config.core_diameter_m, "length", unitSystem).toFixed(2))}
                onChange={(e) => { setCustomPlacements(null); onChangeConfig({ ...config, core_diameter_m: Math.max(1.0, convertToSi(Number(e.target.value) || 1, "length", unitSystem)) }); }}
                className="input-field w-full font-mono text-xs"
              />
            </div>
          </div>
        </div>

        <div className="panel-card space-y-2.5 p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-sky-300">
              Staging &amp; Propulsion
            </h2>
            <button
              id="sizing_studio.rubber_scale_open"
              type="button"
              title="Open inline parametric rubber engine scaler to create a custom thrust/Pc variant."
              onClick={() => setShowRubberModal((v) => !v)}
              className="btn-secondary px-2 py-1 text-xs"
            >
              Scale Rubber Engine
            </button>
          </div>

          {showRubberModal && (
            <div className="space-y-2 rounded border border-sky-800 bg-slate-950 p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-sky-300">
                  Parametric Rubber Engine Scaler
                </span>
                <button
                  id="sizing_studio.rubber_tutorial_btn"
                  type="button"
                  onClick={() => setShowRubberGuide((v) => !v)}
                  title="Explain the propulsion scaling laws, chamber pressure effects, and mass scaling exponents used for rubber engines."
                  className="inline-flex items-center gap-1 rounded border border-sky-500/50 bg-sky-950/60 px-2 py-0.5 text-[11px] font-semibold text-sky-200 hover:bg-sky-900/60"
                >
                  {showRubberGuide ? "Hide Tutorial" : "? What is a Rubber Engine?"}
                </button>
              </div>

              {showRubberGuide && (
                <div className="rounded-md border border-sky-700/50 bg-sky-950/40 p-2.5 text-xs text-slate-300 space-y-1.5">
                  <div className="font-semibold text-sky-200">How Parametric Rubber Scaling Works:</div>
                  <p>
                    A <em>&quot;rubber engine&quot;</em> is an aerospace conceptual design methodology that parametrically resizes a proven baseline liquid propulsion system up or down while maintaining identical propellant chemistry, thermodynamic cycle, and expansion physics.
                  </p>
                  <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-300">
                    <li><strong>Mass Flow Rate:</strong> Scales proportionally with target vacuum thrust: <code>&dot;m = &dot;m_ref &times; (F / F_ref)</code>.</li>
                    <li><strong>Throat Area &amp; Nozzle Exit:</strong> Governed by 1D isentropic gas dynamics: <code>A_t = (&dot;m &times; c*) / p_c</code>. Increased chamber pressure reduces throat diameter for a given thrust.</li>
                    <li><strong>Engine Dry Mass:</strong> Follows empirical turbomachinery scaling: <code>M_dry = M_ref &times; (F / F_ref)^0.85 &times; (p_c / p_c,ref)^-0.15</code>.</li>
                    <li><strong>Specific Impulse:</strong> Corrected for expansion ratio &epsilon; and atmospheric back pressure <code>p_a</code>.</li>
                  </ul>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-300">Reference Engine</label>
                  <select id="sizing_studio.rubber_ref" value={rubberRefId} onChange={(e) => setRubberRefId(e.target.value)} className="input-field w-full text-xs">
                    {engines.filter((e) => e.propulsion_type.value === "liquid").map((e) => (
                      <option key={e.id.value} value={e.id.value}>
                        {e.name.value} ({convertFromSi(e.thrust_vac_n.value, "force", unitSystem).toFixed(0)} {forceUnit})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-300">Assign To Stage</label>
                  <select id="sizing_studio.rubber_target_stage" value={rubberTargetStageIdx} onChange={(e) => setRubberTargetStageIdx(Number(e.target.value))} className="input-field w-full text-xs">
                    {config.stages.map((st, idx) => (
                      <option key={st.stage_number} value={idx}>
                        Stage {st.stage_number}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-300">Target Vac Thrust ({forceUnit})</label>
                  <input
                    id="sizing_studio.rubber_thrust"
                    type="number"
                    min={10}
                    step={50}
                    onWheel={(e) => e.currentTarget.blur()}
                    value={Math.round(convertFromSi(rubberThrustN, "force", unitSystem))}
                    onChange={(e) => setRubberThrustN(Math.max(10_000, convertToSi(Number(e.target.value) || 100, "force", unitSystem)))}
                    className="input-field w-full font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-300">Chamber Pressure ({pressUnit})</label>
                  <input
                    id="sizing_studio.rubber_pc"
                    type="number"
                    min={10}
                    step={10}
                    onWheel={(e) => e.currentTarget.blur()}
                    value={Math.round(convertFromSi(rubberPcBar * 1e5, "pressure", unitSystem))}
                    onChange={(e) => setRubberPcBar(Math.max(15, convertToSi(Number(e.target.value) || 50, "pressure", unitSystem) / 1e5))}
                    className="input-field w-full font-mono text-xs"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button id="sizing_studio.rubber_cancel" title="Cancel Parametric Rubber Engine creation and close modal" type="button" onClick={() => setShowRubberModal(false)} className="btn-secondary px-2 py-1 text-xs">
                  Cancel
                </button>
                <button id="sizing_studio.rubber_apply" title="Create scaled rubber engine and assign it to this stage" type="button" onClick={() => void handleApplyRubberEngine()} className="btn-primary px-2 py-1 text-xs">
                  Create &amp; Assign Engine
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {config.stages.map((st, idx) => (
              <div key={st.stage_number} className="rounded border border-slate-800 bg-slate-950/60 p-2">
                <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-200">
                  <span>Stage {st.stage_number}</span>
                  <span className="font-mono text-slate-400">dV share {(st.delta_v_split_frac * 100).toFixed(0)}%</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <select data-testid="sizing_studio.stage_engine" value={st.engine_id} onChange={(e) => handleStageUpdate(idx, { engine_id: e.target.value })} className="input-field w-full text-[11px]">
                    {allEngines.map((e) => (
                      <option key={e.id.value} value={e.id.value}>
                        {e.name.value} ({formatPropellant(e.propellant.value)})
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-slate-300">Qty</span>
                    <input data-testid="sizing_studio.stage_count" type="number" min={1} max={35} onWheel={(e) => e.currentTarget.blur()} value={st.engine_count} onChange={(e) => handleStageUpdate(idx, { engine_count: Math.max(1, Number(e.target.value) || 1) })} className="input-field w-full font-mono text-xs" />
                  </div>
                  <select data-testid="sizing_studio.stage_material" value={st.tank_material} onChange={(e) => handleStageUpdate(idx, { tank_material: e.target.value as TankMaterialPreset })} className="input-field w-full text-[11px]">
                    <option value="al_li2195">Al-Li 2195</option>
                    <option value="cfrp_composite">CFRP Composite</option>
                    <option value="stainless304_l">304L Stainless</option>
                    <option value="titanium_ti6_al4_v">Ti-6Al-4V</option>
                  </select>
                  <select data-testid="sizing_studio.stage_recovery" value={st.recovery_mode} onChange={(e) => handleStageUpdate(idx, { recovery_mode: e.target.value as RecoveryMode })} className="input-field w-full text-[11px]">
                    <option value="expendable">Expendable</option>
                    <option value="downrange_landing_asds">Downrange ASDS</option>
                    <option value="return_to_launch_site_rtls">RTLS Propulsive</option>
                    <option value="parachute_mid_air_catch">Mid-Air Catch</option>
                  </select>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <div>
              <label className="text-[11px] text-slate-400">Strap-On Boosters</label>
              <select id="sizing_studio.booster_count" value={config.booster_count} onChange={(e) => onChangeConfig({ ...config, booster_count: Number(e.target.value) })} className="input-field w-full text-xs">
                <option value={0}>0 Boosters</option>
                <option value={2}>2 Boosters</option>
                <option value={4}>4 Boosters</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] text-slate-400">Booster Motor</label>
              <select id="sizing_studio.booster_engine" value={config.booster_engine_id ?? ""} disabled={config.booster_count === 0} onChange={(e) => onChangeConfig({ ...config, booster_engine_id: e.target.value || null })} className="input-field w-full text-xs">
                <option value="">None</option>
                {allEngines.map((e) => (
                  <option key={e.id.value} value={e.id.value}>
                    {e.name.value}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-slate-400">Staging Architecture</label>
              <select id="sizing_studio.staging_mode" value={config.staging_mode} onChange={(e) => onChangeConfig({ ...config, staging_mode: e.target.value as StagingArchitectureMode })} className="input-field w-full text-xs">
                <option value="cold_pneumatic_ullage">Cold + Ullage</option>
                <option value="hot_staging_vented_ring">Hot-Staging Ring</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] text-slate-400">Cryo / Fairing</label>
              <select id="sizing_studio.fairing_profile" value={config.fairing_profile} onChange={(e) => onChangeConfig({ ...config, fairing_profile: e.target.value as FairingProfile })} className="input-field w-full text-xs">
                <option value="von_karman">Von Karman</option>
                <option value="tangent_ogive">Tangent Ogive</option>
                <option value="biconic">Biconic</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] text-slate-400">Propellant State</label>
              <select id="sizing_studio.cryo_state" value={config.cryo_state} onChange={(e) => onChangeConfig({ ...config, cryo_state: e.target.value as CryoStateMode })} className="input-field w-full text-xs">
                <option value="standard_boiling">Standard Boiling</option>
                <option value="subcooled_densified">Subcooled Densified</option>
              </select>
            </div>
            {config.stages.length === 2 ? (
              <div>
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>S1 dV Split: {(s1Stage?.delta_v_split_frac * 100 || 38).toFixed(0)}%</span>
                  <span>S2: {((1 - (s1Stage?.delta_v_split_frac || 0.38)) * 100).toFixed(0)}%</span>
                </div>
                <input
                  id="sizing_studio.s1_dv_split"
                  type="range"
                  min={20}
                  max={65}
                  value={Math.round((s1Stage?.delta_v_split_frac ?? 0.38) * 100)}
                  onChange={(e) => {
                    const f1 = Number(e.target.value) / 100;
                    const f2 = 1.0 - f1;
                    onChangeConfig({
                      ...config,
                      stages: config.stages.map((st, idx) =>
                        idx === 0 ? { ...st, delta_v_split_frac: f1 } : { ...st, delta_v_split_frac: f2 }
                      ),
                    });
                  }}
                  className="w-full accent-sky-500"
                />
              </div>
            ) : (
              <div className="space-y-1.5 col-span-2">
                <div className="flex justify-between text-[11px] text-slate-300 font-semibold">
                  <span>Stage Delta-V Split Budget (3-Stage)</span>
                  <span className="font-mono text-xs text-sky-300">
                    S1: {(config.stages[0]?.delta_v_split_frac * 100).toFixed(0)}% | S2: {(config.stages[1]?.delta_v_split_frac * 100).toFixed(0)}% | S3: {(config.stages[2]?.delta_v_split_frac * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-slate-400">S1 Boost Split (%)</label>
                    <input
                      id="sizing_studio.s1_split_input"
                      type="number"
                      min={15}
                      max={60}
                      step={1}
                      value={Math.round(config.stages[0]?.delta_v_split_frac * 100)}
                      onChange={(e) => {
                        const val = Math.max(0.15, Math.min(0.60, Number(e.target.value) / 100));
                        const remain = 1.0 - val;
                        const s2 = remain * 0.60;
                        const s3 = remain * 0.40;
                        onChangeConfig({
                          ...config,
                          stages: config.stages.map((st, idx) =>
                            idx === 0 ? { ...st, delta_v_split_frac: val } : idx === 1 ? { ...st, delta_v_split_frac: s2 } : { ...st, delta_v_split_frac: s3 }
                          ),
                        });
                      }}
                      className="input-field w-full font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400">S2 Split (%)</label>
                    <input
                      id="sizing_studio.s2_split_input"
                      type="number"
                      min={15}
                      max={65}
                      step={1}
                      value={Math.round(config.stages[1]?.delta_v_split_frac * 100)}
                      onChange={(e) => {
                        const val = Math.max(0.15, Math.min(0.65, Number(e.target.value) / 100));
                        const s1 = config.stages[0].delta_v_split_frac;
                        const s3 = Math.max(0.10, 1.0 - s1 - val);
                        onChangeConfig({
                          ...config,
                          stages: config.stages.map((st, idx) =>
                            idx === 1 ? { ...st, delta_v_split_frac: val } : idx === 2 ? { ...st, delta_v_split_frac: s3 } : st
                          ),
                        });
                      }}
                      className="input-field w-full font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400">S3 Split (%)</label>
                    <input
                      id="sizing_studio.s3_split_input"
                      type="number"
                      min={10}
                      max={50}
                      step={1}
                      value={Math.round(config.stages[2]?.delta_v_split_frac * 100)}
                      onChange={(e) => {
                        const val = Math.max(0.10, Math.min(0.50, Number(e.target.value) / 100));
                        const s1 = config.stages[0].delta_v_split_frac;
                        const s2 = Math.max(0.15, 1.0 - s1 - val);
                        onChangeConfig({
                          ...config,
                          stages: config.stages.map((st, idx) =>
                            idx === 2 ? { ...st, delta_v_split_frac: val } : idx === 1 ? { ...st, delta_v_split_frac: s2 } : st
                          ),
                        });
                      }}
                      className="input-field w-full font-mono text-xs"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 border-t border-slate-800 pt-2">
            <div>
              <label className="text-xs text-slate-300" title="Expected operational flights per reusable booster core before hardware retirement.">
                Reuses per Booster
              </label>
              <input
                id="sizing_studio.expected_reuses"
                type="number"
                min={1}
                max={100}
                title="Expected operational flights per reusable booster core before hardware retirement."
                onWheel={(e) => e.currentTarget.blur()}
                value={config.expected_reuses}
                onChange={(e) => onChangeConfig({ ...config, expected_reuses: Math.max(1, Number(e.target.value) || 1) })}
                className="input-field w-full font-mono text-xs"
              />
            </div>
            <div>
              <label className="text-xs text-slate-300" title="Mass growth contingency allowance applied to all dry stage structures per AIAA S-120 standards.">
                Mass Margin (%)
              </label>
              <input
                id="sizing_studio.mass_margin"
                type="number"
                min={0}
                max={60}
                step={1}
                title="Mass growth contingency allowance applied to all dry stage structures per AIAA S-120 standards."
                onWheel={(e) => e.currentTarget.blur()}
                value={Math.round((config.mass_margin_frac ?? 0.25) * 100)}
                onChange={(e) => onChangeConfig({ ...config, mass_margin_frac: Math.min(0.6, Math.max(0, (Number(e.target.value) || 0) / 100)) })}
                className="input-field w-full font-mono text-xs"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <label
              className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer"
              title="Strictly verifies that all stage engines fit inside the core base skirt diameter without overlapping or nozzle TVC gimbal collisions."
            >
              <input id="sizing_studio.enforce_packing" type="checkbox" checked={config.constraints.enforce_base_packing} onChange={(e) => onChangeConfig({ ...config, constraints: { ...config.constraints, enforce_base_packing: e.target.checked } })} />
              Enforce Base Packing
            </label>
            <label
              className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer"
              title="Eliminates heavy helium COPV bottles by heating propellant in engine heat exchangers to pressurize propellant tanks autogenously."
            >
              <input id="sizing_studio.pressurization_toggle" type="checkbox" checked={s1Stage?.pressurization === "autogenous"} onChange={(e) => { const mode: PressurizationMode = e.target.checked ? "autogenous" : "helium_copv"; onChangeConfig({ ...config, stages: config.stages.map((st) => ({ ...st, pressurization: mode })) }); }} />
              Autogenous Pressurization
            </label>
          </div>
        </div>

        <details className="panel-card p-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-100 hover:text-white">
            Recovery Optimizer &amp; Stage Reusability
          </summary>
          <div className="mt-3">
            <RecoveryOptimizerPanel
              config={config}
              onChangeConfig={onChangeConfig}
              unitSystem={unitSystem}
              inflationFactor={adjustInflationUsd(1, 2026, currencyYear)}
              currencyYear={currencyYear}
              idPrefix="studio"
            />
          </div>
        </details>

        <details className="panel-card p-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-100 hover:text-white">
            Per-Stage Engine &amp; Fuel Filters
          </summary>
          <div className="mt-3">
            <AdvancedStageConstraintsPanel
              config={config}
              engines={allEngines}
              onChangeConfig={onChangeConfig}
            />
          </div>
        </details>

        <details className="panel-card p-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-100 hover:text-white">
            Constraints &amp; Overrides
          </summary>
          <div className="mt-3">
            <ConstraintOverridePanel
              config={config}
              onChangeConfig={onChangeConfig}
              unitSystem={unitSystem}
              autoDefaults={autoConstraints}
              onChangeAutoDefaults={setAutoConstraints}
            />
          </div>
        </details>

        <details className="panel-card p-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-100 hover:text-white">
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
      </div>

      {/* Center Vector Schematic & Analytics */}
      <div className="space-y-3 lg:col-span-5">
        <RocketSchematic config={config} result={result} engines={allEngines} unitSystem={unitSystem} />
        <div className="grid grid-cols-1 gap-3">
          <MassTreemapChart result={result} unitSystem={unitSystem} />
          <DeltaVWaterfallChart breakdown={result?.delta_v_breakdown ?? null} unitSystem={unitSystem} />
        </div>
      </div>

      {/* Right Base Layout & Output Summary */}
      <div className="space-y-3 lg:col-span-3">
        <BaseLayoutView
          stageDiameterM={config.core_diameter_m}
          layout={packingResult}
          placementsInput={derivedPlacements}
          constraints={packingConstraints}
          unitSystem={unitSystem}
          onUpdatePlacements={(next) => setCustomPlacements(next)}
          onUpdateConstraints={(patch) =>
            onChangeConfig({
              ...config,
              advanced_defaults: {
                ...advDefaults,
                ...(patch.skirt_wall_thickness_m !== undefined
                  ? { skirt_wall_thickness_m: patch.skirt_wall_thickness_m }
                  : {}),
                ...(patch.skirt_clearance_m !== undefined
                  ? { skirt_clearance_m: patch.skirt_clearance_m }
                  : {}),
                ...(patch.no_touch_margin_m !== undefined
                  ? { no_touch_margin_m: patch.no_touch_margin_m }
                  : {}),
                ...(patch.default_tvc_angle_deg !== undefined
                  ? { tvc_angle_deg: patch.default_tvc_angle_deg }
                  : {}),
              },
            })
          }
          gimbalLeverArmRatio={advDefaults.gimbal_lever_arm_ratio}
          onUpdateLeverArmRatio={(ratio) =>
            onChangeConfig({
              ...config,
              advanced_defaults: { ...advDefaults, gimbal_lever_arm_ratio: ratio },
            })
          }
          onResetLayout={() => setCustomPlacements(null)}
        />

        <div className="panel-card space-y-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-slate-800 pb-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-200">
              Sizing Output &amp; Cost
            </h3>
            <div className="flex items-center gap-1.5">
              {result && (
                <FeasibilityBadge
                  feasible={result.feasible}
                  label={result.feasible ? "Feasible" : `${result.violation_messages.length} Violations`}
                  result={result}
                  config={config}
                  unitSystem={unitSystem}
                />
              )}
              <button
                id="sizing_studio.export_brief_btn"
                type="button"
                title="Download a Markdown summary brief of this vehicle configuration and sizing metrics."
                onClick={handleExportBrief}
                className="btn-secondary px-2.5 py-1 text-xs"
              >
                Export Brief
              </button>
            </div>
          </div>

          {result ? (
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">GLOW</span>
                <button id="sizing_studio.inspect_glow" type="button" onClick={() => inspectResultMetric("Gross Liftoff Weight", "glow_kg", result.glow_kg, "kg", "Sum of stage propellants, inert masses, fairing, and payload")} title="Inspect GLOW derivation, contributing masses, and source assumptions" className="font-mono text-sky-300 underline decoration-dotted">
                  {Math.round(convertFromSi(result.glow_kg, "mass", unitSystem)).toLocaleString("en-US")} {mUnit}
                </button>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Dry Mass</span>
                <span className="font-mono text-slate-200">
                  {Math.round(convertFromSi(result.total_dry_mass_kg, "mass", unitSystem)).toLocaleString("en-US")} {mUnit}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Payload Fraction</span>
                <span className="font-mono text-emerald-400">
                  {(result.payload_fraction * 100).toFixed(2)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Liftoff T/W0 | Peak G</span>
                <span className="font-mono text-slate-200">
                  {result.liftoff_tw0.toFixed(2)} | {result.peak_accel_g.toFixed(1)} g
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">DDT&amp;E Cost</span>
                <span className="font-mono text-slate-200">
                  ${(result.cost_breakdown.total_ddte_usd / 1e6).toFixed(1)}M
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Reusable Flight</span>
                <button id="sizing_studio.inspect_cost" type="button" onClick={() => inspectResultMetric("Reusable Flight Cost", "reusable_flight_cost_usd", result.cost_breakdown.reusable_flight_cost_usd, "USD", "Amortized hardware + refurb + recovery ops + propellant + range fee")} title="Inspect reusable cost-per-flight amortization and cost assumptions" className="font-mono text-emerald-300 underline decoration-dotted">
                  ${(result.cost_breakdown.reusable_flight_cost_usd / 1e6).toFixed(2)}M
                </button>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Specific Cost</span>
                <span className="font-mono text-slate-200">
                  ${Math.round(convertFromSi(result.cost_breakdown.cost_per_kg_payload_usd, "cost_per_mass", unitSystem)).toLocaleString("en-US")} {costUnit}
                </span>
              </div>

              {result.violation_messages.length > 0 && (
                <div className="mt-2 rounded border border-rose-800 bg-rose-950/50 p-2 text-[11px] text-rose-300">
                  <div className="font-semibold">Constraint Violations:</div>
                  <ul className="list-disc pl-4">
                    {result.violation_messages.map((msg, idx) => (
                      <li key={idx}>{msg}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-400">Evaluating configuration...</p>
          )}
        </div>
      </div>
    </div>
    {result && (
      <DesignJustificationReport
        config={config}
        result={result}
        engines={engines}
        vehicles={vehicles}
        unitSystem={unitSystem}
        currencyYear={currencyYear}
      />
    )}
    </>
      )}
    </div>
  );
}
