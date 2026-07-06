use std::path::PathBuf;
use std::fs;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VideoSource {
    Youtube,
    Bilibili,
    Local,
    Remote,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub source: VideoSource,
    pub url: String,
    pub title: Option<String>,
    pub status: String,
    pub current_stage: Option<String>,
    pub session_path: String,
    pub final_video_path: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStage {
    pub name: String,
    pub label: String,
    pub status: String,
    pub progress: Option<f64>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub last_message: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsrRunInfo {
    pub engine: String,
    pub device: String,
    pub compute_type: Option<String>,
    pub gpu_attempted: Option<bool>,
    pub fallback_to_cpu: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunInfo {
    pub asr: Option<AsrRunInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Context {
    pub task: Task,
    pub stages: Option<Vec<TaskStage>>,
    pub pipeline: String,
    pub last_run_pipeline: Option<String>,
    pub input: serde_json::Value,
    pub run_info: Option<RunInfo>,
    pub video_source_path: Option<String>,
    pub audio_source_path: Option<String>,
    pub asr_language: Option<String>,
    pub target_language: Option<String>,
    pub video_source: Option<String>,
}

pub fn ctx_path(session_path: &str) -> PathBuf {
    PathBuf::from(session_path).join("ctx.json")
}

pub fn read_ctx(session_path: &str) -> Result<Context, String> {
    let path = ctx_path(session_path);
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))
}

pub fn read_task(session_path: &str) -> Result<Task, String> {
    let path = ctx_path(session_path);
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    let json: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))?;
    let task_value = json.get("task")
        .ok_or_else(|| format!("Missing 'task' field in {}", path.display()))?;
    serde_json::from_value(task_value.clone())
        .map_err(|e| format!("Failed to deserialize task in {}: {}", path.display(), e))
}

pub fn read_stages(session_path: &str) -> Result<Vec<TaskStage>, String> {
    read_ctx(session_path).map(|ctx| ctx.stages.unwrap_or_default())
}

pub fn read_pipeline(session_path: &str) -> String {
    read_ctx(session_path)
        .map(|ctx| ctx.pipeline)
        .unwrap_or_else(|_| "dub".to_string())
}
