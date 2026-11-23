# Developer Guide

Build, test, lint, and package RocketSizer from source across Windows, macOS, and Linux.

## Prerequisites

- **Rust Toolchain** (`rustc` and `cargo`, stable channel)
- **Node.js 20+** and `npm`
- **[Astral `uv`](UV_INSTALLATION.md)** (for running repository lint checks)

---

### Windows

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
cd src && npm ci && npm run build && cd ..
cargo build --release --manifest-path src-tauri/Cargo.toml --bin rocket_sizer_desktop
.\src-tauri\target\release\rocket_sizer_desktop.exe --self-test
```

---

### macOS

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cd src && npm ci && npm run build && cd ..
cargo build --release --manifest-path src-tauri/Cargo.toml --bin rocket_sizer_desktop
./src-tauri/target/release/rocket_sizer_desktop --self-test
```

---

### Linux

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cd src && npm ci && npm run build && cd ..
cargo build --release --manifest-path src-tauri/Cargo.toml --bin rocket_sizer_desktop
./src-tauri/target/release/rocket_sizer_desktop --self-test
```

---

## Verification & Linting

```bash
cd src && npx tsc --noEmit && cd ..
cargo test --manifest-path src-tauri/Cargo.toml
uv run --no-project python ../ai-dev-tools/scripts/claudemd_linter.py . --level strict --full
uv run --no-project python ../ai-dev-tools/scripts/link_checker.py .
```

---

## Related Documentation

- [Project Overview](../README.md)
- [Desktop Installation Guide](INSTALLATION.md)
- [Developer uv Installation Guide](UV_INSTALLATION.md)
- [System Architecture](ARCHITECTURE.md)
- [Mathematical Models](MATHEMATICAL_MODELS.md)
- [Cost Model Reference](COST_MODEL_REFERENCE.md)
- [AI Agent Reference](../AGENTS.md)
- [Security Policy](../SECURITY.md)
