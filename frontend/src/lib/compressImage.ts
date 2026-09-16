/** Client-side image compression via canvas — no extra deps. */
export async function compressImageFile(
  file: File,
  opts: { maxDim?: number; quality?: number; mime?: string } = {}
): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") {
    return file;
  }
  const maxDim = opts.maxDim ?? 1600;
  const quality = opts.quality ?? 0.82;
  const mime = opts.mime ?? "image/jpeg";

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1 && file.size < 400_000) {
      return file;
    }
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), mime, quality)
    );
    if (!blob || blob.size >= file.size) return file;

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
