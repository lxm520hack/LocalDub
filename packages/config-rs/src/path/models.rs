use std::path::{Path, PathBuf};

fn repo_root() -> PathBuf {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest.parent().unwrap().parent().unwrap().to_path_buf()
}

pub fn model_cache_dir() -> PathBuf {
    repo_root().join("data").join("models")
}

pub fn demucs_model_dir() -> PathBuf {
    model_cache_dir().join("demucs")
}

pub fn voxcpm_model_dir() -> PathBuf {
    model_cache_dir().join("voxcpm2")
}
