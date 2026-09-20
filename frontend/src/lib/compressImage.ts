/**
 * Client-side re-encode via canvas — no extra deps.
 * Every photo is redrawn (even small ones) so EXIF/GPS metadata never leaves
 * the device; the server strips it again regardless. GIFs pass through.
 */
export const UNSUPPORTED_IMAGE_MESSAGE = "This photo format isn't supported. Please upload a JPG, PNG or WebP image.";

export async function compressImageFile(
  file: File,
  opts: { maxDim?: number; quality?: number } = {}
): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") {
    return file;
  }
  const maxDim = opts.maxDim ?? 1600;
  const quality = opts.quality ?? 0.82;
  // PNG keeps transparency; everything else (incl. HEIC decoded by Safari) becomes JPEG.
  const mime = file.type === "image/png" ? "image/png" : "image/jpeg";

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(UNSUPPORTED_IMAGE_MESSAGE);
  }
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(UNSUPPORTED_IMAGE_MESSAGE);
    if (mime === "image/jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(bitmap, 0, 0, w, h);

    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), mime, quality));
    if (!blob) throw new Error(UNSUPPORTED_IMAGE_MESSAGE);

    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    const ext = mime === "image/png" ? "png" : "jpg";
    return new File([blob], `${base}.${ext}`, { type: mime, lastModified: Date.now() });
  } finally {
    bitmap.close?.();
  }
}

export async function compressImageFiles(files: FileList | File[]): Promise<File[]> {
  const list = Array.from(files);
  return Promise.all(list.map((f) => compressImageFile(f)));
}
