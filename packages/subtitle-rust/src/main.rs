use std::env;

mod char_list;
mod det;
mod image;
mod infer;
mod pipeline;
mod preprocess;
mod rec;

use crate::pipeline::run_ocr;

fn parse_args() -> Result<(String, f32, bool, String, String), String> {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        return Err(format!(
            "Usage: {} <image_path> [text_score] [--subtitle-only] [--device cpu|cuda|dml]",
            args[0]
        ));
    }
    let image_path = args[1].clone();
    let mut text_score: f32 = 0.5;
    let mut subtitle_only = false;

    let mut i = 2;
    while i < args.len() {
        match args[i].as_str() {
            "--subtitle-only" => { subtitle_only = true; i += 1; }
            "--device" => { i += 2; }
            s if !s.starts_with("--") => {
                text_score = s.parse().unwrap_or(0.5);
                i += 1;
            }
            _ => { i += 1; }
        }
    }

    let models_dir = env::var("OCR_MODELS_DIR")
        .or_else(|_| env::var("OCR_MODELS"))
        .map_err(|_| "OCR_MODELS_DIR not set")?;
    let keys_path = env::var("OCR_KEYS_PATH").map_err(|_| "OCR_KEYS_PATH not set")?;

    Ok((image_path, text_score, subtitle_only, models_dir, keys_path))
}

fn main() {
    match (|| -> Result<(), String> {
        let (img, score, so, models, keys) = parse_args()?;
        let result = run_ocr(&img, &models, &keys, score, so)?;
        let json = serde_json::to_string_pretty(&result).map_err(|e| e.to_string())?;
        println!("{}", json);
        Ok(())
    })() {
        Ok(()) => {}
        Err(e) => {
            eprintln!("Error: {}", e);
            std::process::exit(1);
        }
    }
}
