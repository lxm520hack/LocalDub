mod commands;
pub mod router;
mod server;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let router = crate::router::build();
    let (procedures, _types) = router.build().expect("rspc router build failed");
    let app_state = AppState::new();

    // Axum HTTP server for mobile web browser access
    let axum_procedures = procedures.clone();
    let axum_state = app_state.clone();
    let dist_dir = app_state.repo_root.join("packages").join("app").join("dist");
    tauri::async_runtime::spawn(async move {
        crate::server::start(axum_procedures, axum_state, dist_dir, 19110).await;
    });

    // Tauri desktop with tauri-plugin-rspc
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_rspc::init(
            procedures,
            move |_window: tauri::Window| app_state.clone(),
        ))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
