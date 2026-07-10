import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DISPOSABLE_DATABASE_ACK } from "./test-env-guard";

const url = new URL("postgresql://localhost");
url.username = "postgres";
url.hostname = "127.0.0.1";
url.port = process.env.LOCAL_TEST_DB_PORT ?? "55432";
url.pathname = "/iamge_test";

const values = [
  `DATABASE_URL=${url.toString()}`,
  `DATABASE_URL_UNPOOLED=${url.toString()}`,
  `MONEY_TEST_ALLOW_MUTATION=${DISPOSABLE_DATABASE_ACK}`,
  "DISPOSABLE_TEST_DB_DRIVER=pg",
  "BETTER_AUTH_URL=http://localhost:8888",
  `BETTER_AUTH_SECRET=${Buffer.alloc(32, 11).toString("base64")}`,
  `CUSTOM_KEY_JOB_ENCRYPTION_KEY=${Buffer.alloc(32, 7).toString("base64")}`,
  "CUSTOM_KEY_MODES_ENABLED=true",
];

writeFileSync(resolve(process.cwd(), ".env.test"), `${values.join("\n")}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
console.log("[test-env] local disposable configuration ready");
