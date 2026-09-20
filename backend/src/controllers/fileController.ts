import fs from "fs";
import path from "path";
import type { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { Upload } from "../entities/Upload";
import { verifyAccessToken } from "../auth/tokens";
import { getAuthState } from "../auth/authState";
import { canAccessUpload, type Viewer } from "../policies/jobPolicy";
import { PUBLIC_KINDS, uploadsDir, verifySignedUrl } from "../services/files";
import { forbidden, notFound, unauthorized } from "../http/errors";

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

async function bearerViewer(req: Request): Promise<Viewer | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const claims = verifyAccessToken(header.slice(7));
    const state = await getAuthState(claims.sub);
    if (!state || state.deleted || state.isSuspended || state.tokenVersion !== claims.tv) return null;
    return { id: state.id, role: state.role, proVerified: state.proVerified };
  } catch {
    return null;
  }
}

/**
 * Serves stored files. Public kinds (gallery, avatars, published case studies) are open;
 * everything else needs a signed URL issued with the entity, or a bearer token with access.
 */
export async function serveFile(req: Request, res: Response) {
  const name = String(req.params.name || "");
  if (!NAME_RE.test(name)) throw notFound("File not found");
  const upload = await AppDataSource.getRepository(Upload).findOne({ where: { name } });
  if (!upload) throw notFound("File not found");

  let allowed = PUBLIC_KINDS.has(upload.kind) || verifySignedUrl(name, req.query.exp, req.query.sig);
  if (!allowed) {
    const viewer = await bearerViewer(req);
    if (!viewer) throw unauthorized("Sign in to view this file");
    allowed = await canAccessUpload(upload, viewer);
    if (!allowed) throw forbidden("You don't have access to this file");
  }

  const filePath = path.join(uploadsDir(), name);
  if (!fs.existsSync(filePath)) throw notFound("File not found");

  const isPdf = upload.mime === "application/pdf";
  const isImage = upload.mime.startsWith("image/") && upload.mime !== "image/svg+xml";
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader(
    "Cache-Control",
    PUBLIC_KINDS.has(upload.kind) ? "public, max-age=86400" : "private, max-age=3600"
  );
  res.setHeader("Content-Type", isImage || isPdf ? upload.mime : "application/octet-stream");
  const downloadName = (upload.originalName || name).replace(/[^A-Za-z0-9._ -]/g, "_");
  res.setHeader(
    "Content-Disposition",
    `${isImage ? "inline" : "attachment"}; filename="${downloadName}"`
  );
  res.sendFile(filePath);
}
