use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn find_rc_exe() -> Option<PathBuf> {
    if let Ok(custom) = env::var("RC") {
        let path = PathBuf::from(custom);
        if path.is_file() {
            return Some(path);
        }
    }
    let kits_root = PathBuf::from(env::var("ProgramFiles(x86)").ok()?)
        .join("Windows Kits")
        .join("10")
        .join("bin");
    let mut versions: Vec<PathBuf> = fs::read_dir(&kits_root)
        .ok()?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| path.is_dir())
        .collect();
    versions.sort();
    versions.reverse();
    for dir in versions {
        let candidate = dir.join("x64").join("rc.exe");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    let direct_candidate = kits_root.join("x64").join("rc.exe");
    direct_candidate.is_file().then_some(direct_candidate)
}

fn main() {
    println!("cargo:rerun-if-changed=assets/app.rc");
    println!("cargo:rerun-if-changed=assets/icon.ico");
    println!("cargo:rerun-if-changed=build.rs");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows")
        || env::var("CARGO_CFG_TARGET_ENV").as_deref() != Ok("msvc")
    {
        return;
    }
    let Some(rc_exe) = find_rc_exe() else {
        println!("cargo:warning=rc.exe not found; RocketSizer.exe will have no embedded icon");
        return;
    };
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR not set"));
    let res_path = out_dir.join("app.res");
    let assets_dir = Path::new("assets");
    let status = Command::new(&rc_exe)
        .current_dir(assets_dir)
        .arg("/nologo")
        .arg("/fo")
        .arg(&res_path)
        .arg("app.rc")
        .status()
        .expect("failed to launch rc.exe");
    if !status.success() {
        println!("cargo:warning=rc.exe failed; RocketSizer.exe will have no embedded icon");
        return;
    }
    println!("cargo:rustc-link-arg-bins={}", res_path.display());
}
