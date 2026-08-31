import "reflect-metadata";
import "dotenv/config";
import { AppDataSource } from "../data-source";
import { User, UserRole } from "../entities/User";
import { TradespersonProfile } from "../entities/TradespersonProfile";
import { hashPassword } from "../utils/password";

const SEED_PASSWORD = process.env.SEED_PASSWORD || "Password123!";

const seeds: { email: string; role: UserRole }[] = [
  { email: "admin@fixlocal.local", role: UserRole.ADMIN },
  { email: "home@fixlocal.local", role: UserRole.HOMEOWNER },
  { email: "pro@fixlocal.local", role: UserRole.TRADESPERSON },
];

async function seed() {
  await AppDataSource.initialize();
  const userRepo = AppDataSource.getRepository(User);
  const profileRepo = AppDataSource.getRepository(TradespersonProfile);
  const passwordHash = await hashPassword(SEED_PASSWORD);

  for (const s of seeds) {
    let user = await userRepo.findOne({ where: { email: s.email } });
    if (user) {
      user.passwordHash = passwordHash;
      user.role = s.role;
      await userRepo.save(user);
      console.log(`Updated ${s.email} (${s.role})`);
    } else {
      user = await userRepo.save(
        userRepo.create({ email: s.email, passwordHash, role: s.role })
      );
      console.log(`Created ${s.email} (${s.role})`);
    }

    if (s.role === UserRole.TRADESPERSON) {
      const existing = await profileRepo.findOne({ where: { userId: user.id } });
      if (!existing) {
        await profileRepo.save(profileRepo.create({ userId: user.id }));
        console.log(`  + tradesperson profile for ${s.email}`);
      }
    }
  }

  console.log(`\nSeed password: ${SEED_PASSWORD}`);
  await AppDataSource.destroy();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
