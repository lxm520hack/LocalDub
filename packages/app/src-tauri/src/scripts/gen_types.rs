// fn main() {
//     let router = app_lib::router::build();
//     let (_procedures, types) = router.build().expect("rspc router build failed");

//     let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
//     let output_path = manifest_dir.join("../src/integrations/rspc/bindings.ts");

//     let ts = rspc::Typescript::default();
//     ts.export_to(&output_path, &types)
//         .expect("failed to export types");

//     println!("Generated {}", output_path.display());
// }
