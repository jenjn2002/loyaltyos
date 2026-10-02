import { Outlet } from "react-router-dom";

import BottomNav, { NotificationBell } from "./bottom-nav";

export default function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-surface)] text-[var(--color-text)]">
      <div className="mx-auto flex w-full max-w-3xl justify-end px-4 pt-2"><NotificationBell /></div>
      <main className="flex-1 pb-20">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
