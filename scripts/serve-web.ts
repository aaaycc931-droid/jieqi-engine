import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outputRoot = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const listenPort = Number(process.env.PORT ?? "4173");
const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  const requestPath = new URL(request.url ?? "/", "http://local").pathname;
  if (requestPath === "/") {
    response.writeHead(302, { Location: "/web/" }).end();
    return;
  }
  const cleanedPath = normalize(decodeURIComponent(requestPath)).replace(/^[/\\]+/, "");
  let filePath = resolve(outputRoot, cleanedPath);
  if (!filePath.startsWith(`${outputRoot}/`) && filePath !== outputRoot) {
    response.writeHead(403).end();
    return;
  }

  try {
    if ((await stat(filePath)).isDirectory()) filePath = join(filePath, "index.html");
    await access(filePath);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("未找到文件");
  }
});

server.listen(listenPort, "0.0.0.0", () => {
  console.log(`本机试玩：http://127.0.0.1:${listenPort}/web/`);
  try {
    const localAddresses = Object.values(networkInterfaces())
      .flat()
      .filter((address) => address?.family === "IPv4" && !address.internal)
      .map((address) => `http://${address.address}:${listenPort}/web/`);
    for (const address of localAddresses) console.log(`同一 Wi-Fi 的手机打开：${address}`);
  } catch {
    console.log("已开启局域网访问；请在电脑上运行时使用终端显示的本机 IPv4 地址。");
  }
});
