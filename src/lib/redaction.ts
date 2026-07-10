const GENERIC_SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+\/-]{8,}/gi,
  /\bsk-[A-Za-z0-9._-]{8,}\b/g,
  /\b(api[_-]?key|token)\s*[:=]\s*[A-Za-z0-9._~+\/-]{8,}/gi,
];

export function redactText(value: string, secrets: string[] = []): string {
  let redacted = value;

  for (const secret of secrets) {
    if (secret) {
      redacted = redacted.split(secret).join('sk-***');
    }
  }

  for (const pattern of GENERIC_SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (match) => {
      if (/^Bearer\s/i.test(match)) return 'Bearer sk-***';
      if (/^(api[_-]?key|token)\s*[:=]/i.test(match)) {
        return `${match.split(/[:=]/, 1)[0]}=sk-***`;
      }
      return 'sk-***';
    });
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
