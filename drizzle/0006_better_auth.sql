CREATE TABLE IF NOT EXISTS "user" (
  "id" uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL,
  "image" text,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "role" text,
  "banned" boolean,
  "banReason" text,
  "banExpires" timestamptz
);

CREATE TABLE IF NOT EXISTS "session" (
  "id" uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  "token" text NOT NULL UNIQUE,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" uuid NOT NULL REFERENCES "user" ("id") ON DELETE cascade,
  "impersonatedBy" text
);

CREATE TABLE IF NOT EXISTS "account" (
  "id" uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" uuid NOT NULL REFERENCES "user" ("id") ON DELETE cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS "verification" (
  "id" uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("userId");
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("userId");
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");
