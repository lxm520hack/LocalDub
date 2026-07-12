use config_rs::root::base_dir;
use futures::{stream, Stream};
use std::{path::Path, time::Duration};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

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
