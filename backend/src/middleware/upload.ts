import crypto from "crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import multer from "multer";
import { ensureUploadDirs, removeTempFiles, tmpDir } from "../services/files";
import { badRequest } from "../http/errors";

const MB = 1024 * 1024;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureUploadDirs();
    cb(null, tmpDir());
  },
  // Temp names are random; the final name is chosen after the content is verified.
  filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.upload`),
});

type Accept = "images" | "images_or_pdf";

function declaredTypeFilter(accept: Accept) {
  return (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const ok =
      file.mimetype.startsWith("image/") || (accept === "images_or_pdf" && file.mimetype === "application/pdf");
    if (ok) cb(null, true);
    else cb(badRequest(accept === "images" ? "Only JPG, PNG or WebP images are allowed" : "Only JPG, PNG, WebP or PDF files are allowed", "UNSUPPORTED_FILE"));
  };
}

function build(
  accept: Accept,
  fields: { name: string; maxCount: number }[],
  maxFiles: number
): RequestHandler {
  const handler = multer({
    storage,
    limits: { fileSize: 5 * MB, files: maxFiles, fields: 30, fieldSize: 64 * 1024, parts: maxFiles + 30 },
    fileFilter: declaredTypeFilter(accept),
  }).fields(fields);
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, async (err?: unknown) => {
      if (err) {
        await removeTempFiles(filesOf(req));
        return next(err);
      }
      // If the request fails later, don't leave temp files behind.
      res.on("finish", () => void removeTempFiles(filesOf(req)));
      next();
    });
  };
}

/** Only accepts multipart bodies; JSON requests pass straight through. */
export function optionalMultipart(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    if (!String(req.headers["content-type"] || "").includes("multipart/form-data")) return next();
    return handler(req, res, next);
  };
}

export function filesOf(req: Request, field?: string): Express.Multer.File[] {
  const f = req.files as Record<string, Express.Multer.File[]> | Express.Multer.File[] | undefined;
  if (!f) return [];
  if (Array.isArray(f)) return field ? f.filter((x) => x.fieldname === field) : f;
  if (field) return f[field] || [];
  return Object.values(f).flat();
}

export const uploadJobPhotos = build("images_or_pdf", [{ name: "photos", maxCount: 5 }], 5);
export const uploadGalleryPhotos = build("images", [{ name: "photos", maxCount: 8 }], 8);
export const uploadEvidence = build("images_or_pdf", [{ name: "evidence", maxCount: 5 }], 5);
export const uploadCompletionPhotos = build(
  "images",
  [
    { name: "before", maxCount: 4 },
    { name: "after", maxCount: 4 },
  ],
  8
);
export const uploadMessageAttachments = build(
  "images_or_pdf",
  [
    { name: "attachments", maxCount: 4 },
    { name: "quoteAttachment", maxCount: 1 },
  ],
  5
);
export const uploadQuoteAttachment = build("images_or_pdf", [{ name: "quoteAttachment", maxCount: 1 }], 1);
export const uploadSingleImage = build("images", [{ name: "file", maxCount: 1 }], 1);
export const uploadLicenseDoc = build("images_or_pdf", [{ name: "file", maxCount: 1 }], 1);
