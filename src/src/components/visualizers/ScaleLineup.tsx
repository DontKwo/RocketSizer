import React, { useMemo } from "react";
import { convertFromSi, unitLabel, type UnitSystem } from "../../config/units";
import type { VehicleSizingResult } from "../../types/sizing";
import type { ProvenanceVehicle } from "../../types/vehicle";

interface ScaleLineupProps {
  activeResult: VehicleSizingResult | null;
  activeLabel: string;
  heritageVehicles: ProvenanceVehicle[];
  selectedIds: string[];
  themeMode: "blueprint" | "presentation";
  unitSystem: UnitSystem;
  svgRef?: React.RefObject<SVGSVGElement | null>;
}

interface LineupEntry {
  id: string;
  label: string;
  heightM: number;
  coreDiaM: number;
  maxWidthM: number;
  glowKg: number;
  payloadLeoKg: number;
  isActive: boolean;
}

export function ScaleLineup({
  activeResult,
  activeLabel,
  heritageVehicles,
  selectedIds,
  themeMode,
  unitSystem,
  svgRef,
}: ScaleLineupProps): React.ReactElement {
  const entries = useMemo<LineupEntry[]>(() => {
    const items: LineupEntry[] = [];
    if (activeResult) {
      items.push({
        id: "active_design",
        label: activeLabel || "Active Design",
        heightM: activeResult.total_height_m,
        coreDiaM: activeResult.core_diameter_m,
        maxWidthM: activeResult.max_width_m,
        glowKg: activeResult.glow_kg,
        payloadLeoKg: activeResult.payload_mass_kg,
        isActive: true,
      });
    }
    for (const v of heritageVehicles) {
      if (selectedIds.includes(v.id.value)) {
        items.push({
          id: v.id.value,
          label: `${v.name.value}${v.variant.value ? ` ${v.variant.value}` : ""}`.trim(),
          heightM: v.total_height_m.value,
          coreDiaM: v.core_diameter_m.value,
          maxWidthM: v.max_width_m.value,
          glowKg: v.glow_kg.value,
          payloadLeoKg: v.payload_leo_kg.value,
          isActive: false,
        });
      }
    }
    return items;
  }, [activeResult, activeLabel, heritageVehicles, selectedIds]);

  const maxH = Math.max(...entries.map((e) => e.heightM), 60);
  const svgH = 440;
  const groundY = 390;
  const usableH = 335;
  const pxPerM = usableH / (maxH * 1.08);
  const colW = Math.max(144, Math.min(176, 900 / Math.max(entries.length, 1)));
  const svgW = Math.max(840, entries.length * colW + 104);

  const isBp = themeMode === "blueprint";
  const bg = isBp ? "#020617" : "#f8fafc";
  const gridColor = isBp ? "#1e293b" : "#cbd5e1";
  const textColor = isBp ? "#e2e8f0" : "#0f172a";
  const mutedColor = isBp ? "#94a3b8" : "#475569";

  const stepM = unitSystem === "metric" ? 10 : 15.24;
  const gridLines: number[] = [];
  for (let m = 0; m <= maxH * 1.1; m += stepM) {
    gridLines.push(m);
  }

  return (
    <div className="panel-card overflow-x-auto p-3">
      <svg ref={svgRef} viewBox={`0 0 ${svgW} ${svgH}`} className="h-[430px] w-full min-w-[680px]">
        <rect x="0" y="0" width={svgW} height={svgH} fill={bg} />

        {gridLines.map((mVal, idx) => {
          const y = groundY - mVal * pxPerM;
          if (y < 24) return null;
          const displayVal = convertFromSi(mVal, "length", unitSystem).toFixed(0);
          return (
            <g key={idx}>
              <line x1="56" y1={y} x2={svgW - 18} y2={y} stroke={gridColor} strokeDasharray="3 4" strokeWidth="0.9" />
              <text x="50" y={y + 4} textAnchor="end" fill={mutedColor} fontSize="12" fontFamily="monospace">
                {displayVal} {unitLabel("length", unitSystem)}
              </text>
            </g>
          );
        })}

        <line x1="54" y1={groundY} x2={svgW - 16} y2={groundY} stroke={textColor} strokeWidth="1.5" />

        {entries.map((item, idx) => {
          const cx = 86 + idx * colW + colW * 0.35;
          const hPx = item.heightM * pxPerM;
          const coreW = Math.max(6, item.coreDiaM * pxPerM);
          const noseH = Math.min(hPx * 0.18, coreW * 2.1);
          const bodyTopY = groundY - hPx + noseH;
          const tipY = groundY - hPx;
          const fill = item.isActive ? "#0284c7" : isBp ? "#1e293b" : "#334155";
          const stroke = item.isActive ? "#38bdf8" : isBp ? "#cbd5e1" : "#0f172a";

          const hStr = `${convertFromSi(item.heightM, "length", unitSystem).toFixed(1)} ${unitLabel("length", unitSystem)}`;
          const glowStr = `${Math.round(convertFromSi(item.glowKg, "mass", unitSystem)).toLocaleString("en-US")} ${unitLabel("mass", unitSystem)}`;

          return (
            <g key={item.id}>
              <polygon
                points={`${cx},${tipY} ${cx + coreW * 0.5},${bodyTopY} ${cx - coreW * 0.5},${bodyTopY}`}
                fill={fill}
                stroke={stroke}
                strokeWidth="1.2"
              />
              <rect
                x={cx - coreW * 0.5}
                y={bodyTopY}
                width={coreW}
                height={Math.max(8, hPx - noseH)}
                fill={fill}
                stroke={stroke}
                strokeWidth="1.2"
              />
              {item.maxWidthM > item.coreDiaM * 1.15 && (
                <>
                  <rect
                    x={cx - coreW * 0.9}
                    y={groundY - hPx * 0.52}
                    width={Math.max(4, coreW * 0.36)}
                    height={hPx * 0.5}
                    rx={2}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth="1"
                  />
                  <rect
                    x={cx + coreW * 0.54}
                    y={groundY - hPx * 0.52}
                    width={Math.max(4, coreW * 0.36)}
                    height={hPx * 0.5}
                    rx={2}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth="1"
                  />
                </>
              )}

              <text x={cx} y={tipY - 7} textAnchor="middle" fill={item.isActive ? "#38bdf8" : textColor} fontSize="12" fontFamily="monospace" fontWeight={item.isActive ? "bold" : "normal"}>
                {hStr}
              </text>
              <text x={cx} y={groundY + 16} textAnchor="middle" fill={item.isActive ? "#38bdf8" : textColor} fontSize="12" fontWeight="600">
                {item.label.slice(0, 16)}
              </text>
              <text x={cx} y={groundY + 32} textAnchor="middle" fill={mutedColor} fontSize="12" fontFamily="monospace">
                GLOW {glowStr}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
