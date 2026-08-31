import { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { TradespersonProfile } from "../entities/TradespersonProfile";
import { User, UserRole } from "../entities/User";

export async function getMyProfile(req: Request, res: Response) {
  if (req.user!.role !== UserRole.TRADESPERSON) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }

  const profileRepo = AppDataSource.getRepository(TradespersonProfile);
  let profile = await profileRepo.findOne({ where: { userId: req.user!.id } });
  if (!profile) {
    profile = await profileRepo.save(profileRepo.create({ userId: req.user!.id }));
  }

  const user = await AppDataSource.getRepository(User).findOne({
    where: { id: req.user!.id },
  });

  return res.json({
    profile: {
      id: profile.id,
      userId: profile.userId,
      email: user?.email,
      skills: profile.skills,
      serviceAreas: profile.serviceAreas,
      verificationStatus: profile.verificationStatus,
      verifiedAt: profile.verifiedAt,
      licenseDocUrl: profile.licenseDocUrl,
    },
  });
}

export async function updateMyProfile(req: Request, res: Response) {
  if (req.user!.role !== UserRole.TRADESPERSON) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }

  const profileRepo = AppDataSource.getRepository(TradespersonProfile);
  let profile = await profileRepo.findOne({ where: { userId: req.user!.id } });
  if (!profile) {
    profile = profileRepo.create({ userId: req.user!.id });
  }

  const { skills, serviceAreas } = req.body ?? {};
  if (skills !== undefined) profile.skills = String(skills);
  if (serviceAreas !== undefined) profile.serviceAreas = String(serviceAreas);

  await profileRepo.save(profile);
  return res.json({ profile });
}
