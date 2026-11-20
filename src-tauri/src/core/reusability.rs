use super::models::mission::RecoveryMode;
use super::physics::G0_M_S2;

#[derive(Debug, Clone)]
pub struct ReusabilityAllocation {
    pub recovery_mode: RecoveryMode,
    pub prop_reserve_fraction: f64,
    pub ascent_propellant_kg: f64,
    pub recovery_propellant_kg: f64,
    pub boostback_prop_kg: f64,
    pub entry_prop_kg: f64,
    pub landing_prop_kg: f64,
    pub legs_mass_kg: f64,
    pub grid_fins_mass_kg: f64,
    pub tps_or_chute_mass_kg: f64,
    pub total_added_hardware_kg: f64,
}

pub fn calc_boostback_burn_prop_kg(
    m_booster_burnout_kg: f64,
    v_staging_m_s: f64,
    gamma_staging_deg: f64,
    v_return_target_m_s: f64,
    isp_vac_s: f64,
) -> f64 {
    let gamma_rad = gamma_staging_deg.to_radians();
    let dv_boostback_m_s = v_staging_m_s * gamma_rad.cos() + v_return_target_m_s;
    let exp_val = (dv_boostback_m_s / (isp_vac_s * G0_M_S2)).exp();
    m_booster_burnout_kg * (exp_val - 1.0)
}

pub fn calc_burn_prop_for_dv_kg(m_end_kg: f64, dv_m_s: f64, isp_s: f64) -> f64 {
    if dv_m_s <= 0.0 || isp_s <= 0.0 {
        return 0.0;
    }
    let exp_val = (dv_m_s / (isp_s * G0_M_S2)).exp();
    m_end_kg * (exp_val - 1.0)
}

pub fn allocate_reusability_masses(
    mode: RecoveryMode,
    m_stage_prop_total_kg: f64,
    m_stage_base_dry_kg: f64,
    isp_vac_s: f64,
    isp_sl_s: f64,
    v_staging_m_s: f64,
) -> ReusabilityAllocation {
    match mode {
        RecoveryMode::Expendable => ReusabilityAllocation {
            recovery_mode: mode,
            prop_reserve_fraction: 0.0,
            ascent_propellant_kg: m_stage_prop_total_kg,
            recovery_propellant_kg: 0.0,
            boostback_prop_kg: 0.0,
            entry_prop_kg: 0.0,
            landing_prop_kg: 0.0,
            legs_mass_kg: 0.0,
            grid_fins_mass_kg: 0.0,
            tps_or_chute_mass_kg: 0.0,
            total_added_hardware_kg: 0.0,
        },
        RecoveryMode::DownrangeLandingAsds => {
            let legs_mass_kg = 0.025 * m_stage_base_dry_kg;
            let grid_fins_mass_kg = 0.012 * m_stage_base_dry_kg;
            let tps_or_chute_mass_kg = 0.015 * m_stage_base_dry_kg;
            let total_added_hardware_kg = legs_mass_kg + grid_fins_mass_kg + tps_or_chute_mass_kg;
            let m_burnout_kg = m_stage_base_dry_kg + total_added_hardware_kg;

            let landing_prop_kg = calc_burn_prop_for_dv_kg(m_burnout_kg, 290.0, isp_sl_s);
            let entry_prop_kg = calc_burn_prop_for_dv_kg(m_burnout_kg + landing_prop_kg, 520.0, isp_vac_s);
            let min_reserve_kg = 0.065 * m_stage_prop_total_kg;
            let max_reserve_kg = 0.090 * m_stage_prop_total_kg;
            let recovery_propellant_kg = (entry_prop_kg + landing_prop_kg).clamp(min_reserve_kg, max_reserve_kg);
            let ascent_propellant_kg = (m_stage_prop_total_kg - recovery_propellant_kg).max(0.0);
            let prop_reserve_fraction = if m_stage_prop_total_kg > 0.0 {
                recovery_propellant_kg / m_stage_prop_total_kg
            } else {
                0.0
            };

            ReusabilityAllocation {
                recovery_mode: mode,
                prop_reserve_fraction,
                ascent_propellant_kg,
                recovery_propellant_kg,
                boostback_prop_kg: 0.0,
                entry_prop_kg,
                landing_prop_kg,
                legs_mass_kg,
                grid_fins_mass_kg,
                tps_or_chute_mass_kg,
                total_added_hardware_kg,
            }
        }
        RecoveryMode::ReturnToLaunchSiteRtls => {
            let legs_mass_kg = 0.025 * m_stage_base_dry_kg;
            let grid_fins_mass_kg = 0.012 * m_stage_base_dry_kg;
            let tps_or_chute_mass_kg = 0.020 * m_stage_base_dry_kg;
            let total_added_hardware_kg = legs_mass_kg + grid_fins_mass_kg + tps_or_chute_mass_kg;
            let m_burnout_kg = m_stage_base_dry_kg + total_added_hardware_kg;

            let landing_prop_kg = calc_burn_prop_for_dv_kg(m_burnout_kg, 310.0, isp_sl_s);
            let entry_prop_kg = calc_burn_prop_for_dv_kg(m_burnout_kg + landing_prop_kg, 620.0, isp_vac_s);
            let boostback_prop_kg = calc_boostback_burn_prop_kg(
                m_burnout_kg + landing_prop_kg + entry_prop_kg,
                v_staging_m_s.min(1_750.0),
                62.0,
                180.0,
                isp_vac_s,
            );
            let min_reserve_kg = 0.125 * m_stage_prop_total_kg;
            let max_reserve_kg = 0.160 * m_stage_prop_total_kg;
            let raw_sum_kg = boostback_prop_kg + entry_prop_kg + landing_prop_kg;
            let recovery_propellant_kg = raw_sum_kg.clamp(min_reserve_kg, max_reserve_kg);
            let ascent_propellant_kg = (m_stage_prop_total_kg - recovery_propellant_kg).max(0.0);
            let prop_reserve_fraction = if m_stage_prop_total_kg > 0.0 {
                recovery_propellant_kg / m_stage_prop_total_kg
            } else {
                0.0
            };

            ReusabilityAllocation {
                recovery_mode: mode,
                prop_reserve_fraction,
                ascent_propellant_kg,
                recovery_propellant_kg,
                boostback_prop_kg,
                entry_prop_kg,
                landing_prop_kg,
                legs_mass_kg,
                grid_fins_mass_kg,
                tps_or_chute_mass_kg,
                total_added_hardware_kg,
            }
        }
        RecoveryMode::ParachuteMidAirCatch => {
            let tps_or_chute_mass_kg = 0.072 * m_stage_base_dry_kg;
            let recovery_propellant_kg = 0.005 * m_stage_prop_total_kg;
            let ascent_propellant_kg = (m_stage_prop_total_kg - recovery_propellant_kg).max(0.0);
            ReusabilityAllocation {
                recovery_mode: mode,
                prop_reserve_fraction: 0.005,
                ascent_propellant_kg,
                recovery_propellant_kg,
                boostback_prop_kg: 0.0,
                entry_prop_kg: 0.0,
                landing_prop_kg: recovery_propellant_kg,
                legs_mass_kg: 0.0,
                grid_fins_mass_kg: 0.0,
                tps_or_chute_mass_kg,
                total_added_hardware_kg: tps_or_chute_mass_kg,
            }
        }
    }
}
