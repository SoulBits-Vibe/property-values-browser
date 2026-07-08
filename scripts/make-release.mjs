import { copyFile, mkdir, readFile, rm } from "fs/promises";
import { spawn } from "child_process";
import path from "path";

const sourceRoot = process.cwd();
const distRoot = path.join(sourceRoot, "dist");
const pluginRoot = path.join(distRoot, "property-values-browser");
const manifest = JSON.parse(await readFile(path.join(sourceRoot, "manifest.json"), "utf8"));
const zipPath = path.join(distRoot, `property-values-browser-${manifest.version}.zip`);

await rm(distRoot, { recursive: true, force: true });
await mkdir(pluginRoot, { recursive: true });

for (const file of ["main.js", "manifest.json", "styles.css"]) {
  await copyFile(path.join(sourceRoot, file), path.join(pluginRoot, file));
}

await zipDirectory(pluginRoot, zipPath);

console.log(`Prepared release files in ${pluginRoot}`);
console.log(`Prepared release archive at ${zipPath}`);

function zipDirectory(source, destination) {
  return new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? "powershell.exe" : "pwsh";
    const child = spawn(command, [
      "-NoProfile",
      "-Command",
      "$source = Join-Path $env:PROPERTY_VALUES_BROWSER_RELEASE_SOURCE '*'; Compress-Archive -Path $source -DestinationPath $env:PROPERTY_VALUES_BROWSER_RELEASE_ZIP -Force"
    ], {
      stdio: "inherit",
      env: {
        ...process.env,
        PROPERTY_VALUES_BROWSER_RELEASE_SOURCE: source,
        PROPERTY_VALUES_BROWSER_RELEASE_ZIP: destination
      }
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Compress-Archive failed with exit code ${code}`));
      }
    });
  });
}
