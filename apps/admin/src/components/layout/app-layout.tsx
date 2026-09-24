import { Bell } from "lucide-react";
import { useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";

import { ui } from "@/lib/ui-text";

import {
  AdminNotificationsProvider,
  useAdminNotifications,
} from "./admin-notification-context";
import { Sidebar } from "./sidebar";

export function AppLayout(): JSX.Element {
  return (
    <AdminNotificationsProvider>
      <AdminLayoutContent />
    </AdminNotificationsProvider>
  );
}

function AdminLayoutContent(): JSX.Element {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { requests, unreadRequests, unreadCount, markRead, markUnread, markAllRead } = useAdminNotifications();

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="ml-64 flex-1 p-8">
        <div className="relative mb-6 flex justify-end">
          <button
            type="button"
            className="relative rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label={ui("Admin notifications")}
            title={ui("Admin notifications")}
            onClick={() => setOpen((current) => !current)}
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-4 text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>
          {open && (
            <div className="absolute right-0 top-11 z-50 w-[min(26rem,calc(100vw-2rem))] rounded-md border bg-background p-3 shadow-lg">
              <div className="flex items-center justify-between gap-3 border-b pb-2">
                <p className="font-semibold">{ui("Admin notifications")}</p>
                {unreadCount > 0 && (
                  <button type="button" className="text-xs text-primary underline" onClick={markAllRead}>
                    {ui("Mark all as read")}
                  </button>
                )}
              </div>
              <div className="mt-2 max-h-80 space-y-2 overflow-y-auto">
                {requests.length === 0 && <p className="p-3 text-sm text-muted-foreground">{ui("No approval notifications.")}</p>}
                {requests.map((request) => {
                  const unread = unreadRequests.some((item) => item.id === request.id);
                  return (
                    <div key={request.id} className={"rounded-md border p-3 text-left " + (unread ? "border-red-300 bg-red-50/50" : "")}>
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => {
                          markRead(request.id);
                          setOpen(false);
                          navigate("/approvals?request=" + encodeURIComponent(request.id));
                        }}
                      >
                        <p className="font-medium">{request.workflow.name}</p>
                        <p className="text-xs text-muted-foreground">{request.actionKey} · {request.subjectType}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{new Date(request.requestedAt).toLocaleString()}</p>
                      </button>
                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          className="text-xs text-primary underline"
                          onClick={() => (unread ? markRead(request.id) : markUnread(request.id))}
                        >
                          {unread ? ui("Mark as read") : ui("Mark as unread")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <Outlet />
      </main>
    </div>
  );
}
