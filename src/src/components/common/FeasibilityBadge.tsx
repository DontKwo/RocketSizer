import React, { useRef, useState } from "react";
import { buildConstraintCheckItems, type ConstraintCheckItem } from "../../config/formatters";
import type { UnitSystem } from "../../config/units";
import type { VehicleConfiguration, VehicleSizingResult } from "../../types/sizing";

interface FeasibilityBadgeProps {
  feasible: boolean;
  label: string;
  result?: VehicleSizingResult | null;
  config?: VehicleConfiguration | null;
  unitSystem: UnitSystem;
  rejectionSummary?: Record<string, number>;
  tooltipTitle?: string;
}

export const FeasibilityBadge: React.FC<FeasibilityBadgeProps> = ({
  feasible,
  label,
  result,
  config,
  unitSystem,
  rejectionSummary,
  tooltipTitle,
}) => {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState<boolean>(false);
  const [pinned, setPinned] = useState<boolean>(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const checks: ConstraintCheckItem[] = result
    ? buildConstraintCheckItems(result, config ?? null, unitSystem)
    : [];
  const failedCount = checks.filter((c) => !c.passed).length;
  const passedCount = checks.filter((c) => c.passed).length;
  const rejectionEntries = rejectionSummary
    ? Object.entries(rejectionSummary).sort((a, b) => b[1] - a[1])
    : [];

  const updatePosition = (): void => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const popWidth = 400;
    const maxLeft = typeof window !== "undefined" ? window.innerWidth - popWidth - 16 : rect.left;
    const left = Math.max(12, Math.min(rect.left, maxLeft));
    const preferBelow = rect.bottom + 340 < (typeof window !== "undefined" ? window.innerHeight : 900);
    const top = preferBelow ? rect.bottom + 6 : Math.max(12, rect.top - 330);
    setCoords({ top, left });
  };

  const handleEnter = (): void => {
    updatePosition();
    setOpen(true);
  };

  const handleLeave = (): void => {
    if (!pinned) setOpen(false);
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
    updatePosition();
    if (pinned) {
      setPinned(false);
      setOpen(false);
    } else {
      setPinned(true);
      setOpen(true);
    }
  };

  return (
    <span className="inline-flex items-center">
      <button
        ref={triggerRef}
        type="button"
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onFocus={handleEnter}
        onBlur={handleLeave}
        onClick={handleClick}
        title={tooltipTitle ?? "Hover or click to inspect all failed & passed engineering constraint checks"}
        className={`badge cursor-pointer transition hover:opacity-90 ${
          feasible ? "badge-emerald" : "badge-amber"
        }`}
      >
        {label}
      </button>

      {open && (
        <div
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => {
            if (!pinned) setOpen(false);
          }}
          style={{
            position: "fixed",
            top: `${coords.top}px`,
            left: `${coords.left}px`,
            width: "25rem",
            maxHeight: "22rem",
            zIndex: 9999,
          }}
          className="surface-card border border-slate-600 shadow-lg p-3 overflow-y-auto text-left"
        >
          <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-700">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Constraint Check Audit
              </div>
              {checks.length > 0 && (
                <div className="text-[11px] text-slate-400">
                  {failedCount > 0 ? (
                    <span className="text-rose-300 font-semibold">{failedCount} Failed</span>
                  ) : (
                    <span className="text-emerald-300 font-semibold">0 Failed</span>
                  )}
                  {" / "}
                  <span className="text-emerald-300">{passedCount} Passed</span>
                </div>
              )}
            </div>
            {pinned && (
              <button
                type="button"
                onClick={(ev) => {
                  ev.stopPropagation();
                  setPinned(false);
                  setOpen(false);
                }}
                title="Close constraint breakdown"
                className="btn-secondary text-[11px] px-2 py-0.5"
              >
                Close
              </button>
            )}
          </div>

          {checks.length > 0 ? (
            <div className="space-y-1.5">
              {checks.map((chk) => (
                <div
                  key={chk.id}
                  className={`p-1.5 rounded border text-xs ${
                    chk.passed
                      ? "bg-emerald-950/35 border-emerald-800/60"
                      : "bg-rose-950/50 border-rose-700"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-semibold ${chk.passed ? "text-emerald-300" : "text-rose-300"}`}>
                      {chk.passed ? "PASS" : "FAIL"}: {chk.label}
                    </span>
                    <span className="font-mono text-[11px] text-slate-200">
                      {chk.actualStr}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 mt-0.5">
                    <span>{chk.detail}</span>
                    <span className="font-mono text-slate-300">Limit: {chk.limitStr}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-300">
              {tooltipTitle ?? "Evaluate a configuration to inspect detailed checks."}
            </p>
          )}

          {rejectionEntries.length > 0 && (
            <div className="mt-2 pt-2 border-t border-slate-700">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-amber-300 mb-1">
                Rejected Sweep Candidates Breakdown
              </div>
              <div className="grid grid-cols-2 gap-1 text-[11px]">
                {rejectionEntries.slice(0, 8).map(([key, count]) => (
                  <div key={key} className="flex justify-between gap-2 px-1.5 py-0.5 rounded bg-slate-900/70">
                    <span className="text-slate-300 truncate">{key}</span>
                    <span className="font-mono text-amber-300">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </span>
  );
};
