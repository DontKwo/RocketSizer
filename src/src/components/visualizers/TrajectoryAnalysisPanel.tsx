import React, { useEffect, useMemo, useState } from "react";
import { simulateTrajectory } from "../../api/tauriClient";
import { convertFromSi, unitLabel, type UnitSystem } from "../../config/units";
import type { TrajectorySimulationResult, VehicleConfiguration } from "../../types/sizing";

interface TrajectoryAnalysisPanelProps {
  config: VehicleConfiguration;
  unitSystem: UnitSystem;
}

function buildPolyline(
  points: Array<{ x: number; y: number }>,
  width: number,
  height: number,
  padX: number,
  padY: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number
): string {
  if (points.length === 0) return "";
  const dx = Math.max(1e-6, xMax - xMin);
  const dy = Math.max(1e-6, yMax - yMin);
  const innerW = width - 2 * padX;
  const innerH = height - 2 * padY;
  return points
    .map((p) => {
      const px = padX + ((p.x - xMin) / dx) * innerW;
      const py = height - padY - ((p.y - yMin) / dy) * innerH;
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(" ");
}

export function TrajectoryAnalysisPanel({
  config,
  unitSystem,
}: TrajectoryAnalysisPanelProps): React.ReactElement {
  const [simResult, setSimResult] = useState<TrajectorySimulationResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setErrorMsg(null);
    simulateTrajectory(config)
      .then((res) => {
        if (active) setSimResult(res);
      })
      .catch((err) => {
        if (active) {
          setErrorMsg(err instanceof Error ? err.message : "Trajectory integration failed");
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [config]);

  const vUnit = unitLabel("velocity", unitSystem);
  const qUnit = unitSystem === "imperial" ? "psf" : "kPa";
  const qDivisor = unitSystem === "imperial" ? 47.880259 : 1000.0;
  const altUnit = unitSystem === "imperial" ? "kft" : "km";
  const altDivisor = unitSystem === "imperial" ? 304.8 : 1000.0;
  const drUnit = unitSystem === "imperial" ? "nmi" : "km";
  const drDivisor = unitSystem === "imperial" ? 1852.0 : 1000.0;

  const series = useMemo(() => {
    if (!simResult || simResult.points.length === 0) return null;
    const pts = simResult.points;
    const maxTime = Math.max(...pts.map((p) => p.time_s), 1);
    const maxAltDisp = Math.max(...pts.map((p) => p.altitude_m / altDivisor), 1);
    const maxDrDisp = Math.max(...pts.map((p) => p.downrange_m / drDivisor), 1);
    const maxVelDisp = Math.max(
      ...pts.map((p) => convertFromSi(p.velocity_m_s, "velocity", unitSystem)),
      1
    );
    const maxQDisp = Math.max(...pts.map((p) => p.dynamic_pressure_pa / qDivisor), 1);
    const maxMach = Math.max(...pts.map((p) => p.mach), 1);
    const maxAccel = Math.max(...pts.map((p) => p.accel_g), 1);

    return {
      pts,
      maxTime,
      maxAltDisp,
      maxDrDisp,
      maxVelDisp,
      maxQDisp,
      maxMach,
      maxAccel,
    };
  }, [simResult, altDivisor, drDivisor, qDivisor, unitSystem]);

  const handleExportCsv = (): void => {
    if (!simResult) return;
    const hdr = `time_s,stage,altitude_${altUnit},downrange_${drUnit},velocity_${vUnit},fpa_deg,mach,q_${qUnit},accel_g,throttle_pct\n`;
    const body = simResult.points
      .map(
        (p) =>
          `${p.time_s.toFixed(2)},${p.active_stage},${(p.altitude_m / altDivisor).toFixed(3)},${(p.downrange_m / drDivisor).toFixed(3)},${convertFromSi(p.velocity_m_s, "velocity", unitSystem).toFixed(2)},${p.flight_path_deg.toFixed(2)},${p.mach.toFixed(3)},${(p.dynamic_pressure_pa / qDivisor).toFixed(2)},${p.accel_g.toFixed(3)},${(p.throttle_frac * 100).toFixed(1)}`
      )
      .join("\n");
    const blob = new Blob([hdr + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${config.name.replace(/\s+/g, "_").toLowerCase()}_trajectory.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading && !simResult) {
    return (
      <div className="panel-card p-6 text-center text-sm text-sky-300">
        Integrating 2D RK4 gravity-turn ascent trajectory...
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="rounded-lg border border-rose-500/50 bg-rose-950/50 p-4 text-xs text-rose-200">
        Trajectory Simulation Error: {errorMsg}
      </div>
    );
  }

  if (!simResult || !series) {
    return (
      <div className="panel-card p-4 text-xs text-slate-400">
        No trajectory profile available for this configuration.
      </div>
    );
  }

  const maxQPt =
    simResult.points.find((p) => p.dynamic_pressure_pa >= simResult.max_q_pa * 0.999) ??
    simResult.points[0];
  const lastPt = simResult.points[simResult.points.length - 1];
  const W = 440;
  const H = 200;
  const padX = 44;
  const padY = 30;

  return (
    <div className="space-y-4">
      <div className="panel-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wide text-sky-300">
              Full-Fidelity 2D Gravity-Turn Ascent Trajectory Analysis
            </h3>
            <p className="text-xs text-slate-400">
              RK4 integration with US Standard Atmosphere, Mach wave drag curve, finite burn staging, Max-Q &amp; Axial G throttle caps.
            </p>
          </div>
          <button
            id="trajectory.export_csv"
            type="button"
            onClick={handleExportCsv}
            title="Download full time-step ascent trajectory telemetry as a CSV spreadsheet"
            className="btn-secondary px-3 py-1.5 text-xs"
          >
            Export Trajectory CSV
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
            <div className="text-xs text-slate-400">SECO Ascent Time</div>
            <div className="font-mono text-base font-bold text-slate-100">
              {lastPt.time_s.toFixed(1)} s
            </div>
            <div className="font-mono text-xs text-slate-400">
              Solve: {simResult.sim_duration_ms.toFixed(1)} ms
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
            <div className="text-xs text-slate-400">Max Dynamic Pressure</div>
            <div className="font-mono text-base font-bold text-amber-300">
              {(simResult.max_q_pa / qDivisor).toFixed(0)} {qUnit}
            </div>
            <div className="font-mono text-xs text-slate-400">
              t = {simResult.max_q_time_s.toFixed(1)} s @ {(maxQPt.altitude_m / altDivisor).toFixed(1)} {altUnit}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
            <div className="text-xs text-slate-400">Peak Axial Accel</div>
            <div className="font-mono text-base font-bold text-emerald-300">
              {simResult.peak_accel_g.toFixed(2)} g
            </div>
            <div className="font-mono text-xs text-slate-400">
              Peak Mach {simResult.max_mach.toFixed(1)}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
            <div className="text-xs text-slate-400">Gravity Loss</div>
            <div className="font-mono text-base font-bold text-sky-300">
              {Math.round(convertFromSi(simResult.gravity_loss_m_s, "velocity", unitSystem)).toLocaleString("en-US")} {vUnit}
            </div>
            <div className="font-mono text-xs text-slate-400">
              Steer: {Math.round(convertFromSi(simResult.steering_loss_m_s, "velocity", unitSystem)).toLocaleString("en-US")} {vUnit}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
            <div className="text-xs text-slate-400">Aero Drag Loss</div>
            <div className="font-mono text-base font-bold text-sky-300">
              {Math.round(convertFromSi(simResult.drag_loss_m_s, "velocity", unitSystem)).toLocaleString("en-US")} {vUnit}
            </div>
            <div className="font-mono text-xs text-slate-400">
              Final FPA {simResult.final_flight_path_deg.toFixed(1)} deg
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
            <div className="text-xs text-slate-400">Insertion State</div>
            <div className={`font-mono text-base font-bold ${simResult.orbit_reached ? "text-emerald-300" : "text-amber-300"}`}>
              {simResult.orbit_reached ? "ORBIT REACHED" : "SUB-ORBITAL"}
            </div>
            <div className="font-mono text-xs text-slate-400">
              {(simResult.perigee_achieved_m / 1852).toFixed(0)} x {(simResult.apogee_achieved_m / 1852).toFixed(0)} nmi
            </div>
          </div>
        </div>
      </div>

      {/* 2x2 SVG Telemetry Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="panel-card p-3">
          <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-200">
            <span>Altitude ({altUnit}) &amp; Downrange ({drUnit}) vs Time</span>
            <span className="font-mono text-xs text-sky-300">
              Max Alt {series.maxAltDisp.toFixed(1)} {altUnit}
            </span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full rounded bg-slate-950">
            <line x1={padX} y1={H - padY} x2={W - padX} y2={H - padY} stroke="#334155" />
            <line x1={padX} y1={padY} x2={padX} y2={H - padY} stroke="#334155" />
            <polyline
              fill="none"
              stroke="#38bdf8"
              strokeWidth="2.2"
              points={buildPolyline(
                series.pts.map((p) => ({ x: p.time_s, y: p.altitude_m / altDivisor })),
                W,
                H,
                padX,
                padY,
                0,
                series.maxTime,
                0,
                series.maxAltDisp * 1.08
              )}
            />
            <polyline
              fill="none"
              stroke="#f59e0b"
              strokeWidth="1.8"
              strokeDasharray="4 3"
              points={buildPolyline(
                series.pts.map((p) => ({ x: p.time_s, y: p.downrange_m / drDivisor })),
                W,
                H,
                padX,
                padY,
                0,
                series.maxTime,
                0,
                series.maxDrDisp * 1.08
              )}
            />
            <text x={padX + 6} y={17} fill="#38bdf8" fontSize="12.5" fontFamily="monospace">
              Alt ({altUnit})
            </text>
            <text x={padX + 105} y={17} fill="#fbbf24" fontSize="12.5" fontFamily="monospace">
              Downrange ({drUnit})
            </text>
            <text x={W - padX} y={H - 6} textAnchor="end" fill="#94a3b8" fontSize="12.5" fontFamily="monospace">
              t = {series.maxTime.toFixed(0)} s
            </text>
          </svg>
        </div>

        <div className="panel-card p-3">
          <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-200">
            <span>Inertial Velocity ({vUnit}) &amp; FPA (deg) vs Time</span>
            <span className="font-mono text-xs text-emerald-300">
              Peak {Math.round(series.maxVelDisp).toLocaleString("en-US")} {vUnit}
            </span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full rounded bg-slate-950">
            <line x1={padX} y1={H - padY} x2={W - padX} y2={H - padY} stroke="#334155" />
            <line x1={padX} y1={padY} x2={padX} y2={H - padY} stroke="#334155" />
            <polyline
              fill="none"
              stroke="#34d399"
              strokeWidth="2.2"
              points={buildPolyline(
                series.pts.map((p) => ({
                  x: p.time_s,
                  y: convertFromSi(p.velocity_m_s, "velocity", unitSystem),
                })),
                W,
                H,
                padX,
                padY,
                0,
                series.maxTime,
                0,
                series.maxVelDisp * 1.08
              )}
            />
            <polyline
              fill="none"
              stroke="#a5b4fc"
              strokeWidth="1.8"
              strokeDasharray="4 3"
              points={buildPolyline(
                series.pts.map((p) => ({ x: p.time_s, y: p.flight_path_deg })),
                W,
                H,
                padX,
                padY,
                0,
                series.maxTime,
                -5,
                95
              )}
            />
            <text x={padX + 6} y={17} fill="#34d399" fontSize="12.5" fontFamily="monospace">
              Vel ({vUnit})
            </text>
            <text x={padX + 110} y={17} fill="#a5b4fc" fontSize="12.5" fontFamily="monospace">
              FPA (0..90 deg)
            </text>
            <text x={W - padX} y={H - 6} textAnchor="end" fill="#94a3b8" fontSize="12.5" fontFamily="monospace">
              t = {series.maxTime.toFixed(0)} s
            </text>
          </svg>
        </div>

        <div className="panel-card p-3">
          <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-200">
            <span>Dynamic Pressure ({qUnit}) &amp; Mach Number vs Time</span>
            <span className="font-mono text-xs text-amber-300">
              Max-Q {(simResult.max_q_pa / qDivisor).toFixed(0)} {qUnit}
            </span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full rounded bg-slate-950">
            <line x1={padX} y1={H - padY} x2={W - padX} y2={H - padY} stroke="#334155" />
            <line x1={padX} y1={padY} x2={padX} y2={H - padY} stroke="#334155" />
            <polyline
              fill="none"
              stroke="#fbbf24"
              strokeWidth="2.2"
              points={buildPolyline(
                series.pts.map((p) => ({ x: p.time_s, y: p.dynamic_pressure_pa / qDivisor })),
                W,
                H,
                padX,
                padY,
                0,
                series.maxTime,
                0,
                series.maxQDisp * 1.15
              )}
            />
            <polyline
              fill="none"
              stroke="#fb7185"
              strokeWidth="1.6"
              strokeDasharray="3 3"
              points={buildPolyline(
                series.pts.map((p) => ({ x: p.time_s, y: p.mach })),
                W,
                H,
                padX,
                padY,
                0,
                series.maxTime,
                0,
                series.maxMach * 1.1
              )}
            />
            <circle
              cx={padX + (maxQPt.time_s / series.maxTime) * (W - 2 * padX)}
              cy={H - padY - (maxQPt.dynamic_pressure_pa / qDivisor / (series.maxQDisp * 1.15)) * (H - 2 * padY)}
              r="4.5"
              fill="#fbbf24"
              stroke="#020617"
            />
            <text x={padX + 6} y={17} fill="#fbbf24" fontSize="12.5" fontFamily="monospace">
              q ({qUnit})
            </text>
            <text x={padX + 105} y={17} fill="#fb7185" fontSize="12.5" fontFamily="monospace">
              Mach
            </text>
            <text x={W - padX} y={H - 6} textAnchor="end" fill="#94a3b8" fontSize="12.5" fontFamily="monospace">
              Max-Q @ {simResult.max_q_time_s.toFixed(0)} s
            </text>
          </svg>
        </div>

        <div className="panel-card p-3">
          <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-200">
            <span>Axial Acceleration (g) &amp; Throttle (%) vs Time</span>
            <span className="font-mono text-xs text-sky-300">
              Peak {simResult.peak_accel_g.toFixed(2)} g
            </span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full rounded bg-slate-950">
            <line x1={padX} y1={H - padY} x2={W - padX} y2={H - padY} stroke="#334155" />
            <line x1={padX} y1={padY} x2={padX} y2={H - padY} stroke="#334155" />
            <polyline
              fill="none"
              stroke="#38bdf8"
              strokeWidth="2.2"
              points={buildPolyline(
                series.pts.map((p) => ({ x: p.time_s, y: p.accel_g })),
                W,
                H,
                padX,
                padY,
                0,
                series.maxTime,
                0,
                Math.max(series.maxAccel * 1.15, 2)
              )}
            />
            <polyline
              fill="none"
              stroke="#34d399"
              strokeWidth="1.6"
              strokeDasharray="4 3"
              points={buildPolyline(
                series.pts.map((p) => ({ x: p.time_s, y: p.throttle_frac * 100 })),
                W,
                H,
                padX,
                padY,
                0,
                series.maxTime,
                0,
                110
              )}
            />
            <text x={padX + 6} y={17} fill="#38bdf8" fontSize="12.5" fontFamily="monospace">
              Accel (g)
            </text>
            <text x={padX + 105} y={17} fill="#34d399" fontSize="12.5" fontFamily="monospace">
              Throttle (0..100%)
            </text>
            <text x={W - padX} y={H - 6} textAnchor="end" fill="#94a3b8" fontSize="12.5" fontFamily="monospace">
              t = {series.maxTime.toFixed(0)} s
            </text>
          </svg>
        </div>
      </div>

      {/* Ascent Event Timeline */}
      <div className="panel-card overflow-hidden">
        <div className="border-b border-slate-800 px-4 py-2.5">
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-200">
            Ascent Mission Event Timeline
          </h4>
        </div>
        <div className="overflow-x-auto p-3">
          <table className="w-full min-w-[680px] border-collapse text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-slate-700 text-sky-300">
                <th className="px-2 py-1.5">MET (s)</th>
                <th className="px-2 py-1.5">Event</th>
                <th className="px-2 py-1.5 text-right">Altitude ({altUnit})</th>
                <th className="px-2 py-1.5 text-right">Velocity ({vUnit})</th>
                <th className="px-2 py-1.5">Details</th>
              </tr>
            </thead>
            <tbody>
              {simResult.events.map((ev, idx) => (
                <tr key={idx} className="border-b border-slate-800/60 hover:bg-slate-800/40">
                  <td className="px-2 py-1.5 text-amber-300">T+{ev.time_s.toFixed(1)}s</td>
                  <td className="px-2 py-1.5 font-sans font-semibold text-slate-100">{ev.label}</td>
                  <td className="px-2 py-1.5 text-right text-slate-200">
                    {(ev.altitude_m / altDivisor).toFixed(1)}
                  </td>
                  <td className="px-2 py-1.5 text-right text-slate-200">
                    {Math.round(convertFromSi(ev.velocity_m_s, "velocity", unitSystem)).toLocaleString("en-US")}
                  </td>
                  <td className="px-2 py-1.5 font-sans text-slate-300">{ev.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
