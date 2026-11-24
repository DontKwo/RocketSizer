# Desktop Installation Guide

Install and launch `RocketSizer` on your computer without Rust, Cargo, or Node.js setup.

---

## Platform Instructions

### Windows

1. Download `RocketSizer-Windows.exe` from [Latest Releases](https://github.com/DontKwo/RocketSizer/releases/latest).
2. Double-click `RocketSizer-Windows.exe` to open the desktop application window automatically.
3. If **Microsoft Defender SmartScreen** shows *"Windows protected your PC"*:
   - Click **More info**.
   - Confirm the binary came from `DontKwo/RocketSizer`, then click **Run anyway** at your own discretion.
4. Alternative unblock method: Right-click `RocketSizer-Windows.exe` -> **Properties** -> check **Unblock** under Security -> click **Apply** and **OK** -> launch normally.

---

### macOS

1. Download `RocketSizer-macOS.zip` from [Latest Releases](https://github.com/DontKwo/RocketSizer/releases/latest).
2. Double-click `RocketSizer-macOS.zip` to extract the `RocketSizer` universal executable (Apple Silicon and Intel).
3. On macOS Sonoma and Sequoia, approve an independently distributed binary in **System Settings**:
   - Control-click **Open** once so macOS registers the notice, then click **OK** (or **Done**).
   - Open **System Settings** -> **Privacy & Security** -> scroll to **Security** and click **Open Anyway** at your own discretion.
4. Developer Terminal Alternative: run `xattr -cr ./RocketSizer && chmod +x ./RocketSizer && ./RocketSizer`.

---

### Linux

1. Download `RocketSizer-Linux.tar.gz` from [Latest Releases](https://github.com/DontKwo/RocketSizer/releases/latest).
2. Extract the archive (`tar -xzf RocketSizer-Linux.tar.gz`).
3. Ensure execute permission (`chmod +x RocketSizer-Linux`) and run `./RocketSizer-Linux`.

---

## Safety & Authenticity Warning

- **Official `main` Releases Only**: Download `RocketSizer` exclusively from [DontKwo/RocketSizer Releases](https://github.com/DontKwo/RocketSizer/releases/latest).
- **Fork Warning**: Do **not** download or run executables from forked repositories unless you have verified the source code yourself and confirmed they contain no malware. Only official `main` releases are maintained by the author, and I make no promises.
- **Bypassing Security Prompts**: Because independent open-source executables do not carry paid commercial signing certificates, Windows and macOS will warn that the app is unrecognized or potentially unsafe. Bypassing these prompts is strictly at your own discretion, and the software is provided "AS IS" with zero liability.

---

## Related Documentation

- [Project Overview](../README.md)
- [User Guide](USER_GUIDE.md)
- [Frequently Asked Questions](FAQ.md)
- [System Architecture](ARCHITECTURE.md)
- [Developer Guide](DEVELOPMENT.md)
- [Security Policy](../SECURITY.md)
