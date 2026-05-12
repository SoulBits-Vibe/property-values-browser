import { copyFile, mkdir, rm } from "fs/promises";
import path from "path";

const sourceRoot = process.cwd();
const distRoot = path.join(sourceRoot, "dist");
const pluginRoot = path.join(distRoot, "property-values-browser");

await rm(distRoot, { recursive: true, force: true });
await mkdir(pluginRoot, { recursive: true });

for (const file of ["main.js", "manifest.json", "styles.css"]) {
  await copyFile(path.join(sourceRoot, file), path.join(pluginRoot, file));
}

console.log(`Prepared release files in ${pluginRoot}`);
