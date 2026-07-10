use config_rs::servers::ServerType;
use core_rs::{cmd::tasks::get_group_list::GroupInfo, servers::discovery::ServerInfo};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::state::Ctx;

#[fnrpc::rpc_query]
pub async fn health_check() -> &'static str {
    "ok"
}

#[fnrpc::rpc_query]
pub async fn add(input: (i32, i32)) -> Result<i32, String> {
    Ok(input.0 + input.1)
}

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
        message: format!(
            "hello {} (root: {})",
            input.name,
            ctx.state.repo_root.display()
        ),
    })
}

#[fnrpc::rpc_query]
pub async fn get_group_list() -> Result<Vec<GroupInfo>, String> {
    core_rs::cmd::tasks::get_group_list::get_group_list()
}

#[fnrpc::rpc_query]
pub async fn find_server(input: ServerType) -> ServerInfo {
    core_rs::servers::discovery::find_server(input).await
}

fnrpc::fnrpc_registry! { Router<Ctx> = [health_check, greet, add, get_group_list, find_server] }
