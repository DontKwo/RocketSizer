import React, { useEffect, useMemo } from "react";
import { computeDynamicConstraintDefaults } from "../../config/formatters";
import { convertFromSi, convertToSi, unitLabel, type UnitQuantity, type UnitSystem } from "../../config/units";
import type { ConstraintEnvelope, VehicleConfiguration } from "../../types/sizing";

interface ConstraintOverridePanelProps {
  config: VehicleConfiguration;
  onChangeConfig: (next: VehicleConfiguration) => void;
  unitSystem: UnitSystem;
  autoDefaults: boolean;
  onChangeAutoDefaults: (next: boolean) => void;
}

type NumericKey = Exclude<
  {
    [K in keyof ConstraintEnvelope]-?: NonNullable<ConstraintEnvelope[K]> extends number ? K : never;
  }[keyof ConstraintEnvelope],
  never | undefined
>;

interface FieldSpec {
  key: NumericKey;
  label: string;
  quantity: UnitQuantity | "usd_m" | "pct" | null;
  step: number;
  tooltip: string;
  fallbackValue?: number;
}

const FIELDS: FieldSpec[] = [
  { key: "max_cost_usd", label: "Max Flight Cost ($M)", quantity: "usd_m", step: 10, tooltip: "Maximum allowable single-flight launch cost." },
  { key: "max_core_diameter_m", label: "Max Core Diameter", quantity: "length", step: 0.5, tooltip: "Maximum first-stage core tank outer diameter." },
  { key: "max_total_height_m", label: "Max Vehicle Height", quantity: "length", step: 5, tooltip: "Maximum stacked vehicle height including fairing." },
  { key: "max_g_limit", label: "Max Acceleration (g)", quantity: null, step: 0.5, tooltip: "Maximum axial structural acceleration allowed during ascent." },
  { key: "max_core_engines", label: "Max Core Engines", quantity: null, step: 1, tooltip: "Maximum engine count mounted on the first-stage core." },
  { key: "max_upper_engines", label: "Max Upper-Stage Engines", quantity: null, step: 1, tooltip: "Maximum engine count mounted on upper stages." },
  { key: "min_liftoff_tw0", label: "Min Liftoff T/W0", quantity: null, step: 0.02, tooltip: "Minimum sea-level thrust-to-weight ratio at liftoff." },
  { key: "max_liftoff_tw0", label: "Max Liftoff T/W0", quantity: null, step: 0.05, tooltip: "Maximum sea-level thrust-to-weight ratio at liftoff." },
  { key: "min_core_only_tw0", label: "Min Core-Only T/W0", quantity: null, step: 0.02, tooltip: "Minimum core stage thrust-to-weight ratio before booster contribution." },
  { key: "max_core_only_tw0", label: "Max Core-Only T/W0", quantity: null, step: 0.05, tooltip: "Maximum core stage thrust-to-weight ratio before booster contribution." },
  { key: "min_upper_tw0", label: "Min Stage 2 T/W0", quantity: null, step: 0.02, tooltip: "Minimum Stage 2 vacuum thrust-to-weight ratio at staging." },
  { key: "max_upper_tw0", label: "Max Stage 2 T/W0", quantity: null, step: 0.05, tooltip: "Maximum Stage 2 vacuum thrust-to-weight ratio at staging." },
  { key: "min_stage3_tw0", label: "Min Stage 3 T/W0", quantity: null, step: 0.02, tooltip: "Minimum Stage 3 vacuum thrust-to-weight ratio at ignition." },
  { key: "max_stage3_tw0", label: "Max Stage 3 T/W0", quantity: null, step: 0.05, tooltip: "Maximum Stage 3 vacuum thrust-to-weight ratio at ignition." },
  {
    key: "min_payload_frac",
    label: "Min Payload Fraction (%)",
    quantity: "pct",
    step: 0.1,
    tooltip: "Minimum payload-to-GLOW ratio; inversely sets maximum allowed GLOW.",
  },
  {
    key: "max_payload_frac",
    label: "Max Payload Fraction (%)",
    quantity: "pct",
    step: 0.5,
    tooltip: "Maximum payload-to-GLOW ratio; inversely sets minimum realistic GLOW.",
  },
  { key: "min_strapon_count", label: "Min Strap-On Count", quantity: null, step: 1, tooltip: "Minimum allowed side boosters." },
  { key: "max_strapon_count", label: "Max Strap-On Count", quantity: null, step: 1, tooltip: "Maximum allowed side boosters." },
  { key: "max_slenderness_ld", label: "Max Slenderness (L/D)", quantity: null, step: 1, tooltip: "Maximum overall height-to-diameter buckling/aero slenderness ratio." },
  {
    key: "mf_lox_rp1",
    label: "Stage Mass Fraction LOX / RP-1",
    quantity: null,
    step: 0.005,
    tooltip: "Propellant mass divided by (propellant + dry) stage mass for kerolox stages.",
    fallbackValue: 0.905,
  },
  {
    key: "mf_lox_ch4",
    label: "Stage Mass Fraction LOX / LCH4",
    quantity: null,
    step: 0.005,
    tooltip: "Propellant mass divided by (propellant + dry) stage mass for methalox stages.",
    fallbackValue: 0.94,
  },
  {
    key: "mf_lox_lh2",
    label: "Stage Mass Fraction LOX / LH2",
    quantity: null,
    step: 0.005,
    tooltip: "Propellant mass divided by (propellant + dry) stage mass for hydrolox stages.",
    fallbackValue: 0.925,
  },
  {
    key: "mf_solid",
    label: "Stage Mass Fraction Solid",
    quantity: null,
    step: 0.005,
    tooltip: "Propellant mass divided by total casing+propellant mass for solid motors.",
    fallbackValue: 0.88,
  },
];

function toDisplay(value: number | null, quantity: FieldSpec["quantity"], unitSystem: UnitSystem): string {
  if (value === null || value === undefined) return "";
  if (quantity === "usd_m") return String(Math.round(value / 1e6));
  if (quantity === "pct") return String(Number((value * 100).toFixed(2)));
  if (quantity) return String(Math.round(convertFromSi(value, quantity, unitSystem) * 100) / 100);
  return String(Number(value.toFixed(3)));
}

function fromDisplay(text: string, quantity: FieldSpec["quantity"], unitSystem: UnitSystem): number | null {
  if (text.trim() === "") return null;
  const num = Number(text);
  if (!Number.isFinite(num)) return null;
  if (quantity === "usd_m") return num * 1e6;
  if (quantity === "pct") return num / 100;
  if (quantity) return convertToSi(num, quantity, unitSystem);
  return num;
}

export function ConstraintOverridePanel({
  config,
  onChangeConfig,
  unitSystem,
  autoDefaults,
  onChangeAutoDefaults,
}: ConstraintOverridePanelProps): React.ReactElement {
  const preset = useMemo(
    () => computeDynamicConstraintDefaults(config),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      config.payload_mass_kg,
      config.orbit.altitude_m,
      config.orbit.apogee_altitude_m,
      config.required_delta_v_m_s,
      config.stages[0]?.recovery_mode,
    ]
  );

  useEffect(() => {
    if (!autoDefaults) return;
    if (JSON.stringify(preset.constraints) === JSON.stringify(config.constraints)) return;
    onChangeConfig({ ...config, constraints: preset.constraints, g_limit: preset.constraints.max_g_limit });
  }, [autoDefaults, preset, config, onChangeConfig]);

  const massUnit = unitLabel("mass", unitSystem);
  const lenUnit = unitLabel("length", unitSystem);

  const labelFor = (spec: FieldSpec): string => {
    if (spec.key === "min_payload_frac") {
      const frac = config.constraints.min_payload_frac ?? preset.constraints.min_payload_frac;
      const equivGlow = frac && frac > 0 ? config.payload_mass_kg / frac : config.constraints.max_glow_kg;
      if (equivGlow !== null && equivGlow > 0) {
        const disp = Math.round(convertFromSi(equivGlow, "mass", unitSystem)).toLocaleString("en-US");
        return `${spec.label} (<= ${disp} ${massUnit} GLOW)`;
      }
      return spec.label;
    }
    if (spec.key === "max_payload_frac") {
      const frac = config.constraints.max_payload_frac ?? preset.constraints.max_payload_frac;
      const equivGlow = frac && frac > 0 ? config.payload_mass_kg / frac : config.constraints.min_glow_kg;
      if (equivGlow !== null && equivGlow > 0) {
        const disp = Math.round(convertFromSi(equivGlow, "mass", unitSystem)).toLocaleString("en-US");
        return `${spec.label} (>= ${disp} ${massUnit} GLOW)`;
      }
      return spec.label;
    }
    if (spec.quantity === "mass") return `${spec.label} (${massUnit})`;
    if (spec.quantity === "length") return `${spec.label} (${lenUnit})`;
    return spec.label;
  };

  const placeholderFor = (spec: FieldSpec): string => {
    const fallback = (preset.constraints[spec.key] as number | null) ?? spec.fallbackValue ?? null;
    if (fallback !== null) return toDisplay(fallback, spec.quantity, unitSystem);
    return "No limit";
  };

  const handleEdit = (spec: FieldSpec, text: string): void => {
    const parsed = fromDisplay(text, spec.quantity, unitSystem);
    onChangeAutoDefaults(false);
    const next: ConstraintEnvelope = { ...config.constraints, [spec.key]: parsed } as ConstraintEnvelope;
    if (spec.key === "min_payload_frac") {
      next.max_glow_kg = parsed !== null && parsed > 0 ? Math.round(config.payload_mass_kg / parsed) : null;
    } else if (spec.key === "max_payload_frac") {
      next.min_glow_kg = parsed !== null && parsed > 0 ? Math.round(config.payload_mass_kg / parsed) : null;
    }
    onChangeConfig({
      ...config,
      constraints: next,
      g_limit: spec.key === "max_g_limit" && parsed !== null ? parsed : config.g_limit,
    });
  };

  return (
    <div className="space-y-3">
      <label
        className="flex cursor-pointer items-start gap-2 text-xs text-slate-100"
        title="Automatically derive vehicle limits from heritage data for your payload mass, orbit energy, and recovery mode."
      >
        <input
          id="opt.auto_constraints"
          type="checkbox"
          checked={autoDefaults}
          onChange={(e: React.ChangeEvent<HTMLInputElement>): void => onChangeAutoDefaults(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          <span className="font-semibold">Use heritage-based defaults</span>
          <span className="block text-slate-300">
            Limits follow your payload, orbit and recovery inputs. Editing any field switches to manual overrides.
          </span>
        </span>
      </label>
      <div className="rounded-md border border-slate-700 bg-slate-950/60 p-2.5 text-xs text-slate-200">
        <div className="font-semibold text-sky-200">{preset.heritageSource}</div>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-300">
          {preset.rationale.map((line: string) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {FIELDS.map((spec: FieldSpec) => {
          const rawVal = config.constraints[spec.key] as number | null;
          const displaySource =
            spec.key.startsWith("mf_") && rawVal === null
              ? ((preset.constraints[spec.key] as number | null) ?? spec.fallbackValue ?? null)
              : rawVal;
          return (
            <div
              key={spec.key}
              className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 shadow-sm"
            >
              <div className="min-h-[2.25rem] flex items-center">
                <label
                  htmlFor={`opt.constraint_${spec.key}`}
                  className="text-xs font-medium text-slate-200 leading-tight cursor-pointer"
                  title={spec.tooltip}
                >
                  {labelFor(spec)}
                </label>
              </div>
              <input
                id={`opt.constraint_${spec.key}`}
                type="number"
                step={spec.step}
                placeholder={placeholderFor(spec)}
                title={spec.tooltip}
                onWheel={(e: React.WheelEvent<HTMLInputElement>): void => e.currentTarget.blur()}
                value={toDisplay(displaySource, spec.quantity, unitSystem)}
                onChange={(e: React.ChangeEvent<HTMLInputElement>): void => handleEdit(spec, e.target.value)}
                className="input-field mt-1.5 w-full font-mono text-xs"
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-end">
        <button
          id="opt.reset_constraints"
          type="button"
          title="Restore all vehicle constraints and stage mass fractions to heritage defaults."
          onClick={(): void => onChangeAutoDefaults(true)}
          className="btn-secondary px-3 py-1.5 text-xs"
        >
          Reset to Heritage Defaults
        </button>
      </div>
    </div>
  );
}
