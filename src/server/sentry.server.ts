import { redactSecrets } from "../lib/redaction";

type SentryLevel = "fatal" | "error" | "warning" | "info";

interface SentryLike {
  captureException(error: unknown, hint?: unknown): unknown;
  captureMessage(message: string, context?: unknown): unknown;
}

let initPromise: Promise<SentryLike | null> | null = null;
let testClient: SentryLike | undefined;

function observationSecrets(extra: string[] = []): string[] {
  return [process.env.RELAY_API_KEY ?? "", process.env.SENTRY_DSN ?? "", ...extra].filter(Boolean);
}

function safeObservedError(error: unknown, secrets: string[]): Error {
  let name = "Error";
  let message = "internal error";

  try {
    if (typeof error === "string") {
      message = error;
    } else if (typeof error === "object" && error !== null) {
      const value = error as { name?: unknown; message?: unknown };
      if (typeof value.name === "string") name = value.name;
      if (typeof value.message === "string") message = value.message;
    }
  } catch {
    // Malformed error-like objects must not break the observation path.
  }

  const safe = new Error(redactSecrets(message, secrets));
  safe.name = redactSecrets(name, secrets);
  return safe;
}

function safeObservedContext(
  context: Record<string, unknown> | undefined,
  secrets: string[],
): Record<string, unknown> | undefined {
  if (!context) return undefined;
  try {
    return redactSecrets(context, secrets);
  } catch {
    return { observationContext: "unavailable" };
  }
}

function serializedContext(context: Record<string, unknown> | undefined): string {
  if (!context) return "";
  try {
    return JSON.stringify(context);
  } catch {
    return JSON.stringify({ observationContext: "unavailable" });
  }
}

export function installSentryTestClient(client: SentryLike): () => void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Sentry test client injection is only available in tests");
  }

  const previousClient = testClient;
  const previousInitPromise = initPromise;
  testClient = client;
  initPromise = null;

  return () => {
    testClient = previousClient;
    initPromise = previousInitPromise;
  };
}

async function getSentry(): Promise<SentryLike | null> {
  if (testClient) return testClient;
  if (!process.env.SENTRY_DSN) return null;

  if (!initPromise) {
    initPromise = (async (): Promise<SentryLike | null> => {
      try {
        const moduleName = "@sentry/node";
        const Sentry = (await import(/* @vite-ignore */ moduleName)) as {
          init(options: Record<string, unknown>): void;
        } & SentryLike;
        Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0 });
        return Sentry;
      } catch (error) {
        console.error(
          "[sentry] initialization failed; continuing without Sentry",
          safeObservedError(error, observationSecrets()),
        );
        return null;
      }
    })();
  }

  return initPromise;
}

export async function captureException(
  error: unknown,
  context?: Record<string, unknown>,
  extraSecrets: string[] = [],
): Promise<void> {
  const secrets = observationSecrets(extraSecrets);
  const safeError = safeObservedError(error, secrets);
  const safeContext = safeObservedContext(context, secrets);
  console.error("[sentry:exception]", safeError, serializedContext(safeContext));

  const sentry = await getSentry();
  try {
    sentry?.captureException(safeError, safeContext ? { extra: safeContext } : undefined);
  } catch (captureError) {
    console.error(
      "[sentry] captureException failed",
      safeObservedError(captureError, secrets),
    );
  }
}

export async function captureMessage(
  message: string,
  level: SentryLevel = "warning",
  context?: Record<string, unknown>,
  extraSecrets: string[] = [],
): Promise<void> {
  const secrets = observationSecrets(extraSecrets);
  const safeMessage = redactSecrets(message, secrets);
  const safeContext = safeObservedContext(context, secrets);
  console.warn(`[sentry:${level}] ${safeMessage}`, serializedContext(safeContext));

  const sentry = await getSentry();
  try {
    sentry?.captureMessage(safeMessage, { level, extra: safeContext });
  } catch (captureError) {
    console.error(
      "[sentry] captureMessage failed",
      safeObservedError(captureError, secrets),
    );
  }
}
