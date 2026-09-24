import { ui } from "@/lib/ui-text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useState } from "react";

import { fetchApi } from "../lib/api-client";

interface NotificationItem {
  id: string;
  subject: string | null;
  body: string | null;
  status: string;
  createdAt: string;
}

interface NotificationPage {
  items: NotificationItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

function NotificationBody({ body }: { body: string }) {
  const parsed = /<\/?[a-z][^>]*>/i.test(body)
    ? new DOMParser().parseFromString(body, "text/html")
    : null;
  const text = parsed?.body.textContent?.replace(/\s+/g, " ").trim() ?? body;
  const href = parsed?.querySelector<HTMLAnchorElement>("a[href]")?.getAttribute("href");
  const safeHref = href && /^https?:\/\//i.test(href) ? href : null;

  return (
    <>
      <p className="mt-1">{text}</p>
      {safeHref && (
        <a href={safeHref} target="_blank" rel="noreferrer" className="mt-2 inline-flex font-semibold text-[var(--color-primary)] underline">{ui("Open notification")}</a>
      )}
    </>
  );
}

export default function Notifications() {
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const notifications = useQuery({
    queryKey: ["notifications", "me", page],
    queryFn: () => fetchApi<NotificationPage>(`/members/me/notifications?page=${String(page)}&pageSize=10`),
  });
  const unreadSummary = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => fetchApi<{ unreadCount: number }>("/members/me/notifications/unread-count"),
    refetchInterval: 30_000,
  });
  const data = notifications.data;
  const updateReadState = useMutation({
    mutationFn: ({ id, read }: { id: string; read: boolean }) =>
      fetchApi<NotificationItem>("/members/me/notifications/" + id, {
        method: "PATCH",
        body: JSON.stringify({ read }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["notifications", "me"] });
      await queryClient.invalidateQueries({ queryKey: ["notifications", "unread-count"] });
    },
  });
  const markAllRead = useMutation({
    mutationFn: () =>
      fetchApi<{ markedRead: number }>("/members/me/notifications/read-all", { method: "POST" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["notifications", "me"] });
      await queryClient.invalidateQueries({ queryKey: ["notifications", "unread-count"] });
    },
  });
  const unreadCount = unreadSummary.data?.unreadCount ?? data?.items.filter((item) => item.status !== "READ").length ?? 0;

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-4 py-6 pb-20">
      <header>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[var(--color-primary)]">
            <Bell className="h-5 w-5" aria-hidden="true" />
            <p className="text-sm font-medium">{ui("Updates")}</p>
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              className="text-xs font-semibold text-[var(--color-primary)] underline"
              disabled={markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
            >
              {ui("Mark all as read")}
            </button>
          )}
        </div>
        <h1 className="mt-1 text-2xl font-bold">{ui("Notifications")}</h1>
        {unreadCount > 0 && <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{unreadCount} {ui("unread")}</p>}
      </header>

      {notifications.isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-xl bg-[var(--color-surface-secondary)]" />)}</div>
      ) : notifications.isError ? (
        <p role="alert" className="rounded-xl bg-[var(--color-surface-secondary)] p-4 text-sm">{ui("Unable to load notifications.")}</p>
      ) : (
        <>
          <div className="space-y-3">
            {(data?.items ?? []).map((item) => {
              const unread = item.status !== "READ";
              return (
                <article
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  className={"rounded-xl border p-4 text-sm transition-colors " + (unread ? "border-[var(--color-primary)] bg-[var(--color-surface-secondary)]" : "border-[var(--color-border)] bg-[var(--color-surface-secondary)]")}
                  onClick={() => {
                    if (unread) updateReadState.mutate({ id: item.id, read: true });
                  }}
                  onKeyDown={(event) => {
                    if ((event.key === "Enter" || event.key === " ") && unread) {
                      event.preventDefault();
                      updateReadState.mutate({ id: item.id, read: true });
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="flex items-center gap-2 font-semibold">
                      {unread && <span className="h-2 w-2 rounded-full bg-red-600" aria-label={ui("Unread")} />}
                      {item.subject ?? "LoyaltyOS update"}
                    </h2>
                    <button
                      type="button"
                      className="shrink-0 text-xs font-semibold text-[var(--color-primary)] underline"
                      onClick={(event) => {
                        event.stopPropagation();
                        updateReadState.mutate({ id: item.id, read: unread });
                      }}
                    >
                      {unread ? ui("Mark as read") : ui("Mark as unread")}
                    </button>
                  </div>
                  {item.body && <NotificationBody body={item.body} />}
                  <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{new Date(item.createdAt).toLocaleString()}</p>
                </article>
              );
            })}
            {(data?.items ?? []).length === 0 && <p className="py-12 text-center text-sm text-[var(--color-text-secondary)]">{ui("No notifications.")}</p>}
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--color-text-secondary)]">Page {data?.page ?? page} / {data?.totalPages ?? 1} · {data?.total ?? 0} total</span>
            <div className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 disabled:opacity-40">{ui("Previous")}</button>
              <button type="button" disabled={page >= (data?.totalPages ?? 1)} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 disabled:opacity-40">{ui("Next")}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
