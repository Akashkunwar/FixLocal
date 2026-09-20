import bcrypt from "bcryptjs";

const ROUNDS = 12;
// Hash of a random string; used so unknown emails take as long as wrong passwords.
const DUMMY_HASH = bcrypt.hashSync("fixlocal-timing-equalizer", ROUNDS);

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  if (typeof plain !== "string" || typeof hash !== "string") return false;
  return bcrypt.compare(plain, hash);
}

export async function dummyCompare(plain: unknown): Promise<void> {
  await bcrypt.compare(typeof plain === "string" ? plain : "", DUMMY_HASH);
}
