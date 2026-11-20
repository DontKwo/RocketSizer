use super::provenance::ProvenanceValue;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PropulsionType {
    Liquid,
    Solid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PropellantType {
    LoxRp1,
    LoxLh2,
    LoxCh4,
    SolidHtpb,
    HypergolicNtoUdmh,
}

impl PropellantType {
    pub fn as_str(&self) -> &'static str {
        match self {
            PropellantType::LoxRp1 => "LOX/RP-1",
            PropellantType::LoxLh2 => "LOX/LH2",
            PropellantType::LoxCh4 => "LOX/CH4",
            PropellantType::SolidHtpb => "Solid HTPB",
            PropellantType::HypergolicNtoUdmh => "NTO/UDMH",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EngineCycle {
    GasGenerator,
    StagedCombustion,
    FullFlowStagedCombustion,
    Expander,
    ElectricPump,
    PressureFed,
    SolidMotor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvenanceEngine {
    pub id: ProvenanceValue<String>,
    pub name: ProvenanceValue<String>,
    pub manufacturer: ProvenanceValue<String>,
    pub country: ProvenanceValue<String>,
    pub status: ProvenanceValue<String>,
    pub propulsion_type: ProvenanceValue<PropulsionType>,
    pub propellant: ProvenanceValue<PropellantType>,
    pub cycle: ProvenanceValue<EngineCycle>,
    pub oxidizer_fuel_ratio: ProvenanceValue<f64>,
    pub thrust_sl_n: ProvenanceValue<f64>,
    pub thrust_vac_n: ProvenanceValue<f64>,
    pub isp_sl_s: ProvenanceValue<f64>,
    pub isp_vac_s: ProvenanceValue<f64>,
    pub isp_avg_s: ProvenanceValue<f64>,
    pub mass_flow_rate_kg_s: ProvenanceValue<f64>,
    pub chamber_pressure_bar: ProvenanceValue<f64>,
    pub expansion_ratio: ProvenanceValue<f64>,
    pub min_throttle_pct: ProvenanceValue<f64>,
    pub max_throttle_pct: ProvenanceValue<f64>,
    pub restarts_rated: ProvenanceValue<u32>,
    pub dry_mass_kg: ProvenanceValue<f64>,
    pub height_m: ProvenanceValue<f64>,
    pub nozzle_diameter_m: ProvenanceValue<f64>,
    pub gimbal_envelope_dia_m: ProvenanceValue<f64>,
    pub tvc_gimbal_range_deg: ProvenanceValue<f64>,
    pub thrust_to_weight_vac: ProvenanceValue<f64>,
    pub unit_cost_usd: ProvenanceValue<f64>,
    pub development_cost_usd: ProvenanceValue<f64>,
    pub propellant_mass_kg: Option<ProvenanceValue<f64>>,
    pub total_mass_kg: Option<ProvenanceValue<f64>>,
    pub burn_time_s: Option<ProvenanceValue<f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineSpec {
    pub id: String,
    pub name: String,
    pub propulsion_type: PropulsionType,
    pub propellant: PropellantType,
    pub cycle: EngineCycle,
    pub oxidizer_fuel_ratio: f64,
    pub thrust_sl_n: f64,
    pub thrust_vac_n: f64,
    pub isp_sl_s: f64,
    pub isp_vac_s: f64,
    pub isp_avg_s: f64,
    pub mass_flow_rate_kg_s: f64,
    pub chamber_pressure_bar: f64,
    pub expansion_ratio: f64,
    pub min_throttle_frac: f64,
    pub max_throttle_frac: f64,
    pub dry_mass_kg: f64,
    pub height_m: f64,
    pub nozzle_diameter_m: f64,
    pub gimbal_envelope_dia_m: f64,
    pub tvc_gimbal_range_deg: f64,
    pub unit_cost_usd: f64,
    pub development_cost_usd: f64,
    pub propellant_mass_kg: f64,
    pub total_mass_kg: f64,
    pub burn_time_s: f64,
}

impl From<&ProvenanceEngine> for EngineSpec {
    fn from(eng: &ProvenanceEngine) -> Self {
        let prop_mass_kg = eng.propellant_mass_kg.as_ref().map(|p| p.value).unwrap_or(0.0);
        let tot_mass_kg = eng.total_mass_kg.as_ref().map(|p| p.value).unwrap_or(eng.dry_mass_kg.value);
        let burn_s = eng.burn_time_s.as_ref().map(|p| p.value).unwrap_or(0.0);
        Self {
            id: eng.id.value.clone(),
            name: eng.name.value.clone(),
            propulsion_type: eng.propulsion_type.value,
            propellant: eng.propellant.value,
            cycle: eng.cycle.value,
            oxidizer_fuel_ratio: eng.oxidizer_fuel_ratio.value,
            thrust_sl_n: eng.thrust_sl_n.value,
            thrust_vac_n: eng.thrust_vac_n.value,
            isp_sl_s: eng.isp_sl_s.value,
            isp_vac_s: eng.isp_vac_s.value,
            isp_avg_s: eng.isp_avg_s.value,
            mass_flow_rate_kg_s: eng.mass_flow_rate_kg_s.value,
            chamber_pressure_bar: eng.chamber_pressure_bar.value,
            expansion_ratio: eng.expansion_ratio.value,
            min_throttle_frac: eng.min_throttle_pct.value / 100.0,
            max_throttle_frac: eng.max_throttle_pct.value / 100.0,
            dry_mass_kg: eng.dry_mass_kg.value,
            height_m: eng.height_m.value,
            nozzle_diameter_m: eng.nozzle_diameter_m.value,
            gimbal_envelope_dia_m: eng.gimbal_envelope_dia_m.value,
            tvc_gimbal_range_deg: eng.tvc_gimbal_range_deg.value,
            unit_cost_usd: eng.unit_cost_usd.value,
            development_cost_usd: eng.development_cost_usd.value,
            propellant_mass_kg: prop_mass_kg,
            total_mass_kg: tot_mass_kg,
            burn_time_s: burn_s,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropellantProperties {
    pub propellant: PropellantType,
    pub of_ratio: f64,
    pub fuel_density_kg_m3: f64,
    pub ox_density_kg_m3: f64,
    pub ox_mass_fraction: f64,
    pub fuel_mass_fraction: f64,
    pub bulk_density_kg_m3: f64,
    pub ox_volume_fraction: f64,
}

impl PropellantProperties {
    pub fn from_type(propellant: PropellantType, of_override: Option<f64>, subcooled: bool) -> Self {
        let lox_dens_kg_m3 = if subcooled { 1230.0 } else { 1141.0 };
        let ch4_dens_kg_m3 = if subcooled { 451.0 } else { 422.0 };
        let (fuel_dens_kg_m3, ox_dens_kg_m3, default_of) = match propellant {
            PropellantType::LoxRp1 => (810.0, lox_dens_kg_m3, 2.56),
            PropellantType::LoxLh2 => (70.85, lox_dens_kg_m3, 5.5),
            PropellantType::LoxCh4 => (ch4_dens_kg_m3, lox_dens_kg_m3, 3.6),
            PropellantType::SolidHtpb => (1750.0, 1750.0, 0.0),
            PropellantType::HypergolicNtoUdmh => (791.0, 1440.0, 2.6),
        };
        let of_ratio = of_override.unwrap_or(default_of).max(0.0);
        let denom = 1.0 + of_ratio;
        let ox_mass_fraction = if of_ratio > 0.0 { of_ratio / denom } else { 0.0 };
        let fuel_mass_fraction = 1.0 - ox_mass_fraction;
        let fuel_vol_per_kg = fuel_mass_fraction / fuel_dens_kg_m3;
        let ox_vol_per_kg = ox_mass_fraction / ox_dens_kg_m3;
        let total_vol_per_kg = fuel_vol_per_kg + ox_vol_per_kg;
        let bulk_density_kg_m3 = 1.0 / total_vol_per_kg;
        let ox_volume_fraction = ox_vol_per_kg / total_vol_per_kg;
        Self {
            propellant,
            of_ratio,
            fuel_density_kg_m3: fuel_dens_kg_m3,
            ox_density_kg_m3: ox_dens_kg_m3,
            ox_mass_fraction,
            fuel_mass_fraction,
            bulk_density_kg_m3,
            ox_volume_fraction,
        }
    }

    pub fn split_masses_kg(&self, m_prop_kg: f64) -> (f64, f64) {
        let m_fuel_kg = m_prop_kg * self.fuel_mass_fraction;
        let m_ox_kg = m_prop_kg * self.ox_mass_fraction;
        (m_fuel_kg, m_ox_kg)
    }

    pub fn tank_volumes_m3(&self, m_prop_kg: f64, ullage_frac: f64) -> (f64, f64) {
        let (m_fuel_kg, m_ox_kg) = self.split_masses_kg(m_prop_kg);
        let scale = 1.0 + ullage_frac;
        let v_fuel_m3 = (m_fuel_kg / self.fuel_density_kg_m3) * scale;
        let v_ox_m3 = (m_ox_kg / self.ox_density_kg_m3) * scale;
        (v_fuel_m3, v_ox_m3)
    }
}
