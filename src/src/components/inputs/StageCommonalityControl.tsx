import React from "react";

interface StageCommonalityControlProps {
  enforceEngineStages: number[];
  enforceFuelStages: number[];
  onChangeEngineStages: (next: number[]) => void;
  onChangeFuelStages: (next: number[]) => void;
}

const STAGE_NUMBERS: number[] = [1, 2, 3];

function toggleStage(list: number[], stage: number): number[] {
  return list.includes(stage) ? list.filter((s) => s !== stage) : [...list, stage].sort();
}

function StageRow({
  title,
  hint,
  selected,
  onToggle,
  idPrefix,
}: {
  title: string;
  hint: string;
  selected: number[];
  onToggle: (stage: number) => void;
  idPrefix: string;
}): React.ReactElement {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold text-slate-100">{title}</div>
      <div className="flex flex-wrap gap-2">
        {STAGE_NUMBERS.map((stage) => {
          const on = selected.includes(stage);
          return (
            <label
              key={stage}
              className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-xs ${
                on ? "border-sky-500 bg-sky-500/15 text-sky-100" : "border-slate-600 bg-slate-900 text-slate-200"
              }`}
            >
              <input
                id={`${idPrefix}_stage_${stage}`}
                type="checkbox"
                checked={on}
                onChange={() => onToggle(stage)}
                className="h-4 w-4"
              />
              Stage {stage}
            </label>
          );
        })}
      </div>
      <p className="text-xs text-slate-400">{hint}</p>
    </div>
  );
}

export function StageCommonalityControl({
  enforceEngineStages,
  enforceFuelStages,
  onChangeEngineStages,
  onChangeFuelStages,
}: StageCommonalityControlProps): React.ReactElement {
  return (
    <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-950/60 p-3">
      <StageRow
        title="Enforce Same Engines Across Stages"
        hint="Checked stages must use the same engine family. Solid strap-on boosters are excluded."
        selected={enforceEngineStages}
        onToggle={(s) => onChangeEngineStages(toggleStage(enforceEngineStages, s))}
        idPrefix="opt.same_engine"
      />
      <StageRow
        title="Enforce Same Fuel Type Across Stages"
        hint="Checked stages must burn the same propellant (for example all LOX / RP-1). Solids are excluded."
        selected={enforceFuelStages}
        onToggle={(s) => onChangeFuelStages(toggleStage(enforceFuelStages, s))}
        idPrefix="opt.same_fuel"
      />
    </div>
  );
}
