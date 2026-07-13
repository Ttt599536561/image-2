# Conversation Image Text Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user start a text-only image edit from a successful result in the current conversation, append the edit as a normal generation, and preserve the source relationship through retries and further edits.

**Architecture:** Keep `POST /api/generate` and the existing queue, relay, storage, and billing state machine. Add an owner-scoped `source_image_id` relation to generations, validate it transactionally at enqueue, resolve it again from server storage in the worker, and expose only an image ID plus public summary to the client. The conversation Composer owns a separate edit draft so ordinary input is untouched; the generation hook carries only `sourceImageId` on the wire and writes the source summary into the optimistic turn.

**Tech Stack:** React 19, React Router 8, TanStack Query 5, TypeScript 6, Zod 4, PostgreSQL 17, Drizzle schema/migrations, Vitest, Testing Library, existing S3/local storage adapter and `/images/edits` relay path.

---

### Task 1: Extend the request, status, conversation, and database contracts

**Files:**
- Modify: `src/contracts/generate.test.ts`
- Modify: `src/contracts/public-media-url.test.ts`
- Modify: `src/contracts/generate.ts`
- Modify: `src/contracts/conversation.ts`
- Modify: `src/contracts/error.ts`
- Modify: `src/db/schema.ts`
- Create: `drizzle/0007_generation_source_image.sql`
- Modify: `app/routes/healthz.ts`

- [ ] **Step 1: Write failing request and response contract tests**

Add request cases that accept a UUID source, reject a non-UUID source, reject a request containing both source forms, and keep ordinary requests compatible:

```ts
const sourceImageId = "00000000-0000-4000-8000-000000000009";

it("accepts one existing source image id", () => {
  expect(GenerateRequest.parse({ ...params, sourceImageId })).toMatchObject({
    sourceImageId,
    credentialMode: "system",
  });
});

it("rejects malformed or conflicting source images", () => {
  expect(GenerateRequest.safeParse({ ...params, sourceImageId: "https://example.test/a.png" }).success).toBe(false);
  expect(GenerateRequest.safeParse({ ...params, sourceImageId, inputImageKey: "uploads/me/ref.png" }).success).toBe(false);
});
```

Extend the public-media contract fixtures with explicit `sourceImageId` and `sourceImage`; cover both a populated summary and `null` for an ordinary generation.

- [ ] **Step 2: Run the contract tests and verify the new cases fail for missing fields**

Run:

```powershell
npm run test:run -- src/contracts/generate.test.ts src/contracts/public-media-url.test.ts
```

Expected: FAIL because `sourceImageId` is stripped/rejected and source response fields are not defined.

- [ ] **Step 3: Add the source schemas and stable errors**

Define the shared response shape in `generate.ts`, retain a separate source ID so a deleted summary cannot turn a retry into text-to-image, and keep dimensions nullable for legacy images:

```ts
export const SourceImageSummary = z.object({
  id: z.uuid(),
  publicUrl: PublicMediaUrlSchema,
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});
export type SourceImageSummary = z.infer<typeof SourceImageSummary>;

export const GenerateRequest = GenerateParamsSchema.extend({
  sourceImageId: z.uuid().optional(),
  credentialMode: CredentialModeSchema.optional(),
  customApiKey: z.string().trim().max(500).optional(),
})
  .strict()
  .superRefine((value, ctx) => {
    if (value.sourceImageId && value.inputImageKey) {
      ctx.addIssue({ code: "custom", path: ["sourceImageId"], message: "SOURCE_IMAGE_CONFLICT" });
    }
    // Preserve the existing credential-mode checks.
  });
```

Add `source_image_unavailable` to the generation failure-code schemas and `SOURCE_IMAGE_UNAVAILABLE` to API error codes. Add `sourceImageId: z.uuid().nullable()` and `sourceImage: SourceImageSummary.nullable()` to both status identity and `ConversationGeneration`; server responses and optimistic turns must always return explicit `null` for ordinary generations.

- [ ] **Step 4: Add the nullable database field, non-FK index, migration, and health check**

Add this Drizzle field/index without a foreign key:

```ts
sourceImageId: uuid("source_image_id"),
index("ix_gen_source_image").on(t.sourceImageId),
```

Create the idempotent migration:

```sql
ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "source_image_id" uuid;
CREATE INDEX IF NOT EXISTS "ix_gen_source_image" ON "generations" ("source_image_id");
```

Include `g.source_image_id` in the zero-row health query so Web does not report healthy before migration `0007` is applied.

- [ ] **Step 5: Run the focused contract tests and verify they pass**

Run the same command from Step 2.

Expected: PASS with ordinary requests unchanged and the source conflict rejected.

- [ ] **Step 6: Commit the contract and migration slice**

```powershell
git add src/contracts/generate.test.ts src/contracts/public-media-url.test.ts src/contracts/generate.ts src/contracts/conversation.ts src/contracts/error.ts src/db/schema.ts drizzle/0007_generation_source_image.sql app/routes/healthz.ts
git commit -m "feat: add conversation edit source contracts"
```

### Task 2: Enforce source ownership and current-conversation membership during enqueue

**Files:**
- Modify: `tests/unit/generate-handler.test.ts`
- Modify: `tests/money/enqueue.test.ts`
- Modify: `tests/money/enqueue-custom.test.ts`
- Modify: `src/server/generation/enqueue.ts`

- [ ] **Step 1: Write failing handler and transaction tests**

Add a handler case proving the route forwards only the UUID field and does not enqueue malformed/conflicting input. In the disposable-database suite, create a succeeded source generation plus image and assert a same-user, same-conversation edit stores `source_image_id` while leaving the source row intact:

```ts
const accepted = await enqueueGeneration({
  user: { id: userId, maxConcurrency: 2 },
  input: {
    prompt: "把招牌文字改成夏日限定",
    size: "1024x1024",
    conversationId,
    sourceImageId,
    credentialMode: "system",
  },
});
expect((await ctx.gen(accepted.generationId))?.source_image_id).toBe(sourceImageId);
expect(await ctx.sql`SELECT id FROM images WHERE id=${sourceImageId}`).toHaveLength(1);
```

Use a table-driven negative test for a foreign image, fabricated UUID, non-succeeded source generation, source from another conversation, and `sourceImageId + inputImageKey`. Assert the response is uniform, and no conversation, generation, credential, balance, lot, or ledger mutation occurs. Add one custom valid-source case to prove the same permission check runs while custom still bypasses system money gates.

- [ ] **Step 2: Apply the test migration, then run the enqueue tests and verify they fail**

Run:

```powershell
npm run db:test:migrate
npm run test:run -- tests/unit/generate-handler.test.ts
npm run test:money -- tests/money/enqueue.test.ts tests/money/enqueue-custom.test.ts
```

Expected: contract handler tests reach the mock, but database tests FAIL because enqueue does not query or persist `source_image_id`.

- [ ] **Step 3: Validate the source before all task creation and money gates**

Extend `EnqueueRequest`/`PersistableEnqueueRequest` with `sourceImageId`. At the start of `run`, fail closed on the two input mechanisms, then perform one transaction-scoped query:

```ts
const sourceImageId = input.sourceImageId ?? null;
if (sourceImageId && inputImageKey) {
  throw httpError(400, "INVALID_PARAM", "来源图片参数冲突");
}
if (sourceImageId) {
  if (!input.conversationId) {
    throw httpError(404, "SOURCE_IMAGE_UNAVAILABLE", "这张图片已不可编辑");
  }
  const source = await c.query(
    `SELECT i.id
       FROM images i
       JOIN generations sg ON sg.id=i.generation_id
      WHERE i.id=$1 AND i.user_id=$2 AND sg.user_id=$2
        AND sg.status='succeeded' AND sg.conversation_id=$3`,
    [sourceImageId, user.id, input.conversationId],
  );
  if (source.rowCount !== 1) {
    throw httpError(404, "SOURCE_IMAGE_UNAVAILABLE", "这张图片已不可编辑");
  }
}
```

Keep the source check before account locking/concurrency/budget checks so invalid, foreign, or unavailable sources create no task and mutate no system state. Add `source_image_id` to the generation INSERT. Never derive `credentialMode` from the source generation.

- [ ] **Step 4: Re-run the handler and enqueue tests and verify they pass**

Run the commands from Step 2 without re-running migration.

Expected: PASS; all invalid source variants use the same public error and create zero task rows.

- [ ] **Step 5: Commit the enqueue permission slice**

```powershell
git add tests/unit/generate-handler.test.ts tests/money/enqueue.test.ts tests/money/enqueue-custom.test.ts src/server/generation/enqueue.ts
git commit -m "feat: validate conversation edit sources"
```

### Task 3: Resolve source bytes in the worker and preserve billing invariants

**Files:**
- Modify: `tests/money/pipeline.test.ts`
- Modify: `tests/money/pipeline-custom.test.ts`
- Modify: `src/server/generation/failure.test.ts`
- Modify: `src/server/generation/failure.ts`
- Modify: `src/server/r2.server.local.test.ts`
- Modify: `src/server/r2.server.ts`
- Modify: `src/server/money/preempt.server.ts`
- Modify: `src/server/generation/process.ts`

- [ ] **Step 1: Write failing source-worker, unreadable-source, system, and custom billing tests**

For a system edit, insert a succeeded source image, queue a child with `source_image_id`, and inject `getStoredImageObject`/relay/storage fakes. Assert the worker re-queries the source storage key, sends bytes to the edit path, creates a distinct child image, preserves the source image, writes one debit, subtracts exactly the configured price from account/lots, and records `credits_charged_mp=PRICE`.

For custom, start with a nonzero balance and lot snapshot, run the same source flow using a custom credential, then assert `credits_charged_mp=0`, no debit, and unchanged account/lots. Add source-row-deleted and storage-read-failure cases that assert `source_image_unavailable`, no relay call, no child image, and no debit. Keep the existing timeout and duplicate-claim cases as the proof that an edit also receives at most one terminal/debit.

Add failure normalization coverage:

```ts
expect(normalizeFailure(
  Object.assign(new Error("这张图片已不可编辑"), { failureCode: "source_image_unavailable" }),
  { mode: "system", secrets: [] },
)).toMatchObject({ code: "source_image_unavailable" });
```

- [ ] **Step 2: Run the focused failure/storage/pipeline tests and verify the source cases fail**

Run:

```powershell
npm run test:run -- src/server/generation/failure.test.ts src/server/r2.server.local.test.ts
npm run test:money -- tests/money/pipeline.test.ts tests/money/pipeline-custom.test.ts
```

Expected: FAIL because claimed generations do not expose a source ID and the worker only understands temporary upload keys.

- [ ] **Step 3: Add a generic server-side storage read without changing browser inputs**

Extract the current S3/local read body into `getStoredImageObject(storageKey)` and keep `getUploadObject(storageKey)` as a compatibility wrapper. The generic adapter must return only `{bytes, contentType, filename}` and retain local path/symlink defenses.

- [ ] **Step 4: Re-query the source in the worker and feed the existing edit relay**

Return `source_image_id` from `claim()` as `sourceImageId`. Before calling the system budget counter, resolve source edits with an owner/status-scoped server query and read the resulting storage key through the adapter:

```ts
if (g.inputImageKey && g.sourceImageId) throw sourceImageUnavailable();
if (g.sourceImageId) {
  const [source] = await sql`
    SELECT i.storage_key
      FROM images i
      JOIN generations sg ON sg.id=i.generation_id
     WHERE i.id=${g.sourceImageId} AND i.user_id=${g.userId}
       AND sg.user_id=${g.userId} AND sg.status='succeeded'`;
  if (!source) throw sourceImageUnavailable();
  try {
    inputImage = await getStoredImageObject(String(source.storage_key));
  } catch {
    throw sourceImageUnavailable();
  }
}
```

Use `source_image_unavailable` for this local failure, do not attach a storage key or URL to its message/event/log, and keep the existing `callRelay({ inputImage })` path. The current `chargeOnSuccess` and `finalizeCustomSuccess` functions remain unchanged. Update timing labels to `edit`, `i2i`, or `t2i` without logging a key.

- [ ] **Step 5: Re-run the focused failure/storage/pipeline tests and verify they pass**

Run the commands from Step 2.

Expected: PASS; source failures never reach relay/finalization, system succeeds with one debit, and custom succeeds with zero debit.

- [ ] **Step 6: Commit the worker and billing slice**

```powershell
git add tests/money/pipeline.test.ts tests/money/pipeline-custom.test.ts src/server/generation/failure.test.ts src/server/generation/failure.ts src/server/r2.server.local.test.ts src/server/r2.server.ts src/server/money/preempt.server.ts src/server/generation/process.ts
git commit -m "feat: process stored image edit sources"
```

### Task 4: Return owner-scoped source summaries from conversation and status reads

**Files:**
- Modify: `src/server/generation/status.server.test.ts`
- Modify: `src/lib/generationBatch.test.ts`
- Modify: `src/server/generation/status.server.ts`
- Modify: `src/server/reads.server.ts`
- Modify: `tests/money/enqueue.test.ts`

- [ ] **Step 1: Write failing source-summary read tests**

After the valid enqueue fixture, call `loadConversationDetail` and `loadGenerationStatuses` as the owner. Assert both return the source ID and only the safe summary:

```ts
expect(detail.generations.at(-1)).toMatchObject({
  sourceImageId,
  sourceImage: { id: sourceImageId, publicUrl: "/media/source.png", width: 1, height: 1 },
});
expect(JSON.stringify(detail)).not.toContain("storage_key");
```

Delete the source image row and assert the edit generation still returns `sourceImageId` with `sourceImage: null`. Add ordinary status fixtures with both source fields set to `null`.

- [ ] **Step 2: Run the status/contract/enqueue read tests and verify the source summary fails**

Run:

```powershell
npm run test:run -- src/server/generation/status.server.test.ts src/lib/generationBatch.test.ts src/contracts/public-media-url.test.ts
npm run test:money -- tests/money/enqueue.test.ts
```

Expected: FAIL because neither SQL read joins the source image.

- [ ] **Step 3: Add owner-scoped source joins and response mapping**

In both queries select `g.source_image_id`, then use a second image alias guarded by owner:

```sql
LEFT JOIN images si
  ON si.id = g.source_image_id
 AND si.user_id = g.user_id
```

Return `sourceImageId` independently of join success. Return `sourceImage` only when the safe public fields exist; never select or serialize its `storage_key`. Keep the outer generation query owner-scoped exactly as it is.

- [ ] **Step 4: Re-run the status/contract/enqueue read tests and verify they pass**

Run the commands from Step 2.

Expected: PASS for populated, ordinary-null, and deleted-source responses.

- [ ] **Step 5: Commit the read-model slice**

```powershell
git add src/server/generation/status.server.test.ts src/lib/generationBatch.test.ts src/server/generation/status.server.ts src/server/reads.server.ts tests/money/enqueue.test.ts
git commit -m "feat: expose image edit source summaries"
```

### Task 5: Carry edit sources through optimistic submission and retry

**Files:**
- Modify: `src/hooks/useGeneration.test.tsx`
- Modify: `src/hooks/useGeneration.ts`

- [ ] **Step 1: Write a failing hook test for the wire payload and optimistic turn**

Seed an existing conversation whose succeeded image is the edit source, submit with a source context, and assert the POST body contains only the ID while the optimistic turn contains the safe summary:

```ts
result.current.submit(params, config, {
  source: { sourceImageId, sourceImage },
  onAccepted,
});
expect(mocks.apiPost.mock.calls[0][1]).toMatchObject({ sourceImageId });
expect(mocks.apiPost.mock.calls[0][1]).not.toHaveProperty("sourceImage");
expect(queryClient.getQueryData<ConversationDetail>(["conversation", conversationId])
  ?.generations.at(-1)).toMatchObject({ sourceImageId, sourceImage });
```

Keep the deferred response assertion proving edit state may close only after the accepted promise resolves.

- [ ] **Step 2: Run the hook tests and verify the source test fails**

Run:

```powershell
npm run test:run -- src/hooks/useGeneration.test.tsx
```

Expected: FAIL because `submit` has no source context and optimistic turns lack source fields.

- [ ] **Step 3: Replace positional optional arguments with a submission options object**

Use this local-only shape:

```ts
export interface GenerationSubmissionOptions {
  file?: File | null;
  source?: { sourceImageId: string; sourceImage: SourceImageSummary | null } | null;
  onAccepted?: (accepted: GenerateAccepted) => void;
}
```

`submit(req, config, options)` uploads only `options.file`, sends only `options.source?.sourceImageId`, and puts explicit source fields into `makeOptimisticTurn`. Invoke `options.onAccepted(accepted)` only after response validation. Preserve the existing synchronous double-submit lock, current mode snapshot, 503 rollback, and active-enqueue tracking.

- [ ] **Step 4: Re-run the hook tests and verify they pass**

Run the command from Step 2.

Expected: PASS; no source URL, storage key, or path appears in the wire request.

- [ ] **Step 5: Commit the optimistic submission slice**

```powershell
git add src/hooks/useGeneration.test.tsx src/hooks/useGeneration.ts
git commit -m "feat: preserve edit sources in optimistic turns"
```

### Task 6: Implement the Composer edit state and source relationship UI

**Files:**
- Create: `src/components/conversation/ConversationView.imageEdit.test.tsx`
- Modify: `src/components/conversation/ConversationView.tsx`
- Modify: `src/components/conversation/ConversationView.module.css`
- Modify: `src/components/composer/Composer.tsx`
- Modify: `src/components/composer/Composer.module.css`
- Modify: `src/components/conversation/ConversationView.keyModes.test.tsx`

- [ ] **Step 1: Write failing interaction tests for entry, inheritance, retention, retry, and chaining**

Build one focused route fixture containing succeeded, failed, and pending turns. Assert only the succeeded image has “编辑图片”; clicking it shows an empty edit textarea, source thumbnail/ID, inherited size/quality/background controls, current Key label, and no upload-source control or billing copy. Assert cancel restores the untouched ordinary Composer draft.

Use a deferred `apiPost` to prove typed edit text and changed parameters remain while the request rejects. Resolve a second submit with 202 and assert edit mode closes, the accepted child card has “基于此图编辑”, and the scroll target is invoked. Click the child card’s edit action to prove another layer can start. Click retry on an edit failure and assert the next request reuses its prompt, parameters, and `sourceImageId`.

- [ ] **Step 2: Run the focused conversation tests and verify they fail**

Run:

```powershell
npm run test:run -- src/components/conversation/ConversationView.imageEdit.test.tsx src/components/conversation/ConversationView.keyModes.test.tsx
```

Expected: FAIL because no edit action/state/source relationship exists.

- [ ] **Step 3: Add a separate edit draft and submit it through the current mode**

Use a state independent from the ordinary request/file:

```ts
type EditDraft = {
  sourceImageId: string;
  sourceImage: SourceImageSummary;
  request: GenerateParams;
};

const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
```

`startEditing(turn)` requires `turn.status === "succeeded" && turn.image`, creates an empty prompt with inherited size/quality/background, then focuses/scrolls the existing bottom Composer. The active Composer request/onChange pair selects `editDraft.request` or ordinary `request`. Cancel only clears `editDraft`; it never changes `request` or `inputImageFile`.

Submit edit options with `sourceImageId` and source summary while reading `userApiConfig.config` at that moment. On non-202 error leave `editDraft` unchanged. On 202 clear it and call `scrollIntoView` for the new `data-generation-id` element. `regenerate(turn)` must pass `turn.sourceImageId` even when `turn.sourceImage` is null, so unavailable sources fail clearly instead of becoming text-to-image.

- [ ] **Step 4: Render the edit-specific Composer without changing the right panel**

Add Composer props for `editSource`, `onCancelEdit`, and an edit submit label. In edit mode:

- show the immutable server source thumbnail, “正在编辑这张图”, and its full ID with ellipsis/title overflow handling;
- hide the temporary upload input/pill;
- retain all existing size, quality, and background controls;
- show only “系统 Key” or “自定义 Key” (plus custom-disabled state), never the per-image price/success-charge copy;
- expose icon buttons with `aria-label="取消编辑"` and `aria-label="生成编辑结果"`.

Outside edit mode preserve all existing Composer behavior. Do not touch `ThisConversationPanel`.

- [ ] **Step 5: Render source ancestry on every edit turn and expose the success-only action**

Before `renderResult(turn)`, render a compact source row whenever `sourceImageId` is present. If the summary exists, show its thumbnail and “基于此图编辑” and open the existing lightbox on click. If only the ID remains, show “基于的图片已不可用”. Add the “编辑图片” action only inside the succeeded branch when `turn.image` exists. Map `source_image_unavailable` to “这张图片已不可编辑”.

- [ ] **Step 6: Re-run the focused conversation tests and verify they pass**

Run the command from Step 2.

Expected: PASS for entry visibility, empty draft, inherited controls, error retention, accepted close/scroll, retry source reuse, and continued editing.

- [ ] **Step 7: Commit the frontend slice**

```powershell
git add src/components/conversation/ConversationView.imageEdit.test.tsx src/components/conversation/ConversationView.tsx src/components/conversation/ConversationView.module.css src/components/composer/Composer.tsx src/components/composer/Composer.module.css src/components/conversation/ConversationView.keyModes.test.tsx
git commit -m "feat: edit conversation images from the composer"
```

### Task 7: Close documentation, verify once, and publish the branch

**Files:**
- Modify: `docs/superpowers/specs/2026-07-14-conversation-image-edit-design.md`
- Modify: `docs/redesign-requirements.md`
- Modify: `docs/dev/02-database.md`
- Modify: `docs/dev/04-generation-pipeline.md`
- Modify: `docs/dev/07-api.md`
- Modify: `docs/dev/08-frontend.md`
- Modify: `docs/dev/10-ops-test.md`
- Modify: `docs/PROGRESS.md`
- Modify: `docs/superpowers/plans/2026-07-14-conversation-image-edit.md`

- [ ] **Step 1: Update only the related requirement, development, acceptance, and status records**

Mark the approved design and this plan implemented. Add one focused product section describing current-conversation success-card entry, text-only Composer edit mode, source ancestry, retry/chaining, and ordinary system/custom billing. Document migration `0007`, owner-scoped enqueue/worker revalidation, server storage reads, the existing relay edit path, and source-unavailable behavior. Record the exact focused commands and state explicitly that this task did not merge `main`, create a Release, deploy Tencent Cloud, or claim production evidence.

- [ ] **Step 2: Run one fresh final verification pass**

Use the disposable database only after its guard accepts `.env.test`. Run these commands once in this final gate:

```powershell
npm run db:test:migrate
npm run test:run -- src/contracts/generate.test.ts src/contracts/public-media-url.test.ts tests/unit/generate-handler.test.ts src/server/generation/failure.test.ts src/server/r2.server.local.test.ts src/server/generation/status.server.test.ts src/lib/generationBatch.test.ts src/hooks/useGeneration.test.tsx src/components/conversation/ConversationView.imageEdit.test.tsx src/components/conversation/ConversationView.keyModes.test.tsx
npm run test:money -- tests/money/enqueue.test.ts tests/money/enqueue-custom.test.ts tests/money/pipeline.test.ts tests/money/pipeline-custom.test.ts tests/money/timeout.test.ts tests/money/deadline.test.ts
npm run typecheck
npm run build
npm run assert-no-secrets
```

Expected: every command exits 0; Vitest reports zero failed tests; typecheck/build complete; the bundle scan reports no forbidden secret.

- [ ] **Step 3: Review the implementation against all 22 approved rules and inspect the diff**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Confirm no asset/inspiration/public-image entry, second endpoint/queue/service, editor canvas, new pricing, Release, deployment, `main` merge, or unrelated document change exists. Confirm `.superpowers/` remains untouched and untracked.

- [ ] **Step 4: Commit the verified implementation and documentation record**

```powershell
git add docs/superpowers/specs/2026-07-14-conversation-image-edit-design.md docs/redesign-requirements.md docs/dev/02-database.md docs/dev/04-generation-pipeline.md docs/dev/07-api.md docs/dev/08-frontend.md docs/dev/10-ops-test.md docs/PROGRESS.md docs/superpowers/plans/2026-07-14-conversation-image-edit.md
git commit -m "docs: record conversation image editing delivery"
```

- [ ] **Step 5: Push only the current feature branch and verify the remote tip**

```powershell
git push github codex/admin-system-updater
git rev-parse HEAD
git rev-parse github/codex/admin-system-updater
```

Expected: both SHAs are identical and the push reports `codex/admin-system-updater` updated. Do not push or merge `main`, create a tag/Release, or deploy a server.
