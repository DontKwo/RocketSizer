import React, { useMemo, useState } from "react";
import {
  formatBoosterType,
  formatIdentifierLabel,
  formatOperationalStatus,
  formatSuccessRatePct,
} from "../config/formatters";
import { adjustInflationUsd, convertFromSi, unitLabel, type UnitSystem } from "../config/units";
import type { InspectorTarget, ProvenanceValue } from "../types/provenance";
import type { ProvenanceEngine } from "../types/engine";
import type { ProvenanceVehicle } from "../types/vehicle";
import {
  VirtualCatalogTable,
  type CatalogColumnGroup,
  type ColumnDef,
  type VisibilityState,
} from "../components/tables/VirtualCatalogTable";

interface HeritageVehiclesViewProps {
  vehicles: ProvenanceVehicle[];
  engines?: ProvenanceEngine[];
  unitSystem: UnitSystem;
  currencyYear: number;
  onInspect: (target: InspectorTarget) => void;
}

const VEHICLE_COLUMN_GROUPS: CatalogColumnGroup[] = [
  {
    group: "Identity & Status",
    columns: [
      { id: "name", label: "Vehicle" },
      { id: "manufacturer", label: "Manufacturer" },
      { id: "country", label: "Country" },
      { id: "operational_status", label: "Status" },
      { id: "maiden_flight_year", label: "Maiden Year" },
      { id: "booster_type", label: "Booster Type" },
    ],
  },
  {
    group: "Payload Capacity",
    columns: [
      { id: "payload_leo_kg", label: "LEO Payload" },
      { id: "payload_sso_kg", label: "SSO Payload" },
      { id: "payload_gto_kg", label: "GTO Payload" },
      { id: "payload_tli_kg", label: "TLI Payload" },
      { id: "payload_geo_kg", label: "GEO Payload" },
      { id: "payload_tmi_kg", label: "TMI Payload" },
    ],
  },
  {
    group: "Mass & Dimensions",
    columns: [
      { id: "total_height_m", label: "Height" },
      { id: "core_diameter_m", label: "Core Dia" },
      { id: "fairing_diameter_m", label: "Fairing Dia" },
      { id: "usable_fairing_volume_m3", label: "Fairing Vol" },
      { id: "glow_kg", label: "GLOW" },
      { id: "total_dry_mass_kg", label: "Dry Mass" },
      { id: "payload_fraction_leo", label: "LEO Fraction" },
      { id: "liftoff_tw0", label: "Liftoff T/W0" },
    ],
  },
  {
    group: "Stage & Cost",
    columns: [
      { id: "stage_count", label: "Stages" },
      { id: "s1_engine_id", label: "S1 Engine" },
      { id: "s1_engine_count", label: "S1 Qty" },
      { id: "s2_engine_id", label: "S2 Engine" },
      { id: "launch_cost_adj_usd", label: "Launch Cost" },
      { id: "cost_per_kg_leo_usd", label: "Specific Cost LEO" },
      { id: "development_cost_usd", label: "Dev Cost" },
      { id: "total_launches", label: "Launches" },
      { id: "successful_launches", label: "Successes" },
      { id: "launch_success_rate", label: "Success Rate" },
    ],
  },
];

const INITIAL_VISIBILITY: VisibilityState = {};

export function HeritageVehiclesView({
  vehicles,
  engines = [],
  unitSystem,
  currencyYear,
  onInspect,
}: HeritageVehiclesViewProps): React.ReactElement {
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedManufacturers, setSelectedManufacturers] = useState<string[]>([]);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedBoosterTypes, setSelectedBoosterTypes] = useState<string[]>([]);
  const [filterMode, setFilterMode] = useState<"or" | "and">("and");
  const [minPayloadLeo, setMinPayloadLeo] = useState<string>("");
  const [maxPayloadLeo, setMaxPayloadLeo] = useState<string>("");
  const [showSidebar, setShowSidebar] = useState<boolean>(false);
  const [manufSearch, setManufSearch] = useState<string>("");

  const engineLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const eng of engines) {
      map.set(eng.id.value, eng.name.value);
    }
    return map;
  }, [engines]);

  const manufacturerCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of vehicles) {
      const m = v.manufacturer.value || "Unknown";
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [vehicles]);

  const countryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of vehicles) {
      const c = v.country.value || "Unknown";
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [vehicles]);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of vehicles) {
      const s = v.operational_status.value || "Unknown";
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [vehicles]);

  const boosterCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of vehicles) {
      const b = v.booster_type.value || "none";
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [vehicles]);

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
    setSelectedCountries([]);
    setSelectedStatuses([]);
    setSelectedBoosterTypes([]);
    setMinPayloadLeo("");
    setMaxPayloadLeo("");
    setManufSearch("");
  };

  const totalActiveFilterCount =
    selectedManufacturers.length +
    selectedCountries.length +
    selectedStatuses.length +
    selectedBoosterTypes.length +
    (minPayloadLeo !== "" ? 1 : 0) +
    (maxPayloadLeo !== "" ? 1 : 0) +
    (searchQuery.trim() !== "" ? 1 : 0);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const minLeo = minPayloadLeo !== "" ? Number(minPayloadLeo) : null;
    const maxLeo = maxPayloadLeo !== "" ? Number(maxPayloadLeo) : null;

    return vehicles.filter((v) => {
      if (q) {
        const s1Label = formatIdentifierLabel(v.s1_engine_id.value, engineLookup).toLowerCase();
        const matchesQuery =
          v.name.value.toLowerCase().includes(q) ||
          v.variant.value.toLowerCase().includes(q) ||
          v.manufacturer.value.toLowerCase().includes(q) ||
          v.country.value.toLowerCase().includes(q) ||
          v.s1_engine_id.value.toLowerCase().includes(q) ||
          s1Label.includes(q);
        if (!matchesQuery) return false;
      }

      if (minLeo !== null && !Number.isNaN(minLeo)) {
        if (v.payload_leo_kg.value < minLeo) return false;
      }
      if (maxLeo !== null && !Number.isNaN(maxLeo)) {
        if (v.payload_leo_kg.value > maxLeo) return false;
      }

      const hasManuf = selectedManufacturers.length > 0;
      const hasCountry = selectedCountries.length > 0;
      const hasStatus = selectedStatuses.length > 0;
      const hasBooster = selectedBoosterTypes.length > 0;

      if (!hasManuf && !hasCountry && !hasStatus && !hasBooster) {
        return true;
      }

      const matchManuf = hasManuf && selectedManufacturers.includes(v.manufacturer.value);
      const matchCountry = hasCountry && selectedCountries.includes(v.country.value);
      const matchStatus = hasStatus && selectedStatuses.includes(v.operational_status.value);
      const matchBooster = hasBooster && selectedBoosterTypes.includes(v.booster_type.value);

      if (filterMode === "and") {
        if (hasManuf && !matchManuf) return false;
        if (hasCountry && !matchCountry) return false;
        if (hasStatus && !matchStatus) return false;
        if (hasBooster && !matchBooster) return false;
        return true;
      }
      return matchManuf || matchCountry || matchStatus || matchBooster;
    });
  }, [
    vehicles,
    searchQuery,
    selectedManufacturers,
    selectedCountries,
    selectedStatuses,
    selectedBoosterTypes,
    filterMode,
    minPayloadLeo,
    maxPayloadLeo,
    engineLookup,
  ]);

  const makeCellInspect = (
    vehicle: ProvenanceVehicle,
    fieldLabel: string,
    fieldKey: string,
    provenance: ProvenanceValue<unknown>,
    display: string
  ): React.ReactElement => {
    const badge = provenance.status === "primary_source"
      ? "border-emerald-500/60 bg-slate-900"
      : "border-slate-700 bg-slate-900";
    return (
      <button data-testid="heritage_vehicles.inspect_cell" type="button" onClick={() => onInspect({ entityName: `${vehicle.name.value} ${vehicle.variant.value}`.trim(), fieldLabel, fieldKey, provenance })} title={`Inspect data provenance and source citation for ${fieldLabel}`} className={`rounded border px-2 py-1 text-left font-mono text-xs text-slate-100 hover:bg-slate-800 hover:border-sky-400 ${badge}`}>
        {display}
      </button>
    );
  };

  const columns = useMemo<ColumnDef<ProvenanceVehicle, unknown>[]>(() => {
    const mUnit = unitLabel("mass", unitSystem);
    const lUnit = unitLabel("length", unitSystem);
    const cUnit = unitLabel("cost_per_mass", unitSystem);

    return [
      {
        id: "name",
        header: "Vehicle",
        accessorFn: (row) => row.name.value,
        cell: ({ row }) =>
          makeCellInspect(
            row.original,
            "Vehicle Name",
            "name",
            row.original.name,
            `${row.original.name.value} ${row.original.variant.value}`.trim()
          ),
      },
      {
        id: "manufacturer",
        header: "Manufacturer",
        accessorFn: (row) => row.manufacturer.value,
        cell: ({ row }) =>
          makeCellInspect(row.original, "Manufacturer", "manufacturer", row.original.manufacturer, row.original.manufacturer.value),
      },
      {
        id: "country",
        header: "Country",
        accessorFn: (row) => row.country.value,
      },
      {
        id: "operational_status",
        header: "Status",
        accessorFn: (row) => formatOperationalStatus(row.operational_status.value),
      },
      {
        id: "maiden_flight_year",
        header: "Maiden",
        accessorFn: (row) => row.maiden_flight_year.value,
      },
      {
        id: "booster_type",
        header: "Boosters",
        accessorFn: (row) => formatBoosterType(row.booster_type.value),
      },
      {
        id: "payload_leo_kg",
        header: `LEO (${mUnit})`,
        accessorFn: (row) => convertFromSi(row.payload_leo_kg.value, "mass", unitSystem),
        cell: ({ row }) =>
          makeCellInspect(
            row.original,
            "LEO Payload",
            "payload_leo_kg",
            row.original.payload_leo_kg,
            convertFromSi(row.original.payload_leo_kg.value, "mass", unitSystem).toFixed(0)
          ),
      },
      {
        id: "payload_sso_kg",
        header: `SSO (${mUnit})`,
        accessorFn: (row) => convertFromSi(row.payload_sso_kg.value, "mass", unitSystem),
        cell: ({ row }) =>
          makeCellInspect(
            row.original,
            "SSO Payload",
            "payload_sso_kg",
            row.original.payload_sso_kg,
            convertFromSi(row.original.payload_sso_kg.value, "mass", unitSystem).toFixed(0)
          ),
      },
      {
        id: "payload_gto_kg",
        header: `GTO (${mUnit})`,
        accessorFn: (row) => convertFromSi(row.payload_gto_kg.value, "mass", unitSystem),
        cell: ({ row }) =>
          makeCellInspect(
            row.original,
            "GTO Payload",
            "payload_gto_kg",
            row.original.payload_gto_kg,
            convertFromSi(row.original.payload_gto_kg.value, "mass", unitSystem).toFixed(0)
          ),
      },
      {
        id: "payload_tli_kg",
        header: `TLI (${mUnit})`,
        accessorFn: (row) => convertFromSi(row.payload_tli_kg.value, "mass", unitSystem),
        cell: ({ row }) => (row.original.payload_tli_kg.value > 0 ? convertFromSi(row.original.payload_tli_kg.value, "mass", unitSystem).toFixed(0) : "-"),
      },
      {
        id: "payload_geo_kg",
        header: `GEO (${mUnit})`,
        accessorFn: (row) => (row.payload_geo_kg ? convertFromSi(row.payload_geo_kg.value, "mass", unitSystem) : 0),
        cell: ({ row }) =>
          row.original.payload_geo_kg && row.original.payload_geo_kg.value > 0
            ? convertFromSi(row.original.payload_geo_kg.value, "mass", unitSystem).toFixed(0)
            : "-",
      },
      {
        id: "payload_tmi_kg",
        header: `TMI (${mUnit})`,
        accessorFn: (row) => (row.payload_tmi_kg ? convertFromSi(row.payload_tmi_kg.value, "mass", unitSystem) : 0),
        cell: ({ row }) =>
          row.original.payload_tmi_kg && row.original.payload_tmi_kg.value > 0
            ? convertFromSi(row.original.payload_tmi_kg.value, "mass", unitSystem).toFixed(0)
            : "-",
      },
      {
        id: "total_height_m",
        header: `Height (${lUnit})`,
        accessorFn: (row) => convertFromSi(row.total_height_m.value, "length", unitSystem),
        cell: ({ row }) =>
          makeCellInspect(
            row.original,
            "Total Height",
            "total_height_m",
            row.original.total_height_m,
            convertFromSi(row.original.total_height_m.value, "length", unitSystem).toFixed(1)
          ),
      },
      {
        id: "core_diameter_m",
        header: `Core Dia (${lUnit})`,
        accessorFn: (row) => convertFromSi(row.core_diameter_m.value, "length", unitSystem),
        cell: ({ row }) => convertFromSi(row.original.core_diameter_m.value, "length", unitSystem).toFixed(2),
      },
      {
        id: "fairing_diameter_m",
        header: `Fairing (${lUnit})`,
        accessorFn: (row) => convertFromSi(row.fairing_diameter_m.value, "length", unitSystem),
        cell: ({ row }) => convertFromSi(row.original.fairing_diameter_m.value, "length", unitSystem).toFixed(2),
      },
      {
        id: "usable_fairing_vol_m3",
        header: "Fairing Vol (m3)",
        accessorFn: (row) => (row.usable_fairing_vol_m3 ? row.usable_fairing_vol_m3.value : 0),
        cell: ({ row }) => (row.original.usable_fairing_vol_m3 ? `${row.original.usable_fairing_vol_m3.value.toFixed(1)} m3` : "-"),
      },
      {
        id: "glow_kg",
        header: `GLOW (${mUnit})`,
        accessorFn: (row) => convertFromSi(row.glow_kg.value, "mass", unitSystem),
        cell: ({ row }) =>
          makeCellInspect(
            row.original,
            "GLOW",
            "glow_kg",
            row.original.glow_kg,
            convertFromSi(row.original.glow_kg.value, "mass", unitSystem).toFixed(0)
          ),
      },
      {
        id: "total_dry_mass_kg",
        header: `Dry (${mUnit})`,
        accessorFn: (row) => convertFromSi(row.total_dry_mass_kg.value, "mass", unitSystem),
        cell: ({ row }) => convertFromSi(row.original.total_dry_mass_kg.value, "mass", unitSystem).toFixed(0),
      },
      {
        id: "payload_fraction_leo",
        header: "LEO %",
        accessorFn: (row) => row.payload_fraction_leo.value * 100,
        cell: ({ row }) => `${(row.original.payload_fraction_leo.value * 100).toFixed(2)}%`,
      },
      {
        id: "liftoff_tw0",
        header: "T/W0",
        accessorFn: (row) => row.liftoff_tw0.value,
        cell: ({ row }) => row.original.liftoff_tw0.value.toFixed(2),
      },
      {
        id: "stage_count",
        header: "Stages",
        accessorFn: (row) => row.stage_count.value,
      },
      {
        id: "s1_engine_id",
        header: "S1 Engine",
        accessorFn: (row) => formatIdentifierLabel(row.s1_engine_id.value, engineLookup),
      },
      {
        id: "s1_engine_count",
        header: "S1 Qty",
        accessorFn: (row) => row.s1_engine_count.value,
      },
      {
        id: "s2_engine_id",
        header: "S2 Engine",
        accessorFn: (row) => formatIdentifierLabel(row.s2_engine_id.value, engineLookup),
      },
      {
        id: "launch_cost_adj_usd",
        header: `Cost (${currencyYear} $M)`,
        accessorFn: (row) => row.launch_cost_adj_usd.value,
        cell: ({ row }) => {
          const adj = adjustInflationUsd(
            row.original.launch_cost_original_usd.value,
            row.original.launch_cost_year.value,
            currencyYear
          );
          return makeCellInspect(
            row.original,
            `Launch Cost (${currencyYear})`,
            "launch_cost_adj_usd",
            row.original.launch_cost_adj_usd,
            `$${(adj / 1e6).toFixed(1)}M`
          );
        },
      },
      {
        id: "cost_per_kg_leo_usd",
        header: `Spec Cost (${cUnit})`,
        accessorFn: (row) => row.cost_per_kg_leo_usd.value,
        cell: ({ row }) => {
          const adj = adjustInflationUsd(
            row.original.launch_cost_original_usd.value,
            row.original.launch_cost_year.value,
            currencyYear
          );
          const perKg = adj / Math.max(row.original.payload_leo_kg.value, 1);
          return `$${convertFromSi(perKg, "cost_per_mass", unitSystem).toFixed(0)}`;
        },
      },
      {
        id: "development_cost_usd",
        header: `Dev Cost (${currencyYear} $M)`,
        accessorFn: (row) => (row.development_cost_usd ? row.development_cost_usd.value : 0),
        cell: ({ row }) =>
          row.original.development_cost_usd && row.original.development_cost_usd.value > 0
            ? `$${(row.original.development_cost_usd.value / 1e6).toFixed(0)}M`
            : "-",
      },
      {
        id: "total_launches",
        header: "Launches",
        accessorFn: (row) => (row.total_launches ? row.total_launches.value : 0),
        cell: ({ row }) => (row.original.total_launches ? String(row.original.total_launches.value) : "-"),
      },
      {
        id: "successful_launches",
        header: "Successes",
        accessorFn: (row) => (row.successful_launches ? row.successful_launches.value : 0),
        cell: ({ row }) => (row.original.successful_launches ? String(row.original.successful_launches.value) : "-"),
      },
      {
        id: "launch_success_rate",
        header: "Success %",
        accessorFn: (row) =>
          (row.launch_success_rate.value > 1
            ? row.launch_success_rate.value
            : row.launch_success_rate.value * 100),
        cell: ({ row }) => formatSuccessRatePct(row.original.launch_success_rate.value),
      },
    ];
  }, [unitSystem, currencyYear, engineLookup]);

  const visibleManufacturers = useMemo(() => {
    const q = manufSearch.trim().toLowerCase();
    if (!q) return manufacturerCounts;
    return manufacturerCounts.filter(([m]) => m.toLowerCase().includes(q));
  }, [manufacturerCounts, manufSearch]);

  return (
    <div className="space-y-3">
      {/* Top Filter Summary and Action Bar */}
      <div className="panel-card flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            id="heritage_vehicles.toggle_sidebar"
            onClick={() => setShowSidebar((v) => !v)}
            title="Toggle Amazon-style faceted filters sidebar"
            className="btn-secondary px-3 py-1.5 text-xs font-semibold"
          >
            {showSidebar ? "Hide Filters" : "Show Filters"}
            {totalActiveFilterCount > 0 && ` (${totalActiveFilterCount})`}
          </button>

          <input
            id="heritage_vehicles.search"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search vehicle, manufacturer, engine..."
            className="input-field w-64 text-xs"
          />

          {totalActiveFilterCount > 0 && (
            <button
              type="button"
              id="heritage_vehicles.clear_all_top"
              onClick={clearAllFilters}
              title="Clear all active vehicle filters and search query"
              className="text-xs text-rose-400 hover:text-rose-300 underline font-semibold px-2 py-1"
            >
              Clear All Filters
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-slate-300">
            Showing <strong className="text-white">{filtered.length}</strong> of {vehicles.length} vehicles
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
          {selectedCountries.map((c) => (
            <span
              key={`c_${c}`}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-950 border border-emerald-700/60 px-2 py-0.5 text-xs text-emerald-200"
            >
              Country: {c}
              <button
                type="button"
                onClick={() => toggleFilter(selectedCountries, setSelectedCountries, c)}
                title={`Remove ${c} filter`}
                className="text-emerald-400 hover:text-white font-bold"
              >
                ×
              </button>
            </span>
          ))}
          {selectedStatuses.map((s) => (
            <span
              key={`s_${s}`}
              className="inline-flex items-center gap-1 rounded-md bg-amber-950 border border-amber-700/60 px-2 py-0.5 text-xs text-amber-200"
            >
              Status: {formatOperationalStatus(s)}
              <button
                type="button"
                onClick={() => toggleFilter(selectedStatuses, setSelectedStatuses, s)}
                title="Remove status filter"
                className="text-amber-400 hover:text-white font-bold"
              >
                ×
              </button>
            </span>
          ))}
          {selectedBoosterTypes.map((b) => (
            <span
              key={`b_${b}`}
              className="inline-flex items-center gap-1 rounded-md bg-purple-950 border border-purple-700/60 px-2 py-0.5 text-xs text-purple-200"
            >
              Booster: {formatBoosterType(b)}
              <button
                type="button"
                onClick={() => toggleFilter(selectedBoosterTypes, setSelectedBoosterTypes, b)}
                title="Remove booster type filter"
                className="text-purple-400 hover:text-white font-bold"
              >
                ×
              </button>
            </span>
          ))}
          {(minPayloadLeo !== "" || maxPayloadLeo !== "") && (
            <span className="inline-flex items-center gap-1 rounded-md bg-cyan-950 border border-cyan-700/60 px-2 py-0.5 text-xs text-cyan-200">
              Payload: {minPayloadLeo || "0"} - {maxPayloadLeo || "∞"} kg
              <button
                type="button"
                onClick={() => {
                  setMinPayloadLeo("");
                  setMaxPayloadLeo("");
                }}
                title="Remove payload filter"
                className="text-cyan-400 hover:text-white font-bold"
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
                Faceted Filters
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  id="heritage_vehicles.mode_and"
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
                  id="heritage_vehicles.mode_or"
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

            {/* Payload LEO Brackets & Range */}
            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-slate-200 block">
                LEO Payload Capacity (kg)
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="number"
                  min={0}
                  value={minPayloadLeo}
                  onChange={(e) => setMinPayloadLeo(e.target.value)}
                  placeholder="Min kg"
                  title="Minimum payload to low Earth orbit in kg"
                  className="input-field w-full text-xs"
                />
                <input
                  type="number"
                  min={0}
                  value={maxPayloadLeo}
                  onChange={(e) => setMaxPayloadLeo(e.target.value)}
                  placeholder="Max kg"
                  title="Maximum payload to low Earth orbit in kg"
                  className="input-field w-full text-xs"
                />
              </div>
              <div className="flex flex-wrap gap-1 pt-1">
                {[
                  { label: "Small (<2t)", min: "", max: "2000" },
                  { label: "Medium (2-20t)", min: "2000", max: "20000" },
                  { label: "Heavy (>20t)", min: "20000", max: "" },
                ].map((bracket) => (
                  <button
                    key={bracket.label}
                    type="button"
                    onClick={() => {
                      setMinPayloadLeo(bracket.min);
                      setMaxPayloadLeo(bracket.max);
                    }}
                    title={`Filter vehicles to ${bracket.label}`}
                    className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white"
                  >
                    {bracket.label}
                  </button>
                ))}
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
              <div className="max-h-40 overflow-y-auto space-y-1 pr-1 border border-slate-800 rounded p-1.5 bg-slate-950/40">
                {visibleManufacturers.map(([manuf, count]) => {
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

            {/* Country / Agency Facet */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">
                  Country / Agency ({countryCounts.length})
                </span>
                {selectedCountries.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedCountries([])}
                    title="Clear selected countries"
                    className="text-xs text-sky-400 hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="max-h-36 overflow-y-auto space-y-1 pr-1 border border-slate-800 rounded p-1.5 bg-slate-950/40">
                {countryCounts.map(([country, count]) => {
                  const isChecked = selectedCountries.includes(country);
                  return (
                    <label
                      key={country}
                      className="flex items-center justify-between gap-1.5 text-xs text-slate-300 hover:text-white cursor-pointer select-none py-0.5 px-1 rounded hover:bg-slate-800/50"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() =>
                            toggleFilter(selectedCountries, setSelectedCountries, country)
                          }
                          className="rounded border-slate-700 bg-slate-900 text-emerald-600 focus:ring-0"
                        />
                        <span className="truncate">{country}</span>
                      </div>
                      <span className="text-xs font-mono text-slate-400">({count})</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Operational Status Facet */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">Operational Status</span>
                {selectedStatuses.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedStatuses([])}
                    title="Clear status filter"
                    className="text-xs text-sky-400 hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="space-y-1 border border-slate-800 rounded p-1.5 bg-slate-950/40">
                {statusCounts.map(([status, count]) => {
                  const isChecked = selectedStatuses.includes(status);
                  return (
                    <label
                      key={status}
                      className="flex items-center justify-between gap-1.5 text-xs text-slate-300 hover:text-white cursor-pointer select-none py-0.5 px-1 rounded hover:bg-slate-800/50"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() =>
                            toggleFilter(selectedStatuses, setSelectedStatuses, status)
                          }
                          className="rounded border-slate-700 bg-slate-900 text-amber-600 focus:ring-0"
                        />
                        <span className="truncate">{formatOperationalStatus(status)}</span>
                      </div>
                      <span className="text-xs font-mono text-slate-400">({count})</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Booster Type Facet */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">Booster Type</span>
                {selectedBoosterTypes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedBoosterTypes([])}
                    title="Clear booster type filter"
                    className="text-xs text-sky-400 hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="space-y-1 border border-slate-800 rounded p-1.5 bg-slate-950/40">
                {boosterCounts.map(([bType, count]) => {
                  const isChecked = selectedBoosterTypes.includes(bType);
                  return (
                    <label
                      key={bType}
                      className="flex items-center justify-between gap-1.5 text-xs text-slate-300 hover:text-white cursor-pointer select-none py-0.5 px-1 rounded hover:bg-slate-800/50"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() =>
                            toggleFilter(selectedBoosterTypes, setSelectedBoosterTypes, bType)
                          }
                          className="rounded border-slate-700 bg-slate-900 text-purple-600 focus:ring-0"
                        />
                        <span className="truncate">{formatBoosterType(bType)}</span>
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
            tableIdPrefix="heritage_vehicles.table"
            data={filtered}
            columns={columns}
            columnGroups={VEHICLE_COLUMN_GROUPS}
            initialVisibility={INITIAL_VISIBILITY}
          />
        </div>
      </div>
    </div>
  );
}
