use std::fs;

pub mod tasks;
use config_rs::{root::base_dir, servers::ServerType};
use core_rs::{
    cmd::tasks::get_task::GroupInfo,
    context::{self, Context, Task},
    servers::discovery::ServerInfo,
    utils::file_ops::{ensure_parent_dir, sanitize_relative_path},
};
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
    core_rs::cmd::tasks::get_task::get_group_list()
}

#[fnrpc::rpc_query]
pub async fn get_task_ctx(task_dir: String) -> Result<Context, String> {
    let path = base_dir().join(&task_dir);
    context::read_ctx(
        &path
            .to_str()
            .ok_or_else(|| format!("Invalid task_dir: {}", task_dir))?,
    )
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
    let path = sanitize_relative_path(&relative_path)?;
    ensure_parent_dir(&path)?;
    fs::write(&path, &content).map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

#[fnrpc::rpc_mutation]
pub async fn write_app_file_binary(relative_path: String, content: Vec<u8>) -> Result<(), String> {
    let path = sanitize_relative_path(&relative_path)?;
    ensure_parent_dir(&path)?;
    fs::write(&path, &content).map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

#[derive(Debug, Serialize, Deserialize, Type)]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: Option<u64>,
}

#[fnrpc::rpc_query]
pub async fn list_app_directory(relative_path: String) -> Result<Vec<DirEntry>, String> {
    let path = base_dir().join(&relative_path);
    let entries = fs::read_dir(&path)
        .map_err(|e| format!("Failed to list {}: {}", path.display(), e))?;

    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let metadata = entry.metadata().map_err(|e| format!("Failed to read metadata: {}", e))?;
        result.push(DirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size: if metadata.is_file() { Some(metadata.len()) } else { None },
        });
    }

    result.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            b.is_dir.cmp(&a.is_dir)
        } else {
            a.name.cmp(&b.name)
        }
    });

    Ok(result)
}

fnrpc::fnrpc_registry! { Router<Ctx> {
    queries: [health_check, greet, add, get_group_list, get_task_ctx, find_server, device_info, read_app_file_text, read_app_file_bin, list_app_directory],
    mutations: [write_app_file_text],
    subscriptions: [crate::func::tasks::log::watch_task_log],
} }
