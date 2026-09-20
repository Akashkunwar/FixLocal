import type { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { Review, ReviewDirection } from "../entities/Review";
import { JobStatus } from "../entities/Job";
import { TradespersonProfile } from "../entities/TradespersonProfile";
import { User, UserRole } from "../entities/User";
import { NotificationType } from "../entities/Notification";
import { createNotification } from "../utils/notifications";
import { toReview } from "../serializers";
import { assertPrivateAccess, isAwardedPro, isOwner, loadJobContext } from "../policies/jobPolicy";
import { viewer } from "./jobController";
import { conflict, forbidden, notFound } from "../http/errors";

const reviews = () => AppDataSource.getRepository(Review);

async function refreshProRating(tradespersonId: string) {
  const row = await reviews()
    .createQueryBuilder("r")
    .select("AVG(r.rating)", "avg")
    .addSelect("COUNT(*)", "count")
    .where("r.tradespersonId = :id AND r.direction = :dir", { id: tradespersonId, dir: ReviewDirection.CLIENT_TO_PRO })
    .getRawOne<{ avg: string | null; count: string }>();
  await AppDataSource.getRepository(TradespersonProfile).update(
    { userId: tradespersonId },
    { averageRating: Number(Number(row?.avg || 0).toFixed(2)), reviewCount: Number(row?.count || 0) }
  );
}

/** Client reviews the pro, or the pro reviews the client, once the job is completed. */
export async function createReview(req: Request, res: Response) {
  const { jobId, rating, comment } = req.valid.body;
  const ctx = await loadJobContext(jobId);
  const v = viewer(req);
  if (ctx.job.status !== JobStatus.COMPLETED) throw conflict("Reviews are only possible on completed jobs", "INVALID_STATUS");
  if (!ctx.acceptedProId) throw conflict("This job has no hired professional", "NO_AWARDED_PRO");
  let direction: ReviewDirection;
  let revieweeId: string;
  if (isOwner(ctx, v)) {
    direction = ReviewDirection.CLIENT_TO_PRO;
    revieweeId = ctx.acceptedProId;
  } else if (isAwardedPro(ctx, v)) {
    direction = ReviewDirection.PRO_TO_CLIENT;
    revieweeId = ctx.job.homeownerId;
  } else {
    throw forbidden("Only the client and the hired professional can review this job");
  }
  if (await reviews().exists({ where: { jobId, direction } })) {
    throw conflict("You already reviewed this job", "ALREADY_REVIEWED");
  }
  const review = await reviews().save(
    reviews().create({
      jobId,
      direction,
      reviewerId: v.id,
      revieweeId,
      tradespersonId: ctx.acceptedProId,
      rating,
      comment: comment || undefined,
    })
  );
  if (direction === ReviewDirection.CLIENT_TO_PRO) await refreshProRating(ctx.acceptedProId);
  await createNotification({
    userId: revieweeId,
    type: NotificationType.REVIEW,
    title: "New review received",
    body: `You received a ${rating}-star review on "${ctx.job.title}".`,
    link: direction === ReviewDirection.CLIENT_TO_PRO ? `/professional/jobs/${jobId}` : `/client/jobs/${jobId}`,
    meta: { jobId, reviewId: review.id, direction },
  });
  return res.status(201).json({ review: toReview(review) });
}

export async function listReviewsForPro(req: Request, res: Response) {
  const rows = await reviews().find({
    where: { revieweeId: req.valid.params.userId, direction: ReviewDirection.CLIENT_TO_PRO },
    relations: ["reviewer", "job"],
    order: { createdAt: "DESC" },
    take: 50,
  });
  return res.json({ reviews: rows.map(toReview) });
}

/** Pros can see how a client has been rated by other professionals. */
export async function listReviewsForClient(req: Request, res: Response) {
  const client = await AppDataSource.getRepository(User).findOne({ where: { id: req.valid.params.userId } });
  if (!client || client.role !== UserRole.HOMEOWNER) throw notFound("Client not found");
  const rows = await reviews().find({
    where: { revieweeId: client.id, direction: ReviewDirection.PRO_TO_CLIENT },
    relations: ["reviewer", "job"],
    order: { createdAt: "DESC" },
    take: 50,
  });
  const avg = rows.length ? Math.round((rows.reduce((s, r) => s + r.rating, 0) / rows.length) * 100) / 100 : 0;
  return res.json({ averageRating: avg, reviewCount: rows.length, reviews: rows.map(toReview) });
}

export async function getJobReview(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.jobId);
  assertPrivateAccess(ctx, viewer(req));
  const rows = await reviews().find({ where: { jobId: ctx.job.id }, relations: ["reviewer"] });
  const client = rows.find((r) => r.direction === ReviewDirection.CLIENT_TO_PRO);
  const pro = rows.find((r) => r.direction === ReviewDirection.PRO_TO_CLIENT);
  return res.json({ review: client ? toReview(client) : null, proReview: pro ? toReview(pro) : null });
}
