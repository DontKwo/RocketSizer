# User Guide for RocketSizer

RocketSizer is a self-contained launch vehicle conceptual design, sizing, cataloging, and trade study application powered by a Rust numerical core and embedded React/TypeScript interface.

## Launching the application

### Standalone desktop application

1. Download the executable for your platform from [Latest Releases](https://github.com/DontKwo/RocketSizer/releases/latest) (`RocketSizer-Windows.exe`, `RocketSizer-macOS.zip`, or `RocketSizer-Linux.tar.gz`) and follow the [Desktop Installation Guide](INSTALLATION.md).
2. Double-click or launch RocketSizer. It starts its embedded local API backend and opens a dedicated desktop window automatically without separate browser extensions or servers.

For building from source or running the benchmark suite, see the [Developer Guide](DEVELOPMENT.md).

---

## Workspace views and workflows

RocketSizer provides five workspaces plus an in-app **Guide** modal and **Preset** loader in the top header bar.

### Top header controls

- **Preset selector**: Immediately loads verified starting architectures (`Default 2-Stage`, `Falcon 9 Block 5`, `Electron Light`, `Saturn V`, `SLS Block 1`, `Vulcan Centaur VC6L`, `Blue Origin New Glenn`, and `Starship Super Heavy`).
- **Live telemetry pill**: Displays GLOW, usable payload, estimated flight cost, and overall constraint feasibility (`FEASIBLE` vs `VIOLATIONS`) in real time.
- **Currency year picker**: Adjusts parametric costs and historical launch prices across economic years (FY2010 to FY2026).
- **Unit system toggle**: Switches every input, chart, table, and schematic callout between Metric (SI) and Imperial (US) units with zero recalculation lag.
- **Guide button**: Opens the built-in Quick Start walkthrough directly inside the application.

### Optimization search & single config evaluator (Sizing studio)

Use **Optimization Search** to sweep discrete stage engine combinations and delta-V splits across `2-Stage`, `2.5-Stage`, `3-Stage`, and `3.5-Stage` architectures, then inspect or customize any architecture in **Single Config Evaluator**:

- **Mission & payload configuration**: Choose standard orbit presets (`LEO 28.5 deg`, `ISS 51.6 deg`, `SSO 97.6 deg`, `GTO`, `TLI`, `TMI`) or custom perigee/apogee/eccentricity orbits, and set payload mass, payload diameter, core stage diameter, and **Inert Mass Margin (MGA %)** (defaults to 25% preliminary margin).
- **Staging & propulsion**: Assign liquid or solid heritage engines, engine counts, tank materials (`Al-Li 2195`, `CFRP Composite`, `304L Stainless Steel`, `Ti-6Al-4V`), pressurization modes (`Autogenous` vs `Helium COPV`), stage recovery modes (`Expendable`, `ASDS Downrange Landing`, `RTLS Propulsive Return`, `Parachute Catch`), and strap-on boosters.
- **Rubber engine scaler**: Click **Scale Rubber Engine** to scale any reference liquid engine to a custom vacuum thrust and chamber pressure, and assign it directly to a stage.
- **2D engine base layout**: Inspect stage skirt clearance, TVC gimbal swing envelopes, and minimum inter-nozzle margins. Drag individual engine nozzles on the SVG canvas or double-click a nozzle to enable or disable it.
- **Dimensioned schematic & charts**: Review the live vector schematic showing fairings, dome tanks, interstage rings, and engine bells alongside the mass budget treemap and ascent delta-V waterfall.
- **Export brief**: Click **Export Brief** in the right-hand output card (or **Download Feasibility Report (.md)** in the bottom report panel) to save a complete Markdown feasibility justification report including the 19-subsystem structural breakdown and peer heritage comparison tables.

### Automated design feasibility & heritage validation report

Displayed automatically at the bottom of **Optimization Search** (both Visuals and Tables tabs), **Single Config Evaluator**, and **Design Inspector**:

1. **Five Automated Engineering Justification Sections**:
   - **Mission & Delta-V Closure**: Verifies orbital vis-viva energy, gravity/drag/steering losses, Earth rotational assist, and net delta-V residual.
   - **Staging Splits & Mass Ratio Feasibility**: Confirms each stage operates strictly below its convergence asymptote `MR_max = 1 / (1 - PMF)`.
   - **Propulsion, T/W & Base Circle Packing**: Justifies cycle choice, liftoff T/W0, Max-Q throttle, peak acceleration, and skirt geometric clearance.
   - **Inert Mass Margin (MGA) & Reserve Budget**: Highlights applied MGA % (e.g., 25.0%), exact unmargined dry mass, unallocated growth reserve buffer (kg/lb), margined flight dry mass, and resulting PMF shift.
   - **Structural Mechanics & Cost Feasibility**: Summarizes peak tank hoop stress vs yield, critical buckling stress, fairing volume/mass, internal marginal cost, estimated commercial market launch price, and program DDT&E.
2. **Table 1 - Bottom-Up 19-Subsystem Structural Mass Estimator**: Lists every calculated component per stage and vehicle total (oxidizer & fuel barrels, 2:1 domes/common bulkhead, baffles, forward skirt, aft skirt & base heatshield, intertank, interstage/separation hardware, thrust structure, plumbing/downcomers, pressurization, cryo insulation, TVC/RCS/batteries, avionics/harness, payload adapter, fasteners, solid casings, engines, recovery hardware, strap-on inert, unmargined subtotal, MGA reserve, margined dry total, and wall thickness gauges in mm).
3. **Table 2 - Direct Comparison vs Matched Peer Heritage Rockets**: Automatically ranks the 5 nearest heritage vehicles in the same payload class (`Light`, `Medium`, `Heavy`, `Super-Heavy`), generating comparative prose and side-by-side tabular comparisons of GLOW, LEO payload, payload fraction, dry stage masses, T/W0, market launch price, and `$/kg`.
4. **Table 3 - In-App Heritage Fleet Validation Matrix**: Queries the live Rust validator (`validate_heritage_models`) with filter tabs (`All Benchmark Vehicles`, `In-Sample Calibration Set`, `Independent Holdouts Set`, `Matched Payload Category`) displaying actual vs predicted dry masses, recurring launch price, DDT&E, signed error %, MAPE, and Median Absolute Percentage Error (MdAPE).
5. **Table 4 - Statistical Uncertainty Quantification**: Displays P10 (optimistic), P50 (nominal), and P90 (conservative guarantee) confidence intervals for GLOW, structural dry mass, recurring flight cost, program DDT&E, total delta-V, and payload capacity based on propagated AIAA S-020 mass growth allowances (-5% to +15%), propulsion specific impulse dispersions ($\pm 1.5\%$), trajectory losses ($\pm 2.5\%$), and CER standard errors.
6. **Machine-Readable Input Deck Export**: Click **Copy Input Deck (JSON)** to copy the complete serialized JSON sizing deck including orbit parameters, staging definitions, mass balances, and cost profiles.
7. **Engineering Fidelity Scope & Conceptual Boundaries**: Outlines solver boundaries directly in the report (Barlow hoop stress, SP-8007 buckling, 2-DOF gravity-turn integration, no 3D FEA, no 6-DOF closed loop guidance, no 3D solid grain burn regression).

### Heritage vehicles

- Search and filter 99 historical and active global launch vehicles (USA, USSR/Russia, Europe, China, Japan, India, South Korea, Israel) by country, operational status, and minimum LEO payload capacity.
- Toggle between the **Vehicle Database** catalog view and the **Model Validation & Holdouts** telemetry dashboard.
- The validation dashboard displays live summary cards for in-sample calibration and holdout error statistics alongside a comparative evaluation table.
- Toggle visibility across 50+ vehicle fields (payloads, dimensions, stage propellants, engine assignments, inflation-adjusted launch costs, and reliability rates).
- Click any outlined cell to open the **Provenance Inspector** drawer and view bibliographic citations, excerpts, URLs, or derivations across primary sources.

### Heritage engines

- Explore 132 sourced liquid and solid rocket engines on the vacuum Isp vs thrust-to-weight scatter plot across propellants and power cycles.
- Filter engines by propellant (`lox_rp1`, `lox_ch4`, `lox_lh2`, `solid_htpb`, `hypergolic_nto_udmh`) and engine cycle.
- Use the inline **Parametric Rubber Engine Workshop** to preview custom scaled engines and add them to the session catalog.

### Scale lineup

- Compare your active vehicle design against selected Small, Medium, Heavy, and Super Heavy historical launch vehicles on a calibrated elevation grid.
- Click **Auto-Match Closest** to automatically pick historical rockets nearest in payload and GLOW.
- Toggle between **Blueprint** and **Presentation** color palettes and export standalone SVG drawings.

### Sensitivity studio

- Sweep `payload_mass_kg`, stage 1 delta-V split fraction, core diameter, required mission delta-V, or expected booster reuses across user-defined bounds.
- View dual-axis GLOW vs flight cost sensitivity curves and the Pareto trade frontier populated by optimizer runs.
- Export results as CSV tables, Markdown reports, or print/PDF via browser print controls.

## Related Documentation

- [Project Overview](../README.md)
- [Desktop Installation Guide](INSTALLATION.md)
- [Frequently Asked Questions](FAQ.md)
- [Mathematical Models](MATHEMATICAL_MODELS.md)
- [Cost Model Reference](COST_MODEL_REFERENCE.md)
- [Model Validation](MODEL_VALIDATION.md)
- [Security Policy](../SECURITY.md)
