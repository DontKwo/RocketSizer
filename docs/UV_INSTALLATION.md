# Developer uv Installation Guide

> **For Everyday Users**: You do **not** need `uv`, Rust, Node.js, or command-line tools to use `RocketSizer`. Download the standalone binary from the [Download Table](../README.md#download).

Developers running the repository's strict linter and Markdown link validation tools (`ai-dev-tools`) use [Astral `uv`](https://docs.astral.sh/uv/).

---

## Platform Instructions

### Windows

Install `uv` using PowerShell or winget:

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
winget install --id=astral-sh.uv -e
```

---

### macOS

Install `uv` using the standalone installer or Homebrew:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
brew install uv
```

---

### Linux

Install `uv` using the official standalone installer:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Confirm installation with `uv --version`.

---

## Related Documentation

- [Project Overview](../README.md)
- [Developer Guide](DEVELOPMENT.md)
- [Desktop Installation Guide](INSTALLATION.md)
- [Security Policy](../SECURITY.md)
