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

export interface AdminActivityNotification {
  id: string;
  title: string;
  body: string;
  triggerEvent: string;
  actionUrl: string | null;
  createdAt: string;
  readAt: string | null;
}

interface AdminActivityResponse {
  items: AdminActivityNotification[];
  unreadCount: number;
}

interface AdminNotificationsContextValue {
  requests: AdminApprovalNotification[];
  unreadRequests: AdminApprovalNotification[];
  activities: AdminActivityNotification[];
  unreadActivities: AdminActivityNotification[];
  unreadCount: number;
  isReady: boolean;
  markRead: (id: string) => void;
  markUnread: (id: string) => void;
  markActivityRead: (id: string) => void;
  markActivityUnread: (id: string) => void;
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
  const approvalUnreadCount = useQuery({
    queryKey: ["admin", "approvals", "inbox", "unread-count"],
    queryFn: () => fetchApi<{ unreadCount: number }>("/admin/approvals/inbox/unread-count"),
    enabled: Boolean(admin.data?.id),
    refetchInterval: 30_000,
    retry: false,
  });
  const activity = useQuery({
    queryKey: ["admin", "notifications", "activity"],
    queryFn: () => fetchApi<AdminActivityResponse>("/admin/notifications/activity"),
    enabled: Boolean(admin.data?.id),
    refetchInterval: 30_000,
    retry: false,
  });
  const requests = approvals.data ?? [];
  const unreadRequests = requests.filter((request) => !request.isRead);
  const activities = activity.data?.items ?? [];
  const unreadActivities = activities.filter((item) => !item.readAt);
  const updateReadState = (ids: string[], isRead: boolean, all = false) => {
    const uniqueIds = [...new Set(ids)];
    if (!all && uniqueIds.length === 0) return;
    const idSet = new Set(uniqueIds);
    queryClient.setQueryData<AdminApprovalNotification[]>(["admin", "approvals", "inbox"], (current) =>
      current?.map((request) => (all || idSet.has(request.id)) ? { ...request, isRead } : request),
    );
    queryClient.setQueryData<{ unreadCount: number }>(["admin", "approvals", "inbox", "unread-count"], (current) => {
      if (!current) return current;
      if (all) return { unreadCount: isRead ? 0 : requests.length };
      const delta = uniqueIds.reduce((sum, id) => {
        const item = requests.find((request) => request.id === id);
        return sum + (item && item.isRead !== isRead ? (isRead ? -1 : 1) : 0);
      }, 0);
      return { unreadCount: Math.max(0, current.unreadCount + delta) };
    });
    void fetchApi("/admin/approvals/read-state", {
      method: "POST",
      body: JSON.stringify({ ids: uniqueIds, isRead, all }),
    }).catch(() => queryClient.invalidateQueries({ queryKey: ["admin", "approvals", "inbox"] }));
  };
  const updateActivityReadState = (ids: string[], isRead: boolean, all = false) => {
    const uniqueIds = [...new Set(ids)];
    if (!all && uniqueIds.length === 0) return;
    const idSet = new Set(uniqueIds);
    queryClient.setQueryData<AdminActivityResponse>(["admin", "notifications", "activity"], (current) => current
      ? {
          ...current,
          unreadCount: all ? (isRead ? 0 : current.items.length) : Math.max(0, current.unreadCount + uniqueIds.reduce((delta, id) => {
            const item = current.items.find((entry) => entry.id === id);
            return delta + (item && Boolean(item.readAt) !== isRead ? (isRead ? -1 : 1) : 0);
          }, 0)),
          items: current.items.map((item) => (all || idSet.has(item.id))
            ? { ...item, readAt: isRead ? new Date().toISOString() : null }
            : item),
        }
      : current,
    );
    void fetchApi("/admin/notifications/activity/read-state", {
      method: "POST",
      body: JSON.stringify({ ids: uniqueIds, isRead, all }),
    }).catch(() => queryClient.invalidateQueries({ queryKey: ["admin", "notifications", "activity"] }));
  };
  const value = useMemo<AdminNotificationsContextValue>(
    () => ({
      requests,
      unreadRequests,
      activities,
      unreadActivities,
      unreadCount: (approvalUnreadCount.data?.unreadCount ?? unreadRequests.length) + (activity.data?.unreadCount ?? unreadActivities.length),
      isReady: Boolean(admin.data?.id && (approvals.isSuccess || activity.isSuccess)),
      markRead: (id) => updateReadState([id], true),
      markUnread: (id) => updateReadState([id], false),
      markActivityRead: (id) => updateActivityReadState([id], true),
      markActivityUnread: (id) => updateActivityReadState([id], false),
      markAllRead: () => {
        updateReadState([], true, true);
        updateActivityReadState([], true, true);
      },
    }),
    [admin.data?.id, approvals.isSuccess, activity.isSuccess, activity.data?.unreadCount, approvalUnreadCount.data?.unreadCount, activities, unreadActivities, requests, unreadRequests],
  );

  return <AdminNotificationsContext.Provider value={value}>{children}</AdminNotificationsContext.Provider>;
}

export function useAdminNotifications(): AdminNotificationsContextValue {
  const value = useContext(AdminNotificationsContext);
  if (!value) throw new Error("useAdminNotifications must be used inside AdminNotificationsProvider");
  return value;
}
