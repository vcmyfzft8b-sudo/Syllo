import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const nextPath = path.join(projectRoot, ".next");
const publicVendorFfmpegPath = path.join(projectRoot, "public", "vendor", "ffmpeg");

function copyFileIfDifferent(sourcePath, targetPath) {
  const sourceBuffer = fs.readFileSync(sourcePath);

  try {
    const targetBuffer = fs.readFileSync(targetPath);
    if (Buffer.compare(sourceBuffer, targetBuffer) === 0) {
      return;
    }
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, sourceBuffer);
}

function ensureFfmpegBrowserAssets() {
  const sourceBasePath = path.join(projectRoot, "node_modules", "@ffmpeg", "core", "dist", "umd");

  copyFileIfDifferent(
    path.join(sourceBasePath, "ffmpeg-core.js"),
    path.join(publicVendorFfmpegPath, "ffmpeg-core.js"),
  );
  copyFileIfDifferent(
    path.join(sourceBasePath, "ffmpeg-core.wasm"),
    path.join(publicVendorFfmpegPath, "ffmpeg-core.wasm"),
  );
}

function ensureTmpNodeModules(targetPath) {
  const nodeModulesPath = path.join(targetPath, "node_modules");
  const projectNodeModulesPath = path.join(projectRoot, "node_modules");

  try {
    const current = fs.readlinkSync(nodeModulesPath);
    if (current === projectNodeModulesPath) {
      return;
    }
    fs.unlinkSync(nodeModulesPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = error.code;
      if (code !== "EINVAL" && code !== "ENOENT") {
        throw error;
      }
    }
  }

  if (fs.existsSync(nodeModulesPath)) {
    return;
  }

  fs.symlinkSync(projectNodeModulesPath, nodeModulesPath);
}

try {
  ensureFfmpegBrowserAssets();

  const stat = fs.lstatSync(nextPath);
  if (!stat.isSymbolicLink()) {
    process.exit(0);
  }

  const targetPath = fs.realpathSync(nextPath);
  ensureTmpNodeModules(targetPath);
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    process.exit(0);
  }

  throw error;
}
