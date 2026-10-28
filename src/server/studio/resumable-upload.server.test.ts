// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createStudioUpload, writeStudioUploadChunk } from "./resumable-upload.server";
const transaction = vi.hoisted(() => vi.fn());
vi.mock("../tx.server", () => ({ tx: transaction }));
it("rejects invalid metadata before creating a database transaction", async () => {
  await expect(createStudioUpload("owner", "127.0.0.1", { uploadId: "bad-id", size: 5 * 1024 * 1024, mime: "image/png", sha256: "x" })).rejects.toMatchObject({ status: 400 });
  expect(transaction).not.toHaveBeenCalled();
});
it("rejects unbounded chunk bytes and invalid indexes before any database work", async () => {
  for (const index of [-1, 64, 1.5]) await expect(writeStudioUploadChunk("owner", "00000000-0000-4000-8000-000000000001", index, new Uint8Array([1]))).rejects.toMatchObject({ status: 400 });
  await expect(writeStudioUploadChunk("owner", "00000000-0000-4000-8000-000000000001", 0, new Uint8Array(65537))).rejects.toMatchObject({ status: 400 });
  expect(transaction).not.toHaveBeenCalled();
});
