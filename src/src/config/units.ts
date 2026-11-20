export type UnitSystem = "metric" | "imperial";

export type UnitQuantity =
  | "mass"
  | "length"
  | "small_length"
  | "altitude"
  | "velocity"
  | "force"
  | "pressure"
  | "volume"
  | "mass_flow"
  | "isp"
  | "cost"
  | "cost_per_mass";

const KG_TO_LBS = 2.20462262185;
const M_TO_FT = 3.28083989501;
const M_TO_IN = 39.3700787402;
const M_TO_NMI = 1.0 / 1852.0;
const N_TO_LBF = 0.2248089431;
const BAR_TO_PSI = 14.503773773;
const PA_TO_PSI = 0.0001450377377;
const M3_TO_FT3 = 35.3146667215;

export function convertFromSi(value: number, quantity: UnitQuantity, unitSystem: UnitSystem): number {
  if (unitSystem === "metric") {
    if (quantity === "altitude") return value / 1_000.0;
    if (quantity === "force") return value / 1_000.0;
    if (quantity === "pressure") return value / 1_000.0;
    return value;
  }
  switch (quantity) {
    case "mass":
      return value * KG_TO_LBS;
    case "length":
      return value * M_TO_FT;
    case "small_length":
      return value * M_TO_IN;
    case "altitude":
      return value * M_TO_NMI;
    case "velocity":
      return value * M_TO_FT;
    case "force":
      return value * N_TO_LBF;
    case "pressure":
      return value * PA_TO_PSI;
    case "volume":
      return value * M3_TO_FT3;
    case "mass_flow":
      return value * KG_TO_LBS;
    case "cost_per_mass":
      return value / KG_TO_LBS;
    default:
      return value;
  }
}

export function convertToSi(displayValue: number, quantity: UnitQuantity, unitSystem: UnitSystem): number {
  if (unitSystem === "metric") {
    if (quantity === "altitude") return displayValue * 1_000.0;
    if (quantity === "force") return displayValue * 1_000.0;
    if (quantity === "pressure") return displayValue * 1_000.0;
    return displayValue;
  }
  switch (quantity) {
    case "mass":
      return displayValue / KG_TO_LBS;
    case "length":
      return displayValue / M_TO_FT;
    case "small_length":
      return displayValue / M_TO_IN;
    case "altitude":
      return displayValue / M_TO_NMI;
    case "velocity":
      return displayValue / M_TO_FT;
    case "force":
      return displayValue / N_TO_LBF;
    case "pressure":
      return displayValue / PA_TO_PSI;
    case "volume":
      return displayValue / M3_TO_FT3;
    case "mass_flow":
      return displayValue / KG_TO_LBS;
    case "cost_per_mass":
      return displayValue * KG_TO_LBS;
    default:
      return displayValue;
  }
}

export function unitLabel(quantity: UnitQuantity, unitSystem: UnitSystem): string {
  if (unitSystem === "metric") {
    switch (quantity) {
      case "mass":
        return "kg";
      case "length":
        return "m";
      case "small_length":
        return "m";
      case "altitude":
        return "km";
      case "velocity":
        return "m/s";
      case "force":
        return "kN";
      case "pressure":
        return "kPa";
      case "volume":
        return "m^3";
      case "mass_flow":
        return "kg/s";
      case "isp":
        return "s";
      case "cost":
        return "USD";
      case "cost_per_mass":
        return "$/kg";
    }
  }
  switch (quantity) {
    case "mass":
      return "lbs";
    case "length":
      return "ft";
    case "small_length":
      return "in";
    case "altitude":
      return "nmi";
    case "velocity":
      return "ft/s";
    case "force":
      return "lbf";
    case "pressure":
      return "psi";
    case "volume":
      return "ft^3";
    case "mass_flow":
      return "lbs/s";
    case "isp":
      return "s";
    case "cost":
      return "USD";
    case "cost_per_mass":
      return "$/lb";
  }
}

export function formatValueWithUnit(
  siValue: number,
  quantity: UnitQuantity,
  unitSystem: UnitSystem,
  decimals = 1
): string {
  if (quantity === "cost") {
    if (Math.abs(siValue) >= 1.0e9) return `$${(siValue / 1.0e9).toFixed(2)}B`;
    if (Math.abs(siValue) >= 1.0e6) return `$${(siValue / 1.0e6).toFixed(2)}M`;
    if (Math.abs(siValue) >= 1.0e3) return `$${(siValue / 1.0e3).toFixed(1)}k`;
    return `$${siValue.toFixed(0)}`;
  }
  const converted = convertFromSi(siValue, quantity, unitSystem);
  const formatted = Math.abs(converted) >= 1_000
    ? Math.round(converted).toLocaleString("en-US")
    : converted.toFixed(decimals);
  return `${formatted} ${unitLabel(quantity, unitSystem)}`;
}

export function formatBarPressure(barValue: number, unitSystem: UnitSystem): string {
  if (unitSystem === "metric") {
    return `${barValue.toFixed(1)} bar`;
  }
  return `${(barValue * BAR_TO_PSI).toFixed(0)} psi`;
}

export const NNSI_INDEX_BY_YEAR: Record<number, number> = {
  1965: 0.108,
  1970: 0.135,
  1975: 0.194,
  1980: 0.289,
  1985: 0.378,
  1990: 0.448,
  1995: 0.514,
  2000: 0.576,
  2005: 0.652,
  2010: 0.742,
  2015: 0.818,
  2018: 0.869,
  2020: 0.905,
  2021: 0.946,
  2022: 1.008,
  2023: 1.045,
  2024: 1.078,
  2025: 1.110,
  2026: 1.142,
  2027: 1.175,
  2028: 1.209,
  2030: 1.279,
};

export const SUPPORTED_INFLATION_YEARS: number[] = Object.keys(NNSI_INDEX_BY_YEAR)
  .map((y) => Number(y))
  .sort((a, b) => b - a);

function interpolateInflationIndex(year: number): number {
  if (NNSI_INDEX_BY_YEAR[year] !== undefined) {
    return NNSI_INDEX_BY_YEAR[year];
  }
  const years = Object.keys(NNSI_INDEX_BY_YEAR)
    .map((y) => Number(y))
    .sort((a, b) => a - b);
  if (year <= years[0]) {
    return NNSI_INDEX_BY_YEAR[years[0]] * Math.pow(1.031, year - years[0]);
  }
  if (year >= years[years.length - 1]) {
    return NNSI_INDEX_BY_YEAR[years[years.length - 1]] * Math.pow(1.028, year - years[years.length - 1]);
  }
  for (let i = 0; i < years.length - 1; i += 1) {
    const y0 = years[i];
    const y1 = years[i + 1];
    if (year >= y0 && year <= y1) {
      const t = (year - y0) / (y1 - y0);
      return NNSI_INDEX_BY_YEAR[y0] * (1 - t) + NNSI_INDEX_BY_YEAR[y1] * t;
    }
  }
  return 1.142;
}

export function adjustInflationUsd(
  originalUsd: number,
  fromYear: number,
  targetYear: number
): number {
  if (fromYear === targetYear) return originalUsd;
  const idxFrom = interpolateInflationIndex(fromYear);
  const idxTo = interpolateInflationIndex(targetYear);
  return originalUsd * (idxTo / Math.max(0.01, idxFrom));
}
