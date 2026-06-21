// 钱链路真库测试 setup：把 .env 注入 process.env（若尚未注入）。
// 优先用 Node 原生 process.loadEnvFile（Node 20.12+）；不可用则手工解析 .env（仅取首个 `=` 前为 key）。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv(): void {
  if (process.env.DATABASE_URL_UNPOOLED) return; // 已由 --env-file / CI 注入
  const path = resolve(process.cwd(), ".env");
  // Node 原生（最稳）。
  const loadEnvFile = (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile;
  if (typeof loadEnvFile === "function") {
    try {
      loadEnvFile(path);
      if (process.env.DATABASE_URL_UNPOOLED) return;
    } catch {
      // 落到手工解析
    }
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return; // 没有 .env：交给测试在缺串时显式失败
  }
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadDotEnv();

if (!process.env.DATABASE_URL_UNPOOLED || !process.env.DATABASE_URL) {
  throw new Error(
    "[money-test] 缺少 DATABASE_URL / DATABASE_URL_UNPOOLED（钱链路真库测试需 Neon 串，见 .env / PHASE2-PLAN §0）",
  );
}
