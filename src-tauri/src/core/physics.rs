use super::models::engine::EngineSpec;
use super::models::mission::{MissionPreset, OrbitTarget};
use super::models::vehicle::{
    DeltaVBudgetBreakdown, FairingSizingSummary, StageSizingMetrics, TrajectoryEvent,
    TrajectorySimulationResult, TrajectoryTimePoint, VehicleConfiguration,
};
use std::collections::HashMap;
use std::time::Instant;

pub const G0_M_S2: f64 = 9.80665;
pub const MU_EARTH_M3_S2: f64 = 3.986004418e14;
pub const R_EARTH_M: f64 = 6_378_137.0;
pub const OMEGA_EARTH_RAD_S: f64 = 7.2921159e-5;
pub const P_SL_PA: f64 = 101_325.0;
pub const RHO_SL_KG_M3: f64 = 1.225;
pub const DEFAULT_VAC_TO_SL_RATIO: f64 = 1.1;

pub fn calc_circle_area_m2(diameter_m: f64) -> f64 {
    let radius_m = 0.5 * diameter_m;
    std::f64::consts::PI * radius_m * radius_m
}

pub fn calc_orbit_velocity_m_s(altitude_m: f64) -> f64 {
    let orbit_radius_m = R_EARTH_M + altitude_m;
    let term1 = MU_EARTH_M3_S2 / orbit_radius_m;
    term1.sqrt()
}

pub fn calc_elliptical_orbit_velocity_m_s(perigee_alt_m: f64, apogee_alt_m: f64) -> (f64, f64, f64) {
    let rp_m = R_EARTH_M + perigee_alt_m.max(80_000.0);
    let ra_m = (R_EARTH_M + apogee_alt_m).max(rp_m);
    let semi_major_axis_m = 0.5 * (rp_m + ra_m);
    let eccentricity = (ra_m - rp_m) / (ra_m + rp_m);
    let term_vis_viva = MU_EARTH_M3_S2 * ((2.0 / rp_m) - (1.0 / semi_major_axis_m));
    (term_vis_viva.sqrt(), semi_major_axis_m, eccentricity)
}

pub fn resolve_orbit_perigee_apogee_m(orbit: &OrbitTarget) -> (f64, f64) {
    let hp_m = if orbit.perigee_altitude_m > 0.0 {
        orbit.perigee_altitude_m
    } else {
        orbit.altitude_m
    }
    .max(80_000.0);
    let ha_m = if orbit.apogee_altitude_m >= hp_m {
        orbit.apogee_altitude_m
    } else if orbit.eccentricity > 0.0 && orbit.eccentricity < 0.95 {
        let rp_m = R_EARTH_M + hp_m;
        let ra_m = rp_m * (1.0 + orbit.eccentricity) / (1.0 - orbit.eccentricity);
        (ra_m - R_EARTH_M).max(hp_m)
    } else {
        hp_m
    };
    (hp_m, ha_m)
}

pub fn calc_earth_rotation_assist_m_s(launch_latitude_deg: f64, launch_azimuth_deg: f64) -> f64 {
    let v_rot_equator_m_s = OMEGA_EARTH_RAD_S * R_EARTH_M;
    let lat_rad = launch_latitude_deg.to_radians();
    let az_rad = launch_azimuth_deg.to_radians();
    let term1 = v_rot_equator_m_s * lat_rad.cos();
    term1 * az_rad.sin()
}

pub fn calc_gravity_loss_m_s(stage_pitch_angles_deg: &[f64], stage_burn_times_s: &[f64]) -> f64 {
    let mut total_loss_m_s = 0.0;
    let count = stage_pitch_angles_deg.len().min(stage_burn_times_s.len());
    for idx in 0..count {
        let pitch_rad = stage_pitch_angles_deg[idx].to_radians();
        let g_eff_m_s2 = G0_M_S2 * pitch_rad.sin();
        total_loss_m_s += g_eff_m_s2 * stage_burn_times_s[idx];
    }
    total_loss_m_s
}

pub fn calc_aero_drag_loss_m_s(
    cd0: f64,
    core_diameter_m: f64,
    v_max_q_m_s: f64,
    rho_max_q_kg_m3: f64,
    transonic_duration_s: f64,
    transonic_mass_kg: f64,
) -> f64 {
    if transonic_mass_kg <= 0.0 {
        return 0.0;
    }
    let area_ref_m2 = calc_circle_area_m2(core_diameter_m);
    let q_dyn_pa = 0.5 * rho_max_q_kg_m3 * v_max_q_m_s * v_max_q_m_s;
    let drag_force_n = q_dyn_pa * cd0 * area_ref_m2;
    let impulse_n_s = drag_force_n * transonic_duration_s;
    impulse_n_s / transonic_mass_kg
}

pub fn calc_steering_loss_m_s(orbit_velocity_m_s: f64, turn_angle_deg: f64) -> f64 {
    let turn_rad = turn_angle_deg.to_radians();
    let loss_factor = 1.0 - turn_rad.cos();
    orbit_velocity_m_s * loss_factor
}

pub fn preset_delta_v_m_s(preset: MissionPreset) -> Option<f64> {
    match preset {
        MissionPreset::Leo285 => Some(9_250.0),
        MissionPreset::Leo516 => Some(9_400.0),
        MissionPreset::Sso980 => Some(9_600.0),
        MissionPreset::Gto => Some(11_700.0),
        MissionPreset::Tli => Some(12_450.0),
        MissionPreset::Tmi => Some(12_850.0),
        MissionPreset::Custom => None,
    }
}

pub fn calc_delta_v_budget(
    orbit: &OrbitTarget,
    cd0: f64,
    core_diameter_m: f64,
    estimated_glow_kg: f64,
    staging_ullage_loss_m_s: f64,
) -> DeltaVBudgetBreakdown {
    let (hp_m, ha_m) = resolve_orbit_perigee_apogee_m(orbit);
    let (orbit_velocity_m_s, _a_m, _ecc) = calc_elliptical_orbit_velocity_m_s(hp_m, ha_m);

    let inc_abs_deg = orbit.inclination_deg.abs().clamp(0.0, 180.0);
    let lat_abs_deg = orbit.launch_latitude_deg.abs().clamp(0.0, 89.9);
    let inc_rad = orbit.inclination_deg.to_radians();
    let lat_rad = orbit.launch_latitude_deg.to_radians();
    let (effective_az_deg, plane_change_dv_m_s) = if inc_abs_deg >= lat_abs_deg && lat_rad.cos() > 1e-6 {
        let sin_az = (inc_rad.cos() / lat_rad.cos()).clamp(-1.0, 1.0);
        (sin_az.asin().to_degrees(), 0.0)
    } else {
        let dogleg_half_rad = 0.5 * (lat_abs_deg - inc_abs_deg).to_radians();
        (90.0, 2.0 * orbit_velocity_m_s * dogleg_half_rad.sin())
    };
    let earth_rotation_assist_m_s =
        calc_earth_rotation_assist_m_s(orbit.launch_latitude_deg, effective_az_deg);

    if let Some(preset_dv_m_s) = preset_delta_v_m_s(orbit.preset) {
        let nominal_gravity_m_s = 1_220.0;
        let nominal_aero_m_s = 180.0 + (cd0 - 0.35).max(-0.15) * 200.0;
        let nominal_steering_m_s = 140.0 + plane_change_dv_m_s;
        let total_required_dv_m_s = preset_dv_m_s + staging_ullage_loss_m_s;
        return DeltaVBudgetBreakdown {
            orbit_velocity_m_s,
            insertion_margin_m_s: orbit.insertion_margin_m_s,
            gravity_loss_m_s: nominal_gravity_m_s,
            aero_drag_loss_m_s: nominal_aero_m_s,
            steering_loss_m_s: nominal_steering_m_s,
            earth_rotation_assist_m_s,
            staging_ullage_loss_m_s,
            total_required_dv_m_s,
            total_delivered_dv_m_s: 0.0,
        };
    }

    let dv_orbit_m_s = orbit_velocity_m_s + orbit.insertion_margin_m_s;
    let gravity_loss_m_s = calc_gravity_loss_m_s(&[52.0, 14.0], &[150.0, 320.0]);
    let transonic_mass_kg = (estimated_glow_kg * 0.72).max(10_000.0);
    let aero_drag_loss_m_s = calc_aero_drag_loss_m_s(
        cd0,
        core_diameter_m,
        420.0,
        0.38,
        32.0,
        transonic_mass_kg,
    );
    let steering_loss_m_s = calc_steering_loss_m_s(orbit_velocity_m_s, 11.0) + plane_change_dv_m_s;
    let term1 = dv_orbit_m_s + gravity_loss_m_s + aero_drag_loss_m_s + steering_loss_m_s;
    let base_required_m_s = (term1 - earth_rotation_assist_m_s + staging_ullage_loss_m_s).max(7_800.0);
    let total_required_dv_m_s = base_required_m_s;

    DeltaVBudgetBreakdown {
        orbit_velocity_m_s,
        insertion_margin_m_s: orbit.insertion_margin_m_s,
        gravity_loss_m_s,
        aero_drag_loss_m_s,
        steering_loss_m_s,
        earth_rotation_assist_m_s,
        staging_ullage_loss_m_s,
        total_required_dv_m_s,
        total_delivered_dv_m_s: 0.0,
    }
}

/// Fast vehicle-coupled gravity and aero loss approximation used after initial sizing.
pub fn refine_delta_v_budget_for_vehicle(
    base_budget: &DeltaVBudgetBreakdown,
    glow_kg: f64,
    core_diameter_m: f64,
    fairing_cd0: f64,
    liftoff_tw0: f64,
    s1_burn_s: f64,
) -> DeltaVBudgetBreakdown {
    let mut out = base_budget.clone();
    let tw_safe = liftoff_tw0.clamp(1.05, 2.5);
    let pitch_avg_deg = (58.0 - 10.0 * (tw_safe - 1.25)).clamp(38.0, 62.0);
    let burn_eff_s = (s1_burn_s.clamp(95.0, 260.0)) * 0.72;
    let s1_grav = G0_M_S2 * pitch_avg_deg.to_radians().sin() * burn_eff_s;
    let upper_grav = G0_M_S2 * 11.0_f64.to_radians().sin() * 240.0;
    out.gravity_loss_m_s = (s1_grav + upper_grav).clamp(850.0, 1_950.0);

    let v_max_q = 405.0 * (tw_safe / 1.35).sqrt();
    let transonic_mass = (glow_kg * 0.74).max(12_000.0);
    let aero_loss = calc_aero_drag_loss_m_s(
        fairing_cd0,
        core_diameter_m,
        v_max_q,
        0.38,
        34.0 / tw_safe.sqrt(),
        transonic_mass,
    );
    out.aero_drag_loss_m_s = aero_loss.clamp(55.0, 620.0);
    out.total_required_dv_m_s = (out.orbit_velocity_m_s
        + out.insertion_margin_m_s
        + out.gravity_loss_m_s
        + out.aero_drag_loss_m_s
        + out.steering_loss_m_s
        - out.earth_rotation_assist_m_s
        + out.staging_ullage_loss_m_s)
        .max(7_800.0);
    out
}

pub fn calc_k(mf: f64, multiplier: f64) -> f64 {
    let term1 = (1.0 - mf) / mf;
    term1 * multiplier
}

pub fn calc_mass_ratio(dv_m_s: f64, isp_s: f64) -> f64 {
    let exp_arg = dv_m_s / (G0_M_S2 * isp_s);
    exp_arg.exp()
}

pub fn calc_m_prop_for_dv(mr: f64, m_above_kg: f64, k_val: f64) -> Option<f64> {
    let denom = 1.0 + k_val * (1.0 - mr);
    if denom <= 0.0 {
        return None;
    }
    let num = (mr - 1.0) * m_above_kg;
    Some(num / denom)
}

pub fn calc_boost_phase_eff_isp_s(
    isp_strapon_s: f64,
    isp_core_s: f64,
    mdot_strapon_kg_s: f64,
    mdot_core_kg_s: f64,
) -> f64 {
    let num = isp_strapon_s * mdot_strapon_kg_s + isp_core_s * mdot_core_kg_s;
    let denom = mdot_strapon_kg_s + mdot_core_kg_s;
    if denom <= 0.0 {
        return isp_core_s;
    }
    num / denom
}

pub fn calc_boost_phase_dv_m_s(
    glow_kg: f64,
    m_strapon_prop_kg: f64,
    m_core_prop_boost_kg: f64,
    isp_eff_s: f64,
) -> f64 {
    let m_leftover_kg = glow_kg - m_strapon_prop_kg - m_core_prop_boost_kg;
    if m_leftover_kg <= 0.0 || glow_kg <= m_leftover_kg {
        return 0.0;
    }
    let ratio = glow_kg / m_leftover_kg;
    isp_eff_s * G0_M_S2 * ratio.ln()
}

pub fn estimate_vac_sl_ratio(
    thrust_vac_n: Option<f64>,
    thrust_sl_n: Option<f64>,
    isp_vac_s: Option<f64>,
    isp_sl_s: Option<f64>,
    exit_area_m2: Option<f64>,
) -> f64 {
    let ratio = if let Some(area_m2) = exit_area_m2 {
        if let Some(t_vac_n) = thrust_vac_n {
            let denom = t_vac_n - P_SL_PA * area_m2;
            if denom > 0.0 {
                t_vac_n / denom
            } else {
                DEFAULT_VAC_TO_SL_RATIO
            }
        } else if let Some(t_sl_n) = thrust_sl_n {
            let num = t_sl_n + P_SL_PA * area_m2;
            num / t_sl_n.max(1.0)
        } else {
            DEFAULT_VAC_TO_SL_RATIO
        }
    } else if let (Some(iv_s), Some(is_s)) = (isp_vac_s, isp_sl_s) {
        iv_s / is_s.max(1.0)
    } else if let (Some(tv_n), Some(ts_n)) = (thrust_vac_n, thrust_sl_n) {
        tv_n / ts_n.max(1.0)
    } else {
        DEFAULT_VAC_TO_SL_RATIO
    };
    ratio.clamp(1.0, 1.5)
}

pub fn estimate_thrust_sl_n(
    thrust_vac_n: f64,
    isp_vac_s: Option<f64>,
    isp_sl_s: Option<f64>,
    exit_area_m2: Option<f64>,
) -> f64 {
    let ratio = estimate_vac_sl_ratio(Some(thrust_vac_n), None, isp_vac_s, isp_sl_s, exit_area_m2);
    thrust_vac_n / ratio
}

pub fn estimate_isp_sl_s(
    isp_vac_s: f64,
    thrust_vac_n: Option<f64>,
    thrust_sl_n: Option<f64>,
    exit_area_m2: Option<f64>,
) -> f64 {
    let ratio = estimate_vac_sl_ratio(thrust_vac_n, thrust_sl_n, Some(isp_vac_s), None, exit_area_m2);
    isp_vac_s / ratio
}

/// US Standard Atmosphere 1976 approximation returning (rho kg/m^3, pressure Pa, speed of sound m/s).
pub fn std_atmosphere_props(alt_m: f64) -> (f64, f64, f64) {
    let h = alt_m.max(0.0);
    if h >= 140_000.0 {
        return (0.0, 0.0, 295.0);
    }
    let (temp_k, pressure_pa) = if h <= 11_000.0 {
        let t = 288.15 - 0.0065 * h;
        let p = P_SL_PA * (t / 288.15).powf(5.25588);
        (t, p)
    } else if h <= 20_000.0 {
        let p11 = 22_632.06;
        let p = p11 * (-G0_M_S2 * (h - 11_000.0) / (287.05 * 216.65)).exp();
        (216.65, p)
    } else if h <= 32_000.0 {
        let t = 216.65 + 0.0010 * (h - 20_000.0);
        let p20 = 5_474.89;
        let p = p20 * (216.65 / t).powf(34.1632);
        (t, p)
    } else if h <= 47_000.0 {
        let t = 228.65 + 0.0028 * (h - 32_000.0);
        let p32 = 868.02;
        let p = p32 * (228.65 / t).powf(12.2011);
        (t, p)
    } else {
        let p47 = 110.91;
        let p = p47 * (-(h - 47_000.0) / 7_200.0).exp();
        (240.0, p)
    };
    let rho = pressure_pa / (287.05 * temp_k.max(180.0));
    let a_sound = (1.4 * 287.05 * temp_k.max(180.0)).sqrt();
    (rho, pressure_pa, a_sound)
}

pub fn mach_drag_coeff(mach: f64, cd0: f64) -> f64 {
    let base = cd0.clamp(0.18, 0.75);
    if mach < 0.75 {
        base * 0.78
    } else if mach < 1.15 {
        base * (0.78 + 1.05 * ((mach - 0.75) / 0.40))
    } else if mach < 2.5 {
        base * (1.83 - 0.52 * ((mach - 1.15) / 1.35))
    } else {
        (base * 0.95).max(0.18)
    }
}

/// Full-fidelity 2D spherical-Earth RK4 ascent trajectory integrator.
pub fn simulate_full_trajectory(
    config: &VehicleConfiguration,
    stages: &[StageSizingMetrics],
    fairing: &FairingSizingSummary,
    engines_map: &HashMap<String, EngineSpec>,
    glow_kg: f64,
    total_dry_mass_kg: f64,
) -> Result<TrajectorySimulationResult, String> {
    let started = Instant::now();
    if stages.is_empty() {
        return Err("Trajectory simulation requires at least one sized stage.".to_string());
    }

    let (hp_m, ha_m) = resolve_orbit_perigee_apogee_m(&config.orbit);
    let (v_target_orb, _, _) = calc_elliptical_orbit_velocity_m_s(hp_m, ha_m);
    let inc_abs = config.orbit.inclination_deg.abs().clamp(0.0, 180.0);
    let lat_rad = config.orbit.launch_latitude_deg.to_radians();
    let sin_az = if inc_abs >= config.orbit.launch_latitude_deg.abs() && lat_rad.cos() > 1e-6 {
        (config.orbit.inclination_deg.to_radians().cos() / lat_rad.cos()).clamp(-1.0, 1.0)
    } else {
        1.0
    };
    let v_rot_assist = OMEGA_EARTH_RAD_S * R_EARTH_M * lat_rad.cos() * sin_az;

    let area_ref_m2 = calc_circle_area_m2(fairing.outer_diameter_m.max(config.core_diameter_m));
    let cd0 = fairing.wave_drag_cd0;

    let s1 = &stages[0];
    let _s1_eng = engines_map
        .get(&s1.engine_id)
        .ok_or_else(|| format!("Engine '{}' not found for trajectory sim.", s1.engine_id))?;
    let strap_eng = s1
        .strapon_engine_id
        .as_ref()
        .and_then(|id| engines_map.get(id));

    let dt = 0.5_f64;
    let mut t = 0.0_f64;
    let mut r = R_EARTH_M;
    let mut downrange = 0.0_f64;
    let mut vr = 0.0_f64;
    let mut vt = v_rot_assist;
    let mut mass = glow_kg;

    let mut points: Vec<TrajectoryTimePoint> = Vec::with_capacity(650);
    let mut events: Vec<TrajectoryEvent> = Vec::new();
    events.push(TrajectoryEvent {
        time_s: 0.0,
        label: "Liftoff".to_string(),
        altitude_m: 0.0,
        velocity_m_s: 0.0,
        detail: format!("T/W0 = {:.2}, GLOW = {:.0} kg", s1.tw0_ignition, glow_kg),
    });

    let mut max_q_pa = 0.0_f64;
    let mut max_q_time_s = 0.0_f64;
    let mut max_mach = 0.0_f64;
    let mut peak_accel_g = 0.0_f64;
    let mut grav_loss = 0.0_f64;
    let mut drag_loss = 0.0_f64;
    let mut steer_loss = 0.0_f64;
    let mut dv_delivered = 0.0_f64;
    let mut fairing_attached = fairing.mass_kg > 0.0;
    let mut pitchover_done = false;
    let mut booster_sep_done = s1.strapon_count == 0;
    let mut next_sample_t = 0.0_f64;

    let max_stages = stages.len();
    for (stage_idx, st) in stages.iter().enumerate() {
        let eng = engines_map
            .get(&st.engine_id)
            .ok_or_else(|| format!("Stage {} engine '{}' not found.", st.stage_number, st.engine_id))?;

        let mut remaining_core_prop = if stage_idx == 0 {
            (st.ascent_propellant_kg - st.strapon_propellant_kg).max(0.0)
        } else {
            st.ascent_propellant_kg.max(0.0)
        };
        let mut remaining_strap_prop = if stage_idx == 0 {
            st.strapon_propellant_kg
        } else {
            0.0
        };
        let mdot_core_nom = eng.mass_flow_rate_kg_s * (st.engine_count as f64);
        let mdot_strap_nom = if stage_idx == 0 && st.strapon_count > 0 {
            strap_eng
                .map(|b| {
                    let m_s = if b.burn_time_s > 0.0 {
                        b.propellant_mass_kg / b.burn_time_s
                    } else {
                        b.mass_flow_rate_kg_s
                    };
                    m_s * (st.strapon_count as f64)
                })
                .unwrap_or(0.0)
        } else {
            0.0
        };

        if stage_idx > 0 {
            let coast_steps = if config.orbit.coast_duration_s > 0.0 {
                (config.orbit.coast_duration_s.min(180.0) / dt).round() as usize
            } else {
                6
            };
            let sep_t = t;
            events.push(TrajectoryEvent {
                time_s: sep_t,
                label: format!("Stage {} Ignition", st.stage_number),
                altitude_m: r - R_EARTH_M,
                velocity_m_s: (vr * vr + vt * vt).sqrt(),
                detail: format!("{}x {}", st.engine_count, st.engine_name),
            });
            for _ in 0..coast_steps {
                let g_local = MU_EARTH_M3_S2 / (r * r);
                let acc_r = -g_local + (vt * vt) / r;
                let acc_t = -(vr * vt) / r;
                vr += acc_r * dt;
                vt += acc_t * dt;
                r += vr * dt;
                downrange += vt * (R_EARTH_M / r) * dt;
                t += dt;
            }
        }

        let max_iter_stage = if stage_idx == 0 { 900 } else { 2_400 };
        for _ in 0..max_iter_stage {
            if remaining_core_prop <= 1.0 && remaining_strap_prop <= 1.0 {
                break;
            }
            if stage_idx + 1 == max_stages {
                let speed_cur = (vr * vr + vt * vt).sqrt();
                let alt_cur = r - R_EARTH_M;
                if speed_cur >= v_target_orb * 0.998 && alt_cur >= hp_m * 0.88 {
                    break;
                }
            }

            let alt = (r - R_EARTH_M).max(0.0);
            if fairing_attached && alt >= 110_000.0 && stage_idx >= 1 {
                fairing_attached = false;
                mass = (mass - fairing.mass_kg).max(config.payload_mass_kg + 100.0);
                events.push(TrajectoryEvent {
                    time_s: t,
                    label: "Fairing Jettison".to_string(),
                    altitude_m: alt,
                    velocity_m_s: (vr * vr + vt * vt).sqrt(),
                    detail: format!("Released {:.0} kg fairing above 110 km", fairing.mass_kg),
                });
            }

            let (rho, p_amb, a_sound) = std_atmosphere_props(alt);
            let p_ratio = (p_amb / P_SL_PA).clamp(0.0, 1.0);
            let vt_rel = vt - v_rot_assist;
            let v_air = (vr * vr + vt_rel * vt_rel).sqrt();
            let mach = v_air / a_sound.max(180.0);
            let q_dyn = 0.5 * rho * v_air * v_air;
            if q_dyn > max_q_pa {
                max_q_pa = q_dyn;
                max_q_time_s = t;
            }
            if mach > max_mach {
                max_mach = mach;
            }

            if !pitchover_done && alt > 220.0 && vr > 35.0 {
                pitchover_done = true;
                events.push(TrajectoryEvent {
                    time_s: t,
                    label: "Pitchover".to_string(),
                    altitude_m: alt,
                    velocity_m_s: (vr * vr + vt * vt).sqrt(),
                    detail: "Begin gravity-turn pitch maneuver".to_string(),
                });
            }

            let thrust_core_full_n = (eng.thrust_vac_n
                - (eng.thrust_vac_n - eng.thrust_sl_n) * p_ratio)
                * (st.engine_count as f64);

            let mut throttle = if stage_idx == 0 && (18_000.0..=36_000.0).contains(&q_dyn) && alt < 35_000.0 {
                config.max_q_throttle_frac.clamp(0.55, 1.0)
            } else {
                1.0
            };

            let strap_active = stage_idx == 0 && remaining_strap_prop > 1.0 && strap_eng.is_some();
            let thrust_strap_n = if strap_active {
                let b = strap_eng.unwrap();
                (b.thrust_vac_n - (b.thrust_vac_n - b.thrust_sl_n) * p_ratio) * (st.strapon_count as f64)
            } else {
                0.0
            };
            if stage_idx == 0 && !strap_active && !booster_sep_done {
                booster_sep_done = true;
                mass = (mass - st.strapon_inert_kg).max(1_000.0);
                events.push(TrajectoryEvent {
                    time_s: t,
                    label: "Booster Separation".to_string(),
                    altitude_m: alt,
                    velocity_m_s: (vr * vr + vt * vt).sqrt(),
                    detail: format!("{}x strap-on boosters separated", st.strapon_count),
                });
            }

            let max_allowed_thrust = config.g_limit * G0_M_S2 * mass;
            let net_for_core = (max_allowed_thrust - thrust_strap_n).max(0.0);
            if thrust_core_full_n * throttle > net_for_core && thrust_core_full_n > 1.0 {
                throttle = (net_for_core / thrust_core_full_n).clamp(eng.min_throttle_frac, throttle);
            }

            let thrust_core_n = if remaining_core_prop > 1.0 {
                thrust_core_full_n * throttle
            } else {
                0.0
            };
            let total_thrust_n = thrust_core_n + thrust_strap_n;

            let mut mdot_core = if remaining_core_prop > 1.0 {
                mdot_core_nom * throttle
            } else {
                0.0
            };
            let mut mdot_strap = if strap_active { mdot_strap_nom } else { 0.0 };
            if mdot_core * dt > remaining_core_prop {
                mdot_core = remaining_core_prop / dt;
            }
            if mdot_strap * dt > remaining_strap_prop {
                mdot_strap = remaining_strap_prop / dt;
            }

            let speed_inert = (vr * vr + vt * vt).sqrt().max(1e-3);
            let fpa_rad = vr.atan2(vt.max(1e-3));
            let fpa_rel_rad = vr.atan2(vt_rel.max(1e-3));
            let thrust_pitch_rad = if alt < 400.0 {
                std::f64::consts::FRAC_PI_2
            } else if stage_idx == 0 {
                let turn_start = 400.0_f64;
                let turn_end = 65_000.0_f64;
                let frac = ((alt - turn_start) / (turn_end - turn_start)).clamp(0.0, 1.0);
                let target_fpa = (90.0 - 64.0 * frac.powf(0.68)).to_radians();
                0.75 * target_fpa + 0.25 * fpa_rel_rad.clamp(0.25, std::f64::consts::FRAC_PI_2)
            } else {
                let alt_err = hp_m - alt;
                let vr_damp = -0.06 * vr;
                let pitch_cmd_deg = (alt_err / 5_500.0 + vr_damp).clamp(-3.0, 24.0);
                pitch_cmd_deg.to_radians()
            };

            let steer_diff = (thrust_pitch_rad - fpa_rel_rad).abs();
            let cd = mach_drag_coeff(mach, cd0);
            let drag_n = q_dyn * cd * area_ref_m2;
            let drag_r = if v_air > 1e-2 { -drag_n * (vr / v_air) } else { 0.0 };
            let drag_t = if v_air > 1e-2 { -drag_n * (vt_rel / v_air) } else { 0.0 };

            let step_accel = |ri: f64, vri: f64, vti: f64, mi: f64| -> (f64, f64, f64, f64) {
                let gi = MU_EARTH_M3_S2 / (ri * ri);
                let tr = total_thrust_n * thrust_pitch_rad.sin();
                let tt = total_thrust_n * thrust_pitch_rad.cos();
                let ar = (tr + drag_r) / mi - gi + (vti * vti) / ri;
                let at = (tt + drag_t) / mi - (vri * vti) / ri;
                (vri, (vti * R_EARTH_M) / ri, ar, at)
            };

            let (k1_r, k1_x, k1_vr, k1_vt) = step_accel(r, vr, vt, mass);
            let m_mid = (mass - 0.5 * (mdot_core + mdot_strap) * dt).max(200.0);
            let (k2_r, k2_x, k2_vr, k2_vt) = step_accel(r + 0.5 * dt * k1_r, vr + 0.5 * dt * k1_vr, vt + 0.5 * dt * k1_vt, m_mid);
            let (k3_r, k3_x, k3_vr, k3_vt) = step_accel(r + 0.5 * dt * k2_r, vr + 0.5 * dt * k2_vr, vt + 0.5 * dt * k2_vt, m_mid);
            let m_end = (mass - (mdot_core + mdot_strap) * dt).max(200.0);
            let (k4_r, k4_x, k4_vr, k4_vt) = step_accel(r + dt * k3_r, vr + dt * k3_vr, vt + dt * k3_vt, m_end);

            let g_cur = MU_EARTH_M3_S2 / (r * r);
            let accel_g = total_thrust_n / (mass * G0_M_S2);
            if accel_g > peak_accel_g {
                peak_accel_g = accel_g;
            }

            if t >= next_sample_t {
                points.push(TrajectoryTimePoint {
                    time_s: t,
                    altitude_m: alt,
                    downrange_m: downrange,
                    velocity_m_s: speed_inert,
                    flight_path_deg: fpa_rad.to_degrees(),
                    dynamic_pressure_pa: q_dyn,
                    mach,
                    accel_g,
                    throttle_frac: throttle,
                    mass_kg: mass,
                    thrust_n: total_thrust_n,
                    drag_n,
                    active_stage: st.stage_number,
                });
                next_sample_t += 1.0;
            }

            grav_loss += g_cur * fpa_rad.sin().max(0.0) * dt;
            drag_loss += (drag_n / mass) * dt;
            steer_loss += (total_thrust_n / mass) * (1.0 - steer_diff.cos()) * dt;
            dv_delivered += (total_thrust_n / mass) * dt;

            r += (dt / 6.0) * (k1_r + 2.0 * k2_r + 2.0 * k3_r + k4_r);
            downrange += (dt / 6.0) * (k1_x + 2.0 * k2_x + 2.0 * k3_x + k4_x);
            vr += (dt / 6.0) * (k1_vr + 2.0 * k2_vr + 2.0 * k3_vr + k4_vr);
            vt += (dt / 6.0) * (k1_vt + 2.0 * k2_vt + 2.0 * k3_vt + k4_vt);
            remaining_core_prop = (remaining_core_prop - mdot_core * dt).max(0.0);
            remaining_strap_prop = (remaining_strap_prop - mdot_strap * dt).max(0.0);
            mass = m_end;
            t += dt;
        }

        if stage_idx == 0 && max_stages > 1 {
            let core_inert_drop = (st.inert_mass_kg - st.strapon_inert_kg) + st.recovery_propellant_kg;
            mass = (mass - core_inert_drop).max(config.payload_mass_kg + total_dry_mass_kg * 0.1);
            events.push(TrajectoryEvent {
                time_s: t,
                label: "MECO / Stage 1 Separation".to_string(),
                altitude_m: r - R_EARTH_M,
                velocity_m_s: (vr * vr + vt * vt).sqrt(),
                detail: format!("Mach {:.1}, jettisoned {:.0} kg core hardware", max_mach, core_inert_drop),
            });
        } else if stage_idx + 1 < max_stages {
            mass = (mass - st.inert_mass_kg).max(config.payload_mass_kg + 100.0);
            events.push(TrajectoryEvent {
                time_s: t,
                label: format!("Stage {} Cutoff / Sep", st.stage_number),
                altitude_m: r - R_EARTH_M,
                velocity_m_s: (vr * vr + vt * vt).sqrt(),
                detail: format!("Separated Stage {} ({:.0} kg inert)", st.stage_number, st.inert_mass_kg),
            });
        }
    }

    let final_alt = r - R_EARTH_M;
    let final_v = (vr * vr + vt * vt).sqrt();
    let final_fpa_deg = vr.atan2(vt.max(1e-3)).to_degrees();
    events.push(TrajectoryEvent {
        time_s: max_q_time_s,
        label: "Max-Q (Peak Dynamic Pressure)".to_string(),
        altitude_m: points
            .iter()
            .min_by(|a, b| (a.time_s - max_q_time_s).abs().partial_cmp(&(b.time_s - max_q_time_s).abs()).unwrap())
            .map(|p| p.altitude_m)
            .unwrap_or(12_000.0),
        velocity_m_s: points
            .iter()
            .min_by(|a, b| (a.time_s - max_q_time_s).abs().partial_cmp(&(b.time_s - max_q_time_s).abs()).unwrap())
            .map(|p| p.velocity_m_s)
            .unwrap_or(400.0),
        detail: format!("{:.1} kPa ({:.2} psi)", max_q_pa / 1_000.0, max_q_pa * 0.000145038),
    });
    events.sort_by(|a, b| a.time_s.partial_cmp(&b.time_s).unwrap_or(std::cmp::Ordering::Equal));

    let specific_energy = 0.5 * final_v * final_v - MU_EARTH_M3_S2 / r;
    let h_ang = r * vt;
    let semi_major = if specific_energy < -1.0 {
        -MU_EARTH_M3_S2 / (2.0 * specific_energy)
    } else {
        r
    };
    let ecc_sq = (1.0 + (2.0 * specific_energy * h_ang * h_ang) / (MU_EARTH_M3_S2 * MU_EARTH_M3_S2)).max(0.0);
    let ecc_ach = ecc_sq.sqrt().min(0.98);
    let perigee_achieved_m = semi_major * (1.0 - ecc_ach) - R_EARTH_M;
    let apogee_achieved_m = semi_major * (1.0 + ecc_ach) - R_EARTH_M;
    let orbit_reached = perigee_achieved_m >= 120_000.0 || (final_v >= v_target_orb * 0.94 && final_alt >= 120_000.0);

    events.push(TrajectoryEvent {
        time_s: t,
        label: "SECO / Insertion".to_string(),
        altitude_m: final_alt,
        velocity_m_s: final_v,
        detail: format!("dV {:.0} m/s, FPA {:.2} deg", dv_delivered, final_fpa_deg),
    });

    Ok(TrajectorySimulationResult {
        points,
        events,
        max_q_pa,
        max_q_time_s,
        max_mach,
        peak_accel_g,
        gravity_loss_m_s: grav_loss,
        drag_loss_m_s: drag_loss,
        steering_loss_m_s: steer_loss,
        total_dv_delivered_m_s: dv_delivered,
        final_altitude_m: final_alt,
        target_altitude_m: hp_m,
        final_velocity_m_s: final_v,
        target_velocity_m_s: v_target_orb,
        final_flight_path_deg: final_fpa_deg,
        apogee_achieved_m,
        perigee_achieved_m,
        orbit_reached,
        sim_duration_ms: started.elapsed().as_secs_f64() * 1_000.0,
    })
}
