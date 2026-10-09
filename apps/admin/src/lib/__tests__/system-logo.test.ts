// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { systemLogoFileToDataUrl } from "../system-logo";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("system logo uploads", () => {
  it("rejects SVG and files larger than 5 MB before decoding", async () => {
    await expect(systemLogoFileToDataUrl(new File(["<svg />"], "logo.svg", { type: "image/svg+xml" })))
      .rejects.toMatchObject({ notice: "logoInvalidType" });
    await expect(systemLogoFileToDataUrl(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "logo.png", { type: "image/png" })))
      .rejects.toMatchObject({ notice: "logoTooLarge" });
  });

  it("rasterizes accepted images to PNG and limits their longest side to 256 pixels", async () => {
    class DecodedImage {
      naturalWidth = 1024;
      naturalHeight = 512;
      onload: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal("Image", DecodedImage);
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const encode = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,encoded");
    await expect(systemLogoFileToDataUrl(new File(["image"], "logo.gif", { type: "image/gif" })))
      .resolves.toBe("data:image/png;base64,encoded");
    expect(drawImage).toHaveBeenCalledWith(expect.any(DecodedImage), 0, 0, 256, 128);
    expect(encode).toHaveBeenCalledWith("image/png");
  });

  it("rejects an encoded logo exceeding the API size limit", async () => {
    class DecodedImage {
      naturalWidth = 256;
      naturalHeight = 256;
      onload: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal("Image", DecodedImage);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(`data:image/png;base64,${"A".repeat(350_000)}`);
    await expect(systemLogoFileToDataUrl(new File(["image"], "logo.png", { type: "image/png" })))
      .rejects.toMatchObject({ notice: "logoError" });
  });
});
