import React from "react";
import { DEFAULT_ADVANCED_MODEL_DEFAULTS } from "../../config/formatters";
import { convertFromSi, convertToSi, unitLabel, type UnitSystem } from "../../config/units";
import type { AdvancedModelDefaults, VehicleConfiguration } from "../../types/sizing";

interface AdvancedDefaultsPanelProps {
  config: VehicleConfiguration;
  onChangeConfig: (next: VehicleConfiguration) => void;
  unitSystem: UnitSystem;
}

export const AdvancedDefaultsPanel: React.FC<AdvancedDefaultsPanelProps> = ({
  config,
  onChangeConfig,
  unitSystem,
}) => {
  const adv: AdvancedModelDefaults = config.advanced_defaults ?? DEFAULT_ADVANCED_MODEL_DEFAULTS;

  const updateAdv = (patch: Partial<AdvancedModelDefaults>): void => {
    onChangeConfig({
      ...config,
      advanced_defaults: { ...adv, ...patch },
    });
  };

  return (
    <div className="surface-card p-3 space-y-3 border border-slate-700/80">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-300">
            Advanced Physics, Structural, Packing & Cost Model Defaults
          </h4>
          <p className="text-xs text-slate-400">
            All structural tank equations, staging separation parameters, TVC packing clearances, and CER cost rates can be tuned here.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChangeConfig({ ...config, advanced_defaults: { ...DEFAULT_ADVANCED_MODEL_DEFAULTS } })}
          title="Restore all physics, structural, packing, and cost constants to heritage defaults"
          className="btn-secondary text-xs px-2.5 py-1"
        >
          Reset Model Defaults
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
        <div className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 shadow-sm">
          <div className="min-h-[2rem] flex items-center">
            <label className="text-[11px] font-semibold text-slate-300 leading-tight" title="Tank head ullage gas pressure (Pa -> psi/kPa)">
              Ullage Pressure ({unitLabel("pressure", unitSystem)})
            </label>
          </div>
          <input
            type="number"
            step={1}
            value={Number(convertFromSi(adv.ullage_pressure_pa, "pressure", unitSystem).toFixed(1))}
            onChange={(e) =>
              updateAdv({ ullage_pressure_pa: Math.max(50_000, convertToSi(Number(e.target.value) || 0, "pressure", unitSystem)) })
            }
            className="input-field mt-1.5 w-full font-mono text-xs"
          />
        </div>
        <div className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 shadow-sm">
          <div className="min-h-[2rem] flex items-center">
            <label className="text-[11px] font-semibold text-slate-300 leading-tight" title="Empty dome volume allowance inside propellant tanks (%)">
              Tank Ullage Volume (%)
            </label>
          </div>
          <input
            type="number"
            step={0.5}
            min={0.5}
            max={15}
            value={Number((adv.ullage_volume_frac * 100).toFixed(1))}
            onChange={(e) =>
              updateAdv({ ullage_volume_frac: Math.max(0.005, Math.min(0.15, (Number(e.target.value) || 3) / 100)) })
            }
            className="input-field mt-1.5 w-full font-mono text-xs"
          />
        </div>
        <div className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 shadow-sm">
          <div className="min-h-[2rem] flex items-center">
            <label className="text-[11px] font-semibold text-slate-300 leading-tight" title="Yield-to-burst hoop wall thickness safety factor (NASA Std 1.40)">
              Burst Safety Factor
            </label>
          </div>
          <input
            type="number"
            step={0.05}
            min={1.05}
            max={2.5}
            value={Number(adv.burst_safety_factor.toFixed(2))}
            onChange={(e) =>
              updateAdv({ burst_safety_factor: Math.max(1.05, Math.min(2.5, Number(e.target.value) || 1.4)) })
            }
            className="input-field mt-1.5 w-full font-mono text-xs"
          />
        </div>
        <div className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 shadow-sm">
          <div className="min-h-[2rem] flex items-center">
            <label className="text-[11px] font-semibold text-slate-300 leading-tight" title="NASA SP-8007 cylindrical shell buckling knockdown factor">
              Buckling Knockdown
            </label>
          </div>
          <input
            type="number"
            step={0.02}
            min={0.1}
            max={0.9}
            value={Number(adv.buckling_knockdown_gamma.toFixed(2))}
            onChange={(e) =>
              updateAdv({ buckling_knockdown_gamma: Math.max(0.1, Math.min(0.9, Number(e.target.value) || 0.38)) })
            }
            className="input-field mt-1.5 w-full font-mono text-xs"
          />
        </div>
        <div className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 shadow-sm">
          <div className="min-h-[2rem] flex items-center">
            <label className="text-[11px] font-semibold text-slate-300 leading-tight" title="Cold separation coast & propellant settling ullage impulse duration (s)">
              Cold Ullage Time (s)
            </label>
          </div>
          <input
            type="number"
            step={0.5}
            min={0}
            max={20}
            value={Number(adv.cold_sep_ullage_s.toFixed(1))}
            onChange={(e) =>
              updateAdv({ cold_sep_ullage_s: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })
            }
            className="input-field mt-1.5 w-full font-mono text-xs"
          />
        </div>
        <div className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 shadow-sm">
          <div className="min-h-[2rem] flex items-center">
            <label className="text-[11px] font-semibold text-slate-300 leading-tight" title="Pusher/pneumatic interstage hardware mass per separation">
              Cold Interstage ({unitLabel("mass", unitSystem)})
            </label>
          </div>
          <input
            type="number"
            step={10}
            min={0}
            value={Math.round(convertFromSi(adv.cold_interstage_mass_kg, "mass", unitSystem))}
            onChange={(e) =>
              updateAdv({ cold_interstage_mass_kg: Math.max(0, convertToSi(Number(e.target.value) || 0, "mass", unitSystem)) })
            }
            className="input-field mt-1.5 w-full font-mono text-xs"
          />
        </div>
        <div className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 shadow-sm">
          <div className="min-h-[2rem] flex items-center">
            <label className="text-[11px] font-semibold text-slate-300 leading-tight" title="Vented hot-staging thermal blast ring mass per separation">
              Hot-Stage Ring ({unitLabel("mass", unitSystem)})
            </label>
          </div>
          <input
            type="number"
            step={25}
            min={0}
            value={Math.round(convertFromSi(adv.hot_staging_ring_mass_kg, "mass", unitSystem))}
            onChange={(e) =>
              updateAdv({ hot_staging_ring_mass_kg: Math.max(0, convertToSi(Number(e.target.value) || 0, "mass", unitSystem)) })
            }
            className="input-field mt-1.5 w-full font-mono text-xs"
          />
        </div>
        <div className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 shadow-sm">
          <div className="min-h-[2rem] flex items-center">
            <label className="text-[11px] font-semibold text-slate-300 leading-tight" title="Wright manufacturing learning curve slope per doubling of units (%)">
              Learning Curve (%)
            </label>
          </div>
          <input
            type="number"
            step={1}
            min={65}
            max={99}
            value={Math.round(adv.learning_rate * 100)}
            onChange={(e) =>
              updateAdv({ learning_rate: Math.max(0.65, Math.min(0.99, (Number(e.target.value) || 85) / 100)) })
            }
            className="input-field mt-1.5 w-full font-mono text-xs"
          />
        </div>
        <div className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 shadow-sm">
          <div className="min-h-[2rem] flex items-center">
            <label className="text-[11px] font-semibold text-slate-300 leading-tight" title="Base pad campaign operations cost per launch ($M)">
              Launch Ops Base ($M)
            </label>
          </div>
          <input
            type="number"
            step={0.1}
            min={0}
            value={Number((adv.launch_ops_base_usd / 1e6).toFixed(2))}
            onChange={(e) =>
              updateAdv({ launch_ops_base_usd: Math.max(0, (Number(e.target.value) || 0) * 1e6) })
            }
            className="input-field mt-1.5 w-full font-mono text-xs"
          />
        </div>
        <div className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 shadow-sm">
          <div className="min-h-[2rem] flex items-center">
            <label className="text-[11px] font-semibold text-slate-300 leading-tight" title="Range safety, telemetry, and Eastern/Western Range fee per launch ($M)">
              Range Fee ($M/flt)
            </label>
          </div>
          <input
            type="number"
            step={0.1}
            min={0}
            value={Number((adv.range_fee_usd / 1e6).toFixed(2))}
            onChange={(e) =>
              updateAdv({ range_fee_usd: Math.max(0, (Number(e.target.value) || 0) * 1e6) })
            }
            className="input-field mt-1.5 w-full font-mono text-xs"
          />
        </div>
        <div className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 shadow-sm">
          <div className="min-h-[2rem] flex items-center">
            <label className="text-[11px] font-semibold text-slate-300 leading-tight" title="Default TVC engine gimbal deflection angle for base packing">
              Packing TVC Angle (deg)
            </label>
          </div>
          <input
            type="number"
            step={0.5}
            min={0}
            max={20}
            value={Number(adv.tvc_angle_deg.toFixed(1))}
            onChange={(e) =>
              updateAdv({ tvc_angle_deg: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })
            }
            className="input-field mt-1.5 w-full font-mono text-xs"
          />
        </div>
        <div className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 shadow-sm">
          <div className="min-h-[2rem] flex items-center">
            <label className="text-[11px] font-semibold text-slate-300 leading-tight" title="Minimum nozzle-to-nozzle non-contact margin at max gimbal">
              No-Touch Margin ({unitLabel("small_length", unitSystem)})
            </label>
          </div>
          <input
            type="number"
            step={0.25}
            min={0}
            value={Number(convertFromSi(adv.no_touch_margin_m, "small_length", unitSystem).toFixed(2))}
            onChange={(e) =>
              updateAdv({ no_touch_margin_m: Math.max(0, convertToSi(Number(e.target.value) || 0, "small_length", unitSystem)) })
            }
            className="input-field mt-1.5 w-full font-mono text-xs"
          />
        </div>
        <div className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 shadow-sm">
          <div className="min-h-[2rem] flex items-center">
            <label className="text-[11px] font-semibold text-slate-300 leading-tight" title="Radial gap between outer gimballed nozzles and inner boat-tail skirt wall">
              Skirt Clearance ({unitLabel("small_length", unitSystem)})
            </label>
          </div>
          <input
            type="number"
            step={0.25}
            min={0}
            value={Number(convertFromSi(adv.skirt_clearance_m, "small_length", unitSystem).toFixed(2))}
            onChange={(e) =>
              updateAdv({ skirt_clearance_m: Math.max(0, convertToSi(Number(e.target.value) || 0, "small_length", unitSystem)) })
            }
            className="input-field mt-1.5 w-full font-mono text-xs"
          />
        </div>
        <div className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 shadow-sm">
          <div className="min-h-[2rem] flex items-center">
            <label className="text-[11px] font-semibold text-slate-300 leading-tight" title="Structural thrust skirt wall thickness subtracted from core OD">
              Skirt Wall ({unitLabel("small_length", unitSystem)})
            </label>
          </div>
          <input
            type="number"
            step={0.1}
            min={0.1}
            value={Number(convertFromSi(adv.skirt_wall_thickness_m, "small_length", unitSystem).toFixed(2))}
            onChange={(e) =>
              updateAdv({ skirt_wall_thickness_m: Math.max(0.005, convertToSi(Number(e.target.value) || 0, "small_length", unitSystem)) })
            }
            className="input-field mt-1.5 w-full font-mono text-xs"
          />
        </div>
        <div className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 shadow-sm">
          <div className="min-h-[2rem] flex items-center">
            <label className="text-[11px] font-semibold text-slate-300 leading-tight" title="Ratio of gimbal-pivot-to-exit lever arm vs nozzle exit diameter">
              Gimbal Arm Ratio (L/D)
            </label>
          </div>
          <input
            type="number"
            step={0.05}
            min={0.2}
            max={2.0}
            value={Number(adv.gimbal_lever_arm_ratio.toFixed(2))}
            onChange={(e) =>
              updateAdv({ gimbal_lever_arm_ratio: Math.max(0.2, Math.min(2.0, Number(e.target.value) || 0.85)) })
            }
            className="input-field mt-1.5 w-full font-mono text-xs"
          />
        </div>
      </div>
    </div>
  );
};
