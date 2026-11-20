use super::ascent_events::{
    apply_max_q_throttle_bucket, calc_clamped_burnout_accel_g, calc_max_q_pa,
    calc_upper_stage_fairing_phased_dv_m_s, solve_upper_prop_with_fairing_jettison_kg,
};
use super::cost_engine::{compute_vehicle_cost_breakdown, CostModelParameters};
use super::models::engine::{EngineSpec, PropellantProperties, PropellantType};
use super::models::mission::{
    CryoStateMode, MissionPreset, RecoveryMode, StagingArchitectureMode, TankMaterialPreset,
};
use super::models::vehicle::{
    AdvancedModelDefaults, MetricUncertaintyBounds, StageConfig, StageSizingMetrics,
    VehicleConfiguration, VehicleCostBreakdown, VehicleSizingResult, VehicleUncertaintyProfile,
};
use super::packaging::{solve_engine_circle_packing, EnginePlacementInput, PackingConstraints};
use super::physics::{
    calc_boost_phase_dv_m_s, calc_boost_phase_eff_isp_s, calc_delta_v_budget, calc_k,
    calc_m_prop_for_dv, calc_mass_ratio, refine_delta_v_budget_for_vehicle, G0_M_S2,
};
use super::reusability::allocate_reusability_masses;
use super::structures::{
    estimate_stage_structural_breakdown, size_fairing, StageStructuralInputs,
};
use std::collections::HashMap;

pub fn default_stage_mf(propellant: PropellantType, stage_number: u8) -> f64 {
    match (propellant, stage_number) {
        (PropellantType::LoxLh2, 1) => 0.91,
        (PropellantType::LoxLh2, _) => 0.88,
        (PropellantType::LoxRp1, 1) => 0.94,
        (PropellantType::LoxRp1, _) => 0.93,
        (PropellantType::LoxCh4, 1) => 0.925,
        (PropellantType::LoxCh4, _) => 0.91,
        (PropellantType::HypergolicNtoUdmh, 1) => 0.92,
        (PropellantType::HypergolicNtoUdmh, _) => 0.90,
        (PropellantType::SolidHtpb, _) => 0.88,
    }
}

pub fn calc_stage_k_with_constraints(
    propellant: PropellantType,
    stage_number: u8,
    mf_override: Option<f64>,
    config: &VehicleConfiguration,
    subcooled: bool,
) -> f64 {
    let constraint_mf = match propellant {
        PropellantType::LoxLh2 => config.constraints.mf_lox_lh2,
        PropellantType::LoxRp1 => config.constraints.mf_lox_rp1,
        PropellantType::LoxCh4 => config.constraints.mf_lox_ch4,
        PropellantType::SolidHtpb => config.constraints.mf_solid,
        PropellantType::HypergolicNtoUdmh => None,
    };
    let base_mf = mf_override
        .or(constraint_mf)
        .unwrap_or_else(|| default_stage_mf(propellant, stage_number));
    let adjusted_mf = if subcooled && matches!(propellant, PropellantType::LoxCh4 | PropellantType::LoxRp1) {
        (base_mf + 0.008).min(0.955)
    } else {
        base_mf
    };
    calc_k(adjusted_mf, 1.0 + config.mass_margin_frac)
}

pub fn calc_stage_k(
    propellant: PropellantType,
    stage_number: u8,
    mf_override: Option<f64>,
    mass_margin_frac: f64,
    subcooled: bool,
) -> f64 {
    let base_mf = mf_override.unwrap_or_else(|| default_stage_mf(propellant, stage_number));
    let adjusted_mf = if subcooled && matches!(propellant, PropellantType::LoxCh4 | PropellantType::LoxRp1) {
        (base_mf + 0.008).min(0.955)
    } else {
        base_mf
    };
    calc_k(adjusted_mf, 1.0 + mass_margin_frac)
}

fn record_violation(
    violations: &mut HashMap<String, usize>,
    messages: &mut Vec<String>,
    key: &str,
    msg: String,
) {
    let entry = violations.entry(key.to_string()).or_insert(0);
    *entry += 1;
    messages.push(msg);
}

pub fn calc_staging_separation_effects(
    mode: StagingArchitectureMode,
    stage_count: u8,
    adv: &AdvancedModelDefaults,
) -> (f64, f64) {
    let sep_events = (stage_count.saturating_sub(1)) as f64;
    match mode {
        StagingArchitectureMode::ColdPneumaticUllage => (
            G0_M_S2 * adv.cold_sep_ullage_s.max(0.0) * sep_events,
            adv.cold_interstage_mass_kg.max(0.0) * sep_events,
        ),
        StagingArchitectureMode::HotStagingVentedRing => {
            (0.0, adv.hot_staging_ring_mass_kg.max(0.0) * sep_events)
        }
    }
}

fn upper_stage_recovery_fractions(mode: RecoveryMode) -> (f64, f64) {
    match mode {
        RecoveryMode::Expendable => (0.0, 0.0),
        RecoveryMode::ParachuteMidAirCatch => (0.072, 0.010),
        RecoveryMode::DownrangeLandingAsds => (0.095, 0.055),
        RecoveryMode::ReturnToLaunchSiteRtls => (0.110, 0.075),
    }
}

fn solve_upper_stage_prop_for_k(
    stage_cfg: &StageConfig,
    eng: &EngineSpec,
    dv_target_m_s: f64,
    m_above_kg: f64,
    m_fairing_kg: f64,
    fairing_jettison_dv_m_s: f64,
    is_top_stage: bool,
    k_stage: f64,
) -> Result<(f64, f64, f64), String> {
    let (rec_hw_frac, rec_prop_frac) = upper_stage_recovery_fractions(stage_cfg.recovery_mode);
    let k_eff = k_stage * (1.0 + rec_hw_frac) + rec_prop_frac * (1.0 + k_stage);
    let m_eng_total_kg = eng.dry_mass_kg * (stage_cfg.engine_count as f64);

    if is_top_stage && m_fairing_kg > 0.0 {
        let solved_prop_kg = solve_upper_prop_with_fairing_jettison_kg(
            eng.isp_vac_s,
            dv_target_m_s,
            k_eff,
            m_eng_total_kg,
            m_fairing_kg,
            m_above_kg,
            fairing_jettison_dv_m_s,
        )
        .ok_or_else(|| format!("Stage {} infeasible for target dV {dv_target_m_s:.0} m/s", stage_cfg.stage_number))?;
        let m_dry_tmp_kg = m_eng_total_kg + (k_eff * solved_prop_kg - m_eng_total_kg).max(0.0);
        let (dv_del, _, _) = calc_upper_stage_fairing_phased_dv_m_s(
            eng.isp_vac_s,
            solved_prop_kg,
            m_dry_tmp_kg,
            m_fairing_kg,
            m_above_kg,
            fairing_jettison_dv_m_s,
        );
        Ok((solved_prop_kg, dv_del, k_eff))
    } else {
        let mr = calc_mass_ratio(dv_target_m_s, eng.isp_vac_s);
        let mp_kg = calc_m_prop_for_dv(mr, m_above_kg, k_eff)
            .ok_or_else(|| format!("Stage {} infeasible mass ratio {mr:.2}", stage_cfg.stage_number))?;
        Ok((mp_kg, dv_target_m_s, k_eff))
    }
}

fn size_upper_stage_internal(
    stage_cfg: &StageConfig,
    eng: &EngineSpec,
    dv_target_m_s: f64,
    m_above_kg: f64,
    m_fairing_kg: f64,
    fairing_jettison_dv_m_s: f64,
    upper_engine_height_m: f64,
    is_top_stage: bool,
    config: &VehicleConfiguration,
) -> Result<(StageSizingMetrics, f64), String> {
    let subcooled = config.cryo_state == CryoStateMode::SubcooledDensified;
    let mut k_stage = calc_stage_k_with_constraints(
        eng.propellant,
        stage_cfg.stage_number,
        stage_cfg.structural_mass_fraction_override,
        config,
        subcooled,
    );
    let (rec_hw_frac, rec_prop_frac) = upper_stage_recovery_fractions(stage_cfg.recovery_mode);
    let m_eng_total_kg = eng.dry_mass_kg * (stage_cfg.engine_count as f64);
    let stage_dia_m = if stage_cfg.stage_number >= 2 {
        config.core_diameter_m * 0.98
    } else {
        config.core_diameter_m
    };

    let (mut m_prop_kg, mut dv_delivered_m_s, _) = solve_upper_stage_prop_for_k(
        stage_cfg,
        eng,
        dv_target_m_s,
        m_above_kg,
        m_fairing_kg,
        fairing_jettison_dv_m_s,
        is_top_stage,
        k_stage,
    )?;

    if stage_cfg.structural_mass_fraction_override.is_none() {
        for _iter in 0..4 {
            let probe_rec_prop_kg = m_prop_kg * rec_prop_frac;
            let probe_total_prop_kg = m_prop_kg + probe_rec_prop_kg;
            let probe_burn_s = probe_total_prop_kg / (eng.mass_flow_rate_kg_s * (stage_cfg.engine_count as f64)).max(1.0);
            let (_, probe_bd) = estimate_stage_structural_breakdown(
                &StageStructuralInputs {
                    stage_number: stage_cfg.stage_number,
                    is_top_stage,
                    propellant: eng.propellant,
                    engine_cycle: eng.cycle,
                    m_core_prop_kg: probe_total_prop_kg,
                    core_diameter_m: stage_dia_m,
                    max_accel_g: config.g_limit.clamp(2.0, 6.0),
                    m_above_kg,
                    m_payload_kg: config.payload_mass_kg,
                    engine_count: stage_cfg.engine_count,
                    engine_dry_mass_kg: eng.dry_mass_kg,
                    engine_thrust_vac_n: eng.thrust_vac_n,
                    engine_mass_flow_kg_s: eng.mass_flow_rate_kg_s,
                    engine_height_m: eng.height_m,
                    upper_engine_height_m,
                    burn_time_s: probe_burn_s,
                    of_ratio: Some(eng.oxidizer_fuel_ratio).filter(|&v| v > 0.0),
                    material: stage_cfg.tank_material,
                    pressurization: stage_cfg.pressurization,
                    common_bulkhead: stage_cfg.common_bulkhead,
                    subcooled,
                    staging_mode: config.staging_mode,
                    coast_duration_s: config.orbit.coast_duration_s,
                    recovery_hw_kg: 0.0,
                    strapon_inert_real_kg: 0.0,
                    mass_margin_frac: config.mass_margin_frac,
                },
                &config.advanced_defaults,
            );
            let k_phys = (probe_bd.predicted_dry_unmargined_kg / m_prop_kg.max(10.0)).clamp(0.03, 0.35);
            let k_target = k_phys * (1.0 + config.mass_margin_frac);
            let k_next = 0.45 * k_stage + 0.55 * k_target;
            if let Ok((next_mp, next_dv, _)) = solve_upper_stage_prop_for_k(
                stage_cfg,
                eng,
                dv_target_m_s,
                m_above_kg,
                m_fairing_kg,
                fairing_jettison_dv_m_s,
                is_top_stage,
                k_next,
            ) {
                if (next_mp - m_prop_kg).abs() / m_prop_kg.max(1.0) < 1.0e-3 {
                    k_stage = k_next;
                    m_prop_kg = next_mp;
                    dv_delivered_m_s = next_dv;
                    break;
                }
                k_stage = k_next;
                m_prop_kg = next_mp;
                dv_delivered_m_s = next_dv;
            } else {
                break;
            }
        }
    }

    let m_base_inert_kg = k_stage * m_prop_kg;
    let m_rec_hw_kg = m_base_inert_kg * rec_hw_frac;
    let m_rec_prop_kg = m_prop_kg * rec_prop_frac;
    let m_ascent_prop_kg = m_prop_kg;
    let m_total_prop_kg = m_ascent_prop_kg + m_rec_prop_kg;
    let m_struct_kg = (m_base_inert_kg - m_eng_total_kg).max(0.0);
    let m_inert_kg = m_eng_total_kg + m_struct_kg + m_rec_hw_kg;
    let m_inert_unmargined_kg = m_inert_kg / (1.0 + config.mass_margin_frac).max(1.0);
    let m_stage_total_kg = m_total_prop_kg + m_inert_kg;
    let m0_kg = m_stage_total_kg + m_above_kg + if is_top_stage { m_fairing_kg } else { 0.0 };
    let thrust_vac_n = eng.thrust_vac_n * (stage_cfg.engine_count as f64);
    let thrust_sl_n = eng.thrust_sl_n * (stage_cfg.engine_count as f64);
    let thrust_min_vac_n = thrust_vac_n * eng.min_throttle_frac;
    let tw0 = thrust_vac_n / (m0_kg * G0_M_S2);
    let mf_kg = m0_kg - m_ascent_prop_kg - if is_top_stage { m_fairing_kg } else { 0.0 };
    let (clamped_g, _active_eng, _thr) = calc_clamped_burnout_accel_g(
        eng.thrust_vac_n,
        stage_cfg.engine_count,
        eng.min_throttle_frac,
        mf_kg,
        config.g_limit,
    );
    let accel_core_burnout_margined_g = thrust_min_vac_n / (mf_kg.max(1.0) * G0_M_S2);
    let mf_unmargined_kg = (mf_kg - (m_inert_kg - m_inert_unmargined_kg)).max(1.0);
    let accel_core_burnout_unmargined_g = thrust_min_vac_n / (mf_unmargined_kg * G0_M_S2);
    let tw_burnout = thrust_vac_n / (mf_kg.max(1.0) * G0_M_S2);
    let burn_time_s = m_total_prop_kg / (eng.mass_flow_rate_kg_s * (stage_cfg.engine_count as f64)).max(1.0);

    let prop_props = PropellantProperties::from_type(eng.propellant, Some(eng.oxidizer_fuel_ratio).filter(|&v| v > 0.0), subcooled);
    let (fuel_mass_kg, ox_mass_kg) = prop_props.split_masses_kg(m_total_prop_kg);
    let (fuel_volume_m3, ox_volume_m3) = prop_props.tank_volumes_m3(m_total_prop_kg, config.advanced_defaults.ullage_volume_frac.clamp(0.005, 0.15));

    let (tank_geometry, structural_breakdown) = estimate_stage_structural_breakdown(
        &StageStructuralInputs {
            stage_number: stage_cfg.stage_number,
            is_top_stage,
            propellant: eng.propellant,
            engine_cycle: eng.cycle,
            m_core_prop_kg: m_total_prop_kg,
            core_diameter_m: stage_dia_m,
            max_accel_g: clamped_g.max(2.0),
            m_above_kg,
            m_payload_kg: config.payload_mass_kg,
            engine_count: stage_cfg.engine_count,
            engine_dry_mass_kg: eng.dry_mass_kg,
            engine_thrust_vac_n: eng.thrust_vac_n,
            engine_mass_flow_kg_s: eng.mass_flow_rate_kg_s,
            engine_height_m: eng.height_m,
            upper_engine_height_m,
            burn_time_s,
            of_ratio: Some(eng.oxidizer_fuel_ratio).filter(|&v| v > 0.0),
            material: stage_cfg.tank_material,
            pressurization: stage_cfg.pressurization,
            common_bulkhead: stage_cfg.common_bulkhead,
            subcooled,
            staging_mode: config.staging_mode,
            coast_duration_s: config.orbit.coast_duration_s,
            recovery_hw_kg: m_rec_hw_kg / (1.0 + config.mass_margin_frac).max(1.0),
            strapon_inert_real_kg: 0.0,
            mass_margin_frac: config.mass_margin_frac,
        },
        &config.advanced_defaults,
    );
    let stage_height_m = tank_geometry.stage_tanks_length_m + eng.height_m + 1.2;

    let metrics = StageSizingMetrics {
        stage_number: stage_cfg.stage_number,
        engine_id: eng.id.clone(),
        engine_name: eng.name.clone(),
        propellant: eng.propellant,
        engine_count: stage_cfg.engine_count,
        strapon_engine_id: None,
        strapon_engine_name: None,
        strapon_count: 0,
        m0_kg,
        stage_total_mass_kg: m_stage_total_kg,
        propellant_mass_kg: m_total_prop_kg,
        ascent_propellant_kg: m_ascent_prop_kg,
        recovery_propellant_kg: m_rec_prop_kg,
        strapon_propellant_kg: 0.0,
        m_liquid_prop_kg: m_total_prop_kg,
        m_liquid_burned_boost_kg: 0.0,
        m_boost_burnout_kg: m0_kg,
        m0_core_only_kg: m0_kg,
        m_core_burnout_kg: mf_kg,
        inert_mass_kg: m_inert_kg,
        m_inert_unmargined_kg,
        engines_mass_kg: m_eng_total_kg,
        strapon_inert_kg: 0.0,
        recovery_hardware_kg: m_rec_hw_kg,
        structure_budget_kg: m_struct_kg,
        propellant_mass_fraction: m_total_prop_kg / m_stage_total_kg.max(1.0),
        k_structural: k_stage,
        mass_ratio: m0_kg / mf_kg.max(1.0),
        mr_max: 1.0 + 1.0 / k_stage.max(1e-4),
        delta_v_required_m_s: dv_target_m_s,
        delta_v_delivered_m_s: dv_delivered_m_s,
        dv_margin_m_s: dv_delivered_m_s - dv_target_m_s,
        dv_split_frac: stage_cfg.delta_v_split_frac,
        isp_sizing_s: eng.isp_vac_s,
        boost_eff_isp_s: None,
        boost_phase_dv_m_s: None,
        core_only_dv_m_s: Some(dv_delivered_m_s),
        thrust_sl_n,
        thrust_vac_n,
        thrust_core_sl_n: thrust_sl_n,
        thrust_core_vac_n: thrust_vac_n,
        thrust_core_min_vac_n: thrust_min_vac_n,
        thrust_strapon_sl_n: 0.0,
        thrust_strapon_vac_n: 0.0,
        tw0_ignition: tw0,
        tw_before_booster_sep: None,
        tw_after_booster_sep: None,
        tw_burnout,
        max_accel_g: clamped_g,
        accel_boost_end_unmargined_g: None,
        accel_boost_end_margined_g: None,
        accel_core_burnout_unmargined_g,
        accel_core_burnout_margined_g,
        burn_time_s,
        strapon_burn_time_s: None,
        core_burn_margin_s: None,
        of_ratio: prop_props.of_ratio,
        ox_mass_kg,
        fuel_mass_kg,
        ox_volume_m3,
        fuel_volume_m3,
        bulk_density_kg_m3: prop_props.bulk_density_kg_m3,
        stage_diameter_m: stage_dia_m,
        slenderness_ld: stage_height_m / stage_dia_m.max(0.1),
        tank_geometry,
        structural_breakdown,
        stage_height_m,
    };
    Ok((metrics, m_stage_total_kg))
}

fn solve_stage1_with_optional_strapons(
    s1_cfg: &StageConfig,
    core_eng: &EngineSpec,
    strapon_eng: Option<&EngineSpec>,
    n_strapons: usize,
    dv1_target_m_s: f64,
    m_above_kg: f64,
    hot_staging_penalty_kg: f64,
    upper_engine_height_m: f64,
    config: &VehicleConfiguration,
) -> Result<StageSizingMetrics, String> {
    let subcooled = config.cryo_state == CryoStateMode::SubcooledDensified;
    let mut k1 = calc_stage_k_with_constraints(
        core_eng.propellant,
        1,
        s1_cfg.structural_mass_fraction_override,
        config,
        subcooled,
    );
    let n_core = s1_cfg.engine_count;
    let m_core_eng_kg = core_eng.dry_mass_kg * (n_core as f64);

    let has_strapons = strapon_eng.is_some() && n_strapons > 0;
    let booster_rec_hw_frac = match config.booster_recovery_mode {
        RecoveryMode::Expendable => 0.0,
        RecoveryMode::ParachuteMidAirCatch => 0.068,
        RecoveryMode::DownrangeLandingAsds => 0.052,
        RecoveryMode::ReturnToLaunchSiteRtls => 0.057,
    };
    let (strap_prop_tot_kg, strap_inert_real_kg, strap_inert_margined_kg, strap_rec_hw_kg, strap_sl_n, strap_vac_n, strap_mdot_kg_s, strap_t_burn_s, strap_isp_avg_s) =
        if let Some(s_eng) = strapon_eng.filter(|_| n_strapons > 0) {
            let nf = n_strapons as f64;
            let prop_kg = s_eng.propellant_mass_kg * nf;
            let inert_base_kg = s_eng.dry_mass_kg * nf;
            let rec_hw_kg = inert_base_kg * booster_rec_hw_frac;
            let inert_real_kg = inert_base_kg + rec_hw_kg;
            let inert_marg_kg = inert_real_kg * (1.0 + config.mass_margin_frac);
            let mdot_s = if s_eng.burn_time_s > 0.0 {
                s_eng.propellant_mass_kg / s_eng.burn_time_s
            } else {
                s_eng.mass_flow_rate_kg_s
            };
            (
                prop_kg,
                inert_real_kg,
                inert_marg_kg,
                rec_hw_kg,
                s_eng.thrust_sl_n * nf,
                s_eng.thrust_vac_n * nf,
                mdot_s * nf,
                s_eng.burn_time_s,
                s_eng.isp_avg_s,
            )
        } else {
            (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
        };

    let core_mdot_tot_kg_s = core_eng.mass_flow_rate_kg_s * (n_core as f64);
    let m_burn_liquid_boost_kg = core_mdot_tot_kg_s * strap_t_burn_s;
    let approx_burn_s = 165.0;
    let core_isp_bucket_s = apply_max_q_throttle_bucket(
        core_eng.isp_sl_s,
        core_eng.isp_vac_s,
        approx_burn_s,
        config.max_q_throttle_frac,
        config.max_q_bucket_duration_s,
    );

    let solve_core_prop_for_k = |k_val: f64| -> Result<(f64, f64, f64, f64, f64), String> {
        let eval_s1_dv = |mp_core_total_kg: f64| -> (f64, f64, f64, f64) {
            let m_core_inert_base_kg = k_val * mp_core_total_kg;
            let alloc = allocate_reusability_masses(
                s1_cfg.recovery_mode,
                mp_core_total_kg,
                m_core_inert_base_kg,
                core_eng.isp_vac_s,
                core_eng.isp_sl_s,
                2_100.0,
            );
            let m_core_inert_total_kg = m_core_inert_base_kg + alloc.total_added_hardware_kg + hot_staging_penalty_kg;
            let glow_kg = m_above_kg + mp_core_total_kg + m_core_inert_total_kg + strap_prop_tot_kg + strap_inert_margined_kg;
            let mp_ascent_kg = alloc.ascent_propellant_kg;
            if !has_strapons {
                let mf_kg = glow_kg - mp_ascent_kg;
                if mf_kg <= 0.0 || glow_kg <= mf_kg {
                    return (-1.0, glow_kg, 0.0, 0.0);
                }
                let dv_m_s = core_isp_bucket_s * G0_M_S2 * (glow_kg / mf_kg).ln();
                return (dv_m_s, glow_kg, 0.0, dv_m_s);
            }

            if mp_ascent_kg <= m_burn_liquid_boost_kg * 1.02 {
                return (-1.0, glow_kg, 0.0, 0.0);
            }
            let isp_eff_boost_s = calc_boost_phase_eff_isp_s(
                strap_isp_avg_s,
                core_isp_bucket_s,
                strap_mdot_kg_s,
                core_mdot_tot_kg_s,
            );
            let dv_boost_m_s = calc_boost_phase_dv_m_s(glow_kg, strap_prop_tot_kg, m_burn_liquid_boost_kg, isp_eff_boost_s);
            let m0_core_only_kg = glow_kg - m_burn_liquid_boost_kg - strap_prop_tot_kg - strap_inert_real_kg;
            let remaining_ascent_kg = mp_ascent_kg - m_burn_liquid_boost_kg;
            let mf_core_kg = m0_core_only_kg - remaining_ascent_kg;
            if mf_core_kg <= 0.0 || m0_core_only_kg <= mf_core_kg {
                return (-1.0, glow_kg, dv_boost_m_s, 0.0);
            }
            let dv_core_m_s = core_eng.isp_vac_s * G0_M_S2 * (m0_core_only_kg / mf_core_kg).ln();
            (dv_boost_m_s + dv_core_m_s, glow_kg, dv_boost_m_s, dv_core_m_s)
        };

        let mut lo_kg = (m_burn_liquid_boost_kg * 1.05).max(500.0);
        let mut hi_kg = (m_above_kg + strap_prop_tot_kg) * 20.0 + 6_000_000.0;
        let (dv_hi_m_s, _, _, _) = eval_s1_dv(hi_kg);
        if dv_hi_m_s < dv1_target_m_s {
            return Err(format!("Stage 1 cannot reach {dv1_target_m_s:.0} m/s with upper bound propellant."));
        }
        for _ in 0..52 {
            let mid_kg = 0.5 * (lo_kg + hi_kg);
            let (dv_mid_m_s, _, _, _) = eval_s1_dv(mid_kg);
            if dv_mid_m_s < dv1_target_m_s {
                lo_kg = mid_kg;
            } else {
                hi_kg = mid_kg;
            }
        }
        let mp_core_kg = hi_kg;
        let (dv_del_m_s, glow_kg, dv_boost_m_s, dv_core_m_s) = eval_s1_dv(mp_core_kg);
        Ok((mp_core_kg, dv_del_m_s, glow_kg, dv_boost_m_s, dv_core_m_s))
    };

    let (mut mp_core_kg, mut dv_del_m_s, mut glow_kg, mut dv_boost_m_s, mut dv_core_m_s) =
        solve_core_prop_for_k(k1)?;

    if s1_cfg.structural_mass_fraction_override.is_none() {
        for _iter in 0..4 {
            let probe_burn_s = mp_core_kg / core_mdot_tot_kg_s.max(1.0);
            let (_, probe_bd) = estimate_stage_structural_breakdown(
                &StageStructuralInputs {
                    stage_number: 1,
                    is_top_stage: config.stage_count <= 1,
                    propellant: core_eng.propellant,
                    engine_cycle: core_eng.cycle,
                    m_core_prop_kg: mp_core_kg,
                    core_diameter_m: config.core_diameter_m,
                    max_accel_g: config.g_limit.clamp(2.5, 6.0),
                    m_above_kg,
                    m_payload_kg: config.payload_mass_kg,
                    engine_count: n_core,
                    engine_dry_mass_kg: core_eng.dry_mass_kg,
                    engine_thrust_vac_n: core_eng.thrust_vac_n,
                    engine_mass_flow_kg_s: core_eng.mass_flow_rate_kg_s,
                    engine_height_m: core_eng.height_m,
                    upper_engine_height_m,
                    burn_time_s: probe_burn_s,
                    of_ratio: Some(core_eng.oxidizer_fuel_ratio).filter(|&v| v > 0.0),
                    material: s1_cfg.tank_material,
                    pressurization: s1_cfg.pressurization,
                    common_bulkhead: s1_cfg.common_bulkhead,
                    subcooled,
                    staging_mode: config.staging_mode,
                    coast_duration_s: 0.0,
                    recovery_hw_kg: 0.0,
                    strapon_inert_real_kg: 0.0,
                    mass_margin_frac: config.mass_margin_frac,
                },
                &config.advanced_defaults,
            );
            let base_core_dry_kg = (probe_bd.predicted_dry_unmargined_kg - hot_staging_penalty_kg).max(m_core_eng_kg);
            let k_phys = (base_core_dry_kg / mp_core_kg.max(10.0)).clamp(0.028, 0.35);
            let k_target = k_phys * (1.0 + config.mass_margin_frac);
            let k_next = 0.45 * k1 + 0.55 * k_target;
            if let Ok((next_mp, next_dv, next_glow, next_boost, next_core_dv)) = solve_core_prop_for_k(k_next) {
                if (next_mp - mp_core_kg).abs() / mp_core_kg.max(1.0) < 1.0e-3 {
                    k1 = k_next;
                    mp_core_kg = next_mp;
                    dv_del_m_s = next_dv;
                    glow_kg = next_glow;
                    dv_boost_m_s = next_boost;
                    dv_core_m_s = next_core_dv;
                    break;
                }
                k1 = k_next;
                mp_core_kg = next_mp;
                dv_del_m_s = next_dv;
                glow_kg = next_glow;
                dv_boost_m_s = next_boost;
                dv_core_m_s = next_core_dv;
            } else {
                break;
            }
        }
    }

    let m_core_inert_base_kg = k1 * mp_core_kg;
    let alloc = allocate_reusability_masses(
        s1_cfg.recovery_mode,
        mp_core_kg,
        m_core_inert_base_kg,
        core_eng.isp_vac_s,
        core_eng.isp_sl_s,
        2_100.0,
    );
    let m_inert_tot_kg = m_core_inert_base_kg + alloc.total_added_hardware_kg + hot_staging_penalty_kg + strap_inert_margined_kg;
    let m_inert_unmargined_kg = m_inert_tot_kg / (1.0 + config.mass_margin_frac).max(1.0);
    let m_prop_tot_kg = mp_core_kg + strap_prop_tot_kg;
    let m_stage_tot_kg = m_prop_tot_kg + m_inert_tot_kg;
    let m_struct_kg = (m_core_inert_base_kg - m_core_eng_kg).max(0.0);

    let thrust_core_sl_n = core_eng.thrust_sl_n * (n_core as f64);
    let thrust_core_vac_n = core_eng.thrust_vac_n * (n_core as f64);
    let thrust_core_min_vac_n = thrust_core_vac_n * core_eng.min_throttle_frac;
    let liftoff_thrust_sl_n = thrust_core_sl_n + strap_sl_n;
    let tw0 = liftoff_thrust_sl_n / (glow_kg * G0_M_S2);
    let mf_ascent_kg = glow_kg - alloc.ascent_propellant_kg - strap_prop_tot_kg - strap_inert_real_kg;
    let m0_core_only_kg = if has_strapons {
        glow_kg - m_burn_liquid_boost_kg - strap_prop_tot_kg - strap_inert_real_kg
    } else {
        glow_kg
    };
    let m_boost_burnout_kg = if has_strapons {
        glow_kg - m_burn_liquid_boost_kg - strap_prop_tot_kg
    } else {
        glow_kg
    };
    let (tw_before_booster_sep, tw_after_booster_sep, accel_boost_end_margined_g, accel_boost_end_unmargined_g) =
        if has_strapons {
            let tw_pre = (thrust_core_vac_n + strap_vac_n) / (m_boost_burnout_kg.max(1.0) * G0_M_S2);
            let tw_post = thrust_core_vac_n / (m0_core_only_kg.max(1.0) * G0_M_S2);
            let a_boost_marg = (thrust_core_min_vac_n + strap_vac_n) / (m_boost_burnout_kg.max(1.0) * G0_M_S2);
            let unmarg_drop = strap_inert_margined_kg - strap_inert_real_kg;
            let a_boost_unmarg = (thrust_core_min_vac_n + strap_vac_n) / (m_boost_burnout_kg - unmarg_drop).max(1.0) / G0_M_S2;
            (Some(tw_pre), Some(tw_post), Some(a_boost_marg), Some(a_boost_unmarg))
        } else {
            (None, None, None, None)
        };
    let (clamped_g, _, _) = calc_clamped_burnout_accel_g(
        core_eng.thrust_vac_n,
        n_core,
        core_eng.min_throttle_frac,
        mf_ascent_kg,
        config.g_limit,
    );
    let accel_core_burnout_margined_g = thrust_core_min_vac_n / (mf_ascent_kg.max(1.0) * G0_M_S2);
    let mf_ascent_unmarg_kg = (mf_ascent_kg - (m_inert_tot_kg - m_inert_unmargined_kg)).max(1.0);
    let accel_core_burnout_unmargined_g = thrust_core_min_vac_n / (mf_ascent_unmarg_kg * G0_M_S2);
    let tw_burnout = (thrust_core_vac_n + if has_strapons { 0.0 } else { strap_vac_n }) / (mf_ascent_kg.max(1.0) * G0_M_S2);
    let burn_time_s = mp_core_kg / core_mdot_tot_kg_s.max(1.0);
    let core_burn_margin_s = if has_strapons {
        Some(burn_time_s - strap_t_burn_s)
    } else {
        None
    };
    let isp_eff_boost_opt = if has_strapons {
        Some(calc_boost_phase_eff_isp_s(
            strap_isp_avg_s,
            core_isp_bucket_s,
            strap_mdot_kg_s,
            core_mdot_tot_kg_s,
        ))
    } else {
        None
    };

    let prop_props = PropellantProperties::from_type(
        core_eng.propellant,
        Some(core_eng.oxidizer_fuel_ratio).filter(|&v| v > 0.0),
        subcooled,
    );
    let (fuel_mass_kg, ox_mass_kg) = prop_props.split_masses_kg(mp_core_kg);
    let (fuel_volume_m3, ox_volume_m3) = prop_props.tank_volumes_m3(mp_core_kg, config.advanced_defaults.ullage_volume_frac.clamp(0.005, 0.15));

    let total_rec_hw_unmarg_kg = (alloc.total_added_hardware_kg + strap_rec_hw_kg) / (1.0 + config.mass_margin_frac).max(1.0);
    let (tank_geometry, structural_breakdown) = estimate_stage_structural_breakdown(
        &StageStructuralInputs {
            stage_number: 1,
            is_top_stage: config.stage_count <= 1,
            propellant: core_eng.propellant,
            engine_cycle: core_eng.cycle,
            m_core_prop_kg: mp_core_kg,
            core_diameter_m: config.core_diameter_m,
            max_accel_g: clamped_g.max(2.5),
            m_above_kg,
            m_payload_kg: config.payload_mass_kg,
            engine_count: n_core,
            engine_dry_mass_kg: core_eng.dry_mass_kg,
            engine_thrust_vac_n: core_eng.thrust_vac_n,
            engine_mass_flow_kg_s: core_eng.mass_flow_rate_kg_s,
            engine_height_m: core_eng.height_m,
            upper_engine_height_m,
            burn_time_s,
            of_ratio: Some(core_eng.oxidizer_fuel_ratio).filter(|&v| v > 0.0),
            material: s1_cfg.tank_material,
            pressurization: s1_cfg.pressurization,
            common_bulkhead: s1_cfg.common_bulkhead,
            subcooled,
            staging_mode: config.staging_mode,
            coast_duration_s: 0.0,
            recovery_hw_kg: total_rec_hw_unmarg_kg,
            strapon_inert_real_kg: strap_inert_real_kg - strap_rec_hw_kg,
            mass_margin_frac: config.mass_margin_frac,
        },
        &config.advanced_defaults,
    );
    let stage_height_m = tank_geometry.stage_tanks_length_m + core_eng.height_m + 1.8;

    Ok(StageSizingMetrics {
        stage_number: 1,
        engine_id: core_eng.id.clone(),
        engine_name: core_eng.name.clone(),
        propellant: core_eng.propellant,
        engine_count: n_core,
        strapon_engine_id: strapon_eng.filter(|_| n_strapons > 0).map(|e| e.id.clone()),
        strapon_engine_name: strapon_eng.filter(|_| n_strapons > 0).map(|e| e.name.clone()),
        strapon_count: n_strapons,
        m0_kg: glow_kg,
        stage_total_mass_kg: m_stage_tot_kg,
        propellant_mass_kg: m_prop_tot_kg,
        ascent_propellant_kg: alloc.ascent_propellant_kg + strap_prop_tot_kg,
        recovery_propellant_kg: alloc.recovery_propellant_kg,
        strapon_propellant_kg: strap_prop_tot_kg,
        m_liquid_prop_kg: mp_core_kg,
        m_liquid_burned_boost_kg: m_burn_liquid_boost_kg,
        m_boost_burnout_kg,
        m0_core_only_kg,
        m_core_burnout_kg: mf_ascent_kg,
        inert_mass_kg: m_inert_tot_kg,
        m_inert_unmargined_kg,
        engines_mass_kg: m_core_eng_kg,
        strapon_inert_kg: strap_inert_margined_kg,
        recovery_hardware_kg: alloc.total_added_hardware_kg + strap_rec_hw_kg,
        structure_budget_kg: m_struct_kg,
        propellant_mass_fraction: m_prop_tot_kg / m_stage_tot_kg.max(1.0),
        k_structural: k1,
        mass_ratio: glow_kg / mf_ascent_kg.max(1.0),
        mr_max: 1.0 + 1.0 / k1.max(1e-4),
        delta_v_required_m_s: dv1_target_m_s,
        delta_v_delivered_m_s: dv_del_m_s,
        dv_margin_m_s: dv_del_m_s - dv1_target_m_s,
        dv_split_frac: s1_cfg.delta_v_split_frac,
        isp_sizing_s: core_isp_bucket_s,
        boost_eff_isp_s: isp_eff_boost_opt,
        boost_phase_dv_m_s: if has_strapons { Some(dv_boost_m_s) } else { None },
        core_only_dv_m_s: if has_strapons { Some(dv_core_m_s) } else { None },
        thrust_sl_n: liftoff_thrust_sl_n,
        thrust_vac_n: thrust_core_vac_n + strap_vac_n,
        thrust_core_sl_n,
        thrust_core_vac_n,
        thrust_core_min_vac_n,
        thrust_strapon_sl_n: strap_sl_n,
        thrust_strapon_vac_n: strap_vac_n,
        tw0_ignition: tw0,
        tw_before_booster_sep,
        tw_after_booster_sep,
        tw_burnout,
        max_accel_g: clamped_g,
        accel_boost_end_unmargined_g,
        accel_boost_end_margined_g,
        accel_core_burnout_unmargined_g,
        accel_core_burnout_margined_g,
        burn_time_s,
        strapon_burn_time_s: if has_strapons { Some(strap_t_burn_s) } else { None },
        core_burn_margin_s,
        of_ratio: prop_props.of_ratio,
        ox_mass_kg,
        fuel_mass_kg,
        ox_volume_m3,
        fuel_volume_m3,
        bulk_density_kg_m3: prop_props.bulk_density_kg_m3,
        stage_diameter_m: config.core_diameter_m,
        slenderness_ld: stage_height_m / config.core_diameter_m.max(0.1),
        tank_geometry,
        structural_breakdown,
        stage_height_m,
    })
}

pub fn evaluate_vehicle_configuration(
    config: &VehicleConfiguration,
    engines_map: &HashMap<String, EngineSpec>,
) -> Result<VehicleSizingResult, String> {
    if config.stages.is_empty() {
        return Err("At least one stage configuration is required.".to_string());
    }
    let top_material = config.stages.last().map(|s| s.tank_material).unwrap_or(TankMaterialPreset::CfrpComposite);
    let fairing = size_fairing(
        config.fairing_profile,
        config.payload_diameter_m,
        config.payload_length_m,
        config.core_diameter_m,
        top_material,
    );

    let (ullage_loss_m_s, hot_staging_penalty_kg) = calc_staging_separation_effects(
        config.staging_mode,
        config.stage_count,
        &config.advanced_defaults,
    );
    let mut dv_budget = calc_delta_v_budget(
        &config.orbit,
        fairing.wave_drag_cd0,
        config.core_diameter_m,
        config.payload_mass_kg * 25.0,
        ullage_loss_m_s,
    );
    if let Some(override_dv) = config.required_delta_v_m_s {
        dv_budget.total_required_dv_m_s = override_dv;
    }

    let mut violations: HashMap<String, usize> = HashMap::new();
    let mut violation_messages: Vec<String> = Vec::new();

    let dv_margin_frac = (config.orbit.dv_margin_pct / 100.0).clamp(0.0, 0.25);
    let total_dv_req_m_s = if config.required_delta_v_m_s.is_some() {
        dv_budget.total_required_dv_m_s
    } else {
        dv_budget.total_required_dv_m_s * (1.0 + dv_margin_frac)
    };
    let mut sorted_stages = config.stages.clone();
    sorted_stages.sort_by_key(|s| s.stage_number);

    let sum_upper_split: f64 = sorted_stages.iter().skip(1).map(|s| s.delta_v_split_frac).sum();
    let s1_split = (1.0 - sum_upper_split).clamp(0.10, 0.90);

    let mut upper_metrics: Vec<StageSizingMetrics> = Vec::new();
    let mut m_above_kg = config.payload_mass_kg;
    let mut total_height_m = fairing.total_length_m;

    for idx in (1..sorted_stages.len()).rev() {
        let st_cfg = &sorted_stages[idx];
        let eng = engines_map
            .get(&st_cfg.engine_id)
            .ok_or_else(|| format!("Engine '{}' not found in catalog.", st_cfg.engine_id))?;
        let is_top = idx == sorted_stages.len() - 1;
        let upper_eng_h_m = if is_top {
            1.0
        } else {
            engines_map
                .get(&sorted_stages[idx + 1].engine_id)
                .map(|e| e.height_m)
                .unwrap_or(1.5)
        };
        let dv_stage_m_s = total_dv_req_m_s * st_cfg.delta_v_split_frac;
        let (st_metrics, m_stage_tot_kg) = size_upper_stage_internal(
            st_cfg,
            eng,
            dv_stage_m_s,
            m_above_kg,
            if is_top { fairing.mass_kg } else { 0.0 },
            fairing.jettison_dv_m_s,
            upper_eng_h_m,
            is_top,
            config,
        )?;
        if st_cfg.stage_number == 3 {
            if st_metrics.tw0_ignition < config.constraints.min_stage3_tw0
                || st_metrics.tw0_ignition > config.constraints.max_stage3_tw0
            {
                record_violation(
                    &mut violations,
                    &mut violation_messages,
                    "Stage 3 T/W0",
                    format!(
                        "Stage 3 T/W {:.2} outside [{:.2}, {:.2}]",
                        st_metrics.tw0_ignition, config.constraints.min_stage3_tw0, config.constraints.max_stage3_tw0
                    ),
                );
            }
        } else if st_metrics.tw0_ignition < config.constraints.min_upper_tw0
            || st_metrics.tw0_ignition > config.constraints.max_upper_tw0
        {
            record_violation(
                &mut violations,
                &mut violation_messages,
                "Stage 2 T/W0",
                format!(
                    "Stage {} T/W {:.2} outside [{:.2}, {:.2}]",
                    st_cfg.stage_number, st_metrics.tw0_ignition, config.constraints.min_upper_tw0, config.constraints.max_upper_tw0
                ),
            );
        }
        if st_metrics.engines_mass_kg > st_metrics.inert_mass_kg {
            record_violation(
                &mut violations,
                &mut violation_messages,
                "Hardware Mass",
                format!("Stage {} engine mass exceeds inert budget", st_cfg.stage_number),
            );
        }
        if st_metrics.tank_geometry.boiloff_loss_kg > 0.05 * st_metrics.propellant_mass_kg {
            record_violation(
                &mut violations,
                &mut violation_messages,
                "Coast Boil-Off",
                format!(
                    "Stage {} coast boil-off ({:.0} kg) exceeds 5% margin",
                    st_cfg.stage_number, st_metrics.tank_geometry.boiloff_loss_kg
                ),
            );
        }
        total_height_m += st_metrics.stage_height_m + 1.4;
        m_above_kg += m_stage_tot_kg + if is_top { fairing.mass_kg } else { 0.0 };
        upper_metrics.push(st_metrics);
    }
    upper_metrics.reverse();

    let s1_cfg = &sorted_stages[0];
    let core_eng = engines_map
        .get(&s1_cfg.engine_id)
        .ok_or_else(|| format!("Core engine '{}' not found in catalog.", s1_cfg.engine_id))?;
    let strapon_eng = config
        .booster_engine_id
        .as_ref()
        .and_then(|id| engines_map.get(id));
    let s1_upper_eng_h_m = sorted_stages
        .get(1)
        .and_then(|st| engines_map.get(&st.engine_id))
        .map(|e| e.height_m)
        .unwrap_or(1.5);
    let dv1_req_m_s = total_dv_req_m_s * s1_split;
    let mut s1_metrics = solve_stage1_with_optional_strapons(
        s1_cfg,
        core_eng,
        strapon_eng,
        config.booster_count,
        dv1_req_m_s,
        m_above_kg,
        hot_staging_penalty_kg,
        s1_upper_eng_h_m,
        config,
    )?;
    s1_metrics.dv_split_frac = s1_split;
    total_height_m += s1_metrics.stage_height_m;

    let mut all_stages = vec![s1_metrics.clone()];
    all_stages.extend(upper_metrics);

    let glow_kg = s1_metrics.m0_kg;
    if config.required_delta_v_m_s.is_none() && config.orbit.preset == MissionPreset::Custom {
        dv_budget = refine_delta_v_budget_for_vehicle(
            &dv_budget,
            glow_kg,
            config.core_diameter_m,
            fairing.wave_drag_cd0,
            s1_metrics.tw0_ignition,
            s1_metrics.burn_time_s,
        );
    }
    let total_dry_mass_kg: f64 = all_stages.iter().map(|s| s.inert_mass_kg).sum::<f64>() + fairing.mass_kg;
    let total_propellant_kg: f64 = all_stages.iter().map(|s| s.propellant_mass_kg).sum();
    let total_delivered_dv_m_s: f64 = all_stages.iter().map(|s| s.delta_v_delivered_m_s).sum();
    dv_budget.total_delivered_dv_m_s = total_delivered_dv_m_s;

    let peak_accel_g = all_stages.iter().map(|s| s.max_accel_g).fold(0.0_f64, f64::max);
    let max_q_pa = calc_max_q_pa(s1_metrics.tw0_ignition, config.max_q_throttle_frac);
    let total_engine_count: usize = all_stages.iter().map(|s| s.engine_count + s.strapon_count).sum();

    let adv = &config.advanced_defaults;
    let mut packing_inputs = Vec::with_capacity(s1_cfg.engine_count);
    for idx in 0..s1_cfg.engine_count {
        let is_center_rigid = (s1_cfg.engine_count == 5 || s1_cfg.engine_count == 9) && idx == 0;
        let is_outer_fixed_33 = s1_cfg.engine_count == 33 && idx >= 13;
        let tvc_deg = if is_center_rigid || is_outer_fixed_33 {
            0.0
        } else {
            adv.tvc_angle_deg.max(core_eng.tvc_gimbal_range_deg)
        };
        packing_inputs.push(EnginePlacementInput {
            id: format!("{}_{}", core_eng.id, idx + 1),
            nozzle_diameter_m: core_eng.nozzle_diameter_m,
            gimbal_lever_arm_m: (core_eng.nozzle_diameter_m * adv.gimbal_lever_arm_ratio).max(0.35),
            tvc_angle_deg: tvc_deg,
            custom_x_m: None,
            custom_y_m: None,
            enabled: true,
        });
    }
    let pack_constraints = PackingConstraints {
        skirt_wall_thickness_m: adv.skirt_wall_thickness_m.max(0.005),
        skirt_clearance_m: adv.skirt_clearance_m.max(0.0),
        no_touch_margin_m: adv.no_touch_margin_m.max(0.0),
        default_tvc_angle_deg: adv.tvc_angle_deg.clamp(0.0, 20.0),
    };
    let pack_res = solve_engine_circle_packing(
        config.core_diameter_m,
        &packing_inputs,
        &pack_constraints,
    )?;

    if s1_metrics.engines_mass_kg > s1_metrics.inert_mass_kg {
        record_violation(
            &mut violations,
            &mut violation_messages,
            "Hardware Mass",
            "Stage 1 engine mass exceeds inert budget".to_string(),
        );
    }
    if s1_metrics.tw0_ignition < config.constraints.min_liftoff_tw0
        || s1_metrics.tw0_ignition > config.constraints.max_liftoff_tw0
    {
        record_violation(
            &mut violations,
            &mut violation_messages,
            "Liftoff T/W",
            format!(
                "Liftoff T/W {:.2} outside [{:.2}, {:.2}]",
                s1_metrics.tw0_ignition, config.constraints.min_liftoff_tw0, config.constraints.max_liftoff_tw0
            ),
        );
    }
    if let Some(tw_core_post) = s1_metrics.tw_after_booster_sep {
        if tw_core_post < config.constraints.min_core_only_tw0
            || tw_core_post > config.constraints.max_core_only_tw0
        {
            record_violation(
                &mut violations,
                &mut violation_messages,
                "Core-Only T/W",
                format!(
                    "Post-booster core T/W {:.2} outside [{:.2}, {:.2}]",
                    tw_core_post, config.constraints.min_core_only_tw0, config.constraints.max_core_only_tw0
                ),
            );
        }
    }
    if let Some(burn_margin_s) = s1_metrics.core_burn_margin_s {
        if burn_margin_s < 0.0 {
            record_violation(
                &mut violations,
                &mut violation_messages,
                "Core Burns Out In Boost",
                format!("Core burns out {:.1} s before booster separation", -burn_margin_s),
            );
        }
    }
    if config.booster_count > 0
        && (config.booster_count < config.constraints.min_strapon_count
            || config.booster_count > config.constraints.max_strapon_count)
    {
        record_violation(
            &mut violations,
            &mut violation_messages,
            "Strap-On Count",
            format!(
                "Strap-on count {} outside [{}, {}]",
                config.booster_count, config.constraints.min_strapon_count, config.constraints.max_strapon_count
            ),
        );
    }
    if peak_accel_g > config.constraints.max_g_limit + 0.05 {
        record_violation(
            &mut violations,
            &mut violation_messages,
            "G-Limit",
            format!("Peak acceleration {:.2} g exceeds limit {:.2} g", peak_accel_g, config.constraints.max_g_limit),
        );
    }
    let base_fits = pack_res.fits;
    if !base_fits {
        record_violation(
            &mut violations,
            &mut violation_messages,
            "Base Packing",
            format!(
                "{} x {} circle packing clash: requires {:.2} m diameter (usable base {:.2} m with boattail flare)",
                s1_cfg.engine_count, core_eng.name, pack_res.required_diameter_m, pack_res.usable_diameter_m
            ),
        );
    }
    let payload_frac = config.payload_mass_kg / glow_kg.max(1.0);
    if payload_frac < config.constraints.min_payload_frac
        || payload_frac > config.constraints.max_payload_frac
    {
        record_violation(
            &mut violations,
            &mut violation_messages,
            "Payload Fraction",
            format!(
                "Payload fraction {:.2}% outside [{:.2}%, {:.2}%]",
                payload_frac * 100.0,
                config.constraints.min_payload_frac * 100.0,
                config.constraints.max_payload_frac * 100.0
            ),
        );
    }
    if let Some(min_glow_kg) = config.constraints.min_glow_kg {
        if glow_kg < min_glow_kg {
            record_violation(
                &mut violations,
                &mut violation_messages,
                "GLOW Floor",
                format!("GLOW {glow_kg:.0} kg below floor {min_glow_kg:.0} kg"),
            );
        }
    }
    if let Some(max_glow_kg) = config.constraints.max_glow_kg {
        if glow_kg > max_glow_kg {
            record_violation(
                &mut violations,
                &mut violation_messages,
                "GLOW Ceiling",
                format!("GLOW {glow_kg:.0} kg exceeds cap {max_glow_kg:.0} kg"),
            );
        }
    }
    if let Some(max_dia_m) = config.constraints.max_core_diameter_m {
        if config.core_diameter_m > max_dia_m {
            record_violation(
                &mut violations,
                &mut violation_messages,
                "Core Diameter",
                format!("Core diameter {:.2} m exceeds cap {:.2} m", config.core_diameter_m, max_dia_m),
            );
        }
    }
    if let Some(max_h_m) = config.constraints.max_total_height_m {
        if total_height_m > max_h_m {
            record_violation(
                &mut violations,
                &mut violation_messages,
                "Height Ceiling",
                format!("Total height {total_height_m:.1} m exceeds cap {max_h_m:.1} m"),
            );
        }
    }
    if let Some(max_ld) = config.constraints.max_slenderness_ld {
        let vehicle_ld = total_height_m / config.core_diameter_m.max(0.1);
        if vehicle_ld > max_ld {
            record_violation(
                &mut violations,
                &mut violation_messages,
                "Slenderness L/D",
                format!("Vehicle L/D {vehicle_ld:.1} exceeds cap {max_ld:.1}"),
            );
        }
    }

    let max_width_m = if config.booster_count > 0 {
        config.core_diameter_m + 2.0 * (strapon_eng.map(|s| s.nozzle_diameter_m * 1.4).unwrap_or(3.0))
    } else {
        fairing.outer_diameter_m.max(config.core_diameter_m)
    };

    let config_label = if config.booster_count > 0 {
        let strap_name = strapon_eng.map(|s| s.name.as_str()).unwrap_or("Booster");
        let upper_desc: String = all_stages
            .iter()
            .skip(1)
            .map(|s| format!("{}x {}", s.engine_count, s.engine_name))
            .collect::<Vec<_>>()
            .join(" / ");
        format!("{}x {} + {}x {} / {}", s1_cfg.engine_count, core_eng.name, config.booster_count, strap_name, upper_desc)
    } else {
        all_stages
            .iter()
            .map(|s| format!("{}x {}", s.engine_count, s.engine_name))
            .collect::<Vec<_>>()
            .join(" / ")
    };

    let mut tmp_result = VehicleSizingResult {
        feasible: violations.is_empty(),
        config_label,
        glow_kg,
        total_dry_mass_kg,
        total_propellant_kg,
        payload_mass_kg: config.payload_mass_kg,
        payload_fraction: config.payload_mass_kg / glow_kg.max(1.0),
        total_height_m,
        core_diameter_m: config.core_diameter_m,
        max_width_m,
        liftoff_thrust_sl_n: s1_metrics.thrust_sl_n,
        liftoff_tw0: s1_metrics.tw0_ignition,
        peak_accel_g,
        max_q_pa,
        total_engine_count,
        delta_v_breakdown: dv_budget,
        fairing,
        stages: all_stages,
        cost_breakdown: VehicleCostBreakdown {
            airframe_ddte_usd: 0.0,
            engine_ddte_usd: 0.0,
            total_ddte_usd: 0.0,
            airframe_tfu_usd: 0.0,
            engine_tfu_usd: 0.0,
            total_tfu_usd: 0.0,
            avg_unit_hardware_usd: 0.0,
            propellant_cost_usd: 0.0,
            launch_ops_cost_usd: 0.0,
            range_fee_usd: 0.0,
            expendable_flight_cost_usd: 0.0,
            reusable_flight_cost_usd: 0.0,
            refurbishment_cost_usd: 0.0,
            recovery_ops_cost_usd: 0.0,
            cost_per_kg_payload_usd: 0.0,
            integration_and_sepm_usd: 0.0,
            commercial_price_margin_usd: 0.0,
            predicted_market_launch_price_usd: 0.0,
        },
        base_packing_fits: pack_res.fits,
        base_required_dia_m: pack_res.required_diameter_m,
        base_usable_dia_m: pack_res.usable_diameter_m,
        constraint_violations: violations.clone(),
        violation_messages: violation_messages.clone(),
        objective_score: glow_kg,
        uncertainty: None,
    };

    let materials: Vec<_> = sorted_stages.iter().map(|s| s.tank_material).collect();
    let recoveries: Vec<_> = sorted_stages.iter().map(|s| s.recovery_mode).collect();
    let cost_params = CostModelParameters {
        inflation_factor: 1.0,
        learning_rate: adv.learning_rate,
        production_quantity: config.production_quantity.max(1),
        expected_reuses: config.expected_reuses.max(1),
        fairing_reusable: config.fairing_reusable,
        booster_recovery_mode: config.booster_recovery_mode,
        refurb_cost_frac_override: adv.refurb_cost_frac_override,
        reusable_ddte_surcharge_frac: adv.reusable_ddte_surcharge_frac,
        range_fee_usd: adv.range_fee_usd,
        launch_ops_base_usd: adv.launch_ops_base_usd,
        recovery_ops_per_flight_usd: adv.recovery_ops_per_flight_usd,
    };
    tmp_result.cost_breakdown = compute_vehicle_cost_breakdown(&tmp_result, engines_map, &materials, &recoveries, &cost_params);
    tmp_result.uncertainty = Some(compute_vehicle_uncertainty_profile(&tmp_result, config));

    if let Some(max_cost_usd) = config.constraints.max_cost_usd {
        if tmp_result.cost_breakdown.reusable_flight_cost_usd > max_cost_usd {
            record_violation(
                &mut tmp_result.constraint_violations,
                &mut tmp_result.violation_messages,
                "Cost Ceiling",
                format!(
                    "Launch cost ${:.1}M exceeds cap ${:.1}M",
                    tmp_result.cost_breakdown.reusable_flight_cost_usd / 1.0e6,
                    max_cost_usd / 1.0e6
                ),
            );
            tmp_result.feasible = false;
        }
    }

    Ok(tmp_result)
}

pub fn compute_vehicle_uncertainty_profile(
    res: &VehicleSizingResult,
    config: &VehicleConfiguration,
) -> VehicleUncertaintyProfile {
    let nom_glow = res.glow_kg;
    let nom_dry = res.total_dry_mass_kg;
    let nom_price = if res.cost_breakdown.predicted_market_launch_price_usd > 0.0 {
        res.cost_breakdown.predicted_market_launch_price_usd
    } else {
        res.cost_breakdown.reusable_flight_cost_usd
    };
    let nom_ddte = res.cost_breakdown.total_ddte_usd;
    let nom_dv = res.delta_v_breakdown.total_delivered_dv_m_s;
    let nom_payload = config.payload_mass_kg;

    let glow_p10 = nom_glow * 0.94;
    let glow_p50 = nom_glow;
    let glow_p90 = nom_glow * 1.09;

    let dry_p10 = nom_dry * 0.95;
    let dry_p50 = nom_dry;
    let dry_p90 = nom_dry * 1.15;

    let price_p10 = nom_price * 0.90;
    let price_p50 = nom_price;
    let price_p90 = nom_price * 1.18;

    let ddte_p10 = nom_ddte * 0.88;
    let ddte_p50 = nom_ddte;
    let ddte_p90 = nom_ddte * 1.25;

    let dv_p10 = nom_dv * 1.025;
    let dv_p50 = nom_dv;
    let dv_p90 = nom_dv * 0.975;

    let payload_p10 = nom_payload * 1.08;
    let payload_p50 = nom_payload;
    let payload_p90 = nom_payload * 0.88;

    VehicleUncertaintyProfile {
        glow: MetricUncertaintyBounds {
            nominal: glow_p50,
            p10_optimistic: glow_p10,
            p50_median: glow_p50,
            p90_conservative: glow_p90,
            unit: "kg".to_string(),
        },
        dry_mass: MetricUncertaintyBounds {
            nominal: dry_p50,
            p10_optimistic: dry_p10,
            p50_median: dry_p50,
            p90_conservative: dry_p90,
            unit: "kg".to_string(),
        },
        launch_price_usd: MetricUncertaintyBounds {
            nominal: price_p50,
            p10_optimistic: price_p10,
            p50_median: price_p50,
            p90_conservative: price_p90,
            unit: "USD".to_string(),
        },
        ddte_usd: MetricUncertaintyBounds {
            nominal: ddte_p50,
            p10_optimistic: ddte_p10,
            p50_median: ddte_p50,
            p90_conservative: ddte_p90,
            unit: "USD".to_string(),
        },
        delivered_delta_v_m_s: MetricUncertaintyBounds {
            nominal: dv_p50,
            p10_optimistic: dv_p10,
            p50_median: dv_p50,
            p90_conservative: dv_p90,
            unit: "m/s".to_string(),
        },
        payload_capacity_kg: MetricUncertaintyBounds {
            nominal: payload_p50,
            p10_optimistic: payload_p10,
            p50_median: payload_p50,
            p90_conservative: payload_p90,
            unit: "kg".to_string(),
        },
        dispersion_assumptions: vec![
            "Specific Impulse (Isp) 3-sigma dispersion: ±1.5%".to_string(),
            "Structural Dry Mass Growth Allowance (AIAA S-020): -5% to +15%".to_string(),
            "Atmospheric & Steering Ascent Loss dispersion: ±2.5%".to_string(),
            "TRANSCOST / NAFCOM CER Statistical Standard Error: -10% to +18% on recurring cost".to_string(),
            "Development Programmatic Schedule & Technical Risk Growth: -12% to +25% on DDT&E".to_string(),
        ],
    }
}
