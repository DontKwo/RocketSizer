use rocket_sizer_core::commands::cost_commands::compute_cost_model;
use rocket_sizer_core::commands::database_commands::{
    get_heritage_engines, get_heritage_vehicles, validate_heritage_models,
};
use rocket_sizer_core::commands::geometry_commands::solve_engine_circle_packing;
use rocket_sizer_core::commands::propulsion_commands::scale_rubber_engine;
use rocket_sizer_core::commands::sizing_commands::{
    build_engines_map, evaluate_manual_architecture, run_combinatorial_sizing, run_sensitivity_sweep,
    simulate_trajectory,
};
use rocket_sizer_core::core::cost_engine::CostModelParameters;
use rocket_sizer_core::core::models::mission::{
    ConstraintEnvelope, CryoStateMode, FairingProfile, MissionPreset, OptimizationStrategy, OrbitTarget,
    PressurizationMode, RecoveryMode, StagingArchitectureMode, TankMaterialPreset,
};
use rocket_sizer_core::core::models::vehicle::{SizingRequest, StageConfig, VehicleConfiguration};
use rocket_sizer_core::core::packaging::{EnginePlacementInput, PackingConstraints};

fn default_stage(stage_number: u8, engine_id: &str, engine_count: usize, split: f64, rec: RecoveryMode) -> StageConfig {
    StageConfig {
        stage_number,
        engine_id: engine_id.to_string(),
        engine_count,
        structural_mass_fraction_override: None,
        tank_material: TankMaterialPreset::AlLi2195,
        pressurization: PressurizationMode::HeliumCopv,
        common_bulkhead: false,
        delta_v_split_frac: split,
        recovery_mode: rec,
    }
}

#[test]
fn test_benchmark_1_saturn_v_staging_mass_fraction() {
    let mut cfg = VehicleConfiguration {
        name: "Saturn V Benchmark".to_string(),
        payload_mass_kg: 140_000.0,
        payload_diameter_m: 6.6,
        payload_length_m: 18.0,
        orbit: OrbitTarget {
            preset: MissionPreset::Leo285,
            ..OrbitTarget::default()
        },
        required_delta_v_m_s: Some(9_250.0),
        core_diameter_m: 10.1,
        stage_count: 3,
        booster_engine_id: None,
        booster_count: 0,
        stages: vec![
            default_stage(1, "f_1", 5, 0.36, RecoveryMode::Expendable),
            default_stage(2, "j_2", 5, 0.44, RecoveryMode::Expendable),
            default_stage(3, "j_2", 1, 0.20, RecoveryMode::Expendable),
        ],
        staging_mode: StagingArchitectureMode::ColdPneumaticUllage,
        cryo_state: CryoStateMode::StandardBoiling,
        fairing_profile: FairingProfile::VonKarman,
        fairing_reusable: false,
        mass_margin_frac: 0.0,
        max_q_throttle_frac: 1.0,
        max_q_bucket_duration_s: 0.0,
        g_limit: 4.5,
        expected_reuses: 1,
        production_quantity: 13,
        constraints: ConstraintEnvelope {
            min_liftoff_tw0: 1.05,
            max_liftoff_tw0: 1.5,
            min_upper_tw0: 0.20,
            max_upper_tw0: 1.2,
            ..ConstraintEnvelope::default()
        },
        custom_engines: Vec::new(),
        booster_recovery_mode: RecoveryMode::Expendable,
        recovery_optimizer_enabled: true,
        advanced_defaults: Default::default(),
    };
    cfg.stages[0].structural_mass_fraction_override = Some(0.941);
    cfg.stages[1].structural_mass_fraction_override = Some(0.925);
    cfg.stages[2].structural_mass_fraction_override = Some(0.910);
    cfg.required_delta_v_m_s = Some(9_175.0);

    let res = evaluate_manual_architecture(cfg).expect("Saturn V evaluation failed");
    let ref_glow_kg = 2_965_000.0;
    let rel_err = (res.glow_kg - ref_glow_kg).abs() / ref_glow_kg;
    assert!(
        rel_err <= 0.035,
        "Saturn V GLOW {} kg deviates by {:.2}% from 2,965,000 kg",
        res.glow_kg,
        rel_err * 100.0
    );
}

#[test]
fn test_benchmark_2_sls_block_1_parallel_boost() {
    let mut cfg = VehicleConfiguration {
        name: "SLS Block 1 Benchmark".to_string(),
        payload_mass_kg: 95_000.0,
        payload_diameter_m: 5.0,
        payload_length_m: 14.0,
        orbit: OrbitTarget {
            preset: MissionPreset::Leo285,
            ..OrbitTarget::default()
        },
        required_delta_v_m_s: Some(9_250.0),
        core_diameter_m: 8.4,
        stage_count: 2,
        booster_engine_id: Some("sls_fsrb".to_string()),
        booster_count: 2,
        stages: vec![
            default_stage(1, "rs_25", 4, 0.72, RecoveryMode::Expendable),
            default_stage(2, "rl_10a", 1, 0.28, RecoveryMode::Expendable),
        ],
        staging_mode: StagingArchitectureMode::ColdPneumaticUllage,
        cryo_state: CryoStateMode::StandardBoiling,
        fairing_profile: FairingProfile::TangentOgive,
        fairing_reusable: false,
        mass_margin_frac: 0.05,
        max_q_throttle_frac: 0.72,
        max_q_bucket_duration_s: 25.0,
        g_limit: 4.5,
        expected_reuses: 1,
        production_quantity: 4,
        constraints: ConstraintEnvelope {
            min_liftoff_tw0: 1.15,
            max_liftoff_tw0: 1.65,
            min_upper_tw0: 0.05,
            max_upper_tw0: 1.1,
            ..ConstraintEnvelope::default()
        },
        custom_engines: Vec::new(),
        booster_recovery_mode: RecoveryMode::Expendable,
        recovery_optimizer_enabled: true,
        advanced_defaults: Default::default(),
    };
    cfg.stages[0].structural_mass_fraction_override = Some(0.915);
    cfg.stages[1].structural_mass_fraction_override = Some(0.89);

    let res = evaluate_manual_architecture(cfg).expect("SLS evaluation failed");
    let s1 = &res.stages[0];
    let ref_strapon_inert_kg = 2.0 * 97_522.0 * 1.05;
    let err = (s1.strapon_inert_kg - ref_strapon_inert_kg).abs() / ref_strapon_inert_kg;
    assert!(err <= 0.04, "SLS booster burnout mass error {:.2}%", err * 100.0);
    assert!(s1.boost_phase_dv_m_s.unwrap_or(0.0) > 1_500.0);
    assert!(s1.core_only_dv_m_s.unwrap_or(0.0) > 2_000.0);
}

#[test]
fn test_benchmark_3_falcon_9_v12_modern_core() {
    let mut cfg = VehicleConfiguration {
        name: "Falcon 9 v1.2 Expendable".to_string(),
        payload_mass_kg: 22_800.0,
        payload_diameter_m: 4.6,
        payload_length_m: 11.0,
        orbit: OrbitTarget {
            preset: MissionPreset::Leo285,
            ..OrbitTarget::default()
        },
        required_delta_v_m_s: Some(9_020.0),
        core_diameter_m: 3.7,
        stage_count: 2,
        booster_engine_id: None,
        booster_count: 0,
        stages: vec![
            default_stage(1, "merlin_1d", 9, 0.37, RecoveryMode::Expendable),
            default_stage(2, "merlin_1d_vac", 1, 0.63, RecoveryMode::Expendable),
        ],
        staging_mode: StagingArchitectureMode::ColdPneumaticUllage,
        cryo_state: CryoStateMode::SubcooledDensified,
        fairing_profile: FairingProfile::VonKarman,
        fairing_reusable: true,
        mass_margin_frac: 0.01,
        max_q_throttle_frac: 0.72,
        max_q_bucket_duration_s: 22.0,
        g_limit: 4.5,
        expected_reuses: 15,
        production_quantity: 50,
        constraints: ConstraintEnvelope::default(),
        custom_engines: Vec::new(),
        booster_recovery_mode: RecoveryMode::Expendable,
        recovery_optimizer_enabled: true,
        advanced_defaults: Default::default(),
    };
    cfg.stages[0].structural_mass_fraction_override = Some(0.949);
    cfg.stages[1].structural_mass_fraction_override = Some(0.962);

    let res = evaluate_manual_architecture(cfg).expect("Falcon 9 evaluation failed");
    let ref_glow_kg = 549_054.0;
    let rel_err = (res.glow_kg - ref_glow_kg).abs() / ref_glow_kg;
    assert!(
        rel_err <= 0.03,
        "Falcon 9 GLOW {} kg deviates by {:.2}% from 549,054 kg",
        res.glow_kg,
        rel_err * 100.0
    );

    let cost = compute_cost_model(
        res,
        CostModelParameters {
            expected_reuses: 15,
            production_quantity: 60,
            fairing_reusable: true,
            ..CostModelParameters::default()
        },
    )
    .expect("Cost model failed");
    assert!(
        cost.reusable_flight_cost_usd >= 18_000_000.0 && cost.reusable_flight_cost_usd <= 42_000_000.0,
        "Falcon 9 reusable estimated cost ${:.2}M outside realistic range",
        cost.reusable_flight_cost_usd / 1.0e6
    );
}

#[test]
fn test_benchmark_4_electron_smallsat() {
    let mut cfg = VehicleConfiguration {
        name: "Electron Benchmark".to_string(),
        payload_mass_kg: 300.0,
        payload_diameter_m: 1.0,
        payload_length_m: 2.2,
        orbit: OrbitTarget {
            preset: MissionPreset::Leo285,
            ..OrbitTarget::default()
        },
        required_delta_v_m_s: Some(9_200.0),
        core_diameter_m: 1.2,
        stage_count: 2,
        booster_engine_id: None,
        booster_count: 0,
        stages: vec![
            StageConfig {
                tank_material: TankMaterialPreset::CfrpComposite,
                ..default_stage(1, "rutherford", 9, 0.39, RecoveryMode::Expendable)
            },
            StageConfig {
                tank_material: TankMaterialPreset::CfrpComposite,
                ..default_stage(2, "rutherford", 1, 0.61, RecoveryMode::Expendable)
            },
        ],
        staging_mode: StagingArchitectureMode::ColdPneumaticUllage,
        cryo_state: CryoStateMode::StandardBoiling,
        fairing_profile: FairingProfile::VonKarman,
        fairing_reusable: false,
        mass_margin_frac: 0.01,
        max_q_throttle_frac: 0.85,
        max_q_bucket_duration_s: 15.0,
        g_limit: 5.5,
        expected_reuses: 1,
        production_quantity: 20,
        constraints: ConstraintEnvelope::default(),
        custom_engines: Vec::new(),
        booster_recovery_mode: RecoveryMode::Expendable,
        recovery_optimizer_enabled: true,
        advanced_defaults: Default::default(),
    };
    cfg.stages[0].structural_mass_fraction_override = Some(0.907);
    cfg.stages[1].structural_mass_fraction_override = Some(0.900);

    let res = evaluate_manual_architecture(cfg).expect("Electron evaluation failed");
    let ref_glow_kg = 13_000.0;
    let rel_err = (res.glow_kg - ref_glow_kg).abs() / ref_glow_kg;
    assert!(
        rel_err <= 0.045,
        "Electron GLOW {} kg deviates by {:.2}% from 13,000 kg",
        res.glow_kg,
        rel_err * 100.0
    );
}

#[test]
fn test_benchmark_5_saturn_v_engine_circle_packing() {
    let mut engines = Vec::new();
    for i in 0..5 {
        engines.push(EnginePlacementInput {
            id: format!("f1_{i}"),
            nozzle_diameter_m: 3.00,
            gimbal_lever_arm_m: 0.45,
            tvc_angle_deg: 4.0,
            custom_x_m: None,
            custom_y_m: None,
            enabled: true,
        });
    }
    let res = solve_engine_circle_packing(10.0, engines, PackingConstraints::default())
        .expect("Saturn V circle packing failed");
    assert!(res.fits, "5x F-1 should fit within 10.0 m diameter; req={:.2}", res.required_diameter_m);
    assert!(res.pattern_name.contains("1 Center + 4 Outer"));
}

#[test]
fn test_benchmark_6_super_heavy_dense_packing() {
    let mut engines = Vec::new();
    for i in 0..33 {
        engines.push(EnginePlacementInput {
            id: format!("raptor_{i}"),
            nozzle_diameter_m: 1.12,
            gimbal_lever_arm_m: 0.20,
            tvc_angle_deg: 5.0,
            custom_x_m: None,
            custom_y_m: None,
            enabled: true,
        });
    }
    let res = solve_engine_circle_packing(
        9.0,
        engines,
        PackingConstraints {
            skirt_wall_thickness_m: 0.02,
            skirt_clearance_m: 0.04,
            no_touch_margin_m: 0.04,
            default_tvc_angle_deg: 6.0,
        },
    )
    .expect("Super Heavy packing failed");
    assert!(
        res.fits,
        "33x Raptor should fit within 9.0 m diameter; req={:.2}, usable={:.2}",
        res.required_diameter_m,
        res.usable_diameter_m
    );
    assert!(res.pattern_name.contains("3 + 10 + 20"));
}

#[test]
fn test_benchmark_7_catalog_and_rubber_engine_and_sweep() {
    let vehicles = get_heritage_vehicles().expect("Failed loading heritage vehicles");
    let engines = get_heritage_engines().expect("Failed loading heritage engines");
    assert!(vehicles.len() >= 75);
    assert!(engines.len() >= 90);

    let r_ref = engines.iter().find(|e| e.id.value == "raptor_2").expect("raptor_2 missing");
    let scaled = scale_rubber_engine(r_ref.clone(), 3_000_000.0, Some(330.0)).expect("Rubber scaling failed");
    assert!((scaled.thrust_vac_n.value - 3_000_000.0).abs() < 1.0);
    assert!(scaled.dry_mass_kg.value > r_ref.dry_mass_kg.value);

    let base_cfg = VehicleConfiguration {
        name: "Trade Test".to_string(),
        payload_mass_kg: 20_000.0,
        payload_diameter_m: 4.5,
        payload_length_m: 10.0,
        orbit: OrbitTarget::default(),
        required_delta_v_m_s: None,
        core_diameter_m: 5.0,
        stage_count: 2,
        booster_engine_id: None,
        booster_count: 0,
        stages: vec![
            default_stage(1, "raptor_2", 5, 0.42, RecoveryMode::DownrangeLandingAsds),
            default_stage(2, "raptor_vac", 1, 0.58, RecoveryMode::Expendable),
        ],
        staging_mode: StagingArchitectureMode::HotStagingVentedRing,
        cryo_state: CryoStateMode::SubcooledDensified,
        fairing_profile: FairingProfile::VonKarman,
        fairing_reusable: true,
        mass_margin_frac: 0.05,
        max_q_throttle_frac: 0.72,
        max_q_bucket_duration_s: 24.0,
        g_limit: 4.5,
        expected_reuses: 10,
        production_quantity: 20,
        constraints: ConstraintEnvelope::default(),
        custom_engines: Vec::new(),
        booster_recovery_mode: RecoveryMode::Expendable,
        recovery_optimizer_enabled: true,
        advanced_defaults: Default::default(),
    };

    let sweep = run_sensitivity_sweep(base_cfg.clone(), "payload_mass_kg".to_string(), 10_000.0, 30_000.0, 5)
        .expect("Sensitivity sweep failed");
    assert_eq!(sweep.points.len(), 5);
    assert!(sweep.points[4].glow_kg > sweep.points[0].glow_kg);

    let comb = run_combinatorial_sizing(SizingRequest {
        base_config: base_cfg,
        strategy: OptimizationStrategy::ParetoFrontier,
        glow_weight: 0.5,
        cost_weight: 0.5,
        dry_mass_weight: 0.0,
        allow_same_engine_stages: true,
        enforce_same_engine_stages: Vec::new(),
        enforce_same_fuel_stages: Vec::new(),
        include_boosters: false,
        dv_grid_steps: 5,
        max_results: 10,
    })
    .expect("Combinatorial sizing failed");
    assert!(comb.evaluated_count > 50);
    assert!(comb.best_result.is_some());
    assert!(!comb.pareto_frontier.is_empty());
    let _map_check = build_engines_map(&[]).expect("Engines map failed");
}

#[test]
fn test_benchmark_8_sls_ddte_cost_model() {
    let mut cfg = VehicleConfiguration {
        name: "SLS Cost Benchmark".to_string(),
        payload_mass_kg: 95_000.0,
        payload_diameter_m: 5.0,
        payload_length_m: 14.0,
        orbit: OrbitTarget::default(),
        required_delta_v_m_s: Some(9_250.0),
        core_diameter_m: 8.4,
        stage_count: 2,
        booster_engine_id: Some("sls_fsrb".to_string()),
        booster_count: 2,
        stages: vec![
            default_stage(1, "rs_25", 4, 0.72, RecoveryMode::Expendable),
            default_stage(2, "rl_10a", 1, 0.28, RecoveryMode::Expendable),
        ],
        staging_mode: StagingArchitectureMode::ColdPneumaticUllage,
        cryo_state: CryoStateMode::StandardBoiling,
        fairing_profile: FairingProfile::TangentOgive,
        fairing_reusable: false,
        mass_margin_frac: 0.12,
        max_q_throttle_frac: 0.72,
        max_q_bucket_duration_s: 25.0,
        g_limit: 4.5,
        expected_reuses: 1,
        production_quantity: 2,
        constraints: ConstraintEnvelope {
            min_liftoff_tw0: 1.1,
            max_liftoff_tw0: 1.7,
            min_upper_tw0: 0.05,
            max_upper_tw0: 1.1,
            ..ConstraintEnvelope::default()
        },
        custom_engines: Vec::new(),
        booster_recovery_mode: RecoveryMode::Expendable,
        recovery_optimizer_enabled: true,
        advanced_defaults: Default::default(),
    };
    cfg.stages[0].structural_mass_fraction_override = Some(0.91);
    cfg.stages[1].structural_mass_fraction_override = Some(0.88);
    let res = evaluate_manual_architecture(cfg).expect("SLS cost eval failed");
    assert!(res.cost_breakdown.total_ddte_usd > 100_000_000.0);
    assert!(res.cost_breakdown.expendable_flight_cost_usd > 50_000_000.0);
}

#[test]
fn test_benchmark_9_multi_architecture_search() {
    let base_2s = VehicleConfiguration {
        name: "Multi-Arch Search".to_string(),
        payload_mass_kg: 18_500.0,
        payload_diameter_m: 4.5,
        payload_length_m: 11.0,
        orbit: OrbitTarget::default(),
        required_delta_v_m_s: None,
        core_diameter_m: 5.2,
        stage_count: 2,
        booster_engine_id: None,
        booster_count: 0,
        stages: vec![
            default_stage(1, "merlin_1d", 9, 0.38, RecoveryMode::DownrangeLandingAsds),
            default_stage(2, "merlin_1d_vac", 1, 0.62, RecoveryMode::Expendable),
        ],
        staging_mode: StagingArchitectureMode::ColdPneumaticUllage,
        cryo_state: CryoStateMode::SubcooledDensified,
        fairing_profile: FairingProfile::VonKarman,
        fairing_reusable: true,
        mass_margin_frac: 0.08,
        max_q_throttle_frac: 0.72,
        max_q_bucket_duration_s: 24.0,
        g_limit: 4.5,
        expected_reuses: 10,
        production_quantity: 20,
        constraints: ConstraintEnvelope {
            max_glow_kg: Some(3_000_000.0),
            min_upper_tw0: 0.30,
            max_upper_tw0: 1.35,
            ..ConstraintEnvelope::default()
        },
        custom_engines: Vec::new(),
        booster_recovery_mode: RecoveryMode::Expendable,
        recovery_optimizer_enabled: true,
        advanced_defaults: Default::default(),
    };

    let res_2s = run_combinatorial_sizing(SizingRequest {
        base_config: base_2s.clone(),
        strategy: OptimizationStrategy::MinimizeGlow,
        glow_weight: 1.0,
        cost_weight: 0.0,
        dry_mass_weight: 0.0,
        allow_same_engine_stages: false,
        enforce_same_engine_stages: Vec::new(),
        enforce_same_fuel_stages: Vec::new(),
        include_boosters: false,
        dv_grid_steps: 5,
        max_results: 5,
    })
    .expect("2-Stage search failed");
    assert!(res_2s.feasible_count > 0, "Expected feasible 2-stage solutions");
    assert_eq!(res_2s.best_result.as_ref().unwrap().stages.len(), 2);
    assert_eq!(res_2s.best_result.as_ref().unwrap().stages[0].strapon_count, 0);

    let res_25s = run_combinatorial_sizing(SizingRequest {
        base_config: base_2s.clone(),
        strategy: OptimizationStrategy::MinimizeGlow,
        glow_weight: 1.0,
        cost_weight: 0.0,
        dry_mass_weight: 0.0,
        allow_same_engine_stages: false,
        enforce_same_engine_stages: Vec::new(),
        enforce_same_fuel_stages: Vec::new(),
        include_boosters: true,
        dv_grid_steps: 5,
        max_results: 5,
    })
    .expect("2.5-Stage search failed");
    assert!(res_25s.feasible_count > 0, "Expected feasible 2.5-stage solutions");
    assert!(res_25s.best_result.as_ref().unwrap().stages[0].strapon_count > 0);

    let mut base_3s = base_2s.clone();
    base_3s.stage_count = 3;
    base_3s.stages = vec![
        default_stage(1, "merlin_1d", 9, 0.38, RecoveryMode::DownrangeLandingAsds),
        default_stage(2, "merlin_1d_vac", 2, 0.34, RecoveryMode::Expendable),
        default_stage(3, "rl_10c_1", 1, 0.28, RecoveryMode::Expendable),
    ];

    let res_3s = run_combinatorial_sizing(SizingRequest {
        base_config: base_3s.clone(),
        strategy: OptimizationStrategy::MinimizeGlow,
        glow_weight: 1.0,
        cost_weight: 0.0,
        dry_mass_weight: 0.0,
        allow_same_engine_stages: true,
        enforce_same_engine_stages: Vec::new(),
        enforce_same_fuel_stages: Vec::new(),
        include_boosters: false,
        dv_grid_steps: 5,
        max_results: 5,
    })
    .expect("3-Stage search failed");
    assert!(res_3s.feasible_count > 0, "Expected feasible 3-stage solutions");
    assert_eq!(res_3s.best_result.as_ref().unwrap().stages.len(), 3);
    assert_eq!(res_3s.best_result.as_ref().unwrap().stages[0].strapon_count, 0);

    let res_35s = run_combinatorial_sizing(SizingRequest {
        base_config: base_3s,
        strategy: OptimizationStrategy::MinimizeGlow,
        glow_weight: 1.0,
        cost_weight: 0.0,
        dry_mass_weight: 0.0,
        allow_same_engine_stages: true,
        enforce_same_engine_stages: Vec::new(),
        enforce_same_fuel_stages: Vec::new(),
        include_boosters: true,
        dv_grid_steps: 5,
        max_results: 5,
    })
    .expect("3.5-Stage search failed");
    assert!(res_35s.feasible_count > 0, "Expected feasible 3.5-stage solutions");
    assert_eq!(res_35s.best_result.as_ref().unwrap().stages.len(), 3);
    assert!(res_35s.best_result.as_ref().unwrap().stages[0].strapon_count > 0);
}

#[test]
fn test_benchmark_10_default_25pct_margin_elliptical_and_sensitivity_sweeps() {
    let base_2s = VehicleConfiguration {
        name: "Default Elliptical 25% Margin".to_string(),
        payload_mass_kg: 13_607.77,
        payload_diameter_m: 4.5,
        payload_length_m: 11.0,
        orbit: OrbitTarget::default(),
        required_delta_v_m_s: None,
        core_diameter_m: 5.4864,
        stage_count: 2,
        booster_engine_id: None,
        booster_count: 0,
        stages: vec![
            default_stage(1, "merlin_1d", 9, 0.38, RecoveryMode::Expendable),
            default_stage(2, "merlin_1d_vac", 1, 0.62, RecoveryMode::Expendable),
        ],
        staging_mode: StagingArchitectureMode::ColdPneumaticUllage,
        cryo_state: CryoStateMode::SubcooledDensified,
        fairing_profile: FairingProfile::VonKarman,
        fairing_reusable: true,
        mass_margin_frac: 0.25,
        max_q_throttle_frac: 0.72,
        max_q_bucket_duration_s: 24.0,
        g_limit: 4.5,
        expected_reuses: 10,
        production_quantity: 20,
        constraints: ConstraintEnvelope::default(),
        custom_engines: Vec::new(),
        booster_recovery_mode: RecoveryMode::Expendable,
        recovery_optimizer_enabled: true,
        advanced_defaults: Default::default(),
    };

    for (include_boosters, is_three) in [(false, false), (true, false), (false, true), (true, true)] {
        let mut cfg = base_2s.clone();
        if is_three {
            cfg.stage_count = 3;
            cfg.stages = vec![
                default_stage(1, "merlin_1d", 9, 0.38, RecoveryMode::Expendable),
                default_stage(2, "merlin_1d_vac", 2, 0.34, RecoveryMode::Expendable),
                default_stage(3, "rl_10c_1", 1, 0.28, RecoveryMode::Expendable),
            ];
        }
        let sweep = run_combinatorial_sizing(SizingRequest {
            base_config: cfg,
            strategy: OptimizationStrategy::BalancedTrade,
            glow_weight: 0.5,
            cost_weight: 0.5,
            dry_mass_weight: 0.0,
            allow_same_engine_stages: is_three,
            enforce_same_engine_stages: Vec::new(),
            enforce_same_fuel_stages: Vec::new(),
            include_boosters,
            dv_grid_steps: 5,
            max_results: 5,
        })
        .expect("Default 25% margin search failed");
        assert!(
            sweep.feasible_count > 0,
            "Expected feasible solutions for include_boosters={}, stages={}",
            include_boosters,
            if is_three { 3 } else { 2 }
        );
    }

    let dv_split_curve = run_sensitivity_sweep(base_2s.clone(), "s1_dv_split".to_string(), 0.22, 0.52, 6)
        .expect("s1_dv_split sweep failed");
    let min_g = dv_split_curve.points.iter().map(|p| p.glow_kg).fold(f64::INFINITY, f64::min);
    let max_g = dv_split_curve.points.iter().map(|p| p.glow_kg).fold(0.0, f64::max);
    assert!(max_g - min_g > 5_000.0, "Expected non-flat GLOW curve for s1_dv_split");

    let req_dv_curve = run_sensitivity_sweep(base_2s.clone(), "required_delta_v_m_s".to_string(), 8_800.0, 12_200.0, 6)
        .expect("required_delta_v_m_s sweep failed");
    let first_glow = req_dv_curve.points.first().unwrap().glow_kg;
    let last_glow = req_dv_curve.points.last().unwrap().glow_kg;
    assert!(last_glow > first_glow * 1.4, "Expected rising GLOW curve with higher required dV");

    let mut reuse_cfg = base_2s;
    reuse_cfg.stages[0].recovery_mode = RecoveryMode::DownrangeLandingAsds;
    let reuse_curve = run_sensitivity_sweep(reuse_cfg, "expected_reuses".to_string(), 1.0, 25.0, 6)
        .expect("expected_reuses sweep failed");
    let first_cost = reuse_curve.points.first().unwrap().reusable_flight_cost_usd;
    let last_cost = reuse_curve.points.last().unwrap().reusable_flight_cost_usd;
    assert!(first_cost > last_cost, "Expected reusable flight cost to decrease with more reuses");
}

#[test]
fn test_benchmark_11_trajectory_commonality_and_normalized_success_rates() {
    let vehicles = get_heritage_vehicles().expect("Heritage vehicles failed");
    assert!(vehicles.len() >= 90);
    for v in &vehicles {
        assert!(
            v.launch_success_rate.value <= 1.0 && v.launch_success_rate.value >= 0.0,
            "Vehicle {} had unnormalized success rate {}",
            v.id.value,
            v.launch_success_rate.value
        );
    }

    let base_2s = VehicleConfiguration {
        name: "Trajectory & Commonality Check".to_string(),
        payload_mass_kg: 13_607.77,
        payload_diameter_m: 4.572,
        payload_length_m: 10.9728,
        orbit: OrbitTarget::default(),
        required_delta_v_m_s: None,
        core_diameter_m: 5.4864,
        stage_count: 2,
        booster_engine_id: None,
        booster_count: 0,
        stages: vec![
            default_stage(1, "merlin_1d", 9, 0.38, RecoveryMode::Expendable),
            default_stage(2, "merlin_1d_vac", 1, 0.62, RecoveryMode::Expendable),
        ],
        staging_mode: StagingArchitectureMode::ColdPneumaticUllage,
        cryo_state: CryoStateMode::SubcooledDensified,
        fairing_profile: FairingProfile::VonKarman,
        fairing_reusable: true,
        mass_margin_frac: 0.25,
        max_q_throttle_frac: 0.72,
        max_q_bucket_duration_s: 24.0,
        g_limit: 4.5,
        expected_reuses: 10,
        production_quantity: 20,
        constraints: ConstraintEnvelope::default(),
        custom_engines: Vec::new(),
        booster_recovery_mode: RecoveryMode::Expendable,
        recovery_optimizer_enabled: true,
        advanced_defaults: Default::default(),
    };

    assert!((base_2s.orbit.perigee_altitude_m - 185_200.0).abs() < 1.0);
    assert!((base_2s.orbit.apogee_altitude_m - 185_200.0).abs() < 1.0);
    assert!(base_2s.orbit.eccentricity.abs() < 1e-6);

    let traj = simulate_trajectory(base_2s.clone()).expect("Trajectory simulation failed");
    assert!(traj.points.len() > 120, "Expected detailed time series points");
    assert!(!traj.events.is_empty(), "Expected discrete ascent events");
    assert!(traj.max_q_pa > 5_000.0 && traj.max_q_pa < 85_000.0);
    assert!(traj.total_dv_delivered_m_s > 8_000.0);

    let same_fuel_sweep = run_combinatorial_sizing(SizingRequest {
        base_config: base_2s,
        strategy: OptimizationStrategy::BalancedTrade,
        glow_weight: 0.5,
        cost_weight: 0.5,
        dry_mass_weight: 0.0,
        allow_same_engine_stages: true,
        enforce_same_engine_stages: Vec::new(),
        enforce_same_fuel_stages: vec![1, 2],
        include_boosters: false,
        dv_grid_steps: 4,
        max_results: 5,
    })
    .expect("Same-fuel combinatorial search failed");
    assert!(same_fuel_sweep.feasible_count > 0);
    for cand in &same_fuel_sweep.top_candidates {
        assert_eq!(cand.stages[0].propellant, cand.stages[1].propellant);
    }
}

#[test]
fn test_benchmark_12_heritage_structural_estimator_accuracy() {
    let summary = validate_heritage_models().expect("Heritage validation failed");
    assert!(summary.entries.len() >= 60);

    let benchmark_ids = [
        "electron",
        "falcon_1",
        "vega",
        "soyuz_2",
        "falcon_9",
        "atlas_v_401",
        "vulcan_vc6l",
        "ariane_5",
        "proton_m",
        "delta_iv_heavy",
        "h_iia_202",
        "lm_5",
        "saturn_v",
        "sls_block_1",
        "starship",
        "falcon_heavy",
    ];

    let mut abs_errs = Vec::new();
    let mut in_sample_errs = Vec::new();
    let mut holdout_errs = Vec::new();
    for id in &benchmark_ids {
        let entry = summary
            .entries
            .iter()
            .find(|e| e.vehicle_id == *id)
            .unwrap_or_else(|| panic!("Missing heritage validation entry for {id}"));
        let bd = &entry.s1_breakdown;
        let sum_check = bd.predicted_structure_only_unmargined_kg
            + bd.engines_mass_kg
            + bd.recovery_hardware_kg
            + bd.strapon_inert_kg;
        assert!(
            (sum_check - bd.predicted_dry_unmargined_kg).abs() < 1.0e-3,
            "{id} S1 structural subsystem breakdown sum mismatch: {sum_check} vs {}",
            bd.predicted_dry_unmargined_kg
        );
        assert!(bd.forward_skirt_mass_kg > 0.0);
        assert!(bd.aft_skirt_and_base_shield_mass_kg > 0.0);
        assert!(bd.thrust_structure_mass_kg > 0.0);
        assert!(bd.avionics_and_wiring_mass_kg > 0.0);
        println!(
            "STRUCT {:15} [{:^10}] | S1 act={:7.0} pred={:7.0} ({:+5.1}%) | S2 act={:6.0} pred={:6.0} ({:+5.1}%) | Tot act={:7.0} pred={:7.0} ({:+5.1}%)",
            entry.vehicle_id,
            entry.sample_type,
            entry.actual_s1_dry_kg,
            entry.predicted_s1_dry_kg,
            entry.s1_dry_error_pct,
            entry.actual_s2_dry_kg,
            entry.predicted_s2_dry_kg,
            entry.s2_dry_error_pct,
            entry.actual_total_dry_kg,
            entry.predicted_total_dry_kg,
            entry.total_dry_error_pct
        );
        abs_errs.push(entry.total_dry_error_pct.abs());
        if entry.is_calibration_set {
            in_sample_errs.push(entry.total_dry_error_pct.abs());
        } else {
            holdout_errs.push(entry.total_dry_error_pct.abs());
        }
    }
    let bench_mape = abs_errs.iter().sum::<f64>() / (abs_errs.len() as f64);
    let in_sample_mape = in_sample_errs.iter().sum::<f64>() / (in_sample_errs.len() as f64);
    let holdout_mape = holdout_errs.iter().sum::<f64>() / (holdout_errs.len() as f64);
    println!(
        "Benchmark Structural: In-Sample MAPE={:.2}%, Holdout MAPE={:.2}%, Combined MAPE={:.2}%, MdAPE={:.2}%",
        in_sample_mape, holdout_mape, bench_mape, summary.structural_mdape_pct
    );
    assert!(
        in_sample_mape < 15.0,
        "In-sample structural MAPE {:.2}% exceeded 15.0%",
        in_sample_mape
    );
    assert!(
        holdout_mape < 18.0,
        "Holdout structural MAPE {:.2}% exceeded 18.0%",
        holdout_mape
    );
    assert!(
        bench_mape < 15.0,
        "Benchmark 16-vehicle structural MAPE {:.2}% exceeded 15.0%",
        bench_mape
    );
}

#[test]
fn test_benchmark_13_heritage_cost_model_accuracy() {
    let summary = validate_heritage_models().expect("Heritage validation failed");

    let cost_bench_ids = [
        "electron",
        "falcon_1",
        "vega",
        "soyuz_2",
        "falcon_9",
        "falcon_heavy",
        "atlas_v_401",
        "vulcan_vc6l",
        "ariane_5",
        "proton_m",
        "delta_iv_heavy",
        "h_iia_202",
        "lm_5",
        "kslv_ii_nuri",
        "saturn_v",
        "sls_block_1",
    ];

    let mut flight_errs = Vec::new();
    let mut ddte_errs = Vec::new();
    let mut in_sample_flight = Vec::new();
    let mut holdout_flight = Vec::new();
    for id in &cost_bench_ids {
        let entry = summary
            .entries
            .iter()
            .find(|e| e.vehicle_id == *id)
            .unwrap_or_else(|| panic!("Missing cost validation entry for {id}"));
        println!(
            "COST   {:15} [{:^10}] | Flight act=${:7.1}M pred=${:7.1}M ({:+5.1}%) | DDTE act=${:8.1}M pred=${:8.1}M ({:+5.1}%)",
            entry.vehicle_id,
            entry.sample_type,
            entry.actual_launch_cost_adj_usd / 1.0e6,
            entry.predicted_launch_cost_adj_usd / 1.0e6,
            entry.launch_cost_error_pct,
            entry.actual_ddte_usd / 1.0e6,
            entry.predicted_ddte_usd / 1.0e6,
            entry.ddte_error_pct
        );
        flight_errs.push(entry.launch_cost_error_pct.abs());
        ddte_errs.push(entry.ddte_error_pct.abs());
        if entry.is_calibration_set {
            in_sample_flight.push(entry.launch_cost_error_pct.abs());
        } else {
            holdout_flight.push(entry.launch_cost_error_pct.abs());
        }
    }
    let flight_mape = flight_errs.iter().sum::<f64>() / (flight_errs.len() as f64);
    let ddte_mape = ddte_errs.iter().sum::<f64>() / (ddte_errs.len() as f64);
    let in_sample_cost_mape = in_sample_flight.iter().sum::<f64>() / (in_sample_flight.len() as f64);
    let holdout_cost_mape = holdout_flight.iter().sum::<f64>() / (holdout_flight.len() as f64);
    println!(
        "Benchmark Cost: In-Sample MAPE={:.2}%, Holdout MAPE={:.2}%, Combined MAPE={:.2}%, DDTE MAPE={:.2}%, MdAPE={:.2}%",
        in_sample_cost_mape, holdout_cost_mape, flight_mape, ddte_mape, summary.cost_mdape_pct
    );
    assert!(
        in_sample_cost_mape < 5.0,
        "In-sample launch cost MAPE {:.2}% exceeded 5.0%",
        in_sample_cost_mape
    );
    assert!(
        holdout_cost_mape < 10.0,
        "Holdout launch cost MAPE {:.2}% exceeded 10.0%",
        holdout_cost_mape
    );
    assert!(
        flight_mape < 18.0,
        "Benchmark 16-vehicle launch cost MAPE {:.2}% exceeded 18.0%",
        flight_mape
    );
    assert!(
        ddte_mape < 22.0,
        "Benchmark 16-vehicle DDT&E cost MAPE {:.2}% exceeded 22.0%",
        ddte_mape
    );
}

#[test]
fn test_benchmark_14_default_saturn_v_and_presets_feasibility() {
    let saturn_default = VehicleConfiguration {
        name: "Saturn V Heavy Lift".to_string(),
        payload_mass_kg: 118_000.0,
        payload_diameter_m: 6.6,
        payload_length_m: 18.0,
        orbit: OrbitTarget {
            preset: MissionPreset::Custom,
            altitude_m: 185_200.0,
            perigee_altitude_m: 185_200.0,
            apogee_altitude_m: 185_200.0,
            eccentricity: 0.0,
            inclination_deg: 28.5,
            launch_latitude_deg: 28.5,
            launch_azimuth_deg: 90.0,
            insertion_margin_m_s: 150.0,
            dv_margin_pct: 2.5,
            coast_duration_s: 0.0,
        },
        required_delta_v_m_s: None,
        core_diameter_m: 10.06,
        stage_count: 3,
        booster_engine_id: None,
        booster_count: 0,
        booster_recovery_mode: RecoveryMode::Expendable,
        recovery_optimizer_enabled: false,
        stages: vec![
            {
                let mut s = default_stage(1, "f_1", 5, 0.32, RecoveryMode::Expendable);
                s.structural_mass_fraction_override = Some(0.941);
                s
            },
            {
                let mut s = default_stage(2, "j_2", 5, 0.48, RecoveryMode::Expendable);
                s.structural_mass_fraction_override = Some(0.925);
                s
            },
            {
                let mut s = default_stage(3, "j_2", 1, 0.20, RecoveryMode::Expendable);
                s.structural_mass_fraction_override = Some(0.910);
                s
            },
        ],
        staging_mode: StagingArchitectureMode::ColdPneumaticUllage,
        cryo_state: CryoStateMode::StandardBoiling,
        fairing_profile: FairingProfile::VonKarman,
        fairing_reusable: false,
        mass_margin_frac: 0.02,
        max_q_throttle_frac: 0.72,
        max_q_bucket_duration_s: 24.0,
        g_limit: 4.5,
        expected_reuses: 1,
        production_quantity: 15,
        constraints: ConstraintEnvelope {
            max_cost_usd: Some(2_500_000_000.0),
            max_glow_kg: Some(3_500_000.0),
            min_glow_kg: Some(100_000.0),
            max_core_diameter_m: Some(14.0),
            max_total_height_m: Some(125.0),
            max_g_limit: 4.5,
            max_core_engines: 33,
            max_upper_engines: 6,
            allowed_booster_counts: vec![0, 2, 3, 4, 6],
            min_liftoff_tw0: 1.10,
            max_liftoff_tw0: 1.65,
            min_upper_tw0: 0.18,
            max_upper_tw0: 1.45,
            enforce_base_packing: true,
            min_payload_frac: 0.005,
            max_payload_frac: 0.08,
            min_core_only_tw0: 0.7,
            max_core_only_tw0: 2.2,
            min_stage3_tw0: 0.15,
            max_stage3_tw0: 1.5,
            ..ConstraintEnvelope::default()
        },
        custom_engines: Vec::new(),
        advanced_defaults: Default::default(),
    };

    let res = evaluate_manual_architecture(saturn_default).expect("Saturn V eval failed");
    println!("Saturn V Default Feasible: {}", res.feasible);
    println!("Saturn V GLOW: {:.0} kg, T/W0: {:.2}", res.glow_kg, res.liftoff_tw0);
    println!("Total delta-V required: {:.1} m/s", res.delta_v_breakdown.total_required_dv_m_s);
    for (i, st) in res.stages.iter().enumerate() {
        println!(
            "Stage {}: engine={}x{} prop={:.0} kg inert={:.0} kg dV={:.1} m/s tw0={:.2} tw_bo={:.2}",
            i + 1, st.engine_count, st.engine_name, st.propellant_mass_kg, st.inert_mass_kg, st.delta_v_delivered_m_s, st.tw0_ignition, st.tw_burnout
        );
    }
    println!("Saturn V Violations: {:?}", res.violation_messages);
    assert!(res.feasible, "Saturn V default must be feasible: {:?}", res.violation_messages);

    // Preset 2: Falcon 9 Block 5
    let f9 = VehicleConfiguration {
        name: "Falcon 9 Block 5".to_string(),
        payload_mass_kg: 15_500.0,
        payload_diameter_m: 4.6,
        payload_length_m: 6.7,
        orbit: OrbitTarget {
            preset: MissionPreset::Leo285,
            ..OrbitTarget::default()
        },
        required_delta_v_m_s: None,
        core_diameter_m: 3.66,
        stage_count: 2,
        booster_engine_id: None,
        booster_count: 0,
        booster_recovery_mode: RecoveryMode::Expendable,
        recovery_optimizer_enabled: true,
        stages: vec![
            {
                let mut s = default_stage(1, "merlin_1d", 9, 0.38, RecoveryMode::DownrangeLandingAsds);
                s.structural_mass_fraction_override = Some(0.949);
                s
            },
            {
                let mut s = default_stage(2, "merlin_1d_vac", 1, 0.62, RecoveryMode::Expendable);
                s.structural_mass_fraction_override = Some(0.962);
                s
            },
        ],
        staging_mode: StagingArchitectureMode::ColdPneumaticUllage,
        cryo_state: CryoStateMode::SubcooledDensified,
        fairing_profile: FairingProfile::VonKarman,
        fairing_reusable: true,
        mass_margin_frac: 0.02,
        max_q_throttle_frac: 0.72,
        max_q_bucket_duration_s: 22.0,
        g_limit: 4.5,
        expected_reuses: 15,
        production_quantity: 50,
        constraints: ConstraintEnvelope {
            min_liftoff_tw0: 1.15,
            max_liftoff_tw0: 1.65,
            min_upper_tw0: 0.50,
            max_upper_tw0: 1.45,
            max_glow_kg: Some(700_000.0),
            max_cost_usd: Some(120_000_000.0),
            max_core_diameter_m: Some(4.5),
            max_total_height_m: Some(80.0),
            max_slenderness_ld: Some(22.0),
            enforce_base_packing: false,
            ..ConstraintEnvelope::default()
        },
        custom_engines: Vec::new(),
        advanced_defaults: Default::default(),
    };
    let res_f9 = evaluate_manual_architecture(f9).expect("Falcon 9 eval failed");
    println!(
        "F9 GLOW: {:.0} kg, Height: {:.1} m, dV req: {:.1} m/s, S1 H: {:.1} m, S2 H: {:.1} m, Fairing H: {:.1} m",
        res_f9.glow_kg, res_f9.total_height_m, res_f9.delta_v_breakdown.total_required_dv_m_s,
        res_f9.stages[0].stage_height_m, res_f9.stages[1].stage_height_m, res_f9.fairing.total_length_m
    );
    println!("F9 Feasible: {}, Violations: {:?}", res_f9.feasible, res_f9.violation_messages);
    assert!(res_f9.feasible, "Falcon 9 preset must be feasible: {:?}", res_f9.violation_messages);

    // Preset 3: Electron
    let electron = VehicleConfiguration {
        name: "Electron Light Class".to_string(),
        payload_mass_kg: 300.0,
        payload_diameter_m: 1.0,
        payload_length_m: 1.5,
        orbit: OrbitTarget {
            preset: MissionPreset::Leo285,
            ..OrbitTarget::default()
        },
        required_delta_v_m_s: None,
        core_diameter_m: 1.2,
        stage_count: 2,
        booster_engine_id: None,
        booster_count: 0,
        booster_recovery_mode: RecoveryMode::Expendable,
        recovery_optimizer_enabled: true,
        stages: vec![
            {
                let mut s = default_stage(1, "rutherford", 9, 0.38, RecoveryMode::ParachuteMidAirCatch);
                s.tank_material = TankMaterialPreset::CfrpComposite;
                s.structural_mass_fraction_override = Some(0.907);
                s
            },
            {
                let mut s = default_stage(2, "rutherford_vac", 1, 0.62, RecoveryMode::Expendable);
                s.tank_material = TankMaterialPreset::CfrpComposite;
                s.structural_mass_fraction_override = Some(0.900);
                s
            },
        ],
        staging_mode: StagingArchitectureMode::ColdPneumaticUllage,
        cryo_state: CryoStateMode::StandardBoiling,
        fairing_profile: FairingProfile::VonKarman,
        fairing_reusable: false,
        mass_margin_frac: 0.02,
        max_q_throttle_frac: 0.85,
        max_q_bucket_duration_s: 15.0,
        g_limit: 5.5,
        expected_reuses: 5,
        production_quantity: 30,
        constraints: ConstraintEnvelope {
            min_glow_kg: Some(5_000.0),
            max_glow_kg: Some(40_000.0),
            min_liftoff_tw0: 1.15,
            max_liftoff_tw0: 1.65,
            min_upper_tw0: 0.30,
            max_upper_tw0: 1.45,
            max_cost_usd: Some(15_000_000.0),
            max_core_diameter_m: Some(2.0),
            max_total_height_m: Some(28.0),
            max_slenderness_ld: Some(22.0),
            max_g_limit: 6.0,
            enforce_base_packing: false,
            ..ConstraintEnvelope::default()
        },
        custom_engines: Vec::new(),
        advanced_defaults: Default::default(),
    };
    let res_el = evaluate_manual_architecture(electron).expect("Electron eval failed");
    println!("Electron Feasible: {}, Violations: {:?}", res_el.feasible, res_el.violation_messages);
    assert!(res_el.feasible, "Electron preset must be feasible: {:?}", res_el.violation_messages);

    // Preset 4: SLS Block 1
    let sls = VehicleConfiguration {
        name: "SLS Block 1".to_string(),
        payload_mass_kg: 95_000.0,
        payload_diameter_m: 8.4,
        payload_length_m: 19.0,
        orbit: OrbitTarget {
            preset: MissionPreset::Leo285,
            ..OrbitTarget::default()
        },
        required_delta_v_m_s: None,
        core_diameter_m: 8.4,
        stage_count: 2,
        booster_count: 2,
        booster_engine_id: Some("sls_fsrb".to_string()),
        booster_recovery_mode: RecoveryMode::Expendable,
        recovery_optimizer_enabled: true,
        stages: vec![
            {
                let mut s = default_stage(1, "rs_25", 4, 0.92, RecoveryMode::Expendable);
                s.structural_mass_fraction_override = Some(0.915);
                s
            },
            {
                let mut s = default_stage(2, "rl_10a", 1, 0.08, RecoveryMode::Expendable);
                s.structural_mass_fraction_override = Some(0.890);
                s
            },
        ],
        staging_mode: StagingArchitectureMode::ColdPneumaticUllage,
        cryo_state: CryoStateMode::StandardBoiling,
        fairing_profile: FairingProfile::VonKarman,
        fairing_reusable: false,
        mass_margin_frac: 0.05,
        max_q_throttle_frac: 0.72,
        max_q_bucket_duration_s: 24.0,
        g_limit: 4.5,
        expected_reuses: 1,
        production_quantity: 8,
        constraints: ConstraintEnvelope {
            min_liftoff_tw0: 1.15,
            max_liftoff_tw0: 1.70,
            min_upper_tw0: 0.05,
            max_upper_tw0: 1.45,
            max_glow_kg: Some(3_200_000.0),
            max_cost_usd: Some(2_500_000_000.0),
            max_core_diameter_m: Some(10.0),
            max_total_height_m: Some(120.0),
            enforce_base_packing: false,
            ..ConstraintEnvelope::default()
        },
        custom_engines: Vec::new(),
        advanced_defaults: Default::default(),
    };
    let res_sls = evaluate_manual_architecture(sls).expect("SLS Block 1 eval failed");
    println!("SLS Feasible: {}, Violations: {:?}", res_sls.feasible, res_sls.violation_messages);
    assert!(res_sls.feasible, "SLS Block 1 preset must be feasible: {:?}", res_sls.violation_messages);

    // Preset 5: Vulcan Centaur VC6L
    let vulcan = VehicleConfiguration {
        name: "Vulcan Centaur VC6L".to_string(),
        payload_mass_kg: 27_200.0,
        payload_diameter_m: 5.4,
        payload_length_m: 16.0,
        orbit: OrbitTarget {
            preset: MissionPreset::Leo285,
            ..OrbitTarget::default()
        },
        required_delta_v_m_s: None,
        core_diameter_m: 5.4,
        stage_count: 2,
        booster_count: 6,
        booster_engine_id: Some("gem_63xl".to_string()),
        booster_recovery_mode: RecoveryMode::Expendable,
        recovery_optimizer_enabled: true,
        stages: vec![
            {
                let mut s = default_stage(1, "be_4", 2, 0.45, RecoveryMode::Expendable);
                s.structural_mass_fraction_override = Some(0.935);
                s
            },
            {
                let mut s = default_stage(2, "rl_10c_1", 2, 0.55, RecoveryMode::Expendable);
                s.tank_material = TankMaterialPreset::Stainless304L;
                s.structural_mass_fraction_override = Some(0.900);
                s
            },
        ],
        staging_mode: StagingArchitectureMode::ColdPneumaticUllage,
        cryo_state: CryoStateMode::StandardBoiling,
        fairing_profile: FairingProfile::VonKarman,
        fairing_reusable: false,
        mass_margin_frac: 0.05,
        max_q_throttle_frac: 0.72,
        max_q_bucket_duration_s: 24.0,
        g_limit: 4.5,
        expected_reuses: 1,
        production_quantity: 20,
        constraints: ConstraintEnvelope {
            min_liftoff_tw0: 1.15,
            max_liftoff_tw0: 2.50,
            min_upper_tw0: 0.15,
            max_upper_tw0: 1.45,
            max_core_only_tw0: 2.50,
            max_glow_kg: Some(1_200_000.0),
            max_cost_usd: Some(400_000_000.0),
            max_core_diameter_m: Some(7.0),
            max_total_height_m: Some(85.0),
            enforce_base_packing: false,
            ..ConstraintEnvelope::default()
        },
        custom_engines: Vec::new(),
        advanced_defaults: Default::default(),
    };
    let res_vulcan = evaluate_manual_architecture(vulcan).expect("Vulcan eval failed");
    println!("Vulcan Feasible: {}, Violations: {:?}", res_vulcan.feasible, res_vulcan.violation_messages);
    assert!(res_vulcan.feasible, "Vulcan preset must be feasible: {:?}", res_vulcan.violation_messages);

    // Preset 6: New Glenn
    let new_glenn = VehicleConfiguration {
        name: "Blue Origin New Glenn".to_string(),
        payload_mass_kg: 45_000.0,
        payload_diameter_m: 7.0,
        payload_length_m: 18.0,
        orbit: OrbitTarget {
            preset: MissionPreset::Leo285,
            ..OrbitTarget::default()
        },
        required_delta_v_m_s: None,
        core_diameter_m: 7.0,
        stage_count: 2,
        booster_engine_id: None,
        booster_count: 0,
        booster_recovery_mode: RecoveryMode::Expendable,
        recovery_optimizer_enabled: true,
        stages: vec![
            {
                let mut s = default_stage(1, "be_4", 7, 0.44, RecoveryMode::DownrangeLandingAsds);
                s.structural_mass_fraction_override = Some(0.938);
                s
            },
            {
                let mut s = default_stage(2, "be_3u", 2, 0.56, RecoveryMode::Expendable);
                s.structural_mass_fraction_override = Some(0.912);
                s
            },
        ],
        staging_mode: StagingArchitectureMode::ColdPneumaticUllage,
        cryo_state: CryoStateMode::StandardBoiling,
        fairing_profile: FairingProfile::VonKarman,
        fairing_reusable: false,
        mass_margin_frac: 0.05,
        max_q_throttle_frac: 0.72,
        max_q_bucket_duration_s: 24.0,
        g_limit: 4.5,
        expected_reuses: 15,
        production_quantity: 25,
        constraints: ConstraintEnvelope {
            min_liftoff_tw0: 1.15,
            max_liftoff_tw0: 1.65,
            min_upper_tw0: 0.18,
            max_upper_tw0: 1.45,
            max_glow_kg: Some(2_500_000.0),
            max_cost_usd: Some(500_000_000.0),
            max_core_diameter_m: Some(8.5),
            max_total_height_m: Some(110.0),
            enforce_base_packing: false,
            ..ConstraintEnvelope::default()
        },
        custom_engines: Vec::new(),
        advanced_defaults: Default::default(),
    };
    let res_ng = evaluate_manual_architecture(new_glenn).expect("New Glenn eval failed");
    println!("New Glenn Feasible: {}, Violations: {:?}", res_ng.feasible, res_ng.violation_messages);
    assert!(res_ng.feasible, "New Glenn preset must be feasible: {:?}", res_ng.violation_messages);

    // Preset 7: Starship Super Heavy
    let starship = VehicleConfiguration {
        name: "Starship Super Heavy".to_string(),
        payload_mass_kg: 100_000.0,
        payload_diameter_m: 9.0,
        payload_length_m: 17.0,
        orbit: OrbitTarget {
            preset: MissionPreset::Leo285,
            ..OrbitTarget::default()
        },
        required_delta_v_m_s: None,
        core_diameter_m: 9.0,
        stage_count: 2,
        booster_engine_id: None,
        booster_count: 0,
        booster_recovery_mode: RecoveryMode::Expendable,
        recovery_optimizer_enabled: true,
        stages: vec![
            {
                let mut s = default_stage(1, "raptor_2", 33, 0.34, RecoveryMode::ReturnToLaunchSiteRtls);
                s.tank_material = TankMaterialPreset::Stainless304L;
                s.pressurization = PressurizationMode::Autogenous;
                s.structural_mass_fraction_override = Some(0.935);
                s
            },
            {
                let mut s = default_stage(2, "raptor_vac", 6, 0.66, RecoveryMode::Expendable);
                s.tank_material = TankMaterialPreset::Stainless304L;
                s.pressurization = PressurizationMode::Autogenous;
                s.structural_mass_fraction_override = Some(0.910);
                s
            },
        ],
        staging_mode: StagingArchitectureMode::HotStagingVentedRing,
        cryo_state: CryoStateMode::SubcooledDensified,
        fairing_profile: FairingProfile::VonKarman,
        fairing_reusable: false,
        mass_margin_frac: 0.05,
        max_q_throttle_frac: 0.72,
        max_q_bucket_duration_s: 24.0,
        g_limit: 4.5,
        expected_reuses: 25,
        production_quantity: 30,
        constraints: ConstraintEnvelope {
            min_liftoff_tw0: 1.15,
            max_liftoff_tw0: 2.10,
            min_upper_tw0: 0.20,
            max_upper_tw0: 1.85,
            max_glow_kg: Some(6_000_000.0),
            max_cost_usd: Some(500_000_000.0),
            max_core_diameter_m: Some(10.5),
            max_total_height_m: Some(135.0),
            enforce_base_packing: false,
            ..ConstraintEnvelope::default()
        },
        custom_engines: Vec::new(),
        advanced_defaults: Default::default(),
    };
    let res_ss = evaluate_manual_architecture(starship).expect("Starship eval failed");
    println!("Starship Feasible: {}, Violations: {:?}", res_ss.feasible, res_ss.violation_messages);
    assert!(res_ss.feasible, "Starship preset must be feasible: {:?}", res_ss.violation_messages);
}

#[test]
fn test_benchmark_15_uncertainty_quantification_bounds() {
    let cfg = VehicleConfiguration {
        name: "Uncertainty Benchmark".to_string(),
        payload_mass_kg: 10_000.0,
        payload_diameter_m: 4.0,
        payload_length_m: 8.0,
        orbit: OrbitTarget {
            preset: MissionPreset::Leo285,
            ..OrbitTarget::default()
        },
        required_delta_v_m_s: Some(9_150.0),
        core_diameter_m: 4.0,
        stage_count: 2,
        booster_engine_id: None,
        booster_count: 0,
        stages: vec![
            default_stage(1, "merlin_1d", 9, 0.40, RecoveryMode::Expendable),
            default_stage(2, "merlin_1d_vac", 1, 0.60, RecoveryMode::Expendable),
        ],
        staging_mode: StagingArchitectureMode::ColdPneumaticUllage,
        cryo_state: CryoStateMode::SubcooledDensified,
        fairing_profile: FairingProfile::VonKarman,
        fairing_reusable: false,
        mass_margin_frac: 0.05,
        max_q_throttle_frac: 0.75,
        max_q_bucket_duration_s: 20.0,
        g_limit: 4.5,
        expected_reuses: 1,
        production_quantity: 10,
        constraints: ConstraintEnvelope::default(),
        custom_engines: Vec::new(),
        booster_recovery_mode: RecoveryMode::Expendable,
        recovery_optimizer_enabled: false,
        advanced_defaults: Default::default(),
    };

    let res = evaluate_manual_architecture(cfg).expect("Architecture eval failed");
    let uncert = res.uncertainty.expect("Uncertainty profile must be populated");

    assert!(uncert.glow.p10_optimistic < uncert.glow.p50_median);
    assert!(uncert.glow.p50_median < uncert.glow.p90_conservative);
    assert!(uncert.dry_mass.p10_optimistic < uncert.dry_mass.p50_median);
    assert!(uncert.dry_mass.p50_median < uncert.dry_mass.p90_conservative);
    assert!(uncert.launch_price_usd.p10_optimistic < uncert.launch_price_usd.p50_median);
    assert!(uncert.launch_price_usd.p50_median < uncert.launch_price_usd.p90_conservative);
    assert!(uncert.ddte_usd.p10_optimistic < uncert.ddte_usd.p50_median);
    assert!(uncert.ddte_usd.p50_median < uncert.ddte_usd.p90_conservative);
    assert!(uncert.delivered_delta_v_m_s.p90_conservative < uncert.delivered_delta_v_m_s.p50_median);
    assert!(uncert.delivered_delta_v_m_s.p50_median < uncert.delivered_delta_v_m_s.p10_optimistic);
    assert!(uncert.payload_capacity_kg.p90_conservative < uncert.payload_capacity_kg.p50_median);
    assert!(uncert.payload_capacity_kg.p50_median < uncert.payload_capacity_kg.p10_optimistic);
    assert!(!uncert.dispersion_assumptions.is_empty());
}
