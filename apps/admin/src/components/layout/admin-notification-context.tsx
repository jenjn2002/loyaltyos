import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { fetchApi } from "@/lib/api-client";

export interface AdminApprovalNotification {
  id: string;
  actionKey: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  subjectType: string;
  subjectId: string;
  requestedAt: string;
  workflow: { name: string };
}

interface AdminNotificationsContextValue {
  requests: AdminApprovalNotification[];
  unreadRequests: AdminApprovalNotification[];
  unreadCount: number;
  markRead: (id: string) => void;
  markUnread: (id: string) => void;
  markAllRead: () => void;
}

const AdminNotificationsContext = createContext<AdminNotificationsContextValue | null>(null);

export function AdminNotificationsProvider({ children }: { children: ReactNode }): JSX.Element {
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
  const storageKey = admin.data?.id
    ? "loyaltyos:admin-approval-read:" + admin.data.id
    : null;
  const [readIds, setReadIds] = useState<string[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as unknown;
      setReadIds(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
    } catch {
      setReadIds([]);
    }
    setLoadedKey(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (storageKey && loadedKey === storageKey) {
      localStorage.setItem(storageKey, JSON.stringify(readIds));
    }
  }, [loadedKey, readIds, storageKey]);

  const requests = approvals.data ?? [];
  const readSet = useMemo(() => new Set(readIds), [readIds]);
  const unreadRequests = requests.filter((request) => !readSet.has(request.id));
  const value = useMemo<AdminNotificationsContextValue>(
    () => ({
      requests,
      unreadRequests,
      unreadCount: unreadRequests.length,
      markRead: (id) => setReadIds((current) => (current.includes(id) ? current : [...current, id])),
      markUnread: (id) => setReadIds((current) => current.filter((item) => item !== id)),
      markAllRead: () => setReadIds((current) => [...new Set([...current, ...requests.map((request) => request.id)])]),
    }),
    [requests, unreadRequests],
  );

  return <AdminNotificationsContext.Provider value={value}>{children}</AdminNotificationsContext.Provider>;
}

export function useAdminNotifications(): AdminNotificationsContextValue {
  const value = useContext(AdminNotificationsContext);
  if (!value) throw new Error("useAdminNotifications must be used inside AdminNotificationsProvider");
  return value;
}
