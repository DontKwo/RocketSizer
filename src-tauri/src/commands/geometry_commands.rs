use super::super::core::packaging::{
    solve_engine_circle_packing as solve_pack, BaseLayoutResult, EnginePlacementInput, PackingConstraints,
};

#[tauri::command]
pub fn solve_engine_circle_packing(
    stage_diameter: f64,
    engines: Vec<EnginePlacementInput>,
    constraints: PackingConstraints,
) -> Result<BaseLayoutResult, String> {
    solve_pack(stage_diameter, &engines, &constraints)
}
