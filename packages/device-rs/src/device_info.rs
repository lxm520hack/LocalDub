use serde::{Deserialize, Serialize};
use specta::Type;

use crate::gpu::GpuInfo;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub platform: PlatformInfo,
    pub cpu: CpuInfo,
    pub memory: MemoryInfo,
    pub gpu: Vec<GpuInfo>,
    pub ort: OrtInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    pub os: String,
    pub arch: String,
    pub release: String,
    pub hostname: String,
    pub runtime: String,
    pub runtime_version: String,
    #[serde(skip_serializing_if = "Option::is_none")] // | undefined
    pub node_version: Option<String>, // T | None(null)
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CpuInfo {
    pub model: String,
    pub cores: u32,
    #[serde(rename = "speedMHz")]
    pub speed_mhz: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInfo {
    pub total: String,
    pub free: String,
    pub process_heap_used: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OrtInfo {
    pub version: String,
    pub backends: Vec<OrtBackend>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OrtBackend {
    pub name: String,
    pub bundled: bool,
}
