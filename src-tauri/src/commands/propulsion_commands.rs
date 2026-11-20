use super::super::core::models::engine::ProvenanceEngine;
use super::super::core::rubber_engine::scale_rubber_engine_spec;

#[tauri::command]
pub fn scale_rubber_engine(
    reference_engine: ProvenanceEngine,
    target_thrust_vac_n: f64,
    chamber_pressure_override_bar: Option<f64>,
) -> Result<ProvenanceEngine, String> {
    scale_rubber_engine_spec(&reference_engine, target_thrust_vac_n, chamber_pressure_override_bar)
}
