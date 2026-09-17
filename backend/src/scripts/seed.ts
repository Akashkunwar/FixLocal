import "reflect-metadata";
import "dotenv/config";
import { AppDataSource } from "../data-source";
import { User, UserRole } from "../entities/User";
import {
  TradespersonProfile,
  VerificationStatus,
} from "../entities/TradespersonProfile";
import { Job, JobCategory, JobStatus } from "../entities/Job";
import { Bid, BidStatus } from "../entities/Bid";
import { Review, ReviewDirection } from "../entities/Review";
import { Notification, NotificationType } from "../entities/Notification";
import { hashPassword } from "../utils/password";
import { createEscrow, releaseRemaining } from "../domain/escrow";

const SEED_PASSWORD = process.env.SEED_PASSWORD || "Password123!";

/** Creates demo users; existing passwords are only reset with SEED_RESET=true. */
async function upsertUser(email: string, role: UserRole, extras: Partial<User> = {}) {
  const userRepo = AppDataSource.getRepository(User);
  const existing = await userRepo.findOne({ where: { email } });
  if (existing) {
    const patch: Partial<User> = { ...extras };
    if (!existing.emailVerifiedAt) patch.emailVerifiedAt = new Date();
    if (process.env.SEED_RESET === "true") {
      await userRepo.update({ id: existing.id }, { ...patch, passwordHash: await hashPassword(SEED_PASSWORD) } as never);
    } else {
      await userRepo.update({ id: existing.id }, patch as never);
    }
    return userRepo.findOneOrFail({ where: { id: existing.id } });
  }
  return userRepo.save(
    userRepo.create({ email, passwordHash: await hashPassword(SEED_PASSWORD), role, emailVerifiedAt: new Date(), ...extras })
  );
}

async function seed() {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to seed demo data with NODE_ENV=production.");
    process.exit(1);
  }
  await AppDataSource.initialize();
  if (await AppDataSource.showMigrations()) {
    console.error("The database has pending migrations. Run `npm run db:migrate` first.");
    process.exit(1);
  }

  await upsertUser("admin@fixlocal.local", UserRole.ADMIN, { name: "FixLocal Admin" });
  const home = await upsertUser("home@fixlocal.local", UserRole.HOMEOWNER, {
    name: "Priya Sharma",
    phone: "+91 98765 43210",
  });
  const home2 = await upsertUser("home2@fixlocal.local", UserRole.HOMEOWNER, {
    name: "Rahul Mehta",
    phone: "+91 99887 76655",
  });
  const pro = await upsertUser("pro@fixlocal.local", UserRole.TRADESPERSON, {
    name: "Arjun Patel",
    phone: "+91 91234 56789",
  });
  const pro2 = await upsertUser("pro2@fixlocal.local", UserRole.TRADESPERSON, {
    name: "Sneha Reddy",
    phone: "+91 90123 45678",
  });
  const pro3 = await upsertUser("pro3@fixlocal.local", UserRole.TRADESPERSON, {
    name: "Vikram Singh",
    phone: "+91 97654 32100",
  });

  const profileRepo = AppDataSource.getRepository(TradespersonProfile);
  async function upsertProfile(userId: string, data: Partial<TradespersonProfile>) {
    let p = await profileRepo.findOne({ where: { userId } });
    if (!p) p = profileRepo.create({ userId, galleryUrls: [] });
    Object.assign(p, data);
    if (!p.galleryUrls) p.galleryUrls = [];
    return profileRepo.save(p);
  }


  const weekdaySlot = { enabled: true, start: "09:00", end: "18:00" };
  const weekendOff = { enabled: false, start: "10:00", end: "14:00" };
  const defaultWeek = {
    mon: weekdaySlot,
    tue: weekdaySlot,
    wed: weekdaySlot,
    thu: weekdaySlot,
    fri: weekdaySlot,
    sat: { enabled: true, start: "10:00", end: "14:00" },
    sun: weekendOff,
  };

  await upsertProfile(pro.id, {
    weeklyAvailability: defaultWeek,
    skills: "Plumbing, Leak repair, Bathroom fitting, Home repair",
    serviceAreas: "Indiranagar, Koramangala, HSR Layout",
    bio: "Licensed plumber with a focus on clean installs and honest pricing. Same-day emergency visits when available.",
    yearsExperience: 8,
    hourlyRateMin: 400,
    hourlyRateMax: 900,
    city: "Bengaluru",
    lat: 12.9784,
    lng: 77.6408,
    verificationStatus: VerificationStatus.VERIFIED,
    verifiedAt: new Date(),
  });

  await upsertProfile(pro2.id, {
    weeklyAvailability: {
      ...defaultWeek,
      sat: weekendOff,
    },
    skills: "Electrical, Wiring, Fan & light install, CCTV, Networking, AMC",
    serviceAreas: "Whitefield, Marathahalli, Brookefield",
    bio: "Certified electrician. Careful with old buildings and apartment boards. Neat cable management.",
    yearsExperience: 6,
    hourlyRateMin: 350,
    hourlyRateMax: 800,
    city: "Bengaluru",
    lat: 12.9698,
    lng: 77.7499,
    verificationStatus: VerificationStatus.VERIFIED,
    verifiedAt: new Date(),
    galleryUrls: [],
  });

  await upsertProfile(pro3.id, {
    weeklyAvailability: defaultWeek,
    skills: "Painting, Waterproofing, Texture walls, Construction, Tiling",
    serviceAreas: "Jayanagar, JP Nagar, Banashankari",
    bio: "Interior & exterior painting. Dust-controlled prep and premium finishes.",
    yearsExperience: 10,
    hourlyRateMin: 300,
    hourlyRateMax: 700,
    city: "Bengaluru",
    lat: 12.9308,
    lng: 77.5838,
    verificationStatus: VerificationStatus.PENDING,
    galleryUrls: [],
  });

  const jobRepo = AppDataSource.getRepository(Job);
  const bidRepo = AppDataSource.getRepository(Bid);
  const reviewRepo = AppDataSource.getRepository(Review);
  const notifRepo = AppDataSource.getRepository(Notification);

  // Clear demo jobs/bids/reviews/notifications for idempotent rich seed (keep users)
  // Only wipe if we have demo marker in title or recreate lightly
  const existingJobs = await jobRepo.count();
  const existingReviews = await reviewRepo.count();
  if (existingJobs < 3 || existingReviews < 1) {
    const jobsData = [
      {
        title: "Kitchen sink leak under cabinet",
        description:
          "Slow drip under the kitchen sink for 3 days. Suspect P-trap or supply line. Prefer evening visit.",
        category: JobCategory.PLUMBING,
        budgetMin: 800,
        budgetMax: 2500,
        address: "12th Main, Indiranagar",
        area: "Indiranagar",
        city: "Bengaluru",
        lat: 12.9784,
        lng: 77.6408,
        pincode: "560038",
        homeownerId: home.id,
        status: JobStatus.OPEN,
        maxBids: 5,
        photoUrls: [],
      },
      {
        title: "Replace ceiling fan in bedroom",
        description:
          "Old fan wobbles loudly. Need safe removal and install of a new BLDC fan (fan provided).",
        category: JobCategory.ELECTRICAL,
        budgetMin: 500,
        budgetMax: 1500,
        address: "Oakwood Residency, Whitefield",
        area: "Whitefield",
        city: "Bengaluru",
        lat: 12.9698,
        lng: 77.7499,
        pincode: "560066",
        homeownerId: home2.id,
        status: JobStatus.OPEN,
        maxBids: 5,
        photoUrls: [],
      },
      {
        title: "Repaint living room (2 coats)",
        description:
          "Approx 400 sq ft. Walls already scraped. Need primer + 2 coats Asian Paints emulsion.",
        category: JobCategory.PAINTING,
        budgetMin: 8000,
        budgetMax: 15000,
        address: "4th Block, Jayanagar",
        area: "Jayanagar",
        city: "Bengaluru",
        lat: 12.9308,
        lng: 77.5838,
        pincode: "560041",
        homeownerId: home.id,
        status: JobStatus.OPEN,
        maxBids: 6,
        photoUrls: [],
      },
    ];

    const createdJobs = [];
    for (const j of jobsData) {
      createdJobs.push(await jobRepo.save(jobRepo.create(j)));
    }

    // Bid from pro on first job
    await bidRepo.save(
      bidRepo.create({
        jobId: createdJobs[0].id,
        tradespersonId: pro.id,
        amount: 1600,
        message: "Can fix today evening. Includes parts up to ₹300.",
        etaDays: 1,
        status: BidStatus.ACTIVE,
      })
    );

    await bidRepo.save(
      bidRepo.create({
        jobId: createdJobs[0].id,
        tradespersonId: pro2.id,
        amount: 1900,
        message: "Available tomorrow morning. 1-year workmanship warranty.",
        etaDays: 1,
        status: BidStatus.ACTIVE,
      })
    );

    // Completed job with released escrow + review for the rating demo
    const done = await jobRepo.save(
      jobRepo.create({
        title: "Bathroom tap replacement",
        description: "Replaced worn mixer tap. Completed last week.",
        category: JobCategory.PLUMBING,
        budgetMin: 1000,
        budgetMax: 2000,
        address: "Indiranagar",
        area: "Indiranagar",
        city: "Bengaluru",
        lat: 12.9784,
        lng: 77.6408,
        pincode: "560038",
        homeownerId: home.id,
        status: JobStatus.COMPLETED,
        maxBids: 3,
        photoUrls: [],
        completedAt: new Date(Date.now() - 5 * 86400000),
      })
    );
    const doneBid = await bidRepo.save(
      bidRepo.create({
        jobId: done.id,
        tradespersonId: pro.id,
        amount: 1400,
        message: "Quick swap with quality fittings.",
        etaDays: 1,
        status: BidStatus.ACCEPTED,
      })
    );
    await AppDataSource.transaction(async (m) => {
      await m.update(Job, { id: done.id }, { acceptedBidId: doneBid.id, escrowAmount: 1400, escrowSource: "bid" });
      done.acceptedBidId = doneBid.id;
      await createEscrow(m, done, pro.id, 1400, home.id);
      await releaseRemaining(m, done, home.id);
    });

    await reviewRepo.save(
      reviewRepo.create({
        jobId: done.id,
        direction: ReviewDirection.CLIENT_TO_PRO,
        reviewerId: home.id,
        revieweeId: pro.id,
        tradespersonId: pro.id,
        rating: 5,
        comment: "Punctual, tidy, and fixed it right the first time. Highly recommend!",
      })
    );

    // Update rating on profile
    const p = await profileRepo.findOne({ where: { userId: pro.id } });
    if (p) {
      p.averageRating = 5;
      p.reviewCount = 1;
      await profileRepo.save(p);
    }

    await notifRepo.save(
      notifRepo.create({
        userId: home.id,
        type: NotificationType.NEW_BID,
        title: "New bid on your job",
        body: `Arjun Patel bid ₹1600 on "${createdJobs[0].title}".`,
        link: `/client/jobs/${createdJobs[0].id}`,
        read: false,
      })
    );

    console.log(`Created ${createdJobs.length + 1} demo jobs, bids, review, notification`);
  } else {
    console.log("Jobs already present — skipped sample job creation");
  }

  // Keep ratings in sync even when sample jobs were skipped (idempotent re-seed)

  // Wave 25 — ensure lead marketplace categories have at least one open demo job
  const wave25Jobs = [
    {
      title: "Deep clean 3BHK + kitchen (weekend)",
      description: "Full home deep clean including bathrooms and kitchen degrease. Bring supplies.",
      category: JobCategory.CLEANING,
      budgetMin: 2500,
      budgetMax: 4500,
      address: "HSR Layout Sector 2",
      area: "HSR Layout",
      city: "Bengaluru",
      lat: 12.9116,
      lng: 77.6389,
      pincode: "560102",
      homeownerId: home.id,
      status: JobStatus.OPEN,
      maxBids: 6,
      photoUrls: [],
    },
    {
      title: "Bathroom wall tiling touch-up",
      description: "Regrout and replace cracked tiles (~20 sq ft). Construction / skilled trade.",
      category: JobCategory.CONSTRUCTION,
      budgetMin: 4000,
      budgetMax: 9000,
      address: "Koramangala 5th Block",
      area: "Koramangala",
      city: "Bengaluru",
      lat: 12.9346,
      lng: 77.6117,
      pincode: "560095",
      homeownerId: home2.id,
      status: JobStatus.OPEN,
      maxBids: 5,
      photoUrls: [],
    },
    {
      title: "Office pantry + meeting-room facilities check",
      description: "Weekly facilities walkthrough: pantry restock checklist, AC vents, light fixtures.",
      category: JobCategory.OFFICE_FACILITIES,
      budgetMin: 3000,
      budgetMax: 7000,
      address: "Manyata Tech Park",
      area: "Nagavara",
      city: "Bengaluru",
      lat: 13.0475,
      lng: 77.6211,
      pincode: "560045",
      homeownerId: home.id,
      status: JobStatus.OPEN,
      maxBids: 5,
      photoUrls: [],
    },
    {
      title: "CCTV + Wi-Fi AMC visit (small office)",
      description: "Quarterly AMC: check 8 cameras, NVR backup, and office Wi-Fi APs.",
      category: JobCategory.TECH_SERVICES,
      budgetMin: 3500,
      budgetMax: 8000,
      address: "Indiranagar 100 Feet Rd",
      area: "Indiranagar",
      city: "Bengaluru",
      lat: 12.9784,
      lng: 77.6408,
      pincode: "560038",
      homeownerId: home2.id,
      status: JobStatus.OPEN,
      maxBids: 5,
      photoUrls: [],
    },
    {
      title: "1BHK local move + 2 helpers",
      description: "Packing optional. Need tempo + 2 helpers for same-city move (HSR → Whitefield).",
      category: JobCategory.MOVING,
      budgetMin: 4500,
      budgetMax: 9000,
      address: "HSR Layout",
      area: "HSR Layout",
      city: "Bengaluru",
      lat: 12.9116,
      lng: 77.6389,
      pincode: "560102",
      homeownerId: home.id,
      status: JobStatus.OPEN,
      maxBids: 6,
      photoUrls: [],
    },
  ];
  for (const j of wave25Jobs) {
    const exists = await jobRepo.findOne({ where: { title: j.title } });
    if (!exists) {
      await jobRepo.save(jobRepo.create(j));
      console.log("  + wave25 job:", j.title, "(" + j.category + ")");
    }
  }

  const allReviews = await reviewRepo.find({ where: { direction: ReviewDirection.CLIENT_TO_PRO } });
  const byPro = new Map<string, { sum: number; count: number }>();
  for (const r of allReviews) {
    const cur = byPro.get(r.tradespersonId) || { sum: 0, count: 0 };
    cur.sum += r.rating;
    cur.count += 1;
    byPro.set(r.tradespersonId, cur);
  }
  for (const [userId, agg] of byPro) {
    const p = await profileRepo.findOne({ where: { userId } });
    if (!p) continue;
    p.averageRating = Math.round((agg.sum / agg.count) * 100) / 100;
    p.reviewCount = agg.count;
    await profileRepo.save(p);
  }

  console.log("\nDemo accounts (password: " + (process.env.SEED_PASSWORD ? "from SEED_PASSWORD" : SEED_PASSWORD) + ")");
  console.log("  admin@fixlocal.local  — Admin");
  console.log("  home@fixlocal.local   — Client (Priya)");
  console.log("  home2@fixlocal.local  — Client (Rahul)");
  console.log("  pro@fixlocal.local    — Professional VERIFIED (Arjun)");
  console.log("  pro2@fixlocal.local   — Professional VERIFIED (Sneha)");
  console.log("  pro3@fixlocal.local   — Professional PENDING (Vikram)");

  await AppDataSource.destroy();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
