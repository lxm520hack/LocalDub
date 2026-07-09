use serde::{Deserialize, Serialize};
use specta::Type;

use crate::state::AppState;

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

fnrpc::fnrpc_registry! { Router<AppState> = [greet, add] }
