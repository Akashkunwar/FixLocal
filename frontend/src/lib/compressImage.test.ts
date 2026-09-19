import { afterEach, describe, expect, it, vi } from "vitest";
import { compressImageFile, UNSUPPORTED_IMAGE_MESSAGE } from "./compressImage";

function stubCanvas() {
  const ctx = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
  const toBlob = vi.fn((cb: (b: Blob | null) => void, type: string) => cb(new Blob(["re-encoded"], { type })));
  const real = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag !== "canvas") return real(tag);
    return { width: 0, height: 0, getContext: () => ctx, toBlob } as unknown as HTMLCanvasElement;
  });
  return { ctx, toBlob };
}

afterEach(() => vi.unstubAllGlobals());

describe("compressImageFile (M-12)", () => {
  it("re-encodes even a small JPEG so its metadata is dropped", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 40, height: 30, close: vi.fn() })));
    const { ctx, toBlob } = stubCanvas();
    const original = new File([new Uint8Array(500)], "tiny.jpeg", { type: "image/jpeg" });
    const out = await compressImageFile(original);
    expect(out).not.toBe(original);
    expect(out.name).toBe("tiny.jpg");
    expect(out.type).toBe("image/jpeg");
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.82);
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it("keeps PNGs as PNG (transparency) and scales large images down", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 3200, height: 1600, close: vi.fn() })));
    const { ctx } = stubCanvas();
    const out = await compressImageFile(new File(["x"], "shot.png", { type: "image/png" }));
    expect(out.type).toBe("image/png");
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 800);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it("gives a clear message for formats the browser can't decode (HEIC)", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => Promise.reject(new DOMException("bad", "InvalidStateError"))));
    await expect(compressImageFile(new File(["x"], "IMG_1.heic", { type: "image/heic" }))).rejects.toThrow(
      UNSUPPORTED_IMAGE_MESSAGE
    );
  });

  it("passes GIFs and non-images through untouched", async () => {
    const gif = new File(["x"], "a.gif", { type: "image/gif" });
    const pdf = new File(["x"], "a.pdf", { type: "application/pdf" });
    expect(await compressImageFile(gif)).toBe(gif);
    expect(await compressImageFile(pdf)).toBe(pdf);
  });
});
