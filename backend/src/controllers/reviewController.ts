import { Request, Response } from "express";
import { param } from "../utils/params";
import { AppDataSource } from "../data-source";
import { Review } from "../entities/Review";
import { Job, JobStatus } from "../entities/Job";
import { Bid, BidStatus } from "../entities/Bid";
import { TradespersonProfile } from "../entities/TradespersonProfile";
import { UserRole } from "../entities/User";
import { NotificationType } from "../entities/Notification";
import { createNotification } from "../utils/notifications";

async function refreshTradespersonRating(tradespersonId: string) {
  const reviewRepo = AppDataSource.getRepository(Review);
  const result = await reviewRepo
    .createQueryBuilder("r")
    .select("AVG(r.rating)", "avg")
    .addSelect("COUNT(*)", "count")
    .where("r.tradespersonId = :id", { id: tradespersonId })
    .getRawOne();

  const profileRepo = AppDataSource.getRepository(TradespersonProfile);
  let profile = await profileRepo.findOne({ where: { userId: tradespersonId } });
  if (!profile) return;
  profile.averageRating = Number(Number(result?.avg || 0).toFixed(2));
  profile.reviewCount = parseInt(String(result?.count || 0), 10);
  await profileRepo.save(profile);
}

export async function createReview(req: Request, res: Response) {
  const { jobId, rating, comment } = req.body ?? {};
  if (!jobId || rating === undefined) {
    return res.status(400).json({ message: "jobId and rating are required" });
  }
  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ message: "rating must be an integer 1-5" });
  }

  const job = await AppDataSource.getRepository(Job).findOne({ where: { id: jobId } });
  if (!job) return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  if (job.status !== JobStatus.COMPLETED) {
    return res.status(400).json({ message: "Can only review completed jobs" });
  }
  if (job.homeownerId !== req.user!.id) {
    return res.status(403).json({ message: "Only the homeowner can leave a review", code: "FORBIDDEN" });
  }
  if (!job.acceptedBidId) {
    return res.status(400).json({ message: "Job has no accepted bid" });
  }

  const bid = await AppDataSource.getRepository(Bid).findOne({ where: { id: job.acceptedBidId } });
  if (!bid) return res.status(400).json({ message: "Accepted bid not found" });

  const reviewRepo = AppDataSource.getRepository(Review);
  const existing = await reviewRepo.findOne({ where: { jobId } });
  if (existing) {
    return res.status(409).json({ message: "Job already reviewed", code: "ALREADY_REVIEWED" });
  }

  const review = await reviewRepo.save(
    reviewRepo.create({
      jobId,
      reviewerId: req.user!.id,
      tradespersonId: bid.tradespersonId,
      rating: ratingNum,
      comment: comment ? String(comment).trim() : undefined,
    })
  );

  await refreshTradespersonRating(bid.tradespersonId);
  await createNotification({
    userId: bid.tradespersonId,
    type: NotificationType.REVIEW,
    title: "New review received",
    body: `You received a ${ratingNum}-star review on "${job.title}".`,
    link: `/tradesperson/jobs/${job.id}`,
    meta: { jobId: job.id, reviewId: review.id },
  });

  return res.status(201).json({ review });
}

export async function listReviewsForPro(req: Request, res: Response) {
  const userId = param(req, "userId");
  const reviews = await AppDataSource.getRepository(Review).find({
    where: { tradespersonId: userId },
    relations: ["reviewer", "job"],
    order: { createdAt: "DESC" },
    take: 50,
  });
  return res.json({
    reviews: reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      jobId: r.jobId,
      jobTitle: r.job?.title,
      reviewer: r.reviewer
        ? { id: r.reviewer.id, name: r.reviewer.name, email: r.reviewer.email }
        : null,
    })),
  });
}

export async function getJobReview(req: Request, res: Response) {
  const review = await AppDataSource.getRepository(Review).findOne({
    where: { jobId: param(req, "jobId") },
    relations: ["reviewer"],
  });
  return res.json({ review: review || null });
}
