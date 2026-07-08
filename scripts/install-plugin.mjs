import { copyFile, mkdir } from "fs/promises";
import path from "path";

const sourceRoot = process.cwd();
const targetRoot = process.env.OBSIDIAN_PLUGIN_DIR;

if (!targetRoot) {
  throw new Error("Set OBSIDIAN_PLUGIN_DIR to your vault plugin folder before running install-plugin.");
}

await mkdir(targetRoot, { recursive: true });

for (const file of ["main.js", "manifest.json", "styles.css"]) {
  await copyFile(path.join(sourceRoot, file), path.join(targetRoot, file));
}

console.log(`Installed Property Values Browser to ${targetRoot}`);
