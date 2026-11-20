use crate::core::models::engine::{EngineSpec, ProvenanceEngine};
use crate::core::models::vehicle::{
    SizingRequest, SizingSweepResponse, TrajectorySimulationResult, VehicleConfiguration,
    VehicleSizingResult,
};
use crate::core::optimizer::{run_combinatorial_sizing as run_opt_sizing, run_sensitivity_sweep as run_opt_sweep, SensitivityCurveResponse};
use crate::core::physics::simulate_full_trajectory;
use crate::core::staging::evaluate_vehicle_configuration;
use std::collections::HashMap;

pub fn build_engines_map(custom_engines: &[ProvenanceEngine]) -> Result<HashMap<String, EngineSpec>, String> {
    let raw_json = include_str!("../core/data/engines.json");
    let base_engines: Vec<ProvenanceEngine> =
        serde_json::from_str(raw_json).map_err(|err| format!("Failed to parse engines.json: {err}"))?;
    let mut map = HashMap::new();
    for eng in &base_engines {
        let spec = EngineSpec::from(eng);
        map.insert(spec.id.clone(), spec);
    }
    for eng in custom_engines {
        let spec = EngineSpec::from(eng);
        map.insert(spec.id.clone(), spec);
    }
    Ok(map)
}

#[tauri::command]
pub fn run_combinatorial_sizing(request: SizingRequest) -> Result<SizingSweepResponse, String> {
    let map = build_engines_map(&request.base_config.custom_engines)?;
    run_opt_sizing(&request, &map)
}

#[tauri::command]
pub fn evaluate_manual_architecture(config: VehicleConfiguration) -> Result<VehicleSizingResult, String> {
    let map = build_engines_map(&config.custom_engines)?;
    evaluate_vehicle_configuration(&config, &map)
}

#[tauri::command]
pub fn simulate_trajectory(config: VehicleConfiguration) -> Result<TrajectorySimulationResult, String> {
    let map = build_engines_map(&config.custom_engines)?;
    let sized = evaluate_vehicle_configuration(&config, &map)?;
    simulate_full_trajectory(
        &config,
        &sized.stages,
        &sized.fairing,
        &map,
        sized.glow_kg,
        sized.total_dry_mass_kg,
    )
}

#[tauri::command]
pub fn run_sensitivity_sweep(
    baseline: VehicleConfiguration,
    sweep_parameter: String,
    range_min: f64,
    range_max: f64,
    steps: usize,
) -> Result<SensitivityCurveResponse, String> {
    let map = build_engines_map(&baseline.custom_engines)?;
    run_opt_sweep(&baseline, &sweep_parameter, range_min, range_max, steps, &map)
}
