import type { PropellantType, ProvenanceEngine } from "./engine";

export type MissionPreset = "leo285" | "leo516" | "sso980" | "gto" | "tli" | "tmi" | "custom";
export type RecoveryMode =
  | "expendable"
  | "downrange_landing_asds"
  | "return_to_launch_site_rtls"
  | "parachute_mid_air_catch";
export type StagingArchitectureMode = "cold_pneumatic_ullage" | "hot_staging_vented_ring";
export type PressurizationMode = "autogenous" | "helium_copv";
export type CryoStateMode = "standard_boiling" | "subcooled_densified";
export type FairingProfile = "von_karman" | "tangent_ogive" | "biconic";
export type TankMaterialPreset =
  | "al_li2195"
  | "cfrp_composite"
  | "stainless304_l"
  | "titanium_ti6_al4_v";
export type OptimizationStrategy =
  | "minimize_glow"
  | "minimize_cost"
  | "balanced_trade"
  | "pareto_frontier";

export interface OrbitTarget {
  preset: MissionPreset;
  altitude_m: number;
  perigee_altitude_m?: number;
  apogee_altitude_m?: number;
  eccentricity?: number;
  inclination_deg: number;
  launch_latitude_deg: number;
  launch_azimuth_deg: number;
  insertion_margin_m_s: number;
  dv_margin_pct?: number;
  coast_duration_s: number;
}

export interface ConstraintEnvelope {
  max_cost_usd: number | null;
  max_glow_kg: number | null;
  min_glow_kg: number | null;
  max_core_diameter_m: number | null;
  max_total_height_m: number | null;
  max_g_limit: number;
  max_core_engines: number;
  max_upper_engines: number;
  allowed_booster_counts: number[];
  min_liftoff_tw0: number;
  max_liftoff_tw0: number;
  min_upper_tw0: number;
  max_upper_tw0: number;
  enforce_base_packing: boolean;
  min_payload_frac: number;
  max_payload_frac: number;
  min_core_only_tw0: number;
  max_core_only_tw0: number;
  min_stage3_tw0: number;
  max_stage3_tw0: number;
  min_strapon_count: number;
  max_strapon_count: number;
  mf_lox_lh2: number | null;
  mf_lox_rp1: number | null;
  mf_lox_ch4: number | null;
  mf_solid: number | null;
  max_slenderness_ld: number | null;
  stage1_allowed_engines?: string[];
  stage2_allowed_engines?: string[];
  stage3_allowed_engines?: string[];
  booster_allowed_engines?: string[];
  stage1_allowed_propellants?: string[];
  stage2_allowed_propellants?: string[];
  stage3_allowed_propellants?: string[];
  stage1_allowed_cycles?: string[];
  stage2_allowed_cycles?: string[];
  stage3_allowed_cycles?: string[];
}

export interface AdvancedModelDefaults {
  ullage_pressure_pa: number;
  ullage_volume_frac: number;
  burst_safety_factor: number;
  buckling_knockdown_gamma: number;
  cold_sep_ullage_s: number;
  cold_interstage_mass_kg: number;
  hot_staging_ring_mass_kg: number;
  learning_rate: number;
  launch_ops_base_usd: number;
  range_fee_usd: number;
  recovery_ops_per_flight_usd: number;
  refurb_cost_frac_override: number | null;
  reusable_ddte_surcharge_frac: number;
  tvc_angle_deg: number;
  no_touch_margin_m: number;
  skirt_clearance_m: number;
  skirt_wall_thickness_m: number;
  gimbal_lever_arm_ratio: number;
}

export interface StageConfig {
  stage_number: number;
  engine_id: string;
  engine_count: number;
  structural_mass_fraction_override: number | null;
  tank_material: TankMaterialPreset;
  pressurization: PressurizationMode;
  common_bulkhead: boolean;
  delta_v_split_frac: number;
  recovery_mode: RecoveryMode;
}

export interface VehicleConfiguration {
  name: string;
  payload_mass_kg: number;
  payload_diameter_m: number;
  payload_length_m: number;
  orbit: OrbitTarget;
  required_delta_v_m_s: number | null;
  core_diameter_m: number;
  stage_count: number;
  booster_engine_id: string | null;
  booster_count: number;
  booster_recovery_mode?: RecoveryMode;
  recovery_optimizer_enabled?: boolean;
  stages: StageConfig[];
  staging_mode: StagingArchitectureMode;
  cryo_state: CryoStateMode;
  fairing_profile: FairingProfile;
  fairing_reusable: boolean;
  mass_margin_frac: number;
  max_q_throttle_frac: number;
  max_q_bucket_duration_s: number;
  g_limit: number;
  expected_reuses: number;
  production_quantity: number;
  constraints: ConstraintEnvelope;
  custom_engines: ProvenanceEngine[];
  advanced_defaults?: AdvancedModelDefaults;
}

export interface TankGeometrySummary {
  radius_m: number;
  dome_height_m: number;
  ox_barrel_length_m: number;
  fuel_barrel_length_m: number;
  stage_tanks_length_m: number;
  wall_thickness_m: number;
  hoop_stress_pa: number;
  buckling_critical_stress_pa: number;
  axial_compressive_stress_pa: number;
  buckling_stiffening_factor: number;
  pressurant_mass_kg: number;
  boiloff_loss_kg: number;
  tank_structural_mass_kg: number;
}

export interface StageStructuralBreakdown {
  ox_wall_thickness_m: number;
  fuel_wall_thickness_m: number;
  ox_tank_barrel_mass_kg: number;
  fuel_tank_barrel_mass_kg: number;
  tank_domes_mass_kg: number;
  baffles_and_slosh_mass_kg: number;
  forward_skirt_mass_kg: number;
  aft_skirt_and_base_shield_mass_kg: number;
  intertank_mass_kg: number;
  interstage_mass_kg: number;
  thrust_structure_mass_kg: number;
  plumbing_and_valves_mass_kg: number;
  pressurization_system_mass_kg: number;
  cryo_insulation_mass_kg: number;
  tvc_and_rcs_mass_kg: number;
  avionics_and_wiring_mass_kg: number;
  payload_adapter_mass_kg: number;
  fasteners_and_joints_mass_kg: number;
  solid_casing_and_nozzle_mass_kg: number;
  engines_mass_kg: number;
  recovery_hardware_kg: number;
  strapon_inert_kg: number;
  predicted_structure_only_unmargined_kg: number;
  predicted_dry_unmargined_kg: number;
  margin_reserve_kg: number;
  predicted_dry_margined_kg: number;
  predicted_pmf_unmargined: number;
  predicted_pmf_margined: number;
}

export interface StageSizingMetrics {
  stage_number: number;
  engine_id: string;
  engine_name: string;
  propellant: PropellantType;
  engine_count: number;
  strapon_engine_id: string | null;
  strapon_engine_name?: string | null;
  strapon_count: number;
  m0_kg: number;
  stage_total_mass_kg: number;
  propellant_mass_kg: number;
  ascent_propellant_kg: number;
  recovery_propellant_kg: number;
  strapon_propellant_kg: number;
  m_liquid_prop_kg?: number;
  m_liquid_burned_boost_kg?: number;
  m_boost_burnout_kg?: number;
  m0_core_only_kg?: number;
  m_core_burnout_kg?: number;
  inert_mass_kg: number;
  m_inert_unmargined_kg?: number;
  engines_mass_kg: number;
  strapon_inert_kg: number;
  recovery_hardware_kg: number;
  structure_budget_kg: number;
  propellant_mass_fraction: number;
  k_structural?: number;
  mass_ratio: number;
  mr_max?: number;
  delta_v_required_m_s: number;
  delta_v_delivered_m_s: number;
  dv_margin_m_s?: number;
  dv_split_frac: number;
  isp_sizing_s: number;
  boost_eff_isp_s: number | null;
  boost_phase_dv_m_s: number | null;
  core_only_dv_m_s: number | null;
  thrust_sl_n: number;
  thrust_vac_n: number;
  thrust_core_sl_n?: number;
  thrust_core_vac_n?: number;
  thrust_core_min_vac_n?: number;
  thrust_strapon_sl_n?: number;
  thrust_strapon_vac_n?: number;
  tw0_ignition: number;
  tw_before_booster_sep?: number | null;
  tw_after_booster_sep?: number | null;
  tw_burnout: number;
  max_accel_g: number;
  accel_boost_end_unmargined_g?: number | null;
  accel_boost_end_margined_g?: number | null;
  accel_core_burnout_unmargined_g?: number;
  accel_core_burnout_margined_g?: number;
  burn_time_s: number;
  strapon_burn_time_s: number | null;
  core_burn_margin_s?: number | null;
  of_ratio?: number;
  ox_mass_kg?: number;
  fuel_mass_kg?: number;
  ox_volume_m3?: number;
  fuel_volume_m3?: number;
  bulk_density_kg_m3?: number;
  stage_diameter_m?: number;
  slenderness_ld?: number;
  tank_geometry: TankGeometrySummary;
  structural_breakdown?: StageStructuralBreakdown;
  stage_height_m: number;
}

export interface FairingSizingSummary {
  profile: FairingProfile;
  outer_diameter_m: number;
  nose_length_m: number;
  barrel_length_m: number;
  boat_tail_length_m: number;
  total_length_m: number;
  mass_kg: number;
  usable_volume_m3: number;
  wave_drag_cd0: number;
  jettison_dv_m_s: number;
}

export interface VehicleCostBreakdown {
  airframe_ddte_usd: number;
  engine_ddte_usd: number;
  total_ddte_usd: number;
  airframe_tfu_usd: number;
  engine_tfu_usd: number;
  total_tfu_usd: number;
  avg_unit_hardware_usd: number;
  propellant_cost_usd: number;
  launch_ops_cost_usd: number;
  range_fee_usd: number;
  expendable_flight_cost_usd: number;
  reusable_flight_cost_usd: number;
  refurbishment_cost_usd: number;
  recovery_ops_cost_usd: number;
  cost_per_kg_payload_usd: number;
  integration_and_sepm_usd?: number;
  commercial_price_margin_usd?: number;
  predicted_market_launch_price_usd?: number;
}

export interface HeritageVehicleValidationEntry {
  vehicle_id: string;
  vehicle_name: string;
  category: string;
  sample_type?: string;
  is_calibration_set?: boolean;
  maiden_flight_year: number;
  total_launches: number;
  glow_kg: number;
  payload_leo_kg: number;
  core_diameter_m: number;
  stage_count: number;
  booster_count: number;
  actual_s1_dry_kg: number;
  predicted_s1_dry_kg: number;
  s1_dry_error_pct: number;
  s1_breakdown: StageStructuralBreakdown;
  actual_s2_dry_kg: number;
  predicted_s2_dry_kg: number;
  s2_dry_error_pct: number;
  s2_breakdown: StageStructuralBreakdown | null;
  actual_total_dry_kg: number;
  predicted_total_dry_kg: number;
  total_dry_error_pct: number;
  actual_launch_cost_adj_usd: number;
  predicted_launch_cost_adj_usd: number;
  launch_cost_error_pct: number;
  actual_ddte_usd: number;
  predicted_ddte_usd: number;
  ddte_error_pct: number;
}

export interface HeritageValidationSummary {
  entries: HeritageVehicleValidationEntry[];
  structural_mape_pct: number;
  s1_structural_mape_pct: number;
  s2_structural_mape_pct: number;
  cost_mape_pct: number;
  ddte_mape_pct: number;
  in_sample_structural_mape_pct?: number;
  out_of_sample_structural_mape_pct?: number;
  structural_mdape_pct?: number;
  in_sample_cost_mape_pct?: number;
  out_of_sample_cost_mape_pct?: number;
  cost_mdape_pct?: number;
  in_sample_ddte_mape_pct?: number;
  out_of_sample_ddte_mape_pct?: number;
  ddte_mdape_pct?: number;
  p10_structural_error_pct?: number;
  p90_structural_error_pct?: number;
  p10_cost_error_pct?: number;
  p90_cost_error_pct?: number;
}

export interface MetricUncertaintyBounds {
  nominal: number;
  p10_optimistic: number;
  p50_median: number;
  p90_conservative: number;
  unit: string;
}

export interface VehicleUncertaintyProfile {
  glow: MetricUncertaintyBounds;
  dry_mass: MetricUncertaintyBounds;
  launch_price_usd: MetricUncertaintyBounds;
  ddte_usd: MetricUncertaintyBounds;
  delivered_delta_v_m_s: MetricUncertaintyBounds;
  payload_capacity_kg: MetricUncertaintyBounds;
  dispersion_assumptions: string[];
}

export interface DeltaVBudgetBreakdown {
  orbit_velocity_m_s: number;
  insertion_margin_m_s: number;
  gravity_loss_m_s: number;
  aero_drag_loss_m_s: number;
  steering_loss_m_s: number;
  earth_rotation_assist_m_s: number;
  staging_ullage_loss_m_s: number;
  total_required_dv_m_s: number;
  total_delivered_dv_m_s: number;
}

export interface VehicleSizingResult {
  feasible: boolean;
  config_label: string;
  glow_kg: number;
  total_dry_mass_kg: number;
  total_propellant_kg: number;
  payload_mass_kg: number;
  payload_fraction: number;
  total_height_m: number;
  core_diameter_m: number;
  max_width_m: number;
  liftoff_thrust_sl_n: number;
  liftoff_tw0: number;
  peak_accel_g: number;
  max_q_pa: number;
  total_engine_count: number;
  delta_v_breakdown: DeltaVBudgetBreakdown;
  fairing: FairingSizingSummary;
  stages: StageSizingMetrics[];
  cost_breakdown: VehicleCostBreakdown;
  base_packing_fits: boolean;
  base_required_dia_m: number;
  base_usable_dia_m: number;
  constraint_violations: Record<string, number>;
  violation_messages: string[];
  objective_score: number;
  uncertainty?: VehicleUncertaintyProfile;
}

export interface SizingRequest {
  base_config: VehicleConfiguration;
  strategy: OptimizationStrategy;
  glow_weight: number;
  cost_weight: number;
  dry_mass_weight: number;
  allow_same_engine_stages: boolean;
  enforce_same_engine_stages?: number[];
  enforce_same_fuel_stages?: number[];
  include_boosters: boolean;
  dv_grid_steps: number;
  max_results: number;
}

export interface SizingSweepResponse {
  best_result: VehicleSizingResult | null;
  pareto_frontier: VehicleSizingResult[];
  top_candidates: VehicleSizingResult[];
  evaluated_count: number;
  feasible_count: number;
  rejection_summary: Record<string, number>;
  solver_elapsed_ms: number;
}

export interface TrajectoryTimePoint {
  time_s: number;
  altitude_m: number;
  downrange_m: number;
  velocity_m_s: number;
  flight_path_deg: number;
  dynamic_pressure_pa: number;
  mach: number;
  accel_g: number;
  throttle_frac: number;
  mass_kg: number;
  thrust_n: number;
  drag_n: number;
  active_stage: number;
}

export interface TrajectoryEvent {
  time_s: number;
  label: string;
  altitude_m: number;
  velocity_m_s: number;
  detail: string;
}

export interface TrajectorySimulationResult {
  points: TrajectoryTimePoint[];
  events: TrajectoryEvent[];
  max_q_pa: number;
  max_q_time_s: number;
  max_mach: number;
  peak_accel_g: number;
  gravity_loss_m_s: number;
  drag_loss_m_s: number;
  steering_loss_m_s: number;
  total_dv_delivered_m_s: number;
  final_altitude_m: number;
  target_altitude_m: number;
  final_velocity_m_s: number;
  target_velocity_m_s: number;
  final_flight_path_deg: number;
  apogee_achieved_m: number;
  perigee_achieved_m: number;
  orbit_reached: boolean;
  sim_duration_ms: number;
}

export interface RocketSizerDesignFileV1 {
  schema: "rocketsizer.design.v1";
  saved_at_iso: string;
  project_title: string;
  unit_system: "metric" | "imperial";
  currency_year: number;
  strategy: OptimizationStrategy;
  config: VehicleConfiguration;
}

export interface EnginePlacementInput {
  id: string;
  nozzle_diameter_m: number;
  gimbal_lever_arm_m: number;
  tvc_angle_deg: number;
  custom_x_m: number | null;
  custom_y_m: number | null;
  enabled: boolean;
}

export interface PackingConstraints {
  skirt_wall_thickness_m: number;
  skirt_clearance_m: number;
  no_touch_margin_m: number;
  default_tvc_angle_deg: number;
}

export interface PlacedEngineCircle {
  index: number;
  id: string;
  x_m: number;
  y_m: number;
  nozzle_radius_m: number;
  gimbal_sweep_radius_m: number;
  footprint_radius_m: number;
  enabled: boolean;
  clashes_with_skirt: boolean;
  clashes_with_indices: number[];
}

export interface BaseLayoutResult {
  stage_diameter_m: number;
  allowable_diameter_m?: number;
  usable_diameter_m: number;
  required_diameter_m: number;
  clearance_margin_m: number;
  fits: boolean;
  pattern_name: string;
  placements: PlacedEngineCircle[];
  min_pair_gap_m: number;
}

export interface CostModelParameters {
  inflation_factor: number;
  learning_rate: number;
  production_quantity: number;
  expected_reuses: number;
  fairing_reusable: boolean;
  booster_recovery_mode?: RecoveryMode;
  refurb_cost_frac_override?: number | null;
  reusable_ddte_surcharge_frac?: number;
  range_fee_usd: number;
  launch_ops_base_usd: number;
  recovery_ops_per_flight_usd: number;
}

export interface RecoveryStrategyCandidate {
  id: string;
  label: string;
  booster_mode: RecoveryMode;
  s1_mode: RecoveryMode;
  s2_mode: RecoveryMode;
  s3_mode: RecoveryMode;
  fairing_reusable: boolean;
  feasible: boolean;
  glow_kg: number;
  delta_glow_kg: number;
  delta_glow_pct: number;
  recovery_hardware_dry_kg: number;
  recovery_propellant_reserve_kg: number;
  payload_lost_kg: number;
  payload_lost_pct: number;
  ddte_usd: number;
  extra_ddte_usd: number;
  cost_per_flight_usd: number;
  turnaround_refurb_usd: number;
  total_campaign_cost_usd: number;
  net_campaign_savings_usd: number;
  breakeven_flights: number | null;
}

export interface RecoveryOptimizationReport {
  planned_flights: number;
  expendable_baseline_cost_per_flight_usd: number;
  expendable_baseline_ddte_usd: number;
  expendable_baseline_glow_kg: number;
  recommended_id: string;
  candidates: RecoveryStrategyCandidate[];
}

export interface SensitivityPoint {
  parameter_value: number;
  glow_kg: number;
  total_dry_mass_kg: number;
  reusable_flight_cost_usd: number;
  expendable_flight_cost_usd: number;
  cost_per_kg_usd: number;
  payload_fraction: number;
  liftoff_tw0: number;
  feasible: boolean;
}

export interface SensitivityCurveResponse {
  sweep_parameter: string;
  points: SensitivityPoint[];
}
