import React from "react";
import { convertFromSi, unitLabel, type UnitSystem } from "../../config/units";
import type { ProvenanceEngine } from "../../types/engine";
import type {
  DeltaVBudgetBreakdown,
  SensitivityPoint,
  VehicleSizingResult,
} from "../../types/sizing";

interface MassTreemapChartProps {
  result: VehicleSizingResult | null;
  unitSystem: UnitSystem;
}

export function MassTreemapChart({ result, unitSystem }: MassTreemapChartProps): React.ReactElement {
  if (!result || result.glow_kg <= 0) {
    return <div className="panel-card p-3 text-sm text-slate-300">No mass breakdown available.</div>;
  }

  const propPct = (result.total_propellant_kg / result.glow_kg) * 100;
  const dryPct = (result.total_dry_mass_kg / result.glow_kg) * 100;
  const payPct = (result.payload_mass_kg / result.glow_kg) * 100;
  const mUnit = unitLabel("mass", unitSystem);

  const fmtMass = (kg: number): string =>
    Math.round(convertFromSi(kg, "mass", unitSystem)).toLocaleString("en-US");

  const segments = [
    {
      key: "prop",
      label: "Propellant",
      pct: propPct,
      massKg: result.total_propellant_kg,
      barClass: "bg-sky-500",
      textClass: "text-sky-300",
    },
    {
      key: "dry",
      label: "Dry Mass",
      pct: dryPct,
      massKg: result.total_dry_mass_kg,
      barClass: "bg-amber-400",
      textClass: "text-amber-300",
    },
    {
      key: "payload",
      label: "Payload",
      pct: payPct,
      massKg: result.payload_mass_kg,
      barClass: "bg-emerald-400",
      textClass: "text-emerald-300",
    },
  ];

  return (
    <div className="panel-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-100">
          Mass Budget Share
        </span>
        <span className="whitespace-nowrap font-mono text-xs font-semibold text-slate-200">
          GLOW {fmtMass(result.glow_kg)} {mUnit}
        </span>
      </div>
      <div className="flex h-6 w-full overflow-hidden rounded-md border border-slate-700 bg-slate-950">
        {segments.map((seg) => (
          <div
            key={seg.key}
            style={{ width: `${Math.max(seg.pct, 2)}%` }}
            title={`${seg.label}: ${seg.pct.toFixed(1)}% (${fmtMass(seg.massKg)} ${mUnit})`}
            className={`${seg.barClass} h-full border-r border-slate-950/70 last:border-r-0`}
          />
        ))}
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-2 text-xs">
        {segments.map((seg) => (
          <div key={seg.key} className="rounded border border-slate-800 bg-slate-950/70 px-2 py-1.5">
            <div className={`flex items-center gap-1.5 font-semibold ${seg.textClass}`}>
              <span className={`inline-block h-2.5 w-2.5 rounded-sm ${seg.barClass}`} />
              <span>{seg.label}</span>
            </div>
            <div className="mt-0.5 font-mono text-sm font-bold text-slate-100">
              {seg.pct.toFixed(1)}%
            </div>
            <div className="whitespace-nowrap font-mono text-xs text-slate-300">
              {fmtMass(seg.massKg)} {mUnit}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface DeltaVWaterfallChartProps {
  breakdown: DeltaVBudgetBreakdown | null;
  unitSystem: UnitSystem;
}

export function DeltaVWaterfallChart({
  breakdown,
  unitSystem,
}: DeltaVWaterfallChartProps): React.ReactElement {
  if (!breakdown) {
    return <div className="panel-card p-3 text-sm text-slate-300">No delta-V budget available.</div>;
  }

  const items = [
    { label: "Orbit", val: breakdown.orbit_velocity_m_s, barClass: "bg-sky-400" },
    { label: "Gravity", val: breakdown.gravity_loss_m_s, barClass: "bg-amber-400" },
    { label: "Aero", val: breakdown.aero_drag_loss_m_s, barClass: "bg-orange-400" },
    {
      label: "Steer / Ull",
      val: breakdown.steering_loss_m_s + breakdown.staging_ullage_loss_m_s,
      barClass: "bg-rose-400",
    },
    { label: "Rot Assist", val: -breakdown.earth_rotation_assist_m_s, barClass: "bg-emerald-400" },
    { label: "Delivered", val: breakdown.total_delivered_dv_m_s, barClass: "bg-emerald-500" },
  ];

  const maxV = Math.max(...items.map((i) => Math.abs(i.val)), breakdown.total_required_dv_m_s, 10000);
  const velUnit = unitLabel("velocity", unitSystem);
  const marginSi = breakdown.total_delivered_dv_m_s - breakdown.total_required_dv_m_s;

  return (
    <div className="panel-card p-3">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-100">
          Delta-V Budget Breakdown
        </span>
        <span className="whitespace-nowrap font-mono text-xs font-semibold text-slate-200">
          Req {Math.round(convertFromSi(breakdown.total_required_dv_m_s, "velocity", unitSystem)).toLocaleString("en-US")} {velUnit}
        </span>
      </div>
      <div className="space-y-1.5">
        {items.map((item) => {
          const widthPct = Math.max(2, Math.min(100, (Math.abs(item.val) / maxV) * 100));
          const disp = Math.round(convertFromSi(item.val, "velocity", unitSystem)).toLocaleString("en-US");
          return (
            <div key={item.label} className="grid grid-cols-[5.2rem_1fr_6.5rem] items-center gap-2 text-xs">
              <span className="font-semibold text-slate-200">{item.label}</span>
              <div className="h-3.5 overflow-hidden rounded bg-slate-950/90">
                <div
                  style={{ width: `${widthPct}%` }}
                  className={`${item.barClass} h-full rounded-r`}
                />
              </div>
              <span className="whitespace-nowrap text-right font-mono font-semibold text-slate-100">
                {item.val >= 0 ? "+" : ""}
                {disp} {velUnit}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-slate-800 pt-1.5 text-xs">
        <span className="text-slate-300">Delivered Margin</span>
        <span
          className={`font-mono font-semibold ${
            marginSi >= 0 ? "text-emerald-300" : "text-rose-300"
          }`}
        >
          {marginSi >= 0 ? "+" : ""}
          {Math.round(convertFromSi(marginSi, "velocity", unitSystem)).toLocaleString("en-US")} {velUnit}
        </span>
      </div>
    </div>
  );
}

interface EngineScatterChartProps {
  engines: ProvenanceEngine[];
  onSelectEngine?: (engine: ProvenanceEngine) => void;
}

export function EngineScatterChart({
  engines,
  onSelectEngine,
}: EngineScatterChartProps): React.ReactElement {
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);
  const valid = engines.filter((e) => e.isp_vac_s.value > 0 && e.thrust_to_weight_vac.value > 0);
  const minIsp = 240;
  const maxIsp = 480;
  const minTw = 0;
  const maxTw = Math.max(...valid.map((e) => e.thrust_to_weight_vac.value), 160);
  const yStep = maxTw > 180 ? 50 : 40;
  const yTicks = [0, yStep, yStep * 2, yStep * 3, yStep * 4].filter((v) => v <= maxTw + 10);

  const propColor = (prop: string): string => {
    if (prop === "lox_lh2") return "#38bdf8";
    if (prop === "lox_ch4") return "#60a5fa";
    if (prop === "solid_htpb") return "#fbbf24";
    if (prop === "hypergolic_nto_udmh") return "#fb923c";
    return "#34d399";
  };

  // Place text labels greedily by thrust order so labels never collide visually.
  const placedBoxes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  const labelVisibleIds = new Set<string>();
  const prioritySorted = [...valid].sort((a, b) => b.thrust_vac_n.value - a.thrust_vac_n.value);
  for (const eng of prioritySorted) {
    const isp = Math.min(Math.max(eng.isp_vac_s.value, minIsp), maxIsp);
    const tw = Math.min(Math.max(eng.thrust_to_weight_vac.value, minTw), maxTw);
    const px = 58 + ((isp - minIsp) / (maxIsp - minIsp)) * 552;
    const py = 185 - ((tw - minTw) / (maxTw - minTw)) * 160;
    const r = Math.max(4, Math.min(11, Math.log10(Math.max(eng.thrust_vac_n.value, 1e4)) * 1.3));
    const lw = eng.name.value.length * 7.4 + 14;
    const bx1 = px + r + 4;
    const bx2 = bx1 + lw;
    const by1 = py - 11;
    const by2 = py + 7;
    if (bx2 > 615 || by1 < 22 || by2 > 178) continue;
    const collides = placedBoxes.some(
      (b) => !(bx2 + 4 < b.x1 || bx1 - 4 > b.x2 || by2 + 3 < b.y1 || by1 - 3 > b.y2)
    );
    if (!collides) {
      placedBoxes.push({ x1: bx1, y1: by1, x2: bx2, y2: by2 });
      labelVisibleIds.add(eng.id.value);
    }
  }

  const hoveredEngine = hoveredId ? valid.find((e) => e.id.value === hoveredId) ?? null : null;

  return (
    <div className="panel-card p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-200">
          Propulsion Envelope: Vacuum Isp vs Thrust-to-Weight
        </span>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
          <span className="text-emerald-400">LOX/RP-1</span>
          <span className="text-sky-400">LOX/LH2</span>
          <span className="text-sky-300">LOX/CH4</span>
          <span className="text-amber-400">Solid</span>
          <span className="font-mono text-slate-400">({valid.length} plotted)</span>
        </div>
      </div>
      <svg viewBox="0 0 640 240" textRendering="geometricPrecision" className="h-72 w-full rounded bg-slate-950">
        <line x1="62" y1="190" x2="622" y2="190" stroke="#475569" strokeWidth="1.4" />
        <line x1="62" y1="18" x2="62" y2="190" stroke="#475569" strokeWidth="1.4" />
        {[250, 300, 350, 400, 450].map((isp) => {
          const x = 62 + ((isp - minIsp) / (maxIsp - minIsp)) * 548;
          return (
            <g key={isp}>
              <line x1={x} y1="18" x2={x} y2="190" stroke="#1e293b" strokeDasharray="3 3" />
              <text x={x} y="209" textAnchor="middle" fill="#e2e8f0" fontSize="13.5" fontWeight="600" fontFamily="monospace">
                {isp}s
              </text>
            </g>
          );
        })}
        {yTicks.map((tw) => {
          const y = 190 - ((tw - minTw) / (maxTw - minTw)) * 165;
          return (
            <g key={tw}>
              <line x1="62" y1={y} x2="622" y2={y} stroke="#1e293b" strokeDasharray="3 3" />
              <text x="54" y={y + 4} textAnchor="end" fill="#e2e8f0" fontSize="13.5" fontWeight="600" fontFamily="monospace">
                {tw}
              </text>
            </g>
          );
        })}

        {valid.map((eng) => {
          const isp = Math.min(Math.max(eng.isp_vac_s.value, minIsp), maxIsp);
          const tw = Math.min(Math.max(eng.thrust_to_weight_vac.value, minTw), maxTw);
          const x = 62 + ((isp - minIsp) / (maxIsp - minIsp)) * 548;
          const y = 190 - ((tw - minTw) / (maxTw - minTw)) * 165;
          const r = Math.max(4.5, Math.min(11, Math.log10(Math.max(eng.thrust_vac_n.value, 1e4)) * 1.3));
          const col = propColor(eng.propellant.value);
          const isHovered = hoveredId === eng.id.value;
          const showLabel = labelVisibleIds.has(eng.id.value);
          return (
            <g
              key={eng.id.value}
              onClick={() => onSelectEngine && onSelectEngine(eng)}
              onMouseEnter={() => setHoveredId(eng.id.value)}
              onMouseLeave={() => setHoveredId(null)}
              className="cursor-pointer"
            >
              <circle
                cx={x}
                cy={y}
                r={isHovered ? r + 2.5 : r}
                fill={col}
                fillOpacity={isHovered ? "0.95" : "0.75"}
                stroke={isHovered ? "#ffffff" : col}
                strokeWidth={isHovered ? "2" : "1.2"}
              />
              {showLabel && (
                <text x={x + r + 5} y={y + 4} fill="#f1f5f9" fontSize="13" fontWeight="600" fontFamily="monospace">
                  {eng.name.value}
                </text>
              )}
            </g>
          );
        })}

        {hoveredEngine && (
          <g>
            <rect x="70" y="14" width="380" height="28" rx="4" fill="#0f172a" stroke="#38bdf8" strokeWidth="1.2" />
            <text x="80" y="33" fill="#f8fafc" fontSize="13.5" fontWeight="600" fontFamily="monospace">
              {hoveredEngine.name.value}: {hoveredEngine.isp_vac_s.value.toFixed(1)}s Vac | T/W {hoveredEngine.thrust_to_weight_vac.value.toFixed(1)}
            </text>
          </g>
        )}

        <text x="342" y="231" textAnchor="middle" fill="#e2e8f0" fontSize="13.5" fontWeight="700">
          Vacuum Specific Impulse (s) | Hover or click any point for engine specs
        </text>
        <text x="16" y="106" textAnchor="middle" transform="rotate(-90 16 106)" fill="#e2e8f0" fontSize="13.5" fontWeight="700">
          Vac T/W
        </text>
      </svg>
    </div>
  );
}

interface SensitivityCurveChartProps {
  points: SensitivityPoint[];
  sweepLabel: string;
  unitSystem: UnitSystem;
}

export function SensitivityCurveChart({
  points,
  sweepLabel,
  unitSystem,
}: SensitivityCurveChartProps): React.ReactElement {
  if (points.length === 0) {
    return (
      <div className="panel-card p-4 text-sm text-slate-300">
        Run a sensitivity sweep to generate GLOW and flight cost trade curves.
      </div>
    );
  }

  const minX = Math.min(...points.map((p) => p.parameter_value));
  const maxX = Math.max(...points.map((p) => p.parameter_value));
  const spanX = Math.max(maxX - minX, 1e-6);

  const glowVals = points.map((p) => convertFromSi(p.glow_kg, "mass", unitSystem));
  const maxGlow = Math.max(...glowVals, 1);
  const minGlow = Math.min(...glowVals, 0);
  const spanGlow = Math.max(maxGlow - minGlow, 1);

  const costVals = points.map((p) => p.reusable_flight_cost_usd / 1e6);
  const maxCost = Math.max(...costVals, 1);
  const minCost = Math.min(...costVals, 0);
  const spanCost = Math.max(maxCost - minCost, 0.1);

  const midX = 0.5 * (minX + maxX);
  const formatAxisX = (v: number): string =>
    Math.abs(v) < 2 ? v.toFixed(2) : v >= 1000 ? Math.round(v).toLocaleString("en-US") : v.toFixed(1);
  const yFracs = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="panel-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-100">
          Trade Sensitivity: {sweepLabel}
        </span>
        <div className="flex gap-3 text-xs font-mono font-semibold">
          <span className="text-sky-300">GLOW ({unitLabel("mass", unitSystem)})</span>
          <span className="text-emerald-300">Flight Cost ($M)</span>
        </div>
      </div>
      <svg viewBox="0 0 640 262" textRendering="geometricPrecision" className="h-72 w-full rounded bg-slate-950">
        <line x1="82" y1="212" x2="558" y2="212" stroke="#475569" strokeWidth="1.4" />
        <line x1="82" y1="26" x2="82" y2="212" stroke="#38bdf8" strokeOpacity="0.7" strokeWidth="1.4" />
        <line x1="558" y1="26" x2="558" y2="212" stroke="#10b981" strokeOpacity="0.7" strokeWidth="1.4" />
        {yFracs.map((f) => {
          const y = 212 - f * 172;
          const gVal = minGlow + f * spanGlow;
          const cVal = minCost + f * spanCost;
          return (
            <g key={f}>
              <line x1="82" y1={y} x2="558" y2={y} stroke="#1e293b" strokeDasharray="3 3" />
              <text x="76" y={y + 4} textAnchor="end" fill="#7dd3fc" fontSize="13.5" fontWeight="600" fontFamily="monospace">
                {gVal >= 1000 ? `${(gVal / 1000).toFixed(0)}k` : gVal.toFixed(0)}
              </text>
              <text x="564" y={y + 4} textAnchor="start" fill="#6ee7b7" fontSize="13.5" fontWeight="600" fontFamily="monospace">
                ${cVal.toFixed(1)}M
              </text>
            </g>
          );
        })}
        <path
          d={points
            .map((pt, idx) => {
              const x = 82 + ((pt.parameter_value - minX) / spanX) * 476;
              const g = convertFromSi(pt.glow_kg, "mass", unitSystem);
              const y = 212 - ((g - minGlow) / spanGlow) * 172;
              return `${idx === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
            })
            .join(" ")}
          fill="none"
          stroke="#38bdf8"
          strokeWidth="2.6"
        />
        <path
          d={points
            .map((pt, idx) => {
              const x = 82 + ((pt.parameter_value - minX) / spanX) * 476;
              const c = pt.reusable_flight_cost_usd / 1e6;
              const y = 212 - ((c - minCost) / spanCost) * 172;
              return `${idx === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
            })
            .join(" ")}
          fill="none"
          stroke="#10b981"
          strokeWidth="2.6"
          strokeDasharray="5 3"
        />
        {points.map((pt, idx) => {
          const x = 82 + ((pt.parameter_value - minX) / spanX) * 476;
          const g = convertFromSi(pt.glow_kg, "mass", unitSystem);
          const yG = 212 - ((g - minGlow) / spanGlow) * 172;
          return (
            <circle
              key={idx}
              cx={x}
              cy={yG}
              r="4.2"
              fill={pt.feasible ? "#38bdf8" : "#ef4444"}
              stroke="#0f172a"
              strokeWidth="1.2"
            />
          );
        })}
        <text x="82" y="234" fill="#e2e8f0" fontSize="13.5" fontWeight="600" fontFamily="monospace">
          {formatAxisX(minX)}
        </text>
        <text x="320" y="234" textAnchor="middle" fill="#e2e8f0" fontSize="13.5" fontWeight="600" fontFamily="monospace">
          {formatAxisX(midX)}
        </text>
        <text x="558" y="234" textAnchor="end" fill="#e2e8f0" fontSize="13.5" fontWeight="600" fontFamily="monospace">
          {formatAxisX(maxX)}
        </text>
        <text x="320" y="254" textAnchor="middle" fill="#f1f5f9" fontSize="13.5" fontWeight="700">
          {sweepLabel}
        </text>
      </svg>
    </div>
  );
}

interface ParetoFrontierChartProps {
  frontier: VehicleSizingResult[];
  candidates: VehicleSizingResult[];
  unitSystem: UnitSystem;
  onSelectCandidate?: (res: VehicleSizingResult) => void;
}

export function ParetoFrontierChart({
  frontier,
  candidates,
  unitSystem,
  onSelectCandidate,
}: ParetoFrontierChartProps): React.ReactElement {
  const all = [...candidates, ...frontier];
  if (all.length === 0) {
    return (
      <div className="panel-card p-4 text-sm text-slate-300">
        Run Combinatorial Optimizer in Sizing Studio to populate the Pareto Frontier.
      </div>
    );
  }

  const glows = all.map((c) => convertFromSi(c.glow_kg, "mass", unitSystem));
  const costs = all.map((c) => c.cost_breakdown.reusable_flight_cost_usd / 1e6);
  const minG = Math.min(...glows);
  const maxG = Math.max(...glows);
  const spanG = Math.max(maxG - minG, 1);
  const minC = Math.min(...costs);
  const maxC = Math.max(...costs);
  const spanC = Math.max(maxC - minC, 0.5);

  const sortedFrontier = [...frontier].sort(
    (a, b) => a.glow_kg - b.glow_kg || a.cost_breakdown.reusable_flight_cost_usd - b.cost_breakdown.reusable_flight_cost_usd
  );
  const frontierPath = sortedFrontier
    .map((pt, idx) => {
      const x = 74 + ((convertFromSi(pt.glow_kg, "mass", unitSystem) - minG) / spanG) * 476;
      const y = 205 - (((pt.cost_breakdown.reusable_flight_cost_usd / 1e6) - minC) / spanC) * 165;
      return `${idx === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="panel-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-100">
          GLOW vs Flight Cost Pareto Frontier
        </span>
        <span className="text-xs font-mono font-semibold text-slate-200">
          {frontier.length} non-dominated / {all.length} candidates
        </span>
      </div>
      <svg viewBox="0 0 600 252" textRendering="geometricPrecision" className="h-72 w-full rounded bg-slate-950">
        <line x1="74" y1="205" x2="560" y2="205" stroke="#475569" strokeWidth="1.4" />
        <line x1="74" y1="25" x2="74" y2="205" stroke="#475569" strokeWidth="1.4" />
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = 205 - f * 165;
          const x = 74 + f * 476;
          const cVal = minC + f * spanC;
          const gVal = minG + f * spanG;
          return (
            <g key={f}>
              <line x1="74" y1={y} x2="560" y2={y} stroke="#1e293b" strokeDasharray="3 3" />
              <text x="68" y={y + 4} textAnchor="end" fill="#e2e8f0" fontSize="13.5" fontWeight="600" fontFamily="monospace">
                ${cVal.toFixed(1)}M
              </text>
              <text x={x} y="224" textAnchor="middle" fill="#e2e8f0" fontSize="13.5" fontWeight="600" fontFamily="monospace">
                {gVal >= 1000 ? `${(gVal / 1000).toFixed(0)}k` : gVal.toFixed(0)}
              </text>
            </g>
          );
        })}
        {all.map((cand, idx) => {
          const x = 74 + ((convertFromSi(cand.glow_kg, "mass", unitSystem) - minG) / spanG) * 476;
          const y = 205 - (((cand.cost_breakdown.reusable_flight_cost_usd / 1e6) - minC) / spanC) * 165;
          return (
            <circle
              key={`cand-${idx}`}
              cx={x}
              cy={y}
              r="3.8"
              fill="#64748b"
              fillOpacity="0.55"
              onClick={() => onSelectCandidate && onSelectCandidate(cand)}
              className="cursor-pointer"
            />
          );
        })}
        {frontierPath && <path d={frontierPath} fill="none" stroke="#38bdf8" strokeWidth="2.6" />}
        {sortedFrontier.map((pt, idx) => {
          const x = 74 + ((convertFromSi(pt.glow_kg, "mass", unitSystem) - minG) / spanG) * 476;
          const y = 205 - (((pt.cost_breakdown.reusable_flight_cost_usd / 1e6) - minC) / spanC) * 165;
          return (
            <circle
              key={`front-${idx}`}
              cx={x}
              cy={y}
              r="5.5"
              fill="#38bdf8"
              stroke="#ffffff"
              strokeWidth="1.4"
              onClick={() => onSelectCandidate && onSelectCandidate(pt)}
              className="cursor-pointer"
            />
          );
        })}
        <text x="315" y="245" textAnchor="middle" fill="#f1f5f9" fontSize="13.5" fontWeight="700">
          GLOW ({unitLabel("mass", unitSystem)})
        </text>
      </svg>
    </div>
  );
}
