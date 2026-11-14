# User API Handoff

This document is the implementation handoff for the next agent working on The
Secret Place, especially when adding or switching to the Android user app.

## Product boundary

The app lets people publish and read vent posts without showing authors to other
users. It is pseudonymous, not fully untraceable:

- Sign-in is handled by Clerk. The backend stores the Clerk user ID on the
  platform account so it can enforce account-level actions.
- The app database does not store account email addresses.
- Each platform account has a private alias. The owner can view it; active
  accounts can change it. The private admin console can also see it for
  moderation.
- Public feed and post responses intentionally contain no author alias, account
  ID, or Clerk ID.
- Vent text is sensitive and is visible to authorized moderators in the admin
  console. Do not promise that the platform itself cannot associate an account
  with its posts.

Keep these rules when building clients, adding endpoints, or changing the auth
provider. Never add author identity fields to a public response.

## Current user API

All paths below are under `/api`.

| Method and path | Access | Behavior |
| --- | --- | --- |
| `GET /me` | Signed-in | Creates an account if needed; returns the caller's private alias, status, and join date. |
| `PATCH /me` | Active signed-in account | Changes the caller's alias. Aliases are 3–30 letters, numbers, underscores, or hyphens. |
| `GET /feed?limit=20&cursor=...` | Public | Returns visible posts from active accounts, newest first. Each item contains only `id`, `content`, and `createdAt`; `nextCursor` is the last returned post ID when another page exists, otherwise `null`. |
| `GET /posts/:postId` | Public | Reads one visible post from an active account, without author identity. |
| `POST /posts` | Active signed-in account | Creates a post with 1–2,000 trimmed characters. The current guard allows up to 30 posts per account per hour. |
| `POST /posts/:postId/reports` | Active signed-in account | Reports a visible post. Reasons: `harassment`, `personal_information`, `self_harm_concern`, `spam`, `other`. Optional note is limited to 500 characters. An account can report a post once. |

The API contract is `lib/api-spec/openapi.yaml`. The Express implementation is
`artifacts/api-server/src/routes/user.ts`, mounted from
`artifacts/api-server/src/routes/index.ts`. The existing moderation API remains
in `artifacts/api-server/src/routes/admin.ts`.

## Data and moderation

Drizzle table definitions are in `lib/db/src/schema/secret-place.ts`:

- `secret_place_users` stores an internal ID, unique Clerk subject, private
  alias, status, and join date.
- `secret_place_posts` stores the author relationship and content. The public
  API selects only post ID, content, and creation date.
- `secret_place_reports` stores the post, reason, optional note, status, and
  optional reporter account. A unique index prevents duplicate reports from
  the same account; the reporter column is nullable for compatibility with
  older reports.
- `secret_place_audit_events` records moderation changes.

Moderators can hide or restore posts and suspend or reactivate accounts.
Suspended users cannot create posts or reports; hidden posts and posts from
suspended accounts are excluded from public reads. Do not expose moderation
data in user endpoints.

The development database tables have been initialized to match the current
schema. After schema edits, reconcile development with:

```sh
pnpm --filter @workspace/db run push
```

For Replit-managed production PostgreSQL, production schema changes are applied
through the Publish flow; do not add startup-time DDL or a custom production
migration hook.

## Client integration guidance

The planned Android client is a separate artifact. Use Clerk sign-in and send
the Clerk session as a bearer token for `/me`, post creation, and reporting.
The feed and post detail endpoints are public. Render post content as plain
text; do not interpret it as HTML.

Suggested implementation order:

1. Install the workspace dependencies with pnpm.
2. Regenerate shared API schemas/hooks from the OpenAPI contract:
   `pnpm --filter @workspace/api-spec run codegen`.
3. Run `pnpm run typecheck` and `pnpm run build`.
4. Build Android screens for sign-in, private alias setup, feed, post creation,
   and reporting; keep aliases and account identifiers out of public cards.
5. Add automated checks for unauthenticated writes, suspended accounts,
   duplicate reports, post visibility, and the public response privacy boundary.
6. Verify the client against the development API and database before publishing.

The generated API schemas/hooks were not refreshed during the backend handoff;
run code generation before depending on the generated client surface.

## Run and configuration

- API server: `pnpm --filter @workspace/api-server run dev`
- Admin console: `pnpm --filter @workspace/secret-place-admin run dev`
- Required API configuration: `DATABASE_URL`, managed Clerk keys, and `PORT`.
- Admin-only configuration: `ADMIN_EMAILS`, a comma-separated list of verified
  administrator emails. Admin access fails closed when this list is empty.

No user-facing Android app, comments, reactions, post editing/deletion, or
account deletion flow is implemented yet. Treat those as separate product
decisions rather than assuming they are part of the current API.

## Verification status

The backend TypeScript files passed a syntax check. A full typecheck, build, and
API code generation were not completed because workspace dependencies were not
installed in the environment at handoff. Run those checks after installing
dependencies before relying on the backend in a client.
