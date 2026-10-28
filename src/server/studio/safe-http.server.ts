import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";

export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
export const MAX_RELAY_RESPONSE_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 1024 * 1024;
const MAX_REQUEST_BYTES = 5 * 1024 * 1024;

export class SafeHttpError extends Error {
  constructor(message = "仅支持公网 HTTPS 服务地址", readonly failureCode = "invalid_request") {
    super(message);
    this.name = "SafeHttpError";
  }
}
const abortError = () => new DOMException("request deadline exceeded", "AbortError");

function ipv4Number(address: string): number {
  return address.split(".").reduce((value, part) => value * 256 + Number(part), 0);
}
function inIpv4Range(value: number, base: string, bits: number): boolean {
  return Math.floor(value / 2 ** (32 - bits)) === Math.floor(ipv4Number(base) / 2 ** (32 - bits));
}

/** Fail closed for all non-global ranges, including translation/tunnelling aliases. */
export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const n = ipv4Number(address);
    const denied: [string, number][] = [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
      ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4], ["168.63.129.16", 32],
    ];
    return !denied.some(([base, bits]) => inIpv4Range(n, base, bits));
  }
  if (family !== 6 || address.includes("%") || address.includes(".")) return false;
  const [left, right] = address.toLowerCase().split("::");
  const a = left ? left.split(":") : [];
  const b = right ? right.split(":") : [];
  const words = right === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill("0"), ...b];
  const first = parseInt(words[0], 16);
  const second = parseInt(words[1], 16);
  // Only globally assigned unicast 2000::/3; excludes mapped, NAT64, ULA and link-local.
  if (first < 0x2000 || first > 0x3fff) return false;
  if (first === 0x2001 && (second <= 0x1ff || second === 0xdb8)) return false;
  if (first === 0x2002 || first === 0x3ffe || (first === 0x3fff && second < 0x1000)) return false;
  return true;
}

function publicHttpsUrl(value: string, base = false): URL {
  const raw = value.trim();
  if (!raw || raw.length > 8192 || /[\u0000-\u0020\u007f\\]/.test(raw) || raw.includes("#") ||
    (base && raw.includes("?")) || /^https:\/\/[^/]*@/i.test(raw)) throw new SafeHttpError();
  let url: URL;
  try { url = new URL(raw); } catch { throw new SafeHttpError(); }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) throw new SafeHttpError();
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (isIP(host)) {
    if (!isPublicIpAddress(host)) throw new SafeHttpError();
  } else if (!host.includes(".") || /(?:^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host)) {
    throw new SafeHttpError();
  }
  return url;
}

/** Root endpoints imply /v1. Explicit paths are preserved for provider gateways. */
export function normalizeStudioBaseUrl(value: string): string {
  const url = publicHttpsUrl(value, true);
  url.pathname = url.pathname.replace(/\/+$/, "") || "/v1";
  return url.toString().replace(/\/+$/, "");
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    if (signal.aborted) { operation.catch(() => {}); reject(abortError()); return; }
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function resolvePublicTarget(url: URL, signal: AbortSignal) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(hostname);
  const addresses = family
    ? [{ address: hostname, family }]
    : await abortable(lookup(hostname, { all: true, verbatim: true }), signal);
  if (!addresses.length || addresses.some((item) => !isPublicIpAddress(item.address) || isIP(item.address) !== item.family)) {
    throw new SafeHttpError();
  }
  if (signal.aborted) throw abortError();
  return { hostname, address: addresses[0] };
}

export async function validatePublicHttpsUrl(value: string, signal?: AbortSignal): Promise<URL> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, 10_000);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) throw abortError();
    const url = publicHttpsUrl(value);
    await resolvePublicTarget(url, controller.signal);
    return url;
  } catch (error) {
    if (error instanceof SafeHttpError || (error as Error)?.name === "AbortError") throw error;
    throw new SafeHttpError("无法解析图片服务地址", "relay_unreachable");
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}

export interface SafeHttpsOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string | Uint8Array | FormData;
  signal?: AbortSignal;
  deadlineAtMs: number;
  maxResponseBytes: number;
}
export interface SafeHttpsResponse { status: number; headers: IncomingHttpHeaders; body: Buffer }

/** No proxy, redirect, connection pooling or second DNS lookup. The deadline covers DNS, upload and body. */
export async function safeHttpsRequest(value: string, options: SafeHttpsOptions): Promise<SafeHttpsResponse> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, Math.max(0, options.deadlineAtMs - Date.now()));
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    if (options.signal?.aborted || Date.now() >= options.deadlineAtMs) throw abortError();
    const url = publicHttpsUrl(value);
    const target = await resolvePublicTarget(url, controller.signal);
    const headers = { ...options.headers, "Accept-Encoding": "identity" };
    let body: Buffer | undefined;
    if (options.body instanceof FormData) {
      let size = 0;
      for (const [name, value] of options.body.entries()) {
        size += Buffer.byteLength(name) + (typeof value === "string" ? Buffer.byteLength(value) : value.size) + 1024;
      }
      if (size > MAX_REQUEST_BYTES) throw new SafeHttpError("request body too large");
      const encoded = new Response(options.body);
      body = Buffer.from(await abortable(encoded.arrayBuffer(), controller.signal));
      Object.assign(headers, { "Content-Type": encoded.headers.get("content-type")! });
    } else if (options.body !== undefined) {
      if (Buffer.byteLength(options.body) > MAX_REQUEST_BYTES) throw new SafeHttpError("request body too large");
      body = Buffer.from(options.body);
    }
    if (body) {
      if (body.length > MAX_REQUEST_BYTES) throw new SafeHttpError("request body too large");
      Object.assign(headers, { "Content-Length": String(body.length) });
    }
    if (controller.signal.aborted) throw abortError();
    const pinnedLookup: LookupFunction = (_host, opts, callback) => {
      if (opts.all) callback(null, [target.address]);
      else callback(null, target.address.address, target.address.family);
    };
    return await new Promise<SafeHttpsResponse>((resolve, reject) => {
      let response: IncomingMessage | undefined;
      let done = false;
      const cleanup = () => controller.signal.removeEventListener("abort", onAbort);
      const fail = (error: Error) => {
        if (done) return;
        done = true;
        cleanup();
        response?.destroy();
        request.destroy();
        reject(error);
      };
      const onAbort = () => fail(abortError());
      const request = httpsRequest(url, {
        method: options.method ?? "GET", headers, agent: false, lookup: pinnedLookup,
        servername: isIP(target.hostname) ? undefined : target.hostname,
        rejectUnauthorized: true, family: target.address.family,
      }, (incoming) => {
        response = incoming;
        if (done) { incoming.destroy(); return; }
        const status = incoming.statusCode ?? 0;
        if (status >= 300 && status < 400) { fail(new SafeHttpError("provider redirect rejected", "invalid_response")); return; }
        const encoding = incoming.headers["content-encoding"];
        if (encoding && encoding !== "identity") { fail(new SafeHttpError("unsupported provider encoding", "invalid_response")); return; }
        const length = incoming.headers["content-length"];
        if (length && (!/^\d+$/.test(length) || Number(length) > options.maxResponseBytes)) {
          fail(new SafeHttpError("provider response too large", "invalid_response")); return;
        }
        const chunks: Buffer[] = [];
        let received = 0;
        incoming.on("data", (chunk: Buffer) => {
          if (done) return;
          received += chunk.length;
          if (received > options.maxResponseBytes) { fail(new SafeHttpError("provider response too large", "invalid_response")); return; }
          chunks.push(chunk);
        });
        incoming.on("error", () => fail(new SafeHttpError("provider network failure", "relay_unreachable")));
        incoming.on("aborted", () => fail(new SafeHttpError("provider network failure", "relay_unreachable")));
        incoming.on("end", () => {
          if (done) return;
          done = true;
          cleanup();
          resolve({ status, headers: incoming.headers, body: Buffer.concat(chunks, received) });
        });
      });
      request.on("error", () => fail(new SafeHttpError("provider network failure", "relay_unreachable")));
      controller.signal.addEventListener("abort", onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
      else request.end(body);
    });
  } catch (error) {
    if (error instanceof SafeHttpError || (error as Error)?.name === "AbortError") throw error;
    throw new SafeHttpError("provider network failure", "relay_unreachable");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
