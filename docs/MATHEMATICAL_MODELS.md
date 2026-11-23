# Launch Vehicle Mathematical & Structural Engineering Models

All numerical physics, structural sizing, trajectory integration, and optimization solvers live in `src-tauri/src/core/` and compute strictly in SI units (kilograms, meters, seconds, newtons, pascals, Kelvin, and FY2026 USD) prior to unit-system or currency display conversion.

---

## 1. Orbital Mechanics & Ascent Delta-V Budget (`physics.rs`)

### 1.1 Vis-Viva Elliptical & Circular Orbital Velocity
For target perigee altitude $h_p = \max(h_{\text{perigee}}, 80\text{ km})$ and apogee altitude $h_a \ge h_p$ above Earth mean equatorial radius $R_E = 6,378,137\text{ m}$ with $\mu_E = 3.986004418 \times 10^{14}\text{ m}^3/\text{s}^2$:

$$r_p = R_E + h_p, \qquad r_a = R_E + h_a, \qquad a = \frac{r_p + r_a}{2}, \qquad e = \frac{r_a - r_p}{r_a + r_p}$$

$$v_{\text{orbit}} = \sqrt{\mu_E \left(\frac{2}{r_p} - \frac{1}{a}\right)}$$

### 1.2 Launch Site Rotational Assist & Plane-Change Penalty
Given launch site latitude $\phi$ and target orbit inclination $i$:
- When $|i| \ge |\phi|$: achievable inertial azimuth is $\sin(Az) = \mathrm{clamp}(\cos(i) / \cos(\phi), -1, 1)$ with zero dogleg plane change ($\Delta v_{\text{plane}} = 0$).
- When $|i| < |\phi|$: minimum dogleg azimuth is $Az = 90^\circ$ plus an out-of-plane dogleg penalty $\Delta v_{\text{plane}} = 2 v_{\text{orbit}} \sin\left(\frac{|\phi| - |i|}{2}\right)$.
- Earth rotation velocity credit is:

$$\Delta v_{\text{rot}} = (\omega_E R_E) \cos(\phi) \sin(Az), \qquad \omega_E = 7.2921159 \times 10^{-5}\text{ rad/s}$$

### 1.3 Integrated Ascent Loss Terms & Vehicle-Coupled Refinement
For custom orbits (or refined preset evaluations via `refine_delta_v_budget_for_vehicle`):
- **Gravity Loss:** $\Delta v_{\text{grav}} \approx g_0 \sum_k t_{\text{eff}, k} \sin(\bar{\theta}_k)$, where first-stage effective pitch tracks liftoff thrust-to-weight $\bar{\theta}_1 = \mathrm{clamp}(58^\circ - 10^\circ((T/W)_0 - 1.25), 38^\circ, 62^\circ)$ and $t_{\text{eff}, 1} = 0.72 \, t_{\text{burn}, 1}$.
- **Aerodynamic Drag Loss:** $\Delta v_{\text{drag}} = \frac{q_{\max Q} \, C_{d0} \, A_{\text{ref}} \, t_{\text{transonic}}}{0.72 \, m_0}$, refined using vehicle ballistic coefficient $W / (C_{d0} A_{\text{ref}})$.
- **Steering Loss:** $\Delta v_{\text{steer}} = v_{\text{orbit}} (1 - \cos(11^\circ)) + \Delta v_{\text{plane}}$.
- **Staging & Ullage Settling Loss:** configurable via `cold_sep_ullage_s` and stage transition count (`staging_ullage_loss_m_s`).
- **Total Required Delta-V:**

$$\Delta v_{\text{req}} = \left( v_{\text{orbit}} + \Delta v_{\text{margin}} + \Delta v_{\text{grav}} + \Delta v_{\text{drag}} + \Delta v_{\text{steer}} - \Delta v_{\text{rot}} + \Delta v_{\text{ullage}} \right) (1 + f_{\text{dv\_margin}})$$

---

## 2. Multi-Stage Rocket Equation & Parallel Strap-On Boosters (`staging.rs`)

Stages are sized **top-down** from the payload and fairing back to Stage 1 (`m_above` accumulates each completed stage mass plus fairing on the top stage).

### 2.1 Single Stage Tsiolkovsky Closure
For stage $i$ carrying mass $m_{\text{above}}$ with target $\Delta v_i$, effective specific impulse $I_{\text{sp},i}$, and structural coefficient $k_i = \frac{m_{\text{dry},i,\text{margined}}}{m_{\text{prop},i}}$:

$$c_{\text{eff}, i} = I_{\text{sp}, i} g_0, \qquad MR_i = \exp\!\left(\frac{\Delta v_i}{c_{\text{eff}, i}}\right), \qquad MR_{\max, i} = \frac{1}{1 - \mathrm{PMF}_i} = \frac{1 + k_i}{k_i}$$

Requiring $MR_i < MR_{\max, i}$ guarantees strictly positive denominator closure:

$$m_{\text{prop}, i} = m_{\text{above}} \, \frac{MR_i - 1}{1 - k_i (MR_i - 1)} \quad \text{(when expendable, adjusted iteratively for recovery)}$$

### 2.2 Propulsive & Aerodynamic Stage Recovery
When recovery mode is enabled on a stage (`ASDS`, `RTLS`, or `Parachute Mid-Air Catch`), `staging.rs` allocates both **recovery hardware mass** (landing legs, grid fins, TPS, or parafoil/bridle as a fraction of unmargined dry structure) and **recovery propellant reserve** (`7.5%` ASDS, `14.0%` RTLS, `0.5%` parachute RCS) which stays as non-ascendant inert mass during ascent burnout and is excluded from the ascent delta-V propellant budget.

### 2.3 Parallel Strap-On Boosters (Stage 0 / Core Phase Split)
When Stage 1 employs $N_b$ solid or liquid strap-on boosters operating for duration $t_{b}$, total Stage 1 liftoff mass is $m_0 = m_{\text{above}} + m_{\text{prop,core}} + m_{\text{inert,core}} + m_{\text{prop,boost}} + m_{\text{inert,boost}}$:
1. **Boost Phase (0 to $t_b$):** Core engines consume $m_{\text{burn,core}} = \dot{m}_{\text{core}} t_b$ alongside full booster propellant $m_{\text{prop,boost}}$. Effective combined specific impulse is mass-flow weighted:

$$I_{\text{sp,boost\_eff}} = \frac{\dot{m}_{\text{boost}} I_{\text{sp,boost}} + \dot{m}_{\text{core,bucket}} I_{\text{sp,core,bucket}}}{\dot{m}_{\text{boost}} + \dot{m}_{\text{core,bucket}}}$$

2. **Booster Jettison:** Actual unmargined booster inert mass $m_{\text{inert,boost,real}}$ separates at $t_b$, stepping core-alone start mass down to $m_{0,\text{core}} = m_0 - m_{\text{burn,core}} - m_{\text{prop,boost}} - m_{\text{inert,boost,real}}$.
3. **Core Sustainer Phase:** A 52-step bisection solver finds exact $m_{\text{prop,core}}$ such that $\Delta v_{\text{boost}} + \Delta v_{\text{core}} = \Delta v_{1,\text{target}}$.

---

## 3. Bottom-Up 19-Subsystem Structural Mass Estimator (`structures.rs`)

Instead of fixed mass-fraction tables, every un-overridden stage invokes `estimate_stage_structural_breakdown` inside a 4-iteration damped fixed-point loop (`k_next = 0.45 * k_prev + 0.55 * k_phys * (1 + mass_margin_frac)`), converging physical wall thicknesses, axial buckling stiffeners, skirts, and subsystem masses directly with propellant mass and stacked above-stage loads.

### 3.1 Tank Volume & Dome Geometry
Using propellant mixture ratio $O/F$ (from the stage engine) and bulk/component densities $(\rho_{\text{ox}}, \rho_{\text{fuel}})$ with ullage allowance $f_u = 0.03$ (`1 + f_u` tank volume expansion) and sphere-equivalent `2:1` ellipsoidal domes ($h_{\text{dome}} = 0.5 R$, $V_{\text{dome}} = \frac{1}{3}\pi R^3$):

$$L_{\text{barrel}} = \max\!\left(0, \frac{V_{\text{tank}} - 2 V_{\text{dome}}}{\pi R^2}\right), \qquad L_{\text{tanks}} = L_{\text{ox}} + L_{\text{fuel}} + N_{\text{domes}} h_{\text{dome}}$$

where $N_{\text{domes}} = 3$ for common-bulkhead designs and $N_{\text{domes}} = 4$ for separate tanks.

### 3.2 Thin-Wall Hoop Pressure + Hydrostatic Head
Cryogenic design allowable stress weights room-temperature yield $\sigma_{y,293\text{K}}$ and cryogenic yield $\sigma_{y,\text{cryo}}$ (`0.30 / 0.70` standard cryo; `0.10 / 0.90` subcooled cold-worked Stainless 304L). Stepped-plate hydrostatic head averages $h_{\text{eff}} = f_{\text{hydro}} (L_{\text{barrel}} + 2 h_{\text{dome}})$ ($f_{\text{hydro}} = 0.62$ for milled orthogrid billet plates; $0.46$ for rolled welded 304L rings):

$$P_{\text{tot}} = P_{\text{ullage}} + \rho_{\text{prop}} (n_{\max} g_0) h_{\text{eff}}, \qquad t = \max\!\left(t_{\min,\text{eff}}, \, \mathrm{SF}_{\text{burst}} \frac{P_{\text{tot}} R}{\sigma_{\text{allow}} - 0.6 P_{\text{tot}}}\right)$$

For CNC-milled `AlLi2195` and `TitaniumTi6Al4V` tanks, $t_{\min,\text{eff}} = \max(t_{\min,\text{pocket}}, 2.45\text{ mm})$ captures the smeared floor skin plus integral orthogrid/isogrid rib and T-ring frame mass. Rolled `Stainless304L` retains $0.80\text{ mm}$ minimum sheet gauge.

### 3.3 Axial Cylinder Buckling (Roark / NASA SP-8007) & Internal Stabilization
Under peak acceleration $n_{\max}$ and fineness bending multiplier $k_{\text{bend}} = 1 + 0.03 (L_{\text{tanks}} / D)$, compressive line loads act on the unpressurized/partially pressurized cylinder with conservative $55\%$ internal ullage pressure stabilization credit:

$$\sigma_{\text{axial}} = \frac{(m_{\text{above}} + 0.35 m_{\text{prop}}) n_{\max} g_0 \, k_{\text{bend}}}{2\pi R \, t}, \qquad \sigma_{\text{net}} = \max\!\left(0, \, \sigma_{\text{axial}} - 0.55 \frac{P_{\text{ullage}} R}{2 t}\right)$$

$$\sigma_{\text{cr}} = \gamma_{\text{knock}} \frac{E}{\sqrt{3(1 - \nu^2)}} \frac{t}{R}$$

When $\sigma_{\text{net}} > \sigma_{\text{cr}}$, smeared ring/stringer orthogrid stiffening increases barrel mass smoothly: $k_{\text{stiff}} = \mathrm{clamp}(1 + s (\sigma_{\text{net}}/\sigma_{\text{cr}} - 1), 1.0, k_{\max})$ with $(s=0.28, k_{\max}=1.38)$ for milled orthogrid/composite shells and $(s=0.08, k_{\max}=1.12)$ for pressure-stabilized ring-welded 304L.

### 3.4 Farrar Wide-Column Stiffened Skirts, Intertank & Interstage Shells
Rather than penalizing large-diameter ($9\text{ m}$ to $10.1\text{ m}$) rockets with unphysically thick isotropic shell equations, skirts and interstages size to Farrar minimum-weight ring-and-stringer wide-column buckling under compressive line flux $N_x = \frac{(m_{\text{above}} + 0.8 m_{\text{prop}}) n_{\max} g_0}{2\pi R}$ with ring frame spacing $L_{\text{frame}} = 0.55 + 0.12 R$:

$$t_{\text{eq,skirt}} = \max\!\left(1.15 \sqrt{\frac{N_x L_{\text{frame}}}{E}}, \, \frac{N_x}{0.65 \sigma_y}, \, 1.45 \, t_{\min}\right), \qquad \rho_{A,\text{skirt}} = 1.12 \, \rho_{\text{mat}} \, t_{\text{eq,skirt}}$$

### 3.5 Complete 19-Subsystem Breakdown Inventory
Each `StageStructuralBreakdown` tracks every physical inert item in kg and guarantees strict conservation `sum(17 structure-only items) + engines + recovery_hw + strapon_inert = predicted_dry_unmargined_kg`:
1. `ox_tank_barrel_mass_kg`: $2\pi R L_{\text{ox}} t_{\text{ox}} k_{\text{stiff,ox}} \rho_{\text{mat}} f_{\text{weld}}$ ($f_{\text{weld}} = 1.24$ milled Al/Ti; $1.06$ 304L/CFRP).
2. `fuel_tank_barrel_mass_kg`: $2\pi R L_{\text{fuel}} t_{\text{fuel}} k_{\text{stiff,fuel}} \rho_{\text{mat}} f_{\text{weld}}$.
3. `tank_domes_mass_kg`: `2:1` ellipsoidal outer bulkheads ($1.38 \pi R^2$) plus inner bulkhead or $1.42\times$ common bulkhead.
4. `baffles_and_slosh_mass_kg`: $0.065 (m_{\text{ox,bar}} + m_{\text{fuel,bar}}) (\rho_{\text{bulk}}/1000)^{0.35} + 0.00045 \, m_{\text{prop}}$.
5. `forward_skirt_mass_kg`: $2\pi R \, (0.34 D \, k_{\text{skirt}}) \, \rho_{A,\text{skirt}}$.
6. `aft_skirt_and_base_shield_mass_kg`: $2\pi R \, (0.44 D \, k_{\text{skirt}}) \, \rho_{A,\text{skirt}} + 3.8 \pi R^2 (1 + 0.04 N_{\text{eng}})$.
7. `intertank_mass_kg`: $0.22 \, m_{\text{fwd\_skirt}}$ for common bulkhead, or $2\pi R \, (0.54 D \, k_{\text{skirt}}) \, \rho_{A,\text{skirt}}$ plus $0.024 \, m_{\text{strapon\_dry}}$ forward attach reaction beam when strap-ons are present.
8. `interstage_mass_kg`: $0.85 \cdot 2\pi R \max(0.70 D \, k_{\text{skirt}}, 1.20 H_{\text{upper\_eng}}) \rho_{A,\text{skirt}} + m_{\text{sep\_hw}}$ ($120\text{ kg}$ cold pneumatic / $680\text{ kg}$ hot-stage ring). Zero on top stage.
9. `thrust_structure_mass_kg`: $0.00125 \, (T_{\text{vac,tot}}/g_0) D^{0.22} N_{\text{eng}}^{0.08} \left(\frac{\rho/\rho_{\text{AlLi}}}{\sigma_{\text{allow}}/540\text{ MPa}}\right)^{0.42}$ (liquid) or $0.0008 \, (T_{\text{vac}}/g_0) D^{0.18}$ (solid).
10. `plumbing_and_valves_mass_kg`: $0.15 \, \dot{m}_{\text{tot}} (1 + 0.014 L_{\text{downcomer}}) + 18 \, N_{\text{eng}}^{0.82} (\dot{m}_{\text{tot}}/100)^{0.55}$.
11. `pressurization_system_mass_kg`: Ideal-gas autogenous pressurant ($1.18\times$) or cold Helium COPV + composite bottle ($1.25\times$ collapse factor + $0.55 m_{\text{He}}$ liner).
12. `cryo_insulation_mass_kg`: $2.40$ to $2.85\text{ kg/m}^2$ SOFI/MLI for LH2, $1.10\text{ kg/m}^2$ CH4, $0.85\text{ kg/m}^2$ LOX-only on RP-1 stages, plus MLI coast boil-off loss estimate.
13. `tvc_and_rcs_mass_kg`: $0.00048 (T_{\text{vac,tot}}/g_0)$ gimbal actuators + $26 D^{1.15} k_{\text{RCS}}$ reaction control + Li-ion battery packs for electric-pump cycles.
14. `avionics_and_wiring_mass_kg`: $40 D^{1.05} k_{\text{av}} + 2.4 L_{\text{tanks}} \sqrt{D}$.
15. `payload_adapter_mass_kg`: $0.0135 \, m_{\text{payload}}^{0.88}$ on the uppermost stage only.
16. `fasteners_and_joints_mass_kg`: $5.5\%$ of primary shell, skirt, intertank, and thrust structure mass.
17. `solid_casing_and_nozzle_mass_kg`: $0.084 \, m_{\text{prop}}$ for filament-wound CFRP casings, $0.088 \, m_{\text{prop}}$ Titanium, $0.125 \, m_{\text{prop}}$ D6AC steel (active on solid stages).
18. **Propulsion Dry Mass (`engines_mass_kg`)**: $N_{\text{eng}} \, m_{\text{eng,dry}}$.
19. **Recovery & Parallel Hardware (`recovery_hardware_kg`, `strapon_inert_kg`)**: Landing legs/fins/heatshield plus separated parallel booster inert allocation.

### 3.6 Inert Mass Margin (Mass Growth Allowance / MGA)
Default preliminary design margin is `mass_margin_frac = 0.25` (25%), aligned with NASA S-020 / AIAA preliminary launch vehicle design rules:

$$m_{\text{dry,margined}} = m_{\text{dry,unmargined}} \cdot (1 + f_{\text{margin}}), \qquad \text{Reserve} = m_{\text{dry,margined}} - m_{\text{dry,unmargined}}$$

Both `predicted_pmf_unmargined` and `predicted_pmf_margined` are exposed so engineers can directly quantify how much structural contingency sits inside the closed mission solution.

---

## 4. Payload Fairing, Rubber Engines & 2D Base Packing

- **Fairings (`structures.rs`):** Von Karman ($\lambda=2.15$), Tangent Ogive ($\lambda=2.0$), and Biconic ($\lambda=1.85$) profiles compute axial surface integral mass with composite areal density ($8.5\text{ kg/m}^2$ CFRP, $14.0\text{ kg/m}^2$ Al-Li) and $C_{d0} = 0.80 \lambda^{-1.65} + 0.0028 (S_{\text{wet}} / A_{\text{ref}})$.
- **Rubber Engine Scaling (`rubber_engine.rs`):** Scales any liquid cycle to $(T_{\text{target}}, P_c)$ via $m_{\text{dry}} = m_{\text{ref}} (T/T_{\text{ref}})^{0.82} (P_c/P_{c,\text{ref}})^{-0.15}$ and $I_{\text{sp,vac}} = I_{\text{sp,ref}}(1 + 0.012 \ln(P_c/P_{c,\text{ref}}))$.
- **2D Circle Packing (`packaging.rs`):** Enforces $D_{\text{footprint}} = D_{\text{nozzle}} + 2 L_{\text{gimbal}} \sin(\theta_{\text{TVC}}) + \delta_{\text{gap}}$ across Patterns A (1 center), B (ring 2..4), C (1 + outer), D (1+6+12 / 3+10+20 dense multi-ring for Super Heavy 33-engine clusters), and custom user coordinates inside usable skirt diameter $D_{\text{usable}} = D_{\text{stage}} - 2(t_{\text{skirt}} + \delta_{\text{skirt}})$.

---

## 5. Heritage Structural Model Validation Results (`test_benchmark_12`)

The bottom-up unmargined structural estimator (`predict_heritage_vehicle_structure` in `structures.rs`, enforced cleanly by `cargo test test_benchmark_12`) was validated directly against primary-source empty masses from 16 flight-proven vehicles spanning 13,000 kg (Electron) to 5,000,000 kg (Starship). Note that pre-2005 conventional metallic airframes (`Atlas V`, `Ariane 5`, `Delta IV Heavy`, `H-IIA`, `Saturn V`, `Soyuz-2`, `Proton-M`, `Falcon 1` / heavy Al-2219 thick cores `SLS`, `LM-5`, `Vulcan`) apply a `1.12x` alloy factor relative to modern Al-Li 2195.

| Heritage Vehicle | S1 Dry Act (kg) | S1 Pred (kg) | S1 Err | S2 Dry Act (kg) | S2 Pred (kg) | S2 Err | Total Dry Act (kg) | Total Pred (kg) | Total Err |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Electron | 950 | 875 | -7.9% | 250 | 231 | -7.5% | 1,550 | 1,266 | -18.3% |
| Falcon 1 | 2,200 | 1,858 | -15.6% | 550 | 488 | -11.3% | 2,900 | 2,505 | -13.6% |
| Vega (4-Stage) | 7,330 | 9,094 | +24.1% | 1,950 | 2,655 | +36.2% | 19,800 | 18,291 | -7.6% |
| Soyuz-2 | 6,545 | 6,464 | -1.2% | 2,355 | 1,614 | -31.5% | 27,500 | 26,661 | -3.0% |
| Falcon 9 FT | 22,200 | 19,191 | -13.6% | 4,000 | 3,223 | -19.4% | 29,900 | 24,140 | -19.3% |
| Falcon Heavy | 22,200 | 21,038 | -5.2% | 4,000 | 3,605 | -9.9% | 73,000 | 63,426 | -13.1% |
| Atlas V 401 | 21,054 | 14,803 | -29.7% | 2,247 | 2,126 | -5.4% | 23,300 | 18,206 | -21.9% |
| Vulcan Centaur VC6L | 29,000 | 21,522 | -25.8% | 5,100 | 4,749 | -6.9% | 59,000 | 65,185 | +10.5% |
| Ariane 5 ECA | 14,700 | 16,040 | +9.1% | 4,540 | 3,317 | -26.9% | 99,100 | 96,083 | -3.0% |
| Proton-M | 30,600 | 26,397 | -13.7% | 11,715 | 9,606 | -18.0% | 55,800 | 42,531 | -23.8% |
| Delta IV Heavy | 26,400 | 21,608 | -18.2% | 3,490 | 3,443 | -1.4% | 88,200 | 66,088 | -25.1% |
| H-IIA 202 | 12,500 | 10,007 | -19.9% | 3,100 | 2,562 | -17.4% | 31,000 | 34,235 | +10.4% |
| Long March 5 | 18,500 | 14,004 | -24.3% | 3,500 | 3,401 | -2.8% | 82,000 | 51,577 | -37.1% |
| Saturn V | 130,000 | 127,561 | -1.9% | 36,000 | 36,216 | +0.6% | 195,000 | 181,292 | -7.0% |
| SLS Block 1 | 85,275 | 80,961 | -5.1% | 3,490 | 3,542 | +1.5% | 308,000 | 282,470 | -8.3% |
| Starship / Super Heavy | 200,000 | 254,284 | +27.1% | 100,000 | 75,185 | -24.8% | 300,000 | 329,469 | +9.8% |
| **16-Vehicle Mean Absolute Error** | - | - | - | - | - | - | - | **MAPE** | **14.49%** |

Across the broader 60+ operational vehicles in the JSON catalog (including unmodeled multi-kick-stage or catalog-proxy mismatches), overall catalog operational MAPE is `34.19%`, providing full transparency inside the app validation table.

---

## 6. Assumptions, Engineering Justifications, Limitations & Future Work

### 6.1 Key Assumptions & Justifications
- **2:1 Ellipsoidal Bulkheads (`h_dome = 0.5 R`):** Standard flight-proven dome profile balancing propellant volumetric efficiency against knuckle bending stresses (`Saturn V`, `SLS`, `Falcon 9`).
- **Smeared Orthogrid Minimum Shell Gauge (`2.45 mm` on Al-Li/Ti):** CNC-milled billet pockets hit `~1.2 mm` membrane thickness while integral ribs, circumferential ring frames, and weld lands raise average shell areal density to `~2.45 mm` equivalent.
- **Pressure-Stabilized 55% Ullage Buckling Credit:** Accounting for only `55%` of internal pressurization axial tension in cylinder buckling maintains positive safety margin under pad winds, Max-Q aerodynamic bending transients, and regulator dip tolerances.
- **25% Preliminary MGA Default:** Follows AIAA/NASA S-020 preliminary design margins before detailed CAD and NASTRAN finite-element sizing freezes drawings.

### 6.2 Model Limitations
1. **3+ Stage Catalog Metadata Simplification:** The vehicle database schema explicitly stores detailed stage masses/engines for `S1`, `S2`, and `Boosters`. Third and fourth stages (`Proton-M` Stage 3 + Breeze-M, `Vega` Zefiro-9 + AVUM, `Saturn V` S-IVB) are reconstructed by `GLOW` mass-balance residual when `stage_count >= 3`, introducing higher error on complex multi-upper-stage vehicles.
2. **Engine Proxy Mismatch:** A few historical heritage records in `data/vehicles/` assign a modern catalog proxy engine ID (such as `rd_180` on `Proton-M` or `p120c` across `Vega` stages). `effective_heritage_engine_params` scales thrust and mass flow proportionally to stage burn time, which smooths mass balance while omitting exact vintage engine mass variations.
3. **1D Shell & Skirt Model:** Asymmetric local cutouts (access doors, umbilical carrier plates, aerodynamic strakes, gimbal actuator brackets) are lumped into fastener and skirt factors using 1D beam assumptions without 3D panel finite-element buckling modes.
4. **2-DOF Point-Mass Trajectory:** `physics.rs` integrates a pitch-scheduled 2-DOF Earth-centered trajectory without 6-DOF closed-loop guidance, structural aeroelastic bending modes, or Max-Q wind-shear gusts.

### 6.3 Potential Future Work & Rework
- Expand the vehicle JSON schema (`data/vehicles/*.json`) to include explicit `s3_*` and `s4_*` stage fields and add exact heritage engine specs (`rd_276`, `rd_0210`, `p80`, `zefiro_23`, `zefiro_9`, `avum`) to `data/engines/` to eliminate catalog proxy scaling on `Vega`, `Soyuz-2`, and `Proton-M`.
- Replace global `f_bend` slenderness approximation with integrated axial + lateral wind-shear Max-Q bending moment distribution $M(x)$ along the stack length.
- Couple closed-loop Linear Tangent Guidance (LTG / PEG) inside the staging loop to size gravity/steering losses dynamically per vehicle T/W history during combinatorial optimization.

## Related Documentation

- [Project Overview](../README.md)
- [System Architecture](ARCHITECTURE.md)
- [Cost Model Reference](COST_MODEL_REFERENCE.md)
- [Model Validation](MODEL_VALIDATION.md)
- [User Guide](USER_GUIDE.md)
- [Security Policy](../SECURITY.md)
