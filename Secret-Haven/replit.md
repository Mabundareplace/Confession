# The Secret Place

A pseudonymous venting platform with a public user API and a private admin console. The Android user app is planned as a separate next step.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/secret-place-admin run dev` — run the admin console
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, managed Clerk keys, and `ADMIN_EMAILS` (comma-separated verified administrator emails)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/secret-place-admin` — administrator web console
- `artifacts/api-server/src/routes/admin.ts` — private administration API
- `artifacts/api-server/src/routes/user.ts` — authenticated profile/post/report API and public anonymous feed
- `lib/api-spec/openapi.yaml` — API source of truth
- `lib/db/src/schema/secret-place.ts` — user, vent post, report, and audit tables

## Architecture decisions

- Admin API access requires a verified Clerk email in `ADMIN_EMAILS`; it fails closed if the list is unset.
- User accounts are keyed by Clerk user ID; the app database does not store account email addresses.
- Public post responses omit aliases, internal user IDs, and Clerk IDs. Aliases are private to their owner and authorized administrators.
- Moderation hides posts and suspends accounts reversibly; actions are recorded in the admin audit log.
- Development preview records are clearly marked as demo content.

## Product

The admin console provides a platform overview, user and post management, safety-report review, and a moderation audit log. Vent text is sensitive and visible to authorized administrators, so the console explains that access clearly.

## User preferences

- Build the admin dashboard before the Android user app.

## Gotchas

- Keep the home route public and do not expose admin data without Clerk authentication and the administrator email allowlist.

## Pointers

- See `USER_API_HANDOFF.md` for API routes, the anonymity boundary, database notes, and Android handoff steps.
- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
