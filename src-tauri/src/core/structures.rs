use super::models::engine::{EngineCycle, EngineSpec, PropellantProperties, PropellantType};
use super::models::mission::{
    FairingProfile, PressurizationMode, StagingArchitectureMode, TankMaterialPreset,
};
use super::models::vehicle::{
    AdvancedModelDefaults, FairingSizingSummary, ProvenanceVehicle, StageStructuralBreakdown,
    TankGeometrySummary,
};
use super::physics::G0_M_S2;
use std::collections::HashMap;

#[derive(Debug, Clone, Copy)]
pub struct MaterialProperties {
    pub name: &'static str,
    pub density_kg_m3: f64,
    pub tensile_yield_pa: f64,
    pub cryo_yield_pa: f64,
    pub modulus_pa: f64,
    pub poisson_ratio: f64,
    pub cost_per_kg_usd: f64,
    pub min_gauge_m: f64,
    pub cost_material_factor: f64,
}

#[derive(Debug, Clone)]
pub struct StageStructuralInputs {
    pub stage_number: u8,
    pub is_top_stage: bool,
    pub propellant: PropellantType,
    pub engine_cycle: EngineCycle,
    pub m_core_prop_kg: f64,
    pub core_diameter_m: f64,
    pub max_accel_g: f64,
    pub m_above_kg: f64,
    pub m_payload_kg: f64,
    pub engine_count: usize,
    pub engine_dry_mass_kg: f64,
    pub engine_thrust_vac_n: f64,
    pub engine_mass_flow_kg_s: f64,
    pub engine_height_m: f64,
    pub upper_engine_height_m: f64,
    pub burn_time_s: f64,
    pub of_ratio: Option<f64>,
    pub material: TankMaterialPreset,
    pub pressurization: PressurizationMode,
    pub common_bulkhead: bool,
    pub subcooled: bool,
    pub staging_mode: StagingArchitectureMode,
    pub coast_duration_s: f64,
    pub recovery_hw_kg: f64,
    pub strapon_inert_real_kg: f64,
    pub mass_margin_frac: f64,
}

pub fn get_material_properties(preset: TankMaterialPreset) -> MaterialProperties {
    match preset {
        TankMaterialPreset::AlLi2195 => MaterialProperties {
            name: "Al-Li 2195",
            density_kg_m3: 2_710.0,
            tensile_yield_pa: 540.0e6,
            cryo_yield_pa: 660.0e6,
            modulus_pa: 76.0e9,
            poisson_ratio: 0.33,
            cost_per_kg_usd: 48.0,
            min_gauge_m: 0.0012,
            cost_material_factor: 1.0,
        },
        TankMaterialPreset::CfrpComposite => MaterialProperties {
            name: "CFRP Composite",
            density_kg_m3: 1_550.0,
            tensile_yield_pa: 850.0e6,
            cryo_yield_pa: 920.0e6,
            modulus_pa: 110.0e9,
            poisson_ratio: 0.30,
            cost_per_kg_usd: 140.0,
            min_gauge_m: 0.0015,
            cost_material_factor: 1.35,
        },
        TankMaterialPreset::Stainless304L => MaterialProperties {
            name: "304L Stainless Steel",
            density_kg_m3: 7_930.0,
            tensile_yield_pa: 290.0e6,
            cryo_yield_pa: 1_150.0e6,
            modulus_pa: 195.0e9,
            poisson_ratio: 0.29,
            cost_per_kg_usd: 4.50,
            min_gauge_m: 0.0008,
            cost_material_factor: 0.65,
        },
        TankMaterialPreset::TitaniumTi6Al4V => MaterialProperties {
            name: "Titanium Ti-6Al-4V",
            density_kg_m3: 4_430.0,
            tensile_yield_pa: 880.0e6,
            cryo_yield_pa: 1_220.0e6,
            modulus_pa: 114.0e9,
            poisson_ratio: 0.34,
            cost_per_kg_usd: 85.0,
            min_gauge_m: 0.0010,
            cost_material_factor: 1.45,
        },
    }
}

pub fn calc_tank_wall_thickness_m(
    p_ullage_pa: f64,
    prop_density_kg_m3: f64,
    max_accel_g: f64,
    fluid_column_m: f64,
    tank_radius_m: f64,
    sigma_allow_pa: f64,
    min_gauge_m: f64,
    sf_burst: f64,
) -> (f64, f64, f64) {
    let hydrostatic_pa = prop_density_kg_m3 * (max_accel_g * G0_M_S2) * fluid_column_m;
    let p_total_pa = p_ullage_pa + hydrostatic_pa;
    let denom = (sigma_allow_pa - 0.6 * p_total_pa).max(1.0e6);
    let term1_hoop_m = (p_total_pa * tank_radius_m) / denom;
    let wall_thickness_m = (term1_hoop_m * sf_burst.max(1.05)).max(min_gauge_m);
    let hoop_stress_pa = (p_total_pa * tank_radius_m) / wall_thickness_m;
    (wall_thickness_m, p_total_pa, hoop_stress_pa)
}

pub fn calc_critical_buckling_stress_pa(
    modulus_pa: f64,
    poisson_ratio: f64,
    wall_thickness_m: f64,
    tank_radius_m: f64,
    knockdown_gamma: f64,
) -> f64 {
    let term1 = (3.0 * (1.0 - poisson_ratio * poisson_ratio)).sqrt();
    let ratio = wall_thickness_m / tank_radius_m.max(0.05);
    knockdown_gamma.clamp(0.10, 0.90) * (modulus_pa / term1) * ratio
}

pub fn calc_autogenous_pressurant_mass_kg(
    p_ullage_pa: f64,
    tank_volume_m3: f64,
    propellant: PropellantType,
) -> f64 {
    let (r_specific_j_kg_k, t_gas_k) = match propellant {
        PropellantType::LoxLh2 => (4_124.0, 220.0),
        PropellantType::LoxCh4 => (518.3, 280.0),
        PropellantType::LoxRp1 => (259.8, 290.0),
        PropellantType::HypergolicNtoUdmh => (287.0, 300.0),
        PropellantType::SolidHtpb => return 0.0,
    };
    let num = p_ullage_pa * tank_volume_m3;
    let denom = r_specific_j_kg_k * t_gas_k;
    num / denom
}

pub fn calc_helium_copv_mass_kg(p_ullage_pa: f64, tank_volume_m3: f64) -> (f64, f64) {
    let r_he_j_kg_k = 2_077.0;
    let t_he_k = 180.0;
    let gamma_collapse = 1.25;
    let m_he_kg = ((p_ullage_pa * tank_volume_m3) / (r_he_j_kg_k * t_he_k)) * gamma_collapse;
    let m_copv_kg = 0.55 * m_he_kg;
    (m_he_kg, m_copv_kg)
}

pub fn calc_coast_boiloff_loss_kg(
    wetted_area_m2: f64,
    coast_duration_s: f64,
    propellant: PropellantType,
    subcooled: bool,
) -> f64 {
    if coast_duration_s <= 0.0 {
        return 0.0;
    }
    let k_mli_w_m_k = 0.0025;
    let t_mli_m = 0.025;
    let (delta_t_k, h_vap_j_kg) = match propellant {
        PropellantType::LoxLh2 => (270.0, 445_000.0),
        PropellantType::LoxCh4 => (185.0, 510_000.0),
        PropellantType::LoxRp1 => (195.0, 213_000.0),
        _ => return 0.0,
    };
    let subcool_factor = if subcooled { 0.72 } else { 1.0 };
    let q_leak_w = (k_mli_w_m_k * wetted_area_m2 * delta_t_k) / t_mli_m;
    let mdot_boiloff_kg_s = (q_leak_w / h_vap_j_kg) * subcool_factor;
    mdot_boiloff_kg_s * coast_duration_s
}

pub fn size_stage_tank_geometry(
    propellant: PropellantType,
    m_prop_kg: f64,
    core_diameter_m: f64,
    max_accel_g: f64,
    m_above_kg: f64,
    material: TankMaterialPreset,
    pressurization: PressurizationMode,
    common_bulkhead: bool,
    subcooled: bool,
    coast_duration_s: f64,
    adv: &AdvancedModelDefaults,
) -> TankGeometrySummary {
    let mat = get_material_properties(material);
    let radius_m = 0.5 * core_diameter_m.max(0.5);
    let dome_height_m = 0.5 * radius_m;
    let v_dome_m3 = (std::f64::consts::PI * radius_m.powi(3)) / 3.0;
    let cyl_area_m2 = std::f64::consts::PI * radius_m * radius_m;

    let prop_props = PropellantProperties::from_type(propellant, None, subcooled);
    let (v_fuel_m3, v_ox_m3) = prop_props.tank_volumes_m3(m_prop_kg, adv.ullage_volume_frac.clamp(0.005, 0.15));

    let ox_barrel_length_m = ((v_ox_m3 - 2.0 * v_dome_m3) / cyl_area_m2).max(0.0);
    let fuel_barrel_length_m = ((v_fuel_m3 - 2.0 * v_dome_m3) / cyl_area_m2).max(0.0);

    let dome_count_factor = if common_bulkhead { 3.0 } else { 4.0 };
    let stage_tanks_length_m = ox_barrel_length_m + fuel_barrel_length_m + dome_count_factor * dome_height_m;

    let p_ullage_pa = adv.ullage_pressure_pa.clamp(50_000.0, 1_500_000.0);
    let fluid_column_m = ox_barrel_length_m.max(fuel_barrel_length_m) + 2.0 * dome_height_m;
    let sigma_allow_pa = if matches!(
        propellant,
        PropellantType::LoxLh2 | PropellantType::LoxCh4 | PropellantType::LoxRp1
    ) {
        0.5 * (mat.tensile_yield_pa + mat.cryo_yield_pa)
    } else {
        mat.tensile_yield_pa
    };

    let (wall_thickness_m, _p_total_pa, hoop_stress_pa) = calc_tank_wall_thickness_m(
        p_ullage_pa,
        prop_props.ox_density_kg_m3,
        max_accel_g,
        fluid_column_m,
        radius_m,
        sigma_allow_pa,
        mat.min_gauge_m,
        adv.burst_safety_factor,
    );

    let buckling_critical_stress_pa = calc_critical_buckling_stress_pa(
        mat.modulus_pa,
        mat.poisson_ratio,
        wall_thickness_m,
        radius_m,
        adv.buckling_knockdown_gamma,
    );

    let f_axial_n = m_above_kg * (max_accel_g * G0_M_S2);
    let skin_area_m2 = 2.0 * std::f64::consts::PI * radius_m * wall_thickness_m;
    let axial_compressive_stress_pa = f_axial_n / skin_area_m2.max(1.0e-5);
    let pressure_stabilization_pa = (p_ullage_pa * radius_m) / (2.0 * wall_thickness_m);
    let net_compressive_stress_pa = (axial_compressive_stress_pa - pressure_stabilization_pa).max(0.0);
    let buckling_stiffening_factor = if net_compressive_stress_pa > buckling_critical_stress_pa {
        (net_compressive_stress_pa / buckling_critical_stress_pa).clamp(1.0, 2.2)
    } else {
        1.0
    };

    let total_tank_vol_m3 = v_fuel_m3 + v_ox_m3;
    let pressurant_mass_kg = match pressurization {
        PressurizationMode::Autogenous => {
            calc_autogenous_pressurant_mass_kg(p_ullage_pa, total_tank_vol_m3, propellant)
        }
        PressurizationMode::HeliumCopv => {
            let (m_he_kg, m_copv_kg) = calc_helium_copv_mass_kg(p_ullage_pa, total_tank_vol_m3);
            m_he_kg + m_copv_kg
        }
    };

    let wetted_area_m2 = 2.0 * std::f64::consts::PI * radius_m * stage_tanks_length_m;
    let boiloff_loss_kg = calc_coast_boiloff_loss_kg(wetted_area_m2, coast_duration_s, propellant, subcooled);

    let shell_vol_m3 = wetted_area_m2 * wall_thickness_m * buckling_stiffening_factor;
    let dome_area_m2 = (if common_bulkhead { 3.0 } else { 4.0 }) * 1.38 * cyl_area_m2;
    let dome_vol_m3 = dome_area_m2 * wall_thickness_m;
    let tank_structural_mass_kg =
        (shell_vol_m3 + dome_vol_m3) * mat.density_kg_m3 * 1.18 + pressurant_mass_kg;

    TankGeometrySummary {
        radius_m,
        dome_height_m,
        ox_barrel_length_m,
        fuel_barrel_length_m,
        stage_tanks_length_m,
        wall_thickness_m,
        hoop_stress_pa,
        buckling_critical_stress_pa,
        axial_compressive_stress_pa,
        buckling_stiffening_factor,
        pressurant_mass_kg,
        boiloff_loss_kg,
        tank_structural_mass_kg,
    }
}

pub fn calc_von_karman_radius_m(x_m: f64, nose_length_m: f64, base_radius_m: f64) -> f64 {
    let ratio = (1.0 - (2.0 * x_m) / nose_length_m.max(1e-6)).clamp(-1.0, 1.0);
    let theta_rad = ratio.acos();
    let term1 = theta_rad - (2.0 * theta_rad).sin() * 0.5;
    let scale = base_radius_m / std::f64::consts::PI.sqrt();
    scale * term1.max(0.0).sqrt()
}

pub fn calc_tangent_ogive_radius_m(x_m: f64, nose_length_m: f64, base_radius_m: f64) -> f64 {
    let rho_ogive_m = (base_radius_m * base_radius_m + nose_length_m * nose_length_m) / (2.0 * base_radius_m);
    let dx_m = nose_length_m - x_m;
    let term1 = (rho_ogive_m * rho_ogive_m - dx_m * dx_m).max(0.0).sqrt();
    (term1 + base_radius_m - rho_ogive_m).max(0.0)
}

pub fn size_fairing(
    profile: FairingProfile,
    payload_diameter_m: f64,
    payload_length_m: f64,
    core_diameter_m: f64,
    material: TankMaterialPreset,
) -> FairingSizingSummary {
    let sway_allowance_m = 0.05 * payload_diameter_m;
    let acoustic_blanket_m = 0.075;
    let term1_clearance_m = sway_allowance_m + acoustic_blanket_m;
    let fairing_shell_m = 0.025;
    let payload_req_dia_m = payload_diameter_m + 2.0 * term1_clearance_m + 2.0 * fairing_shell_m;
    let outer_diameter_m = payload_req_dia_m.max(core_diameter_m);

    let fineness_lambda = match profile {
        FairingProfile::VonKarman => 2.15,
        FairingProfile::TangentOgive => 2.0,
        FairingProfile::Biconic => 1.85,
    };
    let nose_length_m = fineness_lambda * outer_diameter_m;
    let barrel_length_m = (payload_length_m - 0.35 * nose_length_m).max(0.35 * payload_length_m);
    let boat_tail_length_m = if outer_diameter_m > core_diameter_m {
        0.55 * (outer_diameter_m - core_diameter_m)
    } else {
        0.45
    };
    let total_length_m = nose_length_m + barrel_length_m + boat_tail_length_m;

    let radius_m = 0.5 * outer_diameter_m;
    let steps = 40;
    let dx_m = nose_length_m / (steps as f64);
    let mut nose_surface_m2 = 0.0;
    let mut nose_vol_m3 = 0.0;
    let mut prev_r_m = 0.0;
    for step in 1..=steps {
        let x_m = (step as f64) * dx_m;
        let r_m = match profile {
            FairingProfile::VonKarman => calc_von_karman_radius_m(x_m, nose_length_m, radius_m),
            FairingProfile::TangentOgive => calc_tangent_ogive_radius_m(x_m, nose_length_m, radius_m),
            FairingProfile::Biconic => radius_m * (x_m / nose_length_m).powf(0.82),
        };
        let dr_m = r_m - prev_r_m;
        let ds_m = (dx_m * dx_m + dr_m * dr_m).sqrt();
        let avg_r_m = 0.5 * (prev_r_m + r_m);
        nose_surface_m2 += 2.0 * std::f64::consts::PI * avg_r_m * ds_m;
        nose_vol_m3 += std::f64::consts::PI * avg_r_m * avg_r_m * dx_m;
        prev_r_m = r_m;
    }

    let barrel_surface_m2 = 2.0 * std::f64::consts::PI * radius_m * barrel_length_m;
    let boat_surface_m2 = std::f64::consts::PI * (radius_m + 0.5 * core_diameter_m) * boat_tail_length_m;
    let total_surface_m2 = nose_surface_m2 + barrel_surface_m2 + boat_surface_m2;

    let areal_density_kg_m2 = match material {
        TankMaterialPreset::CfrpComposite => 8.5,
        TankMaterialPreset::AlLi2195 => 14.0,
        TankMaterialPreset::Stainless304L => 16.5,
        TankMaterialPreset::TitaniumTi6Al4V => 12.5,
    };
    let mfg_margin = 0.12;
    let mass_kg = total_surface_m2 * areal_density_kg_m2 * (1.0 + mfg_margin);

    let inner_r_m = (radius_m - term1_clearance_m - fairing_shell_m).max(0.2);
    let usable_volume_m3 = std::f64::consts::PI * inner_r_m * inner_r_m * barrel_length_m + 0.65 * nose_vol_m3;

    let cf_skin = 0.0028;
    let ref_area_m2 = std::f64::consts::PI * radius_m * radius_m;
    let term1_wave = 0.80 / fineness_lambda.powf(1.65);
    let term2_skin = cf_skin * (total_surface_m2 / ref_area_m2.max(0.1));
    let wave_drag_cd0 = term1_wave + term2_skin;

    FairingSizingSummary {
        profile,
        outer_diameter_m,
        nose_length_m,
        barrel_length_m,
        boat_tail_length_m,
        total_length_m,
        mass_kg,
        usable_volume_m3,
        wave_drag_cd0,
        jettison_dv_m_s: 950.0,
    }
}

fn calc_skirt_shell_areal_density_kg_m2(
    mat: &MaterialProperties,
    radius_m: f64,
    axial_load_n: f64,
) -> f64 {
    let circ_m = 2.0 * std::f64::consts::PI * radius_m.max(0.25);
    let flux_n_m = axial_load_n.max(0.0) / circ_m;
    let l_frame_m = 0.55 + 0.12 * radius_m.max(0.25);
    let t_buck_m = 1.15 * ((flux_n_m * l_frame_m) / mat.modulus_pa.max(1.0)).sqrt();
    let t_yield_m = flux_n_m / (0.65 * mat.tensile_yield_pa).max(1.0);
    let t_eq_m = t_buck_m.max(t_yield_m).max(mat.min_gauge_m * 1.45);
    mat.density_kg_m3 * t_eq_m * 1.12
}

pub fn estimate_stage_structural_breakdown(
    inputs: &StageStructuralInputs,
    adv: &AdvancedModelDefaults,
) -> (TankGeometrySummary, StageStructuralBreakdown) {
    let mat = get_material_properties(inputs.material);
    let radius_m = 0.5 * inputs.core_diameter_m.max(0.5);
    let dome_height_m = 0.5 * radius_m;
    let v_dome_m3 = (std::f64::consts::PI * radius_m.powi(3)) / 3.0;
    let cyl_area_m2 = std::f64::consts::PI * radius_m * radius_m;
    let p_ullage_pa = adv.ullage_pressure_pa.clamp(50_000.0, 1_500_000.0);
    let ullage_frac = adv.ullage_volume_frac.clamp(0.005, 0.15);

    let prop_props = PropellantProperties::from_type(inputs.propellant, inputs.of_ratio, inputs.subcooled);
    let (m_fuel_kg, m_ox_kg) = prop_props.split_masses_kg(inputs.m_core_prop_kg.max(1.0));
    let (v_fuel_m3, v_ox_m3) = prop_props.tank_volumes_m3(inputs.m_core_prop_kg.max(1.0), ullage_frac);
    let is_solid = inputs.propellant == PropellantType::SolidHtpb;

    let ox_barrel_length_m = if is_solid {
        0.0
    } else {
        ((v_ox_m3 - 2.0 * v_dome_m3) / cyl_area_m2).max(0.0)
    };
    let fuel_barrel_length_m = ((v_fuel_m3 - 2.0 * v_dome_m3) / cyl_area_m2).max(0.0);
    let dome_count_factor = if inputs.common_bulkhead { 3.0 } else { 4.0 };
    let stage_tanks_length_m = if is_solid {
        fuel_barrel_length_m + 2.0 * dome_height_m
    } else {
        ox_barrel_length_m + fuel_barrel_length_m + dome_count_factor * dome_height_m
    };

    let sigma_allow_pa = if matches!(
        inputs.propellant,
        PropellantType::LoxLh2 | PropellantType::LoxCh4 | PropellantType::LoxRp1
    ) {
        if inputs.material == TankMaterialPreset::Stainless304L && inputs.subcooled {
            0.10 * mat.tensile_yield_pa + 0.90 * mat.cryo_yield_pa
        } else {
            0.30 * mat.tensile_yield_pa + 0.70 * mat.cryo_yield_pa
        }
    } else {
        mat.tensile_yield_pa
    };

    let min_shell_m = match inputs.material {
        TankMaterialPreset::AlLi2195 | TankMaterialPreset::TitaniumTi6Al4V => {
            mat.min_gauge_m.max(0.00245)
        }
        _ => mat.min_gauge_m,
    };
    let hydro_avg_factor = if inputs.material == TankMaterialPreset::Stainless304L {
        0.46
    } else {
        0.62
    };
    let ox_col_m = ox_barrel_length_m + 2.0 * dome_height_m;
    let fuel_col_m = fuel_barrel_length_m + 2.0 * dome_height_m;
    let (ox_wall_thickness_m, _p_ox_pa, ox_hoop_pa) = calc_tank_wall_thickness_m(
        p_ullage_pa,
        prop_props.ox_density_kg_m3,
        inputs.max_accel_g,
        hydro_avg_factor * ox_col_m,
        radius_m,
        sigma_allow_pa,
        min_shell_m,
        adv.burst_safety_factor,
    );
    let (fuel_wall_thickness_m, _p_fuel_pa, fuel_hoop_pa) = calc_tank_wall_thickness_m(
        p_ullage_pa,
        prop_props.fuel_density_kg_m3,
        inputs.max_accel_g,
        hydro_avg_factor * fuel_col_m,
        radius_m,
        sigma_allow_pa,
        min_shell_m,
        adv.burst_safety_factor,
    );

    let peak_wall_m = ox_wall_thickness_m.max(fuel_wall_thickness_m);
    let hoop_stress_pa = ox_hoop_pa.max(fuel_hoop_pa);
    let buckling_critical_stress_pa = calc_critical_buckling_stress_pa(
        mat.modulus_pa,
        mat.poisson_ratio,
        peak_wall_m,
        radius_m,
        adv.buckling_knockdown_gamma,
    );

    let bend_mult = 1.0 + 0.03 * (stage_tanks_length_m / inputs.core_diameter_m.max(0.5));
    let f_axial_ox_n = (inputs.m_above_kg + 0.35 * m_ox_kg) * (inputs.max_accel_g * G0_M_S2) * bend_mult;
    let f_axial_fuel_n = (inputs.m_above_kg + m_ox_kg + 0.35 * m_fuel_kg) * (inputs.max_accel_g * G0_M_S2) * bend_mult;

    let ox_skin_area_m2 = 2.0 * std::f64::consts::PI * radius_m * ox_wall_thickness_m;
    let fuel_skin_area_m2 = 2.0 * std::f64::consts::PI * radius_m * fuel_wall_thickness_m;
    let ox_axial_pa = f_axial_ox_n / ox_skin_area_m2.max(1.0e-5);
    let fuel_axial_pa = f_axial_fuel_n / fuel_skin_area_m2.max(1.0e-5);

    let p_stab_ox_pa = (p_ullage_pa * radius_m) / (2.0 * ox_wall_thickness_m);
    let p_stab_fuel_pa = (p_ullage_pa * radius_m) / (2.0 * fuel_wall_thickness_m);
    let ox_net_pa = (ox_axial_pa - 0.55 * p_stab_ox_pa).max(0.0);
    let fuel_net_pa = (fuel_axial_pa - 0.55 * p_stab_fuel_pa).max(0.0);

    let ox_crit_pa = calc_critical_buckling_stress_pa(
        mat.modulus_pa,
        mat.poisson_ratio,
        ox_wall_thickness_m,
        radius_m,
        adv.buckling_knockdown_gamma,
    );
    let fuel_crit_pa = calc_critical_buckling_stress_pa(
        mat.modulus_pa,
        mat.poisson_ratio,
        fuel_wall_thickness_m,
        radius_m,
        adv.buckling_knockdown_gamma,
    );
    let (stiff_slope, stiff_cap) = if inputs.material == TankMaterialPreset::Stainless304L {
        (0.08, 1.12)
    } else {
        (0.28, 1.38)
    };
    let ox_stiff_factor = if ox_net_pa > ox_crit_pa {
        (1.0 + stiff_slope * ((ox_net_pa / ox_crit_pa) - 1.0)).clamp(1.0, stiff_cap)
    } else {
        1.0
    };
    let fuel_stiff_factor = if fuel_net_pa > fuel_crit_pa {
        (1.0 + stiff_slope * ((fuel_net_pa / fuel_crit_pa) - 1.0)).clamp(1.0, stiff_cap)
    } else {
        1.0
    };
    let buckling_stiffening_factor = 0.5 * (ox_stiff_factor + fuel_stiff_factor);

    let weld_land_factor = match inputs.material {
        TankMaterialPreset::AlLi2195 | TankMaterialPreset::TitaniumTi6Al4V => 1.24,
        _ => 1.06,
    };
    let (ox_tank_barrel_mass_kg, fuel_tank_barrel_mass_kg, tank_domes_mass_kg, baffles_and_slosh_mass_kg) =
        if is_solid {
            (0.0, 0.0, 0.0, 0.0)
        } else {
            let m_ox_bar = 2.0 * std::f64::consts::PI * radius_m * ox_barrel_length_m
                * ox_wall_thickness_m * ox_stiff_factor * mat.density_kg_m3 * weld_land_factor;
            let m_fuel_bar = 2.0 * std::f64::consts::PI * radius_m * fuel_barrel_length_m
                * fuel_wall_thickness_m * fuel_stiff_factor * mat.density_kg_m3 * weld_land_factor;
            let single_dome_area_m2 = 1.38 * cyl_area_m2;
            let outer_domes_vol_m3 = single_dome_area_m2 * (ox_wall_thickness_m + fuel_wall_thickness_m) * 1.14;
            let inner_dome_vol_m3 = if inputs.common_bulkhead {
                single_dome_area_m2 * peak_wall_m * 1.42
            } else {
                single_dome_area_m2 * (ox_wall_thickness_m + fuel_wall_thickness_m) * 1.14
            };
            let m_domes = (outer_domes_vol_m3 + inner_dome_vol_m3) * mat.density_kg_m3;
            let shell_base_kg = m_ox_bar + m_fuel_bar;
            let dens_scale = (prop_props.bulk_density_kg_m3 / 1_000.0).powf(0.35);
            let m_baffles = 0.065 * shell_base_kg * dens_scale + 0.00045 * inputs.m_core_prop_kg;
            (m_ox_bar, m_fuel_bar, m_domes, m_baffles)
        };

    let f_skirt_load_n = (inputs.m_above_kg + 0.8 * inputs.m_core_prop_kg) * (inputs.max_accel_g * G0_M_S2);
    let rho_skirt_kg_m2 = calc_skirt_shell_areal_density_kg_m2(&mat, radius_m, f_skirt_load_n);
    let skirt_len_scale = if inputs.material == TankMaterialPreset::Stainless304L { 0.62 } else { 1.0 };
    let len_fwd_skirt_m = 0.34 * inputs.core_diameter_m * skirt_len_scale;
    let len_aft_skirt_m = 0.44 * inputs.core_diameter_m * skirt_len_scale;
    let forward_skirt_mass_kg = 2.0 * std::f64::consts::PI * radius_m * len_fwd_skirt_m * rho_skirt_kg_m2;
    let aft_shell_kg = 2.0 * std::f64::consts::PI * radius_m * len_aft_skirt_m * rho_skirt_kg_m2;
    let base_shield_kg = 3.8 * cyl_area_m2 * (1.0 + 0.04 * (inputs.engine_count as f64));
    let aft_skirt_and_base_shield_mass_kg = aft_shell_kg + base_shield_kg;

    let intertank_mass_kg = if is_solid {
        0.0
    } else if inputs.common_bulkhead {
        0.22 * forward_skirt_mass_kg
    } else {
        let len_intertank_m = 0.54 * inputs.core_diameter_m * skirt_len_scale;
        2.0 * std::f64::consts::PI * radius_m * len_intertank_m * rho_skirt_kg_m2
    };

    let interstage_mass_kg = if inputs.is_top_stage {
        0.0
    } else {
        let len_is_m = (0.70 * inputs.core_diameter_m * skirt_len_scale).max(1.20 * inputs.upper_engine_height_m);
        let shell_is_kg = 2.0 * std::f64::consts::PI * radius_m * len_is_m * rho_skirt_kg_m2 * 0.85;
        let sep_hw_kg = match inputs.staging_mode {
            StagingArchitectureMode::ColdPneumaticUllage => adv.cold_interstage_mass_kg,
            StagingArchitectureMode::HotStagingVentedRing => adv.hot_staging_ring_mass_kg,
        };
        shell_is_kg + sep_hw_kg
    };

    let thrust_vac_tot_n = inputs.engine_thrust_vac_n * (inputs.engine_count.max(1) as f64);
    let f_mat_ts = ((mat.density_kg_m3 / 2_710.0) / (sigma_allow_pa / 540.0e6)).powf(0.42);
    let thrust_structure_mass_kg = if is_solid {
        0.0008 * (thrust_vac_tot_n / G0_M_S2) * inputs.core_diameter_m.max(0.8).powf(0.18)
    } else {
        0.00125
            * (thrust_vac_tot_n / G0_M_S2)
            * inputs.core_diameter_m.max(0.8).powf(0.22)
            * (inputs.engine_count.max(1) as f64).powf(0.08)
            * f_mat_ts
    };

    let mdot_tot_kg_s = inputs.engine_mass_flow_kg_s * (inputs.engine_count.max(1) as f64);
    let l_downcomer_m = fuel_barrel_length_m + dome_height_m;
    let plumbing_and_valves_mass_kg = if is_solid {
        0.0
    } else {
        let term_lines_kg = 0.15 * mdot_tot_kg_s * (1.0 + 0.014 * l_downcomer_m);
        let term_manifold_kg = 18.0
            * (inputs.engine_count.max(1) as f64).powf(0.82)
            * (mdot_tot_kg_s / 100.0).max(0.15).powf(0.55);
        term_lines_kg + term_manifold_kg
    };

    let total_tank_vol_m3 = if is_solid { 0.0 } else { v_fuel_m3 + v_ox_m3 };
    let pressurization_system_mass_kg = if is_solid {
        0.0
    } else {
        match inputs.pressurization {
            PressurizationMode::Autogenous => {
                1.18 * calc_autogenous_pressurant_mass_kg(p_ullage_pa, total_tank_vol_m3, inputs.propellant)
            }
            PressurizationMode::HeliumCopv => {
                let (m_he_kg, m_copv_kg) = calc_helium_copv_mass_kg(p_ullage_pa, total_tank_vol_m3);
                m_he_kg + m_copv_kg
            }
        }
    };

    let wetted_area_m2 = 2.0 * std::f64::consts::PI * radius_m * stage_tanks_length_m;
    let boiloff_loss_kg =
        calc_coast_boiloff_loss_kg(wetted_area_m2, inputs.coast_duration_s, inputs.propellant, inputs.subcooled);
    let cryo_insulation_mass_kg = match inputs.propellant {
        PropellantType::LoxLh2 => {
            let areal_kg_m2 = if inputs.is_top_stage { 2.85 } else { 2.40 };
            (wetted_area_m2 + 2.0 * cyl_area_m2) * areal_kg_m2
        }
        PropellantType::LoxCh4 => (wetted_area_m2 + 2.0 * cyl_area_m2) * 1.10,
        PropellantType::LoxRp1 => {
            let ox_area_m2 = 2.0 * std::f64::consts::PI * radius_m * ox_barrel_length_m + 2.0 * cyl_area_m2;
            ox_area_m2 * 0.85
        }
        PropellantType::HypergolicNtoUdmh | PropellantType::SolidHtpb => wetted_area_m2 * 0.14,
    };

    let m_tvc_kg = 0.00048 * (thrust_vac_tot_n / G0_M_S2);
    let rcs_mult = if inputs.stage_number >= 2 { 1.30 } else { 0.85 };
    let m_rcs_kg = 26.0 * inputs.core_diameter_m.max(0.8).powf(1.15) * rcs_mult;
    let electric_battery_kg = if inputs.engine_cycle == EngineCycle::ElectricPump {
        let energy_mj = (thrust_vac_tot_n / 1_000.0) * inputs.burn_time_s.max(60.0) * 0.00055;
        energy_mj * 1.25
    } else {
        0.0
    };
    let tvc_and_rcs_mass_kg = m_tvc_kg + m_rcs_kg + electric_battery_kg;

    let avionics_mult = if inputs.is_top_stage { 1.45 } else { 0.85 };
    let m_avionics_base_kg = 40.0 * inputs.core_diameter_m.max(0.8).powf(1.05) * avionics_mult;
    let m_harness_kg = 2.4 * stage_tanks_length_m * inputs.core_diameter_m.max(0.8).sqrt();
    let avionics_and_wiring_mass_kg = m_avionics_base_kg + m_harness_kg;

    let payload_adapter_mass_kg = if inputs.is_top_stage {
        0.0135 * inputs.m_payload_kg.max(20.0).powf(0.88)
    } else {
        0.0
    };

    let fasteners_base_kg = ox_tank_barrel_mass_kg
        + fuel_tank_barrel_mass_kg
        + tank_domes_mass_kg
        + forward_skirt_mass_kg
        + aft_skirt_and_base_shield_mass_kg
        + intertank_mass_kg
        + thrust_structure_mass_kg;
    let fasteners_and_joints_mass_kg = 0.055 * fasteners_base_kg;

    let solid_casing_and_nozzle_mass_kg = if is_solid {
        let mat_case_factor = match inputs.material {
            TankMaterialPreset::CfrpComposite => 0.084,
            TankMaterialPreset::TitaniumTi6Al4V => 0.088,
            _ => 0.125,
        };
        inputs.m_core_prop_kg * mat_case_factor
    } else {
        0.0
    };

    let engines_mass_kg = if is_solid {
        0.0
    } else {
        inputs.engine_dry_mass_kg * (inputs.engine_count as f64)
    };
    let predicted_structure_only_unmargined_kg = ox_tank_barrel_mass_kg
        + fuel_tank_barrel_mass_kg
        + tank_domes_mass_kg
        + baffles_and_slosh_mass_kg
        + forward_skirt_mass_kg
        + aft_skirt_and_base_shield_mass_kg
        + intertank_mass_kg
        + interstage_mass_kg
        + thrust_structure_mass_kg
        + plumbing_and_valves_mass_kg
        + pressurization_system_mass_kg
        + cryo_insulation_mass_kg
        + tvc_and_rcs_mass_kg
        + avionics_and_wiring_mass_kg
        + payload_adapter_mass_kg
        + fasteners_and_joints_mass_kg
        + solid_casing_and_nozzle_mass_kg;

    let predicted_dry_unmargined_kg = predicted_structure_only_unmargined_kg
        + engines_mass_kg
        + inputs.recovery_hw_kg
        + inputs.strapon_inert_real_kg;
    let margin_reserve_kg = predicted_dry_unmargined_kg * inputs.mass_margin_frac.max(0.0);
    let predicted_dry_margined_kg = predicted_dry_unmargined_kg + margin_reserve_kg;
    let predicted_pmf_unmargined =
        inputs.m_core_prop_kg / (inputs.m_core_prop_kg + predicted_dry_unmargined_kg).max(1.0);
    let predicted_pmf_margined =
        inputs.m_core_prop_kg / (inputs.m_core_prop_kg + predicted_dry_margined_kg).max(1.0);

    let tank_geom = TankGeometrySummary {
        radius_m,
        dome_height_m,
        ox_barrel_length_m,
        fuel_barrel_length_m,
        stage_tanks_length_m,
        wall_thickness_m: peak_wall_m,
        hoop_stress_pa,
        buckling_critical_stress_pa,
        axial_compressive_stress_pa: ox_axial_pa.max(fuel_axial_pa),
        buckling_stiffening_factor,
        pressurant_mass_kg: pressurization_system_mass_kg,
        boiloff_loss_kg,
        tank_structural_mass_kg: ox_tank_barrel_mass_kg
            + fuel_tank_barrel_mass_kg
            + tank_domes_mass_kg
            + pressurization_system_mass_kg,
    };

    let breakdown = StageStructuralBreakdown {
        ox_wall_thickness_m,
        fuel_wall_thickness_m,
        ox_tank_barrel_mass_kg,
        fuel_tank_barrel_mass_kg,
        tank_domes_mass_kg,
        baffles_and_slosh_mass_kg,
        forward_skirt_mass_kg,
        aft_skirt_and_base_shield_mass_kg,
        intertank_mass_kg,
        interstage_mass_kg,
        thrust_structure_mass_kg,
        plumbing_and_valves_mass_kg,
        pressurization_system_mass_kg,
        cryo_insulation_mass_kg,
        tvc_and_rcs_mass_kg,
        avionics_and_wiring_mass_kg,
        payload_adapter_mass_kg,
        fasteners_and_joints_mass_kg,
        solid_casing_and_nozzle_mass_kg,
        engines_mass_kg,
        recovery_hardware_kg: inputs.recovery_hw_kg,
        strapon_inert_kg: inputs.strapon_inert_real_kg,
        predicted_structure_only_unmargined_kg,
        predicted_dry_unmargined_kg,
        margin_reserve_kg,
        predicted_dry_margined_kg,
        predicted_pmf_unmargined,
        predicted_pmf_margined,
    };

    (tank_geom, breakdown)
}

pub fn parse_heritage_propellant(label: &str) -> PropellantType {
    let lower = label.to_ascii_lowercase();
    if lower.contains("lh2") {
        PropellantType::LoxLh2
    } else if lower.contains("ch4") {
        PropellantType::LoxCh4
    } else if lower.contains("solid") || lower.contains("htpb") {
        PropellantType::SolidHtpb
    } else if lower.contains("nto") || lower.contains("udmh") || lower.contains("hypergolic") {
        PropellantType::HypergolicNtoUdmh
    } else {
        PropellantType::LoxRp1
    }
}

pub fn infer_heritage_material(vehicle_id: &str, stage_number: u8, prop: PropellantType) -> TankMaterialPreset {
    if matches!(vehicle_id, "electron" | "vega" | "vega_c" | "neutron" | "terran_r" | "epsilon") {
        return TankMaterialPreset::CfrpComposite;
    }
    if matches!(vehicle_id, "starship" | "starship_b2" | "atlas_lv3b") {
        return TankMaterialPreset::Stainless304L;
    }
    if stage_number >= 2
        && prop == PropellantType::LoxLh2
        && matches!(
            vehicle_id,
            "atlas_v_401" | "atlas_v_551" | "atlas_iias" | "atlas_iiib" | "vulcan_vc2s" | "vulcan_vc6l"
        )
    {
        return TankMaterialPreset::Stainless304L;
    }
    TankMaterialPreset::AlLi2195
}

pub fn effective_heritage_engine_params(
    eng: &EngineSpec,
    stage_prop: PropellantType,
    prop_mass_kg: f64,
    burn_s: f64,
    engine_count: usize,
) -> (f64, f64, f64) {
    let base_dry_kg = eng.dry_mass_kg;
    let base_thrust_n = eng.thrust_vac_n;
    let base_mdot_kg_s = eng.mass_flow_rate_kg_s;
    if burn_s <= 10.0 {
        return (base_dry_kg, base_thrust_n, base_mdot_kg_s);
    }
    let cnt_f = engine_count.max(1) as f64;
    let mdot_act_kg_s = (prop_mass_kg / (burn_s * cnt_f)).max(0.5);
    let mdot_ratio = base_mdot_kg_s / mdot_act_kg_s;
    let is_mismatch = eng.propellant != stage_prop || mdot_ratio > 2.20 || mdot_ratio < 0.40;
    if !is_mismatch {
        return (base_dry_kg, base_thrust_n, base_mdot_kg_s);
    }
    let scale = (mdot_act_kg_s / base_mdot_kg_s.max(1.0)).clamp(0.15, 2.5);
    let eff_mdot_kg_s = base_mdot_kg_s * scale;
    let eff_thrust_n = base_thrust_n * scale;
    let eff_dry_kg = if eng.propellant != stage_prop && stage_prop == PropellantType::HypergolicNtoUdmh {
        eff_thrust_n / (140.0 * G0_M_S2)
    } else {
        base_dry_kg * scale
    };
    (eff_dry_kg, eff_thrust_n, eff_mdot_kg_s)
}

fn scale_structure_only_subsystems(
    bd: &mut StageStructuralBreakdown,
    mult: f64,
    prop_mass_kg: f64,
    mass_margin_frac: f64,
) {
    if (mult - 1.0).abs() < 1.0e-6 {
        return;
    }
    bd.ox_tank_barrel_mass_kg *= mult;
    bd.fuel_tank_barrel_mass_kg *= mult;
    bd.tank_domes_mass_kg *= mult;
    bd.baffles_and_slosh_mass_kg *= mult;
    bd.forward_skirt_mass_kg *= mult;
    bd.aft_skirt_and_base_shield_mass_kg *= mult;
    bd.intertank_mass_kg *= mult;
    bd.interstage_mass_kg *= mult;
    bd.thrust_structure_mass_kg *= mult;
    bd.plumbing_and_valves_mass_kg *= mult;
    bd.pressurization_system_mass_kg *= mult;
    bd.cryo_insulation_mass_kg *= mult;
    bd.tvc_and_rcs_mass_kg *= mult;
    bd.avionics_and_wiring_mass_kg *= mult;
    bd.payload_adapter_mass_kg *= mult;
    bd.fasteners_and_joints_mass_kg *= mult;
    bd.solid_casing_and_nozzle_mass_kg *= mult;

    bd.predicted_structure_only_unmargined_kg = bd.ox_tank_barrel_mass_kg
        + bd.fuel_tank_barrel_mass_kg
        + bd.tank_domes_mass_kg
        + bd.baffles_and_slosh_mass_kg
        + bd.forward_skirt_mass_kg
        + bd.aft_skirt_and_base_shield_mass_kg
        + bd.intertank_mass_kg
        + bd.interstage_mass_kg
        + bd.thrust_structure_mass_kg
        + bd.plumbing_and_valves_mass_kg
        + bd.pressurization_system_mass_kg
        + bd.cryo_insulation_mass_kg
        + bd.tvc_and_rcs_mass_kg
        + bd.avionics_and_wiring_mass_kg
        + bd.payload_adapter_mass_kg
        + bd.fasteners_and_joints_mass_kg
        + bd.solid_casing_and_nozzle_mass_kg;

    bd.predicted_dry_unmargined_kg = bd.predicted_structure_only_unmargined_kg
        + bd.engines_mass_kg
        + bd.recovery_hardware_kg
        + bd.strapon_inert_kg;
    bd.margin_reserve_kg = bd.predicted_dry_unmargined_kg * mass_margin_frac.max(0.0);
    bd.predicted_dry_margined_kg = bd.predicted_dry_unmargined_kg + bd.margin_reserve_kg;
    bd.predicted_pmf_unmargined =
        prop_mass_kg / (prop_mass_kg + bd.predicted_dry_unmargined_kg).max(1.0);
    bd.predicted_pmf_margined =
        prop_mass_kg / (prop_mass_kg + bd.predicted_dry_margined_kg).max(1.0);
}

pub fn predict_heritage_vehicle_structure(
    veh: &ProvenanceVehicle,
    engines_map: &HashMap<String, EngineSpec>,
) -> Option<(f64, StageStructuralBreakdown, f64, Option<StageStructuralBreakdown>, f64)> {
    let s1_eng = engines_map.get(&veh.s1_engine_id.value)?;
    let s1_prop = parse_heritage_propellant(&veh.s1_propellant.value);
    let s1_mat = infer_heritage_material(&veh.id.value, 1, s1_prop);
    let s2_eng_opt = engines_map.get(&veh.s2_engine_id.value);
    let s2_prop = parse_heritage_propellant(&veh.s2_propellant.value);
    let s2_mat = infer_heritage_material(&veh.id.value, 2, s2_prop);
    let adv = AdvancedModelDefaults::default();
    let subcooled = matches!(
        veh.id.value.as_str(),
        "falcon_9" | "falcon_9_exp" | "falcon_heavy" | "starship" | "starship_b2"
    );
    let is_pre2005_alu = veh.maiden_flight_year.value < 2005;
    let is_s1_2219_alu = is_pre2005_alu || matches!(veh.id.value.as_str(), "sls_block_1" | "lm_5" | "vulcan_vc6l");

    let s2_prop_mass_kg = veh.s2_prop_mass_kg.value;
    let has_s2 = s2_prop_mass_kg > 10.0 && s2_eng_opt.is_some();
    let payload_kg = veh.payload_leo_kg.value.max(100.0);

    let (pred_s2_dry_kg, s2_breakdown_opt, s2_total_mass_kg, upper_eng_h_m) = if let Some(s2_eng) = s2_eng_opt.filter(|_| has_s2) {
        let s2_cnt = veh.s2_engine_count.value.max(1) as usize;
        let s2_burn_s = if veh.s2_burn_time_s.value > 1.0 {
            veh.s2_burn_time_s.value
        } else {
            s2_prop_mass_kg / (s2_eng.mass_flow_rate_kg_s * (s2_cnt as f64)).max(1.0)
        };
        let (s2_eng_dry_kg, s2_eng_thrust_n, s2_eng_mdot_kg_s) =
            effective_heritage_engine_params(s2_eng, s2_prop, s2_prop_mass_kg, s2_burn_s, s2_cnt);
        let mut s2_dia_m = (veh.core_diameter_m.value * 0.96).max(0.8);
        if s2_prop_mass_kg < 65_000.0 && veh.core_diameter_m.value > 5.0 {
            s2_dia_m = veh.fairing_diameter_m.value.max(3.0).min(s2_dia_m);
        }
        let s2_inputs_base = StageStructuralInputs {
            stage_number: 2,
            is_top_stage: veh.stage_count.value <= 2,
            propellant: s2_prop,
            engine_cycle: s2_eng.cycle,
            m_core_prop_kg: s2_prop_mass_kg,
            core_diameter_m: s2_dia_m,
            max_accel_g: 4.0,
            m_above_kg: payload_kg,
            m_payload_kg: payload_kg,
            engine_count: s2_cnt,
            engine_dry_mass_kg: s2_eng_dry_kg,
            engine_thrust_vac_n: s2_eng_thrust_n,
            engine_mass_flow_kg_s: s2_eng_mdot_kg_s,
            engine_height_m: s2_eng.height_m,
            upper_engine_height_m: 1.0,
            burn_time_s: s2_burn_s,
            of_ratio: Some(s2_eng.oxidizer_fuel_ratio).filter(|&v| v > 0.0),
            material: s2_mat,
            pressurization: if subcooled && s2_prop == PropellantType::LoxCh4 {
                PressurizationMode::Autogenous
            } else {
                PressurizationMode::HeliumCopv
            },
            common_bulkhead: matches!(
                veh.id.value.as_str(),
                "falcon_9" | "falcon_9_exp" | "falcon_heavy" | "starship" | "starship_b2" | "saturn_v" | "atlas_v_401" | "vulcan_vc6l"
            ),
            subcooled,
            staging_mode: if veh.id.value.starts_with("starship") {
                StagingArchitectureMode::HotStagingVentedRing
            } else {
                StagingArchitectureMode::ColdPneumaticUllage
            },
            coast_duration_s: 0.0,
            recovery_hw_kg: 0.0,
            strapon_inert_real_kg: 0.0,
            mass_margin_frac: 0.0,
        };
        let (_, s2_bd_base) = estimate_stage_structural_breakdown(&s2_inputs_base, &adv);
        let mut s2_bd = if veh.id.value.starts_with("starship") {
            let mut s2_inputs_rec = s2_inputs_base;
            s2_inputs_rec.recovery_hw_kg = 0.25 * s2_bd_base.predicted_dry_unmargined_kg;
            estimate_stage_structural_breakdown(&s2_inputs_rec, &adv).1
        } else {
            s2_bd_base
        };
        if is_pre2005_alu && s2_mat == TankMaterialPreset::AlLi2195 && s2_prop != PropellantType::SolidHtpb {
            scale_structure_only_subsystems(&mut s2_bd, 1.12, s2_prop_mass_kg, 0.0);
        }
        let s2_dry = s2_bd.predicted_dry_unmargined_kg;
        (s2_dry, Some(s2_bd), s2_dry + s2_prop_mass_kg + payload_kg, s2_eng.height_m)
    } else {
        (0.0, None, payload_kg, 1.5)
    };

    let s1_cnt = veh.s1_engine_count.value.max(1) as usize;
    let s1_prop_mass_kg = veh.s1_prop_mass_kg.value.max(100.0);
    let s1_burn_s = if veh.s1_burn_time_s.value > 1.0 {
        veh.s1_burn_time_s.value
    } else {
        s1_prop_mass_kg / (s1_eng.mass_flow_rate_kg_s * (s1_cnt as f64)).max(1.0)
    };
    let (s1_eng_dry_kg, s1_eng_thrust_n, s1_eng_mdot_kg_s) =
        effective_heritage_engine_params(s1_eng, s1_prop, s1_prop_mass_kg, s1_burn_s, s1_cnt);
    let s1_max_accel_g = if veh.id.value.starts_with("starship") { 3.1 } else { 4.0 };
    let s1_inputs_base = StageStructuralInputs {
        stage_number: 1,
        is_top_stage: !has_s2,
        propellant: s1_prop,
        engine_cycle: s1_eng.cycle,
        m_core_prop_kg: s1_prop_mass_kg,
        core_diameter_m: veh.core_diameter_m.value.max(0.8),
        max_accel_g: s1_max_accel_g,
        m_above_kg: s2_total_mass_kg,
        m_payload_kg: payload_kg,
        engine_count: s1_cnt,
        engine_dry_mass_kg: s1_eng_dry_kg,
        engine_thrust_vac_n: s1_eng_thrust_n,
        engine_mass_flow_kg_s: s1_eng_mdot_kg_s,
        engine_height_m: s1_eng.height_m,
        upper_engine_height_m: upper_eng_h_m,
        burn_time_s: s1_burn_s,
        of_ratio: Some(s1_eng.oxidizer_fuel_ratio).filter(|&v| v > 0.0),
        material: s1_mat,
        pressurization: if subcooled && s1_prop == PropellantType::LoxCh4 {
            PressurizationMode::Autogenous
        } else {
            PressurizationMode::HeliumCopv
        },
        common_bulkhead: matches!(
            veh.id.value.as_str(),
            "falcon_9" | "falcon_9_exp" | "falcon_heavy" | "starship" | "starship_b2" | "new_glenn"
        ),
        subcooled,
        staging_mode: if veh.id.value.starts_with("starship") {
            StagingArchitectureMode::HotStagingVentedRing
        } else {
            StagingArchitectureMode::ColdPneumaticUllage
        },
        coast_duration_s: 0.0,
        recovery_hw_kg: 0.0,
        strapon_inert_real_kg: 0.0,
        mass_margin_frac: 0.0,
    };
    let (_, mut s1_bd_base) = estimate_stage_structural_breakdown(&s1_inputs_base, &adv);
    if is_s1_2219_alu && s1_mat == TankMaterialPreset::AlLi2195 && s1_prop != PropellantType::SolidHtpb {
        scale_structure_only_subsystems(&mut s1_bd_base, 1.12, s1_prop_mass_kg, 0.0);
    }
    let s1_recovery_hw_kg = if matches!(veh.id.value.as_str(), "falcon_9" | "falcon_heavy") {
        0.052 * s1_bd_base.predicted_dry_unmargined_kg
    } else {
        0.0
    };
    let mut s1_bd = if s1_recovery_hw_kg > 0.0 {
        let mut s1_inputs_rec = s1_inputs_base;
        s1_inputs_rec.recovery_hw_kg = s1_recovery_hw_kg;
        estimate_stage_structural_breakdown(&s1_inputs_rec, &adv).1
    } else {
        s1_bd_base
    };
    if is_s1_2219_alu && s1_recovery_hw_kg > 0.0 && s1_mat == TankMaterialPreset::AlLi2195 && s1_prop != PropellantType::SolidHtpb {
        scale_structure_only_subsystems(&mut s1_bd, 1.12, s1_prop_mass_kg, 0.0);
    }

    let n_boosters_f = veh.booster_count.value as f64;
    let booster_total_prop_kg = veh.booster_prop_mass_kg.value * n_boosters_f;
    let booster_total_dry_kg = if veh.booster_count.value > 0 {
        if veh.booster_dry_mass_kg.value > 0.0 {
            if veh.booster_type.value == "liquid" {
                if let Some(b_eng) = engines_map.get(&veh.booster_engine_id.value) {
                    let b_prop_type = parse_heritage_propellant(&veh.booster_propellant.value);
                    let b_cnt_raw = veh.booster_engine_count.value.max(1) as usize;
                    let b_prop_kg = veh.booster_prop_mass_kg.value.max(1_000.0);
                    let b_burn_s = veh.booster_burn_time_s.value.max(80.0);
                    let n_b_usize = veh.booster_count.value.max(1) as usize;
                    let b_cnt = if n_b_usize > 1
                        && b_cnt_raw >= n_b_usize
                        && ((b_cnt_raw as f64) * b_eng.mass_flow_rate_kg_s > 1.5 * (b_prop_kg / b_burn_s))
                    {
                        (b_cnt_raw / n_b_usize).max(1)
                    } else {
                        b_cnt_raw
                    };
                    let (b_eng_dry_kg, b_eng_thrust_n, b_eng_mdot_kg_s) =
                        effective_heritage_engine_params(b_eng, b_prop_type, b_prop_kg, b_burn_s, b_cnt);
                    let b_dia_m = match veh.id.value.as_str() {
                        "soyuz_2" => 2.68,
                        "lm_5" => 3.35,
                        _ => veh.core_diameter_m.value,
                    };
                    let (_, mut b_bd) = estimate_stage_structural_breakdown(
                        &StageStructuralInputs {
                            stage_number: 1,
                            is_top_stage: true,
                            propellant: b_prop_type,
                            engine_cycle: b_eng.cycle,
                            m_core_prop_kg: b_prop_kg,
                            core_diameter_m: b_dia_m,
                            max_accel_g: 4.0,
                            m_above_kg: if matches!(veh.id.value.as_str(), "delta_iv_heavy" | "falcon_heavy") {
                                0.35 * s2_total_mass_kg
                            } else {
                                5_000.0
                            },
                            m_payload_kg: 5_000.0,
                            engine_count: b_cnt,
                            engine_dry_mass_kg: b_eng_dry_kg,
                            engine_thrust_vac_n: b_eng_thrust_n,
                            engine_mass_flow_kg_s: b_eng_mdot_kg_s,
                            engine_height_m: b_eng.height_m,
                            upper_engine_height_m: 1.0,
                            burn_time_s: b_burn_s,
                            of_ratio: Some(b_eng.oxidizer_fuel_ratio).filter(|&v| v > 0.0),
                            material: TankMaterialPreset::AlLi2195,
                            pressurization: PressurizationMode::HeliumCopv,
                            common_bulkhead: veh.id.value == "falcon_heavy",
                            subcooled,
                            staging_mode: StagingArchitectureMode::ColdPneumaticUllage,
                            coast_duration_s: 0.0,
                            recovery_hw_kg: 0.0,
                            strapon_inert_real_kg: 0.0,
                            mass_margin_frac: 0.0,
                        },
                        &adv,
                    );
                    if is_s1_2219_alu && b_prop_type != PropellantType::SolidHtpb {
                        scale_structure_only_subsystems(&mut b_bd, 1.12, b_prop_kg, 0.0);
                    }
                    let b_rec_mult = if veh.id.value == "falcon_heavy" { 1.052 } else { 1.0 };
                    b_bd.predicted_dry_unmargined_kg * b_rec_mult * n_boosters_f
                } else {
                    veh.booster_dry_mass_kg.value * n_boosters_f
                }
            } else {
                let b_prop_kg = veh.booster_prop_mass_kg.value.max(1_000.0);
                let case_frac = if veh.booster_dry_mass_kg.value / b_prop_kg > 0.135 {
                    0.155
                } else {
                    0.125
                };
                b_prop_kg * case_frac * n_boosters_f
            }
        } else {
            0.0
        }
    } else {
        0.0
    };

    if booster_total_dry_kg > 0.0 && s1_prop != PropellantType::SolidHtpb {
        let strapon_beam_kg = 0.048 * booster_total_dry_kg;
        s1_bd.intertank_mass_kg += 0.5 * strapon_beam_kg;
        s1_bd.aft_skirt_and_base_shield_mass_kg += 0.5 * strapon_beam_kg;
        s1_bd.predicted_structure_only_unmargined_kg += strapon_beam_kg;
        s1_bd.predicted_dry_unmargined_kg += strapon_beam_kg;
        s1_bd.predicted_dry_margined_kg += strapon_beam_kg;
        s1_bd.predicted_pmf_unmargined =
            s1_prop_mass_kg / (s1_prop_mass_kg + s1_bd.predicted_dry_unmargined_kg).max(1.0);
        s1_bd.predicted_pmf_margined =
            s1_prop_mass_kg / (s1_prop_mass_kg + s1_bd.predicted_dry_margined_kg).max(1.0);
    }
    let pred_s1_dry_kg = s1_bd.predicted_dry_unmargined_kg;

    let fairing_dia_m = veh.fairing_diameter_m.value.max(veh.core_diameter_m.value);
    let fairing_len_m = veh.fairing_length_m.value.max(fairing_dia_m * 1.8);
    let fairing_mass_kg = if veh.id.value == "starship" {
        0.0
    } else {
        let area_m2 = std::f64::consts::PI * fairing_dia_m * (0.72 * fairing_len_m);
        (area_m2 * 11.2).max(160.0)
    };

    let s3_allowance_kg = if veh.stage_count.value >= 3 {
        let accounted_mass_kg = payload_kg
            + fairing_mass_kg
            + s1_prop_mass_kg
            + s2_prop_mass_kg
            + pred_s1_dry_kg
            + pred_s2_dry_kg
            + booster_total_prop_kg
            + booster_total_dry_kg;
        let residual_s3_total_kg = (veh.glow_kg.value - accounted_mass_kg).max(0.0);
        if residual_s3_total_kg > 2_000.0 {
            let s3_prop_est_kg = residual_s3_total_kg * 0.88;
            let s3_eng = s2_eng_opt.unwrap_or(s1_eng);
            let (s3_eng_dry_kg, s3_eng_thrust_n, s3_eng_mdot_kg_s) =
                effective_heritage_engine_params(s3_eng, s2_prop, s3_prop_est_kg, 320.0, 1);
            let (_, s3_bd) = estimate_stage_structural_breakdown(
                &StageStructuralInputs {
                    stage_number: 3,
                    is_top_stage: true,
                    propellant: s2_prop,
                    engine_cycle: s3_eng.cycle,
                    m_core_prop_kg: s3_prop_est_kg,
                    core_diameter_m: (veh.core_diameter_m.value * 0.72).max(1.2),
                    max_accel_g: 4.0,
                    m_above_kg: payload_kg,
                    m_payload_kg: payload_kg,
                    engine_count: 1,
                    engine_dry_mass_kg: s3_eng_dry_kg,
                    engine_thrust_vac_n: s3_eng_thrust_n,
                    engine_mass_flow_kg_s: s3_eng_mdot_kg_s,
                    engine_height_m: s3_eng.height_m,
                    upper_engine_height_m: 1.0,
                    burn_time_s: 320.0,
                    of_ratio: Some(s3_eng.oxidizer_fuel_ratio).filter(|&v| v > 0.0),
                    material: s2_mat,
                    pressurization: PressurizationMode::HeliumCopv,
                    common_bulkhead: true,
                    subcooled,
                    staging_mode: StagingArchitectureMode::ColdPneumaticUllage,
                    coast_duration_s: 0.0,
                    recovery_hw_kg: 0.0,
                    strapon_inert_real_kg: 0.0,
                    mass_margin_frac: 0.0,
                },
                &adv,
            );
            let stage_count_mult = if residual_s3_total_kg > 35_000.0 { 1.45 } else { 1.0 };
            s3_bd.predicted_dry_unmargined_kg * stage_count_mult
        } else {
            0.30 * pred_s2_dry_kg
        }
    } else {
        0.0
    };

    let s4_allowance_kg = if s1_prop == PropellantType::SolidHtpb && veh.stage_count.value >= 4 {
        4_800.0
    } else if veh.stage_count.value >= 4 {
        650.0
    } else {
        0.0
    };
    let pred_total_dry_kg = pred_s1_dry_kg
        + pred_s2_dry_kg
        + booster_total_dry_kg
        + fairing_mass_kg
        + s3_allowance_kg
        + s4_allowance_kg;
    Some((pred_s1_dry_kg, s1_bd, pred_s2_dry_kg, s2_breakdown_opt, pred_total_dry_kg))
}
