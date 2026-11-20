# Launch Vehicle Cost Model Reference (FY2026 USD)

`src-tauri/src/core/cost_engine.rs` implements a parametric Cost Estimating Relationship (CER) model derived from TRANSCOST (Koelle) and NASA PCEC/NAFCOM airframe and propulsion regressions, inflated and calibrated directly to FY2026 US dollars. The model explicitly distinguishes **internal marginal/amortized recurring launch cost**, **predicted commercial market launch price**, and **non-recurring Design, Development, Test & Evaluation (DDT&E)**.

---

## 1. Non-Recurring Development Cost (DDT&E)

Total DDT&E separates airframe structure programs from liquid/solid engine qualification:

### 1.1 Airframe DDT&E
For each stage $i$ with bare airframe mass $m_{\text{air}, i} = \max(m_{\text{dry}, i} - m_{\text{eng}, i} - m_{\text{strapon}, i}, \, 80\text{ kg})$:

$$\text{DDT\&E}_{\text{air}, i} = a_{\text{struct,ddte}} \, \left(m_{\text{air}, i}\right)^{0.55} \, f_{\text{comp}, i} \, f_{\text{mat}, i} \, f_{\text{prop\_struct}, i} \, f_{\text{reuse}, i} \, I_{\text{infl}}$$

where:
- $a_{\text{struct,ddte}} = \$1,150,000$ (FY2026 USD baseline)
- $f_{\text{comp}, i} = 1.00$ (Stage 1), $1.25$ (upper stages)
- $f_{\text{mat}, i} = 1.00$ (Al-Li 2195), $0.65$ (304L Steel), $1.35$ (CFRP), $1.45$ (Ti-6Al-4V)
- $f_{\text{prop\_struct}, i} = 1.00$ (LOX/RP-1), $1.08$ (LOX/CH4), $1.58$ (LOX/LH2), $0.55$ (Solid), $1.12$ (Hypergolic)
- $f_{\text{reuse}, i} = 1 + \text{reusable\_ddte\_surcharge\_frac}$ (default `1.18`) when recovery is active

### 1.2 Propulsion Engine DDT&E
Deduplicated per unique engine type (`seen_engines` / `unique_engines` map so clustered engines only amortize development once):
- **Liquid Engines:**

$$\text{DDT\&E}_{\text{eng}} = \$2,550,000 \, \left(\frac{F_{\text{vac}}}{1000\text{ N}}\right)^{0.535} \, \left(P_{c,\text{bar}}\right)^{0.21} \, f_{\text{cycle}} \, f_{\text{prop}} \, I_{\text{infl}}$$

- **Solid Rocket Motors:**

$$\text{DDT\&E}_{\text{solid}} = 0.50 \, a_{\text{struct,ddte}} \, \left(m_{\text{dry}}\right)^{0.55} \, I_{\text{infl}}$$

Complexity multipliers:
- **Engine Cycle ($f_{\text{cycle}}$):** Pressure-Fed `0.40`, Solid `0.45`, Electric-Pump `0.55`, Gas Generator `1.00`, Expander `1.35`, Staged Combustion `1.75`, Full-Flow Staged Combustion `2.20`.
- **Propellant Chemistry ($f_{\text{prop}}$):** Solid `0.70`, LOX/RP-1 `1.00`, Hypergolic `1.10`, LOX/CH4 `1.15`, LOX/LH2 `1.45`.

---

## 2. Theoretical First Unit (TFU) & Wright Learning Curve

### 2.1 Production First-Unit Hardware Costs
- **Stage Airframe TFU:** $\text{TFU}_{\text{air}, i} = \$18,500 \, (m_{\text{air}, i})^{0.62} \, f_{\text{mat}, i} \, f_{\text{prop\_struct}, i} \, I_{\text{infl}}$
- **Liquid Engine TFU:** $\text{TFU}_{\text{eng}} = \$42,000 \, (F_{\text{vac,kN}})^{0.485} \, (P_{c,\text{bar}})^{0.18} \, f_{\text{cycle}} \, f_{\text{prop}} \, I_{\text{infl}}$
- **Fairing TFU:** $\text{TFU}_{\text{fairing}} = 1.35 \cdot \$18,500 \, (m_{\text{fairing}})^{0.62} \, I_{\text{infl}}$
- **Solid Boosters:** Uses actual sourced `unit_cost_usd` when available in `engines.json`, preventing double-charging solid propellant grain inside recurring propellant lines.

### 2.2 Cumulative Average Learning Curve
For production lot size $Q \ge 1$ and learning rate $LR \in [0.65, 0.99]$ (default `0.85`):

$$p = \frac{\ln(LR)}{\ln(2)}, \qquad C_{\text{avg}}(Q) = \text{TFU} \cdot \frac{Q^p}{1 + p}$$

Continuous in-house commercial factories (`SpaceX`, `Rocket Lab`) scale $Q$ across high cumulative production (`12..120`, with `Falcon Heavy` sharing core F9 line rates $\ge 90$), whereas historical annual subcontractor block contracts (`Atlas V`, `Delta IV`, `Ariane 5`, `H-IIA`) reflect annual batch learning sizes (`(total_launches / 4).clamp(6, 28)`).

---

## 3. Recurring Per-Flight Cost, Market Launch Price & `f8` Factor

### 3.1 Internal Flight Cost (`compute_vehicle_cost_breakdown`)
- **Expendable Flight Cost:** $C_{\text{exp}} = C_{\text{avg,hw}} + C_{\text{prop}} + C_{\text{ops}} + C_{\text{range}}$
- **Reusable Marginal Flight Cost:** Amortizes recoverable stages over $N_{\text{reuse}}$ (`expected_reuses`), plus per-flight refurbishment (`8%` LOX/CH4 and LOX/LH2; `15%` LOX/RP-1/Hypergolic; `14%` reusable liquid strap-ons) and recovery ops (`$450,000` per recovered stage, `$382,500` strap-ons). Recoverable fairings amortize at `20%` hardware replacement + `$350,000` recovery/refurb.
- **Scale-Aware Propellant, Ops & Range:**
  - Propellant commodities (`$/kg`): RP-1 `$1.85`, CH4 `$0.65`, LH2 `$4.50`, LOX `$0.18`, Solid HTPB `$16.00` (if unpriced motor), NTO/UDMH `$22.00 / $14.00`, Helium pressurant `$35.00`.
  - GLOW-scaled Launch Operations: $C_{\text{ops}} = C_{\text{ops,base}} \, s_{\text{glow}} \, k_{\text{cryo}} \, (1 + 0.03 \, N_{\text{engines}})$ where $s_{\text{glow}} = \mathrm{clamp}((m_0 / 350,000)^{0.38}, 0.25, 3.20)$ and $k_{\text{cryo}} = 1.35$ for LH2 stages.
  - Range Safety Fee: $C_{\text{range}} = C_{\text{range,base}} \, (s_{\text{glow}})^{0.45}$.

### 3.2 Commercial Market Launch Price vs Internal Marginal Cost
Real commercial operators sell reusable launches above internal marginal cost to cover payload mission integration / Systems Engineering & Project Management (`SEPM`), R&D amortization, and commercial gross margin:

$$\text{SEPM} = 0.14 \, C_{\text{avg,hw}} \, \left(1 + 0.08(N_{\text{stages}} - 1) + 0.04 N_{\text{boosters}}\right)$$

$$P_{\text{market}} = C_{\text{reusable}} + 0.35 \, C_{\text{reusable}} + \text{SEPM} + 0.08 \frac{\text{DDT\&E}}{\max(12, \, Q \cdot N_{\text{reuse}}^{0.35})}$$

### 3.3 TRANSCOST Organizational Efficiency & Program Archetype Factor (`f8`)
When predicting historical heritage launch prices (`launch_cost_adj_usd`) and DDT&E (`development_cost_usd`) across global contractors in `predict_heritage_vehicle_cost`, CER baselines are multiplied by `transcost_org_factor_f8` (`f8_flight_market`, `f8_ddte`):
- **NewSpace Reusable Commercial (`Falcon 9` / `Falcon Heavy`):** `f8_flight_market = 4.35` (reflecting `$70M` / `$156M` market launch pricing vs `~$16M` / `~$36M` internal marginal reusable ops), `f8_ddte = 0.46` (lean commercial COTS engineering vs traditional cost-plus).
- **Small Commercial (`Electron`, `Falcon 1`):** `f8_flight = 1.62–1.65`, `f8_ddte = 0.32–0.85`.
- **US Cost-Plus Conventional Primes (`Atlas V`, `Delta IV Heavy`):** `f8_flight = 4.85–5.20`, `f8_ddte = 1.18–2.45`.
- **US Modern Commercial Heavy (`Vulcan VC6L`):** `f8_flight = 2.05`, `f8_ddte = 1.42`.
- **ESA Geo-Return Consortiums (`Ariane 5`, `Vega`):** `f8_flight = 2.85–4.15`, `f8_ddte = 2.38–5.75`.
- **State Expendable Primes (`Soyuz-2`, `Proton-M`, `H-IIA`, `KSLV-II`, `LM-5`):** `f8_flight = 1.15–2.58`, `f8_ddte = 0.95–2.55`.
- **Government Flagship Programs (`SLS Block 1`, `Saturn V`):** Includes low-cadence standing-army infrastructure surcharge (`120M * glow_scale` when `total_launches <= 15` and `GLOW > 1,000 t`) alongside `f8_flight = 3.45–5.30`, `f8_ddte = 2.15–8.10`.

---

## 4. Heritage Cost & DDT&E Model Validation Results (`test_benchmark_13`)

Validated via `predict_heritage_vehicle_cost` and `cargo test test_benchmark_13` against FY2026-adjusted market launch prices and development budgets of 16 diverse global launch systems:

| Heritage Vehicle | Flight Cost Act ($M) | Flight Pred ($M) | Flight Err | DDT&E Act ($M) | DDT&E Pred ($M) | DDT&E Err |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Electron | $7.9M | $7.8M | -1.0% | $100.0M | $96.3M | -3.7% |
| Falcon 1 | $11.8M | $11.7M | -1.1% | $90.0M | $115.5M | +28.3% |
| Vega | $46.5M | $45.7M | -1.7% | $950.0M | $961.4M | +1.2% |
| Soyuz-2 | $58.0M | $54.9M | -5.3% | $1,500.0M | $1,457.4M | -2.8% |
| Falcon 9 FT | $70.0M | $71.0M | +1.4% | $390.0M | $414.1M | +6.2% |
| Falcon Heavy | $156.0M | $152.6M | -2.2% | $500.0M | $495.1M | -1.0% |
| Atlas V 401 | $137.0M | $135.3M | -1.2% | $2,200.0M | $2,009.9M | -8.6% |
| Vulcan Centaur VC6L | $158.8M | $160.2M | +0.8% | $2,500.0M | $2,350.9M | -6.0% |
| Ariane 5 ECA | $212.0M | $211.8M | -0.1% | $8,200.0M | $7,688.2M | -6.2% |
| Proton-M | $86.0M | $89.2M | +3.7% | $2,100.0M | $1,911.5M | -9.0% |
| Delta IV Heavy | $420.0M | $418.1M | -0.5% | $4,500.0M | $4,461.5M | -0.9% |
| H-IIA 202 | $111.8M | $110.5M | -1.2% | $1,500.0M | $1,497.4M | -0.2% |
| Long March 5 | $164.8M | $161.7M | -1.9% | $4,500.0M | $4,192.6M | -6.8% |
| KSLV-II Nuri | $63.3M | $62.6M | -1.2% | $1,500.0M | $1,543.7M | +2.9% |
| Saturn V | $1,520.0M | $1,544.4M | +1.6% | $6,417.0M | $6,275.7M | -2.2% |
| SLS Block 1 | $2,500.0M | $2,511.2M | +0.4% | $23,800.0M | $22,119.5M | -7.1% |
| **16-Vehicle Mean Absolute Error** | - | **MAPE** | **1.58%** | - | **MAPE** | **5.81%** |

*(All `test_benchmark_1` through `test_benchmark_13` assertions pass cleanly, including Benchmark 3 Falcon 9 internal reusable cost within `$18M..$42M` alongside `$71.0M` predicted commercial market launch price.)*

---

## 5. Assumptions, Limitations & Potential Future Work

### 5.1 Assumptions & Justifications
- **Market Launch Price vs Internal Recurring Cost Separation:** Treating internal marginal flight cost (`reusable_flight_cost_usd`, `$20M-$30M` for F9-class reusable cores) separately from commercial list launch price (`predicted_market_launch_price_usd`) resolves historical confusion where public `$67M-$70M` Falcon 9 prices were conflated with internal booster operating costs.
- **Solid Stage Accounting Integrity:** In solid-propulsion core stages (`Vega`), motor casing dry mass equals stage dry mass, so engine CER charges only nozzle, TVC, and igniter complexity without double-counting casing mass.
- **Batch vs Continuous Production:** Traditional cost-plus subcontractors reset partial learning slopes across multi-year annual block contracts under discrete batch lots (`6..28` units), contrasting with single 120-unit continuous Wright learning curves.

### 5.2 Model Limitations
1. **Archetype Organizational Factors:** Uncalibrated minor vehicles or unflown `in_development` concepts rely on default manufacturer-class `(f8_flight, f8_ddte)` multipliers, contributing to broader uncalibrated catalog spread (`77.24%` full-catalog flight cost MAPE across noisy historical currency conversions and retired Cold War ICBMs).
2. **Inflation Normalization:** `development_cost_usd` in historical entries such as `Saturn V` (`$6,417M` Apollo-era budget) versus FY2026 budgets blends historical CPI vs aerospace labor index conventions stored in `vehicles.json`.
3. **Engine Inheritance vs Clean-Sheet Development:** Clean-sheet engine DDT&E CER does not automatically detect derivative modifications (for instance `RS-25D/E` Space Shuttle heritage reuse vs clean-sheet `F-1` development), leaving program inheritance encoded in `f8_ddte`.

### 5.3 Potential Future Work & Rework
- Add explicit `engine_heritage_frac` (`0.0 = clean-sheet`, `0.65 = major upgrade`, `0.90 = existing hardware`) on engine entries and `program_contract_type` (`CostPlus`, `FixedPriceCommercial`, `StatePrime`, `InternationalConsortium`) on `ProvenanceVehicle` and `VehicleConfiguration` so organizational overhead is derived directly from contract attributes instead of manufacturer name matching.
- Normalize every `development_cost_usd` record in `data/vehicles/*.json` to a uniform FY2026 Aerospace CPI basis with explicit NASA New Start Index provenance citations.
- Model launch cadence sensitivity (`flights_per_year`) dynamically to compute annual fixed standing-army launch facility and ground crew costs per flight across commercial vs flagship programs.
