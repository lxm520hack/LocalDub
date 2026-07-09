use std::collections::HashMap;
use std::path::PathBuf;

use axum::{
    extract::{Path, Query},
    http::HeaderMap,
    Extension, Json, Router,
};
use fnrpc::router::RpcRouter;
use rspc::Procedures;
use serde_json::Value;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

use crate::state::{AppState, Ctx};

async fn fnrpc_handler(
    Extension(router): Extension<RpcRouter<Ctx>>,
    Extension(state): Extension<AppState>,
    Path(path): Path<String>,
    Json(input): Json<Value>,
) -> Json<Value> {
    let ctx = Ctx {
        state,
        headers: HeaderMap::new(),
    };
    let result = router
        .dispatch(&ctx, &path, input)
        .await
        .unwrap_or_default();
    Json(result)
}

async fn fnrpc_get_handler(
    Extension(router): Extension<RpcRouter<Ctx>>,
    Extension(state): Extension<AppState>,
    Path(path): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Json<Value> {
    let input: Value = params
        .get("input")
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(Value::Null);
    let ctx = Ctx {
        state,
        headers: HeaderMap::new(),
    };
    let result = router
        .dispatch(&ctx, &path, input)
        .await
        .unwrap_or_default();
    Json(result)
}

pub async fn start(
    procedures: Procedures<AppState>,
    state: AppState,
    fnrpc_router: RpcRouter<Ctx>,
    dist_dir: PathBuf,
    port: u16,
) {
    let state_for_rspc = state.clone();
    let rspc_router = rspc_axum::endpoint::<AppState, _, _, _>(procedures, move || {
        state_for_rspc.clone()
    });

    let app = Router::new()
        .nest("/rspc", rspc_router)
        .route(
            "/fnrpc/:path",
            axum::routing::get(fnrpc_get_handler).post(fnrpc_handler),
        )
        .layer(CorsLayer::permissive())
        .layer(Extension(fnrpc_router))
        .layer(Extension(state))
        .fallback_service(ServeDir::new(&dist_dir).append_index_html_on_directories(true));

    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind HTTP server");

    eprintln!("[Axum] HTTP server listening on http://{}", addr);
    axum::serve(listener, app)
        .await
        .expect("HTTP server error");
}
