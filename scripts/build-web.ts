import { cp, mkdir, readdir, rm, writeFile, readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const outputRoot = join(projectRoot, "dist");

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(fullPath);
      return entry.isFile() && extname(entry.name) === ".ts" ? [fullPath] : [];
    }),
  );
  return nested.flat();
}

async function compileTypeScriptDirectory(sourceRoot: string): Promise<void> {
  for (const sourcePath of await sourceFiles(sourceRoot)) {
    const relativePath = relative(projectRoot, sourcePath).replace(/\.ts$/, ".js");
    const outputPath = join(outputRoot, relativePath);
    const source = await readFile(sourcePath, "utf8");
    const javascript = stripTypeScriptTypes(source, { mode: "strip" }).replaceAll(
      ".ts\"",
      ".js\"",
    ).replaceAll(".ts'", ".js'").replace(/[ \t]+$/gm, "");
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, javascript);
  }
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await compileTypeScriptDirectory(join(projectRoot, "src"));
await compileTypeScriptDirectory(join(projectRoot, "web"));
await cp(join(projectRoot, "web", "index.html"), join(outputRoot, "web", "index.html"));
await cp(join(projectRoot, "web", "style.css"), join(outputRoot, "web", "style.css"));

console.log("已生成本地试玩网页：dist/web/index.html");
