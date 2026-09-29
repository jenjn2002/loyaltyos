import { Bell, Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

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
  const [navigationOpen, setNavigationOpen] = useState(false);
  const location = useLocation();
  const { requests, unreadRequests, unreadCount, markRead, markUnread, markAllRead } = useAdminNotifications();

  useEffect(() => {
    setNavigationOpen(false);
    setOpen(false);
  }, [location.pathname, location.search]);

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="hidden lg:block"><Sidebar /></div>
      <main className="min-w-0 lg:ml-64">
        <header className="relative z-30 flex h-14 items-center justify-between gap-3 border-b bg-background px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Dialog open={navigationOpen} onOpenChange={setNavigationOpen}>
              <DialogTrigger asChild>
                <button type="button" className="rounded-md p-2 hover:bg-accent lg:hidden" aria-label={ui("Open navigation")}><Menu className="h-5 w-5" /></button>
              </DialogTrigger>
              <DialogContent className="left-0 top-0 h-dvh w-72 max-w-[calc(100vw-2rem)] translate-x-0 translate-y-0 gap-0 rounded-none p-0 sm:rounded-none" aria-describedby={undefined} onClick={(event) => { if (event.target instanceof Element && event.target.closest("a[href]")) setNavigationOpen(false); }}>
                <DialogTitle className="sr-only">{ui("Navigation")}</DialogTitle>
                <Sidebar embedded />
              </DialogContent>
            </Dialog>
            <p className="truncate text-sm font-medium text-muted-foreground">{ui("Administration")}</p>
          </div>
          <div className="relative">
          <button
            type="button"
            className="relative rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label={ui("Admin notifications")}
            title={ui("Admin notifications")}
            aria-expanded={open}
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
        </header>
        <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
