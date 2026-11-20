import React, { useMemo, useRef, useState } from "react";
import { convertFromSi, convertToSi, unitLabel, type UnitSystem } from "../../config/units";
import type {
  BaseLayoutResult,
  EnginePlacementInput,
  PackingConstraints,
  PlacedEngineCircle,
} from "../../types/sizing";

interface BaseLayoutViewProps {
  stageDiameterM: number;
  layout: BaseLayoutResult | null;
  placementsInput: EnginePlacementInput[];
  constraints: PackingConstraints;
  unitSystem: UnitSystem;
  onUpdatePlacements: (next: EnginePlacementInput[]) => void;
  onUpdateConstraints?: (patch: Partial<PackingConstraints>) => void;
  gimbalLeverArmRatio?: number;
  onUpdateLeverArmRatio?: (ratio: number) => void;
  onResetLayout: () => void;
}

export function BaseLayoutView({
  stageDiameterM,
  layout,
  placementsInput,
  constraints,
  unitSystem,
  onUpdatePlacements,
  onUpdateConstraints,
  gimbalLeverArmRatio,
  onUpdateLeverArmRatio,
  onResetLayout,
}: BaseLayoutViewProps): React.ReactElement {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [showTvcCones, setShowTvcCones] = useState<boolean>(true);
  const [showNoTouchRing, setShowNoTouchRing] = useState<boolean>(true);
  const [showTutorial, setShowTutorial] = useState<boolean>(false);

  const viewSize = 300;
  const centerPx = viewSize / 2;
  const effectiveBaseM = layout?.allowable_diameter_m ?? stageDiameterM;
  const maxSpanM = Math.max(
    effectiveBaseM * 1.15,
    layout ? layout.required_diameter_m * 1.12 : stageDiameterM * 1.25,
    2.5
  );
  const pxPerM = (viewSize * 0.78) / maxSpanM;

  const handleToggleEngineEnabled = (index: number): void => {
    const updated = placementsInput.map((item, idx) =>
      idx === index ? { ...item, enabled: !item.enabled } : item
    );
    onUpdatePlacements(updated);
  };

  const clashCount = useMemo(() => {
    if (!layout) return 0;
    return layout.placements.filter(
      (p) => p.enabled && (p.clashes_with_skirt || p.clashes_with_indices.length > 0)
    ).length;
  }, [layout]);

  const packingEfficiencyPct = useMemo(() => {
    if (!layout || layout.usable_diameter_m <= 0) return 0;
    const rUsable = layout.usable_diameter_m * 0.5;
    const aUsable = Math.PI * rUsable * rUsable;
    const aEngines = layout.placements
      .filter((p) => p.enabled)
      .reduce((sum, p) => sum + Math.PI * p.footprint_radius_m * p.footprint_radius_m, 0);
    return Math.min(100, (aEngines / aUsable) * 100);
  }, [layout]);

  const lenUnit = unitLabel("length", unitSystem);
  const stageDiaStr = `${convertFromSi(stageDiameterM, "length", unitSystem).toFixed(2)} ${lenUnit}`;
  const baseDiaStr = layout?.allowable_diameter_m && layout.allowable_diameter_m > stageDiameterM + 0.05
    ? `${convertFromSi(layout.allowable_diameter_m, "length", unitSystem).toFixed(2)} ${lenUnit} (Flare)`
    : stageDiaStr;
  const reqDiaStr = layout
    ? `${convertFromSi(layout.required_diameter_m, "length", unitSystem).toFixed(2)} ${lenUnit}`
    : "--";
  const marginStr = layout
    ? `${convertFromSi(layout.clearance_margin_m, "length", unitSystem).toFixed(2)} ${lenUnit}`
    : "--";

  return (
    <div className="panel-card flex flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-slate-800 px-3 py-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-200">
              2D Engine Base Layout
            </h3>
            <span
              className="badge badge-sky text-xs"
              title="Mathematically solves the optimal circle packing in an enclosing circle with non-overlap and TVC constraints"
            >
              Optimal Solver: &eta; {packingEfficiencyPct.toFixed(1)}%
            </span>
          </div>
          <p className="text-xs text-slate-400">
            {layout ? layout.pattern_name : "Optimal Circle Packing Solver"} | Double-click nozzle to toggle
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            id="base_layout.tutorial_btn"
            type="button"
            title="Explain the mathematics of circle packing in a circle, TVC gimbal envelope calculations, and skirt clearance constraints."
            onClick={() => setShowTutorial((v) => !v)}
            className="inline-flex items-center gap-1 rounded border border-sky-500/50 bg-sky-950/60 px-2 py-1 text-xs font-semibold text-sky-200 hover:bg-sky-900/60"
          >
            {showTutorial ? "Hide Guide" : "? What is this?"}
          </button>
          <button
            id="base_layout.tvc_toggle"
            type="button"
            title="Toggle Thrust Vector Control (TVC) dynamic gimbal sweep exclusion envelopes."
            onClick={() => setShowTvcCones((v) => !v)}
            className={`btn-secondary px-2 py-1 text-xs ${showTvcCones ? "border-sky-500 text-sky-300" : ""}`}
          >
            TVC
          </button>
          <button
            id="base_layout.notouch_toggle"
            type="button"
            title="Toggle static structural no-touch keep-out margin around nozzle lips."
            onClick={() => setShowNoTouchRing((v) => !v)}
            className={`btn-secondary px-2 py-1 text-xs ${showNoTouchRing ? "border-amber-500 text-amber-300" : ""}`}
          >
            Margin
          </button>
          <button
            id="base_layout.reset_btn"
            type="button"
            title="Re-run the numerical optimal circle packing solver to find minimal required base diameter."
            onClick={onResetLayout}
            className="btn-primary px-2.5 py-1 text-xs"
          >
            Re-Solve
          </button>
        </div>
      </div>

      {showTutorial && (
        <div className="border-b border-sky-800 bg-sky-950/40 p-3 text-xs text-slate-300 space-y-1.5">
          <div className="font-semibold text-sky-200">How Optimal Circle Packing Solves Engine Layouts:</div>
          <p>
            The engine base layout solver formulates the rocket aft compartment as an <em>optimal circle packing in a circle</em> problem. Rather than manual trial-and-error, it determines the minimum enclosing stage diameter that safely accommodates all engine nozzles under full gimbal deflection.
          </p>
          <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-300">
            <li>
              <strong>TVC Dynamic Gimbal Arcs:</strong> Each engine can gimbal up to &theta;<sub>TVC</sub> degrees (typically 4&deg; to 8&deg;) about its pivot gimbal point located distance <code>L_lever</code> above the nozzle exit plane. The effective clearance radius is: <code>R_sweep = R_nozzle + L_lever &times; sin(&theta;_TVC)</code>.
            </li>
            <li>
              <strong>Static Keep-Out Margin:</strong> An additional structural safety buffer (typically 2 to 5 cm) is enforced around each nozzle lip to prevent mechanical contact from structural flexure, acoustic vibration, and thermal expansion during firing.
            </li>
            <li>
              <strong>Usable Skirt Diameter:</strong> The inner usable diameter is computed by subtracting the outer thrust skirt structural wall thickness and radial thermal clearance from the outer vehicle diameter: <code>D_usable = D_stage - 2 &times; (t_wall + clearance)</code>.
            </li>
            <li>
              <strong>Boattail Flare Allowance:</strong> Multimotor aft compartments frequently employ an aerodynamic boattail flare (e.g. Saturn V 10.06 m &rarr; 13.0 m shroud, Delta IV, SLS, Starship) to mount outboard gimbaled engines without swelling the main propellant tank diameter.
            </li>
            <li>
              <strong>Packing Efficiency (&eta;):</strong> Defined as the ratio of total engine nozzle exit areas to the usable base area: <code>&eta; = &Sigma;(A_nozzle) / A_usable</code>. Higher values minimize base aerodynamic drag and aft skirt mass.
            </li>
          </ul>
        </div>
      )}

      <div className="bg-slate-950 p-2">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${viewSize} ${viewSize}`}
          className="mx-auto h-64 w-64 select-none"
        >
          {/* Flared Base Limit (if flare is present) */}
          {layout?.allowable_diameter_m && layout.allowable_diameter_m > stageDiameterM + 0.05 && (
            <circle
              cx={centerPx}
              cy={centerPx}
              r={(layout.allowable_diameter_m * 0.5) * pxPerM}
              fill="none"
              stroke="#38bdf8"
              strokeDasharray="4 3"
              strokeWidth="1.2"
              strokeOpacity="0.8"
            />
          )}

          {/* Core Tank Outer Diameter */}
          <circle
            cx={centerPx}
            cy={centerPx}
            r={(stageDiameterM * 0.5) * pxPerM}
            fill="#0f172a"
            stroke={layout && !layout.fits ? "#ef4444" : "#94a3b8"}
            strokeWidth="2"
          />
          {layout && (
            <circle
              cx={centerPx}
              cy={centerPx}
              r={(layout.usable_diameter_m * 0.5) * pxPerM}
              fill="none"
              stroke="#475569"
              strokeDasharray="4 3"
              strokeWidth="1"
            />
          )}

          <line x1={centerPx} y1="12" x2={centerPx} y2={viewSize - 12} stroke="#1e293b" strokeWidth="0.8" />
          <line x1="12" y1={centerPx} x2={viewSize - 12} y2={centerPx} stroke="#1e293b" strokeWidth="0.8" />

          {layout &&
            layout.placements.map((eng: PlacedEngineCircle) => {
              const ex = centerPx + eng.x_m * pxPerM;
              const ey = centerPx - eng.y_m * pxPerM;
              const hasClash = eng.clashes_with_skirt || eng.clashes_with_indices.length > 0;
              const nozzleR = Math.max(3, eng.nozzle_radius_m * pxPerM);
              const gimbalR = Math.max(nozzleR, eng.gimbal_sweep_radius_m * pxPerM);
              const footprintR = Math.max(gimbalR, eng.footprint_radius_m * pxPerM);

              return (
                <g
                  key={eng.index}
                  onDoubleClick={() => handleToggleEngineEnabled(eng.index)}
                  className="cursor-pointer"
                >
                  {showNoTouchRing && eng.enabled && (
                    <circle
                      cx={ex}
                      cy={ey}
                      r={footprintR}
                      fill="none"
                      stroke={hasClash ? "#ef4444" : "#f59e0b"}
                      strokeOpacity="0.45"
                      strokeDasharray="2 2"
                      strokeWidth="1"
                    />
                  )}
                  {showTvcCones && eng.enabled && (
                    <circle
                      cx={ex}
                      cy={ey}
                      r={gimbalR}
                      fill={hasClash ? "#ef4444" : "#38bdf8"}
                      fillOpacity="0.12"
                      stroke={hasClash ? "#ef4444" : "#38bdf8"}
                      strokeOpacity="0.65"
                      strokeWidth="1"
                    />
                  )}
                  <circle
                    cx={ex}
                    cy={ey}
                    r={nozzleR}
                    fill={!eng.enabled ? "#1e293b" : hasClash ? "#991b1b" : "#334155"}
                    fillOpacity={!eng.enabled ? 0.45 : 0.9}
                    stroke={!eng.enabled ? "#475569" : hasClash ? "#f87171" : "#e2e8f0"}
                    strokeWidth="1.2"
                  />
                  <text x={ex} y={ey + 3.5} textAnchor="middle" fill="#f8fafc" fontSize="12" fontFamily="monospace">
                    {eng.index + 1}
                  </text>
                </g>
              );
            })}
        </svg>
      </div>

      <div className="grid grid-cols-2 gap-1.5 border-t border-slate-800 px-3 py-2 text-xs">
        <div className="flex justify-between text-slate-400">
          <span>Core Tank OD:</span>
          <span className="font-mono text-slate-200">{stageDiaStr}</span>
        </div>
        <div className="flex justify-between text-slate-400">
          <span>Base Limit OD:</span>
          <span className="font-mono text-cyan-300">{baseDiaStr}</span>
        </div>
        <div className="flex justify-between text-slate-400">
          <span>Required OD:</span>
          <span className="font-mono text-slate-200">{reqDiaStr}</span>
        </div>
        <div className="flex justify-between text-slate-400">
          <span>Skirt Margin:</span>
          <span className={`font-mono ${layout?.fits ? "text-emerald-400" : "text-rose-400"}`}>
            {marginStr}
          </span>
        </div>
        <div className="col-span-2 flex justify-between border-t border-slate-800/80 pt-1 text-slate-400">
          <span>Circle Packing Status:</span>
          <span className={`font-semibold ${layout?.fits && clashCount === 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {layout?.fits && clashCount === 0 ? "FITS (Optimal Placement Verified)" : `${clashCount} CLASH (Exceeds Envelope)`}
          </span>
        </div>
      </div>

      {onUpdateConstraints && (
        <div className="grid grid-cols-2 gap-2 border-t border-slate-800 bg-slate-950/60 px-3 py-2 text-xs">
          <label className="text-slate-300" title="Thrust Vector Control maximum gimbal angle sweep per engine.">
            TVC Angle (deg)
            <input
              id="base_layout.tvc_angle"
              type="number"
              min={0}
              max={15}
              step={0.5}
              onWheel={(e) => e.currentTarget.blur()}
              value={Number(constraints.default_tvc_angle_deg.toFixed(1))}
              onChange={(e) =>
                onUpdateConstraints({ default_tvc_angle_deg: Math.min(15, Math.max(0, Number(e.target.value) || 0)) })
              }
              className="input-field mt-1 block w-full font-mono"
            />
          </label>
          <label className="text-slate-300" title="Exclusion clearance margin maintained between adjacent swept nozzles.">
            No-Touch ({unitLabel("small_length", unitSystem)})
            <input
              id="base_layout.no_touch_margin"
              type="number"
              min={0}
              step={0.5}
              onWheel={(e) => e.currentTarget.blur()}
              value={Number(convertFromSi(constraints.no_touch_margin_m, "small_length", unitSystem).toFixed(2))}
              onChange={(e) =>
                onUpdateConstraints({
                  no_touch_margin_m: Math.max(0, convertToSi(Number(e.target.value) || 0, "small_length", unitSystem)),
                })
              }
              className="input-field mt-1 block w-full font-mono"
            />
          </label>
          <label className="text-slate-300" title="Radial gap between outermost swept nozzle ring and inner thrust skirt wall.">
            Skirt Clr ({unitLabel("small_length", unitSystem)})
            <input
              id="base_layout.skirt_clearance"
              type="number"
              min={0}
              step={0.5}
              onWheel={(e) => e.currentTarget.blur()}
              value={Number(convertFromSi(constraints.skirt_clearance_m, "small_length", unitSystem).toFixed(2))}
              onChange={(e) =>
                onUpdateConstraints({
                  skirt_clearance_m: Math.max(0, convertToSi(Number(e.target.value) || 0, "small_length", unitSystem)),
                })
              }
              className="input-field mt-1 block w-full font-mono"
            />
          </label>
          <label className="text-slate-300" title="Structural thickness subtracted on each side of the outer stage skirt.">
            Skirt Wall ({unitLabel("small_length", unitSystem)})
            <input
              id="base_layout.skirt_wall"
              type="number"
              min={0}
              step={0.2}
              onWheel={(e) => e.currentTarget.blur()}
              value={Number(convertFromSi(constraints.skirt_wall_thickness_m, "small_length", unitSystem).toFixed(2))}
              onChange={(e) =>
                onUpdateConstraints({
                  skirt_wall_thickness_m: Math.max(
                    0,
                    convertToSi(Number(e.target.value) || 0, "small_length", unitSystem)
                  ),
                })
              }
              className="input-field mt-1 block w-full font-mono"
            />
          </label>
          {typeof gimbalLeverArmRatio === "number" && onUpdateLeverArmRatio && (
            <label
              className="col-span-2 text-slate-300"
              title="Fraction of engine height from gimbal pivot down to nozzle exit plane."
            >
              Gimbal Lever Arm Ratio (pivot-to-exit / height)
              <input
                id="base_layout.lever_arm_ratio"
                type="number"
                min={0.1}
                max={0.95}
                step={0.05}
                onWheel={(e) => e.currentTarget.blur()}
                value={Number(gimbalLeverArmRatio.toFixed(2))}
                onChange={(e) => onUpdateLeverArmRatio(Math.min(0.95, Math.max(0.1, Number(e.target.value) || 0.45)))}
                className="input-field mt-1 block w-full font-mono"
              />
            </label>
          )}
        </div>
      )}
    </div>
  );
}
