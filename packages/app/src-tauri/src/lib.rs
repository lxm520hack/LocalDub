pub mod commands;
pub mod func;
pub mod router;
mod server;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // fnRPC router (independent from rspc)
    let fnrpc_router = crate::func::build_fn_rpc();

    // rspc router (legacy)
    let rspc_router = crate::router::build();
    let (procedures, _types) = rspc_router.build().expect("rspc router build failed");

    let app_state = AppState::new();

    // Axum HTTP server for mobile web browser access
    let axum_procedures = procedures.clone();
    let axum_state = app_state.clone();
    let axum_fnrpc = fnrpc_router.clone();
    let dist_dir = app_state.repo_root.join("packages").join("app").join("dist");
    tauri::async_runtime::spawn(async move {
        crate::server::start(axum_procedures, axum_state, axum_fnrpc, dist_dir, 19110).await;
    });

    let app_state_for_manage = app_state.clone();

    // Tauri desktop
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_rspc::init(
            procedures,
            move |_window: tauri::Window| app_state.clone(),
        ))
        .manage(fnrpc_router)
        .manage(app_state_for_manage)
        .invoke_handler(tauri::generate_handler![commands::rpc_fn])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
