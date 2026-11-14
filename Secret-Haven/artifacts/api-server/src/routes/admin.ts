import { clerkClient, getAuth } from "@clerk/express";
import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  GetAdminAuditQueryParams,
  GetAdminAuditResponse,
  GetAdminAccessResponse,
  GetAdminOverviewResponse,
  GetAdminPostsQueryParams,
  GetAdminPostsResponse,
  GetAdminReportsQueryParams,
  GetAdminReportsResponse,
  GetAdminUsersQueryParams,
  GetAdminUsersResponse,
  UpdateAdminPostBody,
  UpdateAdminPostParams,
  UpdateAdminPostResponse,
  UpdateAdminReportBody,
  UpdateAdminReportParams,
  UpdateAdminReportResponse,
  UpdateAdminUserBody,
  UpdateAdminUserParams,
  UpdateAdminUserResponse,
} from "@workspace/api-zod";
import {
  auditEventsTable,
  db,
  postsTable,
  reportsTable,
  usersTable,
} from "@workspace/db";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware";

const router: IRouter = Router();

const requireAdmin: RequestHandler = async (req, res, next): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  const allowedEmails = new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  if (allowedEmails.size === 0) {
    res.status(503).json({ error: "Administrator access is not configured." });
    return;
  }

  const clerkUser = await clerkClient.users.getUser(userId);
  const hasAdminEmail = clerkUser.emailAddresses.some(
    (address) =>
      address.verification?.status === "verified" &&
      allowedEmails.has(address.emailAddress.toLowerCase()),
  );
  if (!hasAdminEmail) {
    res.status(403).json({ error: "Administrator access is required." });
    return;
  }

  res.locals.adminUserId = userId;
  next();
};

router.use(requireAdmin);
router.use((req, res, next): void => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }

  // Mobile clients use bearer tokens. Browser session-cookie writes must be
  // same-origin so a third-party site cannot trigger admin actions.
  if (req.get("authorization")?.startsWith("Bearer ")) {
    next();
    return;
  }
  const origin = req.get("origin");
  const requestHost = getClerkProxyHost(req)?.toLowerCase();
  if (origin && requestHost) {
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      res.status(403).json({ error: "Cross-origin requests are not allowed." });
      return;
    }
    if (originHost !== requestHost) {
      res.status(403).json({ error: "Cross-origin requests are not allowed." });
      return;
    }
  }
  next();
});

router.get("/access", (_req, res): void => {
  res.json(GetAdminAccessResponse.parse({ authorized: true }));
});

router.get("/overview", async (_req, res): Promise<void> => {
  const recentCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [
    totalUsers,
    activeUsers,
    suspendedUsers,
    totalPosts,
    visiblePosts,
    hiddenPosts,
    openReports,
    recentReports,
    recentPosts,
  ] = await Promise.all([
    db.select({ value: count() }).from(usersTable),
    db
      .select({ value: count() })
      .from(usersTable)
      .where(eq(usersTable.status, "active")),
    db
      .select({ value: count() })
      .from(usersTable)
      .where(eq(usersTable.status, "suspended")),
    db.select({ value: count() }).from(postsTable),
    db
      .select({ value: count() })
      .from(postsTable)
      .where(eq(postsTable.visibility, "visible")),
    db
      .select({ value: count() })
      .from(postsTable)
      .where(eq(postsTable.visibility, "hidden")),
    db
      .select({ value: count() })
      .from(reportsTable)
      .where(eq(reportsTable.status, "open")),
    db
      .select({ value: count() })
      .from(reportsTable)
      .where(sql`${reportsTable.createdAt} >= ${recentCutoff}`),
    db
      .select({ value: count() })
      .from(postsTable)
      .where(sql`${postsTable.createdAt} >= ${recentCutoff}`),
  ]);
  const data = GetAdminOverviewResponse.parse({
    totalUsers: totalUsers[0].value,
    activeUsers: activeUsers[0].value,
    suspendedUsers: suspendedUsers[0].value,
    totalPosts: totalPosts[0].value,
    visiblePosts: visiblePosts[0].value,
    hiddenPosts: hiddenPosts[0].value,
    openReports: openReports[0].value,
    reportsLast24Hours: recentReports[0].value,
    postsLast24Hours: recentPosts[0].value,
  });
  res.json(data);
});

router.get("/users", async (req, res): Promise<void> => {
  const parsed = GetAdminUsersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const filters = [];
  if (parsed.data.status) {
    filters.push(eq(usersTable.status, parsed.data.status));
  }
  if (parsed.data.search) {
    filters.push(ilike(usersTable.alias, `%${parsed.data.search}%`));
  }
  const filter = and(...filters);
  const [items, total] = await Promise.all([
    db
      .select({
        id: usersTable.id,
        alias: usersTable.alias,
        status: usersTable.status,
        joinedAt: usersTable.joinedAt,
        postsCount: sql<number>`(select count(*)::int from ${postsTable} where ${postsTable.userId} = ${usersTable.id})`,
        reportsCount: sql<number>`(select count(*)::int from ${reportsTable} inner join ${postsTable} on ${postsTable.id} = ${reportsTable.postId} where ${postsTable.userId} = ${usersTable.id})`,
      })
      .from(usersTable)
      .where(filter)
      .orderBy(desc(usersTable.joinedAt))
      .limit(parsed.data.limit),
    db.select({ value: count() }).from(usersTable).where(filter),
  ]);
  res.json(GetAdminUsersResponse.parse({ items, total: total[0].value }));
});

router.patch("/:userId", async (req, res): Promise<void> => {
  const params = UpdateAdminUserParams.safeParse(req.params);
  const body = UpdateAdminUserBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [user] = await tx
      .update(usersTable)
      .set({ status: body.data.status })
      .where(eq(usersTable.id, params.data.userId))
      .returning({
        id: usersTable.id,
        alias: usersTable.alias,
        status: usersTable.status,
        joinedAt: usersTable.joinedAt,
      });
    if (!user) return undefined;
    await tx.insert(auditEventsTable).values({
      actorId: String(res.locals.adminUserId),
      action:
        body.data.status === "suspended" ? "user_suspended" : "user_reactivated",
      targetType: "user",
      targetId: user.id,
    });
    const [counts] = await tx
      .select({
        postsCount: sql<number>`(select count(*)::int from ${postsTable} where ${postsTable.userId} = ${usersTable.id})`,
        reportsCount: sql<number>`(select count(*)::int from ${reportsTable} inner join ${postsTable} on ${postsTable.id} = ${reportsTable.postId} where ${postsTable.userId} = ${usersTable.id})`,
      })
      .from(usersTable)
      .where(eq(usersTable.id, user.id));
    return { ...user, ...counts };
  });
  if (!result) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  res.json(UpdateAdminUserResponse.parse(result));
});

router.get("/posts", async (req, res): Promise<void> => {
  const parsed = GetAdminPostsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const filters = [];
  if (parsed.data.visibility) {
    filters.push(eq(postsTable.visibility, parsed.data.visibility));
  }
  const searchTerm = parsed.data.search?.trim();
  if (searchTerm) {
    const searchFilter = or(
      ilike(postsTable.content, `%${searchTerm}%`),
      ilike(usersTable.alias, `%${searchTerm}%`),
      /^\d+$/.test(searchTerm)
        ? eq(postsTable.id, Number(searchTerm))
        : undefined,
    );
    if (searchFilter) filters.push(searchFilter);
  }
  const filter = and(...filters);
  const [items, total] = await Promise.all([
    db
      .select({
        id: postsTable.id,
        userId: postsTable.userId,
        authorAlias: usersTable.alias,
        content: postsTable.content,
        visibility: postsTable.visibility,
        createdAt: postsTable.createdAt,
        reportsCount: sql<number>`(select count(*)::int from ${reportsTable} where ${reportsTable.postId} = ${postsTable.id})`,
      })
      .from(postsTable)
      .innerJoin(usersTable, eq(postsTable.userId, usersTable.id))
      .where(filter)
      .orderBy(desc(postsTable.createdAt))
      .limit(parsed.data.limit),
    db
      .select({ value: count() })
      .from(postsTable)
      .innerJoin(usersTable, eq(postsTable.userId, usersTable.id))
      .where(filter),
  ]);
  res.json(GetAdminPostsResponse.parse({ items, total: total[0].value }));
});

router.patch("/posts/:postId", async (req, res): Promise<void> => {
  const params = UpdateAdminPostParams.safeParse(req.params);
  const body = UpdateAdminPostBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [post] = await tx
      .update(postsTable)
      .set({ visibility: body.data.visibility })
      .where(eq(postsTable.id, params.data.postId))
      .returning();
    if (!post) return undefined;
    await tx.insert(auditEventsTable).values({
      actorId: String(res.locals.adminUserId),
      action:
        body.data.visibility === "hidden" ? "post_hidden" : "post_restored",
      targetType: "post",
      targetId: post.id,
    });
    const [joinedPost] = await tx
      .select({
        id: postsTable.id,
        userId: postsTable.userId,
        authorAlias: usersTable.alias,
        content: postsTable.content,
        visibility: postsTable.visibility,
        createdAt: postsTable.createdAt,
        reportsCount: sql<number>`(select count(*)::int from ${reportsTable} where ${reportsTable.postId} = ${postsTable.id})`,
      })
      .from(postsTable)
      .innerJoin(usersTable, eq(postsTable.userId, usersTable.id))
      .where(eq(postsTable.id, post.id));
    return joinedPost;
  });
  if (!result) {
    res.status(404).json({ error: "Post not found." });
    return;
  }
  res.json(UpdateAdminPostResponse.parse(result));
});

router.get("/reports", async (req, res): Promise<void> => {
  const parsed = GetAdminReportsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const filter = parsed.data.status
    ? eq(reportsTable.status, parsed.data.status)
    : undefined;
  const [items, total] = await Promise.all([
    db
      .select({
        id: reportsTable.id,
        reason: reportsTable.reason,
        note: reportsTable.note,
        status: reportsTable.status,
        createdAt: reportsTable.createdAt,
        post: {
          id: postsTable.id,
          authorAlias: usersTable.alias,
          content: postsTable.content,
          visibility: postsTable.visibility,
        },
      })
      .from(reportsTable)
      .innerJoin(postsTable, eq(reportsTable.postId, postsTable.id))
      .innerJoin(usersTable, eq(postsTable.userId, usersTable.id))
      .where(filter)
      .orderBy(desc(reportsTable.createdAt))
      .limit(parsed.data.limit),
    db.select({ value: count() }).from(reportsTable).where(filter),
  ]);
  res.json(GetAdminReportsResponse.parse({ items, total: total[0].value }));
});

router.patch("/reports/:reportId", async (req, res): Promise<void> => {
  const params = UpdateAdminReportParams.safeParse(req.params);
  const body = UpdateAdminReportBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [report] = await tx
      .update(reportsTable)
      .set({ status: body.data.status })
      .where(eq(reportsTable.id, params.data.reportId))
      .returning();
    if (!report) return undefined;
    await tx.insert(auditEventsTable).values({
      actorId: String(res.locals.adminUserId),
      action:
        body.data.status === "resolved" ? "report_resolved" : "report_reopened",
      targetType: "report",
      targetId: report.id,
    });
    const [joinedReport] = await tx
      .select({
        id: reportsTable.id,
        reason: reportsTable.reason,
        note: reportsTable.note,
        status: reportsTable.status,
        createdAt: reportsTable.createdAt,
        post: {
          id: postsTable.id,
          authorAlias: usersTable.alias,
          content: postsTable.content,
          visibility: postsTable.visibility,
        },
      })
      .from(reportsTable)
      .innerJoin(postsTable, eq(reportsTable.postId, postsTable.id))
      .innerJoin(usersTable, eq(postsTable.userId, usersTable.id))
      .where(eq(reportsTable.id, report.id));
    return joinedReport;
  });
  if (!result) {
    res.status(404).json({ error: "Report not found." });
    return;
  }
  res.json(UpdateAdminReportResponse.parse(result));
});

router.get("/audit", async (req, res): Promise<void> => {
  const parsed = GetAdminAuditQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const items = await db
    .select({
      id: auditEventsTable.id,
      action: auditEventsTable.action,
      targetType: auditEventsTable.targetType,
      targetId: auditEventsTable.targetId,
      createdAt: auditEventsTable.createdAt,
    })
    .from(auditEventsTable)
    .orderBy(desc(auditEventsTable.createdAt))
    .limit(parsed.data.limit);
  res.json(GetAdminAuditResponse.parse({ items }));
});

export default router;
