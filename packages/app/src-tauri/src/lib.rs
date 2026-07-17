pub mod commands;
mod ctx;
pub mod func;
pub mod integrations;
pub mod feat;
// pub mod router;
mod server;
use ctx::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt().with_env_filter("info").init();

    // fnRPC router (independent from rspc)
    let fnrpc_router = crate::integrations::fnrpc_func::build_fn_rpc_router()
        .layer(fnrpc::middleware::TracingLayer);

    // rspc router (legacy)
    // let rspc_router = crate::router::build();
    // let (procedures, _types) = rspc_router.build().expect("rspc router build failed");

    let app_state = AppState::new();

    // Axum HTTP server for mobile web browser access
    // let axum_procedures = procedures.clone();
    let axum_state = app_state.clone();
    let axum_fnrpc = fnrpc_router.clone();
    let dist_dir = app_state
        .repo_root
        .join("packages")
        .join("app")
        .join("dist");
    tauri::async_runtime::spawn(async move {
        crate::server::start(axum_state, axum_fnrpc, dist_dir, 19110).await;
    });

    let app_state_for_manage = app_state.clone();

    // Tauri desktop
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // .plugin(tauri_plugin_rspc::init(
        //     procedures,
        //     move |_window: tauri::Window| app_state.clone(),
        // ))
        .manage(fnrpc_router)
        .manage(app_state_for_manage)
        .invoke_handler(tauri::generate_handler![
            integrations::fnrpc_tauri::rpc_fn,
            integrations::fnrpc_tauri::rpc_sub,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
