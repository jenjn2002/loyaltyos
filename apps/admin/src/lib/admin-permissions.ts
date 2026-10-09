import { useQuery } from "@tanstack/react-query";

import { fetchApi } from "@/lib/api-client";

interface AdminPermissionProfile {
  id?: string;
  capabilities: Record<string, boolean>;
}

/** The API remains authoritative; this hook keeps read-only UI in sync with it. */
export function useAdminPermissions() {
  const profile = useQuery({
    queryKey: ["admin-me"],
    queryFn: () => fetchApi<AdminPermissionProfile>("/admin/me"),
    staleTime: 0,
    refetchOnMount: "always",
  });

  return {
    ...profile,
    can: (capability: string) => profile.data?.capabilities?.[capability] === true,
  };
}

export function useAdminCapability(capability: string): boolean {
  return useAdminPermissions().can(capability);
}
