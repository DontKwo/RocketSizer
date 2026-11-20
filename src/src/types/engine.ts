import type { ProvenanceValue } from "./provenance";

export type PropulsionType = "liquid" | "solid";

export type PropellantType =
  | "lox_rp1"
  | "lox_lh2"
  | "lox_ch4"
  | "solid_htpb"
  | "hypergolic_nto_udmh";

export type EngineCycle =
  | "gas_generator"
  | "staged_combustion"
  | "full_flow_staged_combustion"
  | "expander"
  | "electric_pump"
  | "pressure_fed"
  | "solid_motor";

export interface ProvenanceEngine {
  id: ProvenanceValue<string>;
  name: ProvenanceValue<string>;
  manufacturer: ProvenanceValue<string>;
  country: ProvenanceValue<string>;
  status: ProvenanceValue<string>;
  propulsion_type: ProvenanceValue<PropulsionType>;
  propellant: ProvenanceValue<PropellantType>;
  cycle: ProvenanceValue<EngineCycle>;
  oxidizer_fuel_ratio: ProvenanceValue<number>;
  thrust_sl_n: ProvenanceValue<number>;
  thrust_vac_n: ProvenanceValue<number>;
  isp_sl_s: ProvenanceValue<number>;
  isp_vac_s: ProvenanceValue<number>;
  isp_avg_s: ProvenanceValue<number>;
  mass_flow_rate_kg_s: ProvenanceValue<number>;
  chamber_pressure_bar: ProvenanceValue<number>;
  expansion_ratio: ProvenanceValue<number>;
  min_throttle_pct: ProvenanceValue<number>;
  max_throttle_pct: ProvenanceValue<number>;
  restarts_rated: ProvenanceValue<number>;
  dry_mass_kg: ProvenanceValue<number>;
  height_m: ProvenanceValue<number>;
  nozzle_diameter_m: ProvenanceValue<number>;
  gimbal_envelope_dia_m: ProvenanceValue<number>;
  tvc_gimbal_range_deg: ProvenanceValue<number>;
  thrust_to_weight_vac: ProvenanceValue<number>;
  unit_cost_usd: ProvenanceValue<number>;
  development_cost_usd: ProvenanceValue<number>;
  propellant_mass_kg?: ProvenanceValue<number> | null;
  total_mass_kg?: ProvenanceValue<number> | null;
  burn_time_s?: ProvenanceValue<number> | null;
}
