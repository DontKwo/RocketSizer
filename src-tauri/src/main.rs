#![allow(clippy::all)]
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use rocket_sizer_core::commands::{
    cost_commands, database_commands, geometry_commands, propulsion_commands, sizing_commands,
};
use rocket_sizer_core::core::cost_engine::CostModelParameters;
use rocket_sizer_core::core::models::engine::ProvenanceEngine;
use rocket_sizer_core::core::models::vehicle::{
    SizingRequest, VehicleConfiguration, VehicleSizingResult,
};
use rocket_sizer_core::core::packaging::{EnginePlacementInput, PackingConstraints};
use serde::Deserialize;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(target_os = "windows")]
mod win_console {
    #[link(name = "kernel32")]
    extern "system" {
        fn AttachConsole(dw_process_id: u32) -> i32;
        fn FreeConsole() -> i32;
    }

    pub fn attach_parent_console_if_needed() {
        unsafe {
            let _ = AttachConsole(0xFFFFFFFF);
        }
    }

    pub fn detach_console() {
        unsafe {
            let _ = FreeConsole();
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod win_console {
    pub fn attach_parent_console_if_needed() {}
    pub fn detach_console() {}
}

#[cfg(target_os = "windows")]
mod win_window {
    use std::thread;
    use std::time::Duration;

    type HWND = *mut std::ffi::c_void;
    type BOOL = i32;
    type LPARAM = isize;
    type WNDENUMPROC = unsafe extern "system" fn(HWND, LPARAM) -> BOOL;

    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(lp_enum_func: WNDENUMPROC, lp_param: LPARAM) -> BOOL;
        fn GetWindowTextW(h_wnd: HWND, lp_string: *mut u16, n_max_count: i32) -> i32;
        fn SendMessageTimeoutW(
            h_wnd: HWND,
            msg: u32,
            w_param: usize,
            l_param: isize,
            fu_flags: u32,
            u_timeout: u32,
            lpdw_result: *mut usize,
        ) -> isize;
        fn LoadIconW(h_instance: *mut std::ffi::c_void, lp_icon_name: *const u16) -> *mut std::ffi::c_void;
        fn GetModuleHandleW(lp_module_name: *const u16) -> *mut std::ffi::c_void;
        fn IsWindowVisible(h_wnd: HWND) -> BOOL;
    }

    struct EnumContext {
        h_icon: *mut std::ffi::c_void,
        found: bool,
    }

    unsafe extern "system" fn enum_window_callback(h_wnd: HWND, l_param: LPARAM) -> BOOL {
        let ctx = &mut *(l_param as *mut EnumContext);
        if IsWindowVisible(h_wnd) == 0 {
            return 1;
        }
        let mut title_buf = [0_u16; 512];
        let len = GetWindowTextW(h_wnd, title_buf.as_mut_ptr(), 512);
        if len > 0 {
            let title = String::from_utf16_lossy(&title_buf[..len as usize]);
            if title.contains("RocketSizer") {
                const WM_SETICON: u32 = 0x0080;
                const ICON_SMALL: usize = 0;
                const ICON_BIG: usize = 1;
                SendMessageTimeoutW(
                    h_wnd,
                    WM_SETICON,
                    ICON_BIG,
                    ctx.h_icon as isize,
                    0x0002,
                    200,
                    std::ptr::null_mut(),
                );
                SendMessageTimeoutW(
                    h_wnd,
                    WM_SETICON,
                    ICON_SMALL,
                    ctx.h_icon as isize,
                    0x0002,
                    200,
                    std::ptr::null_mut(),
                );
                ctx.found = true;
            }
        }
        1
    }

    pub fn apply_icon_to_window() {
        thread::spawn(move || {
            let h_instance = unsafe { GetModuleHandleW(std::ptr::null()) };
            let h_icon = unsafe { LoadIconW(h_instance, 1 as *const u16) };
            if h_icon.is_null() {
                return;
            }
            for _ in 0..40 {
                let mut ctx = EnumContext {
                    h_icon,
                    found: false,
                };
                unsafe {
                    EnumWindows(enum_window_callback, &mut ctx as *mut EnumContext as isize);
                }
                if ctx.found {
                    thread::sleep(Duration::from_millis(500));
                    unsafe {
                        EnumWindows(enum_window_callback, &mut ctx as *mut EnumContext as isize);
                    }
                    break;
                }
                thread::sleep(Duration::from_millis(200));
            }
        });
    }
}

#[cfg(not(target_os = "windows"))]
mod win_window {
    #[allow(dead_code)]
    pub fn apply_icon_to_window() {}
}

struct ServerLifecycle {
    had_client: AtomicBool,
    last_activity_ms: AtomicU64,
    shutdown_requested_at_ms: AtomicU64,
    force_exit: AtomicBool,
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

const INDEX_HTML: &str = include_str!("../../src/dist/index.html");
const APP_CSS: &str = include_str!("../../src/dist/app.css");
const APP_JS: &str = include_str!("../../src/dist/app.js");
const APP_ICON_PNG: &[u8] = include_bytes!("../assets/icon.png");
const APP_ICON_ICO: &[u8] = include_bytes!("../assets/icon.ico");
const MANIFEST_JSON: &str = include_str!("../../src/dist/manifest.json");

#[derive(Deserialize)]
struct EvalManualArgs {
    config: VehicleConfiguration,
}

#[derive(Deserialize)]
struct CombSizingArgs {
    request: SizingRequest,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SensitivityArgs {
    baseline: VehicleConfiguration,
    sweep_parameter: String,
    range_min: f64,
    range_max: f64,
    steps: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackingArgs {
    stage_diameter: f64,
    engines: Vec<EnginePlacementInput>,
    constraints: PackingConstraints,
}

#[derive(Deserialize)]
struct CostArgs {
    vehicle: VehicleSizingResult,
    parameters: CostModelParameters,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RubberArgs {
    reference_engine: ProvenanceEngine,
    target_thrust_vac_n: f64,
    chamber_pressure_override_bar: Option<f64>,
}

fn dispatch_api(cmd: &str, body: &str) -> Result<String, String> {
    match cmd {
        "get_heritage_vehicles" => {
            let res = database_commands::get_heritage_vehicles()?;
            serde_json::to_string(&res).map_err(|e| e.to_string())
        }
        "get_heritage_engines" => {
            let res = database_commands::get_heritage_engines()?;
            serde_json::to_string(&res).map_err(|e| e.to_string())
        }
        "validate_heritage_models" => {
            let res = database_commands::validate_heritage_models()?;
            serde_json::to_string(&res).map_err(|e| e.to_string())
        }
        "evaluate_manual_architecture" => {
            let args: EvalManualArgs = serde_json::from_str(body).map_err(|e| e.to_string())?;
            let res = sizing_commands::evaluate_manual_architecture(args.config)?;
            serde_json::to_string(&res).map_err(|e| e.to_string())
        }
        "simulate_trajectory" => {
            let args: EvalManualArgs = serde_json::from_str(body).map_err(|e| e.to_string())?;
            let res = sizing_commands::simulate_trajectory(args.config)?;
            serde_json::to_string(&res).map_err(|e| e.to_string())
        }
        "run_combinatorial_sizing" => {
            let args: CombSizingArgs = serde_json::from_str(body).map_err(|e| e.to_string())?;
            let res = sizing_commands::run_combinatorial_sizing(args.request)?;
            serde_json::to_string(&res).map_err(|e| e.to_string())
        }
        "run_sensitivity_sweep" => {
            let args: SensitivityArgs = serde_json::from_str(body).map_err(|e| e.to_string())?;
            let res = sizing_commands::run_sensitivity_sweep(
                args.baseline,
                args.sweep_parameter,
                args.range_min,
                args.range_max,
                args.steps,
            )?;
            serde_json::to_string(&res).map_err(|e| e.to_string())
        }
        "solve_engine_circle_packing" => {
            let args: PackingArgs = serde_json::from_str(body).map_err(|e| e.to_string())?;
            let res = geometry_commands::solve_engine_circle_packing(
                args.stage_diameter,
                args.engines,
                args.constraints,
            )?;
            serde_json::to_string(&res).map_err(|e| e.to_string())
        }
        "compute_cost_model" => {
            let args: CostArgs = serde_json::from_str(body).map_err(|e| e.to_string())?;
            let res = cost_commands::compute_cost_model(args.vehicle, args.parameters)?;
            serde_json::to_string(&res).map_err(|e| e.to_string())
        }
        "scale_rubber_engine" => {
            let args: RubberArgs = serde_json::from_str(body).map_err(|e| e.to_string())?;
            let res = propulsion_commands::scale_rubber_engine(
                args.reference_engine,
                args.target_thrust_vac_n,
                args.chamber_pressure_override_bar,
            )?;
            serde_json::to_string(&res).map_err(|e| e.to_string())
        }
        _ => Err(format!("Unknown API command: {cmd}")),
    }
}

fn read_http_request(stream: &mut TcpStream) -> Option<(String, String, String)> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];
    let header_end;
    loop {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        buffer.extend_from_slice(&chunk[..n]);
        if let Some(pos) = buffer.windows(4).position(|w| w == b"\r\n\r\n") {
            header_end = pos + 4;
            break;
        }
        if buffer.len() > 1_048_576 {
            return None;
        }
    }

    let header_text = String::from_utf8_lossy(&buffer[..header_end]);
    let mut lines = header_text.lines();
    let req_line = lines.next()?;
    let mut parts = req_line.split_whitespace();
    let method = parts.next()?.to_string();
    let path = parts.next()?.split('?').next()?.to_string();

    let mut content_length = 0_usize;
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("content-length") {
                content_length = v.trim().parse::<usize>().unwrap_or(0);
            }
        }
    }

    while buffer.len() - header_end < content_length {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..n]);
    }

    let body_slice = &buffer[header_end..buffer.len().min(header_end + content_length)];
    let body = String::from_utf8_lossy(body_slice).to_string();
    Some((method, path, body))
}

fn write_http_response(stream: &mut TcpStream, status: &str, content_type: &str, body: &str) {
    let headers = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(headers.as_bytes());
    let _ = stream.write_all(body.as_bytes());
    let _ = stream.flush();
}

fn handle_client(mut stream: TcpStream, lifecycle: Option<&Arc<ServerLifecycle>>) {
    let Some((method, path, body)) = read_http_request(&mut stream) else {
        return;
    };

    if method == "OPTIONS" {
        write_http_response(&mut stream, "204 No Content", "text/plain", "");
        return;
    }

    if method == "GET" && (path == "/" || path == "/index.html") {
        if let Some(lc) = lifecycle {
            lc.had_client.store(true, Ordering::Relaxed);
            lc.last_activity_ms.store(now_epoch_ms(), Ordering::Relaxed);
            lc.shutdown_requested_at_ms.store(0, Ordering::Relaxed);
        }
        write_http_response(&mut stream, "200 OK", "text/html; charset=utf-8", INDEX_HTML);
        return;
    }

    if method == "GET" && path == "/app.css" {
        write_http_response(&mut stream, "200 OK", "text/css; charset=utf-8", APP_CSS);
        return;
    }

    if method == "GET" && path == "/app.js" {
        write_http_response(
            &mut stream,
            "200 OK",
            "application/javascript; charset=utf-8",
            APP_JS,
        );
        return;
    }

    if method == "GET" && path == "/favicon.ico" {
        let headers = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: image/x-icon\r\nContent-Length: {}\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\n\r\n",
            APP_ICON_ICO.len()
        );
        let _ = stream.write_all(headers.as_bytes());
        let _ = stream.write_all(APP_ICON_ICO);
        let _ = stream.flush();
        return;
    }

    if method == "GET"
        && (path == "/icon.png"
            || path == "/assets/icon.png"
            || path == "/apple-touch-icon.png"
            || path == "/apple-touch-icon-precomposed.png"
            || path == "/icon-192.png"
            || path == "/icon-512.png")
    {
        let headers = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {}\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\n\r\n",
            APP_ICON_PNG.len()
        );
        let _ = stream.write_all(headers.as_bytes());
        let _ = stream.write_all(APP_ICON_PNG);
        let _ = stream.flush();
        return;
    }

    if method == "GET" && path == "/manifest.json" {
        write_http_response(
            &mut stream,
            "200 OK",
            "application/manifest+json; charset=utf-8",
            MANIFEST_JSON,
        );
        return;
    }

    if method == "POST" && path == "/api/heartbeat" {
        if let Some(lc) = lifecycle {
            lc.had_client.store(true, Ordering::Relaxed);
            lc.last_activity_ms.store(now_epoch_ms(), Ordering::Relaxed);
            lc.shutdown_requested_at_ms.store(0, Ordering::Relaxed);
        }
        write_http_response(&mut stream, "200 OK", "application/json", "{\"ok\":true}");
        return;
    }

    if method == "POST" && path == "/api/shutdown" {
        if let Some(lc) = lifecycle {
            if body.contains("immediate") {
                lc.force_exit.store(true, Ordering::Relaxed);
            }
            let cur = lc.shutdown_requested_at_ms.load(Ordering::Relaxed);
            if cur == 0 {
                lc.shutdown_requested_at_ms.store(now_epoch_ms(), Ordering::Relaxed);
            }
        }
        write_http_response(&mut stream, "200 OK", "application/json", "{\"ok\":true}");
        return;
    }

    if method == "POST" {
        if let Some(lc) = lifecycle {
            lc.had_client.store(true, Ordering::Relaxed);
            lc.last_activity_ms.store(now_epoch_ms(), Ordering::Relaxed);
        }
        if let Some(cmd) = path.strip_prefix("/api/") {
            match dispatch_api(cmd, &body) {
                Ok(json_out) => {
                    write_http_response(&mut stream, "200 OK", "application/json", &json_out);
                }
                Err(err_msg) => {
                    let err_json = serde_json::json!({ "error": err_msg }).to_string();
                    write_http_response(&mut stream, "400 Bad Request", "application/json", &err_json);
                }
            }
            return;
        }
    }

    write_http_response(&mut stream, "404 Not Found", "text/plain", "Not Found");
}

#[cfg(target_os = "windows")]
fn find_app_browser_windows() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    for env_key in ["ProgramFiles(x86)", "ProgramFiles", "LocalAppData"] {
        if let Ok(base) = std::env::var(env_key) {
            let root = PathBuf::from(base);
            candidates.push(root.join("Microsoft").join("Edge").join("Application").join("msedge.exe"));
            candidates.push(root.join("Google").join("Chrome").join("Application").join("chrome.exe"));
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn find_app_browser_linux() -> Option<PathBuf> {
    let candidates = [
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
        "microsoft-edge",
        "microsoft-edge-stable",
        "brave-browser",
    ];
    for cmd in candidates {
        if let Ok(output) = Command::new("which").arg(cmd).output() { // noqa: 32
            if output.status.success() {
                let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path_str.is_empty() {
                    return Some(PathBuf::from(path_str));
                }
            }
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn find_app_browser_macos() -> Option<PathBuf> {
    let candidates = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
    for path in candidates {
        let p = PathBuf::from(path);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

fn launch_desktop_window(url: &str, port: u16) -> Option<Child> {
    #[cfg(target_os = "windows")]
    {
        if let Some(browser) = find_app_browser_windows() {
            let app_arg = format!("--app={url}");
            let profile_dir = std::env::temp_dir().join(format!("rocket_sizer_app_window_{port}"));
            let default_dir = profile_dir.join("Default");
            let _ = std::fs::create_dir_all(&default_dir);

            let _ = std::fs::write(default_dir.join("Edge Profile Picture.png"), APP_ICON_PNG);
            let _ = std::fs::write(default_dir.join("Google Profile Picture.png"), APP_ICON_PNG);
            let _ = std::fs::write(default_dir.join("Custom Profile Normal.png"), APP_ICON_PNG);
            let prefs_file = default_dir.join("Preferences");
            let _ = std::fs::write(
                prefs_file,
                r#"{"profile":{"name":"RocketSizer","using_default_avatar":false,"use_gaia_avatar":true}}"#,
            );
            let local_state_file = profile_dir.join("Local State");
            let _ = std::fs::write(
                local_state_file,
                r#"{"profile":{"info_cache":{"Default":{"name":"RocketSizer","gaia_picture_file_name":"Edge Profile Picture.png","use_gaia_picture":true,"is_using_default_avatar":false}}}}"#,
            );

            let profile_arg = format!("--user-data-dir={}", profile_dir.display());
            let child = Command::new(browser)
                .args([
                    app_arg.as_str(),
                    "--start-maximized",
                    "--profile-directory=Default",
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--disable-sync",
                    "--disable-features=msEdgeProfileAvatarBadge,ProfileAvatarBadge,msEdgeIdentity,msEdgeAutoSignIn,msSignIn",
                    profile_arg.as_str(),
                ])
                .spawn()
                .ok();
            win_window::apply_icon_to_window();
            return child;
        }
        Command::new("cmd").args(["/C", "start", "", url]).spawn().ok() // noqa: 32
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(browser) = find_app_browser_macos() {
            let app_arg = format!("--app={url}");
            let profile_dir = std::env::temp_dir().join(format!("rocket_sizer_app_window_{port}"));
            let profile_arg = format!("--user-data-dir={}", profile_dir.display());
            if let Ok(child) = Command::new(browser)
                .args([
                    app_arg.as_str(),
                    "--start-maximized",
                    "--no-first-run",
                    "--no-default-browser-check",
                    profile_arg.as_str(),
                ])
                .spawn() // noqa: 32
            {
                return Some(child);
            }
        }
        Command::new("open").arg(url).spawn().ok() // noqa: 32
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if let Some(browser) = find_app_browser_linux() {
            let app_arg = format!("--app={url}");
            let profile_dir = std::env::temp_dir().join(format!("rocket_sizer_app_window_{port}"));
            let profile_arg = format!("--user-data-dir={}", profile_dir.display());
            if let Ok(child) = Command::new(browser)
                .args([
                    app_arg.as_str(),
                    "--start-maximized",
                    "--no-first-run",
                    "--no-default-browser-check",
                    profile_arg.as_str(),
                ])
                .spawn() // noqa: 32
            {
                return Some(child);
            }
        }
        Command::new("xdg-open").arg(url).spawn().ok() // noqa: 32
    }
}

fn shutdown_existing_instance(port: u16) {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    if let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(150)) {
        let body = "{\"immediate\":true}";
        let req = format!(
            "POST /api/shutdown HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = stream.write_all(req.as_bytes());
        let _ = stream.flush();
        drop(stream);
        thread::sleep(Duration::from_millis(200));
    }
}

fn send_test_request(port: u16, method: &str, path: &str, body: &str) -> Result<String, String> {
    let mut stream =
        TcpStream::connect(("127.0.0.1", port)).map_err(|e| format!("Connect failed: {e}"))?;
    let req = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("Write failed: {e}"))?;
    let mut raw = String::new();
    stream
        .read_to_string(&mut raw)
        .map_err(|e| format!("Read failed: {e}"))?;
    Ok(raw)
}

fn run_self_test() -> Result<(), String> {
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Bind failed: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Addr failed: {e}"))?
        .port();
    let stop = Arc::new(AtomicBool::new(false));
    let stop_flag = Arc::clone(&stop);
    listener.set_nonblocking(true).ok();

    let server_handle = thread::spawn(move || {
        while !stop_flag.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => {
                    stream.set_nonblocking(false).ok();
                    handle_client(stream, None);
                }
                Err(_) => thread::sleep(Duration::from_millis(10)),
            }
        }
    });

    let html_resp = send_test_request(port, "GET", "/", "")?;
    if !html_resp.contains("200 OK") || !html_resp.contains("<div id=\"root\">") {
        stop.store(true, Ordering::Relaxed);
        let _ = server_handle.join();
        return Err("Root HTML response failed verification".to_string());
    }

    let veh_resp = send_test_request(port, "POST", "/api/get_heritage_vehicles", "{}")?;
    if !veh_resp.contains("200 OK") || !veh_resp.contains("falcon_9") {
        stop.store(true, Ordering::Relaxed);
        let _ = server_handle.join();
        return Err("Heritage vehicles API failed verification".to_string());
    }

    let sample_cfg = serde_json::json!({
        "config": {
            "name": "SelfTest Two-Stage",
            "payload_mass_kg": 18500.0,
            "payload_diameter_m": 4.5,
            "payload_length_m": 11.0,
            "orbit": {
                "preset": "custom",
                "altitude_m": 185200.0,
                "perigee_altitude_m": 185200.0,
                "apogee_altitude_m": 370400.0,
                "eccentricity": 0.0139,
                "inclination_deg": 28.5,
                "launch_latitude_deg": 28.5,
                "launch_azimuth_deg": 90.0,
                "insertion_margin_m_s": 150.0,
                "coast_duration_s": 0.0
            },
            "required_delta_v_m_s": null,
            "core_diameter_m": 3.7,
            "stage_count": 2,
            "booster_engine_id": null,
            "booster_count": 0,
            "stages": [
                {
                    "stage_number": 1,
                    "engine_id": "merlin_1d",
                    "engine_count": 9,
                    "structural_mass_fraction_override": null,
                    "tank_material": "al_li2195",
                    "pressurization": "helium_copv",
                    "common_bulkhead": true,
                    "delta_v_split_frac": 0.38,
                    "recovery_mode": "downrange_landing_asds"
                },
                {
                    "stage_number": 2,
                    "engine_id": "merlin_1d_vac",
                    "engine_count": 1,
                    "structural_mass_fraction_override": null,
                    "tank_material": "al_li2195",
                    "pressurization": "helium_copv",
                    "common_bulkhead": true,
                    "delta_v_split_frac": 0.62,
                    "recovery_mode": "expendable"
                }
            ],
            "staging_mode": "cold_pneumatic_ullage",
            "cryo_state": "subcooled_densified",
            "fairing_profile": "von_karman",
            "fairing_reusable": true,
            "mass_margin_frac": 0.25,
            "max_q_throttle_frac": 0.72,
            "max_q_bucket_duration_s": 24.0,
            "g_limit": 4.5,
            "expected_reuses": 10,
            "production_quantity": 20,
            "constraints": {
                "max_cost_usd": 95000000.0,
                "max_glow_kg": 900000.0,
                "min_glow_kg": 1000.0,
                "max_core_diameter_m": 10.5,
                "max_total_height_m": 115.0,
                "max_g_limit": 4.5,
                "max_core_engines": 33,
                "max_upper_engines": 6,
                "allowed_booster_counts": [0, 2, 3, 4, 6],
                "min_liftoff_tw0": 1.2,
                "max_liftoff_tw0": 1.6,
                "min_upper_tw0": 0.25,
                "max_upper_tw0": 1.45,
                "enforce_base_packing": true
            },
            "custom_engines": []
        }
    })
    .to_string();

    let eval_resp =
        send_test_request(port, "POST", "/api/evaluate_manual_architecture", &sample_cfg)?;
    if !eval_resp.contains("200 OK") || !eval_resp.contains("\"glow_kg\"") {
        stop.store(true, Ordering::Relaxed);
        let _ = server_handle.join();
        return Err(format!("Evaluate API failed: {eval_resp}"));
    }

    let val_resp = send_test_request(port, "POST", "/api/validate_heritage_models", "{}")?;
    if !val_resp.contains("200 OK") || !val_resp.contains("\"structural_mape_pct\"") {
        stop.store(true, Ordering::Relaxed);
        let _ = server_handle.join();
        return Err(format!("Validation API failed: {val_resp}"));
    }

    stop.store(true, Ordering::Relaxed);
    let _ = server_handle.join();
    println!("Self-test passed."); // noqa: 25
    Ok(())
}

fn parse_screenshot_arg(args: &[String]) -> Option<String> {
    let mut i = 0;
    while i < args.len() {
        if args[i] == "--screenshot" && i + 1 < args.len() {
            return Some(args[i + 1].clone());
        }
        if let Some(rest) = args[i].strip_prefix("--screenshot=") {
            if !rest.is_empty() {
                return Some(rest.to_string());
            }
        }
        i += 1;
    }
    None
}

fn find_any_headless_browser() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        return find_app_browser_windows();
    }
    #[cfg(target_os = "macos")]
    {
        return find_app_browser_macos();
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        return find_app_browser_linux();
    }
}

fn run_headless_server() -> Result<(), String> {
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Bind failed: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Addr failed: {e}"))?
        .port();
    println!("READY http://127.0.0.1:{port}"); // noqa: 25
    let _ = std::io::stdout().flush();
    for stream in listener.incoming().flatten() {
        thread::spawn(move || handle_client(stream, None));
    }
    Ok(())
}

fn run_screenshot(raw_out: &str) -> Result<(), String> {
    let browser = find_any_headless_browser()
        .ok_or_else(|| "No Chrome/Chromium/Edge browser found for --screenshot".to_string())?;
    let out_path = PathBuf::from(raw_out);
    if let Some(parent) = out_path.parent() {
        if !parent.as_os_str().is_empty() {
            let _ = std::fs::create_dir_all(parent);
        }
    }
    let resolved = std::fs::canonicalize(out_path.parent().unwrap_or_else(|| std::path::Path::new(".")))
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(out_path.file_name().unwrap_or_else(|| std::ffi::OsStr::new("screenshot.png")));

    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Bind failed: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Addr failed: {e}"))?
        .port();
    let stop = Arc::new(AtomicBool::new(false));
    let stop_flag = Arc::clone(&stop);
    listener.set_nonblocking(true).ok();

    let server_handle = thread::spawn(move || {
        while !stop_flag.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => {
                    stream.set_nonblocking(false).ok();
                    handle_client(stream, None);
                }
                Err(_) => thread::sleep(Duration::from_millis(10)),
            }
        }
    });

    let profile_dir = std::env::temp_dir().join(format!("rocket_sizer_shot_{port}"));
    let _ = std::fs::create_dir_all(&profile_dir);
    let shot_arg = format!("--screenshot={}", resolved.display());
    let user_data_arg = format!("--user-data-dir={}", profile_dir.display());
    let target_url = format!("http://127.0.0.1:{port}/");

    let status = Command::new(browser) // noqa: 32
        .args([
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-background-networking",
            "--no-first-run",
            "--no-default-browser-check",
            "--window-size=1440,900",
            "--virtual-time-budget=5000",
            user_data_arg.as_str(),
            shot_arg.as_str(),
            target_url.as_str(),
        ])
        .status()
        .map_err(|e| format!("Failed to invoke browser: {e}"));

    stop.store(true, Ordering::Relaxed);
    let _ = server_handle.join();
    let _ = std::fs::remove_dir_all(&profile_dir);

    let exit_status = status?;
    if !exit_status.success() {
        return Err(format!("Headless browser exited with {exit_status}"));
    }
    if !resolved.is_file() {
        return Err(format!("Screenshot file not created at {}", resolved.display()));
    }
    println!("Saved screenshot to {}", resolved.display()); // noqa: 25
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--self-test") {
        win_console::attach_parent_console_if_needed();
        if let Err(err) = run_self_test() {
            eprintln!("Self-test failed: {err}");
            std::process::exit(1);
        }
        return;
    }
    if args.iter().any(|a| a == "--headless-server") {
        win_console::attach_parent_console_if_needed();
        if let Err(err) = run_headless_server() {
            eprintln!("Headless server failed: {err}");
            std::process::exit(1);
        }
        return;
    }
    if let Some(shot_path) = parse_screenshot_arg(&args[1..]) {
        win_console::attach_parent_console_if_needed();
        if let Err(err) = run_screenshot(&shot_path) {
            eprintln!("Screenshot failed: {err}");
            std::process::exit(1);
        }
        return;
    }

    win_console::detach_console();
    shutdown_existing_instance(1420);

    let listener = TcpListener::bind("127.0.0.1:1420")
        .or_else(|_| TcpListener::bind("127.0.0.1:0"))
        .expect("Failed to bind local RocketSizer server port");
    listener.set_nonblocking(true).ok();
    let port = listener
        .local_addr()
        .expect("Failed to read bound socket address")
        .port();
    let url = format!("http://127.0.0.1:{port}");

    let no_browser = args.iter().any(|a| a == "--no-browser");
    let _child_proc = if no_browser {
        None
    } else {
        launch_desktop_window(&url, port)
    };

    let lifecycle = Arc::new(ServerLifecycle {
        had_client: AtomicBool::new(false),
        last_activity_ms: AtomicU64::new(now_epoch_ms()),
        shutdown_requested_at_ms: AtomicU64::new(0),
        force_exit: AtomicBool::new(false),
    });
    let started_ms = now_epoch_ms();

    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                stream.set_nonblocking(false).ok();
                let lc = Arc::clone(&lifecycle);
                thread::spawn(move || handle_client(stream, Some(&lc)));
            }
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(25));
            }
            Err(_) => {
                thread::sleep(Duration::from_millis(25));
            }
        }

        if lifecycle.force_exit.load(Ordering::Relaxed) {
            break;
        }

        let now = now_epoch_ms();
        let shut_at = lifecycle.shutdown_requested_at_ms.load(Ordering::Relaxed);
        if shut_at > 0 && now.saturating_sub(shut_at) >= 1200 {
            break;
        }

        let had_c = lifecycle.had_client.load(Ordering::Relaxed);
        let last_act = lifecycle.last_activity_ms.load(Ordering::Relaxed);
        if had_c {
            if now.saturating_sub(last_act) > 10000 {
                break;
            }
        } else if now.saturating_sub(started_ms) > 60000 {
            break;
        }
    }

    std::process::exit(0);
}
