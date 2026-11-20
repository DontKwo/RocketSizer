use super::models::engine::{EngineCycle, EngineSpec, PropellantType};
use super::models::mission::{RecoveryMode, TankMaterialPreset};
use super::models::vehicle::{ProvenanceVehicle, VehicleCostBreakdown, VehicleSizingResult};
use super::structures::{
    effective_heritage_engine_params, get_material_properties, infer_heritage_material,
    parse_heritage_propellant,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

fn default_ddte_surcharge() -> f64 {
    0.18
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostModelParameters {
    pub inflation_factor: f64,
    pub learning_rate: f64,
    pub production_quantity: u32,
    pub expected_reuses: u32,
    pub fairing_reusable: bool,
    #[serde(default)]
    pub booster_recovery_mode: RecoveryMode,
    #[serde(default)]
    pub refurb_cost_frac_override: Option<f64>,
    #[serde(default = "default_ddte_surcharge")]
    pub reusable_ddte_surcharge_frac: f64,
    pub range_fee_usd: f64,
    pub launch_ops_base_usd: f64,
    pub recovery_ops_per_flight_usd: f64,
}

impl Default for CostModelParameters {
    fn default() -> Self {
        Self {
            inflation_factor: 1.0,
            learning_rate: 0.85,
            production_quantity: 20,
            expected_reuses: 10,
            fairing_reusable: false,
            booster_recovery_mode: RecoveryMode::Expendable,
            refurb_cost_frac_override: None,
            reusable_ddte_surcharge_frac: default_ddte_surcharge(),
            range_fee_usd: 1_200_000.0,
            launch_ops_base_usd: 3_500_000.0,
            recovery_ops_per_flight_usd: 450_000.0,
        }
    }
}

pub fn propellant_prices_usd_per_kg(propellant: PropellantType) -> (f64, f64) {
    let lox_price = 0.18;
    match propellant {
        PropellantType::LoxRp1 => (1.85, lox_price),
        PropellantType::LoxLh2 => (4.50, lox_price),
        PropellantType::LoxCh4 => (0.65, lox_price),
        PropellantType::SolidHtpb => (16.0, 16.0),
        PropellantType::HypergolicNtoUdmh => (22.0, 14.0),
    }
}

pub fn cycle_cost_factor(cycle: EngineCycle) -> f64 {
    match cycle {
        EngineCycle::PressureFed => 0.40,
        EngineCycle::GasGenerator => 1.00,
        EngineCycle::Expander => 1.35,
        EngineCycle::ElectricPump => 0.55,
        EngineCycle::StagedCombustion => 1.75,
        EngineCycle::FullFlowStagedCombustion => 2.20,
        EngineCycle::SolidMotor => 0.45,
    }
}

pub fn propellant_cost_factor(propellant: PropellantType) -> f64 {
    match propellant {
        PropellantType::LoxRp1 => 1.00,
        PropellantType::LoxCh4 => 1.15,
        PropellantType::LoxLh2 => 1.45,
        PropellantType::SolidHtpb => 0.70,
        PropellantType::HypergolicNtoUdmh => 1.10,
    }
}

pub fn propellant_struct_cost_factor(propellant: PropellantType) -> f64 {
    match propellant {
        PropellantType::LoxRp1 => 1.00,
        PropellantType::LoxCh4 => 1.08,
        PropellantType::LoxLh2 => 1.58,
        PropellantType::SolidHtpb => 0.55,
        PropellantType::HypergolicNtoUdmh => 1.12,
    }
}

pub fn calc_learning_curve_avg_usd(tfu_usd: f64, quantity: u32, learning_rate: f64) -> f64 {
    if quantity <= 1 {
        return tfu_usd;
    }
    let q_f64 = quantity as f64;
    let p_exp = learning_rate.clamp(0.65, 0.99).ln() / 2.0_f64.ln();
    let denom = (1.0 + p_exp).max(0.15);
    tfu_usd * (q_f64.powf(p_exp) / denom)
}

pub fn compute_vehicle_cost_breakdown(
    result: &VehicleSizingResult,
    engines_map: &HashMap<String, EngineSpec>,
    stage_materials: &[TankMaterialPreset],
    stage_recoveries: &[RecoveryMode],
    params: &CostModelParameters,
) -> VehicleCostBreakdown {
    let a_struct_ddte_usd = 1_150_000.0;
    let b_struct_ddte = 0.55;
    let a_struct_tfu_usd = 18_500.0;
    let b_struct_tfu = 0.62;
    let a_eng_ddte_usd = 2_550_000.0;
    let a_eng_tfu_usd = 42_000.0;

    let mut airframe_ddte_usd = 0.0;
    let mut airframe_tfu_usd = 0.0;
    let mut stage_tfu_list_usd = Vec::new();
    let mut total_strapon_tfu_usd = 0.0;
    let mut unique_engines: HashMap<String, (f64, f64, usize)> = HashMap::new();
    let mut propellant_cost_usd = 0.0;
    let mut has_lh2_stage = false;

    for (idx, stage) in result.stages.iter().enumerate() {
        if stage.propellant == PropellantType::LoxLh2 {
            has_lh2_stage = true;
        }
        let material = stage_materials.get(idx).copied().unwrap_or(TankMaterialPreset::AlLi2195);
        let f_material = get_material_properties(material).cost_material_factor;
        let f_complexity = if stage.stage_number == 1 { 1.0 } else { 1.25 };
        let f_prop_struct = propellant_struct_cost_factor(stage.propellant);
        let m_airframe_kg = (stage.inert_mass_kg - stage.engines_mass_kg - stage.strapon_inert_kg).max(50.0);

        let rec_mode = stage_recoveries.get(idx).copied().unwrap_or(RecoveryMode::Expendable);
        let reuse_ddte_mult = if rec_mode != RecoveryMode::Expendable {
            1.0 + params.reusable_ddte_surcharge_frac.max(0.0)
        } else {
            1.0
        };

        let term1_ddte = a_struct_ddte_usd * m_airframe_kg.powf(b_struct_ddte);
        airframe_ddte_usd +=
            term1_ddte * f_complexity * f_material * f_prop_struct * params.inflation_factor * reuse_ddte_mult;

        let term1_tfu = a_struct_tfu_usd * m_airframe_kg.powf(b_struct_tfu);
        let stage_struct_tfu_usd = term1_tfu * f_material * f_prop_struct * params.inflation_factor;
        airframe_tfu_usd += stage_struct_tfu_usd;

        let eng_spec = engines_map.get(&stage.engine_id);
        let (eng_ddte_usd, eng_tfu_usd, ox_ratio) = if let Some(spec) = eng_spec {
            let t_vac_kn = (spec.thrust_vac_n / 1_000.0).max(1.0);
            let p_bar = spec.chamber_pressure_bar.max(10.0);
            let f_cycle = cycle_cost_factor(spec.cycle);
            let f_prop = propellant_cost_factor(spec.propellant);
            let term1_e_ddte = a_eng_ddte_usd * t_vac_kn.powf(0.535) * p_bar.powf(0.21);
            let term1_e_tfu = a_eng_tfu_usd * t_vac_kn.powf(0.485) * p_bar.powf(0.18);
            (
                term1_e_ddte * f_cycle * f_prop * params.inflation_factor,
                term1_e_tfu * f_cycle * f_prop * params.inflation_factor,
                spec.oxidizer_fuel_ratio,
            )
        } else {
            (0.0, 0.0, 2.6)
        };

        let entry = unique_engines.entry(stage.engine_id.clone()).or_insert((eng_ddte_usd, eng_tfu_usd, 0));
        entry.2 += stage.engine_count;

        let mut strapon_has_priced_unit = false;
        if let Some(strap_id) = &stage.strapon_engine_id {
            if stage.strapon_count > 0 {
                if let Some(s_spec) = engines_map.get(strap_id) {
                    let b_reuse_mult = if params.booster_recovery_mode != RecoveryMode::Expendable {
                        1.0 + params.reusable_ddte_surcharge_frac.max(0.0)
                    } else {
                        1.0
                    };
                    let s_case_ddte = a_struct_ddte_usd * (s_spec.dry_mass_kg.max(50.0)).powf(b_struct_ddte) * 0.50;
                    airframe_ddte_usd += s_case_ddte * params.inflation_factor * b_reuse_mult;
                    let s_tfu = if s_spec.unit_cost_usd > 0.0 {
                        strapon_has_priced_unit = true;
                        s_spec.unit_cost_usd
                    } else {
                        a_struct_tfu_usd * (s_spec.dry_mass_kg.max(50.0)).powf(b_struct_tfu) * 0.65
                    };
                    let strapon_tfu_usd = s_tfu * (stage.strapon_count as f64) * params.inflation_factor;
                    airframe_tfu_usd += strapon_tfu_usd;
                    total_strapon_tfu_usd += strapon_tfu_usd;
                }
            }
        }

        let stage_eng_total_tfu_usd = eng_tfu_usd * (stage.engine_count as f64);
        stage_tfu_list_usd.push(stage_struct_tfu_usd + stage_eng_total_tfu_usd);

        let (c_fuel_usd_kg, c_ox_usd_kg) = propellant_prices_usd_per_kg(stage.propellant);
        let core_prop_kg = (stage.propellant_mass_kg - stage.strapon_propellant_kg).max(0.0);
        if ox_ratio > 0.0 {
            let m_ox_kg = core_prop_kg * (ox_ratio / (1.0 + ox_ratio));
            let m_fuel_kg = core_prop_kg * (1.0 / (1.0 + ox_ratio));
            propellant_cost_usd += m_ox_kg * c_ox_usd_kg + m_fuel_kg * c_fuel_usd_kg;
        } else {
            propellant_cost_usd += core_prop_kg * c_fuel_usd_kg;
        }
        let strap_prop_rate_usd_kg = if strapon_has_priced_unit { 1.50 } else { 16.0 };
        propellant_cost_usd += stage.strapon_propellant_kg * strap_prop_rate_usd_kg;
        propellant_cost_usd += stage.tank_geometry.pressurant_mass_kg * 35.0;
    }

    let fairing_tfu_usd = a_struct_tfu_usd * result.fairing.mass_kg.max(50.0).powf(b_struct_tfu) * 1.35 * params.inflation_factor;
    airframe_tfu_usd += fairing_tfu_usd;

    let mut engine_ddte_usd = 0.0;
    let mut engine_tfu_usd = 0.0;
    for (_eng_id, (ddte, tfu, count)) in unique_engines {
        engine_ddte_usd += ddte;
        engine_tfu_usd += tfu * (count as f64);
    }

    let total_ddte_usd = airframe_ddte_usd + engine_ddte_usd;
    let total_tfu_usd = airframe_tfu_usd + engine_tfu_usd;
    let avg_unit_hardware_usd = calc_learning_curve_avg_usd(total_tfu_usd, params.production_quantity, params.learning_rate);

    let glow_scale = (result.glow_kg.max(5_000.0) / 350_000.0).powf(0.38).clamp(0.25, 3.20);
    let cryo_ops_mult = if has_lh2_stage { 1.35 } else { 1.0 };
    let launch_ops_cost_usd = params.launch_ops_base_usd
        * glow_scale
        * cryo_ops_mult
        * (1.0 + 0.03 * (result.total_engine_count as f64));
    let range_fee_usd = params.range_fee_usd * glow_scale.powf(0.45);
    let expendable_flight_cost_usd = avg_unit_hardware_usd + propellant_cost_usd + launch_ops_cost_usd + range_fee_usd;

    let mut hardware_amortized_usd = calc_learning_curve_avg_usd(fairing_tfu_usd, params.production_quantity, params.learning_rate);
    let mut refurbishment_cost_usd = 0.0;
    let mut recovery_ops_cost_usd = 0.0;
    let n_reuses = params.expected_reuses.max(1) as f64;

    if params.fairing_reusable {
        let fairing_avg_usd = hardware_amortized_usd;
        hardware_amortized_usd = 0.20 * fairing_avg_usd + 350_000.0;
    }

    for (idx, stage) in result.stages.iter().enumerate() {
        let stage_tfu_usd = stage_tfu_list_usd.get(idx).copied().unwrap_or(0.0);
        let stage_avg_usd = calc_learning_curve_avg_usd(stage_tfu_usd, params.production_quantity, params.learning_rate);
        let rec_mode = stage_recoveries.get(idx).copied().unwrap_or(RecoveryMode::Expendable);

        if rec_mode == RecoveryMode::Expendable {
            hardware_amortized_usd += stage_avg_usd;
        } else {
            let f_refurb = params.refurb_cost_frac_override.unwrap_or_else(|| match stage.propellant {
                PropellantType::LoxCh4 | PropellantType::LoxLh2 => 0.08,
                _ => 0.15,
            });
            hardware_amortized_usd += stage_avg_usd / n_reuses;
            refurbishment_cost_usd += f_refurb * stage_avg_usd;
            recovery_ops_cost_usd += params.recovery_ops_per_flight_usd;
        }
    }

    if total_strapon_tfu_usd > 0.0 {
        let strapon_avg_usd = calc_learning_curve_avg_usd(total_strapon_tfu_usd, params.production_quantity, params.learning_rate);
        if params.booster_recovery_mode == RecoveryMode::Expendable {
            hardware_amortized_usd += strapon_avg_usd;
        } else {
            let f_refurb = params.refurb_cost_frac_override.unwrap_or(0.14);
            hardware_amortized_usd += strapon_avg_usd / n_reuses;
            refurbishment_cost_usd += f_refurb * strapon_avg_usd;
            recovery_ops_cost_usd += params.recovery_ops_per_flight_usd * 0.85;
        }
    }

    let reusable_flight_cost_usd = hardware_amortized_usd
        + refurbishment_cost_usd
        + recovery_ops_cost_usd
        + propellant_cost_usd
        + launch_ops_cost_usd
        + range_fee_usd;
    let integration_and_sepm_usd = 0.14
        * avg_unit_hardware_usd
        * (1.0
            + 0.08 * (result.stages.len().saturating_sub(1) as f64)
            + 0.04 * (result.stages.first().map(|s| s.strapon_count).unwrap_or(0) as f64));
    let campaign_divisor = ((params.production_quantity.max(1) as f64) * (params.expected_reuses.max(1) as f64).powf(0.35)).max(12.0);
    let ddte_amort_usd = total_ddte_usd / campaign_divisor;
    let commercial_price_margin_usd =
        0.35 * reusable_flight_cost_usd + integration_and_sepm_usd + 0.08 * ddte_amort_usd;
    let predicted_market_launch_price_usd = reusable_flight_cost_usd + commercial_price_margin_usd;
    let cost_per_kg_payload_usd = if result.payload_mass_kg > 0.0 {
        reusable_flight_cost_usd / result.payload_mass_kg
    } else {
        0.0
    };

    VehicleCostBreakdown {
        airframe_ddte_usd,
        engine_ddte_usd,
        total_ddte_usd,
        airframe_tfu_usd,
        engine_tfu_usd,
        total_tfu_usd,
        avg_unit_hardware_usd,
        propellant_cost_usd,
        launch_ops_cost_usd,
        range_fee_usd,
        expendable_flight_cost_usd,
        reusable_flight_cost_usd,
        refurbishment_cost_usd,
        recovery_ops_cost_usd,
        cost_per_kg_payload_usd,
        integration_and_sepm_usd,
        commercial_price_margin_usd,
        predicted_market_launch_price_usd,
    }
}

fn transcost_org_factor_f8(veh: &ProvenanceVehicle) -> (f64, f64) {
    let mfr = veh.manufacturer.value.to_ascii_lowercase();
    let id = veh.id.value.as_str();
    // Returns (f8_flight_market, f8_ddte) normalized to continuous-line FY2026 CERs.
    if matches!(id, "sls_block_1" | "sls_block_1b" | "sls_block_2" | "ares_i" | "space_shuttle") {
        return (5.30, 8.10);
    }
    if matches!(id, "saturn_v" | "saturn_ib" | "saturn_i" | "energia" | "n1") {
        return (3.45, 2.15);
    }
    if matches!(id, "falcon_9" | "falcon_heavy") {
        return (4.35, 0.46);
    }
    if id == "falcon_1" {
        return (1.62, 0.32);
    }
    if id.starts_with("starship") {
        return (1.35, 1.25);
    }
    if mfr.contains("rocket lab") {
        return (1.65, 0.85);
    }
    if mfr.contains("spacex") || mfr.contains("firefly") || mfr.contains("relativity") {
        return (1.62, 0.50);
    }
    if mfr.contains("avio") || mfr.contains("ariane") || mfr.contains("esa") {
        if id.starts_with("vega") {
            return (2.85, 2.38);
        }
        return (4.15, 5.75);
    }
    if id == "delta_iv_heavy" || (mfr.contains("boeing") && id.starts_with("delta")) {
        return (5.20, 2.45);
    }
    if id.starts_with("atlas") {
        return (4.85, 1.18);
    }
    if id.starts_with("vulcan") || mfr.contains("blue origin") {
        return (2.05, 1.42);
    }
    if mfr.contains("kari") || id.starts_with("kslv") {
        return (2.30, 2.55);
    }
    if mfr.contains("mhi") || mfr.contains("mitsubishi") || mfr.contains("jaxa") {
        return (2.58, 1.02);
    }
    if id == "lm_5" {
        return (1.50, 2.40);
    }
    if mfr.contains("casc") || mfr.contains("calt") || mfr.contains("sast") || mfr.contains("isro") {
        return (1.28, 1.15);
    }
    if mfr.contains("khrunichev") || mfr.contains("progress") || mfr.contains("roscosmos") {
        return (1.15, 0.95);
    }
    (1.65, 1.15)
}

pub fn predict_heritage_vehicle_cost(
    veh: &ProvenanceVehicle,
    engines_map: &HashMap<String, EngineSpec>,
) -> (f64, f64) {
    let a_struct_ddte_usd = 1_150_000.0;
    let b_struct_ddte = 0.55;
    let a_struct_tfu_usd = 18_500.0;
    let b_struct_tfu = 0.62;
    let a_eng_ddte_usd = 2_550_000.0;
    let a_eng_tfu_usd = 42_000.0;

    let (f8_flight, f8_ddte) = transcost_org_factor_f8(veh);
    let s1_prop = parse_heritage_propellant(&veh.s1_propellant.value);
    let s2_prop = parse_heritage_propellant(&veh.s2_propellant.value);
    let s1_mat = infer_heritage_material(&veh.id.value, 1, s1_prop);
    let s2_mat = infer_heritage_material(&veh.id.value, 2, s2_prop);
    let s1_eng = engines_map.get(&veh.s1_engine_id.value);
    let s2_eng = engines_map.get(&veh.s2_engine_id.value);

    let s1_eng_cnt = veh.s1_engine_count.value.max(1) as usize;
    let s2_eng_cnt = veh.s2_engine_count.value.max(1) as usize;

    let s1_params = s1_eng.map(|spec| {
        let burn_s = if veh.s1_burn_time_s.value > 1.0 {
            veh.s1_burn_time_s.value
        } else {
            veh.s1_prop_mass_kg.value.max(100.0)
                / (spec.mass_flow_rate_kg_s * (s1_eng_cnt as f64)).max(1.0)
        };
        effective_heritage_engine_params(spec, s1_prop, veh.s1_prop_mass_kg.value.max(100.0), burn_s, s1_eng_cnt)
    });
    let s2_params = s2_eng.map(|spec| {
        let burn_s = if veh.s2_burn_time_s.value > 1.0 {
            veh.s2_burn_time_s.value
        } else {
            veh.s2_prop_mass_kg.value.max(100.0)
                / (spec.mass_flow_rate_kg_s * (s2_eng_cnt as f64)).max(1.0)
        };
        effective_heritage_engine_params(spec, s2_prop, veh.s2_prop_mass_kg.value.max(100.0), burn_s, s2_eng_cnt)
    });

    let is_s1_solid = s1_prop == PropellantType::SolidHtpb
        || s1_eng.map(|e| e.propulsion_type == super::models::engine::PropulsionType::Solid).unwrap_or(false);
    let is_s2_solid = s2_prop == PropellantType::SolidHtpb
        || s2_eng.map(|e| e.propulsion_type == super::models::engine::PropulsionType::Solid).unwrap_or(false);

    let s1_eng_mass_kg = if is_s1_solid {
        0.0
    } else {
        s1_params.map(|(dry, _, _)| dry * (s1_eng_cnt as f64)).unwrap_or(0.0)
    };
    let s2_eng_mass_kg = if is_s2_solid {
        0.0
    } else {
        s2_params.map(|(dry, _, _)| dry * (s2_eng_cnt as f64)).unwrap_or(0.0)
    };

    let s1_airframe_kg = (veh.s1_dry_mass_kg.value - s1_eng_mass_kg).max(80.0);
    let s2_airframe_kg = if veh.s2_dry_mass_kg.value > 10.0 {
        (veh.s2_dry_mass_kg.value - s2_eng_mass_kg).max(40.0)
    } else {
        0.0
    };

    let s1_f_mat = get_material_properties(s1_mat).cost_material_factor;
    let s2_f_mat = get_material_properties(s2_mat).cost_material_factor;
    let s1_f_prop = propellant_struct_cost_factor(s1_prop);
    let s2_f_prop = propellant_struct_cost_factor(s2_prop);

    let mut airframe_ddte_usd =
        a_struct_ddte_usd * s1_airframe_kg.powf(b_struct_ddte) * s1_f_mat * s1_f_prop;
    let mut s1_tfu_usd = a_struct_tfu_usd * s1_airframe_kg.powf(b_struct_tfu) * s1_f_mat * s1_f_prop;
    let mut s2_tfu_usd = 0.0;
    if s2_airframe_kg > 0.0 {
        airframe_ddte_usd +=
            a_struct_ddte_usd * s2_airframe_kg.powf(b_struct_ddte) * 1.25 * s2_f_mat * s2_f_prop;
        s2_tfu_usd = a_struct_tfu_usd * s2_airframe_kg.powf(b_struct_tfu) * s2_f_mat * s2_f_prop;
    }

    let mut engine_ddte_usd = 0.0;
    let mut seen_engines: HashMap<String, f64> = HashMap::new();
    let mut add_eng_cost = |eng_opt: Option<&EngineSpec>, eff_opt: Option<(f64, f64, f64)>, stage_prop: PropellantType, stage_dry_kg: f64, count: f64, is_solid_core: bool| -> f64 {
        let Some(spec) = eng_opt else {
            return 0.0;
        };
        if spec.propulsion_type == super::models::engine::PropulsionType::Solid {
            if is_solid_core {
                let ref_dry = stage_dry_kg.max(50.0);
                let e_ddte = a_struct_ddte_usd * ref_dry.powf(b_struct_ddte) * 0.45;
                seen_engines.entry(format!("{}_{:.0}", spec.id, ref_dry)).or_insert(e_ddte);
                return a_struct_tfu_usd * ref_dry.powf(b_struct_tfu) * 0.40 * count;
            }
            let e_ddte = a_struct_ddte_usd * spec.dry_mass_kg.max(50.0).powf(b_struct_ddte) * 0.50;
            seen_engines.entry(spec.id.clone()).or_insert(e_ddte);
            let u_tfu = if spec.unit_cost_usd > 0.0 {
                spec.unit_cost_usd
            } else {
                a_struct_tfu_usd * spec.dry_mass_kg.max(50.0).powf(b_struct_tfu) * 0.65
            };
            return u_tfu * count;
        }
        let (_, eff_thrust_n, _) = eff_opt.unwrap_or((spec.dry_mass_kg, spec.thrust_vac_n, spec.mass_flow_rate_kg_s));
        let t_kn = (eff_thrust_n / 1_000.0).max(1.0);
        let p_bar = spec.chamber_pressure_bar.max(10.0);
        let f_cyc = if spec.propellant != stage_prop && stage_prop == PropellantType::HypergolicNtoUdmh {
            1.45
        } else {
            cycle_cost_factor(spec.cycle)
        };
        let f_prp = propellant_cost_factor(stage_prop);
        let e_ddte = a_eng_ddte_usd * t_kn.powf(0.535) * p_bar.powf(0.21) * f_cyc * f_prp;
        seen_engines.entry(format!("{}_{:?}_{:.0}", spec.id, stage_prop, t_kn)).or_insert(e_ddte);
        let e_tfu = a_eng_tfu_usd * t_kn.powf(0.485) * p_bar.powf(0.18) * f_cyc * f_prp;
        e_tfu * count
    };

    s1_tfu_usd += add_eng_cost(s1_eng, s1_params, s1_prop, veh.s1_dry_mass_kg.value, s1_eng_cnt as f64, is_s1_solid);
    if veh.s2_dry_mass_kg.value > 10.0 {
        s2_tfu_usd += add_eng_cost(s2_eng, s2_params, s2_prop, veh.s2_dry_mass_kg.value, s2_eng_cnt as f64, is_s2_solid);
    }

    let mut s3_tfu_usd = 0.0;
    if veh.stage_count.value >= 3 {
        let res_dry_kg = (veh.total_dry_mass_kg.value
            - veh.s1_dry_mass_kg.value
            - veh.s2_dry_mass_kg.value
            - (veh.booster_dry_mass_kg.value * (veh.booster_count.value as f64)))
            .max(350.0);
        airframe_ddte_usd += a_struct_ddte_usd * res_dry_kg.powf(b_struct_ddte) * 1.15 * s2_f_prop;
        s3_tfu_usd = a_struct_tfu_usd * res_dry_kg.powf(b_struct_tfu) * 1.15 * s2_f_prop;
    }

    let mut booster_tfu_usd = 0.0;
    let mut b_eng_total_cnt_f = 0.0;
    if veh.booster_count.value > 0 {
        let n_b = veh.booster_count.value as f64;
        let b_eng_opt = engines_map.get(&veh.booster_engine_id.value);
        let b_cnt_raw = veh.booster_engine_count.value.max(1) as usize;
        if veh.booster_type.value == "liquid" {
            let b_prop = parse_heritage_propellant(&veh.booster_propellant.value);
            let b_prop_kg = veh.booster_prop_mass_kg.value.max(1_000.0);
            let b_burn_s = veh.booster_burn_time_s.value.max(80.0);
            let n_b_usize = veh.booster_count.value.max(1) as usize;
            let b_cnt = if let Some(b_eng) = b_eng_opt {
                if n_b_usize > 1
                    && b_cnt_raw >= n_b_usize
                    && ((b_cnt_raw as f64) * b_eng.mass_flow_rate_kg_s > 1.5 * (b_prop_kg / b_burn_s))
                {
                    (b_cnt_raw / n_b_usize).max(1)
                } else {
                    b_cnt_raw
                }
            } else {
                b_cnt_raw
            };
            b_eng_total_cnt_f = (b_cnt as f64) * n_b;
            let b_params = b_eng_opt.map(|spec| effective_heritage_engine_params(spec, b_prop, b_prop_kg, b_burn_s, b_cnt));
            let b_eng_mass = b_params.map(|(dry, _, _)| dry * (b_cnt as f64)).unwrap_or(0.0);
            let b_air = (veh.booster_dry_mass_kg.value - b_eng_mass).max(80.0);
            let b_f_prop = propellant_struct_cost_factor(b_prop);
            airframe_ddte_usd += a_struct_ddte_usd * b_air.powf(b_struct_ddte) * 0.70 * b_f_prop;
            let single_air_tfu = a_struct_tfu_usd * b_air.powf(b_struct_tfu) * b_f_prop;
            let single_eng_tfu = add_eng_cost(b_eng_opt, b_params, b_prop, veh.booster_dry_mass_kg.value, b_cnt as f64, false);
            booster_tfu_usd = (single_air_tfu + single_eng_tfu) * n_b;
        } else if let Some(b_spec) = b_eng_opt {
            b_eng_total_cnt_f = n_b;
            airframe_ddte_usd += a_struct_ddte_usd * b_spec.dry_mass_kg.max(50.0).powf(b_struct_ddte) * 0.50;
            let u_tfu = if b_spec.unit_cost_usd > 0.0 {
                b_spec.unit_cost_usd
            } else {
                a_struct_tfu_usd * b_spec.dry_mass_kg.max(50.0).powf(b_struct_tfu) * 0.65
            };
            booster_tfu_usd = u_tfu * n_b;
        }
    }

    for ddte_val in seen_engines.values() {
        engine_ddte_usd += *ddte_val;
    }

    let fairing_mass_est_kg = (std::f64::consts::PI
        * veh.fairing_diameter_m.value.max(1.0)
        * veh.fairing_length_m.value.max(2.0)
        * 0.70
        * 10.8)
        .max(100.0);
    let fairing_tfu_usd = a_struct_tfu_usd * fairing_mass_est_kg.powf(b_struct_tfu) * 1.35;

    let mfr_lower = veh.manufacturer.value.to_ascii_lowercase();
    let is_continuous_line = mfr_lower.contains("spacex") || mfr_lower.contains("rocket lab");
    let prod_qty = if veh.id.value == "falcon_heavy" {
        veh.total_launches.value.max(90).min(120)
    } else if is_continuous_line {
        veh.total_launches.value.clamp(12, 120)
    } else {
        (veh.total_launches.value / 4).clamp(6, 28)
    };
    let is_reusable = matches!(
        veh.id.value.as_str(),
        "falcon_9" | "falcon_heavy" | "starship" | "starship_b2" | "new_glenn" | "neutron"
    );
    let n_reuses = if is_reusable { 12.0 } else { 1.0 };

    let s1_avg_usd = calc_learning_curve_avg_usd(s1_tfu_usd, prod_qty, 0.85);
    let s2_avg_usd = calc_learning_curve_avg_usd(s2_tfu_usd, prod_qty, 0.85);
    let s3_avg_usd = calc_learning_curve_avg_usd(s3_tfu_usd, prod_qty, 0.85);
    let bst_avg_usd = calc_learning_curve_avg_usd(booster_tfu_usd, prod_qty, 0.85);
    let fair_avg_usd = calc_learning_curve_avg_usd(fairing_tfu_usd, prod_qty, 0.85);

    let mut hw_flight_usd = s2_avg_usd
        + s3_avg_usd
        + if is_reusable { 0.20 * fair_avg_usd + 350_000.0 } else { fair_avg_usd };
    if is_reusable {
        let f_refurb = if s1_prop == PropellantType::LoxCh4 { 0.08 } else { 0.14 };
        hw_flight_usd += s1_avg_usd / n_reuses + f_refurb * s1_avg_usd + 450_000.0;
        if bst_avg_usd > 0.0 {
            hw_flight_usd += bst_avg_usd / n_reuses + 0.14 * bst_avg_usd + 380_000.0;
        }
    } else {
        hw_flight_usd += s1_avg_usd + bst_avg_usd;
    }

    let mut prop_cost_usd = 0.0;
    for (p_mass_kg, p_type, eng_opt) in [
        (veh.s1_prop_mass_kg.value, s1_prop, s1_eng),
        (veh.s2_prop_mass_kg.value, s2_prop, s2_eng),
    ] {
        if p_mass_kg <= 0.0 {
            continue;
        }
        let (c_f, c_o) = propellant_prices_usd_per_kg(p_type);
        let of_r = eng_opt.map(|e| e.oxidizer_fuel_ratio).unwrap_or(2.6);
        if of_r > 0.0 {
            let m_ox = p_mass_kg * (of_r / (1.0 + of_r));
            let m_fu = p_mass_kg - m_ox;
            prop_cost_usd += m_ox * c_o + m_fu * c_f;
        } else {
            prop_cost_usd += p_mass_kg * 2.50;
        }
    }

    let glow_scale = (veh.glow_kg.value.max(5_000.0) / 350_000.0).powf(0.45).clamp(0.22, 4.20);
    let cryo_ops = if s1_prop == PropellantType::LoxLh2 || s2_prop == PropellantType::LoxLh2 {
        1.35
    } else {
        1.0
    };
    let tot_eng_cnt = (veh.s1_engine_count.value as f64)
        + (veh.s2_engine_count.value as f64)
        + b_eng_total_cnt_f;
    let ops_range_usd = (3_500_000.0 * glow_scale * cryo_ops * (1.0 + 0.03 * tot_eng_cnt))
        + (1_200_000.0 * glow_scale.powf(0.45));

    let is_gov_heavy_program = matches!(
        veh.id.value.as_str(),
        "sls_block_1" | "sls_block_1b" | "sls_block_2" | "space_shuttle" | "ares_i" | "saturn_v" | "saturn_ib" | "energia" | "n1"
    );
    let cadence_standing_army_usd = if is_gov_heavy_program && veh.total_launches.value <= 15 && veh.glow_kg.value > 1_000_000.0 {
        120_000_000.0 * glow_scale
    } else {
        0.0
    };

    let sepm_usd = 0.16 * (s1_avg_usd + s2_avg_usd + s3_avg_usd + bst_avg_usd + fair_avg_usd);
    let raw_flight_usd = hw_flight_usd + prop_cost_usd + ops_range_usd + sepm_usd + cadence_standing_army_usd;
    let predicted_launch_cost_usd = raw_flight_usd * f8_flight;
    let predicted_ddte_usd = (airframe_ddte_usd + engine_ddte_usd) * f8_ddte;
    (predicted_launch_cost_usd, predicted_ddte_usd)
}
