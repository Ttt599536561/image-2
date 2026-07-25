// ★server-only：项目服务（F-074 侧边栏项目分组）。
// 读走 HTTP 单语句 getSql()（对齐 reads.server.ts）；写走 tx() 事务（整组重排必须原子）。
// 🔴 红线：一律 owner-scoped（WHERE user_id=$me）；排序请求必须与被排组现有 id 集合完全一致，
//    防丢会话/越权排他人数据；默认项目每用户至多一个（DB 部分唯一索引 uq_projects_user_default 兜底）。
import type {
  ProjectListItem,
  ProjectListResponse,
  ProjectMutationResponse,
} from "../contracts/project";
import { getSql } from "../db/db.server";
import { type TxClient, tx } from "./tx.server";

type Row = Record<string, unknown>;

const num = (v: unknown): number => Number(v ?? 0);
const iso = (v: unknown): string => new Date(v as string | number | Date).toISOString();

const DEFAULT_PROJECT_NAME = "默认项目";

// ===================== 读 =====================

/** 侧栏项目列表：项目按 sort_order 升序，项目内会话按 sort_order 升序（平移 updated_at 兜底）。 */
export async function loadProjects(userId: string): Promise<ProjectListResponse> {
  const sql = getSql();
  const projects = (await sql`
    SELECT id, name, is_default, sort_order FROM projects
    WHERE user_id = ${userId}
    ORDER BY sort_order ASC, created_at ASC`) as Row[];
  if (projects.length === 0) return { items: [] };
  const ids = projects.map((p) => p.id as string);
  const convs = (await sql`
    SELECT id, project_id, title, sort_order, updated_at FROM conversations
    WHERE user_id = ${userId} AND project_id = ANY(${ids})
    ORDER BY sort_order ASC, updated_at DESC`) as Row[];
  const byProject = new Map<string, Row[]>();
  for (const c of convs) {
    const key = c.project_id as string;
    const list = byProject.get(key) ?? [];
    list.push(c);
    byProject.set(key, list);
  }
  return {
    items: projects.map((p) => ({
      id: p.id as string,
      name: p.name as string,
      isDefault: p.is_default as boolean,
      sortOrder: num(p.sort_order),
      conversations: (byProject.get(p.id as string) ?? []).map((c) => ({
        id: c.id as string,
        title: c.title as string,
        sortOrder: num(c.sort_order),
        updatedAt: iso(c.updated_at),
      })),
    })),
  };
}

async function loadProjectItem(userId: string, projectId: string): Promise<ProjectListItem | null> {
  const res = await loadProjects(userId);
  return res.items.find((p) => p.id === projectId) ?? null;
}

// ===================== 默认项目（enqueue 同事务调用） =====================

/**
 * 保证用户存在默认项目并返回其 id（懒创建）。
 * 并发安全：uq_projects_user_default 部分唯一索引兜底，败者回读胜者行。必须在事务内调用。
 */
export async function ensureDefaultProject(c: TxClient, userId: string): Promise<string> {
  const ins = await c.query(
    `INSERT INTO projects(user_id, name, is_default, sort_order)
     VALUES($1, $2, true, 0)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [userId, DEFAULT_PROJECT_NAME],
  );
  if (ins.rowCount && ins.rows[0]) return ins.rows[0].id as string;
  const sel = await c.query(
    `SELECT id FROM projects WHERE user_id=$1 AND is_default LIMIT 1`,
    [userId],
  );
  if (sel.rows.length === 0) throw new Error("default project missing after insert race");
  return sel.rows[0].id as string;
}

// ===================== 写 =====================

/** 新建项目：置顶（sort_order=0），其余项目 +1；同事务原子。 */
export async function createProject(userId: string, name: string): Promise<ProjectMutationResponse> {
  const id = await tx(async (c) => {
    await c.query(`UPDATE projects SET sort_order = sort_order + 1 WHERE user_id=$1`, [userId]);
    const r = await c.query(
      `INSERT INTO projects(user_id, name, sort_order) VALUES($1,$2,0) RETURNING id`,
      [userId, name],
    );
    return r.rows[0].id as string;
  });
  const item = await loadProjectItem(userId, id);
  if (!item) throw new Error("project missing after create");
  return { item };
}

/** 重命名项目（默认项目允许）。owner 不命中 → null（路由返 404）。 */
export async function renameProject(
  userId: string,
  projectId: string,
  name: string,
): Promise<ProjectMutationResponse | null> {
  const sql = getSql();
  const r = (await sql`
    UPDATE projects SET name = ${name}, updated_at = now()
    WHERE id = ${projectId} AND user_id = ${userId}
    RETURNING id`) as Row[];
  if (r.length === 0) return null;
  const item = await loadProjectItem(userId, projectId);
  if (!item) throw new Error("project missing after rename");
  return { item };
}

/** 校验 ids 与期望集合完全一致（不多不少无重复），返回 true 通过。 */
function sameIdSet(ids: string[], expected: Set<string>): boolean {
  if (ids.length !== expected.size) return false;
  return ids.every((id) => expected.has(id));
}

/** 项目整组重排：ids 必须恰为该用户全部项目；同事务重写 0..n-1。集合不符 → false（路由返 400）。 */
export async function reorderProjects(userId: string, ids: string[]): Promise<boolean> {
  const sql = getSql();
  const existing = (await sql`SELECT id FROM projects WHERE user_id = ${userId}`) as Row[];
  if (!sameIdSet(ids, new Set(existing.map((r) => r.id as string)))) return false;
  await tx(async (c) => {
    for (let i = 0; i < ids.length; i++) {
      await c.query(`UPDATE projects SET sort_order=$1 WHERE id=$2 AND user_id=$3`, [i, ids[i], userId]);
    }
  });
  return true;
}

/** 项目内会话整组重排：项目须属本人，ids 须恰为该项目全部会话；同事务重写 0..n-1。 */
export async function reorderProjectConversations(
  userId: string,
  projectId: string,
  ids: string[],
): Promise<boolean> {
  const sql = getSql();
  const own = (await sql`
    SELECT id FROM projects WHERE id = ${projectId} AND user_id = ${userId}`) as Row[];
  if (own.length === 0) return false;
  const existing = (await sql`
    SELECT id FROM conversations WHERE project_id = ${projectId} AND user_id = ${userId}`) as Row[];
  if (!sameIdSet(ids, new Set(existing.map((r) => r.id as string)))) return false;
  await tx(async (c) => {
    for (let i = 0; i < ids.length; i++) {
      await c.query(
        `UPDATE conversations SET sort_order=$1 WHERE id=$2 AND project_id=$3 AND user_id=$4`,
        [i, ids[i], projectId, userId],
      );
    }
  });
  return true;
}
