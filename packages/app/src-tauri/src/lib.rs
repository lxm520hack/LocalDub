use std::fs;
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

fn repo_root() -> PathBuf {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    dir.parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or(dir)
}

struct TorchProc(Mutex<Option<Child>>);
struct VoxCpmProc(Mutex<Option<Child>>);

/// Find an available TCP port starting from `preferred`.
fn find_available_port(preferred: u16) -> u16 {
    for port in preferred..=preferred + 100 {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
    preferred // give up, let the server fail
}

/// Spawn a Python server script, read PORT=N from stdout, return (child, port).
fn spawn_python_server(
    script: &std::path::Path,
    port_flag: &str,
    extra_args: &[&str],
    extra_env: Vec<(&str, &str)>,
    preferred_port: u16,
) -> Result<(Child, u16), String> {
    let actual_port = find_available_port(preferred_port);
    let py_bin = repo_root().join(".venv").join("bin").join("python");
    if !py_bin.exists() {
        return Err(format!("Python binary not found at {}", py_bin.display()));
    }

    let mut cmd = Command::new(&py_bin);
    cmd.arg(script).arg(port_flag).arg(actual_port.to_string());
    for a in extra_args { cmd.arg(a); }
    for (k, v) in extra_env { cmd.env(k, v); }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn server: {}", e))?;

    // Read PORT=N from stdout
    let port = child.stdout.take()
        .and_then(|stdout| {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            reader.read_line(&mut line).ok()?;
            line.trim().strip_prefix("PORT=")?.parse::<u16>().ok()
        })
        .unwrap_or(actual_port);

    Ok((child, port))
}

#[tauri::command]
fn start_torch(state: tauri::State<'_, TorchProc>) -> Result<u16, String> {
    let mut guard = state.0.lock().map_err(|e| format!("Lock error: {}", e))?;

    if let Some(ref mut child) = *guard {
        if matches!(child.try_wait(), Ok(None)) {
            return Err("Already running".into());
        }
        *guard = None;
    }

    if !repo_root().join("packages").join("torch_server").join("pytorch_server.py").exists() {
        return Err("Torch server script not found".into());
    }

    let script = repo_root().join("packages").join("torch_server").join("pytorch_server.py");
    let voxcpm_src = repo_root().join("submodule").join("VoxCPM").join("src");

    let (child, port) = spawn_python_server(
        &script, "--http-port", &[],
        vec![("TORCHAUDIO_USE_BACKEND", "soundfile"),
             ("PYTHONPATH", voxcpm_src.to_str().unwrap_or(""))],
        19109,
    )?;

    *guard = Some(child);
    Ok(port)
}

#[tauri::command]
fn stop_torch(state: tauri::State<'_, TorchProc>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| format!("Lock error: {}", e))?;

    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }

    Ok(())
}

#[tauri::command]
fn check_torch(state: tauri::State<'_, TorchProc>) -> bool {
    let mut guard = match state.0.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };

    match *guard {
        Some(ref mut child) => matches!(child.try_wait(), Ok(None)),
        None => false,
    }
}

#[tauri::command]
fn start_voxcpm(state: tauri::State<'_, VoxCpmProc>) -> Result<u16, String> {
    let mut guard = state.0.lock().map_err(|e| format!("Lock error: {}", e))?;
    if let Some(ref mut child) = *guard {
        if matches!(child.try_wait(), Ok(None)) { return Err("Already running".into()); }
        *guard = None;
    }

    if !repo_root().join("packages").join("voxcpm_torch_server").join("server.py").exists() {
        return Err("VoxCPM server script not found".into());
    }

    let script = repo_root().join("packages").join("voxcpm_torch_server").join("server.py");

    let (child, port) = spawn_python_server(&script, "--port", &["--device", "cpu"], vec![], 19112)?;

    *guard = Some(child);
    Ok(port)
}

#[tauri::command]
fn stop_voxcpm(state: tauri::State<'_, VoxCpmProc>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| format!("Lock error: {}", e))?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

#[tauri::command]
fn device_info() -> Result<String, String> {
    let cli = repo_root()
        .join("packages")
        .join("device")
        .join("cli.ts");
    let output = Command::new("bun")
        .arg(cli.to_str().unwrap_or(""))
        .arg("--json")
        .output()
        .map_err(|e| format!("Failed to run device CLI: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Device CLI failed: {}", stderr));
    }
    String::from_utf8(output.stdout).map_err(|e| format!("Invalid UTF-8: {}", e))
}

fn input_json_path() -> PathBuf {
    repo_root()
        .join("packages")
        .join("cli")
        .join("input.json")
}

fn input_schema_path() -> PathBuf {
    repo_root()
        .join("packages")
        .join("cli")
        .join("input.schema.json")
}

#[tauri::command]
fn read_input() -> Result<String, String> {
    let path = input_json_path();
    fs::read_to_string(&path).map_err(|e| format!("Failed to read input.json: {}", e))
}

#[tauri::command]
fn write_input(content: String) -> Result<(), String> {
    let path = input_json_path();
    fs::write(&path, &content).map_err(|e| format!("Failed to write input.json: {}", e))
}

#[tauri::command]
fn read_input_schema() -> Result<String, String> {
    let path = input_schema_path();
    fs::read_to_string(&path).map_err(|e| format!("Failed to read input.schema.json: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(TorchProc(Mutex::new(None)))
        .manage(VoxCpmProc(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            start_torch, stop_torch, check_torch,
            start_voxcpm, stop_voxcpm,
            device_info, read_input, write_input, read_input_schema,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
