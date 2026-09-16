import fs from "fs";
import path from "path";
import multer from "multer";

export const uploadsDir = path.join(process.cwd(), "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});

function imageOrPdfFilter(
  _req: unknown,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) {
  if (file.mimetype.startsWith("image/") || file.mimetype === "application/pdf") {
    cb(null, true);
  } else {
    cb(new Error("Only images or PDF allowed"));
  }
}

function imageOnlyFilter(
  _req: unknown,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only images allowed"));
  }
}

export const uploadJobPhotos = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: imageOrPdfFilter,
}).array("photos", 5);

export const uploadGalleryPhotos = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 8 },
  fileFilter: imageOnlyFilter,
}).array("photos", 8);

export const uploadEvidence = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: imageOrPdfFilter,
}).array("evidence", 5);

export const uploadCompletionPhotos = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 8 },
  fileFilter: imageOnlyFilter,
}).fields([
  { name: "before", maxCount: 4 },
  { name: "after", maxCount: 4 },
]);

/** Job chat: images or PDFs (max 4) + optional quote attachment. */
export const uploadMessageAttachments = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: imageOrPdfFilter,
}).fields([
  { name: "attachments", maxCount: 4 },
  { name: "quoteAttachment", maxCount: 1 },
]);

export function uploadedPaths(files: Express.Multer.File[] | undefined): string[] {
  if (!files?.length) return [];
  return files.map((f) => `/uploads/${f.filename}`);
}


/** Single quote/estimate attachment (image or PDF). */
export const uploadQuoteAttachment = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: imageOrPdfFilter,
}).single("quoteAttachment");
