import { getAuth } from "@clerk/express";
import { and, count, desc, eq, gt, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Router, type IRouter, type RequestHandler } from "express";
import { db, postsTable, reportsTable, usersTable } from "@workspace/db";

const router: IRouter = Router();

type PlatformAccount = {
  id: number;
  alias: string;
  status: "active" | "suspended";
  joinedAt: Date;
};

const reportReasons = new Set([
  "harassment",
  "personal_information",
  "self_harm_concern",
  "spam",
  "other",
]);

function getAccount(res: Parameters<RequestHandler>[1]): PlatformAccount {
  return res.locals.platformAccount as PlatformAccount;
}

async function findOrCreateAccount(clerkUserId: string): Promise<PlatformAccount> {
  const findExisting = async (): Promise<PlatformAccount | undefined> => {
    const [account] = await db
      .select({
        id: usersTable.id,
        alias: usersTable.alias,
        status: usersTable.status,
        joinedAt: usersTable.joinedAt,
      })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .limit(1);
    return account;
  };

  const existing = await findExisting();
  if (existing) return existing;

  // A generated alias is private to the account and moderation tools. Public
  // feed responses never include it, the internal user ID, or the Clerk ID.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [created] = await db
      .insert(usersTable)
      .values({
        clerkUserId,
        alias: `quiet-${randomUUID().slice(0, 8)}`,
      })
      .onConflictDoNothing()
      .returning({
        id: usersTable.id,
        alias: usersTable.alias,
        status: usersTable.status,
        joinedAt: usersTable.joinedAt,
      });
    if (created) return created;

    // Another request may have created this account concurrently.
    const concurrentAccount = await findExisting();
    if (concurrentAccount) return concurrentAccount;
  }

  throw new Error("Could not create a pseudonymous account.");
}

const requireAccount: RequestHandler = async (req, res, next): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  res.locals.platformAccount = await findOrCreateAccount(userId);
  next();
};

const requireActiveAccount: RequestHandler = (_req, res, next): void => {
  if (getAccount(res).status !== "active") {
    res.status(403).json({ error: "This account cannot post or report content." });
    return;
  }
  next();
};

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

router.get("/me", requireAccount, (_req, res): void => {
  const account = getAccount(res);
  res.json({
    alias: account.alias,
    status: account.status,
    joinedAt: account.joinedAt,
  });
});

router.patch(
  "/me",
  requireAccount,
  requireActiveAccount,
  async (req, res): Promise<void> => {
    const body = req.body as { alias?: unknown } | null;
    const alias = typeof body?.alias === "string" ? body.alias.trim() : "";
    if (
      alias.length < 3 ||
      alias.length > 30 ||
      !/^[A-Za-z0-9_-]+$/.test(alias)
    ) {
      res.status(400).json({
        error: "Alias must be 3–30 characters using letters, numbers, _ or -.",
      });
      return;
    }

    const account = getAccount(res);
    try {
      const [updated] = await db
        .update(usersTable)
        .set({ alias })
        .where(eq(usersTable.id, account.id))
        .returning({
          alias: usersTable.alias,
          status: usersTable.status,
          joinedAt: usersTable.joinedAt,
        });
      if (!updated) {
        res.status(404).json({ error: "Account not found." });
        return;
      }
      res.json(updated);
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: "That alias is already in use." });
        return;
      }
      throw error;
    }
  },
);

router.get("/feed", async (req, res): Promise<void> => {
  let cursor: number | undefined;
  if (req.query.cursor !== undefined) {
    cursor = parsePositiveInteger(req.query.cursor);
    if (cursor === undefined) {
      res.status(400).json({ error: "cursor must be a positive integer." });
      return;
    }
  }

  const limit =
    req.query.limit === undefined ? 20 : parsePositiveInteger(req.query.limit);
  if (limit === undefined || limit > 50) {
    res.status(400).json({ error: "limit must be between 1 and 50." });
    return;
  }

  const filters = [
    eq(postsTable.visibility, "visible"),
    eq(usersTable.status, "active"),
  ];
  if (cursor !== undefined) filters.push(lt(postsTable.id, cursor));

  const rows = await db
    .select({
      id: postsTable.id,
      content: postsTable.content,
      createdAt: postsTable.createdAt,
    })
    .from(postsTable)
    .innerJoin(usersTable, eq(postsTable.userId, usersTable.id))
    .where(and(...filters))
    .orderBy(desc(postsTable.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  res.json({
    items,
    nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
  });
});

router.post(
  "/posts",
  requireAccount,
  requireActiveAccount,
  async (req, res): Promise<void> => {
    const body = req.body as { content?: unknown } | null;
    const content =
      typeof body?.content === "string" ? body.content.trim() : "";
    if (!content || content.length > 2000) {
      res.status(400).json({
        error: "Post content must contain 1–2000 characters.",
      });
      return;
    }

    const account = getAccount(res);
    const hourlyCutoff = new Date(Date.now() - 60 * 60 * 1000);
    const [recentPostCount] = await db
      .select({ value: count() })
      .from(postsTable)
      .where(
        and(
          eq(postsTable.userId, account.id),
          gt(postsTable.createdAt, hourlyCutoff),
        ),
      );
    if (recentPostCount.value >= 30) {
      res.status(429).json({
        error: "Posting limit reached. Please try again later.",
      });
      return;
    }

    const [post] = await db
      .insert(postsTable)
      .values({ userId: account.id, content })
      .returning({
        id: postsTable.id,
        content: postsTable.content,
        createdAt: postsTable.createdAt,
      });
    res.status(201).json(post);
  },
);

router.get("/posts/:postId", async (req, res): Promise<void> => {
  const postId = parsePositiveInteger(req.params.postId);
  if (postId === undefined) {
    res.status(400).json({ error: "postId must be a positive integer." });
    return;
  }

  const [post] = await db
    .select({
      id: postsTable.id,
      content: postsTable.content,
      createdAt: postsTable.createdAt,
    })
    .from(postsTable)
    .innerJoin(usersTable, eq(postsTable.userId, usersTable.id))
    .where(
      and(
        eq(postsTable.id, postId),
        eq(postsTable.visibility, "visible"),
        eq(usersTable.status, "active"),
      ),
    )
    .limit(1);
  if (!post) {
    res.status(404).json({ error: "Post not found." });
    return;
  }
  res.json(post);
});

router.post(
  "/posts/:postId/reports",
  requireAccount,
  requireActiveAccount,
  async (req, res): Promise<void> => {
    const postId = parsePositiveInteger(req.params.postId);
    if (postId === undefined) {
      res.status(400).json({ error: "postId must be a positive integer." });
      return;
    }

    const body = req.body as { reason?: unknown; note?: unknown } | null;
    if (typeof body?.reason !== "string" || !reportReasons.has(body.reason)) {
      res.status(400).json({ error: "Choose a valid report reason." });
      return;
    }
    const note =
      typeof body.note === "string" ? body.note.trim() : body.note ?? null;
    if (note !== null && (typeof note !== "string" || note.length > 500)) {
      res.status(400).json({ error: "Report notes may be at most 500 characters." });
      return;
    }

    const [post] = await db
      .select({ id: postsTable.id })
      .from(postsTable)
      .innerJoin(usersTable, eq(postsTable.userId, usersTable.id))
      .where(
        and(
          eq(postsTable.id, postId),
          eq(postsTable.visibility, "visible"),
          eq(usersTable.status, "active"),
        ),
      )
      .limit(1);
    if (!post) {
      res.status(404).json({ error: "Post not found." });
      return;
    }

    const account = getAccount(res);
    const [existingReport] = await db
      .select({ id: reportsTable.id })
      .from(reportsTable)
      .where(
        and(
          eq(reportsTable.postId, postId),
          eq(reportsTable.reporterUserId, account.id),
        ),
      )
      .limit(1);
    if (existingReport) {
      res.status(409).json({ error: "You have already reported this post." });
      return;
    }

    try {
      await db.insert(reportsTable).values({
        postId,
        reporterUserId: account.id,
        reason: body.reason as
          | "harassment"
          | "personal_information"
          | "self_harm_concern"
          | "spam"
          | "other",
        note,
      });
    } catch (error) {
      // The unique index also protects against simultaneous duplicate reports.
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: "You have already reported this post." });
        return;
      }
      throw error;
    }

    res.status(201).json({ received: true });
  },
);

export default router;
