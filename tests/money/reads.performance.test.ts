// PostgreSQL verification for the read/query changes; fixtures belong only to fresh test users.
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfigInt } from "../../src/server/config.server";
import { loadMe } from "../../src/server/reads.server";
import {
  createProject, loadProjects, renameProject, reorderProjectConversations, reorderProjects,
} from "../../src/server/projects.server";
import { type TestCtx, newCtx } from "./_helpers";

let ctx: TestCtx;
beforeEach(() => { ctx = newCtx(); });
afterEach(() => ctx.cleanup());

describe("optimized reads on PostgreSQL", () => {
  it("preserves defaults with no account or expiring lots and reads the current persisted price", async () => {
    const user = await ctx.createUser();
    await ctx.sql`DELETE FROM credit_accounts WHERE user_id=${user}`;
    const currentPrice = await getConfigInt("price_per_image_mp", 70);
    const result = await loadMe(user);
    expect(result).toMatchObject({
      user: { id: user }, balanceMp: 0, hasPaid: false, maxConcurrency: 2,
      pricePerImageMp: currentPrice, expiringSoon: { mp: "0", nearestExpiresAt: null },
    });
  });

  it("keeps exact bigint expiry totals and excludes other users and ineligible lots", async () => {
    const user = await ctx.createUser({ balanceMp: 123, hasPaid: true });
    const other = await ctx.createUser();
    await ctx.sql`INSERT INTO credit_lots(user_id,source,granted_mp,remaining_mp,expires_at)
      VALUES (${user}, 'adjust', '9007199254740993'::bigint, '9007199254740993'::bigint, now()+interval '1 day')`;
    await ctx.addLot(user, 20, { expiresInDays: 10 });
    await ctx.addLot(user, 40, { expiresInDays: null });
    await ctx.addLot(other, 80, { expiresInDays: 1 });
    const result = await loadMe(user);
    expect(result.balanceMp).toBe(123);
    expect(result.hasPaid).toBe(true);
    expect(result.expiringSoon.mp).toBe("9007199254740993");
    expect(result.expiringSoon.nearestExpiresAt).not.toBeNull();
  });

  it("returns 404 for a missing user", async () => {
    await expect(loadMe(randomUUID())).rejects.toMatchObject({ status: 404 });
  });

  it("scopes the project returned after rename and retains its full ordered conversation set", async () => {
    const user = await ctx.createUser();
    const other = await ctx.createUser();
    const { item: target } = await createProject(user, "target");
    const { item: second } = await createProject(user, "second");
    const { item: foreign } = await createProject(other, "foreign");
    const firstId = randomUUID();
    const secondId = randomUUID();
    await ctx.sql`INSERT INTO conversations(id,user_id,project_id,title,sort_order)
      VALUES (${firstId},${user},${target.id},'first',1), (${secondId},${user},${target.id},'second',0)`;
    await ctx.sql`INSERT INTO conversations(user_id,project_id,title)
      VALUES (${user},${second.id},'unrelated'), (${other},${foreign.id},'private')`;
    const result = await renameProject(user, target.id, "renamed");
    expect(result?.item.name).toBe("renamed");
    expect(result?.item.conversations.map((c) => c.id)).toEqual([secondId, firstId]);
    expect(await renameProject(user, foreign.id, "forbidden")).toBeNull();
  });

  it("bulk-sorts projects in exact array order and rejects foreign, incomplete and duplicate sets", async () => {
    const user = await ctx.createUser();
    const other = await ctx.createUser();
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await createProject(user, `project-${i}`)).item.id);
    const foreign = (await createProject(other, "foreign")).item.id;
    const order = [ids[1], ids[2], ids[0]];
    expect(await reorderProjects(user, order)).toBe(true);
    expect((await loadProjects(user)).items.map((p) => [p.id, p.sortOrder])).toEqual(order.map((id, i) => [id, i]));
    expect(await reorderProjects(user, [ids[0], ids[0], ids[2]])).toBe(false);
    expect(await reorderProjects(user, [ids[0], ids[1], foreign])).toBe(false);
    expect(await reorderProjects(user, [ids[0]])).toBe(false);
    expect((await loadProjects(user)).items.map((p) => p.id)).toEqual(order);
    expect((await loadProjects(other)).items[0].id).toBe(foreign);
  });

  it("bulk-sorts a complete conversation group and rejects cross-project/owner or duplicate IDs", async () => {
    const user = await ctx.createUser();
    const other = await ctx.createUser();
    const project = (await createProject(user, "target")).item.id;
    const foreign = (await createProject(other, "foreign")).item.id;
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (let i = 0; i < ids.length; i++) {
      await ctx.sql`INSERT INTO conversations(id,user_id,project_id,title,sort_order)
        VALUES (${ids[i]},${user},${project},${`conversation-${i}`},${i})`;
    }
    const order = [ids[2], ids[0], ids[1]];
    expect(await reorderProjectConversations(user, project, order)).toBe(true);
    expect((await loadProjects(user)).items[0].conversations.map((c) => [c.id, c.sortOrder]))
      .toEqual(order.map((id, i) => [id, i]));
    expect(await reorderProjectConversations(user, project, [ids[0], ids[0], ids[1]])).toBe(false);
    expect(await reorderProjectConversations(user, project, [ids[0]])).toBe(false);
    expect(await reorderProjectConversations(other, project, order)).toBe(false);
    expect(await reorderProjectConversations(user, foreign, order)).toBe(false);
    expect((await loadProjects(user)).items[0].conversations.map((c) => c.id)).toEqual(order);
  });

  it("serializes competing complete project reorders without a mixed final order", async () => {
    const user = await ctx.createUser();
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await createProject(user, `project-${i}`)).item.id);
    const reversed = [...ids].reverse();
    expect(await Promise.all([reorderProjects(user, ids), reorderProjects(user, reversed)])).toEqual([true, true]);
    const result = (await loadProjects(user)).items;
    expect([ids, reversed]).toContainEqual(result.map((p) => p.id));
    expect(result.map((p) => p.sortOrder)).toEqual([0, 1, 2]);
  });
});
