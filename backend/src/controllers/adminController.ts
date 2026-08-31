import { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import {
  TradespersonProfile,
  VerificationStatus,
} from "../entities/TradespersonProfile";
import { User, UserRole } from "../entities/User";
import { Job, JobStatus } from "../entities/Job";
import { Dispute, DisputeStatus } from "../entities/Dispute";
import { Bid, BidStatus } from "../entities/Bid";
import { invalidateOpenJobsCache } from "../utils/cache";

export async function verifyTradesperson(req: Request, res: Response) {
  const userId = req.params.id;
  const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
  if (!user || user.role !== UserRole.TRADESPERSON) {
    return res.status(404).json({ message: "Tradesperson not found", code: "NOT_FOUND" });
  }

  const profileRepo = AppDataSource.getRepository(TradespersonProfile);
  let profile = await profileRepo.findOne({ where: { userId } });
  if (!profile) {
    profile = profileRepo.create({ userId });
  }

  const action = String(req.body?.status || "verified");
  if (action === "verified") {
    profile.verificationStatus = VerificationStatus.VERIFIED;
    profile.verifiedAt = new Date();
  } else if (action === "rejected") {
    profile.verificationStatus = VerificationStatus.REJECTED;
    profile.verifiedAt = undefined;
  } else if (action === "suspended") {
    profile.verificationStatus = VerificationStatus.SUSPENDED;
  } else if (action === "pending") {
    profile.verificationStatus = VerificationStatus.PENDING;
    profile.verifiedAt = undefined;
  } else {
    return res.status(400).json({ message: "status must be verified|rejected|suspended|pending" });
  }

  await profileRepo.save(profile);
  return res.json({ profile });
}

export async function listTradespeople(req: Request, res: Response) {
  const qb = AppDataSource.getRepository(TradespersonProfile)
    .createQueryBuilder("p")
    .leftJoinAndSelect("p.user", "user")
    .orderBy("p.createdAt", "DESC");

  if (req.query.status) {
    qb.andWhere("p.verificationStatus = :status", { status: String(req.query.status) });
  }

  const profiles = await qb.getMany();
  return res.json({
    tradespeople: profiles.map((p) => ({
      id: p.id,
      userId: p.userId,
      email: p.user?.email,
      skills: p.skills,
      serviceAreas: p.serviceAreas,
      verificationStatus: p.verificationStatus,
      verifiedAt: p.verifiedAt,
      createdAt: p.createdAt,
    })),
  });
}

export async function adminStats(_req: Request, res: Response) {
  const userRepo = AppDataSource.getRepository(User);
  const jobRepo = AppDataSource.getRepository(Job);
  const disputeRepo = AppDataSource.getRepository(Dispute);
  const profileRepo = AppDataSource.getRepository(TradespersonProfile);

  const [
    totalUsers,
    homeowners,
    tradespeople,
    openJobs,
    openDisputes,
    pendingVerifications,
  ] = await Promise.all([
    userRepo.count(),
    userRepo.count({ where: { role: UserRole.HOMEOWNER } }),
    userRepo.count({ where: { role: UserRole.TRADESPERSON } }),
    jobRepo.count({ where: { status: JobStatus.OPEN } }),
    disputeRepo.count({ where: { status: DisputeStatus.OPEN } }),
    profileRepo.count({ where: { verificationStatus: VerificationStatus.PENDING } }),
  ]);

  return res.json({
    stats: {
      totalUsers,
      homeowners,
      tradespeople,
      openJobs,
      openDisputes,
      pendingVerifications,
    },
  });
}

export async function forceCancelJob(req: Request, res: Response) {
  const job = await AppDataSource.getRepository(Job).findOne({
    where: { id: req.params.id },
  });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (job.status === JobStatus.COMPLETED || job.status === JobStatus.CANCELLED) {
    return res.status(400).json({
      message: "Job is already terminal",
      code: "INVALID_STATUS",
    });
  }

  job.status = JobStatus.CANCELLED;
  await AppDataSource.getRepository(Job).save(job);

  // Reject remaining active bids
  await AppDataSource.getRepository(Bid)
    .createQueryBuilder()
    .update(Bid)
    .set({ status: BidStatus.REJECTED })
    .where("jobId = :jobId AND status = :active", {
      jobId: job.id,
      active: BidStatus.ACTIVE,
    })
    .execute();

  await invalidateOpenJobsCache();
  return res.json({ job });
}
