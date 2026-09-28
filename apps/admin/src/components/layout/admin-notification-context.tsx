import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { fetchApi } from "@/lib/api-client";

export interface AdminApprovalNotification {
  id: string;
  actionKey: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  subjectType: string;
  subjectId: string;
  requestedAt: string;
  isRead: boolean;
  workflow: { name: string };
}

interface AdminNotificationsContextValue {
  requests: AdminApprovalNotification[];
  unreadRequests: AdminApprovalNotification[];
  unreadCount: number;
  isReady: boolean;
  markRead: (id: string) => void;
  markUnread: (id: string) => void;
  markAllRead: () => void;
}

const AdminNotificationsContext = createContext<AdminNotificationsContextValue | null>(null);

export function AdminNotificationsProvider({ children }: { children: ReactNode }): JSX.Element {
  const queryClient = useQueryClient();
  const admin = useQuery({
    queryKey: ["admin-me"],
    queryFn: () => fetchApi<{ id: string }>("/admin/me"),
  });
  const approvals = useQuery({
    queryKey: ["admin", "approvals", "inbox"],
    queryFn: () => fetchApi<AdminApprovalNotification[]>("/admin/approvals/inbox"),
    enabled: Boolean(admin.data?.id),
    refetchInterval: 30_000,
    retry: false,
  });
  const requests = approvals.data ?? [];
  const unreadRequests = requests.filter((request) => !request.isRead);
  const updateReadState = (ids: string[], isRead: boolean) => {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return;
    const idSet = new Set(uniqueIds);
    queryClient.setQueryData<AdminApprovalNotification[]>(["admin", "approvals", "inbox"], (current) =>
      current?.map((request) => idSet.has(request.id) ? { ...request, isRead } : request),
    );
    void fetchApi("/admin/approvals/read-state", {
      method: "POST",
      body: JSON.stringify({ ids: uniqueIds, isRead }),
    }).catch(() => queryClient.invalidateQueries({ queryKey: ["admin", "approvals", "inbox"] }));
  };
  const value = useMemo<AdminNotificationsContextValue>(
    () => ({
      requests,
      unreadRequests,
      unreadCount: unreadRequests.length,
      isReady: Boolean(admin.data?.id && approvals.isSuccess),
      markRead: (id) => updateReadState([id], true),
      markUnread: (id) => updateReadState([id], false),
      markAllRead: () => updateReadState(requests.filter((request) => !request.isRead).map((request) => request.id), true),
    }),
    [admin.data?.id, approvals.isSuccess, requests, unreadRequests],
  );

  return <AdminNotificationsContext.Provider value={value}>{children}</AdminNotificationsContext.Provider>;
}

export function useAdminNotifications(): AdminNotificationsContextValue {
  const value = useContext(AdminNotificationsContext);
  if (!value) throw new Error("useAdminNotifications must be used inside AdminNotificationsProvider");
  return value;
}
