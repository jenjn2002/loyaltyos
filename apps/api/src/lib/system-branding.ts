import { createHash } from "node:crypto";

export const DEFAULT_SYSTEM_NAME = "LoyaltyOS";
export const MAX_SYSTEM_LOGO_LENGTH = 350_000;

// Uploaded logos are raster images, not HTML or active SVG documents.
export function isSystemLogoImage(value: string): boolean {
  if (value.length > MAX_SYSTEM_LOGO_LENGTH) return false;
  const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  const bytes = Buffer.from(match[2]!, "base64");
  if (bytes.toString("base64") !== match[2]) return false;
  switch (match[1]) {
    case "png":
      return bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        && bytes.toString("ascii", 12, 16) === "IHDR";
    case "jpeg":
      return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "gif":
      return bytes.length >= 13 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6));
    case "webp":
      return bytes.length >= 16 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    default:
      return false;
  }
}

function publicLogo(value: string | null | undefined): string | null {
  if (!value) return null;
  if (isSystemLogoImage(value)) return value;
  // Preserve safe URL-based program logos configured before image uploads existed.
  if (value.length <= 2048) {
    try {
      const url = new URL(value);
      if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) return value;
    } catch { /* An invalid or active-content URL is never exposed as a logo. */ }
  }
  return null;
}

type ProgramBranding = { systemName?: string | null; logoUrl?: string | null };

export function systemBrandingResponse(program: ProgramBranding | null) {
  return {
    systemName: program?.systemName?.trim() || DEFAULT_SYSTEM_NAME,
    logoUrl: publicLogo(program?.logoUrl),
  };
}

export function systemBrandingAudit(program: ProgramBranding) {
  return {
    systemName: program.systemName?.trim() || DEFAULT_SYSTEM_NAME,
    logoConfigured: Boolean(program.logoUrl),
    // Record changes without copying the image or a potentially private URL into Logs.
    logoHash: program.logoUrl ? createHash("sha256").update(program.logoUrl).digest("hex") : null,
  };
}
