use serde::{Deserialize, Serialize};
use specta::Type;

use crate::state::AppState;

#[fnrpc::rpc_query]
pub async fn health_check(_ctx: &AppState) -> String {
    "ok".to_string()
}

// --- Greet (测试函数) ---

#[derive(Debug, Serialize, Deserialize, Type)]
pub struct GreetInput {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, Type)]
pub struct GreetOutput {
    pub message: String,
}

#[fnrpc::rpc_query]
pub async fn greet(ctx: &AppState, input: GreetInput) -> Result<GreetOutput, String> {
    Ok(GreetOutput {
        message: format!("hello {} (root: {})", input.name, ctx.repo_root.display()),
    })
}

#[fnrpc::rpc_query]
pub async fn add(_ctx: &AppState, input: (i32, i32)) -> Result<i32, String> {
    Ok(input.0 + input.1)
}

// #[fnrpc::rpc_query]
// pub async fn repo_root(ctx: &AppState) -> String {
//     "ok".to_string()
// }

fnrpc::fnrpc_registry! { Router<AppState> = [health_check, greet, add] }
