import { useEffect } from "react";

import { DEFAULT_FAVICON_URL, useSystemBranding } from "@/lib/system-branding";

export function SystemBrandingTitle({ publicBranding = false }: { publicBranding?: boolean }): null {
  const { systemName, logoUrl } = useSystemBranding(publicBranding);

  useEffect(() => {
    document.title = `${systemName} Admin`;
  }, [systemName]);

  useEffect(() => {
    let favicon = document.querySelector<HTMLLinkElement>("link[data-system-favicon]");
    if (!favicon) {
      favicon = document.createElement("link");
      favicon.rel = "icon";
      favicon.dataset.systemFavicon = "";
      document.head.appendChild(favicon);
    }
    favicon.href = logoUrl || DEFAULT_FAVICON_URL;
    if (!logoUrl) favicon.type = "image/svg+xml";
    else if (logoUrl.startsWith("data:image/png;")) favicon.type = "image/png";
    else favicon.removeAttribute("type");
  }, [logoUrl]);

  return null;
}
