import { alert } from "../../src/server/alert.server";
import { deleteExpiredGenerationCredentials } from "../../src/server/generation/credential.server";
import { expireDueGenerations } from "../../src/server/generation/deadline.server";
import { captureException } from "../../src/server/sentry.server";

export default async function handler(): Promise<Response> {
  try {
    const expiredJobs = await expireDueGenerations();
    const deletedCredentials = await deleteExpiredGenerationCredentials();
    return Response.json({ ok: true, expiredJobs: expiredJobs.length, deletedCredentials });
  } catch (error) {
    await captureException(error, { cron: "clean-generation-credentials" });
    await alert("cron_failed", { cron: "clean-generation-credentials" });
    return new Response("cron error", { status: 500 });
  }
}
