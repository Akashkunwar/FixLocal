import { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { User, UserRole } from "../entities/User";
import { TradespersonProfile } from "../entities/TradespersonProfile";
import { hashPassword, comparePassword } from "../utils/password";
import { signToken } from "../utils/jwt";

function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}

export async function register(req: Request, res: Response) {
  const { email, password, role } = req.body ?? {};

  if (!email || !password || !role) {
    return res.status(400).json({ message: "email, password, and role are required" });
  }

  if (role !== UserRole.HOMEOWNER && role !== UserRole.TRADESPERSON) {
    return res.status(400).json({
      message: "role must be HOMEOWNER or TRADESPERSON",
      code: "INVALID_ROLE",
    });
  }

  if (typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ message: "password must be at least 6 characters" });
  }

  const userRepo = AppDataSource.getRepository(User);
  const existing = await userRepo.findOne({ where: { email: String(email).toLowerCase() } });
  if (existing) {
    return res.status(409).json({ message: "Email already registered", code: "EMAIL_TAKEN" });
  }

  const user = userRepo.create({
    email: String(email).toLowerCase(),
    passwordHash: await hashPassword(password),
    role,
  });
  await userRepo.save(user);

  if (role === UserRole.TRADESPERSON) {
    const profileRepo = AppDataSource.getRepository(TradespersonProfile);
    await profileRepo.save(profileRepo.create({ userId: user.id }));
  }

  const token = signToken({ id: user.id, email: user.email, role: user.role });
  return res.status(201).json({ token, user: publicUser(user) });
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    return res.status(400).json({ message: "email and password are required" });
  }

  const user = await AppDataSource.getRepository(User).findOne({
    where: { email: String(email).toLowerCase() },
  });

  if (!user || !(await comparePassword(password, user.passwordHash))) {
    return res.status(401).json({ message: "Invalid email or password", code: "INVALID_CREDENTIALS" });
  }

  const token = signToken({ id: user.id, email: user.email, role: user.role });
  return res.json({ token, user: publicUser(user) });
}

export async function me(req: Request, res: Response) {
  const user = await AppDataSource.getRepository(User).findOne({
    where: { id: req.user!.id },
  });

  if (!user) {
    return res.status(401).json({ message: "User not found", code: "UNAUTHORIZED" });
  }

  return res.json({ user: publicUser(user) });
}
