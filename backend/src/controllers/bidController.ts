import { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { Bid, BidStatus } from "../entities/Bid";
import { Job, JobStatus, PaymentStatus } from "../entities/Job";
import { UserRole } from "../entities/User";
import {
  TradespersonProfile,
  VerificationStatus,
} from "../entities/TradespersonProfile";
import { invalidateOpenJobsCache } from "../utils/cache";

const bidRepo = () => AppDataSource.getRepository(Bid);
const jobRepo = () => AppDataSource.getRepository(Job);
const profileRepo = () => AppDataSource.getRepository(TradespersonProfile);

function redactBid(bid: Bid) {
  const { amount: _a, ...rest } = bid;
  return { ...rest, amount: null as number | null };
}

export async function placeBid(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: req.params.id } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (job.status !== JobStatus.OPEN) {
    return res.status(400).json({ message: "Job is not open for bidding", code: "JOB_NOT_OPEN" });
  }

  const profile = await profileRepo().findOne({ where: { userId: req.user!.id } });
  if (!profile || profile.verificationStatus !== VerificationStatus.VERIFIED) {
    return res.status(403).json({
      message: "Tradesperson must be verified by admin before bidding",
      code: "NOT_VERIFIED",
    });
  }

  const existing = await bidRepo().findOne({
    where: { jobId: job.id, tradespersonId: req.user!.id },
  });
  if (existing) {
    return res.status(409).json({
      message: "You already placed a bid on this job",
      code: "DUPLICATE_BID",
    });
  }

  const activeCount = await bidRepo().count({
    where: { jobId: job.id, status: BidStatus.ACTIVE },
  });
  if (activeCount >= job.maxBids) {
    return res.status(400).json({
      message: "This job has reached the maximum number of bids",
      code: "MAX_BIDS",
    });
  }

  const { amount, message, etaDays } = req.body ?? {};
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ message: "amount must be a positive number" });
  }

  const bid = bidRepo().create({
    jobId: job.id,
    tradespersonId: req.user!.id,
    amount: amt,
    message: message ? String(message) : undefined,
    etaDays: etaDays !== undefined ? parseInt(String(etaDays), 10) : undefined,
    status: BidStatus.ACTIVE,
  });
  await bidRepo().save(bid);
  return res.status(201).json({ bid });
}

export async function listBids(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: req.params.id } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }

  const { role, id: userId } = req.user!;
  const isOwner = job.homeownerId === userId;
  const isAdmin = role === UserRole.ADMIN;

  if (!isOwner && !isAdmin && role !== UserRole.TRADESPERSON) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }

  // Homeowners only see bids on own jobs (admin always ok)
  if (role === UserRole.HOMEOWNER && !isOwner) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }

  const bids = await bidRepo().find({
    where: { jobId: job.id },
    order: { createdAt: "ASC" },
  });

  const jobAwarded =
    job.status === JobStatus.AWARDED ||
    job.status === JobStatus.IN_PROGRESS ||
    job.status === JobStatus.COMPLETED;

  // Privacy: hide other tradespeople's amounts until job awarded
  if (role === UserRole.TRADESPERSON && !isAdmin) {
    const shaped = bids.map((b) => {
      if (b.tradespersonId === userId || jobAwarded) return b;
      return redactBid(b);
    });
    return res.json({ bids: shaped });
  }

  return res.json({ bids });
}

export async function withdrawBid(req: Request, res: Response) {
  const bid = await bidRepo().findOne({ where: { id: req.params.id } });
  if (!bid) {
    return res.status(404).json({ message: "Bid not found", code: "NOT_FOUND" });
  }
  if (bid.tradespersonId !== req.user!.id) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }
  if (bid.status !== BidStatus.ACTIVE) {
    return res.status(400).json({ message: "Only active bids can be withdrawn", code: "BID_NOT_ACTIVE" });
  }

  const job = await jobRepo().findOne({ where: { id: bid.jobId } });
  if (!job || job.status !== JobStatus.OPEN) {
    return res.status(400).json({ message: "Can only withdraw while job is open", code: "JOB_NOT_OPEN" });
  }

  bid.status = BidStatus.WITHDRAWN;
  await bidRepo().save(bid);
  return res.json({ bid });
}

export async function acceptBid(req: Request, res: Response) {
  const bid = await bidRepo().findOne({ where: { id: req.params.id } });
  if (!bid) {
    return res.status(404).json({ message: "Bid not found", code: "NOT_FOUND" });
  }
  if (bid.status !== BidStatus.ACTIVE) {
    return res.status(400).json({ message: "Bid is not active", code: "BID_NOT_ACTIVE" });
  }

  const job = await jobRepo().findOne({ where: { id: bid.jobId } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (job.homeownerId !== req.user!.id) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }
  if (job.status !== JobStatus.OPEN) {
    return res.status(400).json({ message: "Can only accept bids on open jobs", code: "JOB_NOT_OPEN" });
  }

  await AppDataSource.transaction(async (manager) => {
    bid.status = BidStatus.ACCEPTED;
    await manager.save(bid);

    await manager
      .createQueryBuilder()
      .update(Bid)
      .set({ status: BidStatus.REJECTED })
      .where("jobId = :jobId AND id != :bidId AND status = :active", {
        jobId: job.id,
        bidId: bid.id,
        active: BidStatus.ACTIVE,
      })
      .execute();

    job.status = JobStatus.AWARDED;
    job.acceptedBidId = bid.id;
    // Demo only — marks payment as simulated, no real money moves
    job.paymentStatus = PaymentStatus.SIMULATED_PAID;
    await manager.save(job);
  });

  await invalidateOpenJobsCache();

  const updatedJob = await jobRepo().findOne({ where: { id: job.id } });
  const bids = await bidRepo().find({ where: { jobId: job.id }, order: { createdAt: "ASC" } });
  return res.json({ job: updatedJob, bids });
}
