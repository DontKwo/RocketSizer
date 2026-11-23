# Frequently Asked Questions

Answers to common questions about installing and using RocketSizer.

## What fidelity level do RocketSizer estimates have?

RocketSizer uses 2-DOF gravity-turn trajectory integration, thin-wall hoop/buckling checks, 2D circle-packing geometry, and TRANSCOST / NASA PCEC parametric cost curves. Results are intended for rapid conceptual sizing and trade studies and must not be used for certified aerospace hardware design or flight-safety qualification.

## Why do Windows SmartScreen or macOS Gatekeeper show security warnings?

RocketSizer builds are distributed independently without paid code-signing certificates. Always download from [Official Releases](https://github.com/DontKwo/RocketSizer/releases/latest) and review [Desktop Installation Guide](INSTALLATION.md) before launching.

## Where do heritage vehicle and engine specifications come from?

All 99 vehicles and 132 engines under `data/` include source attribution metadata viewable in the **Provenance Inspector** drawer inside the app. See [Provenance Guide](PROVENANCE_GUIDE.md) and [Model Validation](MODEL_VALIDATION.md).

## Related Documentation

- [Project Overview](../README.md)
- [User Guide](USER_GUIDE.md)
- [Desktop Installation Guide](INSTALLATION.md)
- [Mathematical Models](MATHEMATICAL_MODELS.md)
- [Model Validation](MODEL_VALIDATION.md)
- [Security Policy](../SECURITY.md)
