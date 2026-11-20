use super::physics::G0_M_S2;

#[derive(Debug, Clone)]
pub struct AscentThrottleReport {
    pub effective_boost_isp_s: f64,
    pub max_q_pa: f64,
    pub peak_accel_g: f64,
    pub active_engines_at_burnout: usize,
    pub continuous_throttle_at_burnout: f64,
}

pub fn calc_upper_stage_fairing_phased_dv_m_s(
    isp_vac_s: f64,
    m_prop_kg: f64,
    m_dry_stage_kg: f64,
    m_fairing_kg: f64,
    m_payload_kg: f64,
    dv_pre_jettison_target_m_s: f64,
) -> (f64, f64, f64) {
    let m_initial_2a_kg = m_prop_kg + m_dry_stage_kg + m_fairing_kg + m_payload_kg;
    let m_final_no_jettison_kg = m_dry_stage_kg + m_fairing_kg + m_payload_kg;
    if m_initial_2a_kg <= m_final_no_jettison_kg || m_fairing_kg <= 0.0 {
        let ratio = (m_initial_2a_kg / m_final_no_jettison_kg.max(1.0)).max(1.0);
        let dv_total_m_s = isp_vac_s * G0_M_S2 * ratio.ln();
        return (dv_total_m_s, dv_total_m_s, 0.0);
    }

    let eff_vel_m_s = isp_vac_s * G0_M_S2;
    let dv_all_with_fairing_m_s = eff_vel_m_s * (m_initial_2a_kg / m_final_no_jettison_kg).ln();
    if dv_all_with_fairing_m_s <= dv_pre_jettison_target_m_s {
        return (dv_all_with_fairing_m_s, dv_all_with_fairing_m_s, 0.0);
    }

    let exp_2a = (-dv_pre_jettison_target_m_s / eff_vel_m_s).exp();
    let m_final_2a_kg = m_initial_2a_kg * exp_2a;
    let m_initial_2b_kg = m_final_2a_kg - m_fairing_kg;
    let m_final_2b_kg = m_dry_stage_kg + m_payload_kg;
    if m_initial_2b_kg <= m_final_2b_kg || m_final_2b_kg <= 0.0 {
        return (dv_pre_jettison_target_m_s, dv_pre_jettison_target_m_s, 0.0);
    }

    let dv_2b_m_s = eff_vel_m_s * (m_initial_2b_kg / m_final_2b_kg).ln();
    let dv_total_m_s = dv_pre_jettison_target_m_s + dv_2b_m_s;
    (dv_total_m_s, dv_pre_jettison_target_m_s, dv_2b_m_s)
}

pub fn solve_upper_prop_with_fairing_jettison_kg(
    isp_vac_s: f64,
    dv_target_m_s: f64,
    k_struct: f64,
    m_engines_kg: f64,
    m_fairing_kg: f64,
    m_payload_kg: f64,
    dv_pre_jettison_target_m_s: f64,
) -> Option<f64> {
    let mut lo_kg = 10.0;
    let mut hi_kg = (m_payload_kg + m_fairing_kg + m_engines_kg) * 25.0 + 500_000.0;
    let eval_dv = |mp_kg: f64| -> f64 {
        let m_dry_kg = m_engines_kg + (k_struct * mp_kg - m_engines_kg).max(0.0);
        let (dv_tot, _, _) = calc_upper_stage_fairing_phased_dv_m_s(
            isp_vac_s,
            mp_kg,
            m_dry_kg,
            m_fairing_kg,
            m_payload_kg,
            dv_pre_jettison_target_m_s,
        );
        dv_tot
    };

    if eval_dv(hi_kg) < dv_target_m_s {
        for _ in 0..8 {
            hi_kg *= 2.0;
            if eval_dv(hi_kg) >= dv_target_m_s {
                break;
            }
        }
        if eval_dv(hi_kg) < dv_target_m_s {
            return None;
        }
    }

    for _ in 0..48 {
        let mid_kg = 0.5 * (lo_kg + hi_kg);
        if eval_dv(mid_kg) < dv_target_m_s {
            lo_kg = mid_kg;
        } else {
            hi_kg = mid_kg;
        }
    }
    Some(hi_kg)
}

pub fn calc_max_q_pa(liftoff_tw0: f64, max_q_throttle_frac: f64) -> f64 {
    let rho_at_max_q_kg_m3 = 0.36;
    let v_max_q_m_s = 395.0 * (liftoff_tw0 / 1.35).sqrt() * max_q_throttle_frac.sqrt();
    0.5 * rho_at_max_q_kg_m3 * v_max_q_m_s * v_max_q_m_s
}

pub fn apply_max_q_throttle_bucket(
    isp_sl_s: f64,
    isp_vac_s: f64,
    total_burn_time_s: f64,
    max_q_throttle_frac: f64,
    bucket_duration_s: f64,
) -> f64 {
    let isp_nominal_avg_s = 0.5 * (isp_sl_s + isp_vac_s);
    if total_burn_time_s <= 1.0 || bucket_duration_s <= 0.0 {
        return isp_nominal_avg_s;
    }
    let clamped_bucket_s = bucket_duration_s.min(0.35 * total_burn_time_s);
    let bucket_frac = clamped_bucket_s / total_burn_time_s;
    let throttle_penalty = (1.0 - max_q_throttle_frac).max(0.0) * 0.03;
    isp_nominal_avg_s * (1.0 - bucket_frac * throttle_penalty)
}

pub fn calc_clamped_burnout_accel_g(
    thrust_per_engine_vac_n: f64,
    engine_count: usize,
    min_throttle_frac: f64,
    burnout_mass_kg: f64,
    g_limit: f64,
) -> (f64, usize, f64) {
    if burnout_mass_kg <= 0.0 || engine_count == 0 {
        return (1e6, engine_count, 1.0);
    }
    let target_thrust_n = g_limit * G0_M_S2 * burnout_mass_kg;
    let full_thrust_n = thrust_per_engine_vac_n * (engine_count as f64);
    if full_thrust_n <= target_thrust_n {
        let accel_g = full_thrust_n / (burnout_mass_kg * G0_M_S2);
        return (accel_g, engine_count, 1.0);
    }

    let min_thrust_all_n = full_thrust_n * min_throttle_frac;
    if target_thrust_n >= min_thrust_all_n {
        let throttle_frac = target_thrust_n / full_thrust_n;
        let accel_g = target_thrust_n / (burnout_mass_kg * G0_M_S2);
        return (accel_g, engine_count, throttle_frac);
    }

    let mut active = engine_count;
    while active > 1 {
        let active_min_n = (active as f64) * thrust_per_engine_vac_n * min_throttle_frac;
        if active_min_n <= target_thrust_n {
            let throttle_frac = (target_thrust_n / ((active as f64) * thrust_per_engine_vac_n)).clamp(min_throttle_frac, 1.0);
            let delivered_n = (active as f64) * thrust_per_engine_vac_n * throttle_frac;
            return (delivered_n / (burnout_mass_kg * G0_M_S2), active, throttle_frac);
        }
        active -= 1;
    }

    let min_possible_n = thrust_per_engine_vac_n * min_throttle_frac;
    let accel_g = min_possible_n / (burnout_mass_kg * G0_M_S2);
    (accel_g, 1, min_throttle_frac)
}
