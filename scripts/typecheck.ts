import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const packagesDir = "packages";

const entries = await readdir(packagesDir, { withFileTypes: true });

for (const entry of entries) {
  if (!entry.isDirectory()) continue;

  const cwd = join(packagesDir, entry.name);
  const packageJsonPath = join(cwd, "package.json");

  try {
    const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));

    if (!pkg.scripts?.typecheck) {
      console.log(`- ${pkg.name ?? entry.name}: skipped`);
      continue;
    }

    console.log(`\n▶ ${pkg.name}`);

    const proc = Bun.spawn(["bun", "run", "typecheck"], {
      cwd,
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  } catch {
    // 没有 package.json，跳过
  }
}