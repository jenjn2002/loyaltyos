import { fetchApi } from "@/lib/api-client";
import { ui } from "@/lib/ui-text";

const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";

export type AttachmentContext = "PROJECT" | "CUSTOM_DOCUMENT";
export type PrivateAttachment = { id: string; name: string; mimeType: string; size: number };

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(ui("Unable to read the selected file.")));
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const comma = dataUrl.indexOf(",");
      if (comma < 0) reject(new Error(ui("Unable to encode the selected file.")));
      else resolve(dataUrl.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

export async function uploadPrivateAttachment(
  contextType: AttachmentContext,
  contextId: string,
  file: File,
): Promise<PrivateAttachment> {
  return fetchApi<PrivateAttachment>("/admin/attachments", {
    method: "POST",
    body: JSON.stringify({
      contextType,
      contextId,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      base64: await fileToBase64(file),
    }),
  });
}

export async function downloadPrivateAttachment(attachmentId: string, fileName: string): Promise<void> {
  const response = await fetch(`${API_URL}/admin/attachments/${encodeURIComponent(attachmentId)}`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error(ui("Unable to download the attached file."));

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName || ui("download");
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
