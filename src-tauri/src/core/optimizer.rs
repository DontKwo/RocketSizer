use super::models::engine::{EngineCycle, EngineSpec, PropellantType, PropulsionType};
use super::models::mission::OptimizationStrategy;
use super::models::vehicle::{
    SizingRequest, SizingSweepResponse, VehicleConfiguration, VehicleSizingResult,
};
use super::staging::evaluate_vehicle_configuration;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SensitivityPoint {
    pub parameter_value: f64,
    pub glow_kg: f64,
    pub total_dry_mass_kg: f64,
    pub reusable_flight_cost_usd: f64,
    pub expendable_flight_cost_usd: f64,
    pub cost_per_kg_usd: f64,
    pub payload_fraction: f64,
    pub liftoff_tw0: f64,
    pub feasible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SensitivityCurveResponse {
    pub sweep_parameter: String,
    pub points: Vec<SensitivityPoint>,
}

fn score_candidate(res: &VehicleSizingResult, req: &SizingRequest, glow_ref_kg: f64, cost_ref_usd: f64, dry_ref_kg: f64) -> f64 {
    let weight_sum = req.glow_weight + req.cost_weight;
    let (w_glow, w_cost) = if weight_sum > 0.0 {
        (req.glow_weight / weight_sum, req.cost_weight / weight_sum)
    } else {
        match req.strategy {
            OptimizationStrategy::MinimizeGlow => (1.0, 0.0),
            OptimizationStrategy::MinimizeCost => (0.0, 1.0),
            _ => (0.5, 0.5),
        }
    };
    let w_dry = req.dry_mass_weight;
    let term1 = w_glow * (res.glow_kg / glow_ref_kg.max(1.0));
    let term2 = w_cost * (res.cost_breakdown.reusable_flight_cost_usd / cost_ref_usd.max(1.0));
    let term3 = w_dry * (res.total_dry_mass_kg / dry_ref_kg.max(1.0));
    term1 + term2 + term3
}

fn extract_pareto_frontier(candidates: &[VehicleSizingResult]) -> Vec<VehicleSizingResult> {
    let mut sorted = candidates.to_vec();
    sorted.sort_by(|a, b| a.glow_kg.partial_cmp(&b.glow_kg).unwrap_or(std::cmp::Ordering::Equal));
    let mut frontier: Vec<VehicleSizingResult> = Vec::new();
    let mut best_cost_so_far = f64::INFINITY;
    for cand in sorted {
        let cost = cand.cost_breakdown.reusable_flight_cost_usd;
        if cost < best_cost_so_far {
            best_cost_so_far = cost;
            frontier.push(cand);
        }
    }
    frontier
}

/// Select a deterministic, propellant-diverse engine subset bounded by `limit`.
fn select_diverse_engines<'a>(
    mut candidates: Vec<&'a EngineSpec>,
    required_ids: &[&str],
    limit: usize,
) -> Vec<&'a EngineSpec> {
    candidates.sort_by(|a, b| a.id.cmp(&b.id));
    if candidates.len() <= limit {
        return candidates;
    }
    let mut selected: Vec<&'a EngineSpec> = Vec::with_capacity(limit);
    let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
    for &req in required_ids {
        if let Some(eng) = candidates.iter().copied().find(|e| e.id == req) {
            if seen.insert(eng.id.as_str()) {
                selected.push(eng);
            }
        }
    }
    // Round-robin pick across distinct propellant keys so all chemical families stay represented.
    let mut groups: std::collections::BTreeMap<String, Vec<&'a EngineSpec>> = std::collections::BTreeMap::new();
    for eng in &candidates {
        if !seen.contains(eng.id.as_str()) {
            groups.entry(format!("{:?}", eng.propellant)).or_default().push(*eng);
        }
    }
    let mut idx = 0usize;
    while selected.len() < limit {
        let mut added_any = false;
        for bucket in groups.values() {
            if idx < bucket.len() && selected.len() < limit {
                let eng = bucket[idx];
                if seen.insert(eng.id.as_str()) {
                    selected.push(eng);
                }
                added_any = true;
            }
        }
        if !added_any {
            break;
        }
        idx += 1;
    }
    selected
}

fn engine_family_key(id: &str) -> &str {
    if id.starts_with("merlin_1d") {
        "merlin_1d"
    } else if id.starts_with("raptor") {
        "raptor"
    } else if id.starts_with("rutherford") {
        "rutherford"
    } else if id.starts_with("be_3") {
        "be_3"
    } else if id.starts_with("rl_10") {
        "rl_10"
    } else if id.starts_with("nk_33") {
        "nk_33"
    } else if id.starts_with("yf_75") {
        "yf_75"
    } else if id.starts_with("archimedes") {
        "archimedes"
    } else {
        id.strip_suffix("_vac").unwrap_or(id)
    }
}

fn prop_to_key(prop: PropellantType) -> &'static str {
    match prop {
        PropellantType::LoxRp1 => "lox_rp1",
        PropellantType::LoxCh4 => "lox_ch4",
        PropellantType::LoxLh2 => "lox_lh2",
        PropellantType::SolidHtpb => "solid_htpb",
        PropellantType::HypergolicNtoUdmh => "hypergolic_nto_udmh",
    }
}

fn cycle_to_key(cycle: EngineCycle) -> &'static str {
    match cycle {
        EngineCycle::GasGenerator => "gas_generator",
        EngineCycle::StagedCombustion => "staged_combustion",
        EngineCycle::FullFlowStagedCombustion => "full_flow_staged_combustion",
        EngineCycle::Expander => "expander",
        EngineCycle::ElectricPump => "electric_pump",
        EngineCycle::PressureFed => "pressure_fed",
        EngineCycle::SolidMotor => "solid_motor",
    }
}

fn engine_matches_stage_filters(
    eng: &EngineSpec,
    allowed_engines: &[String],
    allowed_propellants: &[String],
    allowed_cycles: &[String],
) -> bool {
    if !allowed_engines.is_empty() && !allowed_engines.iter().any(|id| id == &eng.id) {
        return false;
    }
    if !allowed_propellants.is_empty() && !allowed_propellants.iter().any(|p| p == prop_to_key(eng.propellant)) {
        return false;
    }
    if !allowed_cycles.is_empty() && !allowed_cycles.iter().any(|c| c == cycle_to_key(eng.cycle)) {
        return false;
    }
    true
}

fn stages_satisfy_commonality(
    req: &SizingRequest,
    s1: &EngineSpec,
    s2: &EngineSpec,
    s3: Option<&EngineSpec>,
) -> bool {
    let eng_stages = &req.enforce_same_engine_stages;
    let fuel_stages = &req.enforce_same_fuel_stages;
    if eng_stages.contains(&1) && eng_stages.contains(&2) && engine_family_key(&s1.id) != engine_family_key(&s2.id) {
        return false;
    }
    if let Some(s3_eng) = s3 {
        if eng_stages.contains(&1) && eng_stages.contains(&3) && engine_family_key(&s1.id) != engine_family_key(&s3_eng.id) {
            return false;
        }
        if eng_stages.contains(&2) && eng_stages.contains(&3) && engine_family_key(&s2.id) != engine_family_key(&s3_eng.id) {
            return false;
        }
    }
    if fuel_stages.contains(&1) && fuel_stages.contains(&2) && s1.propellant != s2.propellant {
        return false;
    }
    if let Some(s3_eng) = s3 {
        if fuel_stages.contains(&1) && fuel_stages.contains(&3) && s1.propellant != s3_eng.propellant {
            return false;
        }
        if fuel_stages.contains(&2) && fuel_stages.contains(&3) && s2.propellant != s3_eng.propellant {
            return false;
        }
    }
    true
}

pub fn run_combinatorial_sizing(
    request: &SizingRequest,
    engines_map: &HashMap<String, EngineSpec>,
) -> Result<SizingSweepResponse, String> {
    let start_time = Instant::now();
    let base = &request.base_config;
    if base.stages.len() < 2 {
        return Err("Combinatorial sizing requires at least 2 stages.".to_string());
    }

    let liquids: Vec<&EngineSpec> = engines_map
        .values()
        .filter(|e| e.propulsion_type == PropulsionType::Liquid)
        .collect();
    let mut solids: Vec<&EngineSpec> = engines_map
        .values()
        .filter(|e| {
            e.propulsion_type == PropulsionType::Solid
                && engine_matches_stage_filters(e, &base.constraints.booster_allowed_engines, &[], &[])
        })
        .collect();
    solids.sort_by(|a, b| a.id.cmp(&b.id));
    if solids.len() > 6 && base.constraints.booster_allowed_engines.is_empty() {
        let base_bst = base.booster_engine_id.as_deref().unwrap_or("");
        solids = select_diverse_engines(solids, &[base_bst, "gem_63xl", "sls_fsrb", "p120c"], 6);
    }

    let is_three_stage = base.stage_count >= 3 || base.stages.len() >= 3;
    let steps = request.dv_grid_steps.clamp(3, 12);
    let mut evaluated_count: usize = 0;
    let mut feasible_candidates: Vec<VehicleSizingResult> = Vec::new();
    let mut rejection_summary: HashMap<String, usize> = HashMap::new();
    let g0 = 9.80665_f64;
    let est_dv_total = base.required_delta_v_m_s.unwrap_or(9_350.0);

    let booster_choices: Vec<Option<String>> = if request.include_boosters {
        if solids.is_empty() {
            return Ok(SizingSweepResponse {
                best_result: None,
                pareto_frontier: Vec::new(),
                top_candidates: Vec::new(),
                evaluated_count: 0,
                feasible_count: 0,
                rejection_summary,
                solver_elapsed_ms: start_time.elapsed().as_secs_f64() * 1_000.0,
            });
        }
        solids.iter().map(|b| Some(b.id.clone())).collect()
    } else {
        vec![None]
    };

    let booster_counts: Vec<usize> = if request.include_boosters {
        let mut counts: Vec<usize> = base
            .constraints
            .allowed_booster_counts
            .iter()
            .copied()
            .filter(|&c| c > 0)
            .collect();
        if counts.is_empty() {
            counts = vec![2, 4];
        }
        counts
    } else {
        vec![0]
    };

    let core_counts: Vec<usize> = vec![1, 2, 3, 4, 5, 7, 9, 13, 21, 33]
        .into_iter()
        .filter(|c| *c <= base.constraints.max_core_engines)
        .collect();
    let upper_counts: Vec<usize> = (1..=base.constraints.max_upper_engines.min(6)).collect();

    let base_core_id = base.stages.first().map(|s| s.engine_id.as_str()).unwrap_or("");
    let base_s2_id = base.stages.get(1).map(|s| s.engine_id.as_str()).unwrap_or("");
    let base_upper_id = base.stages.last().map(|s| s.engine_id.as_str()).unwrap_or("");

    let c = &base.constraints;
    let s1_pool: Vec<&EngineSpec> = liquids
        .iter()
        .copied()
        .filter(|e| {
            e.thrust_sl_n >= 40_000.0
                && engine_matches_stage_filters(e, &c.stage1_allowed_engines, &c.stage1_allowed_propellants, &c.stage1_allowed_cycles)
        })
        .collect();
    let s2_pool: Vec<&EngineSpec> = liquids
        .iter()
        .copied()
        .filter(|e| {
            e.isp_vac_s >= 305.0
                && engine_matches_stage_filters(e, &c.stage2_allowed_engines, &c.stage2_allowed_propellants, &c.stage2_allowed_cycles)
        })
        .collect();
    let s3_pool: Vec<&EngineSpec> = liquids
        .iter()
        .copied()
        .filter(|e| {
            e.isp_vac_s >= 315.0
                && engine_matches_stage_filters(e, &c.stage3_allowed_engines, &c.stage3_allowed_propellants, &c.stage3_allowed_cycles)
        })
        .collect();

    let core_cands: Vec<&EngineSpec> = if !c.stage1_allowed_engines.is_empty() {
        s1_pool
    } else {
        select_diverse_engines(
            s1_pool,
            &[base_core_id, "merlin_1d", "be_4", "raptor_2", "rs_25", "vulcain_2_1"],
            if request.include_boosters { 10 } else { 14 },
        )
    };
    let upper_cands: Vec<&EngineSpec> = if !c.stage2_allowed_engines.is_empty() {
        s2_pool.clone()
    } else {
        select_diverse_engines(
            s2_pool.clone(),
            &[base_upper_id, "merlin_1d_vac", "rl_10c_1", "raptor_vac", "j_2"],
            if request.include_boosters { 10 } else { 14 },
        )
    };

    let est_stage_m0 = |m_above: f64, dv: f64, isp: f64| -> f64 {
        let mr = (dv / (isp.max(200.0) * g0)).exp();
        (m_above * mr * 1.15).min(1.0e9)
    };

    if is_three_stage {
        let mid_limit = if request.include_boosters { 5 } else { 8 };
        let top_limit = if request.include_boosters { 5 } else { 8 };
        let mid_cands: Vec<&EngineSpec> = if !c.stage2_allowed_engines.is_empty() {
            s2_pool
        } else {
            select_diverse_engines(
                s2_pool,
                &[base_s2_id, "j_2", "merlin_1d_vac", "rl_10c_1", "raptor_vac", "be_3u"],
                mid_limit,
            )
        };
        let top_cands: Vec<&EngineSpec> = if !c.stage3_allowed_engines.is_empty() {
            s3_pool
        } else {
            select_diverse_engines(
                s3_pool,
                &[base_upper_id, "rl_10c_1", "j_2", "hm7b", "vinci", "raptor_vac", "merlin_1d_vac"],
                top_limit,
            )
        };
        let split_pairs_all: &[(f64, f64)] = &[
            (0.32, 0.28),
            (0.35, 0.26),
            (0.30, 0.33),
            (0.30, 0.24),
            (0.28, 0.24),
        ];
        let split_pairs: &[(f64, f64)] = if request.include_boosters {
            &split_pairs_all[..3]
        } else {
            split_pairs_all
        };
        let s3_counts: Vec<usize> = (1..=base.constraints.max_upper_engines.min(3)).collect();
        let s2_counts: Vec<usize> = vec![1, 2, 3, 5]
            .into_iter()
            .filter(|c| *c <= base.constraints.max_upper_engines.min(6))
            .collect();
        let raw_core_3s: Vec<usize> = if request.include_boosters {
            vec![1, 2, 3, 5, 7, 9]
        } else {
            vec![1, 2, 3, 4, 5, 7, 9, 13, 21]
        };
        let core_3s_counts: Vec<usize> = raw_core_3s
            .into_iter()
            .filter(|c| *c <= base.constraints.max_core_engines)
            .collect();
        let boost_choices_3s: Vec<Option<String>> = booster_choices.iter().take(3).cloned().collect();
        let boost_counts_3s: Vec<usize> = booster_counts
            .iter()
            .copied()
            .filter(|&c| c >= base.constraints.min_strapon_count && c <= base.constraints.max_strapon_count)
            .take(2)
            .collect();

        for top_eng in &top_cands {
            for &n_top in &s3_counts {
                for &(s2_split, s3_split) in split_pairs {
                    let approx_m0_s3 = est_stage_m0(base.payload_mass_kg * 1.12, est_dv_total * s3_split, top_eng.isp_vac_s);
                    let approx_tw3 = (top_eng.thrust_vac_n * (n_top as f64)) / (approx_m0_s3 * g0);
                    if approx_tw3 < base.constraints.min_stage3_tw0 * 0.45 || approx_tw3 > base.constraints.max_stage3_tw0 * 2.2 {
                        continue;
                    }
                    let s1_split = 1.0 - s2_split - s3_split;
                    for mid_eng in &mid_cands {
                        if !request.allow_same_engine_stages
                            && request.enforce_same_engine_stages.is_empty()
                            && mid_eng.id == top_eng.id
                            && mid_cands.len() > 1
                        {
                            continue;
                        }
                        for &n_mid in &s2_counts {
                            let approx_m0_s2 = est_stage_m0(approx_m0_s3, est_dv_total * s2_split, mid_eng.isp_vac_s);
                            let approx_tw2 = (mid_eng.thrust_vac_n * (n_mid as f64)) / (approx_m0_s2 * g0);
                            if approx_tw2 < base.constraints.min_upper_tw0 * 0.45 || approx_tw2 > base.constraints.max_upper_tw0 * 2.2 {
                                continue;
                            }
                            let core_limit = if c.stage1_allowed_engines.is_empty() {
                                if request.include_boosters { 5 } else { 8 }
                            } else {
                                core_cands.len()
                            };
                            for core_eng in core_cands.iter().take(core_limit) {
                                if !stages_satisfy_commonality(request, core_eng, mid_eng, Some(top_eng)) {
                                    continue;
                                }
                                if !request.allow_same_engine_stages
                                    && request.enforce_same_engine_stages.is_empty()
                                    && (core_eng.id == mid_eng.id || core_eng.id == top_eng.id)
                                {
                                    continue;
                                }
                                let approx_m0_s1 = est_stage_m0(approx_m0_s2, est_dv_total * s1_split, core_eng.isp_vac_s);
                                for &n_core in &core_3s_counts {
                                    for b_opt in &boost_choices_3s {
                                        let b_thrust_each = b_opt
                                            .as_ref()
                                            .and_then(|id| engines_map.get(id))
                                            .map(|e| e.thrust_sl_n)
                                            .unwrap_or(0.0);
                                        for &n_b in &boost_counts_3s {
                                            if (b_opt.is_none() && n_b > 0) || (b_opt.is_some() && n_b == 0) {
                                                continue;
                                            }
                                            let liftoff_thrust = core_eng.thrust_sl_n * (n_core as f64) + b_thrust_each * (n_b as f64);
                                            let approx_tw1 = liftoff_thrust / (approx_m0_s1 * g0);
                                            if approx_tw1 < base.constraints.min_liftoff_tw0 * 0.45
                                                || approx_tw1 > base.constraints.max_liftoff_tw0 * 2.5
                                            {
                                                continue;
                                            }
                                            let mut cand_cfg = base.clone();
                                            cand_cfg.stage_count = 3;
                                            cand_cfg.booster_engine_id = b_opt.clone();
                                            cand_cfg.booster_count = n_b;
                                            cand_cfg.stages[0].engine_id = core_eng.id.clone();
                                            cand_cfg.stages[0].engine_count = n_core;
                                            cand_cfg.stages[0].delta_v_split_frac = s1_split;
                                            cand_cfg.stages[1].stage_number = 2;
                                            cand_cfg.stages[1].engine_id = mid_eng.id.clone();
                                            cand_cfg.stages[1].engine_count = n_mid;
                                            cand_cfg.stages[1].delta_v_split_frac = s2_split;
                                            cand_cfg.stages[2].stage_number = 3;
                                            cand_cfg.stages[2].engine_id = top_eng.id.clone();
                                            cand_cfg.stages[2].engine_count = n_top;
                                            cand_cfg.stages[2].delta_v_split_frac = s3_split;

                                            evaluated_count += 1;
                                            if let Ok(res) = evaluate_vehicle_configuration(&cand_cfg, engines_map) {
                                                if res.feasible {
                                                    feasible_candidates.push(res);
                                                } else {
                                                    for (k, v) in res.constraint_violations {
                                                        *rejection_summary.entry(k).or_insert(0) += v;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    } else {
        for upper_eng in &upper_cands {
            for &n_upper in &upper_counts {
                for step_idx in 0..steps {
                    let s2_split = 0.26 + 0.38 * ((step_idx as f64) / ((steps - 1).max(1) as f64));
                    let approx_m0_s2 = est_stage_m0(base.payload_mass_kg * 1.12, est_dv_total * s2_split, upper_eng.isp_vac_s);
                    let approx_tw2 = (upper_eng.thrust_vac_n * (n_upper as f64)) / (approx_m0_s2 * g0);
                    if approx_tw2 < base.constraints.min_upper_tw0 * 0.45 || approx_tw2 > base.constraints.max_upper_tw0 * 2.2 {
                        continue;
                    }
                    for core_eng in &core_cands {
                        if !stages_satisfy_commonality(request, core_eng, upper_eng, None) {
                            continue;
                        }
                        if !request.allow_same_engine_stages
                            && request.enforce_same_engine_stages.is_empty()
                            && core_eng.id == upper_eng.id
                            && core_cands.len() > 1
                        {
                            continue;
                        }
                        let approx_m0_s1 = est_stage_m0(approx_m0_s2, est_dv_total * (1.0 - s2_split), core_eng.isp_vac_s);
                        for &n_core in &core_counts {
                            for b_opt in &booster_choices {
                                let b_thrust_each = b_opt
                                    .as_ref()
                                    .and_then(|id| engines_map.get(id))
                                    .map(|e| e.thrust_sl_n)
                                    .unwrap_or(0.0);
                                for &n_b in &booster_counts {
                                    if (b_opt.is_none() && n_b > 0) || (b_opt.is_some() && n_b == 0) {
                                        continue;
                                    }
                                    let liftoff_thrust = core_eng.thrust_sl_n * (n_core as f64) + b_thrust_each * (n_b as f64);
                                    let approx_tw1 = liftoff_thrust / (approx_m0_s1 * g0);
                                    if approx_tw1 < base.constraints.min_liftoff_tw0 * 0.45
                                        || approx_tw1 > base.constraints.max_liftoff_tw0 * 2.5
                                    {
                                        continue;
                                    }
                                    let mut cand_cfg = base.clone();
                                    cand_cfg.stage_count = 2;
                                    cand_cfg.booster_engine_id = b_opt.clone();
                                    cand_cfg.booster_count = n_b;
                                    cand_cfg.stages[0].engine_id = core_eng.id.clone();
                                    cand_cfg.stages[0].engine_count = n_core;
                                    cand_cfg.stages[0].delta_v_split_frac = 1.0 - s2_split;
                                    let last_idx = cand_cfg.stages.len() - 1;
                                    cand_cfg.stages[last_idx].engine_id = upper_eng.id.clone();
                                    cand_cfg.stages[last_idx].engine_count = n_upper;
                                    cand_cfg.stages[last_idx].delta_v_split_frac = s2_split;

                                    evaluated_count += 1;
                                    if let Ok(res) = evaluate_vehicle_configuration(&cand_cfg, engines_map) {
                                        if res.feasible {
                                            feasible_candidates.push(res);
                                        } else {
                                            for (k, v) in res.constraint_violations {
                                                *rejection_summary.entry(k).or_insert(0) += v;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if feasible_candidates.is_empty() {
        let mut fallback_cfg = base.clone();
        fallback_cfg.constraints.enforce_base_packing = false;
        let b_fallback = if request.include_boosters { booster_choices.first().cloned().unwrap_or(None) } else { None };
        let nb_fallback = if request.include_boosters && b_fallback.is_some() { booster_counts.first().copied().unwrap_or(2) } else { 0 };
        fallback_cfg.booster_engine_id = b_fallback;
        fallback_cfg.booster_count = nb_fallback;
        for upper_eng in &upper_cands {
            for core_eng in &core_cands {
                for &n_core in &core_counts {
                    fallback_cfg.stages[0].engine_id = core_eng.id.clone();
                    fallback_cfg.stages[0].engine_count = n_core;
                    if is_three_stage && fallback_cfg.stages.len() >= 3 {
                        fallback_cfg.stages[0].delta_v_split_frac = 0.36;
                        fallback_cfg.stages[1].engine_id = upper_eng.id.clone();
                        fallback_cfg.stages[1].engine_count = 2.min(base.constraints.max_upper_engines);
                        fallback_cfg.stages[1].delta_v_split_frac = 0.34;
                        fallback_cfg.stages[2].engine_id = upper_eng.id.clone();
                        fallback_cfg.stages[2].engine_count = 1;
                        fallback_cfg.stages[2].delta_v_split_frac = 0.30;
                    } else {
                        fallback_cfg.stages[0].delta_v_split_frac = 0.42;
                        let last_idx = fallback_cfg.stages.len() - 1;
                        fallback_cfg.stages[last_idx].engine_id = upper_eng.id.clone();
                        fallback_cfg.stages[last_idx].engine_count = 1;
                        fallback_cfg.stages[last_idx].delta_v_split_frac = 0.58;
                    }
                    evaluated_count += 1;
                    if let Ok(res) = evaluate_vehicle_configuration(&fallback_cfg, engines_map) {
                        if res.feasible {
                            feasible_candidates.push(res);
                        }
                    }
                }
            }
        }
    }

    let glow_ref_kg = feasible_candidates.iter().map(|c| c.glow_kg).fold(f64::INFINITY, f64::min).max(1.0);
    let cost_ref_usd = feasible_candidates
        .iter()
        .map(|c| c.cost_breakdown.reusable_flight_cost_usd)
        .fold(f64::INFINITY, f64::min)
        .max(1.0);
    let dry_ref_kg = feasible_candidates
        .iter()
        .map(|c| c.total_dry_mass_kg)
        .fold(f64::INFINITY, f64::min)
        .max(1.0);

    for cand in &mut feasible_candidates {
        cand.objective_score = score_candidate(cand, request, glow_ref_kg, cost_ref_usd, dry_ref_kg);
    }
    feasible_candidates.sort_by(|a, b| a.objective_score.partial_cmp(&b.objective_score).unwrap_or(std::cmp::Ordering::Equal));

    let pareto_frontier = extract_pareto_frontier(&feasible_candidates);
    let feasible_count = feasible_candidates.len();
    let best_result = feasible_candidates.first().cloned();
    let max_res = request.max_results.clamp(1, 50);
    let top_candidates = feasible_candidates.into_iter().take(max_res).collect();
    let solver_elapsed_ms = start_time.elapsed().as_secs_f64() * 1_000.0;

    Ok(SizingSweepResponse {
        best_result,
        pareto_frontier,
        top_candidates,
        evaluated_count,
        feasible_count,
        rejection_summary,
        solver_elapsed_ms,
    })
}

pub fn run_sensitivity_sweep(
    baseline: &VehicleConfiguration,
    sweep_parameter: &str,
    range_min: f64,
    range_max: f64,
    steps: usize,
    engines_map: &HashMap<String, EngineSpec>,
) -> Result<SensitivityCurveResponse, String> {
    let count = steps.clamp(2, 100);
    let mut points = Vec::with_capacity(count);
    for idx in 0..count {
        let frac = (idx as f64) / ((count - 1) as f64);
        let param_val = range_min + (range_max - range_min) * frac;
        let mut cfg = baseline.clone();

        match sweep_parameter {
            "payload_mass_kg" => {
                cfg.payload_mass_kg = param_val.max(10.0);
            }
            "s1_dv_split" | "stage1_dv_split" => {
                let s1 = param_val.clamp(0.15, 0.85);
                if cfg.stages.len() >= 2 {
                    cfg.stages[0].delta_v_split_frac = s1;
                    let remaining = 1.0 - s1;
                    let upper_count = (cfg.stages.len() - 1) as f64;
                    for s_idx in 1..cfg.stages.len() {
                        cfg.stages[s_idx].delta_v_split_frac = remaining / upper_count;
                    }
                }
            }
            "required_delta_v_m_s" => {
                cfg.required_delta_v_m_s = Some(param_val.clamp(2_000.0, 22_000.0));
            }
            "dv_margin_pct" => {
                cfg.orbit.dv_margin_pct = param_val.clamp(0.0, 20.0);
            }
            "production_quantity" => {
                cfg.production_quantity = param_val.round().clamp(1.0, 500.0) as u32;
            }
            "expected_reuses" => {
                cfg.expected_reuses = param_val.round().clamp(1.0, 200.0) as u32;
            }
            "mass_margin_frac" => {
                cfg.mass_margin_frac = param_val.clamp(0.0, 0.60);
            }
            "stage1_mf" => {
                if !cfg.stages.is_empty() {
                    cfg.stages[0].structural_mass_fraction_override = Some(param_val.clamp(0.75, 0.96));
                }
            }
            "stage2_mf" => {
                if cfg.stages.len() >= 2 {
                    let last = cfg.stages.len() - 1;
                    cfg.stages[last].structural_mass_fraction_override = Some(param_val.clamp(0.75, 0.95));
                }
            }
            "core_diameter_m" => {
                cfg.core_diameter_m = param_val.clamp(0.8, 15.0);
            }
            "core_engine_count" => {
                if !cfg.stages.is_empty() {
                    cfg.stages[0].engine_count = param_val.round().clamp(1.0, 33.0) as usize;
                }
            }
            _ => {
                cfg.payload_mass_kg = param_val.max(10.0);
            }
        }

        if let Ok(res) = evaluate_vehicle_configuration(&cfg, engines_map) {
            points.push(SensitivityPoint {
                parameter_value: param_val,
                glow_kg: res.glow_kg,
                total_dry_mass_kg: res.total_dry_mass_kg,
                reusable_flight_cost_usd: res.cost_breakdown.reusable_flight_cost_usd,
                expendable_flight_cost_usd: res.cost_breakdown.expendable_flight_cost_usd,
                cost_per_kg_usd: res.cost_breakdown.cost_per_kg_payload_usd,
                payload_fraction: res.payload_fraction,
                liftoff_tw0: res.liftoff_tw0,
                feasible: res.feasible,
            });
        }
    }

    Ok(SensitivityCurveResponse {
        sweep_parameter: sweep_parameter.to_string(),
        points,
    })
}
