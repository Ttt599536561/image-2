const GENERIC_SECRET_PATTERNS = [
  /Bearer\s+sk-[A-Za-z0-9._-]+/g,
  /sk-[A-Za-z0-9._-]{8,}/g,
];

export function redactText(value: string, secrets: string[] = []): string {
  let redacted = value;

  for (const secret of secrets) {
    if (secret) {
      redacted = redacted.split(secret).join('sk-***');
    }
  }

  for (const pattern of GENERIC_SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (match) =>
      match.startsWith('Bearer ') ? 'Bearer sk-***' : 'sk-***',
    );
  }

  return redacted;
}

export function redactSecrets<T>(value: T, secrets: string[] = []): T {
  if (typeof value === 'string') {
    return redactText(value, secrets) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, secrets)) as T;
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactSecrets(item, secrets)]),
    ) as T;
  }

  return value;
}
