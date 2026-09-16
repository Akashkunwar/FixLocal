import { Request, Response } from "express";
import { param } from "../utils/params";
import { AppDataSource } from "../data-source";
import { Message } from "../entities/Message";
import { Job, JobStatus } from "../entities/Job";
import { Bid, BidStatus } from "../entities/Bid";
import { User, UserRole } from "../entities/User";
import { NotificationType } from "../entities/Notification";
import { createNotification } from "../utils/notifications";
import { uploadedPaths } from "../middleware/upload";
import { publishMessage, sseInit, sseSubscribe } from "../utils/sse";

async function canAccessJobMessages(job: Job, userId: string, role: UserRole) {
  if (role === UserRole.ADMIN) return true;
  if (job.homeownerId === userId) return true;
  if (job.acceptedBidId) {
    const bid = await AppDataSource.getRepository(Bid).findOne({
      where: { id: job.acceptedBidId },
    });
    if (bid?.tradespersonId === userId) return true;
  }
  if (role === UserRole.TRADESPERSON && job.status === JobStatus.OPEN) {
    const bid = await AppDataSource.getRepository(Bid).findOne({
      where: { jobId: job.id, tradespersonId: userId, status: BidStatus.ACTIVE },
    });
    if (bid) return true;
  }
  return false;
}

function parseQuote(body: any, attachmentOverride?: string | null) {
  const raw = body?.quote;
  let parsed: any = raw;
  if (typeof raw === "string" && raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  const amountSrc =
    parsed?.amount ?? body?.quoteAmount ?? body?.quote_amount;
  const amt = amountSrc !== undefined && amountSrc !== null && amountSrc !== ""
    ? Number(amountSrc)
    : NaN;
  if (!Number.isFinite(amt) || amt <= 0) return undefined;
  const notesRaw = parsed?.notes ?? body?.quoteNotes ?? body?.quote_notes;
  const att =
    attachmentOverride ||
    parsed?.attachmentUrl ||
    body?.quoteAttachmentUrl ||
    undefined;
  return {
    amount: amt,
    notes: notesRaw ? String(notesRaw).slice(0, 2000) : undefined,
    attachmentUrl: att ? String(att) : undefined,
  };
}

function serializeMessage(m: Message, sender?: User | null) {
  const s = sender || (m as any).sender;
  return {
    id: m.id,
    jobId: m.jobId,
    body: m.body,
    attachmentUrls: m.attachmentUrls || [],
    quote: m.quote || null,
    createdAt: m.createdAt,
    readAt: m.readAt,
    sender: s
      ? { id: s.id, email: s.email, name: s.name, role: s.role }
      : { id: m.senderId, email: "", role: "" },
  };
}

export async function listMessages(req: Request, res: Response) {
  const job = await AppDataSource.getRepository(Job).findOne({ where: { id: param(req, "jobId") } });
  if (!job) return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });

  const ok = await canAccessJobMessages(job, req.user!.id, req.user!.role);
  if (!ok) return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });

  const messages = await AppDataSource.getRepository(Message).find({
    where: { jobId: job.id },
    relations: ["sender"],
    order: { createdAt: "ASC" },
  });

  const unread = messages.filter((m) => m.senderId !== req.user!.id && !m.readAt);
  if (unread.length) {
    const now = new Date();
    for (const m of unread) m.readAt = now;
    await AppDataSource.getRepository(Message).save(unread);
  }

  return res.json({
    messages: messages.map((m) => serializeMessage(m, m.sender)),
  });
}

export async function sendMessage(req: Request, res: Response) {
  const bodyRaw = req.body?.body;
  const filesMap = req.files as
    | { [field: string]: Express.Multer.File[] }
    | Express.Multer.File[]
    | undefined;
  let attachmentFiles: Express.Multer.File[] = [];
  let quoteFile: Express.Multer.File | undefined;
  if (Array.isArray(filesMap)) {
    attachmentFiles = filesMap;
  } else if (filesMap) {
    attachmentFiles = filesMap.attachments || [];
    quoteFile = (filesMap.quoteAttachment || [])[0];
  }
  const attachmentUrls = uploadedPaths(attachmentFiles);
  const quoteFileUrl = quoteFile ? `/uploads/${quoteFile.filename}` : undefined;
  const quote = parseQuote(req.body, quoteFileUrl);
  const body = bodyRaw != null ? String(bodyRaw).trim().slice(0, 4000) : "";

  if (!body && !attachmentUrls.length && !quote) {
    return res.status(400).json({ message: "body, attachments, or quote required" });
  }

  const job = await AppDataSource.getRepository(Job).findOne({ where: { id: param(req, "jobId") } });
  if (!job) return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });

  const ok = await canAccessJobMessages(job, req.user!.id, req.user!.role);
  if (!ok) return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });

  let finalAttachments = attachmentUrls;
  if (quote?.attachmentUrl && !finalAttachments.includes(quote.attachmentUrl)) {
    // keep quote attachment separate in quote object; also list if it was uploaded as attachment
  }

  const msg = await AppDataSource.getRepository(Message).save(
    AppDataSource.getRepository(Message).create({
      jobId: job.id,
      senderId: req.user!.id,
      body:
        body ||
        (quote
          ? `Quote: ₹${Number(quote.amount).toFixed(0)}`
          : attachmentUrls.length
            ? "(attachment)"
            : ""),
      attachmentUrls: finalAttachments,
      quote: quote || null,
    })
  );

  const recipients = new Set<string>();
  if (job.homeownerId !== req.user!.id) recipients.add(job.homeownerId);
  if (job.acceptedBidId) {
    const bid = await AppDataSource.getRepository(Bid).findOne({ where: { id: job.acceptedBidId } });
    if (bid && bid.tradespersonId !== req.user!.id) recipients.add(bid.tradespersonId);
  } else if (req.user!.role === UserRole.TRADESPERSON) {
    recipients.add(job.homeownerId);
  }

  for (const userId of recipients) {
    await createNotification({
      userId,
      type: NotificationType.MESSAGE,
      title: quote
        ? "New quote in chat"
        : attachmentUrls.length
          ? "New message with attachment"
          : "New message",
      body: quote
        ? `Quote ₹${Number(quote.amount).toFixed(0)} on "${job.title}"`
        : `New message on "${job.title}"`,
      link: userId === job.homeownerId ? `/homeowner/jobs/${job.id}` : `/tradesperson/jobs/${job.id}`,
      meta: { jobId: job.id, messageId: msg.id, hasQuote: !!quote },
    });
  }

  const sender = await AppDataSource.getRepository(User).findOne({ where: { id: req.user!.id } });
  const shaped = serializeMessage(msg, sender);

  try {
    publishMessage(job.id, { message: shaped });
  } catch {
    /* optional */
  }

  return res.status(201).json({
    message: shaped,
  });
}

export async function streamMessages(req: Request, res: Response) {
  const job = await AppDataSource.getRepository(Job).findOne({ where: { id: param(req, "jobId") } });
  if (!job) return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });

  const ok = await canAccessJobMessages(job, req.user!.id, req.user!.role);
  if (!ok) return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });

  sseInit(res);
  sseSubscribe(res, req.user!.id, { jobId: job.id });
}
