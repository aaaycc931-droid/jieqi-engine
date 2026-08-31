import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const androidRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = resolve(androidRoot, "..");
const source = resolve(projectRoot, "dist");
const target = resolve(androidRoot, "app", "src", "main", "assets", "game");

if (!source.startsWith(`${projectRoot}/`) || !target.startsWith(`${androidRoot}/`)) {
  throw new Error("Android 网页资源路径校验失败");
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
console.log("已同步 Android 内置网页资源");
