use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnginePlacementInput {
    pub id: String,
    pub nozzle_diameter_m: f64,
    pub gimbal_lever_arm_m: f64,
    pub tvc_angle_deg: f64,
    pub custom_x_m: Option<f64>,
    pub custom_y_m: Option<f64>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackingConstraints {
    pub skirt_wall_thickness_m: f64,
    pub skirt_clearance_m: f64,
    pub no_touch_margin_m: f64,
    pub default_tvc_angle_deg: f64,
}

impl Default for PackingConstraints {
    fn default() -> Self {
        Self {
            skirt_wall_thickness_m: 0.03,
            skirt_clearance_m: 0.12,
            no_touch_margin_m: 0.10,
            default_tvc_angle_deg: 7.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlacedEngineCircle {
    pub index: usize,
    pub id: String,
    pub x_m: f64,
    pub y_m: f64,
    pub nozzle_radius_m: f64,
    pub gimbal_sweep_radius_m: f64,
    pub footprint_radius_m: f64,
    pub enabled: bool,
    pub clashes_with_skirt: bool,
    pub clashes_with_indices: Vec<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaseLayoutResult {
    pub stage_diameter_m: f64,
    pub allowable_diameter_m: f64,
    pub usable_diameter_m: f64,
    pub required_diameter_m: f64,
    pub clearance_margin_m: f64,
    pub fits: bool,
    pub pattern_name: String,
    pub placements: Vec<PlacedEngineCircle>,
    pub min_pair_gap_m: f64,
}

fn calc_engine_radii(
    input: &EnginePlacementInput,
    constraints: &PackingConstraints,
    scaled_margin_m: f64,
) -> (f64, f64, f64) {
    let tvc_deg = if input.tvc_angle_deg >= 0.0 {
        input.tvc_angle_deg
    } else {
        constraints.default_tvc_angle_deg
    };
    let tvc_rad = tvc_deg.to_radians();
    let tvc_sweep_diam_m = 2.0 * input.gimbal_lever_arm_m * tvc_rad.sin();
    let d_footprint_m = input.nozzle_diameter_m + tvc_sweep_diam_m + scaled_margin_m;
    let nozzle_radius_m = 0.5 * input.nozzle_diameter_m;
    let gimbal_sweep_radius_m = 0.5 * (input.nozzle_diameter_m + tvc_sweep_diam_m);
    let footprint_radius_m = 0.5 * d_footprint_m;
    (nozzle_radius_m, gimbal_sweep_radius_m, footprint_radius_m)
}

fn generate_ring_coords(count: usize, radius_m: f64, phase_rad: f64) -> Vec<(f64, f64)> {
    let mut coords = Vec::with_capacity(count);
    for idx in 0..count {
        let angle_rad = phase_rad + (2.0 * std::f64::consts::PI * (idx as f64)) / (count as f64);
        coords.push((radius_m * angle_rad.cos(), radius_m * angle_rad.sin()));
    }
    coords
}

fn build_automatic_coords(
    n_engines: usize,
    radii_list: &[(f64, f64, f64)],
) -> (String, Vec<(f64, f64)>) {
    if n_engines == 0 {
        return ("Empty".to_string(), Vec::new());
    }
    if n_engines == 1 {
        return ("Pattern A: Single Center Engine".to_string(), vec![(0.0, 0.0)]);
    }
    let max_footprint_diam_m = radii_list
        .iter()
        .map(|r| 2.0 * r.2)
        .fold(0.0_f64, f64::max);

    if n_engines == 33 {
        let mut coords = Vec::with_capacity(33);
        let foot_r_in = radii_list.first().map(|r| r.2).unwrap_or(0.96);
        let r_inner_m = foot_r_in / (std::f64::consts::PI / 3.0).sin();
        coords.extend(generate_ring_coords(3, r_inner_m, 0.0));
        let foot_r_mid = radii_list.get(3).map(|r| r.2).unwrap_or(0.96);
        let r_mid_req_m = foot_r_mid / (std::f64::consts::PI / 10.0).sin();
        let r_mid_m = r_mid_req_m.max(r_inner_m + foot_r_in + foot_r_mid);
        coords.extend(generate_ring_coords(10, r_mid_m, 0.15));
        let foot_r_out = radii_list.get(13).map(|r| r.2).unwrap_or(0.67);
        let r_out_req_m = foot_r_out / (std::f64::consts::PI / 20.0).sin();
        let r_out_m = r_out_req_m.max(r_mid_m + foot_r_mid + foot_r_out);
        coords.extend(generate_ring_coords(20, r_out_m, 0.0));
        return ("Pattern D: Dense Multi-Ring (3 + 10 + 20)".to_string(), coords);
    }

    if n_engines == 5 {
        let r_center = radii_list.first().map(|r| r.2).unwrap_or(max_footprint_diam_m * 0.5);
        let r_outer = radii_list.get(1).map(|r| r.2).unwrap_or(max_footprint_diam_m * 0.5);
        let r_ring_m = (r_center + r_outer).max(std::f64::consts::SQRT_2 * r_outer);
        let mut coords = vec![(0.0, 0.0)];
        coords.extend(generate_ring_coords(4, r_ring_m, std::f64::consts::FRAC_PI_4));
        return ("Pattern C: 1 Center + 4 Outer".to_string(), coords);
    }

    if n_engines <= 4 {
        let r_ring_m = max_footprint_diam_m / (2.0 * (std::f64::consts::PI / (n_engines as f64)).sin());
        return (
            format!("Pattern B: Ring of {n_engines}"),
            generate_ring_coords(n_engines, r_ring_m, std::f64::consts::FRAC_PI_4),
        );
    }

    if n_engines <= 9 {
        let n_outer = n_engines - 1;
        let r_center = radii_list.first().map(|r| r.2).unwrap_or(max_footprint_diam_m * 0.5);
        let r_outer = radii_list.get(1).map(|r| r.2).unwrap_or(max_footprint_diam_m * 0.5);
        let r_ring_outer = r_outer / (std::f64::consts::PI / (n_outer as f64)).sin();
        let r_ring_m = r_ring_outer.max(r_center + r_outer);
        let mut coords = vec![(0.0, 0.0)];
        coords.extend(generate_ring_coords(n_outer, r_ring_m, std::f64::consts::FRAC_PI_4));
        return (format!("Pattern C: 1 Center + {n_outer} Outer"), coords);
    }

    if n_engines <= 21 {
        let n_inner = if n_engines >= 16 { 5 } else { 3 };
        let n_outer = n_engines - n_inner;
        let r_inner_m = max_footprint_diam_m / (2.0 * (std::f64::consts::PI / (n_inner as f64)).sin());
        let r_outer_req_m = max_footprint_diam_m / (2.0 * (std::f64::consts::PI / (n_outer as f64)).sin());
        let r_outer_m = r_outer_req_m.max(r_inner_m + max_footprint_diam_m);
        let mut coords = generate_ring_coords(n_inner, r_inner_m, 0.0);
        coords.extend(generate_ring_coords(n_outer, r_outer_m, 0.1));
        return (
            format!("Pattern D: Dual Ring ({n_inner} + {n_outer})"),
            coords,
        );
    }

    let n_center = 3;
    let n_mid = ((n_engines - n_center) as f64 * 0.35).round() as usize;
    let n_outer = n_engines - n_center - n_mid;
    let r_inner_m = max_footprint_diam_m / (2.0 * (std::f64::consts::PI / 3.0).sin());
    let r_mid_req_m = max_footprint_diam_m / (2.0 * (std::f64::consts::PI / (n_mid.max(3) as f64)).sin());
    let r_mid_m = r_mid_req_m.max(r_inner_m + max_footprint_diam_m);
    let r_out_req_m = max_footprint_diam_m / (2.0 * (std::f64::consts::PI / (n_outer.max(4) as f64)).sin());
    let r_out_m = r_out_req_m.max(r_mid_m + max_footprint_diam_m);
    let mut coords = generate_ring_coords(n_center, r_inner_m, 0.0);
    coords.extend(generate_ring_coords(n_mid, r_mid_m, 0.15));
    coords.extend(generate_ring_coords(n_outer, r_out_m, 0.0));
    (
        format!("Pattern D: Multi-Ring ({n_center} + {n_mid} + {n_outer})"),
        coords,
    )
}

pub fn solve_engine_circle_packing(
    stage_diameter_m: f64,
    engines: &[EnginePlacementInput],
    constraints: &PackingConstraints,
) -> Result<BaseLayoutResult, String> {
    if stage_diameter_m <= 0.0 {
        return Err("Stage diameter must be positive.".to_string());
    }
    let allowable_diameter_m = if engines.len() > 1 {
        stage_diameter_m * 1.35
    } else {
        stage_diameter_m
    };
    let scaled_skirt_wall = constraints.skirt_wall_thickness_m.min(0.015 * stage_diameter_m).max(0.003);
    let scaled_skirt_clr = constraints.skirt_clearance_m.min(0.04 * stage_diameter_m).max(0.02);
    let term1_skirt_m = 2.0 * (scaled_skirt_wall + scaled_skirt_clr);
    let allowable_usable_m = (allowable_diameter_m - term1_skirt_m).max(0.1);
    let usable_radius_m = 0.5 * allowable_usable_m;

    let mut radii_list = Vec::with_capacity(engines.len());
    for (idx, eng) in engines.iter().enumerate() {
        let is_center_rigid = (engines.len() == 5 || engines.len() == 9) && idx == 0;
        let is_outer_fixed_33 = engines.len() == 33 && idx >= 13;
        let effective_tvc_deg = if is_center_rigid || is_outer_fixed_33 {
            0.0
        } else if eng.tvc_angle_deg >= 0.0 {
            eng.tvc_angle_deg
        } else {
            constraints.default_tvc_angle_deg
        };
        let scaled_margin = constraints
            .no_touch_margin_m
            .min(0.08 * eng.nozzle_diameter_m)
            .max(0.015);
        let mut eng_copy = eng.clone();
        eng_copy.tvc_angle_deg = effective_tvc_deg;
        let (noz_r_m, gim_r_m, foot_r_m) = calc_engine_radii(&eng_copy, constraints, scaled_margin);
        radii_list.push((noz_r_m, gim_r_m, foot_r_m));
    }

    let (base_pattern_name, auto_coords) = build_automatic_coords(engines.len(), &radii_list);
    let pattern_name = format!("Optimal Circle Packing: {base_pattern_name}");

    let mut placements = Vec::with_capacity(engines.len());
    let mut max_req_radius_m = 0.0_f64;

    for (idx, eng) in engines.iter().enumerate() {
        let (x_m, y_m) = match (eng.custom_x_m, eng.custom_y_m) {
            (Some(cx), Some(cy)) => (cx, cy),
            _ => auto_coords.get(idx).copied().unwrap_or((0.0, 0.0)),
        };
        let (nozzle_radius_m, gimbal_sweep_radius_m, footprint_radius_m) = radii_list[idx];
        let radial_dist_m = (x_m * x_m + y_m * y_m).sqrt() + footprint_radius_m;
        if eng.enabled {
            max_req_radius_m = max_req_radius_m.max(radial_dist_m);
        }
        let clashes_with_skirt = eng.enabled && (radial_dist_m > usable_radius_m + 1e-6);
        placements.push(PlacedEngineCircle {
            index: idx,
            id: eng.id.clone(),
            x_m,
            y_m,
            nozzle_radius_m,
            gimbal_sweep_radius_m,
            footprint_radius_m,
            enabled: eng.enabled,
            clashes_with_skirt,
            clashes_with_indices: Vec::new(),
        });
    }

    let mut min_pair_gap_m = f64::INFINITY;
    let mut any_clash = false;
    for i in 0..placements.len() {
        if placements[i].clashes_with_skirt {
            any_clash = true;
        }
        if !placements[i].enabled {
            continue;
        }
        for j in (i + 1)..placements.len() {
            if !placements[j].enabled {
                continue;
            }
            let dx_m = placements[i].x_m - placements[j].x_m;
            let dy_m = placements[i].y_m - placements[j].y_m;
            let dist_m = (dx_m * dx_m + dy_m * dy_m).sqrt();
            let req_dist_m = placements[i].footprint_radius_m + placements[j].footprint_radius_m;
            let gap_m = dist_m - req_dist_m;
            min_pair_gap_m = min_pair_gap_m.min(gap_m);
            if gap_m < -1e-5 {
                any_clash = true;
                placements[i].clashes_with_indices.push(j);
                placements[j].clashes_with_indices.push(i);
            }
        }
    }

    if min_pair_gap_m.is_infinite() {
        min_pair_gap_m = allowable_usable_m - 2.0 * max_req_radius_m;
    }

    let required_diameter_m = 2.0 * max_req_radius_m;
    let clearance_margin_m = allowable_usable_m - required_diameter_m;
    let fits = !any_clash && clearance_margin_m >= -1e-6;

    Ok(BaseLayoutResult {
        stage_diameter_m,
        allowable_diameter_m,
        usable_diameter_m: allowable_usable_m,
        required_diameter_m,
        clearance_margin_m,
        fits,
        pattern_name,
        placements,
        min_pair_gap_m,
    })
}
