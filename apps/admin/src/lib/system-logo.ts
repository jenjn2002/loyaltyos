const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_LOGO_DIMENSION = 256;
const MAX_ENCODED_LENGTH = 350_000;

export class SystemLogoError extends Error {
  constructor(public readonly notice: "logoInvalidType" | "logoTooLarge" | "logoError") {
    super(notice);
  }
}

/** Decode and rasterize uploads so SVG and the original file never become the saved logo. */
export function systemLogoFileToDataUrl(file: File): Promise<string> {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) return Promise.reject(new SystemLogoError("logoInvalidType"));
  if (file.size > MAX_FILE_BYTES) return Promise.reject(new SystemLogoError("logoTooLarge"));

  return new Promise((resolve, reject) => {
    const fail = (): void => reject(new SystemLogoError("logoError"));
    const reader = new FileReader();
    reader.onerror = fail;
    reader.onload = () => {
      const image = new Image();
      image.onerror = fail;
      image.onload = () => {
        try {
          if (!image.naturalWidth || !image.naturalHeight) return fail();
          const scale = Math.min(1, MAX_LOGO_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const context = canvas.getContext("2d");
          if (!context) return fail();
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const encoded = canvas.toDataURL("image/png");
          if (!encoded.startsWith("data:image/png;base64,") || encoded.length > MAX_ENCODED_LENGTH) return fail();
          resolve(encoded);
        } catch {
          fail();
        }
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
