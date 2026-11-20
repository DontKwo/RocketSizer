import React, { useEffect, useMemo, useState } from "react";
import { formatEngineCycle, formatPropellant } from "../config/formatters";
import { convertFromSi, convertToSi, unitLabel, type UnitSystem } from "../config/units";
import { scaleRubberEngine } from "../api/tauriClient";
import type { InspectorTarget, ProvenanceValue } from "../types/provenance";
import type { ProvenanceEngine } from "../types/engine";
import { EngineScatterChart } from "../components/charts/TradeCharts";
import {
  VirtualCatalogTable,
  type CatalogColumnGroup,
  type ColumnDef,
  type VisibilityState,
} from "../components/tables/VirtualCatalogTable";

interface HeritageEnginesViewProps {
  engines: ProvenanceEngine[];
  customEngines: ProvenanceEngine[];
  onAddCustomEngine: (engine: ProvenanceEngine) => void;
  unitSystem: UnitSystem;
  onInspect: (target: InspectorTarget) => void;
}

const ENGINE_COLUMN_GROUPS: CatalogColumnGroup[] = [
  {
    group: "Identity & Propellant",
    columns: [
      { id: "name", label: "Engine" },
      { id: "manufacturer", label: "Manufacturer" },
      { id: "propellant", label: "Propellant" },
      { id: "cycle", label: "Power Cycle" },
      { id: "oxidizer_fuel_ratio", label: "O/F Ratio" },
    ],
  },
  {
    group: "Performance",
    columns: [
      { id: "thrust_sl_n", label: "Thrust SL" },
      { id: "thrust_vac_n", label: "Thrust Vac" },
      { id: "isp_sl_s", label: "Isp SL" },
      { id: "isp_vac_s", label: "Isp Vac" },
      { id: "mass_flow_rate_kg_s", label: "Mass Flow" },
      { id: "chamber_pressure_bar", label: "Pc" },
      { id: "expansion_ratio", label: "Expansion Ratio" },
      { id: "throttle_range", label: "Throttle (%)" },
      { id: "restart_capable", label: "Restarts" },
    ],
  },
  {
    group: "Envelope & Cost",
    columns: [
      { id: "dry_mass_kg", label: "Dry Mass" },
      { id: "thrust_to_weight_vac", label: "T/W Vac" },
      { id: "nozzle_diameter_m", label: "Nozzle Dia" },
      { id: "height_m", label: "Height" },
      { id: "tvc_gimbal_range_deg", label: "TVC Deg" },
      { id: "unit_cost_usd", label: "Unit Cost" },
    ],
  },
];

const INITIAL_ENGINE_VISIBILITY: VisibilityState = {};

export function HeritageEnginesView({
  engines,
  customEngines,
  onAddCustomEngine,
  unitSystem,
  onInspect,
}: HeritageEnginesViewProps): React.ReactElement {
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedManufacturers, setSelectedManufacturers] = useState<string[]>([]);
  const [selectedPropellants, setSelectedPropellants] = useState<string[]>([]);
  const [selectedCycles, setSelectedCycles] = useState<string[]>([]);
  const [selectedPropulsionTypes, setSelectedPropulsionTypes] = useState<string[]>([]);
  const [filterMode, setFilterMode] = useState<"or" | "and">("and");
  const [minThrustKn, setMinThrustKn] = useState<string>("");
  const [maxThrustKn, setMaxThrustKn] = useState<string>("");
  const [minIspVac, setMinIspVac] = useState<string>("");
  const [maxIspVac, setMaxIspVac] = useState<string>("");
  const [manufSearch, setManufSearch] = useState<string>("");
  const [showSidebar, setShowSidebar] = useState<boolean>(false);

  const [refEngineId, setRefEngineId] = useState<string>("merlin_1d");
  const [targetThrustN, setTargetThrustN] = useState<number>(981_000);
  const [targetPcBar, setTargetPcBar] = useState<number>(108);
  const [scaledPreview, setScaledPreview] = useState<ProvenanceEngine | null>(null);
  const [showWorkshopHelp, setShowWorkshopHelp] = useState<boolean>(false);

  const combinedEngines = useMemo(
    () => [...engines, ...customEngines],
    [engines, customEngines]
  );

  const liquidEngines = useMemo(
    () => engines.filter((e) => e.propulsion_type.value === "liquid"),
    [engines]
  );

  useEffect(() => {
    if (liquidEngines.length === 0) return;
    const current = liquidEngines.find((e) => e.id.value === refEngineId) ?? liquidEngines[0];
    if (current.id.value !== refEngineId) {
      setRefEngineId(current.id.value);
    }
    setTargetThrustN(Math.round(current.thrust_vac_n.value));
    setTargetPcBar(Math.round(current.chamber_pressure_bar.value));
    void scaleRubberEngine(current, current.thrust_vac_n.value, current.chamber_pressure_bar.value).then(
      (res) => setScaledPreview(res)
    );
  }, [liquidEngines]);

  const handleSelectRefEngine = (nextId: string): void => {
    setRefEngineId(nextId);
    const refEng = combinedEngines.find((e) => e.id.value === nextId);
    if (!refEng) return;
    const thrustN = Math.round(refEng.thrust_vac_n.value);
    const pcBar = Math.round(refEng.chamber_pressure_bar.value);
    setTargetThrustN(thrustN);
    setTargetPcBar(pcBar);
    void scaleRubberEngine(refEng, thrustN, pcBar).then((res) => setScaledPreview(res));
  };

  const manufacturerCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of combinedEngines) {
      const m = e.manufacturer.value || "Unknown";
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [combinedEngines]);

  const propellantCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of combinedEngines) {
      const p = e.propellant.value || "unknown";
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [combinedEngines]);

  const cycleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of combinedEngines) {
      const c = e.cycle.value || "unknown";
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [combinedEngines]);

  const propulsionTypeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of combinedEngines) {
      const pt = e.propulsion_type.value || "liquid";
      counts.set(pt, (counts.get(pt) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [combinedEngines]);

  const toggleFilter = (list: string[], setList: (next: string[]) => void, item: string): void => {
    if (list.includes(item)) {
      setList(list.filter((x) => x !== item));
    } else {
      setList([...list, item]);
    }
  };

  const clearAllFilters = (): void => {
    setSearchQuery("");
    setSelectedManufacturers([]);
    setSelectedPropellants([]);
    setSelectedCycles([]);
    setSelectedPropulsionTypes([]);
    setMinThrustKn("");
    setMaxThrustKn("");
    setMinIspVac("");
    setMaxIspVac("");
    setManufSearch("");
  };

  const totalActiveFilterCount =
    selectedManufacturers.length +
    selectedPropellants.length +
    selectedCycles.length +
    selectedPropulsionTypes.length +
    (minThrustKn !== "" ? 1 : 0) +
    (maxThrustKn !== "" ? 1 : 0) +
    (minIspVac !== "" ? 1 : 0) +
    (maxIspVac !== "" ? 1 : 0) +
    (searchQuery.trim() !== "" ? 1 : 0);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const minT = minThrustKn !== "" ? Number(minThrustKn) * 1000 : null;
    const maxT = maxThrustKn !== "" ? Number(maxThrustKn) * 1000 : null;
    const minIsp = minIspVac !== "" ? Number(minIspVac) : null;
    const maxIsp = maxIspVac !== "" ? Number(maxIspVac) : null;

    return combinedEngines.filter((e) => {
      if (q) {
        const propLabel = formatPropellant(e.propellant.value).toLowerCase();
        const cycLabel = formatEngineCycle(e.cycle.value).toLowerCase();
        const matchesQuery =
          e.name.value.toLowerCase().includes(q) ||
          e.manufacturer.value.toLowerCase().includes(q) ||
          e.id.value.toLowerCase().includes(q) ||
          propLabel.includes(q) ||
          cycLabel.includes(q);
        if (!matchesQuery) return false;
      }

      if (minT !== null && !Number.isNaN(minT)) {
        if (e.thrust_vac_n.value < minT) return false;
      }
      if (maxT !== null && !Number.isNaN(maxT)) {
        if (e.thrust_vac_n.value > maxT) return false;
      }

      if (minIsp !== null && !Number.isNaN(minIsp)) {
        if (e.isp_vac_s.value < minIsp) return false;
      }
      if (maxIsp !== null && !Number.isNaN(maxIsp)) {
        if (e.isp_vac_s.value > maxIsp) return false;
      }

      const hasManuf = selectedManufacturers.length > 0;
      const hasProp = selectedPropellants.length > 0;
      const hasCycle = selectedCycles.length > 0;
      const hasType = selectedPropulsionTypes.length > 0;

      if (!hasManuf && !hasProp && !hasCycle && !hasType) {
        return true;
      }

      const matchManuf = hasManuf && selectedManufacturers.includes(e.manufacturer.value);
      const matchProp = hasProp && selectedPropellants.includes(e.propellant.value);
      const matchCycle = hasCycle && selectedCycles.includes(e.cycle.value);
      const matchType = hasType && selectedPropulsionTypes.includes(e.propulsion_type.value);

      if (filterMode === "and") {
        if (hasManuf && !matchManuf) return false;
        if (hasProp && !matchProp) return false;
        if (hasCycle && !matchCycle) return false;
        if (hasType && !matchType) return false;
        return true;
      }
      return matchManuf || matchProp || matchCycle || matchType;
    });
  }, [
    combinedEngines,
    searchQuery,
    selectedManufacturers,
    selectedPropellants,
    selectedCycles,
    selectedPropulsionTypes,
    filterMode,
    minThrustKn,
    maxThrustKn,
    minIspVac,
    maxIspVac,
  ]);

  const handleComputeScale = async (): Promise<void> => {
    const refEng = combinedEngines.find((e) => e.id.value === refEngineId) ?? engines[0];
    if (!refEng) return;
    const scaled = await scaleRubberEngine(refEng, targetThrustN, targetPcBar);
    setScaledPreview(scaled);
  };

  const makeCellInspect = (
    engine: ProvenanceEngine,
    fieldLabel: string,
    fieldKey: string,
    provenance: ProvenanceValue<unknown>,
    display: string
  ): React.ReactElement => {
    const badge = provenance.status === "primary_source"
      ? "border-emerald-500/60 bg-slate-900"
      : "border-slate-700 bg-slate-900";
    return (
      <button data-testid="heritage_engines.inspect_cell" title={`Inspect data provenance and source citation for ${fieldLabel}`} type="button" onClick={() => onInspect({ entityName: engine.name.value, fieldLabel, fieldKey, provenance })} className={`rounded border px-2 py-1 text-left font-mono text-xs text-slate-100 hover:bg-slate-800 hover:border-sky-400 ${badge}`}>
        {display}
      </button>
    );
  };

  const columns = useMemo<ColumnDef<ProvenanceEngine, unknown>[]>(() => {
    const fUnit = unitLabel("force", unitSystem);
    const mUnit = unitLabel("mass", unitSystem);
    const lUnit = unitLabel("length", unitSystem);
    const pUnit = unitLabel("pressure", unitSystem);
    const mfUnit = unitLabel("mass_flow", unitSystem);

    return [
      {
        id: "name",
        header: "Engine",
        accessorFn: (row) => row.name.value,
        cell: ({ row }) => makeCellInspect(row.original, "Engine Name", "name", row.original.name, row.original.name.value),
      },
      {
        id: "manufacturer",
        header: "Manufacturer",
        accessorFn: (row) => row.manufacturer.value,
      },
      {
        id: "propellant",
        header: "Propellant",
        accessorFn: (row) => formatPropellant(row.propellant.value),
      },
      {
        id: "cycle",
        header: "Cycle",
        accessorFn: (row) => formatEngineCycle(row.cycle.value),
      },
      {
        id: "oxidizer_fuel_ratio",
        header: "O/F",
        accessorFn: (row) => row.oxidizer_fuel_ratio.value,
        cell: ({ row }) => row.original.oxidizer_fuel_ratio.value.toFixed(2),
      },
      {
        id: "thrust_sl_n",
        header: `SL Thrust (${fUnit})`,
        accessorFn: (row) => convertFromSi(row.thrust_sl_n.value, "force", unitSystem),
        cell: ({ row }) => convertFromSi(row.original.thrust_sl_n.value, "force", unitSystem).toFixed(0),
      },
      {
        id: "thrust_vac_n",
        header: `Vac Thrust (${fUnit})`,
        accessorFn: (row) => convertFromSi(row.thrust_vac_n.value, "force", unitSystem),
        cell: ({ row }) =>
          makeCellInspect(
            row.original,
            "Vacuum Thrust",
            "thrust_vac_n",
            row.original.thrust_vac_n,
            convertFromSi(row.original.thrust_vac_n.value, "force", unitSystem).toFixed(0)
          ),
      },
      {
        id: "isp_sl_s",
        header: "Isp SL (s)",
        accessorFn: (row) => row.isp_sl_s.value,
        cell: ({ row }) => row.original.isp_sl_s.value.toFixed(1),
      },
      {
        id: "isp_vac_s",
        header: "Isp Vac (s)",
        accessorFn: (row) => row.isp_vac_s.value,
        cell: ({ row }) =>
          makeCellInspect(
            row.original,
            "Vacuum Isp",
            "isp_vac_s",
            row.original.isp_vac_s,
            row.original.isp_vac_s.value.toFixed(1)
          ),
      },
      {
        id: "mass_flow_rate_kg_s",
        header: `Flow (${mfUnit})`,
        accessorFn: (row) => convertFromSi(row.mass_flow_rate_kg_s.value, "mass_flow", unitSystem),
        cell: ({ row }) => convertFromSi(row.original.mass_flow_rate_kg_s.value, "mass_flow", unitSystem).toFixed(1),
      },
      {
        id: "chamber_pressure_bar",
        header: `Pc (${pUnit})`,
        accessorFn: (row) => convertFromSi(row.chamber_pressure_bar.value * 1e5, "pressure", unitSystem),
        cell: ({ row }) =>
          convertFromSi(row.original.chamber_pressure_bar.value * 1e5, "pressure", unitSystem).toFixed(0),
      },
      {
        id: "expansion_ratio",
        header: "Ae/At",
        accessorFn: (row) => row.expansion_ratio.value,
        cell: ({ row }) => row.original.expansion_ratio.value.toFixed(1),
      },
      {
        id: "throttle_range",
        header: "Throttle (%)",
        accessorFn: (row) =>
          row.min_throttle_pct && row.max_throttle_pct
            ? `${row.min_throttle_pct.value}-${row.max_throttle_pct.value}%`
            : "100%",
        cell: ({ row }) =>
          row.original.min_throttle_pct && row.original.max_throttle_pct && row.original.min_throttle_pct.value < 100
            ? `${row.original.min_throttle_pct.value}-${row.original.max_throttle_pct.value}%`
            : "100%",
      },
      {
        id: "restart_capable",
        header: "Restarts",
        accessorFn: (row) => (row.restarts_rated ? row.restarts_rated.value : 1),
        cell: ({ row }) =>
          row.original.restarts_rated && row.original.restarts_rated.value > 1
            ? `${row.original.restarts_rated.value}x`
            : "1",
      },
      {
        id: "dry_mass_kg",
        header: `Dry Mass (${mUnit})`,
        accessorFn: (row) => convertFromSi(row.dry_mass_kg.value, "mass", unitSystem),
        cell: ({ row }) => convertFromSi(row.original.dry_mass_kg.value, "mass", unitSystem).toFixed(0),
      },
      {
        id: "thrust_to_weight_vac",
        header: "T/W Vac",
        accessorFn: (row) => row.thrust_to_weight_vac.value,
        cell: ({ row }) => row.original.thrust_to_weight_vac.value.toFixed(1),
      },
      {
        id: "nozzle_diameter_m",
        header: `Nozzle (${lUnit})`,
        accessorFn: (row) => convertFromSi(row.nozzle_diameter_m.value, "length", unitSystem),
        cell: ({ row }) => convertFromSi(row.original.nozzle_diameter_m.value, "length", unitSystem).toFixed(2),
      },
      {
        id: "height_m",
        header: `Height (${lUnit})`,
        accessorFn: (row) => (row.height_m ? convertFromSi(row.height_m.value, "length", unitSystem) : 0),
        cell: ({ row }) =>
          row.original.height_m && row.original.height_m.value > 0
            ? convertFromSi(row.original.height_m.value, "length", unitSystem).toFixed(2)
            : "-",
      },
      {
        id: "tvc_gimbal_range_deg",
        header: "TVC (deg)",
        accessorFn: (row) => row.tvc_gimbal_range_deg.value,
      },
      {
        id: "unit_cost_usd",
        header: "Unit Cost ($M)",
        accessorFn: (row) => row.unit_cost_usd.value,
        cell: ({ row }) =>
          makeCellInspect(
            row.original,
            "Unit Cost",
            "unit_cost_usd",
            row.original.unit_cost_usd,
            `$${(row.original.unit_cost_usd.value / 1e6).toFixed(2)}M`
          ),
      },
    ];
  }, [unitSystem]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <EngineScatterChart
            engines={filtered}
            onSelectEngine={(eng) =>
              onInspect({
                entityName: eng.name.value,
                fieldLabel: "Vacuum Isp",
                fieldKey: "isp_vac_s",
                provenance: eng.isp_vac_s,
              })
            }
          />
        </div>

        <div className="panel-card space-y-2.5 p-3 lg:col-span-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-sky-300">
              Parametric Rubber Engine Workshop
            </h3>
            <button
              id="heritage_engines.rubber_help_btn"
              type="button"
              title="Explain what a rubber engine is and how parametric scaling works."
              onClick={() => setShowWorkshopHelp((v) => !v)}
              className="btn-secondary px-2.5 py-1 text-xs"
            >
              {showWorkshopHelp ? "Hide Guide" : "? What is Rubber Engine Scaling?"}
            </button>
          </div>
          {showWorkshopHelp && (
            <div className="space-y-1.5 rounded border border-sky-700/60 bg-slate-950/90 p-2.5 text-xs text-slate-200">
              <div className="font-semibold text-sky-200">Why scale a &quot;rubber&quot; engine?</div>
              <p className="text-slate-300">
                Real flight engines come in fixed thrust ratings, which can leave gaps during early launch-vehicle sizing. A rubber engine hypothetically scales a proven heritage engine (propellant, cycle, and combustion chemistry held constant) up or down in thrust and chamber pressure to explore custom propulsion sizes before hardware exists.
              </p>
              <p className="text-slate-300">
                Changing the Baseline Engine automatically loads its baseline Vac Thrust and Pc. Adjust either input, inspect the Humble-scaled mass and Isp envelope, then save it to test inside Optimization Search or Sizing Studio.
              </p>
            </div>
          )}
          <p className="text-xs text-slate-400">
            Select a heritage baseline to load its real thrust &amp; Pc, then scale thrust or chamber pressure.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-slate-300" title="Proven liquid heritage engine used as the cycle and propellant baseline.">
                Baseline Engine
              </label>
              <select
                id="heritage_engines.rubber_ref"
                title="Select a baseline heritage engine to populate its thrust and Pc."
                value={refEngineId}
                onChange={(e) => handleSelectRefEngine(e.target.value)}
                className="input-field w-full text-xs"
              >
                {liquidEngines.map((e) => (
                  <option key={e.id.value} value={e.id.value}>
                    {e.name.value}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-300" title="Target vacuum thrust for the scaled engine.">
                Vac Thrust ({unitLabel("force", unitSystem)})
              </label>
              <input
                id="heritage_engines.rubber_thrust"
                type="number"
                min={10}
                step={50}
                title="Target vacuum thrust for parametric scaling."
                onWheel={(e) => e.currentTarget.blur()}
                value={Math.round(convertFromSi(targetThrustN, "force", unitSystem))}
                onChange={(e) => setTargetThrustN(Math.max(10_000, convertToSi(Number(e.target.value) || 100, "force", unitSystem)))}
                className="input-field w-full font-mono text-xs"
              />
            </div>
            <div>
              <label className="text-xs text-slate-300" title="Target main combustion chamber pressure.">
                Pc ({unitLabel("pressure", unitSystem)})
              </label>
              <input
                id="heritage_engines.rubber_pc"
                type="number"
                min={10}
                step={10}
                title="Target chamber pressure for nozzle and turbomachinery scaling."
                onWheel={(e) => e.currentTarget.blur()}
                value={Math.round(convertFromSi(targetPcBar * 1e5, "pressure", unitSystem))}
                onChange={(e) => setTargetPcBar(Math.max(15, convertToSi(Number(e.target.value) || 60, "pressure", unitSystem) / 1e5))}
                className="input-field w-full font-mono text-xs"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="heritage_engines.rubber_preview_btn"
              type="button"
              title="Recompute scaled Isp, engine dry mass, and nozzle exit diameter."
              onClick={() => void handleComputeScale()}
              className="btn-secondary px-3 py-1.5 text-xs"
            >
              Compute Scaled Envelope
            </button>
            {scaledPreview && (
              <button
                id="heritage_engines.rubber_save_btn"
                type="button"
                title="Add this custom scaled engine to the catalog so Sizing Studio and Optimizer can use it."
                onClick={() => {
                  onAddCustomEngine(scaledPreview);
                  setScaledPreview(null);
                }}
                className="btn-primary px-3 py-1.5 text-xs"
              >
                Save to Catalog
              </button>
            )}
          </div>

          {scaledPreview && (
            <div className="grid grid-cols-3 gap-2 rounded border border-sky-800 bg-slate-950 p-2 font-mono text-xs text-slate-200">
              <div>Isp Vac: {scaledPreview.isp_vac_s.value.toFixed(1)} s</div>
              <div>
                Mass: {convertFromSi(scaledPreview.dry_mass_kg.value, "mass", unitSystem).toFixed(0)} {unitLabel("mass", unitSystem)}
              </div>
              <div>
                Nozzle: {convertFromSi(scaledPreview.nozzle_diameter_m.value, "length", unitSystem).toFixed(2)} {unitLabel("length", unitSystem)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Top Filter Summary and Action Bar */}
      <div className="panel-card flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            id="heritage_engines.toggle_sidebar"
            onClick={() => setShowSidebar((v) => !v)}
            title="Toggle Amazon-style faceted filters sidebar"
            className="btn-secondary px-3 py-1.5 text-xs font-semibold"
          >
            {showSidebar ? "Hide Filters" : "Show Filters"}
            {totalActiveFilterCount > 0 && ` (${totalActiveFilterCount})`}
          </button>

          <input
            id="heritage_engines.search"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search engine or manufacturer..."
            className="input-field w-64 text-xs"
          />

          {totalActiveFilterCount > 0 && (
            <button
              type="button"
              id="heritage_engines.clear_all_top"
              onClick={clearAllFilters}
              title="Clear all active engine filters and search query"
              className="text-xs text-rose-400 hover:text-rose-300 underline font-semibold px-2 py-1"
            >
              Clear All Filters
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-slate-300">
            Showing <strong className="text-white">{filtered.length}</strong> of {combinedEngines.length} engines ({customEngines.length} custom)
          </span>
        </div>
      </div>

      {/* Active Filter Chips Pillbox */}
      {totalActiveFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-1">
          <span className="text-xs text-slate-400 font-semibold mr-1">Active Filters:</span>
          {searchQuery.trim() !== "" && (
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-800 border border-slate-700 px-2 py-0.5 text-xs text-slate-200">
              Query: &quot;{searchQuery}&quot;
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                title="Remove search query"
                className="text-slate-400 hover:text-white font-bold"
              >
                ×
              </button>
            </span>
          )}
          {selectedManufacturers.map((m) => (
            <span
              key={`m_${m}`}
              className="inline-flex items-center gap-1 rounded-md bg-sky-950 border border-sky-700/60 px-2 py-0.5 text-xs text-sky-200"
            >
              Mfg: {m}
              <button
                type="button"
                onClick={() => toggleFilter(selectedManufacturers, setSelectedManufacturers, m)}
                title={`Remove ${m} filter`}
                className="text-sky-400 hover:text-white font-bold"
              >
                ×
              </button>
            </span>
          ))}
          {selectedPropellants.map((p) => (
            <span
              key={`p_${p}`}
              className="inline-flex items-center gap-1 rounded-md bg-amber-950 border border-amber-700/60 px-2 py-0.5 text-xs text-amber-200"
            >
              Prop: {formatPropellant(p)}
              <button
                type="button"
                onClick={() => toggleFilter(selectedPropellants, setSelectedPropellants, p)}
                title="Remove propellant filter"
                className="text-amber-400 hover:text-white font-bold"
              >
                ×
              </button>
            </span>
          ))}
          {selectedCycles.map((c) => (
            <span
              key={`c_${c}`}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-950 border border-emerald-700/60 px-2 py-0.5 text-xs text-emerald-200"
            >
              Cycle: {formatEngineCycle(c)}
              <button
                type="button"
                onClick={() => toggleFilter(selectedCycles, setSelectedCycles, c)}
                title="Remove cycle filter"
                className="text-emerald-400 hover:text-white font-bold"
              >
                ×
              </button>
            </span>
          ))}
          {selectedPropulsionTypes.map((pt) => (
            <span
              key={`pt_${pt}`}
              className="inline-flex items-center gap-1 rounded-md bg-purple-950 border border-purple-700/60 px-2 py-0.5 text-xs text-purple-200"
            >
              Type: {pt}
              <button
                type="button"
                onClick={() => toggleFilter(selectedPropulsionTypes, setSelectedPropulsionTypes, pt)}
                title="Remove propulsion type filter"
                className="text-purple-400 hover:text-white font-bold"
              >
                ×
              </button>
            </span>
          ))}
          {(minThrustKn !== "" || maxThrustKn !== "") && (
            <span className="inline-flex items-center gap-1 rounded-md bg-cyan-950 border border-cyan-700/60 px-2 py-0.5 text-xs text-cyan-200">
              Thrust: {minThrustKn || "0"} - {maxThrustKn || "∞"} kN
              <button
                type="button"
                onClick={() => {
                  setMinThrustKn("");
                  setMaxThrustKn("");
                }}
                title="Remove thrust filter"
                className="text-cyan-400 hover:text-white font-bold"
              >
                ×
              </button>
            </span>
          )}
          {(minIspVac !== "" || maxIspVac !== "") && (
            <span className="inline-flex items-center gap-1 rounded-md bg-indigo-950 border border-indigo-700/60 px-2 py-0.5 text-xs text-indigo-200">
              Isp: {minIspVac || "0"} - {maxIspVac || "∞"} s
              <button
                type="button"
                onClick={() => {
                  setMinIspVac("");
                  setMaxIspVac("");
                }}
                title="Remove Isp filter"
                className="text-indigo-400 hover:text-white font-bold"
              >
                ×
              </button>
            </span>
          )}
        </div>
      )}

      {/* Main Container: Sidebar + Catalog Table */}
      <div className="flex flex-col lg:flex-row gap-3 items-start">
        {showSidebar && (
          <aside className="w-full lg:w-56 shrink-0 rounded-lg border border-slate-800 bg-slate-900/80 p-2.5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-sky-300">
                Engine Filters
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  id="heritage_engines.mode_and"
                  onClick={() => setFilterMode("and")}
                  title="Match ALL active filter categories (intersection)"
                  className={`rounded px-2 py-0.5 text-xs font-semibold border ${
                    filterMode === "and"
                      ? "border-sky-500 bg-sky-600 text-white"
                      : "border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  AND
                </button>
                <button
                  type="button"
                  id="heritage_engines.mode_or"
                  onClick={() => setFilterMode("or")}
                  title="Match ANY active filter category (union)"
                  className={`rounded px-2 py-0.5 text-xs font-semibold border ${
                    filterMode === "or"
                      ? "border-sky-500 bg-sky-600 text-white"
                      : "border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  OR
                </button>
              </div>
            </div>

            {/* Vacuum Thrust Brackets & Range */}
            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-slate-200 block">
                Vacuum Thrust Range (kN)
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="number"
                  min={0}
                  value={minThrustKn}
                  onChange={(e) => setMinThrustKn(e.target.value)}
                  placeholder="Min kN"
                  title="Minimum vacuum thrust in kN"
                  className="input-field w-full text-xs"
                />
                <input
                  type="number"
                  min={0}
                  value={maxThrustKn}
                  onChange={(e) => setMaxThrustKn(e.target.value)}
                  placeholder="Max kN"
                  title="Maximum vacuum thrust in kN"
                  className="input-field w-full text-xs"
                />
              </div>
              <div className="flex flex-wrap gap-1 pt-1">
                {[
                  { label: "<100 kN", min: "", max: "100" },
                  { label: "100-1000", min: "100", max: "1000" },
                  { label: ">1000 kN", min: "1000", max: "" },
                ].map((bracket) => (
                  <button
                    key={bracket.label}
                    type="button"
                    onClick={() => {
                      setMinThrustKn(bracket.min);
                      setMaxThrustKn(bracket.max);
                    }}
                    title={`Filter engines to ${bracket.label}`}
                    className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white"
                  >
                    {bracket.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Vacuum Isp Range */}
            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-slate-200 block">
                Vacuum Isp Range (s)
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="number"
                  min={100}
                  max={600}
                  value={minIspVac}
                  onChange={(e) => setMinIspVac(e.target.value)}
                  placeholder="Min s"
                  title="Minimum vacuum specific impulse in seconds"
                  className="input-field w-full text-xs"
                />
                <input
                  type="number"
                  min={100}
                  max={600}
                  value={maxIspVac}
                  onChange={(e) => setMaxIspVac(e.target.value)}
                  placeholder="Max s"
                  title="Maximum vacuum specific impulse in seconds"
                  className="input-field w-full text-xs"
                />
              </div>
            </div>

            {/* Manufacturer Facet */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">
                  Manufacturer ({manufacturerCounts.length})
                </span>
                {selectedManufacturers.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedManufacturers([])}
                    title="Clear selected manufacturers"
                    className="text-xs text-sky-400 hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
              <input
                type="text"
                value={manufSearch}
                onChange={(e) => setManufSearch(e.target.value)}
                placeholder="Filter manufacturers..."
                className="input-field w-full text-xs"
              />
              <div className="max-h-36 overflow-y-auto space-y-1 pr-1 border border-slate-800 rounded p-1.5 bg-slate-950/40">
                {manufacturerCounts
                  .filter(([m]) => !manufSearch || m.toLowerCase().includes(manufSearch.toLowerCase()))
                  .map(([manuf, count]) => {
                    const isChecked = selectedManufacturers.includes(manuf);
                    return (
                      <label
                        key={manuf}
                        className="flex items-center justify-between gap-1.5 text-xs text-slate-300 hover:text-white cursor-pointer select-none py-0.5 px-1 rounded hover:bg-slate-800/50"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() =>
                              toggleFilter(selectedManufacturers, setSelectedManufacturers, manuf)
                            }
                            className="rounded border-slate-700 bg-slate-900 text-sky-600 focus:ring-0"
                          />
                          <span className="truncate">{manuf}</span>
                        </div>
                        <span className="text-xs font-mono text-slate-400">({count})</span>
                      </label>
                    );
                  })}
              </div>
            </div>

            {/* Propellant Family Facet */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">
                  Propellant ({propellantCounts.length})
                </span>
                {selectedPropellants.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedPropellants([])}
                    title="Clear selected propellants"
                    className="text-xs text-sky-400 hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="max-h-36 overflow-y-auto space-y-1 pr-1 border border-slate-800 rounded p-1.5 bg-slate-950/40">
                {propellantCounts.map(([prop, count]) => {
                  const isChecked = selectedPropellants.includes(prop);
                  return (
                    <label
                      key={prop}
                      className="flex items-center justify-between gap-1.5 text-xs text-slate-300 hover:text-white cursor-pointer select-none py-0.5 px-1 rounded hover:bg-slate-800/50"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() =>
                            toggleFilter(selectedPropellants, setSelectedPropellants, prop)
                          }
                          className="rounded border-slate-700 bg-slate-900 text-amber-600 focus:ring-0"
                        />
                        <span className="truncate">{formatPropellant(prop)}</span>
                      </div>
                      <span className="text-xs font-mono text-slate-400">({count})</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Engine Cycle Facet */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">
                  Power Cycle ({cycleCounts.length})
                </span>
                {selectedCycles.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedCycles([])}
                    title="Clear selected engine cycles"
                    className="text-xs text-sky-400 hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="max-h-36 overflow-y-auto space-y-1 pr-1 border border-slate-800 rounded p-1.5 bg-slate-950/40">
                {cycleCounts.map(([cycle, count]) => {
                  const isChecked = selectedCycles.includes(cycle);
                  return (
                    <label
                      key={cycle}
                      className="flex items-center justify-between gap-1.5 text-xs text-slate-300 hover:text-white cursor-pointer select-none py-0.5 px-1 rounded hover:bg-slate-800/50"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() =>
                            toggleFilter(selectedCycles, setSelectedCycles, cycle)
                          }
                          className="rounded border-slate-700 bg-slate-900 text-emerald-600 focus:ring-0"
                        />
                        <span className="truncate">{formatEngineCycle(cycle)}</span>
                      </div>
                      <span className="text-xs font-mono text-slate-400">({count})</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Propulsion Type Facet */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">Propulsion Type</span>
                {selectedPropulsionTypes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedPropulsionTypes([])}
                    title="Clear selected propulsion types"
                    className="text-xs text-sky-400 hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="space-y-1 border border-slate-800 rounded p-1.5 bg-slate-950/40">
                {propulsionTypeCounts.map(([pt, count]) => {
                  const isChecked = selectedPropulsionTypes.includes(pt);
                  return (
                    <label
                      key={pt}
                      className="flex items-center justify-between gap-1.5 text-xs text-slate-300 hover:text-white cursor-pointer select-none py-0.5 px-1 rounded hover:bg-slate-800/50"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() =>
                            toggleFilter(selectedPropulsionTypes, setSelectedPropulsionTypes, pt)
                          }
                          className="rounded border-slate-700 bg-slate-900 text-purple-600 focus:ring-0"
                        />
                        <span className="truncate capitalize">{pt}</span>
                      </div>
                      <span className="text-xs font-mono text-slate-400">({count})</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </aside>
        )}

        {/* Catalog Table Container */}
        <div className="flex-1 min-w-0 w-full space-y-3">
          <VirtualCatalogTable
            tableIdPrefix="heritage_engines.table"
            data={filtered}
            columns={columns}
            columnGroups={ENGINE_COLUMN_GROUPS}
            initialVisibility={INITIAL_ENGINE_VISIBILITY}
          />
        </div>
      </div>
    </div>
  );
}
