import { copyFile, mkdir } from "fs/promises";
import path from "path";

const sourceRoot = process.cwd();
const targetRoot = "C:\\Obsidian-Vaults\\.obsidian\\plugins\\property-values-browser";

await mkdir(targetRoot, { recursive: true });

for (const file of ["main.js", "manifest.json", "styles.css"]) {
  await copyFile(path.join(sourceRoot, file), path.join(targetRoot, file));
}

console.log(`Installed Property Values Browser to ${targetRoot}`);
