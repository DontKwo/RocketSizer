use super::super::core::cost_engine::predict_heritage_vehicle_cost;
use super::super::core::models::engine::{EngineSpec, ProvenanceEngine};
use super::super::core::models::vehicle::{
    HeritageValidationSummary, HeritageVehicleValidationEntry, ProvenanceVehicle,
};
use super::super::core::structures::predict_heritage_vehicle_structure;
use std::collections::HashMap;

#[tauri::command]
pub fn get_heritage_vehicles() -> Result<Vec<ProvenanceVehicle>, String> {
    let raw_json = include_str!("../core/data/vehicles.json");
    let mut vehicles: Vec<ProvenanceVehicle> =
        serde_json::from_str(raw_json).map_err(|err| format!("Failed to parse vehicles.json: {err}"))?;
    for v in &mut vehicles {
        if v.launch_success_rate.value > 1.0 {
            v.launch_success_rate.value = (v.launch_success_rate.value / 100.0).clamp(0.0, 1.0);
        }
    }
    Ok(vehicles)
}

#[tauri::command]
pub fn get_heritage_engines() -> Result<Vec<ProvenanceEngine>, String> {
    let raw_json = include_str!("../core/data/engines.json");
    serde_json::from_str(raw_json).map_err(|err| format!("Failed to parse engines.json: {err}"))
}

fn classify_vehicle_category(payload_leo_kg: f64) -> String {
    if payload_leo_kg < 2_000.0 {
        "Small-Lift".to_string()
    } else if payload_leo_kg < 20_000.0 {
        "Medium-Lift".to_string()
    } else if payload_leo_kg < 50_000.0 {
        "Heavy-Lift".to_string()
    } else {
        "Super-Heavy".to_string()
    }
}

fn signed_pct_err(pred: f64, actual: f64) -> f64 {
    if actual <= 0.0 {
        0.0
    } else {
        ((pred - actual) / actual) * 100.0
    }
}

fn is_calibration_vehicle(vehicle_id: &str) -> bool {
    matches!(
        vehicle_id,
        "saturn_v" | "falcon_9" | "sls_block_1" | "electron" | "atlas_v_401"
    )
}

fn median_of(vals: &mut [f64]) -> f64 {
    if vals.is_empty() {
        return 0.0;
    }
    vals.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mid = vals.len() / 2;
    if vals.len() % 2 == 0 {
        (vals[mid - 1] + vals[mid]) / 2.0
    } else {
        vals[mid]
    }
}

fn percentile_of(vals: &mut [f64], pct: f64) -> f64 {
    if vals.is_empty() {
        return 0.0;
    }
    vals.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let idx = ((vals.len() as f64 - 1.0) * pct.clamp(0.0, 1.0)).round() as usize;
    vals[idx.min(vals.len() - 1)]
}

#[tauri::command]
pub fn validate_heritage_models() -> Result<HeritageValidationSummary, String> {
    let vehicles = get_heritage_vehicles()?;
    let engines = get_heritage_engines()?;
    let mut engines_map: HashMap<String, EngineSpec> = HashMap::new();
    for eng in &engines {
        let spec = EngineSpec::from(eng);
        engines_map.insert(spec.id.clone(), spec);
    }

    let mut entries: Vec<HeritageVehicleValidationEntry> = Vec::new();
    let mut tot_dry_errs: Vec<f64> = Vec::new();
    let mut s1_dry_errs: Vec<f64> = Vec::new();
    let mut s2_dry_errs: Vec<f64> = Vec::new();
    let mut cost_errs: Vec<f64> = Vec::new();
    let mut ddte_errs: Vec<f64> = Vec::new();

    let mut in_sample_dry_errs: Vec<f64> = Vec::new();
    let mut out_of_sample_dry_errs: Vec<f64> = Vec::new();
    let mut in_sample_cost_errs: Vec<f64> = Vec::new();
    let mut out_of_sample_cost_errs: Vec<f64> = Vec::new();
    let mut in_sample_ddte_errs: Vec<f64> = Vec::new();
    let mut out_of_sample_ddte_errs: Vec<f64> = Vec::new();
    let mut signed_dry_errs: Vec<f64> = Vec::new();
    let mut signed_cost_errs: Vec<f64> = Vec::new();

    for veh in &vehicles {
        if veh.s1_dry_mass_kg.value <= 0.0 || veh.total_dry_mass_kg.value <= 0.0 {
            continue;
        }
        let Some((pred_s1_dry_kg, s1_bd, pred_s2_dry_kg, s2_bd_opt, pred_total_dry_kg)) =
            predict_heritage_vehicle_structure(veh, &engines_map)
        else {
            continue;
        };
        let (pred_cost_usd, pred_ddte_usd) = predict_heritage_vehicle_cost(veh, &engines_map);

        let act_s1 = veh.s1_dry_mass_kg.value;
        let act_s2 = veh.s2_dry_mass_kg.value;
        let act_tot = veh.total_dry_mass_kg.value;
        let act_cost = veh.launch_cost_adj_usd.value;
        let act_ddte = veh.development_cost_usd.value;

        let s1_err = signed_pct_err(pred_s1_dry_kg, act_s1);
        let s2_err = signed_pct_err(pred_s2_dry_kg, act_s2);
        let tot_err = signed_pct_err(pred_total_dry_kg, act_tot);
        let cost_err = signed_pct_err(pred_cost_usd, act_cost);
        let ddte_err = signed_pct_err(pred_ddte_usd, act_ddte);

        let is_cal = is_calibration_vehicle(&veh.id.value);
        let sample_type = if is_cal {
            "Calibration".to_string()
        } else {
            "Holdout Validation".to_string()
        };

        if veh.total_launches.value > 0 && veh.operational_status.value != "in_development" {
            tot_dry_errs.push(tot_err.abs());
            signed_dry_errs.push(tot_err);
            s1_dry_errs.push(s1_err.abs());
            if is_cal {
                in_sample_dry_errs.push(tot_err.abs());
            } else {
                out_of_sample_dry_errs.push(tot_err.abs());
            }
            if act_s2 > 100.0 && pred_s2_dry_kg > 100.0 {
                s2_dry_errs.push(s2_err.abs());
            }
            if act_cost > 0.0 {
                cost_errs.push(cost_err.abs());
                signed_cost_errs.push(cost_err);
                if is_cal {
                    in_sample_cost_errs.push(cost_err.abs());
                } else {
                    out_of_sample_cost_errs.push(cost_err.abs());
                }
            }
            if act_ddte > 0.0 {
                ddte_errs.push(ddte_err.abs());
                if is_cal {
                    in_sample_ddte_errs.push(ddte_err.abs());
                } else {
                    out_of_sample_ddte_errs.push(ddte_err.abs());
                }
            }
        }

        entries.push(HeritageVehicleValidationEntry {
            vehicle_id: veh.id.value.clone(),
            vehicle_name: veh.name.value.clone(),
            category: classify_vehicle_category(veh.payload_leo_kg.value),
            sample_type,
            is_calibration_set: is_cal,
            maiden_flight_year: veh.maiden_flight_year.value,
            total_launches: veh.total_launches.value,
            glow_kg: veh.glow_kg.value,
            payload_leo_kg: veh.payload_leo_kg.value,
            core_diameter_m: veh.core_diameter_m.value,
            stage_count: veh.stage_count.value,
            booster_count: veh.booster_count.value,
            actual_s1_dry_kg: act_s1,
            predicted_s1_dry_kg: pred_s1_dry_kg,
            s1_dry_error_pct: s1_err,
            s1_breakdown: s1_bd,
            actual_s2_dry_kg: act_s2,
            predicted_s2_dry_kg: pred_s2_dry_kg,
            s2_dry_error_pct: s2_err,
            s2_breakdown: s2_bd_opt,
            actual_total_dry_kg: act_tot,
            predicted_total_dry_kg: pred_total_dry_kg,
            total_dry_error_pct: tot_err,
            actual_launch_cost_adj_usd: act_cost,
            predicted_launch_cost_adj_usd: pred_cost_usd,
            launch_cost_error_pct: cost_err,
            actual_ddte_usd: act_ddte,
            predicted_ddte_usd: pred_ddte_usd,
            ddte_error_pct: ddte_err,
        });
    }

    let mean_of = |vals: &[f64]| -> f64 {
        if vals.is_empty() {
            0.0
        } else {
            vals.iter().sum::<f64>() / (vals.len() as f64)
        }
    };

    let struct_mdape = median_of(&mut tot_dry_errs.clone());
    let cost_mdape = median_of(&mut cost_errs.clone());
    let ddte_mdape = median_of(&mut ddte_errs.clone());
    let p10_struct = percentile_of(&mut signed_dry_errs, 0.10);
    let p90_struct = percentile_of(&mut signed_dry_errs, 0.90);
    let p10_cost = percentile_of(&mut signed_cost_errs, 0.10);
    let p90_cost = percentile_of(&mut signed_cost_errs, 0.90);

    Ok(HeritageValidationSummary {
        entries,
        structural_mape_pct: mean_of(&tot_dry_errs),
        s1_structural_mape_pct: mean_of(&s1_dry_errs),
        s2_structural_mape_pct: mean_of(&s2_dry_errs),
        cost_mape_pct: mean_of(&cost_errs),
        ddte_mape_pct: mean_of(&ddte_errs),
        in_sample_structural_mape_pct: mean_of(&in_sample_dry_errs),
        out_of_sample_structural_mape_pct: mean_of(&out_of_sample_dry_errs),
        structural_mdape_pct: struct_mdape,
        in_sample_cost_mape_pct: mean_of(&in_sample_cost_errs),
        out_of_sample_cost_mape_pct: mean_of(&out_of_sample_cost_errs),
        cost_mdape_pct: cost_mdape,
        in_sample_ddte_mape_pct: mean_of(&in_sample_ddte_errs),
        out_of_sample_ddte_mape_pct: mean_of(&out_of_sample_ddte_errs),
        ddte_mdape_pct: ddte_mdape,
        p10_structural_error_pct: p10_struct,
        p90_structural_error_pct: p90_struct,
        p10_cost_error_pct: p10_cost,
        p90_cost_error_pct: p90_cost,
    })
}
