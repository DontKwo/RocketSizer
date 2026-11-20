import React, { useMemo, useState } from "react";
import { adjustInflationUsd, convertFromSi, convertToSi, unitLabel, type UnitQuantity, type UnitSystem } from "../config/units";
import { runSensitivitySweep } from "../api/tauriClient";
import type {
  SensitivityCurveResponse,
  SensitivityPoint,
  SizingSweepResponse,
  VehicleConfiguration,
  VehicleSizingResult,
} from "../types/sizing";
import { ParetoFrontierChart, SensitivityCurveChart } from "../components/charts/TradeCharts";
import { FeasibilityBadge } from "../components/common/FeasibilityBadge";

interface SensitivityStudioViewProps {
  config: VehicleConfiguration;
  activeResult: VehicleSizingResult | null;
  sweepResponse: SizingSweepResponse | null;
  unitSystem: UnitSystem;
  currencyYear?: number;
}

interface SweepParamMeta {
  key: string;
  baseLabel: string;
  quantity: UnitQuantity | null;
  defaultMinSi: number;
  defaultMaxSi: number;
}

const SWEEP_PARAMETERS: SweepParamMeta[] = [
  { key: "payload_mass_kg", baseLabel: "Payload Mass", quantity: "mass", defaultMinSi: 5000, defaultMaxSi: 35000 },
  { key: "s1_dv_split", baseLabel: "Stage 1 Delta-V Split Fraction", quantity: null, defaultMinSi: 0.22, defaultMaxSi: 0.52 },
  { key: "core_diameter_m", baseLabel: "Core Stage Diameter", quantity: "length", defaultMinSi: 3.0, defaultMaxSi: 7.0 },
  { key: "required_delta_v_m_s", baseLabel: "Mission Delta-V Requirement", quantity: "velocity", defaultMinSi: 8800, defaultMaxSi: 12800 },
  { key: "dv_margin_pct", baseLabel: "Delta-V Margin (%)", quantity: null, defaultMinSi: 0, defaultMaxSi: 10 },
  { key: "expected_reuses", baseLabel: "Expected Booster Reuses", quantity: null, defaultMinSi: 1, defaultMaxSi: 30 },
];

export function SensitivityStudioView({
  config,
  activeResult,
  sweepResponse,
  unitSystem,
  currencyYear = 2026,
}: SensitivityStudioViewProps): React.ReactElement {
  const [sweepKey, setSweepKey] = useState<string>("payload_mass_kg");
  const [rangeMinSi, setRangeMinSi] = useState<number>(5000);
  const [rangeMaxSi, setRangeMaxSi] = useState<number>(35000);
  const [steps, setSteps] = useState<number>(12);
  const [isSweeping, setIsSweeping] = useState<boolean>(false);
  const [curve, setCurve] = useState<SensitivityCurveResponse | null>(null);

  const activeMeta = useMemo(
    () => SWEEP_PARAMETERS.find((p) => p.key === sweepKey) ?? SWEEP_PARAMETERS[0],
    [sweepKey]
  );

  const formatParamLabel = (meta: SweepParamMeta): string =>
    meta.quantity ? `${meta.baseLabel} (${unitLabel(meta.quantity, unitSystem)})` : meta.baseLabel;

  const toDisplayParam = (valSi: number, quantity: UnitQuantity | null): number =>
    quantity ? convertFromSi(valSi, quantity, unitSystem) : valSi;

  const toSiParam = (valDisplay: number, quantity: UnitQuantity | null): number =>
    quantity ? convertToSi(valDisplay, quantity, unitSystem) : valDisplay;

  const formatParamValue = (val: number, quantity: UnitQuantity | null): string => {
    if (!quantity && Math.abs(val) < 2) return val.toFixed(2);
    if (!quantity) return val.toFixed(0);
    return Math.abs(val) >= 100 ? Math.round(val).toLocaleString("en-US") : val.toFixed(2);
  };

  const formatInputVal = (val: number, quantity: UnitQuantity | null): number =>
    quantity === "mass" || quantity === "velocity"
      ? Math.round(val)
      : quantity
        ? Number(val.toFixed(1))
        : Number(val.toFixed(2));

  const handleParamChange = (nextKey: string): void => {
    setSweepKey(nextKey);
    const meta = SWEEP_PARAMETERS.find((p) => p.key === nextKey);
    if (meta) {
      setRangeMinSi(meta.defaultMinSi);
      setRangeMaxSi(meta.defaultMaxSi);
    }
  };

  const handleRunSweep = async (): Promise<void> => {
    setIsSweeping(true);
    try {
      const resp = await runSensitivitySweep(config, sweepKey, rangeMinSi, rangeMaxSi, steps);
      setCurve(resp);
    } finally {
      setIsSweeping(false);
    }
  };

  React.useEffect(() => {
    void handleRunSweep();
  }, []);

  const displayPoints = useMemo<SensitivityPoint[]>(
    () =>
      (curve?.points ?? []).map((pt) => ({
        ...pt,
        parameter_value: toDisplayParam(pt.parameter_value, activeMeta.quantity),
      })),
    [curve, activeMeta.quantity, unitSystem]
  );

  const downloadBlob = (content: string, mime: string, filename: string): void => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const mUnit = unitLabel("mass", unitSystem);
  const cUnit = unitLabel("cost_per_mass", unitSystem);
  const selectedLabel = formatParamLabel(activeMeta);

  const handleExportCsv = (): void => {
    const header = `parameter_value,glow_${mUnit},dry_mass_${mUnit},reusable_cost_usd,expendable_cost_usd,specific_cost_usd,payload_fraction,liftoff_tw0,feasible\n`;
    const rows = displayPoints
      .map(
        (p) =>
          `${p.parameter_value.toFixed(4)},${convertFromSi(p.glow_kg, "mass", unitSystem).toFixed(1)},${convertFromSi(p.total_dry_mass_kg, "mass", unitSystem).toFixed(1)},${p.reusable_flight_cost_usd.toFixed(0)},${p.expendable_flight_cost_usd.toFixed(0)},${convertFromSi(p.cost_per_kg_usd, "cost_per_mass", unitSystem).toFixed(1)},${p.payload_fraction.toFixed(4)},${p.liftoff_tw0.toFixed(2)},${p.feasible}`
      )
      .join("\n");
    downloadBlob(header + rows, "text/csv;charset=utf-8", `trade_sweep_${sweepKey}.csv`);
  };

  const handleExportMarkdown = (): void => {
    const minDisp = toDisplayParam(rangeMinSi, activeMeta.quantity);
    const maxDisp = toDisplayParam(rangeMaxSi, activeMeta.quantity);
    const lines = [
      `# Trade Study & Sensitivity Report: ${config.name}`,
      `Baseline Payload: ${convertFromSi(config.payload_mass_kg, "mass", unitSystem).toFixed(0)} ${mUnit} | Baseline GLOW: ${convertFromSi(activeResult?.glow_kg ?? 0, "mass", unitSystem).toFixed(0)} ${mUnit}`,
      `Swept Variable: ${selectedLabel} (${formatParamValue(minDisp, activeMeta.quantity)} .. ${formatParamValue(maxDisp, activeMeta.quantity)}, ${steps} steps)`,
      "",
      `| ${selectedLabel} | GLOW (${mUnit}) | Flight Cost ($M) | ${cUnit} | Feasible |`,
      "| --- | --- | --- | --- | --- |",
      ...displayPoints.map(
        (p) =>
          `| ${formatParamValue(p.parameter_value, activeMeta.quantity)} | ${convertFromSi(p.glow_kg, "mass", unitSystem).toFixed(0)} | $${(p.reusable_flight_cost_usd / 1e6).toFixed(2)}M | $${convertFromSi(p.cost_per_kg_usd, "cost_per_mass", unitSystem).toFixed(0)} | ${p.feasible} |`
      ),
    ];
    downloadBlob(lines.join("\n"), "text/markdown;charset=utf-8", `trade_report_${sweepKey}.md`);
  };

  const rangeMinDisplay = toDisplayParam(rangeMinSi, activeMeta.quantity);
  const rangeMaxDisplay = toDisplayParam(rangeMaxSi, activeMeta.quantity);

  return (
    <div className="space-y-3">
      <div className="panel-card flex flex-wrap items-end gap-3 p-3">
        <div>
          <label className="block text-xs text-slate-300">Sweep Parameter</label>
          <select id="sensitivity_studio.sweep_param" value={sweepKey} onChange={(e) => handleParamChange(e.target.value)} className="input-field text-xs">
            {SWEEP_PARAMETERS.map((p) => (
              <option key={p.key} value={p.key}>
                {formatParamLabel(p)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-300">Range Min</label>
          <input
            id="sensitivity_studio.range_min"
            type="number"
            step="any"
            onWheel={(e) => e.currentTarget.blur()}
            value={formatInputVal(rangeMinDisplay, activeMeta.quantity)}
            onChange={(e) => setRangeMinSi(toSiParam(Number(e.target.value) || 0, activeMeta.quantity))}
            className="input-field w-28 font-mono text-xs"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-300">Range Max</label>
          <input
            id="sensitivity_studio.range_max"
            type="number"
            step="any"
            onWheel={(e) => e.currentTarget.blur()}
            value={formatInputVal(rangeMaxDisplay, activeMeta.quantity)}
            onChange={(e) => setRangeMaxSi(toSiParam(Number(e.target.value) || 0, activeMeta.quantity))}
            className="input-field w-28 font-mono text-xs"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-300">Steps</label>
          <input
            id="sensitivity_studio.steps"
            type="number"
            min={3}
            max={50}
            onWheel={(e) => e.currentTarget.blur()}
            value={steps}
            onChange={(e) => setSteps(Math.max(3, Number(e.target.value) || 5))}
            className="input-field w-20 font-mono text-xs"
          />
        </div>

        <button
          id="sensitivity_studio.run_sweep_btn"
          type="button"
          disabled={isSweeping}
          title="Recompute vehicle sizing across every step in the selected parameter range."
          onClick={() => void handleRunSweep()}
          className="btn-primary px-3 py-1.5 text-xs"
        >
          {isSweeping ? "Sweeping..." : "Run Trade Sweep"}
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            id="sensitivity_studio.export_csv_btn"
            type="button"
            title="Download all sweep data points as a CSV spreadsheet."
            onClick={handleExportCsv}
            className="btn-secondary px-2.5 py-1.5 text-xs"
          >
            Export CSV
          </button>
          <button
            id="sensitivity_studio.export_md_btn"
            type="button"
            title="Download a Markdown summary table of this sensitivity trade study."
            onClick={handleExportMarkdown}
            className="btn-secondary px-2.5 py-1.5 text-xs"
          >
            Export Brief (.md)
          </button>
          <button
            id="sensitivity_studio.print_pdf_btn"
            type="button"
            title="Open browser print dialog to print or save a PDF report."
            onClick={() => window.print()}
            className="btn-secondary px-2.5 py-1.5 text-xs"
          >
            Print / PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <SensitivityCurveChart
          points={displayPoints}
          sweepLabel={selectedLabel}
          unitSystem={unitSystem}
        />
        <ParetoFrontierChart
          frontier={sweepResponse?.pareto_frontier ?? []}
          candidates={sweepResponse?.top_candidates ?? []}
          unitSystem={unitSystem}
        />
      </div>

      {displayPoints.length > 0 && (
        <div className="panel-card overflow-x-auto p-3">
          <table className="w-full border-collapse text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="px-2 py-1.5">{selectedLabel}</th>
                <th className="px-2 py-1.5">GLOW ({mUnit})</th>
                <th className="px-2 py-1.5">Dry Mass ({mUnit})</th>
                <th className="px-2 py-1.5">Reusable Cost</th>
                <th className="px-2 py-1.5">Expendable Cost</th>
                <th className="px-2 py-1.5">Payload Frac</th>
                <th className="px-2 py-1.5">T/W0</th>
                <th className="px-2 py-1.5">Feasible</th>
              </tr>
            </thead>
            <tbody>
              {displayPoints.map((pt, idx) => (
                <tr key={idx} className="border-b border-slate-800/60 hover:bg-slate-800/40">
                  <td className="px-2 py-1 text-slate-200">{formatParamValue(pt.parameter_value, activeMeta.quantity)}</td>
                  <td className="px-2 py-1 text-sky-300">
                    {Math.round(convertFromSi(pt.glow_kg, "mass", unitSystem)).toLocaleString("en-US")}
                  </td>
                  <td className="px-2 py-1 text-slate-300">
                    {Math.round(convertFromSi(pt.total_dry_mass_kg, "mass", unitSystem)).toLocaleString("en-US")}
                  </td>
                  <td className="px-2 py-1 text-emerald-300">
                    ${(adjustInflationUsd(pt.reusable_flight_cost_usd, 2026, currencyYear) / 1e6).toFixed(2)}M
                  </td>
                  <td className="px-2 py-1 text-slate-300">
                    ${(adjustInflationUsd(pt.expendable_flight_cost_usd, 2026, currencyYear) / 1e6).toFixed(2)}M
                  </td>
                  <td className="px-2 py-1 text-slate-300">{(pt.payload_fraction * 100).toFixed(2)}%</td>
                  <td className="px-2 py-1 text-slate-300">{pt.liftoff_tw0.toFixed(2)}</td>
                  <td className="px-2 py-1">
                    <FeasibilityBadge
                      feasible={pt.feasible}
                      label={pt.feasible ? "Feasible" : "Violations"}
                      config={config}
                      unitSystem={unitSystem}
                      tooltipTitle={`${selectedLabel} = ${formatParamValue(pt.parameter_value, activeMeta.quantity)} | GLOW ${Math.round(convertFromSi(pt.glow_kg, "mass", unitSystem)).toLocaleString("en-US")} ${mUnit}, T/W0 ${pt.liftoff_tw0.toFixed(2)}, PL ${(pt.payload_fraction * 100).toFixed(2)}%`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
