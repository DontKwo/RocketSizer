# RocketSizer

RocketSizer is a self-contained launch vehicle conceptual sizing, heritage cataloging, and trade study application built with a Rust numerical core and a React/TypeScript interface.

## Downloads & Releases

Pre-compiled standalone desktop executables for Windows, Linux, and macOS are automatically built, validated, and published via GitHub Actions on every push to `main` and on version tags:

- **All Releases**: [GitHub Releases Page](https://github.com/DontKwo/rocket_sizer/releases)
- **Latest Build (main)**: [Rolling Latest Release](https://github.com/DontKwo/rocket_sizer/releases/latest)

| Platform | Binary | Architecture | Direct Download |
| :--- | :--- | :--- | :--- |
| **Windows** | `.exe` standalone | x86_64 | [RocketSizer-windows-x86_64.exe](https://github.com/DontKwo/rocket_sizer/releases/download/latest/RocketSizer-windows-x86_64.exe) |
| **Linux** | ELF standalone | x86_64 | [RocketSizer-linux-x86_64](https://github.com/DontKwo/rocket_sizer/releases/download/latest/RocketSizer-linux-x86_64) |
| **macOS Universal** | Mach-O Universal | Apple Silicon & Intel | [RocketSizer-macos-universal](https://github.com/DontKwo/rocket_sizer/releases/download/latest/RocketSizer-macos-universal) |
| **macOS Apple Silicon** | Mach-O 64-bit | Apple Silicon (M1/M2/M3/M4) | [RocketSizer-macos-aarch64](https://github.com/DontKwo/rocket_sizer/releases/download/latest/RocketSizer-macos-aarch64) |
| **macOS Intel** | Mach-O 64-bit | Intel (x86_64) | [RocketSizer-macos-x86_64](https://github.com/DontKwo/rocket_sizer/releases/download/latest/RocketSizer-macos-x86_64) |

Each release includes SHA256 checksums in `SHA256SUMS.txt`.

## How to run

### Windows
Double-click `RocketSizer.exe` in the repository root or `RocketSizer-windows-x86_64.exe` from Releases. The app launches maximized in desktop window mode with no external dependencies or separate server.

### Linux
Make the binary executable and launch:
```bash
chmod +x RocketSizer-linux-x86_64
./RocketSizer-linux-x86_64
```

### macOS
Make the binary executable and launch:
```bash
chmod +x RocketSizer-macos-universal
./RocketSizer-macos-universal
```

### From Source (All Platforms)
```bash
cargo run --manifest-path src-tauri/Cargo.toml --bin rocket_sizer_desktop
```

To run the automated historical aerospace benchmark suite:
```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

## Continuous Integration & Automated Builds

All releases and commits are validated by GitHub Actions workflows:
- **ClaudeMD Strict Linter**: Codebase AST inspection, import verification, and anti-AI writing guards via `ai-dev-tools`.
- **TypeScript Verification**: Strict compiler check (`tsc --noEmit`).
- **Cross-Platform Matrix Tests**: 15 historical benchmark suites executed across Ubuntu, Windows, and macOS.
- **Self-Test Verification**: Built binaries execute internal loopback HTTP and numerical verification (`--self-test`) prior to artifact publication.

## Numerical Model Validation & Accuracy

Numerical models are verified against published flight hardware specifications and cost accounting records across 16 flight-proven launch systems. Sizing models partition the vehicle fleet into calibration and holdout sets to prevent coefficient overfitting:

| Evaluation Domain | In-Sample Calibration MAPE (5 Vehicles) | Independent Holdout MAPE (11 Vehicles) | Full Benchmark Fleet MAPE (16 Vehicles) | Fleet MdAPE |
| :--- | :---: | :---: | :---: | :---: |
| **Structural Dry Mass** | 11.64% | 14.28% | **14.49%** | 13.35% |
| **Recurring Flight Price** | 1.12% | 1.80% | **1.58%** | 1.21% |
| **Non-Recurring DDT&E** | 5.56% | 5.92% | **5.81%** | 3.31% |

Statistical uncertainty quantification propagates AIAA S-020 mass growth allowances (-5% to +15%), propulsion specific impulse dispersions ($\pm 1.5\%$), trajectory losses ($\pm 2.5\%$), and CER standard errors to produce P10, P50, and P90 confidence percentiles on all sizing outputs. Complete details are documented in [docs/MODEL_VALIDATION.md](docs/MODEL_VALIDATION.md).

## Engineering Scope, Boundaries, and Exclusions

RocketSizer is designed for conceptual sizing, preliminary architecture trade studies, and rapid configuration exploration. It is not a flight certification authority or detailed structural release tool. Explicit model boundaries include:

1. **Structural Sizing**: Uses analytical closed-form equations (Barlow thin-wall hoop stress, Euler-Bernoulli beam bending, and NASA SP-8007 axial buckling knockdowns). The solver does not perform 3D finite element analysis (FEA), local cutout modeling, acoustic fatigue analysis, or aeroelastic flutter calculations.
2. **Trajectory & Guidance**: Sizing integrates a 2-DOF point-mass gravity-turn trajectory with empirical velocity loss accounting. It does not compute 3D cross-track steering, closed-loop 6-DOF guidance, or wind-shear responses.
3. **Solid Propulsion**: Solid motors and strap-on boosters are sized with lumped bulk properties (average vacuum specific impulse, propellant mass, casing mass ratio, and burn time). 3D propellant grain geometry regression and erosive burning dynamics are excluded.
4. **Economic Valuation**: Historical launch and development expenditures are normalized to FY2026 USD via the NASA New Start Inflation Index. Comparisons evaluate dedicated commercial launch procurement; rideshare ticket pricing is excluded. Detailed scope explanations are provided in [docs/MODEL_VALIDATION.md](docs/MODEL_VALIDATION.md).

## Quick in-app workflow

1. Select a built-in architecture from the top **Preset** menu (`Falcon 9 Block 5`, `Saturn V`, `SLS Block 1`, `Vulcan Centaur VC6L`, `Blue Origin New Glenn`, `Electron`, `Starship Super Heavy`, or `Default 2-Stage`) or click **Guide** in the header bar for an interactive walkthrough.
2. Adjust payload, orbit, engine selection, tank materials, or recovery mode in **Sizing Studio**, or click **Run Combinatorial Optimizer** to search heritage engine and delta-V combinations across 130+ sourced liquid and solid engines.
3. Inspect the dimensioned SVG schematic, mass and delta-V breakdowns, and drag engine nozzles inside the interactive **2D Engine Base Layout**.
4. Switch between **Metric (SI)** and **Imperial (US)** units or change economic inflation year in the header at any time.
5. Open **Heritage Vehicles** (95+ launch vehicles), **Heritage Engines** (130+ engines), **Scale Lineup**, or **Trade & Sensitivity** to compare historical rockets, scale custom rubber engines, inspect 55+ primary source citations, and export SVG, CSV, Markdown, or PDF deliverables.

## Documentation index

- [docs/MODEL_VALIDATION.md](docs/MODEL_VALIDATION.md): Heritage vehicle validation data, accuracy benchmarks, mathematical equations, and assumptions.
- [docs/USER_GUIDE.md](docs/USER_GUIDE.md): Complete user manual for all five workspaces and built-in presets.
- [docs/MATHEMATICAL_MODELS.md](docs/MATHEMATICAL_MODELS.md): Staging closure, structures, delta-V losses, and circle-packing equations.
- [docs/COST_MODEL_REFERENCE.md](docs/COST_MODEL_REFERENCE.md): TRANSCOST and NASA PCEC parametric cost relationships.
- [docs/PROVENANCE_GUIDE.md](docs/PROVENANCE_GUIDE.md): Data provenance schema and citation inspection drawer.
- [DESIGN.md](DESIGN.md): Master architectural specification.
