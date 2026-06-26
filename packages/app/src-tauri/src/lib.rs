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

#[tauri::command]
fn start_torch(state: tauri::State<'_, TorchProc>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| format!("Lock error: {}", e))?;

    if let Some(ref mut child) = *guard {
        if matches!(child.try_wait(), Ok(None)) {
            return Ok(()); // already running
        }
        // process exited, clean up stale handle
        *guard = None;
    }

    let repo = repo_root();
    let py_bin = repo.join(".venv").join("bin").join("python");
    let script = repo
        .join("packages")
        .join("cli")
        .join("src")
        .join("ml")
        .join("server")
        .join("pytorch_server.py");
    let voxcpm_src = repo.join("submodule").join("VoxCPM").join("src");

    if !py_bin.exists() {
        return Err(format!("Python binary not found at {}", py_bin.display()));
    }
    if !script.exists() {
        return Err(format!("Script not found at {}", script.display()));
    }

    let child = Command::new(&py_bin)
        .arg(&script)
        .arg("--http-port")
        .arg("19109")
        .env("TORCHAUDIO_USE_BACKEND", "soundfile")
        .env(
            "PYTHONPATH",
            voxcpm_src.to_str().unwrap_or(""),
        )
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start torch server: {}", e))?;

    *guard = Some(child);
    Ok(())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(TorchProc(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![start_torch, stop_torch, check_torch])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
