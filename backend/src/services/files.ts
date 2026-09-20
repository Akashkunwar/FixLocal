import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import sharp from "sharp";
import type { EntityManager } from "typeorm";
import { In } from "typeorm";
import { AppDataSource } from "../data-source";
import { config } from "../config";
import { Upload, UploadKind } from "../entities/Upload";
import { badRequest } from "../http/errors";
import { UserRole } from "../entities/User";

export const PUBLIC_KINDS = new Set<UploadKind>([UploadKind.GALLERY, UploadKind.CASE_STUDY, UploadKind.AVATAR]);

const REF_RE = /^\/api\/files\/([A-Za-z0-9][A-Za-z0-9._-]{0,254})$/;

export type Sniffed = { mime: "image/jpeg" | "image/png" | "image/webp" | "application/pdf"; ext: string };

/** Identify a file from its first bytes; the client-declared type is never trusted. */
export function sniff(head: Buffer): Sniffed | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", ext: "png" };
  }
  if (head.length >= 12 && head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP") {
    return { mime: "image/webp", ext: "webp" };
  }
  if (head.length >= 5 && head.toString("ascii", 0, 5) === "%PDF-") {
    return { mime: "application/pdf", ext: "pdf" };
  }
  return null;
}

export function uploadsDir(): string {
  return config().uploadsDir;
}

export function tmpDir(): string {
  return path.join(uploadsDir(), ".tmp");
}

export function ensureUploadDirs() {
  fs.mkdirSync(tmpDir(), { recursive: true });
}

export function fileRef(name: string): string {
  return `/api/files/${name}`;
}

export function nameFromRef(ref: unknown): string | null {
  if (typeof ref !== "string") return null;
  const m = REF_RE.exec(ref.split("?")[0]);
  return m ? m[1] : null;
}

async function readHead(file: string, bytes = 16): Promise<Buffer> {
  const fh = await fsp.open(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

export async function removeTempFiles(files: Express.Multer.File[] | undefined) {
  await Promise.all((files || []).map((f) => fsp.rm(f.path, { force: true })));
}

export type StoreContext = {
  kind: UploadKind;
  ownerUserId: string;
  jobId?: string | null;
  threadTradespersonId?: string | null;
  bidId?: string | null;
  allowPdf?: boolean;
};

/**
 * Validate temp uploads by content, re-encode images (drops EXIF/GPS),
 * move them into place and register them. All-or-nothing.
 */
export async function storeUploads(
  files: Express.Multer.File[] | undefined,
  ctx: StoreContext,
  manager: EntityManager = AppDataSource.manager
): Promise<Upload[]> {
  const list = files || [];
  if (!list.length) return [];
  const prepared: { file: Express.Multer.File; sniffed: Sniffed }[] = [];
  for (const file of list) {
    const sniffed = sniff(await readHead(file.path));
    const allowed = sniffed && (sniffed.mime !== "application/pdf" || ctx.allowPdf);
    if (!sniffed || !allowed) {
      await removeTempFiles(list);
      throw badRequest(
        ctx.allowPdf
          ? `"${file.originalname}" is not a JPG, PNG, WebP or PDF file`
          : `"${file.originalname}" is not a JPG, PNG or WebP image`,
        "UNSUPPORTED_FILE"
      );
    }
    prepared.push({ file, sniffed });
  }

  const written: string[] = [];
  try {
    const rows: Upload[] = [];
    for (const { file, sniffed } of prepared) {
      const name = `${crypto.randomUUID()}.${sniffed.ext}`;
      const dest = path.join(uploadsDir(), name);
      let size: number;
      if (sniffed.mime === "application/pdf") {
        await fsp.rename(file.path, dest);
        size = (await fsp.stat(dest)).size;
      } else {
        const pipeline = sharp(file.path, { failOn: "error" })
          .rotate()
          .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true });
        const encoded =
          sniffed.mime === "image/png"
            ? pipeline.png({ compressionLevel: 9 })
            : sniffed.mime === "image/webp"
              ? pipeline.webp({ quality: 82 })
              : pipeline.jpeg({ quality: 82, mozjpeg: true });
        const info = await encoded.toFile(dest).catch(() => {
          throw badRequest(`"${file.originalname}" could not be read as an image`, "UNSUPPORTED_FILE");
        });
        size = info.size;
        await fsp.rm(file.path, { force: true });
      }
      written.push(dest);
      rows.push(
        manager.create(Upload, {
          name,
          ownerUserId: ctx.ownerUserId,
          kind: ctx.kind,
          jobId: ctx.jobId ?? null,
          threadTradespersonId: ctx.threadTradespersonId ?? null,
          bidId: ctx.bidId ?? null,
          mime: sniffed.mime,
          size,
          originalName: file.originalname.slice(0, 255),
        })
      );
    }
    return await manager.save(rows);
  } catch (err) {
    await Promise.all(written.map((p) => fsp.rm(p, { force: true })));
    await removeTempFiles(list);
    throw err;
  }
}

export async function findUploadByRef(ref: string): Promise<Upload | null> {
  const name = nameFromRef(ref);
  if (!name) return null;
  return AppDataSource.getRepository(Upload).findOne({ where: { name } });
}

/** Delete the file and its row (used when a reference is removed). */
export async function deleteUploadByRef(ref: string): Promise<void> {
  const name = nameFromRef(ref);
  if (!name) return;
  await AppDataSource.getRepository(Upload).delete({ name });
  await fsp.rm(path.join(uploadsDir(), name), { force: true });
}

/** Remove files written during a transaction that was rolled back. */
export async function discardFiles(refs: string[]): Promise<void> {
  await Promise.all(
    refs.map(async (ref) => {
      const name = nameFromRef(ref);
      if (name) await fsp.rm(path.join(uploadsDir(), name), { force: true });
    })
  );
}

/** Make a public copy (e.g. a completion photo published to a portfolio). */
export async function copyUploadAs(ref: string, kind: UploadKind, ownerUserId: string): Promise<string | null> {
  const src = await findUploadByRef(ref);
  if (!src) return null;
  const ext = path.extname(src.name) || "";
  const name = `${crypto.randomUUID()}${ext}`;
  await fsp.copyFile(path.join(uploadsDir(), src.name), path.join(uploadsDir(), name));
  await AppDataSource.getRepository(Upload).save(
    AppDataSource.getRepository(Upload).create({
      name,
      ownerUserId,
      kind,
      mime: src.mime,
      size: src.size,
      originalName: src.originalName,
    })
  );
  return fileRef(name);
}

/**
 * Client-supplied references must point at uploads this user owns, of the expected kinds.
 * External URLs are never accepted.
 */
export async function assertOwnedRefs(
  refs: string[],
  opts: { ownerUserId: string; kinds: UploadKind[]; role?: UserRole }
): Promise<void> {
  if (!refs.length) return;
  const names = refs.map((r) => nameFromRef(r));
  if (names.some((n) => !n)) throw badRequest("Only files uploaded to FixLocal can be referenced", "INVALID_FILE_REF");
  const rows = await AppDataSource.getRepository(Upload).find({ where: { name: In(names as string[]) } });
  const byName = new Map(rows.map((r) => [r.name, r]));
  for (const n of names as string[]) {
    const row = byName.get(n);
    const ownerOk = row && (row.ownerUserId === opts.ownerUserId || opts.role === UserRole.ADMIN);
    if (!row || !ownerOk || !opts.kinds.includes(row.kind)) {
      throw badRequest("A referenced file does not exist or is not yours", "INVALID_FILE_REF");
    }
  }
}

// ---- signed URLs (so <img> tags work without an Authorization header) ----

const SIGNED_WINDOW_SEC = 3600;

function signature(name: string, exp: number): string {
  return crypto.createHmac("sha256", config().fileUrlSecret).update(`${name}:${exp}`).digest("base64url");
}

/** Signed URL valid for at least an hour; the expiry is bucketed so browsers can cache it. */
export function signedUrl(ref: string | null | undefined, now = Date.now()): string | null {
  const name = nameFromRef(ref);
  if (!name) return null;
  const bucket = Math.ceil(now / 1000 / SIGNED_WINDOW_SEC) * SIGNED_WINDOW_SEC;
  const exp = bucket + SIGNED_WINDOW_SEC;
  return `${fileRef(name)}?exp=${exp}&sig=${signature(name, exp)}`;
}

export function publicUrl(ref: string | null | undefined): string | null {
  const name = nameFromRef(ref);
  return name ? fileRef(name) : null;
}

export function signedUrls(refs: unknown): string[] {
  if (!Array.isArray(refs)) return [];
  return refs.map((r) => signedUrl(r as string)).filter((u): u is string => !!u);
}

export function publicUrls(refs: unknown): string[] {
  if (!Array.isArray(refs)) return [];
  return refs.map((r) => publicUrl(r as string)).filter((u): u is string => !!u);
}

/** Strip query strings from URLs the client echoes back (e.g. signed URLs) to get the stored ref. */
export function normalizeRef(value: unknown): string | null {
  const name = nameFromRef(value);
  return name ? fileRef(name) : null;
}

export function verifySignedUrl(name: string, expRaw: unknown, sigRaw: unknown): boolean {
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || typeof sigRaw !== "string") return false;
  if (exp * 1000 < Date.now()) return false;
  const expected = Buffer.from(signature(name, exp));
  const given = Buffer.from(sigRaw);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
