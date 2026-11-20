use super::engine::PropellantType;
use super::mission::{
    ConstraintEnvelope, CryoStateMode, FairingProfile, OptimizationStrategy, OrbitTarget,
    PressurizationMode, RecoveryMode, StagingArchitectureMode, TankMaterialPreset,
};
use super::provenance::ProvenanceValue;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvenanceVehicle {
    pub id: ProvenanceValue<String>,
    pub name: ProvenanceValue<String>,
    pub variant: ProvenanceValue<String>,
    pub manufacturer: ProvenanceValue<String>,
    pub country: ProvenanceValue<String>,
    pub operational_status: ProvenanceValue<String>,
    pub maiden_flight_year: ProvenanceValue<u16>,
    pub retirement_year: ProvenanceValue<Option<u16>>,
    pub payload_leo_kg: ProvenanceValue<f64>,
    pub payload_sso_kg: ProvenanceValue<f64>,
    pub payload_gto_kg: ProvenanceValue<f64>,
    pub payload_geo_kg: ProvenanceValue<f64>,
    pub payload_tli_kg: ProvenanceValue<f64>,
    pub payload_tmi_kg: ProvenanceValue<f64>,
    pub total_height_m: ProvenanceValue<f64>,
    pub core_diameter_m: ProvenanceValue<f64>,
    pub max_width_m: ProvenanceValue<f64>,
    pub fairing_diameter_m: ProvenanceValue<f64>,
    pub fairing_length_m: ProvenanceValue<f64>,
    pub usable_fairing_vol_m3: ProvenanceValue<f64>,
    pub glow_kg: ProvenanceValue<f64>,
    pub total_dry_mass_kg: ProvenanceValue<f64>,
    pub payload_fraction_leo: ProvenanceValue<f64>,
    pub liftoff_thrust_sl_n: ProvenanceValue<f64>,
    pub liftoff_tw0: ProvenanceValue<f64>,
    pub stage_count: ProvenanceValue<u8>,
    pub booster_count: ProvenanceValue<u8>,
    pub booster_type: ProvenanceValue<String>,
    pub s1_propellant: ProvenanceValue<String>,
    pub s1_engine_id: ProvenanceValue<String>,
    pub s1_engine_count: ProvenanceValue<u8>,
    pub s1_prop_mass_kg: ProvenanceValue<f64>,
    pub s1_dry_mass_kg: ProvenanceValue<f64>,
    pub s1_burn_time_s: ProvenanceValue<f64>,
    pub s2_propellant: ProvenanceValue<String>,
    pub s2_engine_id: ProvenanceValue<String>,
    pub s2_engine_count: ProvenanceValue<u8>,
    pub s2_prop_mass_kg: ProvenanceValue<f64>,
    pub s2_dry_mass_kg: ProvenanceValue<f64>,
    pub s2_burn_time_s: ProvenanceValue<f64>,
    pub booster_propellant: ProvenanceValue<String>,
    pub booster_engine_id: ProvenanceValue<String>,
    pub booster_engine_count: ProvenanceValue<u8>,
    pub booster_prop_mass_kg: ProvenanceValue<f64>,
    pub booster_dry_mass_kg: ProvenanceValue<f64>,
    pub booster_burn_time_s: ProvenanceValue<f64>,
    pub launch_cost_original_usd: ProvenanceValue<f64>,
    pub launch_cost_year: ProvenanceValue<u16>,
    pub launch_cost_adj_usd: ProvenanceValue<f64>,
    pub cost_per_kg_leo_usd: ProvenanceValue<f64>,
    pub development_cost_usd: ProvenanceValue<f64>,
    pub total_launches: ProvenanceValue<u32>,
    pub successful_launches: ProvenanceValue<u32>,
    pub launch_success_rate: ProvenanceValue<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StageConfig {
    pub stage_number: u8,
    pub engine_id: String,
    pub engine_count: usize,
    pub structural_mass_fraction_override: Option<f64>,
    pub tank_material: TankMaterialPreset,
    pub pressurization: PressurizationMode,
    pub common_bulkhead: bool,
    pub delta_v_split_frac: f64,
    pub recovery_mode: RecoveryMode,
}

fn default_mass_margin() -> f64 {
    0.25
}

fn default_true() -> bool {
    true
}

fn default_ullage_pressure_pa() -> f64 {
    320_000.0
}
fn default_ullage_volume_frac() -> f64 {
    0.03
}
fn default_burst_safety_factor() -> f64 {
    1.40
}
fn default_buckling_knockdown_gamma() -> f64 {
    0.38
}
fn default_cold_sep_ullage_s() -> f64 {
    5.0
}
fn default_cold_interstage_mass_kg() -> f64 {
    120.0
}
fn default_hot_staging_ring_mass_kg() -> f64 {
    680.0
}
fn default_learning_rate() -> f64 {
    0.85
}
fn default_launch_ops_base_usd() -> f64 {
    3_500_000.0
}
fn default_range_fee_usd() -> f64 {
    1_200_000.0
}
fn default_recovery_ops_per_flight_usd() -> f64 {
    450_000.0
}
fn default_reusable_ddte_surcharge_frac() -> f64 {
    0.18
}
fn default_tvc_angle_deg() -> f64 {
    7.0
}
fn default_no_touch_margin_m() -> f64 {
    0.10
}
fn default_skirt_clearance_m() -> f64 {
    0.12
}
fn default_skirt_wall_thickness_m() -> f64 {
    0.03
}
fn default_gimbal_lever_arm_ratio() -> f64 {
    0.85
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdvancedModelDefaults {
    #[serde(default = "default_ullage_pressure_pa")]
    pub ullage_pressure_pa: f64,
    #[serde(default = "default_ullage_volume_frac")]
    pub ullage_volume_frac: f64,
    #[serde(default = "default_burst_safety_factor")]
    pub burst_safety_factor: f64,
    #[serde(default = "default_buckling_knockdown_gamma")]
    pub buckling_knockdown_gamma: f64,
    #[serde(default = "default_cold_sep_ullage_s")]
    pub cold_sep_ullage_s: f64,
    #[serde(default = "default_cold_interstage_mass_kg")]
    pub cold_interstage_mass_kg: f64,
    #[serde(default = "default_hot_staging_ring_mass_kg")]
    pub hot_staging_ring_mass_kg: f64,
    #[serde(default = "default_learning_rate")]
    pub learning_rate: f64,
    #[serde(default = "default_launch_ops_base_usd")]
    pub launch_ops_base_usd: f64,
    #[serde(default = "default_range_fee_usd")]
    pub range_fee_usd: f64,
    #[serde(default = "default_recovery_ops_per_flight_usd")]
    pub recovery_ops_per_flight_usd: f64,
    #[serde(default)]
    pub refurb_cost_frac_override: Option<f64>,
    #[serde(default = "default_reusable_ddte_surcharge_frac")]
    pub reusable_ddte_surcharge_frac: f64,
    #[serde(default = "default_tvc_angle_deg")]
    pub tvc_angle_deg: f64,
    #[serde(default = "default_no_touch_margin_m")]
    pub no_touch_margin_m: f64,
    #[serde(default = "default_skirt_clearance_m")]
    pub skirt_clearance_m: f64,
    #[serde(default = "default_skirt_wall_thickness_m")]
    pub skirt_wall_thickness_m: f64,
    #[serde(default = "default_gimbal_lever_arm_ratio")]
    pub gimbal_lever_arm_ratio: f64,
}

impl Default for AdvancedModelDefaults {
    fn default() -> Self {
        Self {
            ullage_pressure_pa: default_ullage_pressure_pa(),
            ullage_volume_frac: default_ullage_volume_frac(),
            burst_safety_factor: default_burst_safety_factor(),
            buckling_knockdown_gamma: default_buckling_knockdown_gamma(),
            cold_sep_ullage_s: default_cold_sep_ullage_s(),
            cold_interstage_mass_kg: default_cold_interstage_mass_kg(),
            hot_staging_ring_mass_kg: default_hot_staging_ring_mass_kg(),
            learning_rate: default_learning_rate(),
            launch_ops_base_usd: default_launch_ops_base_usd(),
            range_fee_usd: default_range_fee_usd(),
            recovery_ops_per_flight_usd: default_recovery_ops_per_flight_usd(),
            refurb_cost_frac_override: None,
            reusable_ddte_surcharge_frac: default_reusable_ddte_surcharge_frac(),
            tvc_angle_deg: default_tvc_angle_deg(),
            no_touch_margin_m: default_no_touch_margin_m(),
            skirt_clearance_m: default_skirt_clearance_m(),
            skirt_wall_thickness_m: default_skirt_wall_thickness_m(),
            gimbal_lever_arm_ratio: default_gimbal_lever_arm_ratio(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VehicleConfiguration {
    pub name: String,
    pub payload_mass_kg: f64,
    pub payload_diameter_m: f64,
    pub payload_length_m: f64,
    pub orbit: OrbitTarget,
    pub required_delta_v_m_s: Option<f64>,
    pub core_diameter_m: f64,
    pub stage_count: u8,
    pub booster_engine_id: Option<String>,
    pub booster_count: usize,
    #[serde(default)]
    pub booster_recovery_mode: RecoveryMode,
    #[serde(default = "default_true")]
    pub recovery_optimizer_enabled: bool,
    pub stages: Vec<StageConfig>,
    pub staging_mode: StagingArchitectureMode,
    pub cryo_state: CryoStateMode,
    pub fairing_profile: FairingProfile,
    pub fairing_reusable: bool,
    #[serde(default = "default_mass_margin")]
    pub mass_margin_frac: f64,
    pub max_q_throttle_frac: f64,
    pub max_q_bucket_duration_s: f64,
    pub g_limit: f64,
    pub expected_reuses: u32,
    pub production_quantity: u32,
    pub constraints: ConstraintEnvelope,
    pub custom_engines: Vec<super::engine::ProvenanceEngine>,
    #[serde(default)]
    pub advanced_defaults: AdvancedModelDefaults,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TankGeometrySummary {
    pub radius_m: f64,
    pub dome_height_m: f64,
    pub ox_barrel_length_m: f64,
    pub fuel_barrel_length_m: f64,
    pub stage_tanks_length_m: f64,
    pub wall_thickness_m: f64,
    pub hoop_stress_pa: f64,
    pub buckling_critical_stress_pa: f64,
    pub axial_compressive_stress_pa: f64,
    pub buckling_stiffening_factor: f64,
    pub pressurant_mass_kg: f64,
    pub boiloff_loss_kg: f64,
    pub tank_structural_mass_kg: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StageStructuralBreakdown {
    pub ox_wall_thickness_m: f64,
    pub fuel_wall_thickness_m: f64,
    pub ox_tank_barrel_mass_kg: f64,
    pub fuel_tank_barrel_mass_kg: f64,
    pub tank_domes_mass_kg: f64,
    pub baffles_and_slosh_mass_kg: f64,
    pub forward_skirt_mass_kg: f64,
    pub aft_skirt_and_base_shield_mass_kg: f64,
    pub intertank_mass_kg: f64,
    pub interstage_mass_kg: f64,
    pub thrust_structure_mass_kg: f64,
    pub plumbing_and_valves_mass_kg: f64,
    pub pressurization_system_mass_kg: f64,
    pub cryo_insulation_mass_kg: f64,
    pub tvc_and_rcs_mass_kg: f64,
    pub avionics_and_wiring_mass_kg: f64,
    pub payload_adapter_mass_kg: f64,
    pub fasteners_and_joints_mass_kg: f64,
    pub solid_casing_and_nozzle_mass_kg: f64,
    pub engines_mass_kg: f64,
    pub recovery_hardware_kg: f64,
    pub strapon_inert_kg: f64,
    pub predicted_structure_only_unmargined_kg: f64,
    pub predicted_dry_unmargined_kg: f64,
    pub margin_reserve_kg: f64,
    pub predicted_dry_margined_kg: f64,
    pub predicted_pmf_unmargined: f64,
    pub predicted_pmf_margined: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StageSizingMetrics {
    pub stage_number: u8,
    pub engine_id: String,
    pub engine_name: String,
    pub propellant: PropellantType,
    pub engine_count: usize,
    pub strapon_engine_id: Option<String>,
    #[serde(default)]
    pub strapon_engine_name: Option<String>,
    pub strapon_count: usize,
    pub m0_kg: f64,
    pub stage_total_mass_kg: f64,
    pub propellant_mass_kg: f64,
    pub ascent_propellant_kg: f64,
    pub recovery_propellant_kg: f64,
    pub strapon_propellant_kg: f64,
    #[serde(default)]
    pub m_liquid_prop_kg: f64,
    #[serde(default)]
    pub m_liquid_burned_boost_kg: f64,
    #[serde(default)]
    pub m_boost_burnout_kg: f64,
    #[serde(default)]
    pub m0_core_only_kg: f64,
    #[serde(default)]
    pub m_core_burnout_kg: f64,
    pub inert_mass_kg: f64,
    #[serde(default)]
    pub m_inert_unmargined_kg: f64,
    pub engines_mass_kg: f64,
    pub strapon_inert_kg: f64,
    pub recovery_hardware_kg: f64,
    pub structure_budget_kg: f64,
    pub propellant_mass_fraction: f64,
    #[serde(default)]
    pub k_structural: f64,
    pub mass_ratio: f64,
    #[serde(default)]
    pub mr_max: f64,
    pub delta_v_required_m_s: f64,
    pub delta_v_delivered_m_s: f64,
    #[serde(default)]
    pub dv_margin_m_s: f64,
    pub dv_split_frac: f64,
    pub isp_sizing_s: f64,
    pub boost_eff_isp_s: Option<f64>,
    pub boost_phase_dv_m_s: Option<f64>,
    pub core_only_dv_m_s: Option<f64>,
    pub thrust_sl_n: f64,
    pub thrust_vac_n: f64,
    #[serde(default)]
    pub thrust_core_sl_n: f64,
    #[serde(default)]
    pub thrust_core_vac_n: f64,
    #[serde(default)]
    pub thrust_core_min_vac_n: f64,
    #[serde(default)]
    pub thrust_strapon_sl_n: f64,
    #[serde(default)]
    pub thrust_strapon_vac_n: f64,
    pub tw0_ignition: f64,
    #[serde(default)]
    pub tw_before_booster_sep: Option<f64>,
    #[serde(default)]
    pub tw_after_booster_sep: Option<f64>,
    pub tw_burnout: f64,
    pub max_accel_g: f64,
    #[serde(default)]
    pub accel_boost_end_unmargined_g: Option<f64>,
    #[serde(default)]
    pub accel_boost_end_margined_g: Option<f64>,
    #[serde(default)]
    pub accel_core_burnout_unmargined_g: f64,
    #[serde(default)]
    pub accel_core_burnout_margined_g: f64,
    pub burn_time_s: f64,
    pub strapon_burn_time_s: Option<f64>,
    #[serde(default)]
    pub core_burn_margin_s: Option<f64>,
    #[serde(default)]
    pub of_ratio: f64,
    #[serde(default)]
    pub ox_mass_kg: f64,
    #[serde(default)]
    pub fuel_mass_kg: f64,
    #[serde(default)]
    pub ox_volume_m3: f64,
    #[serde(default)]
    pub fuel_volume_m3: f64,
    #[serde(default)]
    pub bulk_density_kg_m3: f64,
    #[serde(default)]
    pub stage_diameter_m: f64,
    #[serde(default)]
    pub slenderness_ld: f64,
    pub tank_geometry: TankGeometrySummary,
    #[serde(default)]
    pub structural_breakdown: StageStructuralBreakdown,
    pub stage_height_m: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FairingSizingSummary {
    pub profile: FairingProfile,
    pub outer_diameter_m: f64,
    pub nose_length_m: f64,
    pub barrel_length_m: f64,
    pub boat_tail_length_m: f64,
    pub total_length_m: f64,
    pub mass_kg: f64,
    pub usable_volume_m3: f64,
    pub wave_drag_cd0: f64,
    pub jettison_dv_m_s: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VehicleCostBreakdown {
    pub airframe_ddte_usd: f64,
    pub engine_ddte_usd: f64,
    pub total_ddte_usd: f64,
    pub airframe_tfu_usd: f64,
    pub engine_tfu_usd: f64,
    pub total_tfu_usd: f64,
    pub avg_unit_hardware_usd: f64,
    pub propellant_cost_usd: f64,
    pub launch_ops_cost_usd: f64,
    pub range_fee_usd: f64,
    pub expendable_flight_cost_usd: f64,
    pub reusable_flight_cost_usd: f64,
    pub refurbishment_cost_usd: f64,
    pub recovery_ops_cost_usd: f64,
    pub cost_per_kg_payload_usd: f64,
    #[serde(default)]
    pub integration_and_sepm_usd: f64,
    #[serde(default)]
    pub commercial_price_margin_usd: f64,
    #[serde(default)]
    pub predicted_market_launch_price_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeritageVehicleValidationEntry {
    pub vehicle_id: String,
    pub vehicle_name: String,
    pub category: String,
    pub maiden_flight_year: u16,
    pub total_launches: u32,
    pub glow_kg: f64,
    pub payload_leo_kg: f64,
    pub core_diameter_m: f64,
    pub stage_count: u8,
    pub booster_count: u8,
    pub actual_s1_dry_kg: f64,
    pub predicted_s1_dry_kg: f64,
    pub s1_dry_error_pct: f64,
    pub s1_breakdown: StageStructuralBreakdown,
    pub actual_s2_dry_kg: f64,
    pub predicted_s2_dry_kg: f64,
    pub s2_dry_error_pct: f64,
    pub s2_breakdown: Option<StageStructuralBreakdown>,
    pub actual_total_dry_kg: f64,
    pub predicted_total_dry_kg: f64,
    pub total_dry_error_pct: f64,
    pub actual_launch_cost_adj_usd: f64,
    pub predicted_launch_cost_adj_usd: f64,
    pub launch_cost_error_pct: f64,
    pub actual_ddte_usd: f64,
    pub predicted_ddte_usd: f64,
    pub ddte_error_pct: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeritageValidationSummary {
    pub entries: Vec<HeritageVehicleValidationEntry>,
    pub structural_mape_pct: f64,
    pub s1_structural_mape_pct: f64,
    pub s2_structural_mape_pct: f64,
    pub cost_mape_pct: f64,
    pub ddte_mape_pct: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeltaVBudgetBreakdown {
    pub orbit_velocity_m_s: f64,
    pub insertion_margin_m_s: f64,
    pub gravity_loss_m_s: f64,
    pub aero_drag_loss_m_s: f64,
    pub steering_loss_m_s: f64,
    pub earth_rotation_assist_m_s: f64,
    pub staging_ullage_loss_m_s: f64,
    pub total_required_dv_m_s: f64,
    pub total_delivered_dv_m_s: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VehicleSizingResult {
    pub feasible: bool,
    pub config_label: String,
    pub glow_kg: f64,
    pub total_dry_mass_kg: f64,
    pub total_propellant_kg: f64,
    pub payload_mass_kg: f64,
    pub payload_fraction: f64,
    pub total_height_m: f64,
    pub core_diameter_m: f64,
    pub max_width_m: f64,
    pub liftoff_thrust_sl_n: f64,
    pub liftoff_tw0: f64,
    pub peak_accel_g: f64,
    pub max_q_pa: f64,
    pub total_engine_count: usize,
    pub delta_v_breakdown: DeltaVBudgetBreakdown,
    pub fairing: FairingSizingSummary,
    pub stages: Vec<StageSizingMetrics>,
    pub cost_breakdown: VehicleCostBreakdown,
    pub base_packing_fits: bool,
    pub base_required_dia_m: f64,
    pub base_usable_dia_m: f64,
    pub constraint_violations: HashMap<String, usize>,
    pub violation_messages: Vec<String>,
    pub objective_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SizingRequest {
    pub base_config: VehicleConfiguration,
    pub strategy: OptimizationStrategy,
    pub glow_weight: f64,
    pub cost_weight: f64,
    pub dry_mass_weight: f64,
    pub allow_same_engine_stages: bool,
    #[serde(default)]
    pub enforce_same_engine_stages: Vec<u8>,
    #[serde(default)]
    pub enforce_same_fuel_stages: Vec<u8>,
    pub include_boosters: bool,
    pub dv_grid_steps: usize,
    pub max_results: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SizingSweepResponse {
    pub best_result: Option<VehicleSizingResult>,
    pub pareto_frontier: Vec<VehicleSizingResult>,
    pub top_candidates: Vec<VehicleSizingResult>,
    pub evaluated_count: usize,
    pub feasible_count: usize,
    pub rejection_summary: HashMap<String, usize>,
    pub solver_elapsed_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrajectoryTimePoint {
    pub time_s: f64,
    pub altitude_m: f64,
    pub downrange_m: f64,
    pub velocity_m_s: f64,
    pub flight_path_deg: f64,
    pub dynamic_pressure_pa: f64,
    pub mach: f64,
    pub accel_g: f64,
    pub throttle_frac: f64,
    pub mass_kg: f64,
    pub thrust_n: f64,
    pub drag_n: f64,
    pub active_stage: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrajectoryEvent {
    pub time_s: f64,
    pub label: String,
    pub altitude_m: f64,
    pub velocity_m_s: f64,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrajectorySimulationResult {
    pub points: Vec<TrajectoryTimePoint>,
    pub events: Vec<TrajectoryEvent>,
    pub max_q_pa: f64,
    pub max_q_time_s: f64,
    pub max_mach: f64,
    pub peak_accel_g: f64,
    pub gravity_loss_m_s: f64,
    pub drag_loss_m_s: f64,
    pub steering_loss_m_s: f64,
    pub total_dv_delivered_m_s: f64,
    pub final_altitude_m: f64,
    pub target_altitude_m: f64,
    pub final_velocity_m_s: f64,
    pub target_velocity_m_s: f64,
    pub final_flight_path_deg: f64,
    pub apogee_achieved_m: f64,
    pub perigee_achieved_m: f64,
    pub orbit_reached: bool,
    pub sim_duration_ms: f64,
}
