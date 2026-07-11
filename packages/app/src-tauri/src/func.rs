use std::fs;

use config_rs::{root::base_dir, servers::ServerType};
use core_rs::{cmd::tasks::get_group_list::GroupInfo, servers::discovery::ServerInfo};
use device_rs::DeviceInfo;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::{commands, state::Ctx};

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

#[fnrpc::rpc_query]
pub async fn device_info(ctx: &Ctx) -> Result<DeviceInfo, String> {
    commands::device_info(&ctx.state)
}

#[fnrpc::rpc_query]
pub async fn read_app_file_text(relative_path: String) -> Result<String, String> {
    let path = base_dir().join(&relative_path);
    fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))
}

#[fnrpc::rpc_query]
pub async fn read_app_file_bin(relative_path: String) -> Result<Vec<u8>, String> {
    let path = base_dir().join(&relative_path);
    fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))
}

#[fnrpc::rpc_mutation]
pub async fn write_app_file_text(relative_path: String, content: String) -> Result<(), String> {
    let relative_path = relative_path.replace('\\', "/");
    if relative_path.contains("..") {
        return Err("Path traversal detected".to_string());
    }
    let path = base_dir().join(&relative_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create dir {}: {}", parent.display(), e))?;
    }
    fs::write(&path, &content).map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

fnrpc::fnrpc_registry! { Router<Ctx> = [health_check, greet, add, get_group_list, find_server, device_info, read_app_file_text, read_app_file_bin] }
