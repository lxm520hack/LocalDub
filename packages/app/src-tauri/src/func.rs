use serde::{Deserialize, Serialize};
use specta::Type;

use crate::state::Ctx;

#[fnrpc::rpc_query]
pub async fn health_check(_ctx: &Ctx) -> String {
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
pub async fn greet(ctx: &Ctx, input: GreetInput) -> Result<GreetOutput, String> {
    Ok(GreetOutput {
        message: format!("hello {} (root: {})", input.name, ctx.state.repo_root.display()),
    })
}

#[fnrpc::rpc_query]
pub async fn add(_ctx: &Ctx, input: (i32, i32)) -> Result<i32, String> {
    Ok(input.0 + input.1)
}

// #[fnrpc::rpc_query]
// pub async fn repo_root(ctx: &Ctx) -> String {
//     "ok".to_string()
// }

fnrpc::fnrpc_registry! { Router<Ctx> = [health_check, greet, add] }
