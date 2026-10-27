import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import type { Readable } from "stream";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { config, type AppConfig } from "../config";

/**
 * Where stored files live. `local` (default) is a directory on the API host, fine for one server.
 * `s3` is any S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2, MinIO), needed once more
 * than one API instance serves uploads. Files are always streamed through the API, so access
 * control (public kinds, signed URLs, bearer checks) is the same for both.
 */
export interface BlobStore {
  readonly driver: "local" | "s3";
  /** Move a finished temp file into storage under `name` (the temp file is gone afterwards). */
  putFile(name: string, tempPath: string, mime: string): Promise<void>;
  /** A readable stream of the file, or null when it doesn't exist. */
  open(name: string): Promise<{ body: Readable; size: number | null } | null>;
  exists(name: string): Promise<boolean>;
  remove(name: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
}

export class LocalStore implements BlobStore {
  readonly driver = "local" as const;
  constructor(private readonly dir: string) {}

  private file(name: string) {
    return path.join(this.dir, name);
  }

  async putFile(name: string, tempPath: string) {
    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.rename(tempPath, this.file(name));
  }

  async open(name: string) {
    const stat = await fsp.stat(this.file(name)).catch(() => null);
    if (!stat?.isFile()) return null;
    return { body: fs.createReadStream(this.file(name)), size: stat.size };
  }

  async exists(name: string) {
    return !!(await fsp.stat(this.file(name)).catch(() => null))?.isFile();
  }

  async remove(name: string) {
    await fsp.rm(this.file(name), { force: true });
  }

  async copy(from: string, to: string) {
    await fsp.copyFile(this.file(from), this.file(to));
  }
}

type S3Settings = NonNullable<AppConfig["s3"]>;

export class S3Store implements BlobStore {
  readonly driver = "s3" as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(s3: S3Settings) {
    this.bucket = s3.bucket;
    this.prefix = s3.prefix;
    this.client = new S3Client({
      region: s3.region,
      endpoint: s3.endpoint || undefined,
      forcePathStyle: s3.forcePathStyle,
      // Omit keys to use the SDK's default chain (instance role, env, shared config).
      credentials: s3.accessKeyId && s3.secretAccessKey
        ? { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey }
        : undefined,
    });
  }

  private key(name: string) {
    return `${this.prefix}${name}`;
  }

  async putFile(name: string, tempPath: string, mime: string) {
    const body = await fsp.readFile(tempPath);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: this.key(name), Body: body, ContentType: mime })
    );
    await fsp.rm(tempPath, { force: true });
  }

  async open(name: string) {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(name) }));
      if (!out.Body) return null;
      return { body: out.Body as Readable, size: out.ContentLength ?? null };
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  async exists(name: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(name) }));
      return true;
    } catch (err) {
      if (isMissing(err)) return false;
      throw err;
    }
  }

  async remove(name: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(name) }));
  }

  async copy(from: string, to: string) {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: this.key(to),
        CopySource: `${this.bucket}/${encodeURIComponent(this.key(from))}`,
      })
    );
  }
}

function isMissing(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404;
}

let cached: { key: string; store: BlobStore } | null = null;

/** The configured store (rebuilt if the config changes, e.g. between tests). */
export function blobStore(): BlobStore {
  const cfg = config();
  const key = cfg.storageDriver === "s3" ? `s3:${JSON.stringify(cfg.s3)}` : `local:${cfg.uploadsDir}`;
  if (cached?.key !== key) {
    cached = { key, store: cfg.storageDriver === "s3" && cfg.s3 ? new S3Store(cfg.s3) : new LocalStore(cfg.uploadsDir) };
  }
  return cached.store;
}
