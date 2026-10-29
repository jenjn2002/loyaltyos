function copyWithExecCommand(text: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;

  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return document.execCommand("copy");
  } finally {
    textarea.remove();
    activeElement?.focus({ preventScroll: true });
  }
}

export async function copyText(text: string): Promise<void> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;

  if (globalThis.isSecureContext && clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return;
    } catch {
      // Fall back for browsers that expose the API but deny clipboard access.
    }
  }

  // This fallback runs synchronously within the click handler, which is useful
  // on HTTP origins where the async Clipboard API is unavailable.
  if (copyWithExecCommand(text)) return;

  if (clipboard?.writeText) {
    await clipboard.writeText(text);
    return;
  }

  throw new Error("Clipboard access is unavailable in this browser.");
}
