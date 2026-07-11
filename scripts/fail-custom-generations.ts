import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { DbPool, DbPoolClient } from "../src/db/db.server";

export const APPLY_CONFIRMATION = "FAIL_CUSTOM_GENERATIONS";
export const OPERATIONAL_FAILURE_MESSAGE = "自定义 Key 服务已由运维暂停，本站未扣积分，请稍后重试";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IN_FLIGHT_STATUSES = ["queued", "claimed", "running"] as const;

type InFlightStatus = (typeof IN_FLIGHT_STATUSES)[number];
type StatusCounts = Record<InFlightStatus, number>;

export interface FailCustomGenerationOptions {
  adminId: string;
  reason: string;
  apply: boolean;
  confirmation?: string;
}

export interface DryRunResult {
  mode: "dry-run";
  total: number;
  statuses: StatusCounts;
}

export interface ApplyResult {
  mode: "apply";
  matched: number;
  failed: number;
  statuses: StatusCounts;
  remainingInFlight: number;
  remainingTargetCredentials: number;
}

export type FailCustomGenerationResult = DryRunResult | ApplyResult;

interface OperationDependencies {
  createPool?: () => DbPool | Promise<DbPool>;
  log?: (line: string) => void;
}

export class FailCustomGenerationsError extends Error {
  constructor(message: string) {
    super(`[fail-custom-generations] ${message}`);
    this.name = "FailCustomGenerationsError";
  }
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new FailCustomGenerationsError(`${flag} requires a value`);
  }
  return value;
}

export function parseFailCustomGenerationArgs(args: string[]): FailCustomGenerationOptions {
  let adminId: string | undefined;
  let reason: string | undefined;
  let apply = false;
  let confirmation: string | undefined;
  const seen = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (seen.has(flag)) throw new FailCustomGenerationsError(`duplicate argument: ${flag}`);

    switch (flag) {
      case "--admin-id":
        seen.add(flag);
        adminId = readValue(args, index, flag);
        index += 1;
        break;
      case "--reason":
        seen.add(flag);
        reason = readValue(args, index, flag).trim();
        index += 1;
        break;
      case "--apply":
        seen.add(flag);
        apply = true;
        break;
      case "--confirm":
        seen.add(flag);
        confirmation = readValue(args, index, flag);
        index += 1;
        break;
      default:
        throw new FailCustomGenerationsError(`unknown argument: ${flag}`);
    }
  }

  if (!adminId) throw new FailCustomGenerationsError("--admin-id is required");
  if (!UUID_PATTERN.test(adminId)) {
    throw new FailCustomGenerationsError("--admin-id must be a valid UUID");
  }
  if (!reason) throw new FailCustomGenerationsError("--reason must be non-empty");
  if (!apply && confirmation !== undefined) {
    throw new FailCustomGenerationsError("--confirm requires --apply");
  }
  if (apply && confirmation !== APPLY_CONFIRMATION) {
    throw new FailCustomGenerationsError(`--apply requires exact confirmation ${APPLY_CONFIRMATION}`);
  }

  return {
    adminId,
    reason,
    apply,
    ...(apply ? { confirmation } : {}),
  };
}

function emptyStatusCounts(): StatusCounts {
  return { queued: 0, claimed: 0, running: 0 };
}

function summarizeStatuses(rows: Array<{ status: unknown; n?: unknown }>): StatusCounts {
  const statuses = emptyStatusCounts();
  for (const row of rows) {
    if (typeof row.status !== "string" || !IN_FLIGHT_STATUSES.includes(row.status as InFlightStatus)) {
      throw new FailCustomGenerationsError("database returned an unexpected generation status");
    }
    const count = Number(row.n ?? 1);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new FailCustomGenerationsError("database returned an invalid generation count");
    }
    statuses[row.status as InFlightStatus] += count;
  }
  return statuses;
}

function totalStatuses(statuses: StatusCounts): number {
  return statuses.queued + statuses.claimed + statuses.running;
}

async function defaultCreatePool(): Promise<DbPool> {
  const { getPool } = await import("../src/db/db.server");
  return getPool();
}

export async function runFailCustomGenerations(
  options: FailCustomGenerationOptions,
  dependencies: OperationDependencies = {},
): Promise<FailCustomGenerationResult> {
  if (process.env.CUSTOM_KEY_MODES_ENABLED === "true") {
    throw new FailCustomGenerationsError(
      "disable CUSTOM_KEY_MODES_ENABLED first and deploy the disabled entry point",
    );
  }
  if (!UUID_PATTERN.test(options.adminId)) {
    throw new FailCustomGenerationsError("--admin-id must be a valid UUID");
  }
  if (!options.reason.trim()) throw new FailCustomGenerationsError("--reason must be non-empty");
  if (options.apply && options.confirmation !== APPLY_CONFIRMATION) {
    throw new FailCustomGenerationsError(`--apply requires exact confirmation ${APPLY_CONFIRMATION}`);
  }

  const createPool = dependencies.createPool ?? defaultCreatePool;
  const log = dependencies.log ?? console.log;
  const pool = await createPool();
  let client: DbPoolClient | undefined;

  try {
    client = await pool.connect();
    if (!options.apply) {
      const scan = await client.query(
        `SELECT status,count(*)::int AS n
         FROM generations
         WHERE credential_mode='custom' AND status IN ('queued','claimed','running')
         GROUP BY status
         ORDER BY status`,
      );
      const statuses = summarizeStatuses(scan.rows);
      const result: DryRunResult = {
        mode: "dry-run",
        total: totalStatuses(statuses),
        statuses,
      };
      log(JSON.stringify(result));
      return result;
    }

    let targetIds: string[] = [];
    let statuses = emptyStatusCounts();
    let failed = 0;
    let committed = false;
    try {
      await client.query("BEGIN");
      const locked = await client.query(
        `SELECT id,user_id,status
         FROM generations
         WHERE credential_mode='custom' AND status IN ('queued','claimed','running')
         ORDER BY id
         FOR UPDATE`,
      );
      statuses = summarizeStatuses(locked.rows);
      const lockedIds = locked.rows.map((row) => String(row.id));

      const updated = await client.query(
        `UPDATE generations
         SET status='failed',error_code='unknown',error=$1,http_status=NULL,credits_charged_mp=0,
             completed_at=now(),
             duration_ms=CASE WHEN started_at IS NULL THEN NULL
                              ELSE LEAST(
                                GREATEST(EXTRACT(EPOCH FROM now()-started_at)*1000,0),
                                2147483647
                              )::int END,
             updated_at=now()
         WHERE id=ANY($2::uuid[]) AND credential_mode='custom'
           AND status IN ('queued','claimed','running')
         RETURNING id,user_id`,
        [OPERATIONAL_FAILURE_MESSAGE, lockedIds],
      );
      targetIds = updated.rows.map((row) => String(row.id));
      failed = updated.rowCount ?? targetIds.length;

      await client.query(
        "DELETE FROM generation_credentials WHERE generation_id=ANY($1::uuid[])",
        [targetIds],
      );
      for (const row of updated.rows) {
        await client.query("INSERT INTO events(type,user_id,payload) VALUES('image_failed',$1,$2)", [
          row.user_id,
          {
            generationId: row.id,
            reason: "unknown",
            credentialMode: "custom",
            source: "fail_custom_generations",
          },
        ]);
      }
      await client.query(
        `INSERT INTO audit_log(admin_id,action,target_type,target_id,before,after,reason)
         VALUES($1,'fail_custom_generations','generation',NULL,$2::jsonb,$3::jsonb,$4)`,
        [
          options.adminId,
          { credentialMode: "custom", statuses },
          { status: "failed", errorCode: "unknown", creditsChargedMp: 0, count: failed },
          options.reason.trim(),
        ],
      );
      await client.query("COMMIT");
      committed = true;
    } catch (error) {
      if (!committed) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original transaction error.
        }
      }
      throw error;
    }

    const postcondition = await client.query(
      `SELECT
         (SELECT count(*)::int FROM generations
          WHERE credential_mode='custom' AND status IN ('queued','claimed','running')) AS remaining_in_flight,
         (SELECT count(*)::int FROM generation_credentials
          WHERE generation_id=ANY($1::uuid[])) AS remaining_target_credentials`,
      [targetIds],
    );
    const remainingInFlight = Number(postcondition.rows[0]?.remaining_in_flight ?? -1);
    const remainingTargetCredentials = Number(
      postcondition.rows[0]?.remaining_target_credentials ?? -1,
    );
    if (remainingInFlight !== 0 || remainingTargetCredentials !== 0) {
      throw new FailCustomGenerationsError("postcondition failed after the containment transaction");
    }

    const result: ApplyResult = {
      mode: "apply",
      matched: totalStatuses(statuses),
      failed,
      statuses,
      remainingInFlight,
      remainingTargetCredentials,
    };
    log(JSON.stringify(result));
    return result;
  } finally {
    client?.release();
    // Persistent runtimes own the shared pool and close it during process shutdown.
    // Injected pools remain owned by their caller.
    if (dependencies.createPool) await pool.end();
  }
}

async function runCli(): Promise<void> {
  const options = parseFailCustomGenerationArgs(process.argv.slice(2));
  await runFailCustomGenerations(options);
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entryPath === import.meta.url) {
  try {
    await runCli();
  } catch (error) {
    console.error(
      error instanceof FailCustomGenerationsError
        ? error.message
        : "[fail-custom-generations] operation failed",
    );
    process.exitCode = 1;
  }
}
