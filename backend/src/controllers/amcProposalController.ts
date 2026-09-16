import { Request, Response } from "express";
import { param } from "../utils/params";
import { AppDataSource } from "../data-source";
import { Bid } from "../entities/Bid";
import { Job, JobStatus } from "../entities/Job";
import { UserRole } from "../entities/User";
import { NotificationType } from "../entities/Notification";
import { createNotification } from "../utils/notifications";

const jobRepo = () => AppDataSource.getRepository(Job);
const bidRepo = () => AppDataSource.getRepository(Bid);

const ALLOWED_CADENCE = new Set(["weekly", "monthly", "amc"]);
const ACTIVE = [JobStatus.AWARDED, JobStatus.IN_PROGRESS, JobStatus.COMPLETED];

async function getAwardedProId(job: Job): Promise<string | undefined> {
  if (!job.acceptedBidId) return undefined;
  const accepted = await bidRepo().findOne({ where: { id: job.acceptedBidId } });
  return accepted?.tradespersonId;
}

function normalizeCadence(raw: unknown): string {
  const v = String(raw || "").toLowerCase().trim();
  return ALLOWED_CADENCE.has(v) ? v : "monthly";
}

function normalizeProposalBody(body: any) {
  const packageLabel = String(body?.packageLabel || "").trim().slice(0, 80);
  const amountMin = Number(body?.amountMin);
  if (!packageLabel || !Number.isFinite(amountMin) || amountMin < 0) {
    return { error: "packageLabel and amountMin are required" as const };
  }
  let amountMax: number | null | undefined = undefined;
  if (body?.amountMax != null && body?.amountMax !== "") {
    const n = Number(body.amountMax);
    if (Number.isFinite(n) && n >= amountMin) amountMax = Math.round(n);
  }
  const unit =
    body?.unit != null && String(body.unit).trim()
      ? String(body.unit).trim().slice(0, 40)
      : undefined;
  const note =
    body?.note != null && String(body.note).trim()
      ? String(body.note).trim().slice(0, 500)
      : undefined;
  return {
    cadence: normalizeCadence(body?.cadence),
    packageLabel,
    amountMin: Math.round(amountMin),
    amountMax,
    unit,
    note,
  };
}

/** Professional proposes a soft AMC / recurring package on an awarded job. */
export async function proposeAmc(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (!ACTIVE.includes(job.status)) {
    return res.status(400).json({
      message: "AMC proposals are available on awarded, in-progress, or completed jobs",
      code: "INVALID_STATUS",
    });
  }

  const proId = await getAwardedProId(job);
  const isPro = proId === req.user!.id;
  const isAdmin = req.user!.role === UserRole.ADMIN;
  if (!isPro && !isAdmin) {
    return res.status(403).json({
      message: "Only the awarded professional can propose an AMC package",
      code: "FORBIDDEN",
    });
  }


  const open = job.amcProposal;
  if (open && open.status === "requested") {
    return res.status(400).json({
      message: "Client already requested AMC — reply to their request first",
      code: "CLIENT_REQUEST_OPEN",
    });
  }

  const parsed = normalizeProposalBody(req.body ?? {});
  if ("error" in parsed) {
    return res.status(400).json({ message: parsed.error, code: "INVALID_BODY" });
  }

  const now = new Date().toISOString();
  job.amcProposal = {
    status: "proposed",
    cadence: parsed.cadence,
    packageLabel: parsed.packageLabel,
    amountMin: parsed.amountMin,
    ...(parsed.amountMax != null ? { amountMax: parsed.amountMax } : {}),
    ...(parsed.unit ? { unit: parsed.unit } : {}),
    ...(parsed.note ? { note: parsed.note } : {}),
    proposedByUserId: req.user!.id,
    proposedAt: now,
  };
  await jobRepo().save(job);

  await createNotification({
    userId: job.homeownerId,
    type: NotificationType.JOB_STATUS,
    title: "Recurring / AMC proposal",
    body: `${parsed.packageLabel} (${parsed.cadence}) proposed on "${job.title}". Soft only — reply on the job.`,
    link: `/homeowner/jobs/${job.id}`,
    meta: { jobId: job.id, amc: true },
  });

  return res.json({ job, message: "AMC / recurring proposal sent" });
}

/**
 * Client replies to a soft AMC proposal: accept | decline | counter.
 * Counter may include replyCadence + replyNote (no price engine).
 */
export async function replyAmc(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }

  const isOwner = job.homeownerId === req.user!.id;
  const isAdmin = req.user!.role === UserRole.ADMIN;
  if (!isOwner && !isAdmin) {
    return res.status(403).json({
      message: "Only the client can reply to an AMC proposal",
      code: "FORBIDDEN",
    });
  }

  const existing = job.amcProposal;
  if (!existing || existing.status !== "proposed") {
    return res.status(400).json({
      message: "No open AMC proposal to reply to",
      code: "NO_PROPOSAL",
    });
  }

  const action = String(req.body?.action || "").toLowerCase().trim();
  if (!["accept", "decline", "counter"].includes(action)) {
    return res.status(400).json({
      message: "action must be accept, decline, or counter",
      code: "INVALID_ACTION",
    });
  }

  const replyNote =
    req.body?.replyNote != null && String(req.body.replyNote).trim()
      ? String(req.body.replyNote).trim().slice(0, 500)
      : undefined;
  const replyCadence =
    req.body?.replyCadence != null
      ? normalizeCadence(req.body.replyCadence)
      : undefined;

  const now = new Date().toISOString();
  const status =
    action === "accept" ? "accepted" : action === "decline" ? "declined" : "countered";

  job.amcProposal = {
    ...existing,
    status,
    ...(replyNote ? { replyNote } : { replyNote: existing.replyNote }),
    ...(replyCadence ? { replyCadence } : {}),
    repliedAt: now,
  };
  await jobRepo().save(job);

  const proId = await getAwardedProId(job);
  if (proId) {
    const title =
      action === "accept"
        ? "AMC proposal accepted"
        : action === "decline"
          ? "AMC proposal declined"
          : "AMC counter reply";
    await createNotification({
      userId: proId,
      type: NotificationType.JOB_STATUS,
      title,
      body: `Client replied to your recurring proposal on "${job.title}".`,
      link: `/tradesperson/jobs/${job.id}`,
      meta: { jobId: job.id, amc: true, action },
    });
  }

  return res.json({ job, message: `AMC proposal ${status}` });
}


/** Client requests a soft AMC / recurring package (inverse of pro propose). */
export async function requestAmc(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (!ACTIVE.includes(job.status)) {
    return res.status(400).json({
      message: "AMC requests are available on awarded, in-progress, or completed jobs",
      code: "INVALID_STATUS",
    });
  }

  const isOwner = job.homeownerId === req.user!.id;
  const isAdmin = req.user!.role === UserRole.ADMIN;
  if (!isOwner && !isAdmin) {
    return res.status(403).json({
      message: "Only the client can request an AMC package",
      code: "FORBIDDEN",
    });
  }

  const existing = job.amcProposal;
  if (existing && (existing.status === "proposed" || existing.status === "requested")) {
    return res.status(400).json({
      message: "An open AMC proposal or request already exists — reply or wait",
      code: "ALREADY_OPEN",
    });
  }

  const parsed = normalizeProposalBody(req.body ?? {});
  if ("error" in parsed) {
    return res.status(400).json({ message: parsed.error, code: "INVALID_BODY" });
  }

  const now = new Date().toISOString();
  job.amcProposal = {
    status: "requested",
    cadence: parsed.cadence,
    packageLabel: parsed.packageLabel,
    amountMin: parsed.amountMin,
    ...(parsed.amountMax != null ? { amountMax: parsed.amountMax } : {}),
    ...(parsed.unit ? { unit: parsed.unit } : {}),
    ...(parsed.note ? { note: parsed.note } : {}),
    proposedByUserId: req.user!.id,
    proposedAt: now,
  };
  await jobRepo().save(job);

  const proId = await getAwardedProId(job);
  if (proId) {
    await createNotification({
      userId: proId,
      type: NotificationType.JOB_STATUS,
      title: "Client requested AMC / recurring",
      body: `${parsed.packageLabel} (${parsed.cadence}) requested on "${job.title}". Soft only — reply on the job.`,
      link: `/tradesperson/jobs/${job.id}`,
      meta: { jobId: job.id, amc: true, action: "request" },
    });
  }

  return res.json({ job, message: "AMC / recurring request sent" });
}

/**
 * Professional replies to a client AMC request: accept | decline | counter.
 */
export async function replyAmcRequest(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }

  const proId = await getAwardedProId(job);
  const isPro = proId === req.user!.id;
  const isAdmin = req.user!.role === UserRole.ADMIN;
  if (!isPro && !isAdmin) {
    return res.status(403).json({
      message: "Only the awarded professional can reply to an AMC request",
      code: "FORBIDDEN",
    });
  }

  const existing = job.amcProposal;
  if (!existing || existing.status !== "requested") {
    return res.status(400).json({
      message: "No open AMC request to reply to",
      code: "NO_REQUEST",
    });
  }

  const action = String(req.body?.action || "").toLowerCase().trim();
  if (!["accept", "decline", "counter"].includes(action)) {
    return res.status(400).json({
      message: "action must be accept, decline, or counter",
      code: "INVALID_ACTION",
    });
  }

  const replyNote =
    req.body?.replyNote != null && String(req.body.replyNote).trim()
      ? String(req.body.replyNote).trim().slice(0, 500)
      : undefined;
  const replyCadence =
    req.body?.replyCadence != null
      ? normalizeCadence(req.body.replyCadence)
      : undefined;

  // Optional: pro may refine package amounts when accepting / countering
  let amountMin = existing.amountMin;
  let amountMax = existing.amountMax;
  let packageLabel = existing.packageLabel;
  let unit = existing.unit;
  let cadence = existing.cadence;
  if (req.body?.packageLabel != null && String(req.body.packageLabel).trim()) {
    packageLabel = String(req.body.packageLabel).trim().slice(0, 80);
  }
  if (req.body?.amountMin != null && req.body?.amountMin !== "") {
    const n = Number(req.body.amountMin);
    if (Number.isFinite(n) && n >= 0) amountMin = Math.round(n);
  }
  if (req.body?.amountMax != null && req.body?.amountMax !== "") {
    const n = Number(req.body.amountMax);
    if (Number.isFinite(n) && n >= amountMin) amountMax = Math.round(n);
  }
  if (req.body?.unit != null && String(req.body.unit).trim()) {
    unit = String(req.body.unit).trim().slice(0, 40);
  }
  if (req.body?.cadence != null) {
    cadence = normalizeCadence(req.body.cadence);
  }

  const now = new Date().toISOString();
  const status =
    action === "accept" ? "accepted" : action === "decline" ? "declined" : "countered";

  job.amcProposal = {
    ...existing,
    status,
    packageLabel,
    amountMin,
    ...(amountMax != null ? { amountMax } : {}),
    ...(unit ? { unit } : {}),
    cadence,
    ...(replyNote ? { replyNote } : { replyNote: existing.replyNote }),
    ...(replyCadence ? { replyCadence } : {}),
    repliedAt: now,
  };
  await jobRepo().save(job);

  const title =
    action === "accept"
      ? "AMC request accepted"
      : action === "decline"
        ? "AMC request declined"
        : "AMC counter from professional";
  await createNotification({
    userId: job.homeownerId,
    type: NotificationType.JOB_STATUS,
    title,
    body: `Your professional replied to the recurring request on "${job.title}".`,
    link: `/homeowner/jobs/${job.id}`,
    meta: { jobId: job.id, amc: true, action },
  });

  return res.json({ job, message: `AMC request ${status}` });
}
