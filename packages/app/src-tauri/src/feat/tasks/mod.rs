pub mod log;
use std::fs;

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

use crate::{commands, ctx::Ctx};

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
