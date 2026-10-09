import { useQuery } from "@tanstack/react-query";

import { configuredProgramId, fetchApi } from "@/lib/api-client";

export interface SystemBranding {
  systemName: string;
  logoUrl?: string | null;
}

export const DEFAULT_SYSTEM_NAME = "LoyaltyOS";
export const DEFAULT_FAVICON_URL = `${import.meta.env.BASE_URL}favicon.svg`;
export const SYSTEM_BRANDING_QUERY_KEY = ["system-branding"] as const;
export const AUTHENTICATED_BRANDING_QUERY_KEY = [...SYSTEM_BRANDING_QUERY_KEY, "authenticated"] as const;
export const ADMIN_BRANDING_QUERY_KEY = ["admin", "settings", "branding"] as const;

/** Signed-in pages use the session's program, rather than the login configuration. */
export function useSystemBranding(publicBranding = false) {
  const programId = publicBranding ? configuredProgramId() : undefined;
  const branding = useQuery({
    queryKey: publicBranding
      ? [...SYSTEM_BRANDING_QUERY_KEY, "public", programId]
      : AUTHENTICATED_BRANDING_QUERY_KEY,
    queryFn: () => fetchApi<SystemBranding>(publicBranding
      ? `/auth/branding?programId=${encodeURIComponent(programId ?? "")}`
      : "/branding"),
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });

  return {
    ...branding,
    systemName: branding.data?.systemName?.trim() || DEFAULT_SYSTEM_NAME,
    logoUrl: branding.data?.logoUrl || null,
  };
}
