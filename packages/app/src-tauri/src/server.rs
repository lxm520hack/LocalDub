use std::path::PathBuf;

use axum::Router;
use rspc::Procedures;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

use crate::state::AppState;

pub async fn start(
    procedures: Procedures<AppState>,
    state: AppState,
    dist_dir: PathBuf,
    port: u16,
) {
    let rspc_router = rspc_axum::endpoint::<AppState, _, _, _>(procedures, move || {
        state.clone()
    });

    let app = Router::new()
        .nest("/rspc", rspc_router)
        .nest_service("/", ServeDir::new(&dist_dir).append_index_html_on_directories(true))
        .layer(CorsLayer::permissive());

    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind HTTP server");

    eprintln!("[Axum] HTTP server listening on http://{}", addr);
    axum::serve(listener, app)
        .await
        .expect("HTTP server error");
}
