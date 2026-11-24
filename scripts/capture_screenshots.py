"""Capture crisp 1440x900 UI screenshots for RocketSizer."""

from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import sys
import time
from typing import Any

from playwright.sync_api import sync_playwright

REPO_DIR = Path(__file__).resolve().parent.parent


def _find_binary(explicit: Path | None) -> Path:
    if explicit is not None:
        resolved = explicit.expanduser().resolve()
        if resolved.is_file():
            return resolved
        raise FileNotFoundError(f"RocketSizer binary not found at {resolved}")
    candidates = [
        REPO_DIR / "src-tauri" / "target" / "release" / "rocket_sizer_desktop.exe",
        REPO_DIR / "src-tauri" / "target" / "release" / "rocket_sizer_desktop",
        REPO_DIR / "src-tauri" / "target" / "debug" / "rocket_sizer_desktop.exe",
        REPO_DIR / "src-tauri" / "target" / "debug" / "rocket_sizer_desktop",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError("Compiled rocket_sizer_desktop binary not found; build with cargo first.")


def _launch_browser(pw: Any) -> Any:
    try:
        return pw.chromium.launch(headless=True)
    except Exception:  # noqa: 10
        return pw.chromium.launch(channel="msedge", headless=True)


def capture_screenshots(out_dir: Path, binary: Path) -> None:
    """Launch headless RocketSizer desktop backend and capture viewport screenshots."""
    out_resolved = out_dir.expanduser().resolve()
    out_resolved.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(  # noqa: 32
        [str(binary), "--headless-server"],
        cwd=str(REPO_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        url = ""
        deadline = time.monotonic() + 25.0
        while time.monotonic() < deadline and proc.stdout is not None:
            line = proc.stdout.readline().strip()
            if line.startswith("READY "):
                url = line.split(" ", 1)[1].strip()
                break
        if not url:
            raise RuntimeError("RocketSizer headless server failed to emit READY URL.")

        with sync_playwright() as pw:
            browser = _launch_browser(pw)
            context = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
            page = context.new_page()
            page.goto(url, wait_until="networkidle")
            page.wait_for_selector('#opt\\.run_search_btn', timeout=25000)
            page.wait_for_function(
                "() => { const b = document.getElementById('opt.run_search_btn'); return b && !b.disabled && b.textContent.includes('Run Search'); }",
                timeout=35000,
            )
            page.wait_for_timeout(900)
            page.screenshot(path=str(out_resolved / "01_main.png"), full_page=False)

            page.locator("header button", has_text="Single Config Evaluator").click()
            page.wait_for_timeout(1200)
            page.screenshot(path=str(out_resolved / "02_sizing_studio.png"), full_page=False)
            context.close()
            browser.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def main() -> int:
    parser = argparse.ArgumentParser(description="Capture RocketSizer desktop UI screenshots.")
    parser.add_argument("--out-dir", type=Path, default=REPO_DIR / "assets" / "screenshots")
    parser.add_argument("--binary", type=Path, default=None, help="Path to rocket_sizer_desktop executable")
    args = parser.parse_args()
    binary = _find_binary(args.binary)
    capture_screenshots(args.out_dir, binary)
    sys.stdout.write(f"Saved screenshots into {args.out_dir}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
