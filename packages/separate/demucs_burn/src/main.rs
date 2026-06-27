use std::path::PathBuf;
use std::time::Instant;

use anyhow::{Context, Result};
use clap::Parser;
use demucs_core::listener::{ForwardEvent, ForwardListener};
use demucs_core::model::metadata::{ModelInfo, ALL_MODELS};
use demucs_core::provider::fs::FsProvider;
use demucs_core::provider::ModelProvider;
use demucs_core::{Demucs, ModelOptions};

#[cfg(feature = "cpu")]
type B = burn::backend::NdArray<f32>;

#[cfg(not(feature = "cpu"))]
type B = burn::backend::wgpu::Wgpu;

#[derive(Parser)]
#[command(name = "demucs-burn")]
struct Cli {
    /// Benchmark mode: load model and print timing, then exit
    #[arg(long)]
    benchmark_load: bool,

    /// Input WAV file (for separation or load test)
    input: Option<PathBuf>,

    /// Output directory for stems
    output: Option<PathBuf>,

    /// Model variant
    #[arg(short, long, default_value = "htdemucs")]
    model: String,

    /// Wgpu tasks_max (CPU threads for command recording). Default 128.
    #[arg(long, default_value = "128")]
    tasks_max: u32,
}

fn resolve_model_info(model_id: &str) -> Result<&'static ModelInfo> {
    ALL_MODELS
        .iter()
        .find(|m| m.id == model_id)
        .copied()
        .with_context(|| format!("Unknown model: {}", model_id))
}

struct BenchListener;

impl ForwardListener for BenchListener {
    fn on_event(&mut self, event: ForwardEvent) {
        match event {
            ForwardEvent::ChunkStarted { index, total } => {
                let pct = (index as f64 / total as f64 * 100.0) as u32;
                println!("({}%)", pct.min(99));
            }
            ForwardEvent::ChunkDone { index, total } => {
                let pct = ((index + 1) as f64 / total as f64 * 100.0) as u32;
                println!("({}%)", pct.min(100));
            }
            _ => {}
        }
    }
}

fn main() -> Result<()> {
    std::thread::Builder::new()
        .name("demucs-burn".into())
        .stack_size(8 * 1024 * 1024)
        .spawn(run)
        .expect("failed to spawn main thread")
        .join()
        .unwrap()
}

fn run() -> Result<()> {
    let cli = Cli::parse();
    let info = resolve_model_info(&cli.model)?;
    let opts = ModelOptions::FourStem;

    let provider = FsProvider::new().context("Failed to initialize model cache")?;
    let bytes = if provider.is_cached(info) {
        eprintln!("Loading cached model: {}", info.id);
        provider.load_cached(info).context("Failed to load cached model")?
    } else {
        anyhow::bail!("Model '{}' not cached. Run demucs-cli first to download it.", info.id);
    };

    #[cfg(not(feature = "cpu"))]
    let device = {
        use burn::backend::wgpu::{graphics::AutoGraphicsApi, init_setup, RuntimeOptions};
        let d = Default::default();
        let options = RuntimeOptions {
            tasks_max: cli.tasks_max as usize,
            ..Default::default()
        };
        init_setup::<AutoGraphicsApi>(&d, options);
        d
    };

    #[cfg(feature = "cpu")]
    let device = Default::default();

    let load_start = Instant::now();
    let model = Demucs::<B>::from_bytes(opts, &bytes, device)
        .context("Failed to load model weights")?;
    let load_time = load_start.elapsed();

    #[cfg(not(feature = "cpu"))]
    {
        eprintln!("Pre-compiling GPU shaders (first run only)...");
        pollster::block_on(model.warmup());
    }

    if cli.benchmark_load {
        println!("Benchmark-Load-Time: {:.3}", load_time.as_secs_f64());
        return Ok(());
    }

    let input = cli.input.context("Input file required")?;
    let out_dir = cli.output.context("Output directory required")?;

    eprintln!("Reading {}", input.display());
    let (left, right, sample_rate) = read_wav(&input)?;
    let duration_secs = left.len() as f64 / sample_rate as f64;
    eprintln!("  {} samples, {:.1}s, {} Hz, stereo", left.len(), duration_secs, sample_rate);

    eprintln!("Separating...");
    let stems = pollster::block_on(model.separate_with_listener(
        &left, &right, sample_rate, &mut BenchListener,
    ))?;

    std::fs::create_dir_all(&out_dir)?;
    for stem in &stems {
        let filename = format!("{}.wav", stem.id.as_str());
        let path = out_dir.join(&filename);
        write_wav(&path, &stem.left, &stem.right, sample_rate)?;
        eprintln!("  Wrote {}", path.display());
    }

    println!("(100%)");
    eprintln!("Done!");
    Ok(())
}

fn read_wav(path: &PathBuf) -> Result<(Vec<f32>, Vec<f32>, u32)> {
    let mut reader = hound::WavReader::open(path)
        .with_context(|| format!("Failed to open WAV: {}", path.display()))?;
    let spec = reader.spec();
    if spec.channels > 2 {
        anyhow::bail!("Expected mono or stereo, got {} channels", spec.channels);
    }
    let sample_rate = spec.sample_rate;

    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader.samples::<f32>().map(|s| s.unwrap_or(0.0)).collect(),
        hound::SampleFormat::Int => {
            let max = (1u32 << (spec.bits_per_sample - 1)) as f32;
            reader.samples::<i32>().map(|s| s.unwrap_or(0) as f32 / max).collect()
        }
    };

    if spec.channels == 1 {
        Ok((samples.clone(), samples, sample_rate))
    } else {
        let left: Vec<f32> = samples.iter().step_by(2).copied().collect();
        let right: Vec<f32> = samples.iter().skip(1).step_by(2).copied().collect();
        Ok((left, right, sample_rate))
    }
}

fn write_wav(path: &std::path::Path, left: &[f32], right: &[f32], sample_rate: u32) -> Result<()> {
    let spec = hound::WavSpec {
        channels: 2,
        sample_rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut writer = hound::WavWriter::create(path, spec)?;
    for (&l, &r) in left.iter().zip(right.iter()) {
        writer.write_sample(l)?;
        writer.write_sample(r)?;
    }
    writer.finalize()?;
    Ok(())
}
