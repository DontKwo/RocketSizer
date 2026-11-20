# Launch Vehicle Model Validation and Engineering Reference

This document provides mathematical formulations, validation methodologies, historical comparison data, and engineering justifications for the numerical models in RocketSizer. All solvers reside in `src-tauri/src/core/` and execute in SI units (kilograms, meters, seconds, newtons, pascals, Kelvin, and FY2026 USD).

---

## 1. Executive Summary

RocketSizer implements physics-based, bottom-up engineering models to size multi-stage launch vehicles, estimate structural masses, compute development and flight costs, simulate ascent trajectories, and pack clustered engine bases.

To verify accuracy, all core models are benchmarked against historical flight programs in an automated test suite (`src-tauri/tests/benchmark_suite.rs`). Across 16 diverse flight-proven launch systems ranging from Electron (13 metric tons GLOW) to Saturn V and Starship (3,000 to 5,000 metric tons GLOW):
- Bottom-up structural mass estimation achieves a Mean Absolute Percentage Error (MAPE) of **14.49%** against actual flight hardware empty masses.
- Parametric launch cost estimation achieves a MAPE of **1.58%** against FY2026 inflation-adjusted commercial market launch prices.
- Non-recurring DDT&E estimation achieves a MAPE of **5.81%** against reported vehicle development budgets.
- All 7 built-in vehicle presets (Saturn V, Falcon 9 Block 5, Electron, SLS Block 1, Vulcan Centaur VC6L, New Glenn, and Starship) evaluate as **100% feasible** with zero constraint violations.

---

## 2. Mathematical Models and Governing Equations

### 2.1 Multi-Stage Rocket Equation and Staging Closure (`staging.rs`)

Multi-stage sizing proceeds top-down from the payload and fairing back to Stage 1. For stage $i$ carrying total upper mass $m_{\text{above}}$ with target delta-V $\Delta v_i$, effective vacuum specific impulse $I_{\text{sp},i}$, and structural coefficient $k_i = m_{\text{dry},i,\text{margined}} / m_{\text{prop},i}$:

$$c_{\text{eff}, i} = I_{\text{sp}, i} g_0, \qquad MR_i = \exp\left(\frac{\Delta v_i}{c_{\text{eff}, i}}\right)$$

The theoretical maximum mass ratio before payload capacity drops to zero is:

$$MR_{\max, i} = \frac{1 + k_i}{k_i}$$

For an expendable stage, propellant mass closes analytically when $MR_i < MR_{\max, i}$:

$$m_{\text{prop}, i} = m_{\text{above}} \frac{MR_i - 1}{1 - k_i (MR_i - 1)}$$

When recovery is active (Autonomous Spaceport Drone Ship ASDS, Return To Launch Site RTLS, or Parachute Mid-Air Catch), recovery hardware mass and recovery propellant reserves are allocated. The recovery propellant reserve (7.5% for ASDS, 14.0% for RTLS, 0.5% for parachute RCS) remains as inert mass during ascent burnout and is excluded from ascent delta-V:

$$m_{\text{burnout}, i} = m_{\text{above}} + m_{\text{dry}, i} + m_{\text{reserve}, i}$$

#### Parallel Strap-On Boosters
When Stage 1 utilizes $N_b$ parallel solid or liquid strap-on boosters with burn time $t_b$, the flight splits into two phases:
1. **Boost Phase ($0 \le t \le t_b$):** Core engines burn alongside boosters. Combined mass-flow-weighted specific impulse is:

$$I_{\text{sp,boost\_eff}} = \frac{\dot{m}_{\text{boost}} I_{\text{sp,boost}} + \dot{m}_{\text{core}} I_{\text{sp,core}}}{\dot{m}_{\text{boost}} + \dot{m}_{\text{core}}}$$

2. **Core Sustainer Phase ($t > t_b$):** Booster empty inert mass separates at $t_b$. Core propellant consumed during boost phase is subtracted, and a 52-step bisection solver determines the exact core propellant mass required to meet the remaining Stage 1 delta-V target.

---

### 2.2 Bottom-Up 19-Subsystem Structural Mass Estimator (`structures.rs`)

Rather than relying on fixed empirical mass fractions, un-overridden stages calculate physical component masses using closed-form structural mechanics. A 4-iteration damped fixed-point loop ($k_{n+1} = 0.45 k_n + 0.55 k_{\text{phys}}(1 + f_{\text{margin}})$) converges structural dimensions with propellant volume and stack loads.

#### Propellant Tank Geometry
For stage radius $R$ and tank volume $V_{\text{tank}}$ (including 3% ullage), 2:1 ellipsoidal domes have height $h_{\text{dome}} = 0.5 R$ and volume $V_{\text{dome}} = \frac{1}{3}\pi R^3$. The cylindrical barrel length is:

$$L_{\text{barrel}} = \max\left(0, \, \frac{V_{\text{tank}} - 2 V_{\text{dome}}}{\pi R^2}\right)$$

#### Pressure Vessel Sizing (Hoop Stress and Hydrostatic Head)
Design pressure combines ullage pressure $P_{\text{ullage}}$ and peak acceleration hydrostatic head:

$$P_{\text{tot}} = P_{\text{ullage}} + \rho_{\text{prop}} (n_{\max} g_0) h_{\text{eff}}$$

where $h_{\text{eff}} = f_{\text{hydro}} (L_{\text{barrel}} + 2 h_{\text{dome}})$. Sizing follows Barlow thin-wall pressure vessel equations with burst safety factor $\mathrm{SF}_{\text{burst}} = 1.25$ and material allowable tensile stress $\sigma_{\text{allow}}$:

$$t_{\text{pressure}} = \mathrm{SF}_{\text{burst}} \frac{P_{\text{tot}} R}{\sigma_{\text{allow}} - 0.6 P_{\text{tot}}}$$

Wall thickness is bounded by minimum manufacturing gauge ($t_{\min,\text{eff}} = 2.45\text{ mm}$ for CNC-milled Al-Li/Titanium orthogrids, $0.80\text{ mm}$ for rolled 304L stainless steel).

#### Axial Compressive Cylinder Buckling (NASA SP-8007)
Under peak acceleration $n_{\max}$ and aerodynamic bending multiplier $k_{\text{bend}} = 1 + 0.03 (L_{\text{tanks}} / D)$, compressive axial stress is relieved by internal ullage pressure (55% pressure stabilization credit):

$$\sigma_{\text{axial}} = \frac{(m_{\text{above}} + 0.35 m_{\text{prop}}) n_{\max} g_0 \, k_{\text{bend}}}{2\pi R \, t}$$

$$\sigma_{\text{net}} = \max\left(0, \, \sigma_{\text{axial}} - 0.55 \frac{P_{\text{ullage}} R}{2 t}\right)$$

Classical buckling critical stress with empirical knock-down factor $\gamma_{\text{knock}}$ is:

$$\sigma_{\text{cr}} = \gamma_{\text{knock}} \frac{E}{\sqrt{3(1 - \nu^2)}} \frac{t}{R}$$

When $\sigma_{\text{net}} > \sigma_{\text{cr}}$, integral orthogrid stiffening mass is added via multiplier $k_{\text{stiff}} = \mathrm{clamp}(1 + s(\sigma_{\text{net}}/\sigma_{\text{cr}} - 1), 1.0, k_{\max})$.

#### Stiffened Skirts and Interstages (Farrar Wide-Column Method)
Unpressurized forward skirts, aft skirts, and interstages carry axial line load $N_x = \frac{(m_{\text{above}} + 0.8 m_{\text{prop}}) n_{\max} g_0}{2\pi R}$. Equivalent smeared thickness sizes to Farrar minimum-weight ring-and-stringer buckling:

$$t_{\text{eq,skirt}} = \max\left(1.15 \sqrt{\frac{N_x L_{\text{frame}}}{E}}, \, \frac{N_x}{0.65 \sigma_y}, \, 1.45 \, t_{\min}\right)$$

where frame spacing $L_{\text{frame}} = 0.55 + 0.12 R$.

#### 19-Subsystem Inventory
Every stage accounts for 19 discrete subsystem items:
1. LOX Tank Barrel
2. Fuel Tank Barrel
3. Tank Domes and Bulkheads (2:1 ellipsoids, common or separate)
4. Baffles and Slosh Suppression
5. Forward Skirt
6. Aft Skirt and Base Heat Shield
7. Intertank Structure (or attach reaction beam for strap-ons)
8. Interstage Adapter and Separation Hardware
9. Thrust Structure (load path cones/trusses sizing to vacuum thrust and diameter)
10. Propellant Feedlines, Valves, and Downcomers
11. Pressurization System (Helium COPV bottles or autogenous heat exchangers)
12. Thermal Protection and Cryogenic Insulation (SOFI / MLI)
13. TVC Actuators and RCS Hardware
14. Avionics, Guidance, Telemetry, and Cable Raceways
15. Payload Adapter Cone (uppermost stage only)
16. Mechanical Fasteners and Joint Flanges (5.5% of primary structures)
17. Solid Motor Case and Submerged Nozzle (for solid propulsion stages)
18. Installed Engine Dry Mass
19. Recovery Hardware and Strap-On Separation Allocation

Mass Growth Allowance (MGA) adds 25% contingency (`mass_margin_frac = 0.25`) by default, following AIAA S-020 and NASA SP-8110 guidelines.

---

### 2.3 Cost Estimating Relationships (`cost_engine.rs`)

Cost calculations use statistical Cost Estimating Relationships (CERs) derived from TRANSCOST 8.2 and NASA PCEC/NAFCOM, calibrated to FY2026 USD.

#### Airframe and Engine DDT&E
Non-recurring development cost separates stage airframes from propulsion hardware:

$$\text{DDT\&E}_{\text{air}, i} = \$1,150,000 \cdot (m_{\text{air}, i})^{0.55} \cdot f_{\text{comp}} \cdot f_{\text{mat}} \cdot f_{\text{prop}} \cdot f_{\text{reuse}} \cdot I_{\text{infl}}$$

$$\text{DDT\&E}_{\text{eng}} = \$2,550,000 \cdot \left(\frac{F_{\text{vac}}}{1000\text{ N}}\right)^{0.535} \cdot (P_{c,\text{bar}})^{0.21} \cdot f_{\text{cycle}} \cdot f_{\text{prop}} \cdot I_{\text{infl}}$$

Cycle complexity multipliers ($f_{\text{cycle}}$) reflect real manufacturing hurdles: Pressure-Fed 0.40, Electric-Pump 0.55, Gas Generator 1.00, Expander 1.35, Staged Combustion 1.75, Full-Flow Staged Combustion 2.20.

#### Theoretical First Unit (TFU) and Wright Learning Curves
Hardware manufacturing costs scale from bare airframe mass and engine thrust:

$$\text{TFU}_{\text{air}, i} = \$18,500 \cdot (m_{\text{air}, i})^{0.62} \cdot f_{\text{mat}} \cdot f_{\text{prop}} \cdot I_{\text{infl}}$$

$$\text{TFU}_{\text{eng}} = \$42,000 \cdot (F_{\text{vac,kN}})^{0.485} \cdot (P_{c,\text{bar}})^{0.18} \cdot f_{\text{cycle}} \cdot f_{\text{prop}} \cdot I_{\text{infl}}$$

For cumulative production quantity $Q$ at learning rate $LR = 0.85$ ($p = \ln(LR) / \ln(2) = -0.2345$):

$$C_{\text{avg}}(Q) = \text{TFU} \cdot \frac{Q^p}{1 + p}$$

#### Reusable Amortization and Commercial Market Pricing
Internal recurring flight cost amortizes recoverable stages over $N_{\text{reuse}}$ flights, adding refurbishment (8% for methane/hydrogen, 15% for kerolox) and recovery recovery ops ($450,000 per stage). Recoverable fairings amortize at 20% replacement cost plus $350,000 recovery operations.

Commercial market launch price accounts for internal marginal flight cost, payload mission integration / Systems Engineering and Project Management (SEPM), commercial gross margin, and corporate R&D recovery:

$$\text{SEPM} = 0.14 \, C_{\text{avg,hw}} \left(1 + 0.08(N_{\text{stages}} - 1) + 0.04 N_{\text{boosters}}\right)$$

$$P_{\text{market}} = 1.35 \, C_{\text{flight}} + \text{SEPM} + 0.08 \frac{\text{DDT\&E}}{\max(12, \, Q \cdot N_{\text{reuse}}^{0.35})}$$

TRANSCOST organizational efficiency factors ($f_8$) scale prices across commercial startups ($f_8 \approx 1.6$), high-volume reusable operators ($f_8 \approx 4.3$ market pricing vs internal cost), aerospace primes ($f_8 \approx 2.0 - 5.0$), and government cost-plus programs ($f_8 \approx 3.5 - 5.3$).

---

### 2.4 Ascent Trajectory and Delta-V Loss Integrator (`physics.rs`)

Orbital velocity for target perigee $r_p$ and apogee $r_a$ is:

$$v_{\text{orbit}} = \sqrt{\mu_E \left(\frac{2}{r_p} - \frac{1}{a}\right)}$$

Total required ascent delta-V incorporates rotational assist and dynamic flight losses:

$$\Delta v_{\text{req}} = (v_{\text{orbit}} + \Delta v_{\text{grav}} + \Delta v_{\text{drag}} + \Delta v_{\text{steer}} - \Delta v_{\text{rot}} + \Delta v_{\text{ullage}}) (1 + f_{\text{dv\_margin}})$$

1. **Earth Rotation Credit:** $\Delta v_{\text{rot}} = (\omega_E R_E) \cos(\phi) \sin(Az)$ where $\phi$ is launch latitude and $Az$ is launch azimuth.
2. **Gravity Loss:** $\Delta v_{\text{grav}} = \int_0^{t_{\text{burn}}} g(h) \sin(\theta(t)) \, dt$, where pitch angle $\theta(t)$ follows a pitchover trajectory tuned to liftoff thrust-to-weight ratio.
3. **Aerodynamic Drag Loss:** $\Delta v_{\text{drag}} = \int_0^{t_{\text{burn}}} \frac{q(t) C_d(M) A_{\text{ref}}}{m(t)} \, dt$, incorporating transonic drag divergence across Mach 0.8 to 1.4.
4. **Steering and Plane-Change Losses:** Out-of-plane dogleg steering penalty $\Delta v_{\text{plane}} = 2 v_{\text{orbit}} \sin\left(\frac{|\phi| - |i|}{2}\right)$ when orbit inclination $|i| < |\phi|$.

---

### 2.5 2D Engine Base Circle Packing (`packaging.rs`)

The base packaging solver verifies whether $N_{\text{eng}}$ engines fit inside the stage base. The available clearance diameter inside skirt wall thickness $t_{\text{skirt}}$ and boundary margin $\delta_{\text{skirt}}$ is:

$$D_{\text{usable}} = D_{\text{stage}} - 2(t_{\text{skirt}} + \delta_{\text{skirt}})$$

Each engine requires an operational footprint diameter accounting for nozzle exit diameter $D_{\text{nozzle}}$, thrust vector control (TVC) gimbal deflection $\theta_{\text{TVC}}$, actuator moment arm $L_{\text{gimbal}}$, and nozzle-to-nozzle thermal clearance $\delta_{\text{gap}}$:

$$D_{\text{footprint}} = D_{\text{nozzle}} + 2 L_{\text{gimbal}} \sin(\theta_{\text{TVC}}) + \delta_{\text{gap}}$$

The solver generates geometric layouts (Pattern A: Single center; Pattern B: Single ring 2 to 4; Pattern C: 1 center + outer ring; Pattern D: Multi-ring dense clusters such as 1+6+12 or 3+10+20 for 33 engines) and relaxes engine positions using a constrained Nelder-Mead geometric optimizer to maximize inter-nozzle clearances while guaranteeing no engine crosses $D_{\text{usable}}$.

---

### 2.6 Rubber Engine Scaling (`rubber_engine.rs`)

When scaling a reference engine to a new thrust $T_{\text{target}}$ and chamber pressure $P_{c,\text{target}}$:

$$m_{\text{dry}} = m_{\text{ref}} \left(\frac{T}{T_{\text{ref}}}\right)^{0.82} \left(\frac{P_c}{P_{c,\text{ref}}}\right)^{-0.15}$$

$$I_{\text{sp,vac}} = I_{\text{sp,ref}} \left(1 + 0.012 \ln\left(\frac{P_c}{P_{c,\text{ref}}}\right)\right)$$

$$D_{\text{nozzle}} = D_{\text{nozzle,ref}} \sqrt{\frac{T}{T_{\text{ref}}}} \left(\frac{P_{c,\text{ref}}}{P_c}\right)^{0.25}$$

Higher chamber pressure reduces turbomachinery and combustion chamber volume, increasing thrust-to-weight and vacuum specific impulse.

---

## 3. Heritage Vehicle Validation Data

To validate the numerical models, predictions were compared directly against published flight specifications for 16 operational or flight-proven launch vehicles. Data sources include NASA flight evaluation reports, ESA user manuals, and manufacturer specifications.

### 3.1 Structural Mass Estimation Validation (`test_benchmark_12`)

Comparison between actual flight hardware dry masses (unmargined empty stage masses) and predictions from the 19-subsystem structural estimator:

| Heritage Vehicle | Stage 1 Actual (kg) | Stage 1 Pred (kg) | S1 Error | Stage 2 Actual (kg) | Stage 2 Pred (kg) | S2 Error | Total Dry Actual (kg) | Total Dry Pred (kg) | Total Dry Error |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Electron** | 950 | 875 | -7.9% | 250 | 231 | -7.5% | 1,550 | 1,266 | -18.3% |
| **Falcon 1** | 2,200 | 1,858 | -15.6% | 550 | 488 | -11.3% | 2,900 | 2,505 | -13.6% |
| **Vega** | 7,330 | 9,094 | +24.1% | 1,950 | 2,655 | +36.2% | 19,800 | 18,291 | -7.6% |
| **Soyuz-2** | 6,545 | 6,464 | -1.2% | 2,355 | 1,614 | -31.5% | 27,500 | 26,661 | -3.0% |
| **Falcon 9 FT** | 22,200 | 19,191 | -13.6% | 4,000 | 3,223 | -19.4% | 29,900 | 24,140 | -19.3% |
| **Falcon Heavy** | 22,200 | 21,038 | -5.2% | 4,000 | 3,605 | -9.9% | 73,000 | 63,426 | -13.1% |
| **Atlas V 401** | 21,054 | 14,803 | -29.7% | 2,247 | 2,126 | -5.4% | 23,300 | 18,206 | -21.9% |
| **Vulcan Centaur VC6L** | 29,000 | 21,522 | -25.8% | 5,100 | 4,749 | -6.9% | 59,000 | 65,185 | +10.5% |
| **Ariane 5 ECA** | 14,700 | 16,040 | +9.1% | 4,540 | 3,317 | -26.9% | 99,100 | 96,083 | -3.0% |
| **Proton-M** | 30,600 | 26,397 | -13.7% | 11,715 | 9,606 | -18.0% | 55,800 | 42,531 | -23.8% |
| **Delta IV Heavy** | 26,400 | 21,608 | -18.2% | 3,490 | 3,443 | -1.4% | 88,200 | 66,088 | -25.1% |
| **H-IIA 202** | 12,500 | 10,007 | -19.9% | 3,100 | 2,562 | -17.4% | 31,000 | 34,235 | +10.4% |
| **Long March 5** | 18,500 | 14,004 | -24.3% | 3,500 | 3,401 | -2.8% | 82,000 | 51,577 | -37.1% |
| **Saturn V** | 130,000 | 127,561 | -1.9% | 36,000 | 36,216 | +0.6% | 195,000 | 181,292 | -7.0% |
| **SLS Block 1** | 85,275 | 80,961 | -5.1% | 3,490 | 3,542 | +1.5% | 308,000 | 282,470 | -8.3% |
| **Starship / Super Heavy** | 200,000 | 254,284 | +27.1% | 100,000 | 75,185 | -24.8% | 300,000 | 329,469 | +9.8% |
| **16-Vehicle MAPE** | - | - | **15.2%** | - | - | **14.2%** | - | - | **14.49%** |

The 16-vehicle benchmark structural MAPE of **14.49%** confirms that the bottom-up structural model accurately tracks airframe dry mass across four orders of magnitude in vehicle size.

---

### 3.2 Recurring Launch Cost and DDT&E Validation (`test_benchmark_13`)

Comparison between actual reported commercial launch prices, development costs (adjusted to FY2026 USD), and model predictions:

| Heritage Vehicle | Actual Flight Price ($M) | Pred Flight Price ($M) | Flight Error | Actual DDT&E ($M) | Pred DDT&E ($M) | DDT&E Error |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Electron** | $7.9M | $7.8M | -1.0% | $100.0M | $96.3M | -3.7% |
| **Falcon 1** | $11.8M | $11.7M | -1.1% | $90.0M | $115.5M | +28.3% |
| **Vega** | $46.5M | $45.7M | -1.7% | $950.0M | $961.4M | +1.2% |
| **Soyuz-2** | $58.0M | $54.9M | -5.3% | $1,500.0M | $1,457.4M | -2.8% |
| **Falcon 9 FT** | $70.0M | $71.0M | +1.4% | $390.0M | $414.1M | +6.2% |
| **Falcon Heavy** | $156.0M | $152.6M | -2.2% | $500.0M | $495.1M | -1.0% |
| **Atlas V 401** | $137.0M | $135.3M | -1.2% | $2,200.0M | $2,009.9M | -8.6% |
| **Vulcan Centaur VC6L** | $158.8M | $160.2M | +0.8% | $2,500.0M | $2,350.9M | -6.0% |
| **Ariane 5 ECA** | $212.0M | $211.8M | -0.1% | $8,200.0M | $7,688.2M | -6.2% |
| **Proton-M** | $86.0M | $89.2M | +3.7% | $2,100.0M | $1,911.5M | -9.0% |
| **Delta IV Heavy** | $420.0M | $418.1M | -0.5% | $4,500.0M | $4,461.5M | -0.9% |
| **H-IIA 202** | $111.8M | $110.5M | -1.2% | $1,500.0M | $1,497.4M | -0.2% |
| **Long March 5** | $164.8M | $161.7M | -1.9% | $4,500.0M | $4,192.6M | -6.8% |
| **KSLV-II Nuri** | $63.3M | $62.6M | -1.2% | $1,500.0M | $1,543.7M | +2.9% |
| **Saturn V** | $1,520.0M | $1,544.4M | +1.6% | $6,417.0M | $6,275.7M | -2.2% |
| **SLS Block 1** | $2,500.0M | $2,511.2M | +0.4% | $23,800.0M | $22,119.5M | -7.1% |
| **16-Vehicle MAPE** | - | - | **1.58%** | - | - | **5.81%** |

Launch price estimation achieves a MAPE of **1.58%**, while development cost estimation achieves a MAPE of **5.81%**.

---

### 3.3 Built-In Preset Vehicles Feasibility (`test_benchmark_14`)

All 7 pre-configured architectures evaluate with full numerical closure and zero constraint violations:

| Preset Vehicle | Target Orbit | Payload (kg) | Stages | Boosters | Sized GLOW (t) | Req dV (m/s) | Deliv dV (m/s) | Feasible | Violations |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Saturn V** | LEO (185 km) | 118,000 | 3 | 0 | 2,933 t | 9,175 | 9,176 | Yes | 0 |
| **Falcon 9 Block 5** | LEO (185 km) | 17,500 | 2 | 0 | 549 t | 9,050 | 9,052 | Yes | 0 |
| **Electron** | SSO (500 km) | 300 | 2 | 0 | 12.8 t | 9,420 | 9,421 | Yes | 0 |
| **SLS Block 1** | LEO (185 km) | 95,000 | 2 | 2 (Solid) | 2,610 t | 9,180 | 9,182 | Yes | 0 |
| **Vulcan Centaur VC6L** | LEO (185 km) | 27,200 | 2 | 6 (Solid) | 557 t | 9,160 | 9,161 | Yes | 0 |
| **New Glenn** | LEO (185 km) | 45,000 | 2 | 0 | 1,460 t | 9,150 | 9,152 | Yes | 0 |
| **Starship / Super Heavy** | LEO (185 km) | 150,000 | 2 | 0 | 5,038 t | 9,200 | 9,203 | Yes | 0 |

---

## 4. Engineering Assumptions and Justifications

1. **2:1 Ellipsoidal Dome Geometry:**
   - *Justification:* Standard profile across Saturn V, Space Shuttle External Tank, SLS, and Falcon 9. Balances internal volume against knuckle hoop stress concentrations.
2. **Pressure-Stabilized Cylinder Buckling (55% Credit):**
   - *Justification:* Maintaining 45% margin of uncredited pressurization ensures the vehicle withstands maximum dynamic pressure aerodynamic bending and ground wind gusts even during tank regulator transients.
3. **Smeared Minimum Shell Thickness (2.45 mm for Al-Li / Ti orthogrids):**
   - *Justification:* Chemical or CNC pocket milling produces thin membrane skins (~1.2 mm), while integral stringers, circumferential rings, and weld lands raise average smeared areal density to the equivalent of 2.45 mm.
4. **Distinction Between Internal Marginal Flight Cost and Commercial List Price:**
   - *Justification:* Commercial launch providers sell launches at list prices above internal marginal costs to recover non-recurring R&D, pay launch insurance, fund mission integration (SEPM), and retain corporate profit. Modeling both values resolves historical discrepancies between public SpaceX pricing ($67M to $70M) and reported internal booster operating costs (~$15M to $25M).

---

## 5. Model Limitations and Planned Improvements

1. **Third and Fourth Stage Metadata Representation:**
   - *Current Limitation:* The catalog schema records detailed stage masses for Stage 1, Stage 2, and Strap-On Boosters. For 3+ stage rockets (Proton-M, Vega, Saturn V S-IVB), upper kick stage masses are reconstructed by GLOW mass balance.
   - *Planned Improvement:* Expand the database schema with explicit Stage 3 and Stage 4 records.
2. **2-DOF Point-Mass Trajectory Integration:**
   - *Current Limitation:* Ascent simulation models a 2-DOF gravity turn with aerodynamic drag and pitch schedule. It does not compute 3D cross-track steering or aeroelastic structural flexing.
   - *Planned Improvement:* Integrate 3-DOF closed-loop Linear Tangent Guidance (LTG) coupled with structural bending moment distribution curves along the vehicle station lines.
3. **Clean-Sheet Engine Development vs Derivative Upgrades:**
   - *Current Limitation:* Engine DDT&E CERs assume clean-sheet development unless modified by organizational factors. Derivative engines (such as RS-25D upgrades for SLS or Merlin 1D upgrades from 1C) have lower qualification budgets than clean-sheet designs.
   - *Planned Improvement:* Add an explicit engine heritage fraction parameter to scale engine DDT&E directly based on heritage reuse.

---

## 6. References and Data Sources

1. Koelle, D. E., *TRANSCOST: Statistical-Analytical Model for Cost Estimation and Economical Optimization of Space Transportation Systems*, Edition 8.2, TransCostSystems, 2013.
2. NASA SP-8007, *Buckling of Thin-Walled Circular Cylinders*, NASA Space Vehicle Design Criteria (Structures), August 1968.
3. NASA Johnson Space Center, *NASA Project Cost Estimating Capability (PCEC) User Guide*, 2019.
4. Larson, W. J., and Wertz, J. R., *Space Mission Analysis and Design (SMAD)*, 3rd Edition, Microcosm Press / Springer, 1999.
5. Humble, R. W., Henry, G. N., and Larson, W. J., *Space Propulsion Analysis and Design*, McGraw-Hill, 1995.
6. SpaceX, *Falcon 9 Launch Vehicle Payload User's Guide*, Rev 2.0, 2020.
7. United Launch Alliance, *Vulcan Launch System User's Guide*, Rev 1.0, 2023.
8. NASA Marshall Space Flight Center, *Saturn V Flight Evaluation Report - AS-506 Apollo 11 Mission*, MPR-SAT-FE-69-3, September 1969.
9. NASA, *Space Launch System (SLS) Mission Planner's Guide*, ESD 30000, 2018.
10. Arianespace, *Ariane 5 User's Manual*, Issue 5, Revision 2, 2016.
