# AI Agent Operational Reference

Operational invariants and architecture summary for `RocketSizer`.

## Architecture

- **Rust Core & Local HTTP Host (`src-tauri/`)**: Launch vehicle sizing, staging mass balances, 2-DOF gravity-turn trajectory integration, structural hoop/buckling checks, 2D nozzle circle packing, and TRANSCOST/PCEC cost modeling exposed via embedded loopback server in [main.rs](src-tauri/src/main.rs). Supports `--self-test` and `--no-browser`.
- **Frontend UI (`src/`)**: React 19, TypeScript, Vite, Tailwind CSS, TanStack Table v8, and Recharts. Prebuilt assets under `src/dist/` are embedded into the Rust executable at compile time.
- **Heritage Data (`data/`)**: Verified JSON catalogs under `data/vehicles/`, `data/engines/`, and `data/citations/`.

## Verification Commands

- Rust core tests & self-test: `cargo test --manifest-path src-tauri/Cargo.toml`
- Frontend TypeScript check & build: `cd src && npx tsc --noEmit && npm run build`
- Strict lint & link check: `claudemd_linter.py . --level strict --full` and `link_checker.py .`

## Coding & Documentation Rules

- Always keep domain variable unit suffixes explicit (`_kg`, `_m`, `_s`, `_n`, `_usd`, `_bar`).
- Keep `README.md` user-focused (`<= 120` lines), avoid checksums/CI prose/build commands, and include `## Related Documentation` footers linking back to `../README.md` on all files under [docs/](docs/USER_GUIDE.md).

## Related Documentation

- [Project Overview](README.md)
- [System Architecture](docs/ARCHITECTURE.md)
- [Developer Guide](docs/DEVELOPMENT.md)
- [Mathematical Models](docs/MATHEMATICAL_MODELS.md)
