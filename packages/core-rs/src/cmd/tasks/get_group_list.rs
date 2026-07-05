use std::fs;
use std::path::Path;
use serde::Serialize;
use crate::context;

#[derive(Debug, Clone, Serialize)]
struct TaskBrief {
    task_id: String,
    title: Option<String>,
    status: String,
    current_stage: Option<String>,
    created_at: String,
    started_at: Option<String>,
    completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct GroupInfo {
    group_id: String,
    task_count: usize,
    created_at: Option<String>,
    tasks: Vec<TaskBrief>,
}

#[derive(Debug, Clone, Serialize)]
struct GroupListResponse {
    groups: Vec<GroupInfo>,
}

fn system_time_to_iso(t: std::time::SystemTime) -> Option<String> {
    let dur = t.duration_since(std::time::UNIX_EPOCH).ok()?;
    let secs = dur.as_secs();
    let nanos = dur.subsec_nanos();
    // Format as ISO 8601
    let naive = chrono::DateTime::from_timestamp(secs as i64, nanos)?;
    Some(naive.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
}

pub fn get_group_list() -> Result<String, String> {
    let wf = config_rs::env::workfolder();
    let mut groups: Vec<GroupInfo> = Vec::new();

    let entries = fs::read_dir(&wf)
        .map_err(|e| format!("Failed to read workfolder {:?}: {}", wf, e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let group_id = entry
            .file_name()
            .to_str()
            .ok_or_else(|| format!("Invalid group name: {:?}", path))?
            .to_string();

        let mut tasks: Vec<TaskBrief> = Vec::new();

        let task_entries = match fs::read_dir(&path) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for task_entry in task_entries {
            let task_entry = match task_entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let task_path = task_entry.path();
            if !task_path.is_dir() {
                continue;
            }

            if !task_path.join("ctx.json").exists() {
                continue;
            }

            match context::read_task(task_path.to_str().unwrap_or_default()) {
                Ok(task) => {
                    tasks.push(TaskBrief {
                        task_id: task.id,
                        title: task.title,
                        status: task.status,
                        current_stage: task.current_stage,
                        created_at: task.created_at,
                        started_at: task.started_at,
                        completed_at: task.completed_at,
                    });
                }
                Err(_) => continue,
            }
        }

        tasks.sort_by(|a, b| b.created_at.cmp(&a.created_at));

        let created_at = fs::metadata(&path)
            .ok()
            .and_then(|meta| meta.created().ok())
            .and_then(system_time_to_iso)
            .or_else(|| tasks.last().map(|t| t.created_at.clone()));

        groups.push(GroupInfo {
            group_id,
            task_count: tasks.len(),
            created_at,
            tasks,
        });
    }

    groups.sort_by(|a, b| {
        match (&a.created_at, &b.created_at) {
            (Some(a), Some(b)) => b.cmp(a),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a.group_id.cmp(&b.group_id),
        }
    });

    let resp = GroupListResponse { groups };
    serde_json::to_string(&resp).map_err(|e| format!("Serialize failed: {}", e))
}
