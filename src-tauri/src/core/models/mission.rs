use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MissionPreset {
    Leo285,
    Leo516,
    Sso980,
    Gto,
    Tli,
    Tmi,
    Custom,
}

impl Default for MissionPreset {
    fn default() -> Self {
        Self::Custom
    }
}

fn default_perigee_m() -> f64 {
    185_200.0
}

fn default_apogee_m() -> f64 {
    185_200.0
}

fn default_eccentricity() -> f64 {
    0.0
}

fn default_dv_margin_pct() -> f64 {
    2.5
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrbitTarget {
    #[serde(default)]
    pub preset: MissionPreset,
    #[serde(default = "default_perigee_m")]
    pub altitude_m: f64,
    #[serde(default = "default_perigee_m")]
    pub perigee_altitude_m: f64,
    #[serde(default = "default_apogee_m")]
    pub apogee_altitude_m: f64,
    #[serde(default = "default_eccentricity")]
    pub eccentricity: f64,
    pub inclination_deg: f64,
    pub launch_latitude_deg: f64,
    pub launch_azimuth_deg: f64,
    pub insertion_margin_m_s: f64,
    #[serde(default = "default_dv_margin_pct")]
    pub dv_margin_pct: f64,
    pub coast_duration_s: f64,
}

impl Default for OrbitTarget {
    fn default() -> Self {
        Self {
            preset: MissionPreset::Custom,
            altitude_m: 185_200.0,
            perigee_altitude_m: 185_200.0,
            apogee_altitude_m: 185_200.0,
            eccentricity: 0.0,
            inclination_deg: 28.5,
            launch_latitude_deg: 28.5,
            launch_azimuth_deg: 90.0,
            insertion_margin_m_s: 150.0,
            dv_margin_pct: default_dv_margin_pct(),
            coast_duration_s: 0.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryMode {
    Expendable,
    DownrangeLandingAsds,
    ReturnToLaunchSiteRtls,
    ParachuteMidAirCatch,
}

impl Default for RecoveryMode {
    fn default() -> Self {
        Self::Expendable
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StagingArchitectureMode {
    ColdPneumaticUllage,
    HotStagingVentedRing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PressurizationMode {
    Autogenous,
    HeliumCopv,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CryoStateMode {
    StandardBoiling,
    SubcooledDensified,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FairingProfile {
    VonKarman,
    TangentOgive,
    Biconic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TankMaterialPreset {
    AlLi2195,
    CfrpComposite,
    Stainless304L,
    TitaniumTi6Al4V,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OptimizationStrategy {
    MinimizeGlow,
    MinimizeCost,
    BalancedTrade,
    ParetoFrontier,
}

fn default_min_payload_frac() -> f64 {
    0.005
}

fn default_max_payload_frac() -> f64 {
    0.08
}

fn default_min_core_only_tw0() -> f64 {
    0.70
}

fn default_max_core_only_tw0() -> f64 {
    2.20
}

fn default_min_stage3_tw0() -> f64 {
    0.20
}

fn default_max_stage3_tw0() -> f64 {
    1.50
}

fn default_max_strapon_count() -> usize {
    6
}

fn default_max_slenderness_ld() -> Option<f64> {
    Some(22.0)
}

fn default_mf_lox_lh2() -> Option<f64> {
    Some(0.905)
}

fn default_mf_lox_rp1() -> Option<f64> {
    Some(0.940)
}

fn default_mf_lox_ch4() -> Option<f64> {
    Some(0.925)
}

fn default_mf_solid() -> Option<f64> {
    Some(0.880)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConstraintEnvelope {
    pub max_cost_usd: Option<f64>,
    pub max_glow_kg: Option<f64>,
    pub min_glow_kg: Option<f64>,
    pub max_core_diameter_m: Option<f64>,
    pub max_total_height_m: Option<f64>,
    pub max_g_limit: f64,
    pub max_core_engines: usize,
    pub max_upper_engines: usize,
    pub allowed_booster_counts: Vec<usize>,
    pub min_liftoff_tw0: f64,
    pub max_liftoff_tw0: f64,
    pub min_upper_tw0: f64,
    pub max_upper_tw0: f64,
    pub enforce_base_packing: bool,
    #[serde(default = "default_min_payload_frac")]
    pub min_payload_frac: f64,
    #[serde(default = "default_max_payload_frac")]
    pub max_payload_frac: f64,
    #[serde(default = "default_min_core_only_tw0")]
    pub min_core_only_tw0: f64,
    #[serde(default = "default_max_core_only_tw0")]
    pub max_core_only_tw0: f64,
    #[serde(default = "default_min_stage3_tw0")]
    pub min_stage3_tw0: f64,
    #[serde(default = "default_max_stage3_tw0")]
    pub max_stage3_tw0: f64,
    #[serde(default)]
    pub min_strapon_count: usize,
    #[serde(default = "default_max_strapon_count")]
    pub max_strapon_count: usize,
    #[serde(default = "default_mf_lox_lh2")]
    pub mf_lox_lh2: Option<f64>,
    #[serde(default = "default_mf_lox_rp1")]
    pub mf_lox_rp1: Option<f64>,
    #[serde(default = "default_mf_lox_ch4")]
    pub mf_lox_ch4: Option<f64>,
    #[serde(default = "default_mf_solid")]
    pub mf_solid: Option<f64>,
    #[serde(default = "default_max_slenderness_ld")]
    pub max_slenderness_ld: Option<f64>,
    #[serde(default)]
    pub stage1_allowed_engines: Vec<String>,
    #[serde(default)]
    pub stage2_allowed_engines: Vec<String>,
    #[serde(default)]
    pub stage3_allowed_engines: Vec<String>,
    #[serde(default)]
    pub booster_allowed_engines: Vec<String>,
    #[serde(default)]
    pub stage1_allowed_propellants: Vec<String>,
    #[serde(default)]
    pub stage2_allowed_propellants: Vec<String>,
    #[serde(default)]
    pub stage3_allowed_propellants: Vec<String>,
    #[serde(default)]
    pub stage1_allowed_cycles: Vec<String>,
    #[serde(default)]
    pub stage2_allowed_cycles: Vec<String>,
    #[serde(default)]
    pub stage3_allowed_cycles: Vec<String>,
}

impl Default for ConstraintEnvelope {
    fn default() -> Self {
        Self {
            max_cost_usd: None,
            max_glow_kg: None,
            min_glow_kg: Some(1_000.0),
            max_core_diameter_m: None,
            max_total_height_m: None,
            max_g_limit: 4.5,
            max_core_engines: 33,
            max_upper_engines: 6,
            allowed_booster_counts: vec![0, 2, 3, 4, 6],
            min_liftoff_tw0: 1.20,
            max_liftoff_tw0: 1.60,
            min_upper_tw0: 0.25,
            max_upper_tw0: 1.45,
            enforce_base_packing: true,
            min_payload_frac: default_min_payload_frac(),
            max_payload_frac: default_max_payload_frac(),
            min_core_only_tw0: default_min_core_only_tw0(),
            max_core_only_tw0: default_max_core_only_tw0(),
            min_stage3_tw0: default_min_stage3_tw0(),
            max_stage3_tw0: default_max_stage3_tw0(),
            min_strapon_count: 0,
            max_strapon_count: default_max_strapon_count(),
            mf_lox_lh2: default_mf_lox_lh2(),
            mf_lox_rp1: default_mf_lox_rp1(),
            mf_lox_ch4: default_mf_lox_ch4(),
            mf_solid: default_mf_solid(),
            max_slenderness_ld: default_max_slenderness_ld(),
            stage1_allowed_engines: Vec::new(),
            stage2_allowed_engines: Vec::new(),
            stage3_allowed_engines: Vec::new(),
            booster_allowed_engines: Vec::new(),
            stage1_allowed_propellants: Vec::new(),
            stage2_allowed_propellants: Vec::new(),
            stage3_allowed_propellants: Vec::new(),
            stage1_allowed_cycles: Vec::new(),
            stage2_allowed_cycles: Vec::new(),
            stage3_allowed_cycles: Vec::new(),
        }
    }
}
