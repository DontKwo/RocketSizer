use super::super::core::cost_engine::{compute_vehicle_cost_breakdown, CostModelParameters};
use super::super::core::models::mission::{RecoveryMode, TankMaterialPreset};
use super::super::core::models::vehicle::{VehicleCostBreakdown, VehicleSizingResult};
use super::sizing_commands::build_engines_map;

#[tauri::command]
pub fn compute_cost_model(
    vehicle: VehicleSizingResult,
    parameters: CostModelParameters,
) -> Result<VehicleCostBreakdown, String> {
    let map = build_engines_map(&[])?;
    let materials = vec![TankMaterialPreset::AlLi2195; vehicle.stages.len()];
    let recoveries: Vec<RecoveryMode> = vehicle
        .stages
        .iter()
        .map(|s| {
            if s.recovery_propellant_kg > 0.0 {
                RecoveryMode::DownrangeLandingAsds
            } else {
                RecoveryMode::Expendable
            }
        })
        .collect();
    Ok(compute_vehicle_cost_breakdown(
        &vehicle,
        &map,
        &materials,
        &recoveries,
        &parameters,
    ))
}
