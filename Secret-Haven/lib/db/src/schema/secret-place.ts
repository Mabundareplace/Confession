import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const usersTable = pgTable("secret_place_users", {
  id: serial("id").primaryKey(),
  // Clerk is the authentication provider; the internal account stays separate
  // from public posts and is never returned by the public API.
  clerkUserId: text("clerk_user_id").unique(),
  alias: varchar("alias", { length: 80 }).notNull().unique(),
  status: varchar("status", { length: 16 })
    .$type<"active" | "suspended">()
    .notNull()
    .default("active"),
  joinedAt: timestamp("joined_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const postsTable = pgTable("secret_place_posts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id),
  content: text("content").notNull(),
  visibility: varchar("visibility", { length: 16 })
    .$type<"visible" | "hidden">()
    .notNull()
    .default("visible"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const reportsTable = pgTable("secret_place_reports", {
  id: serial("id").primaryKey(),
  postId: integer("post_id")
    .notNull()
    .references(() => postsTable.id),
  reporterUserId: integer("reporter_user_id").references(() => usersTable.id),
  reason: varchar("reason", { length: 32 })
    .$type<
      | "harassment"
      | "personal_information"
      | "self_harm_concern"
      | "spam"
      | "other"
    >()
    .notNull(),
  note: text("note"),
  status: varchar("status", { length: 16 })
    .$type<"open" | "resolved">()
    .notNull()
    .default("open"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  uniqueIndex("secret_place_reports_post_reporter_unique").on(
    table.postId,
    table.reporterUserId,
  ),
]);

export const auditEventsTable = pgTable("secret_place_audit_events", {
  id: serial("id").primaryKey(),
  actorId: text("actor_id").notNull(),
  action: varchar("action", { length: 32 })
    .$type<
      | "user_suspended"
      | "user_reactivated"
      | "post_hidden"
      | "post_restored"
      | "report_resolved"
      | "report_reopened"
    >()
    .notNull(),
  targetType: varchar("target_type", { length: 16 })
    .$type<"user" | "post" | "report">()
    .notNull(),
  targetId: integer("target_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
