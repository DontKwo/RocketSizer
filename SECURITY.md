# Security Policy

## Supported Versions & Official Releases

| Version / Branch | Supported | Notes |
| :--- | :--- | :--- |
| `main` (Latest `vX.Y.Z` Release) | Yes | Actively maintained official release stream |
| Forks, Mirrors, and Older Tags | No | Unverified and unsupported |

Official binaries are distributed exclusively from the primary `DontKwo/RocketSizer` repository on GitHub (`main` branch and official [Releases](https://github.com/DontKwo/RocketSizer/releases/latest)).

- **Fork Safety Warning**: Do **not** download or run binaries from forked repositories or third-party mirrors unless you have verified the source code yourself and confirmed they contain no malware. Only official `main` releases are maintained by the author, and I make no promises.
- **OS Security Prompts**: Because `RocketSizer` is published independently without paid commercial code-signing certificates, Windows SmartScreen and macOS Gatekeeper will likely warn that downloaded binaries are unrecognized or unsafe. Review [Desktop Installation Guide](docs/INSTALLATION.md) and bypass security prompts strictly at your own discretion.

## Engineering & Liability Disclaimer

`RocketSizer` is an educational conceptual launch vehicle sizing and trade-study tool provided "AS IS" under the [MIT License](LICENSE), without warranty of any kind. Outputs are conceptual engineering estimates and must **not** be treated as certified aerospace design, structural qualification, or flight-safety guarantees. The author assumes zero liability or responsibility for any decisions, designs, file writes, or damages arising from using this software. You use this software entirely at your own risk and discretion.

## Reporting a Vulnerability

If you discover a security vulnerability in `DontKwo/RocketSizer`:

1. **Do not** disclose exploit details in a public GitHub Issue.
2. Open a [Private Vulnerability Report](https://github.com/DontKwo/RocketSizer/security/advisories/new) on GitHub (or contact `@DontKwo` via GitHub).
3. Include reproduction steps, OS/architecture details, and any suggested fix.

## Related Documentation

- [Project Overview](README.md)
- [Desktop Installation Guide](docs/INSTALLATION.md)
- [User Guide](docs/USER_GUIDE.md)
- [Mathematical Models](docs/MATHEMATICAL_MODELS.md)
- [Model Validation](docs/MODEL_VALIDATION.md)
- [Developer Guide](docs/DEVELOPMENT.md)
- [MIT License](LICENSE)
