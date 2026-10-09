import { useQuery } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";

import { configuredProgramId, fetchApi } from "./api-client";
import { isAuthenticated } from "./auth";

export const DEFAULT_SYSTEM_NAME = "LoyaltyOS";
export const DEFAULT_FAVICON_URL = `${import.meta.env.BASE_URL}favicon.svg`;

export interface ProgramBranding {
  systemName: string;
  logoUrl: string | null;
}

interface BrandingScope {
  authenticated: boolean;
  programId: string;
  memberId: string | null;
}

function brandingScope(): string {
  return JSON.stringify({
    authenticated: isAuthenticated(),
    programId: configuredProgramId(),
    memberId: sessionStorage.getItem("member-id"),
  });
}

function subscribeToSessionChanges(onChange: () => void): () => void {
  const events = ["storage", "focus", "loyaltyos:auth-required", "loyaltyos:auth-changed"];
  for (const event of events) window.addEventListener(event, onChange);
  return () => {
    for (const event of events) window.removeEventListener(event, onChange);
  };
}

export function normalizeSystemLogo(logoUrl: unknown): string | null {
  if (typeof logoUrl !== "string") return null;
  const value = logoUrl.trim();
  if (/^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/]+={0,2}$/i.test(value)) return value;
  try {
    const url = new URL(value);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !/\.svg$/i.test(url.pathname)) return value;
  } catch {
    // Ignore malformed or unsupported logo sources.
  }
  return null;
}

export function useProgramBranding(): ProgramBranding {
  const scope = JSON.parse(
    useSyncExternalStore(subscribeToSessionChanges, brandingScope),
  ) as BrandingScope;
  const branding = useQuery({
    queryKey: ["system-branding", scope.authenticated, scope.programId, scope.memberId],
    queryFn: ({ signal }) => fetchApi<{ systemName?: string | null; logoUrl?: string | null }>(
      scope.authenticated
        ? "/branding"
        : `/auth/branding?programId=${encodeURIComponent(scope.programId)}`,
      { signal },
    ),
    staleTime: 30_000,
    gcTime: 0,
    refetchOnWindowFocus: "always",
  });

  const name = branding.data?.systemName;
  return {
    systemName: typeof name === "string" && name.trim() ? name.trim() : DEFAULT_SYSTEM_NAME,
    logoUrl: normalizeSystemLogo(branding.data?.logoUrl),
  };
}

export function useSystemBranding(): string {
  return useProgramBranding().systemName;
}

export function useBrandingFavicon(logoUrl: string | null): void {
  useEffect(() => {
    let icon = document.querySelector<HTMLLinkElement>("link[data-system-favicon]");
    if (!icon) {
      icon = document.createElement("link");
      icon.rel = "icon";
      icon.dataset.systemFavicon = "";
      document.head.append(icon);
    }
    icon.href = logoUrl ?? DEFAULT_FAVICON_URL;
    if (!logoUrl) icon.type = "image/svg+xml";
    else if (logoUrl.startsWith("data:image/png;")) icon.type = "image/png";
    else icon.removeAttribute("type");
  }, [logoUrl]);
}
