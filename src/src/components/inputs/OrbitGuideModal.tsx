import React from "react";
import { ORBIT_REGIME_GUIDE, type OrbitRegimeGuideEntry } from "../../config/formatters";
import { convertFromSi, unitLabel, type UnitSystem } from "../../config/units";
import { X } from "../common/Icons";

interface OrbitGuideModalProps {
  unitSystem: UnitSystem;
  onApply: (entry: OrbitRegimeGuideEntry) => void;
  onClose: () => void;
}

const NMI_TO_M = 1852.0;

export function OrbitGuideModal({ unitSystem, onApply, onClose }: OrbitGuideModalProps): React.ReactElement {
  const velUnit = unitLabel("velocity", unitSystem);
  const fmtAlt = (nmi: number): string =>
    unitSystem === "imperial"
      ? `${Math.round(nmi).toLocaleString("en-US")} nmi`
      : `${Math.round((nmi * NMI_TO_M) / 1000).toLocaleString("en-US")} km`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Orbit regime guide"
    >
      <div className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-base font-bold text-sky-300">Orbit Guide</h2>
            <p className="text-xs text-slate-300">
              Typical perigee x apogee altitudes, inclinations and total delta-V for common regimes. Apply copies the values into your orbit inputs.
            </p>
          </div>
          <button
            id="orbit_guide.close"
            type="button"
            onClick={onClose}
            aria-label="Close orbit guide"
            title="Close the Orbit Guide reference table"
            className="rounded p-2 text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-slate-300">
                <th className="px-2 py-2">Regime</th>
                <th className="px-2 py-2">Perigee x Apogee</th>
                <th className="px-2 py-2">Inclination</th>
                <th className="px-2 py-2">Total delta-V ({velUnit})</th>
                <th className="px-2 py-2">Notes</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {ORBIT_REGIME_GUIDE.map((entry) => (
                <tr key={entry.id} className="border-b border-slate-800 align-top">
                  <td className="px-2 py-2 font-semibold text-slate-100">{entry.name}</td>
                  <td className="whitespace-nowrap px-2 py-2 font-mono text-sky-200">
                    {fmtAlt(entry.perigeeNmi)} x {fmtAlt(entry.apogeeNmi)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 font-mono text-slate-100">{entry.inclinationDeg.toFixed(1)} deg</td>
                  <td className="whitespace-nowrap px-2 py-2 font-mono text-amber-200">
                    {Math.round(convertFromSi(entry.nominalDvMs, "velocity", unitSystem)).toLocaleString("en-US")}
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-300">{entry.notes}</td>
                  <td className="px-2 py-2">
                    <button
                      id={`orbit_guide.apply_${entry.id}`}
                      type="button"
                      onClick={() => {
                        onApply(entry);
                        onClose();
                      }}
                      title={`Copy ${entry.name} altitudes, inclination, and nominal delta-V into target orbit inputs`}
                      className="btn-primary px-3 py-1.5 text-xs"
                    >
                      Apply
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
