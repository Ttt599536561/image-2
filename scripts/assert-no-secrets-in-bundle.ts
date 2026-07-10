// 构建期密钥断言（⑦ · CI 兜底，真相源 10 §11.10 / 00 §1.4）。扫 build/client（浏览器实际下载执行的 bundle），
// 断言：① 密钥「值」未出现（从 env 取真实值，长度≥8 才扫，避免短串误报）；② db/schema 结构标记未泄露
//   （钱幂等键名 uq_debit 等 / 内部表名），命中即 exit(1)。这是钱红线「客户端 0 密钥 + 0 schema 泄露」的 CI 兜底。
//
// 跑（本地，从 .env 注入密钥值）：node --env-file=.env --import tsx scripts/assert-no-secrets-in-bundle.ts
// 跑（CI，无 .env）：node --import tsx scripts/assert-no-secrets-in-bundle.ts —— 从 CI 注入的 process.env 取值；
//   未注入的密钥值跳过（结构标记始终扫，且密钥「值」不出现是硬要求，缺值时该项无法验证但不放过结构泄露）。
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const CLIENT_DIR = "build/client";

// 密钥环境变量名（其「值」绝不可进客户端 bundle）。
const SECRET_ENV_NAMES = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "RELAY_API_KEY",
  "RELAY_BASE_URL",
  "RELAY_BASE_URL_BACKUP",
  "BETTER_AUTH_SECRET",
  "STORAGE_S3_ACCESS_KEY_ID",
  "STORAGE_S3_SECRET_ACCESS_KEY",
  "ADMIN_ALERT_WEBHOOK",
  "SENTRY_DSN",
  "CUSTOM_KEY_JOB_ENCRYPTION_KEY",
];

const PUBLIC_VALUE_ALLOWLIST = new Set([
  "https://api.tangguo.xin/v1",
  "https://api.tangguo.xin/v1/",
]);

// db/schema 结构泄露标记：钱幂等键名（02 §3.3）+ 内部账本表名。客户端可达模块须手写 Zod、绝不 value-import db/schema
// （⑤ 已修 package.ts 的 value-import 泄露）；这些串出现在客户端 = 整套钱 schema 被打进 bundle。
const STRUCT_MARKERS = [
  "uq_debit",
  "uq_refund",
  "uq_grant_signup",
  "uq_credit_code",
  "uq_expire_lot",
  "credit_ledger",
  "credit_lots",
  "credit_accounts",
  "generation_credentials",
];

// 扫描的可执行/可下载文件类型（client bundle 仅 js/css；含 html/json 兜底；不含 .map，react-router build 默认不产）。
const SCAN_EXT = /\.(js|mjs|cjs|css|html|json)$/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (SCAN_EXT.test(p)) out.push(p);
  }
  return out;
}

function main(): void {
  if (!existsSync(CLIENT_DIR)) {
    console.error(`[assert-no-secrets] 找不到 ${CLIENT_DIR}/，请先 npm run build`);
    process.exit(1);
  }

  const secretValues = SECRET_ENV_NAMES.map((name) => ({ name, value: process.env[name] })).filter(
    (s): s is { name: string; value: string } =>
      typeof s.value === "string" && s.value.length >= 8 && !PUBLIC_VALUE_ALLOWLIST.has(s.value),
  );

  const files = walk(CLIENT_DIR);
  const findings: string[] = [];
  for (const f of files) {
    const txt = readFileSync(f, "utf8");
    for (const s of secretValues) if (txt.includes(s.value)) findings.push(`密钥值 ${s.name} 出现在 ${f}`);
    for (const m of STRUCT_MARKERS) if (txt.includes(m)) findings.push(`schema 结构标记「${m}」出现在 ${f}`);
  }

  if (findings.length > 0) {
    console.error(`[assert-no-secrets] FAIL（${findings.length} 处泄露）：`);
    for (const x of findings) console.error("  ✗ " + x);
    process.exit(1);
  }
  console.log(
    `[assert-no-secrets] PASS（扫描 ${files.length} 文件；密钥值 ${secretValues.length} 项 + 结构标记 ${STRUCT_MARKERS.length} 项均未泄露）` +
      (secretValues.length < SECRET_ENV_NAMES.length
        ? `\n  注：${SECRET_ENV_NAMES.length - secretValues.length} 个密钥未在 env 注入、其「值」本轮跳过（结构标记仍全扫）。`
        : ""),
  );
}

main();
