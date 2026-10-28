# Retired account product routes

These handlers and their focused regression tests are preserved for rollback/reference from the former account-and-credit product. They are **not registered** in `app/routes.ts`, not included in the application bundle, and not publicly reachable. Active product routes are the anonymous studio and protected system maintenance only.

Do not restore a legacy route without an explicit product requirement and a fresh authorization review. Old database tables are retained without destructive migration; runtime scheduler and authentication hooks no longer award or maintain credits.
