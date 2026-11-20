use super::models::engine::{EngineSpec, PropulsionType, ProvenanceEngine};
use super::models::provenance::{Derivation, ProvenanceStatus, ProvenanceValue};
use super::physics::{calc_circle_area_m2, estimate_isp_sl_s, P_SL_PA};
use std::collections::HashMap;

pub fn scale_rubber_engine_spec(
    reference: &ProvenanceEngine,
    target_thrust_vac_n: f64,
    chamber_pressure_override_bar: Option<f64>,
) -> Result<ProvenanceEngine, String> {
    if target_thrust_vac_n <= 0.0 {
        return Err("Target vacuum thrust must be positive.".to_string());
    }
    if reference.propulsion_type.value == PropulsionType::Solid {
        return Err("Rubber engine scaling applies to liquid propulsion cycles.".to_string());
    }

    let ref_spec = EngineSpec::from(reference);
    let t_ref_n = ref_spec.thrust_vac_n.max(1.0);
    let p_ref_bar = ref_spec.chamber_pressure_bar.max(1.0);
    let p_chamber_bar = chamber_pressure_override_bar.unwrap_or(p_ref_bar).max(5.0);

    let alpha_mass = 0.82;
    let beta_mass = -0.15;
    let thrust_ratio = target_thrust_vac_n / t_ref_n;
    let pressure_ratio = p_chamber_bar / p_ref_bar;
    let m_dry_scaled_kg =
        ref_spec.dry_mass_kg * thrust_ratio.powf(alpha_mass) * pressure_ratio.powf(beta_mass);

    let p_chamber_pa = p_chamber_bar * 1.0e5;
    let ref_p_pa = p_ref_bar * 1.0e5;
    let ref_exit_area_m2 = calc_circle_area_m2(ref_spec.nozzle_diameter_m);
    let ref_throat_area_m2 = ref_exit_area_m2 / ref_spec.expansion_ratio.max(1.0);
    let cf_vac = (t_ref_n / (ref_p_pa * ref_throat_area_m2.max(1e-6))).clamp(1.3, 2.2);

    let a_throat_m2 = target_thrust_vac_n / (cf_vac * p_chamber_pa);
    let a_exit_m2 = ref_spec.expansion_ratio * a_throat_m2;
    let d_exit_scaled_m = ((4.0 * a_exit_m2) / std::f64::consts::PI).sqrt();

    let t_sl_raw_n = target_thrust_vac_n - P_SL_PA * a_exit_m2;
    let t_sl_scaled_n = t_sl_raw_n.max(0.45 * target_thrust_vac_n);
    let isp_vac_scaled_s = ref_spec.isp_vac_s * (1.0 + 0.012 * pressure_ratio.ln());
    let isp_sl_scaled_s = estimate_isp_sl_s(
        isp_vac_scaled_s,
        Some(target_thrust_vac_n),
        Some(t_sl_scaled_n),
        Some(a_exit_m2),
    );
    let isp_avg_scaled_s = 0.5 * (isp_sl_scaled_s + isp_vac_scaled_s);
    let mdot_scaled_kg_s = target_thrust_vac_n / (isp_vac_scaled_s * 9.80665);

    let height_scaled_m = ref_spec.height_m * thrust_ratio.powf(0.41) * pressure_ratio.powf(-0.12);
    let gimbal_env_scaled_m = d_exit_scaled_m * (ref_spec.gimbal_envelope_dia_m / ref_spec.nozzle_diameter_m.max(0.05));
    let tw_vac = target_thrust_vac_n / (m_dry_scaled_kg * 9.80665);

    let mut params = HashMap::new();
    params.insert("reference_engine".to_string(), ref_spec.id.clone());
    params.insert("target_thrust_vac_n".to_string(), format!("{target_thrust_vac_n:.1}"));
    params.insert("chamber_pressure_bar".to_string(), format!("{p_chamber_bar:.1}"));

    let deriv = Derivation {
        governing_equation: "m_dry = m_ref * (T / T_ref)^0.82 * (Pc / Pc_ref)^(-0.15)".to_string(),
        input_parameters: params,
        assumptions: vec![
            "Constant thrust coefficient and expansion ratio from baseline cycle".to_string(),
            "Sea-level nozzle exit pressure loss computed at 101,325 Pa".to_string(),
        ],
        solver_method: "Parametric power-law rubber engine scaling".to_string(),
        confidence_rating: "medium".to_string(),
    };

    let mut scaled = reference.clone();
    scaled.id = ProvenanceValue {
        value: format!("{}_rubber_{:.0}kn", ref_spec.id, target_thrust_vac_n / 1_000.0),
        canonical_unit: "text".to_string(),
        status: ProvenanceStatus::Derived,
        citation: None,
        derivation: Some(deriv.clone()),
        notes: Some("Rubber scaled engine identifier".to_string()),
    };
    scaled.name = ProvenanceValue::derived(
        format!("{} (Scaled {:.0} kN)", ref_spec.name, target_thrust_vac_n / 1_000.0),
        "text",
        deriv.clone(),
        None,
    );
    scaled.thrust_vac_n = ProvenanceValue::derived(target_thrust_vac_n, "N", deriv.clone(), None);
    scaled.thrust_sl_n = ProvenanceValue::derived(t_sl_scaled_n, "N", deriv.clone(), None);
    scaled.isp_vac_s = ProvenanceValue::derived(isp_vac_scaled_s, "s", deriv.clone(), None);
    scaled.isp_sl_s = ProvenanceValue::derived(isp_sl_scaled_s, "s", deriv.clone(), None);
    scaled.isp_avg_s = ProvenanceValue::derived(isp_avg_scaled_s, "s", deriv.clone(), None);
    scaled.mass_flow_rate_kg_s = ProvenanceValue::derived(mdot_scaled_kg_s, "kg/s", deriv.clone(), None);
    scaled.chamber_pressure_bar = ProvenanceValue::derived(p_chamber_bar, "bar", deriv.clone(), None);
    scaled.dry_mass_kg = ProvenanceValue::derived(m_dry_scaled_kg, "kg", deriv.clone(), None);
    scaled.height_m = ProvenanceValue::derived(height_scaled_m, "m", deriv.clone(), None);
    scaled.nozzle_diameter_m = ProvenanceValue::derived(d_exit_scaled_m, "m", deriv.clone(), None);
    scaled.gimbal_envelope_dia_m = ProvenanceValue::derived(gimbal_env_scaled_m, "m", deriv.clone(), None);
    scaled.thrust_to_weight_vac = ProvenanceValue::derived(tw_vac, "ratio", deriv, None);

    Ok(scaled)
}
