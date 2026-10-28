import { createServer } from "node:http";
import path from "node:path";
import { createRequestHandler } from "@react-router/express";
import compression from "compression";
import express from "express";
import morgan from "morgan";
import { STUDIO_UPLOAD_CLIENT_TIMEOUT_MS } from "../src/contracts/upload.ts";

// Node 22 otherwise rejects requests after five minutes, before the studio's
// twenty-minute body deadline. Keep header protection independent of uploads.
export const WEB_HTTP_OPTIONS = Object.freeze({
  requestTimeout: STUDIO_UPLOAD_CLIENT_TIMEOUT_MS,
  headersTimeout: 60_000,
});

/** Normal React Router SSR build, with the same middleware as react-router-serve. */
export function createWebServer(build, { publicDirectory = "public" } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(compression());
  let publicPath;
  try { publicPath = new URL(build.publicPath).pathname; }
  catch { publicPath = build.publicPath; }
  if (!publicPath.startsWith("/")) publicPath = `/${publicPath}`;
  app.use(path.posix.join(publicPath, "assets"), express.static(path.join(build.assetsBuildDirectory, "assets"), { immutable: true, maxAge: "1y" }));
  app.use(publicPath, express.static(build.assetsBuildDirectory));
  app.use(express.static(publicDirectory, { maxAge: "1h" }));
  app.use(morgan("tiny"));
  app.all("/{*splat}", createRequestHandler({ build, mode: process.env.NODE_ENV }));
  return createServer(WEB_HTTP_OPTIONS, app);
}

export function registerWebShutdown(server) {
  const close = () => server.close((error) => { if (error) console.error(error); });
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
  // Remove our listeners when this server closes (also useful for embedded use).
  server.once("close", () => {
    process.off("SIGTERM", close);
    process.off("SIGINT", close);
  });
}
