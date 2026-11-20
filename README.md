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
- **Cross-Platform Matrix Tests**: 14 historical benchmark suites executed across Ubuntu, Windows, and macOS.
- **Self-Test Verification**: Built binaries execute internal loopback HTTP and numerical verification (`--self-test`) prior to artifact publication.

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
