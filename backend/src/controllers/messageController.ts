import { In } from "typeorm";
import type { NextFunction, Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { Message } from "../entities/Message";
import { ChatThreadRead } from "../entities/ChatThreadRead";
import { Bid } from "../entities/Bid";
import { User, UserRole } from "../entities/User";
import { NotificationType } from "../entities/Notification";
import { UploadKind } from "../entities/Upload";
import { createNotification } from "../utils/notifications";
import { openStream, publishMessage } from "../utils/sse";
import { toMessage } from "../serializers";
import { isAdmin, isOwner, loadJobContext, threadAccess, type JobContext } from "../policies/jobPolicy";
import { viewer } from "./jobController";
import { filesOf } from "../middleware/upload";
import { discardFiles, fileRef, storeUploads } from "../services/files";
import { badRequest, forbidden } from "../http/errors";

/** Which pro's thread the request refers to. Pros always use their own. */
function threadProId(req: Request, ctx: JobContext): string {
  const v = req.user!;
  if (v.role === UserRole.TRADESPERSON) return v.id;
  const requested = req.valid.query.pro as string | undefined;
  if (requested) return requested;
  if (ctx.acceptedProId) return ctx.acceptedProId;
  throw badRequest("Choose which professional's conversation to open (?pro=<id>)", "THREAD_REQUIRED");
}

async function resolveThread(req: Request, need: "read" | "write") {
  const ctx = await loadJobContext(req.valid.params.jobId);
  const proId = threadProId(req, ctx);
  const access = await threadAccess(ctx, viewer(req), proId);
  if (access === "none" || (need === "write" && access !== "write")) {
    throw forbidden(need === "write" ? "You can't send messages in this conversation" : "You don't have access to this conversation");
  }
  return { ctx, proId, access };
}

async function markRead(jobId: string, proId: string, userId: string) {
  await AppDataSource.createQueryBuilder()
    .insert()
    .into(ChatThreadRead)
    .values({ jobId, threadTradespersonId: proId, userId, lastReadAt: new Date() })
    .orUpdate(["lastReadAt"], ["jobId", "threadTradespersonId", "userId"])
    .execute();
}

/** Client: one entry per pro who bid (or was hired). Pro: just their own thread. */
export async function listThreads(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.jobId);
  const v = viewer(req);
  let proIds: string[];
  if (v.role === UserRole.TRADESPERSON) {
    if ((await threadAccess(ctx, v, v.id)) === "none") throw forbidden("You don't have access to this conversation");
    proIds = [v.id];
  } else if (isOwner(ctx, v) || isAdmin(v)) {
    const bids = await AppDataSource.getRepository(Bid).find({ where: { jobId: ctx.job.id }, select: { tradespersonId: true } });
    proIds = [...new Set(bids.map((b) => b.tradespersonId))];
  } else {
    throw forbidden("You don't have access to this job's messages");
  }
  if (!proIds.length) return res.json({ threads: [] });
  const stats: { pro: string; last_at: Date | null; last_body: string | null; unread: string; total: string }[] =
    await AppDataSource.query(
      `SELECT p.pro,
              (SELECT m."createdAt" FROM "messages" m WHERE m."jobId" = $1 AND m."threadTradespersonId" = p.pro ORDER BY m."createdAt" DESC LIMIT 1) AS last_at,
              (SELECT m."body" FROM "messages" m WHERE m."jobId" = $1 AND m."threadTradespersonId" = p.pro ORDER BY m."createdAt" DESC LIMIT 1) AS last_body,
              (SELECT COUNT(*) FROM "messages" m
                 LEFT JOIN "chat_thread_reads" r ON r."jobId" = m."jobId" AND r."threadTradespersonId" = m."threadTradespersonId" AND r."userId" = $2
                WHERE m."jobId" = $1 AND m."threadTradespersonId" = p.pro AND m."senderId" <> $2
                  AND (r."lastReadAt" IS NULL OR m."createdAt" > r."lastReadAt")) AS unread,
              (SELECT COUNT(*) FROM "messages" m WHERE m."jobId" = $1 AND m."threadTradespersonId" = p.pro) AS total
         FROM unnest($3::uuid[]) AS p(pro)`,
    [ctx.job.id, v.id, proIds]
  );
  const users = await AppDataSource.getRepository(User).find({ where: { id: In(proIds) } });
  const names = new Map(users.map((u) => [u.id, u.name ?? null]));
  const threads = await Promise.all(
    stats.map(async (s) => ({
      tradespersonId: s.pro,
      name: names.get(s.pro) ?? null,
      hired: ctx.acceptedProId === s.pro,
      access: await threadAccess(ctx, v, s.pro),
      lastMessageAt: s.last_at,
      lastMessagePreview: s.last_body ? s.last_body.slice(0, 120) : null,
      unread: isAdmin(v) ? 0 : Number(s.unread),
      total: Number(s.total),
    }))
  );
  threads.sort((a, b) => Number(b.hired) - Number(a.hired) || (b.lastMessageAt ? +new Date(b.lastMessageAt) : 0) - (a.lastMessageAt ? +new Date(a.lastMessageAt) : 0));
  return res.json({ threads });
}

export async function listMessages(req: Request, res: Response) {
  const { ctx, proId, access } = await resolveThread(req, "read");
  const limit = req.valid.query.limit ?? 50;
  const qb = AppDataSource.getRepository(Message)
    .createQueryBuilder("m")
    .leftJoinAndSelect("m.sender", "sender")
    .where("m.jobId = :jobId AND m.threadTradespersonId = :proId", { jobId: ctx.job.id, proId })
    .orderBy("m.createdAt", "DESC")
    .addOrderBy("m.id", "DESC")
    .take(limit + 1);
  if (req.valid.query.before) qb.andWhere("m.createdAt < :before", { before: req.valid.query.before });
  const rows = await qb.getMany();
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  return res.json({
    messages: page.map((m) => toMessage(m, m.sender)),
    threadTradespersonId: proId,
    canSend: access === "write",
    hasMore,
    nextBefore: hasMore ? page[0]?.createdAt : null,
  });
}

/** Runs before multer. */
export async function authorizeSend(req: Request, _res: Response, next: NextFunction) {
  await resolveThread(req, "write");
  next();
}

export async function sendMessage(req: Request, res: Response) {
  const { ctx, proId } = await resolveThread(req, "write");
  const b = req.valid.body;
  const attachments = filesOf(req, "attachments");
  const quoteFile = filesOf(req, "quoteAttachment")[0];
  const hasQuote = b.quoteAmount !== undefined;
  if (quoteFile && !hasQuote) throw badRequest("A quote attachment needs a quote amount", "VALIDATION");
  if (!b.body && !attachments.length && !hasQuote) {
    throw badRequest("Write a message, attach a file or add a quote", "EMPTY_MESSAGE");
  }
  let stored: string[] = [];
  const msg = await AppDataSource.transaction(async (m) => {
    const ctxFiles = { kind: UploadKind.CHAT, ownerUserId: req.user!.id, jobId: ctx.job.id, threadTradespersonId: proId, allowPdf: true };
    const att = (await storeUploads(attachments, ctxFiles, m)).map((u) => fileRef(u.name));
    stored = [...att];
    const q = quoteFile ? (await storeUploads([quoteFile], ctxFiles, m)).map((u) => fileRef(u.name))[0] : undefined;
    if (q) stored.push(q);
    return m.save(
      m.create(Message, {
        jobId: ctx.job.id,
        threadTradespersonId: proId,
        senderId: req.user!.id,
        body: b.body || (hasQuote ? `Quote: ₹${Number(b.quoteAmount).toFixed(0)}` : "(attachment)"),
        attachmentUrls: att,
        quote: hasQuote ? { amount: b.quoteAmount, notes: b.quoteNotes || undefined, attachmentUrl: q } : null,
      })
    );
  }).catch(async (err) => {
    await discardFiles(stored);
    throw err;
  });
  await markRead(ctx.job.id, proId, req.user!.id);

  const sender = await AppDataSource.getRepository(User).findOneOrFail({ where: { id: req.user!.id } });
  const recipient = req.user!.id === proId ? ctx.job.homeownerId : proId;
  await createNotification({
    userId: recipient,
    type: NotificationType.MESSAGE,
    title: hasQuote ? "New quote in chat" : attachments.length ? "New message with attachment" : "New message",
    body: hasQuote
      ? `${sender.name || "Someone"} shared a ₹${Number(b.quoteAmount).toFixed(0)} quote on "${ctx.job.title}"`
      : `${sender.name || "Someone"} sent a message on "${ctx.job.title}"`,
    link:
      recipient === ctx.job.homeownerId
        ? `/client/jobs/${ctx.job.id}?chat=${proId}`
        : `/professional/jobs/${ctx.job.id}`,
    meta: { jobId: ctx.job.id, messageId: msg.id, threadTradespersonId: proId, hasQuote },
  });
  const shaped = toMessage(msg, sender);
  await publishMessage(ctx.job.id, proId, { message: shaped });
  return res.status(201).json({ message: shaped });
}

export async function markThreadRead(req: Request, res: Response) {
  const { ctx, proId } = await resolveThread(req, "read");
  if (!isAdmin(viewer(req))) await markRead(ctx.job.id, proId, req.user!.id);
  return res.json({ ok: true });
}

export async function streamMessages(req: Request, res: Response) {
  const { ctx, proId } = await resolveThread(req, "read");
  openStream(res, req.user!.id, { jobId: ctx.job.id, tradespersonId: proId });
}
