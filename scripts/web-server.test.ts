// @vitest-environment node
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, request, type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWebServer, registerWebShutdown, WEB_HTTP_OPTIONS } from "./web-server.mjs";

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
  });
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
function send(port: number, url: string, { delay = 0, body = "", headers = {} } = {}) {
  return new Promise<{ status: number | undefined; headers: import("node:http").IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const outgoing = request({ hostname: "127.0.0.1", port, path: url, method: body ? "POST" : "GET", headers: { ...headers, ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}) } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => { clearTimeout(timer); resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }); });
    });
    outgoing.on("error", reject);
    outgoing.on("close", () => clearTimeout(timer));
    if (delay) {
      outgoing.write(body.slice(0, 1));
      timer = setTimeout(() => outgoing.end(body.slice(1)), delay);
    } else outgoing.end(body);
  });
}

describe("production web startup", () => {
  let temporaryDirectory: string;
  let server: Server;
  let port: number;
  beforeAll(async () => {
    const cache = fileURLToPath(new URL("../.cache/web-server-tests/", import.meta.url));
    await mkdir(cache, { recursive: true });
    temporaryDirectory = await mkdtemp(path.join(cache, "run-"));
    await mkdir(path.join(temporaryDirectory, "assets"));
    await writeFile(path.join(temporaryDirectory, "assets", "app.js"), "export const app = true;");
    await writeFile(path.join(temporaryDirectory, "favicon.ico"), "icon");
    // A real React Router resource route exercises the actual Express adapter.
    const build = {
      publicPath: "/", assetsBuildDirectory: temporaryDirectory, basename: "/", future: {}, ssr: true,
      routeDiscovery: { mode: "initial", manifestPath: "/__manifest" },
      entry: { module: {} }, assets: { routes: {} },
      routes: { root: { id: "root", path: "*", module: {
        loader: () => new Response("route-response-".repeat(200), { headers: { "Content-Type": "text/plain" } }),
        action: async ({ request }: { request: Request }) => new Response(await request.text(), { headers: { "Content-Type": "text/plain" } }),
      } } },
    };
    server = createWebServer(build, { publicDirectory: temporaryDirectory });
    port = await listen(server);
  });
  afterAll(async () => {
    if (server?.listening) await close(server);
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("starts the HTTP server that owns the long upload budget", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.scripts["start:web"]).toBe("node --import tsx scripts/web.mjs");
  });
  it("keeps the real Node HTTP request budget above 20 minutes and the header deadline at 60 seconds", () => {
    expect(server.requestTimeout).toBe(21 * 60_000);
    expect(server.headersTimeout).toBe(60_000);
    expect(server.timeout).toBe(0);
    expect(server.keepAliveTimeout).toBe(5_000);
  });
  it("preserves immutable assets, normal static files, React Router bodies and gzip", async () => {
    const asset = await send(port, "/assets/app.js");
    expect(asset.status).toBe(200);
    expect(asset.headers["cache-control"]).toContain("max-age=31536000, immutable");
    expect(asset.headers["x-powered-by"]).toBeUndefined();
    expect((await send(port, "/favicon.ico")).body.toString()).toBe("icon");
    const route = await send(port, "/upload", { body: "complete-original-file" });
    expect(route.status, route.body.toString()).toBe(200);
    expect(route.body.toString()).toBe("complete-original-file");
    const compressed = await send(port, "/route", { headers: { "Accept-Encoding": "gzip" } });
    expect(compressed.status).toBe(200);
    expect(compressed.headers["content-encoding"]).toBe("gzip");
  });
  it("registers shutdown handlers and removes them when the server closes", async () => {
    const disposable = createServer();
    await listen(disposable);
    const previous = process.listeners("SIGTERM");
    const previousInterrupt = process.listeners("SIGINT");
    registerWebShutdown(disposable);
    const handler = process.listeners("SIGTERM").find((entry) => !previous.includes(entry))!;
    expect(handler).toBeTypeOf("function");
    const closed = new Promise<void>((resolve) => disposable.once("close", resolve));
    handler("SIGTERM");
    await closed;
    expect(process.listeners("SIGTERM")).toEqual(previous);
    expect(process.listeners("SIGINT")).toEqual(previousInterrupt);
  });
  it("permits a native slow body past the former 2/5-minute cutoffs and still expires unfinished bodies", async () => {
    // Node's internal HTTP clock cannot be faked. Scale the same production
    // options 1:1000 and shorten only its polling interval for a socket test.
    const options = { requestTimeout: WEB_HTTP_OPTIONS.requestTimeout / 1000, headersTimeout: WEB_HTTP_OPTIONS.headersTimeout / 1000, connectionsCheckingInterval: 10 };
    const native = createServer(options, async (incoming, response) => {
      try {
        for await (const _chunk of incoming) { /* consume the complete body */ }
        response.end("received");
      } catch { /* the native deadline destroys an incomplete request */ }
    });
    const nativePort = await listen(native);
    try {
      const result = await send(nativePort, "/upload", { body: "original-image", delay: 650 });
      expect(result.status).toBe(200);
      expect(result.body.toString()).toBe("received");
      const expired = await send(nativePort, "/upload", { body: "original-image", delay: 1600 });
      expect(expired.status).toBe(408);
    } finally { await close(native); }
  });
});
