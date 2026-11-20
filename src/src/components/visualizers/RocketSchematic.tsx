import React, { useMemo, useState } from "react";
import { formatFairingProfile } from "../../config/formatters";
import { convertFromSi, convertToSi, unitLabel, type UnitSystem } from "../../config/units";
import type { ProvenanceEngine } from "../../types/engine";
import type { VehicleConfiguration, VehicleSizingResult } from "../../types/sizing";

interface RocketSchematicProps {
  config: VehicleConfiguration;
  result: VehicleSizingResult | null;
  engines: ProvenanceEngine[];
  unitSystem: UnitSystem;
  compact?: boolean;
}

export function RocketSchematic({
  config,
  result,
  engines,
  unitSystem,
  compact = false,
}: RocketSchematicProps): React.ReactElement {
  const [showDimensions, setShowDimensions] = useState<boolean>(true);
  const [showInternals, setShowInternals] = useState<boolean>(true);

  const engineMap = useMemo(() => {
    const map = new Map<string, ProvenanceEngine>();
    for (const eng of engines) {
      map.set(eng.id.value, eng);
    }
    for (const eng of config.custom_engines) {
      map.set(eng.id.value, eng);
    }
    return map;
  }, [engines, config.custom_engines]);

  const geometry = useMemo(() => {
    if (!result) {
      return null;
    }
    const coreDia = Math.max(result.core_diameter_m, 1.0);
    const fairingDia = Math.max(result.fairing.outer_diameter_m, coreDia);
    const totalH = Math.max(result.total_height_m, 10.0);
    const padBottomY = compact ? 292 : 440;
    const usableH = compact ? 256 : 380;
    const pxPerM = usableH / totalH;
    const cx = compact ? 110 : 220;

    return {
      coreDia,
      fairingDia,
      totalH,
      padBottomY,
      pxPerM,
      cx,
    };
  }, [result, compact]);

  if (!result || !geometry) {
    return (
      <div className="panel-card p-4 text-xs text-slate-400">
        No sizing output available to draw schematic.
      </div>
    );
  }

  const { coreDia, fairingDia, totalH, padBottomY, pxPerM, cx } = geometry;
  const fairingHpx = result.fairing.total_length_m * pxPerM;
  const noseHpx = result.fairing.nose_length_m * pxPerM;
  const barrelHpx = result.fairing.barrel_length_m * pxPerM;
  const boatHpx = result.fairing.boat_tail_length_m * pxPerM;
  const topY = padBottomY - totalH * pxPerM;
  const fairingHalfW = (fairingDia * 0.5) * pxPerM;
  const coreHalfW = (coreDia * 0.5) * pxPerM;

  const fairingPolygon = (() => {
    if (config.fairing_profile === "biconic") {
      const shoulderY = topY + noseHpx * 0.45;
      const shoulderHalfW = fairingHalfW * 0.55;
      const barrelBotY = topY + noseHpx + barrelHpx;
      const boatBotY = barrelBotY + boatHpx;
      return [
        `${cx},${topY}`,
        `${cx + shoulderHalfW},${shoulderY}`,
        `${cx + fairingHalfW},${topY + noseHpx}`,
        `${cx + fairingHalfW},${barrelBotY}`,
        `${cx + coreHalfW},${boatBotY}`,
        `${cx - coreHalfW},${boatBotY}`,
        `${cx - fairingHalfW},${barrelBotY}`,
        `${cx - fairingHalfW},${topY + noseHpx}`,
        `${cx - shoulderHalfW},${shoulderY}`,
      ].join(" ");
    }
    const midY = topY + noseHpx * 0.55;
    const midHalfW = fairingHalfW * (config.fairing_profile === "von_karman" ? 0.72 : 0.78);
    const barrelBotY = topY + noseHpx + barrelHpx;
    const boatBotY = barrelBotY + boatHpx;
    return [
      `M ${cx} ${topY}`,
      `Q ${cx + midHalfW} ${midY} ${cx + fairingHalfW} ${topY + noseHpx}`,
      `L ${cx + fairingHalfW} ${barrelBotY}`,
      `L ${cx + coreHalfW} ${boatBotY}`,
      `L ${cx - coreHalfW} ${boatBotY}`,
      `L ${cx - fairingHalfW} ${barrelBotY}`,
      `L ${cx - fairingHalfW} ${topY + noseHpx}`,
      `Q ${cx - midHalfW} ${midY} ${cx} ${topY}`,
      "Z",
    ].join(" ");
  })();

  let cursorY = topY + fairingHpx;
  const stageBlocks: Array<{
    stageNum: number;
    yTop: number;
    heightPx: number;
    oxHeightPx: number;
    fuelHeightPx: number;
    domeHpx: number;
    nozzleHpx: number;
    nozzleRpx: number;
    engineCount: number;
    propellant: string;
    isUpper: boolean;
  }> = [];

  for (let idx = result.stages.length - 1; idx >= 0; idx -= 1) {
    const st = result.stages[idx];
    const hPx = st.stage_height_m * pxPerM;
    const eng = engineMap.get(st.engine_id);
    const nozDiaM = eng ? eng.nozzle_diameter_m.value : 1.0;
    const nozHeightM = eng ? eng.height_m.value : 1.8;
    const nozHpx = Math.min(hPx * 0.35, nozHeightM * pxPerM);
    const oxHpx = st.tank_geometry.ox_barrel_length_m * pxPerM;
    const fuelHpx = st.tank_geometry.fuel_barrel_length_m * pxPerM;
    const domeHpx = st.tank_geometry.dome_height_m * pxPerM;
    stageBlocks.push({
      stageNum: st.stage_number,
      yTop: cursorY,
      heightPx: hPx,
      oxHeightPx: oxHpx,
      fuelHeightPx: fuelHpx,
      domeHpx,
      nozzleHpx: nozHpx,
      nozzleRpx: Math.max(2.5, (nozDiaM * 0.5) * pxPerM),
      engineCount: st.engine_count,
      propellant: st.propellant,
      isUpper: idx > 0,
    });
    cursorY += hPx;
  }

  const s1Block = stageBlocks.find((item) => item.stageNum === 1) ?? null;
  const s1Result = result.stages[0] ?? null;
  const hasBoosters = config.booster_count > 0 && s1Block !== null && s1Result !== null;
  const boosterDiaPx = Math.max(coreHalfW * 1.15, 8);
  const boosterHpx = s1Block ? s1Block.heightPx * 0.88 : 80;
  const boosterTopY = padBottomY - boosterHpx;

  const heightStr = `${convertFromSi(totalH, "length", unitSystem).toFixed(1)} ${unitLabel("length", unitSystem)}`;
  const coreDiaStr = `${convertFromSi(coreDia, "length", unitSystem).toFixed(2)} ${unitLabel("length", unitSystem)}`;
  const fairingDiaStr = `${convertFromSi(fairingDia, "length", unitSystem).toFixed(2)} ${unitLabel("length", unitSystem)}`;

  const propColor = (prop: string): string => {
    if (prop === "lox_lh2") return "#38bdf8";
    if (prop === "lox_ch4") return "#60a5fa";
    if (prop === "solid_htpb") return "#fbbf24";
    if (prop === "hypergolic_nto_udmh") return "#fb923c";
    return "#34d399";
  };

  if (compact) {
    return (
      <svg
        viewBox="0 0 220 320"
        className="h-56 w-full select-none rounded-lg border border-slate-800/80 bg-slate-950"
      >
        <defs>
          <pattern id="bpGridCompact" width="16" height="16" patternUnits="userSpaceOnUse">
            <path d="M 16 0 L 0 0 0 16" fill="none" stroke="#0f172a" strokeWidth="1" />
          </pattern>
        </defs>
        <rect x="0" y="0" width="220" height="320" fill="url(#bpGridCompact)" />
        <line x1="18" y1={padBottomY} x2="202" y2={padBottomY} stroke="#475569" strokeWidth="1.5" />

        {config.fairing_profile === "biconic" ? (
          <polygon points={fairingPolygon} fill="#1e293b" stroke="#94a3b8" strokeWidth="1.3" />
        ) : (
          <path d={fairingPolygon} fill="#1e293b" stroke="#94a3b8" strokeWidth="1.3" />
        )}

        {stageBlocks.map((blk) => {
          const bodyH = Math.max(blk.heightPx - blk.nozzleHpx, 8);
          const tankFill = propColor(blk.propellant);
          const oxTop = blk.yTop + 3;
          const fuelTop = oxTop + blk.oxHeightPx + blk.domeHpx * 0.5;
          const visibleEngines = Math.min(blk.engineCount, 5);
          const spacing = visibleEngines > 1 ? (coreHalfW * 1.3) / (visibleEngines - 1) : 0;
          const firstEngX = visibleEngines > 1 ? cx - coreHalfW * 0.65 : cx;
          return (
            <g key={blk.stageNum}>
              <rect
                x={cx - coreHalfW}
                y={blk.yTop}
                width={Math.max(4, coreHalfW * 2)}
                height={bodyH}
                fill="#0f172a"
                stroke="#cbd5e1"
                strokeWidth="1.2"
              />
              <rect
                x={cx - coreHalfW + 1.5}
                y={oxTop}
                width={Math.max(2, coreHalfW * 2 - 3)}
                height={Math.max(2, Math.min(blk.oxHeightPx, bodyH * 0.48))}
                rx={Math.max(1.5, blk.domeHpx * 0.35)}
                fill={tankFill}
                fillOpacity="0.32"
                stroke={tankFill}
                strokeOpacity="0.7"
                strokeWidth="0.7"
              />
              <rect
                x={cx - coreHalfW + 1.5}
                y={Math.min(fuelTop, blk.yTop + bodyH - 3)}
                width={Math.max(2, coreHalfW * 2 - 3)}
                height={Math.max(2, Math.min(blk.fuelHeightPx, bodyH * 0.42))}
                rx={Math.max(1.5, blk.domeHpx * 0.35)}
                fill="#f59e0b"
                fillOpacity="0.25"
                stroke="#f59e0b"
                strokeOpacity="0.65"
                strokeWidth="0.7"
              />
              {Array.from({ length: visibleEngines }).map((_, engIdx) => {
                const ex = firstEngX + engIdx * spacing;
                const topW = Math.max(1.2, blk.nozzleRpx * 0.45);
                const botW = Math.max(2.0, blk.nozzleRpx);
                const baseY = blk.yTop + bodyH;
                const endY = Math.min(padBottomY, baseY + blk.nozzleHpx);
                return (
                  <polygon
                    key={engIdx}
                    points={`${ex - topW},${baseY} ${ex + topW},${baseY} ${ex + botW},${endY} ${ex - botW},${endY}`}
                    fill="#334155"
                    stroke="#94a3b8"
                    strokeWidth="0.7"
                  />
                );
              })}
              <text x={cx + coreHalfW + 6} y={blk.yTop + bodyH * 0.5 + 3} fill="#e2e8f0" fontSize="12.5" fontFamily="monospace">
                S{blk.stageNum}
              </text>
            </g>
          );
        })}

        {hasBoosters && (
          <>
            <rect
              x={cx - coreHalfW - boosterDiaPx - 3}
              y={boosterTopY}
              width={boosterDiaPx}
              height={Math.max(8, boosterHpx - 5)}
              rx={boosterDiaPx * 0.45}
              fill="#1e293b"
              stroke="#f59e0b"
              strokeWidth="1.2"
            />
            <rect
              x={cx + coreHalfW + 3}
              y={boosterTopY}
              width={boosterDiaPx}
              height={Math.max(8, boosterHpx - 5)}
              rx={boosterDiaPx * 0.45}
              fill="#1e293b"
              stroke="#f59e0b"
              strokeWidth="1.2"
            />
          </>
        )}

        <line x1="26" y1={topY} x2="26" y2={padBottomY} stroke="#38bdf8" strokeWidth="1" />
        <line x1="21" y1={topY} x2="31" y2={topY} stroke="#38bdf8" strokeWidth="1" />
        <line x1="21" y1={padBottomY} x2="31" y2={padBottomY} stroke="#38bdf8" strokeWidth="1" />
        <text x="110" y="311" textAnchor="middle" fill="#7dd3fc" fontSize="12" fontFamily="monospace">
          {heightStr} tall | {coreDiaStr} dia
        </text>
      </svg>
    );
  }

  const rulerTickVals = unitSystem === "imperial"
    ? [0, 50, 100, 150, 200, 250, 300, 350, 400, 450]
    : [0, 20, 40, 60, 80, 100, 120, 140];

  return (
    <div className="panel-card flex flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-200">
            Dimensioned Vehicle Schematic
          </h3>
          <p className="text-xs text-slate-400">
            {formatFairingProfile(config.fairing_profile)} Fairing | {config.staging_mode === "hot_staging_vented_ring" ? "Hot Staging" : "Cold Staging"}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button id="schematic.toggle_dimensions" type="button" onClick={() => setShowDimensions((v) => !v)} title="Toggle overall vehicle height, diameter, and stage length dimension callouts" className={`btn-secondary px-2 py-1 text-xs ${showDimensions ? "border-sky-500 text-sky-300" : ""}`}>
            Dims
          </button>
          <button id="schematic.toggle_internals" type="button" onClick={() => setShowInternals((v) => !v)} title="Toggle internal propellant tank geometry and ullage bulkheads inside each stage" className={`btn-secondary px-2 py-1 text-xs ${showInternals ? "border-sky-500 text-sky-300" : ""}`}>
            Tanks
          </button>
        </div>
      </div>

      <div className="bg-slate-950 p-2">
        <svg viewBox="0 0 460 470" className="h-96 w-full select-none">
          <defs>
            <pattern id="bpGrid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#0f172a" strokeWidth="1" />
            </pattern>
          </defs>
          <rect x="0" y="0" width="460" height="470" fill="url(#bpGrid)" />

          {rulerTickVals.map((tickVal) => {
            const mMark = convertToSi(tickVal, "length", unitSystem);
            const yPos = padBottomY - mMark * pxPerM;
            if (yPos < 18 || yPos > padBottomY) {
              return null;
            }
            return (
              <g key={tickVal}>
                <line x1="38" y1={yPos} x2="430" y2={yPos} stroke="#1e293b" strokeDasharray="3 4" strokeWidth="0.7" />
                <text x="34" y={yPos + 4} textAnchor="end" fill="#94a3b8" fontSize="12" fontFamily="monospace">
                  {tickVal}
                </text>
              </g>
            );
          })}

          <line x1="25" y1={padBottomY} x2="435" y2={padBottomY} stroke="#475569" strokeWidth="1.5" />

          {config.fairing_profile === "biconic" ? (
            <polygon points={fairingPolygon} fill="#1e293b" stroke="#94a3b8" strokeWidth="1.4" />
          ) : (
            <path d={fairingPolygon} fill="#1e293b" stroke="#94a3b8" strokeWidth="1.4" />
          )}

          {showInternals && (
            <rect
              x={cx - (config.payload_diameter_m * 0.5) * pxPerM}
              y={topY + noseHpx * 0.8}
              width={Math.max(4, config.payload_diameter_m * pxPerM)}
              height={Math.max(6, Math.min(barrelHpx, config.payload_length_m * pxPerM))}
              fill="#38bdf8"
              fillOpacity="0.22"
              stroke="#38bdf8"
              strokeDasharray="2 2"
              strokeWidth="0.9"
            />
          )}

          {stageBlocks.map((blk) => {
            const bodyH = Math.max(blk.heightPx - blk.nozzleHpx, 10);
            const tankFill = propColor(blk.propellant);
            const oxTop = blk.yTop + 4;
            const fuelTop = oxTop + blk.oxHeightPx + blk.domeHpx * 0.5;
            const visibleEngines = Math.min(blk.engineCount, 5);
            const spacing = visibleEngines > 1 ? (coreHalfW * 1.35) / (visibleEngines - 1) : 0;
            const firstEngX = visibleEngines > 1 ? cx - coreHalfW * 0.675 : cx;

            return (
              <g key={blk.stageNum}>
                <rect
                  x={cx - coreHalfW}
                  y={blk.yTop}
                  width={Math.max(4, coreHalfW * 2)}
                  height={bodyH}
                  fill="#0f172a"
                  stroke="#cbd5e1"
                  strokeWidth="1.3"
                />
                {showInternals && (
                  <>
                    <rect
                      x={cx - coreHalfW + 1.5}
                      y={oxTop}
                      width={Math.max(2, coreHalfW * 2 - 3)}
                      height={Math.max(2, Math.min(blk.oxHeightPx, bodyH * 0.48))}
                      rx={Math.max(2, blk.domeHpx * 0.35)}
                      fill={tankFill}
                      fillOpacity="0.28"
                      stroke={tankFill}
                      strokeOpacity="0.65"
                      strokeWidth="0.7"
                    />
                    <rect
                      x={cx - coreHalfW + 1.5}
                      y={Math.min(fuelTop, blk.yTop + bodyH - 4)}
                      width={Math.max(2, coreHalfW * 2 - 3)}
                      height={Math.max(2, Math.min(blk.fuelHeightPx, bodyH * 0.42))}
                      rx={Math.max(2, blk.domeHpx * 0.35)}
                      fill="#f59e0b"
                      fillOpacity="0.24"
                      stroke="#f59e0b"
                      strokeOpacity="0.6"
                      strokeWidth="0.7"
                    />
                  </>
                )}

                {blk.isUpper && config.staging_mode === "hot_staging_vented_ring" && (
                  <rect
                    x={cx - coreHalfW}
                    y={blk.yTop + bodyH - 4}
                    width={Math.max(4, coreHalfW * 2)}
                    height="5"
                    fill="#f97316"
                    fillOpacity="0.65"
                    stroke="#fdba74"
                    strokeWidth="0.6"
                  />
                )}

                {Array.from({ length: visibleEngines }).map((_, engIdx) => {
                  const ex = firstEngX + engIdx * spacing;
                  const topW = Math.max(1.5, blk.nozzleRpx * 0.45);
                  const botW = Math.max(2.5, blk.nozzleRpx);
                  const baseY = blk.yTop + bodyH;
                  const endY = Math.min(padBottomY, baseY + blk.nozzleHpx);
                  return (
                    <polygon
                      key={engIdx}
                      points={`${ex - topW},${baseY} ${ex + topW},${baseY} ${ex + botW},${endY} ${ex - botW},${endY}`}
                      fill="#334155"
                      stroke="#94a3b8"
                      strokeWidth="0.8"
                    />
                  );
                })}

                <text x={cx + coreHalfW + 8} y={blk.yTop + bodyH * 0.5 + 4} fill="#e2e8f0" fontSize="12.5" fontFamily="monospace">
                  S{blk.stageNum} ({blk.engineCount}x)
                </text>
              </g>
            );
          })}

          {hasBoosters && (
            <>
              <rect
                x={cx - coreHalfW - boosterDiaPx - 3}
                y={boosterTopY}
                width={boosterDiaPx}
                height={boosterHpx - 6}
                rx={boosterDiaPx * 0.45}
                fill="#1e293b"
                stroke="#f59e0b"
                strokeWidth="1.2"
              />
              <rect
                x={cx + coreHalfW + 3}
                y={boosterTopY}
                width={boosterDiaPx}
                height={boosterHpx - 6}
                rx={boosterDiaPx * 0.45}
                fill="#1e293b"
                stroke="#f59e0b"
                strokeWidth="1.2"
              />
              <text x={cx + coreHalfW + boosterDiaPx + 8} y={boosterTopY + 18} fill="#fcd34d" fontSize="12.5" fontFamily="monospace">
                {config.booster_count}x Strap-On
              </text>
            </>
          )}

          {showDimensions && (
            <g>
              <line x1="78" y1={topY} x2="78" y2={padBottomY} stroke="#38bdf8" strokeWidth="1" />
              <line x1="73" y1={topY} x2="83" y2={topY} stroke="#38bdf8" strokeWidth="1" />
              <line x1="73" y1={padBottomY} x2="83" y2={padBottomY} stroke="#38bdf8" strokeWidth="1" />
              <text x="84" y={(topY + padBottomY) * 0.5} fill="#7dd3fc" fontSize="12.5" fontFamily="monospace">
                H: {heightStr}
              </text>

              <line x1={cx - coreHalfW} y1={padBottomY + 14} x2={cx + coreHalfW} y2={padBottomY + 14} stroke="#34d399" strokeWidth="1" />
              <text x={cx} y={padBottomY + 29} textAnchor="middle" fill="#6ee7b7" fontSize="12.5" fontFamily="monospace">
                Core Dia: {coreDiaStr} | Fairing: {fairingDiaStr}
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
