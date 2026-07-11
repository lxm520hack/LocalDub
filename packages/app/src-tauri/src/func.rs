use std::{fs, path::Path};
use std::time::Duration;

use config_rs::{root::base_dir, servers::ServerType};
use core_rs::{
    cmd::tasks::get_task::GroupInfo,
    context::{self, Context, Task},
    servers::discovery::ServerInfo,
    utils::file_ops::{ensure_parent_dir, sanitize_relative_path},
};
use device_rs::DeviceInfo;
use futures::stream::{self, Stream};
use serde::{Deserialize, Serialize};
use specta::Type;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

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
    context::read_ctx(&task_dir)
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

#[fnrpc::rpc_subscription]
pub fn watch_task_log(task_dir: String) -> impl Stream<Item = String> {
    let p = if Path::new(&task_dir).is_relative() {
        base_dir().join(&task_dir)
    } else {
        Path::new(&task_dir).to_path_buf()
    };
    let task_id = p
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let log_path = p.join(format!("{task_id}.log"));

    let (initial_lines, initial_len) = match std::fs::read_to_string(&log_path) {
        Ok(c) => {
            let all_lines: Vec<&str> = c.lines().collect();
            let tail = if all_lines.len() > 50 {
                all_lines[all_lines.len() - 50..].to_vec()
            } else {
                all_lines.clone()
            };
            (tail.into_iter().map(String::from).collect(), c.len() as u64)
        }
        Err(_) => (vec![], 0),
    };

    struct State {
        log_path: std::path::PathBuf,
        last_len: u64,
        interval: tokio::time::Interval,
        tail: std::vec::IntoIter<String>,
    }

    stream::unfold(
        State {
            log_path,
            last_len: initial_len,
            interval: tokio::time::interval(Duration::from_millis(500)),
            tail: initial_lines.into_iter(),
        },
        |mut state| async move {
            loop {
                if let Some(line) = state.tail.next() {
                    return Some((line, state));
                }
                state.interval.tick().await;
                if let Ok(meta) = tokio::fs::metadata(&state.log_path).await {
                    let len = meta.len();
                    if len > state.last_len {
                        if let Ok(mut f) = tokio::fs::File::open(&state.log_path).await {
                            if f.seek(std::io::SeekFrom::Start(state.last_len))
                                .await
                                .is_ok()
                            {
                                let mut content = String::new();
                                if f.read_to_string(&mut content).await.is_ok()
                                    && !content.is_empty()
                                {
                                    state.last_len = len;
                                    state.tail = content
                                        .lines()
                                        .map(String::from)
                                        .collect::<Vec<_>>()
                                        .into_iter();
                                    if let Some(line) = state.tail.next() {
                                        return Some((line, state));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
    )
}

fnrpc::fnrpc_registry! { Router<Ctx> {
    queries: [health_check, greet, add, get_group_list, get_task_ctx, find_server, device_info, read_app_file_text, read_app_file_bin],
    mutations: [write_app_file_text],
    subscriptions: [watch_task_log],
} }
