import React, { useMemo, useRef, useState } from "react";
import { convertFromSi, unitLabel, type UnitSystem } from "../config/units";
import type { VehicleSizingResult } from "../types/sizing";
import type { ProvenanceVehicle } from "../types/vehicle";
import { ScaleLineup } from "../components/visualizers/ScaleLineup";

interface ScaleLineupViewProps {
  activeResult: VehicleSizingResult | null;
  activeLabel: string;
  heritageVehicles: ProvenanceVehicle[];
  unitSystem: UnitSystem;
}

function classifyVehicle(leoPayloadKg: number): "Small" | "Medium" | "Heavy" | "Super Heavy" {
  if (leoPayloadKg < 2500) return "Small";
  if (leoPayloadKg < 20000) return "Medium";
  if (leoPayloadKg <= 50000) return "Heavy";
  return "Super Heavy";
}

export function ScaleLineupView({
  activeResult,
  activeLabel,
  heritageVehicles,
  unitSystem,
}: ScaleLineupViewProps): React.ReactElement {
  const [selectedIds, setSelectedIds] = useState<string[]>([
    "electron",
    "falcon_9_ft",
    "vulcan_or_ariane5" in heritageVehicles ? "ariane_5" : "falcon_heavy",
    "saturn_v",
    "starship",
  ]);
  const [themeMode, setThemeMode] = useState<"blueprint" | "presentation">("blueprint");
  const svgRef = useRef<SVGSVGElement | null>(null);

  const grouped = useMemo(() => {
    const map: Record<"Small" | "Medium" | "Heavy" | "Super Heavy", ProvenanceVehicle[]> = {
      Small: [],
      Medium: [],
      Heavy: [],
      "Super Heavy": [],
    };
    for (const v of heritageVehicles) {
      map[classifyVehicle(v.payload_leo_kg.value)].push(v);
    }
    return map;
  }, [heritageVehicles]);

  const toggleVehicle = (id: string): void => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleAutoMatch = (): void => {
    if (!activeResult) return;
    const targetPayload = activeResult.payload_mass_kg;
    const targetGlow = activeResult.glow_kg;
    const ranked = [...heritageVehicles].sort((a, b) => {
      const scoreA =
        Math.abs(a.payload_leo_kg.value - targetPayload) / Math.max(targetPayload, 1000) +
        Math.abs(a.glow_kg.value - targetGlow) / Math.max(targetGlow, 10000);
      const scoreB =
        Math.abs(b.payload_leo_kg.value - targetPayload) / Math.max(targetPayload, 1000) +
        Math.abs(b.glow_kg.value - targetGlow) / Math.max(targetGlow, 10000);
      return scoreA - scoreB;
    });
    setSelectedIds(ranked.slice(0, 5).map((v) => v.id.value));
  };

  const handleExportSvg = (): void => {
    const svg = svgRef.current;
    if (!svg) return;
    const serializer = new XMLSerializer();
    const content = serializer.serializeToString(svg);
    const blob = new Blob([content], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rocket_scale_lineup.svg";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="panel-card flex flex-wrap items-center justify-between gap-2 p-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-sky-300">
            Calibrated Multi-Vehicle Scale Comparison
          </h2>
          <p className="text-[11px] text-slate-400">
            Select heritage launch vehicles across payload classes to compare physical envelopes against your active rocket.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button id="scale_lineup.auto_match_btn" type="button" onClick={handleAutoMatch} title="Automatically select the closest reference heritage vehicle by GLOW and thrust for visual comparison" className="btn-secondary px-2.5 py-1.5 text-xs">
            Auto-Match Closest
          </button>
          <button id="scale_lineup.theme_toggle" type="button" onClick={() => setThemeMode((m) => (m === "blueprint" ? "presentation" : "blueprint"))} title="Switch the scale lineup chart between Blueprint grid and clean Presentation styling" className="btn-secondary px-2.5 py-1.5 text-xs">
            Theme: {themeMode === "blueprint" ? "Blueprint" : "Presentation"}
          </button>
          <button id="scale_lineup.export_svg_btn" type="button" onClick={handleExportSvg} title="Download the side-by-side vehicle scale comparison diagram as a vector SVG file" className="btn-primary px-2.5 py-1.5 text-xs">
            Export Lineup SVG
          </button>
        </div>
      </div>

      <ScaleLineup
        activeResult={activeResult}
        activeLabel={activeLabel}
        heritageVehicles={heritageVehicles}
        selectedIds={selectedIds}
        themeMode={themeMode}
        unitSystem={unitSystem}
        svgRef={svgRef}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {(["Small", "Medium", "Heavy", "Super Heavy"] as const).map((cls) => (
          <div key={cls} className="panel-card space-y-1.5 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-200">
              {cls} Class
            </div>
            <div className="space-y-1">
              {grouped[cls].map((v) => {
                const checked = selectedIds.includes(v.id.value);
                return (
                  <label key={v.id.value} className="flex cursor-pointer items-center justify-between gap-2 rounded px-1.5 py-1 text-xs hover:bg-slate-800/60">
                    <span className="flex min-w-0 items-center gap-2 truncate text-slate-300">
                      <input data-testid="scale_lineup.vehicle_checkbox" type="checkbox" checked={checked} onChange={() => toggleVehicle(v.id.value)} />
                      <span className="truncate">{v.name.value} {v.variant.value}</span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap font-mono text-xs text-slate-400">
                      {convertFromSi(v.total_height_m.value, "length", unitSystem).toFixed(0)} {unitLabel("length", unitSystem)}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
