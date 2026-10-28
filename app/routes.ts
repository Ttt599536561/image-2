import { index, layout, type RouteConfig, route } from "@react-router/dev/routes";

// The public product uses only anonymous sessions and user-provided URL + Key.
// Retired account/billing handlers under legacy/ are never registered.
export default [
  index("routes/studio.tsx"),
  route("healthz", "routes/healthz.ts"),
  route("media/*", "routes/media.$.ts"),
  route("api/studio/session", "routes/api.studio.session.ts"),
  route("api/studio/generate", "routes/api.studio.generate.ts"),
  route("api/studio/status", "routes/api.studio.status.ts"),
  route("api/studio/events", "routes/api.studio.events.ts"),
  route("api/studio/uploads", "routes/api.studio.uploads.ts"),
  route("api/studio/uploads/resumable", "routes/api.studio.uploads.resumable.ts"),
  route("api/studio/uploads/resumable/:id/complete", "routes/api.studio.uploads.resumable.$id.complete.ts"),
  route("api/studio/uploads/resumable/:id/:index", "routes/api.studio.uploads.resumable.$id.$index.ts"),
  route("api/studio/images/:id", "routes/api.studio.images.$id.ts"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("api/admin/system-update", "routes/api.admin.system-update.ts"),
  route("api/admin/system-update/check", "routes/api.admin.system-update.check.ts"),
  layout("routes/_auth.tsx", [route("admin/login", "routes/_auth.admin-login.tsx")]),
  layout("routes/_admin.tsx", [
    route("admin", "routes/admin-index.ts"),
    route("admin/system-update", "routes/_admin.system-update.tsx"),
  ]),
  route("*", "routes/legacy-redirect.ts"),
] satisfies RouteConfig;
