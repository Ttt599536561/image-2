import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sourceMapSupport from "source-map-support";
import { createWebServer, registerWebShutdown } from "./web-server.mjs";

process.env.NODE_ENV ??= "production";
sourceMapSupport.install({ retrieveSourceMap(source) {
  if (source.startsWith("file://")) {
    const mapPath = `${fileURLToPath(source)}.map`;
    if (fs.existsSync(mapPath)) return { url: source, map: fs.readFileSync(mapPath, "utf8") };
  }
  return null;
} });

const build = await import(pathToFileURL(path.resolve("build/server/index.js")).href);
const server = createWebServer(build);
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
registerWebShutdown(server);
server.listen(port, host, () => {
  console.log(`[studio-web] http://${host}:${server.address().port}`);
});
