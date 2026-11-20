import React, { useMemo, useState } from "react";
import { formatEngineCycle, formatPropellant } from "../../config/formatters";
import type { ProvenanceEngine } from "../../types/engine";
import type { ConstraintEnvelope, VehicleConfiguration } from "../../types/sizing";

interface AdvancedStageConstraintsPanelProps {
  config: VehicleConfiguration;
  engines: ProvenanceEngine[];
  onChangeConfig: (next: VehicleConfiguration) => void;
}

type StageTargetKey = "s1" | "s2" | "s3" | "booster";

const LIQUID_PROPELLANTS: string[] = ["lox_rp1", "lox_ch4", "lox_lh2", "hypergolic_nto_udmh"];
const LIQUID_CYCLES: string[] = [
  "gas_generator",
  "staged_combustion",
  "full_flow_staged_combustion",
  "expander",
  "electric_pump",
  "pressure_fed",
];

function toggleItem(list: string[] | undefined, value: string): string[] {
  const cur = list ?? [];
  return cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
}

export const AdvancedStageConstraintsPanel: React.FC<AdvancedStageConstraintsPanelProps> = ({
  config,
  engines,
  onChangeConfig,
}) => {
  const [activeStage, setActiveStage] = useState<StageTargetKey>("s1");
  const [engineQuery, setEngineQuery] = useState<string>("");

  const c = config.constraints;

  const updateCons = (patch: Partial<ConstraintEnvelope>): void => {
    onChangeConfig({
      ...config,
      constraints: { ...c, ...patch },
    });
  };

  const activeEnginesList = useMemo(() => {
    if (activeStage === "s1") return c.stage1_allowed_engines ?? [];
    if (activeStage === "s2") return c.stage2_allowed_engines ?? [];
    if (activeStage === "s3") return c.stage3_allowed_engines ?? [];
    return c.booster_allowed_engines ?? [];
  }, [activeStage, c]);

  const activePropsList = useMemo(() => {
    if (activeStage === "s1") return c.stage1_allowed_propellants ?? [];
    if (activeStage === "s2") return c.stage2_allowed_propellants ?? [];
    if (activeStage === "s3") return c.stage3_allowed_propellants ?? [];
    return [];
  }, [activeStage, c]);

  const activeCyclesList = useMemo(() => {
    if (activeStage === "s1") return c.stage1_allowed_cycles ?? [];
    if (activeStage === "s2") return c.stage2_allowed_cycles ?? [];
    if (activeStage === "s3") return c.stage3_allowed_cycles ?? [];
    return [];
  }, [activeStage, c]);

  const setActiveEngines = (next: string[]): void => {
    if (activeStage === "s1") updateCons({ stage1_allowed_engines: next });
    else if (activeStage === "s2") updateCons({ stage2_allowed_engines: next });
    else if (activeStage === "s3") updateCons({ stage3_allowed_engines: next });
    else updateCons({ booster_allowed_engines: next });
  };

  const setActiveProps = (next: string[]): void => {
    if (activeStage === "s1") updateCons({ stage1_allowed_propellants: next });
    else if (activeStage === "s2") updateCons({ stage2_allowed_propellants: next });
    else if (activeStage === "s3") updateCons({ stage3_allowed_propellants: next });
  };

  const setActiveCycles = (next: string[]): void => {
    if (activeStage === "s1") updateCons({ stage1_allowed_cycles: next });
    else if (activeStage === "s2") updateCons({ stage2_allowed_cycles: next });
    else if (activeStage === "s3") updateCons({ stage3_allowed_cycles: next });
  };

  const filteredEngines = useMemo(() => {
    const q = engineQuery.trim().toLowerCase();
    const pool = engines.filter((e) =>
      activeStage === "booster"
        ? e.propulsion_type.value === "solid"
        : e.propulsion_type.value === "liquid"
    );
    const matching = pool.filter((e) => {
      if (!q) return true;
      return (
        e.name.value.toLowerCase().includes(q) ||
        e.id.value.toLowerCase().includes(q) ||
        formatPropellant(e.propellant.value).toLowerCase().includes(q) ||
        formatEngineCycle(e.cycle.value).toLowerCase().includes(q)
      );
    });
    return matching.sort((a, b) => a.name.value.localeCompare(b.name.value));
  }, [engines, activeStage, engineQuery]);

  const summarizeStage = (engs?: string[], props?: string[], cycs?: string[]): string => {
    const parts: string[] = [];
    if (engs && engs.length > 0) parts.push(`${engs.length} eng`);
    if (props && props.length > 0) parts.push(props.map((p) => formatPropellant(p)).join("/"));
    if (cycs && cycs.length > 0) parts.push(`${cycs.length} cyc`);
    return parts.length > 0 ? parts.join(" | ") : "Any";
  };

  const engNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of engines) m.set(e.id.value, e.name.value);
    return m;
  }, [engines]);

  return (
    <div className="surface-card p-3 space-y-3 border border-slate-700/80">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-300">
            Per-Stage Engine, Fuel & Cycle Whitelists
          </h4>
          <p className="text-xs text-slate-400">
            Require any stage to use only chosen propellants, engine power cycles, or specific engines (leave empty to allow all).
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            updateCons({
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
            })
          }
          title="Clear all per-stage engine, propellant, and cycle restrictions"
          className="btn-secondary text-xs px-2.5 py-1"
        >
          Clear All Stage Filters
        </button>
      </div>

      {/* Stage Target Tabs */}
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            { key: "s1" as const, title: "Stage 1 Core", summary: summarizeStage(c.stage1_allowed_engines, c.stage1_allowed_propellants, c.stage1_allowed_cycles) },
            { key: "s2" as const, title: "Stage 2", summary: summarizeStage(c.stage2_allowed_engines, c.stage2_allowed_propellants, c.stage2_allowed_cycles) },
            { key: "s3" as const, title: "Stage 3", summary: summarizeStage(c.stage3_allowed_engines, c.stage3_allowed_propellants, c.stage3_allowed_cycles) },
            { key: "booster" as const, title: "Solid Boosters", summary: summarizeStage(c.booster_allowed_engines) },
          ]
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveStage(tab.key)}
            title={`Configure engine, fuel, and cycle filters for ${tab.title}`}
            className={`p-2 rounded border text-left transition ${
              activeStage === tab.key
                ? "bg-cyan-950/60 border-cyan-400 text-slate-100"
                : "bg-slate-900/70 border-slate-800 text-slate-300 hover:bg-slate-800/70"
            }`}
          >
            <div className="text-xs font-bold">{tab.title}</div>
            <div className="text-[11px] text-cyan-300 truncate">{tab.summary}</div>
          </button>
        ))}
      </div>

      {/* Allowed Propellants & Cycles (liquid stages) */}
      {activeStage !== "booster" && (
        <div className="grid grid-cols-1 gap-2.5">
          <div className="p-2.5 rounded bg-slate-950/60 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">Allowed Propellants</span>
              {activePropsList.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveProps([])}
                  title="Allow all liquid propellants for this stage"
                  className="text-[11px] text-cyan-300 hover:underline"
                >
                  Allow All
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {LIQUID_PROPELLANTS.map((prop) => {
                const selected = activePropsList.includes(prop);
                return (
                  <button
                    key={prop}
                    type="button"
                    onClick={() => setActiveProps(toggleItem(activePropsList, prop))}
                    title={`Toggle ${formatPropellant(prop)} allowance for this stage`}
                    className={`px-2 py-1 rounded text-xs font-medium border ${
                      selected
                        ? "bg-cyan-700/80 border-cyan-400 text-white"
                        : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    {formatPropellant(prop)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-2.5 rounded bg-slate-950/60 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">Allowed Power Cycles</span>
              {activeCyclesList.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveCycles([])}
                  title="Allow all engine power cycles for this stage"
                  className="text-[11px] text-cyan-300 hover:underline"
                >
                  Allow All
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {LIQUID_CYCLES.map((cyc) => {
                const selected = activeCyclesList.includes(cyc);
                return (
                  <button
                    key={cyc}
                    type="button"
                    onClick={() => setActiveCycles(toggleItem(activeCyclesList, cyc))}
                    title={`Toggle ${formatEngineCycle(cyc)} allowance for this stage`}
                    className={`px-2 py-1 rounded text-xs font-medium border ${
                      selected
                        ? "bg-emerald-700/80 border-emerald-400 text-white"
                        : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    {formatEngineCycle(cyc)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Specific Engines Whitelist */}
      <div className="p-2.5 rounded bg-slate-950/60 border border-slate-800 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-200">
            Specific Engine Whitelist ({activeEnginesList.length === 0 ? "Any Engine Allowed" : `${activeEnginesList.length} Selected`})
          </span>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={engineQuery}
              onChange={(e) => setEngineQuery(e.target.value)}
              placeholder="Search engines (e.g. RS-68A, Raptor, RL10)..."
              title="Filter heritage engines by name, propellant, or power cycle"
              className="input-field w-56"
            />
            {activeEnginesList.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveEngines([])}
                title="Clear specific engine whitelist and allow any matching engine"
                className="btn-secondary text-xs px-2 py-1"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {activeEnginesList.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pb-1">
            {activeEnginesList.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveEngines(toggleItem(activeEnginesList, id))}
                title="Click to remove this engine from the stage whitelist"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-900/70 border border-cyan-500 text-xs text-cyan-100 hover:bg-rose-900/60 hover:border-rose-400"
              >
                <span>{engNameMap.get(id) ?? id}</span>
                <span className="font-bold">x</span>
              </button>
            ))}
          </div>
        )}

        <div className="max-h-40 overflow-y-auto grid grid-cols-2 gap-1.5 pr-1">
          {filteredEngines.map((eng) => {
            const selected = activeEnginesList.includes(eng.id.value);
            return (
              <button
                key={eng.id.value}
                type="button"
                onClick={() => setActiveEngines(toggleItem(activeEnginesList, eng.id.value))}
                title={`${eng.name.value}: ${formatPropellant(eng.propellant.value)} | ${formatEngineCycle(eng.cycle.value)} | Isp ${eng.isp_vac_s.value.toFixed(0)}s`}
                className={`px-2 py-1 rounded text-left text-xs border transition ${
                  selected
                    ? "bg-cyan-700/70 border-cyan-400 text-white font-semibold"
                    : "bg-slate-900/80 border-slate-800 text-slate-300 hover:bg-slate-800"
                }`}
              >
                <div className="truncate">{eng.name.value}</div>
                <div className="text-xs text-slate-400 truncate">
                  {formatPropellant(eng.propellant.value)} | {eng.isp_vac_s.value.toFixed(0)}s
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
