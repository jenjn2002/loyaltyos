import { Link, Outlet } from "react-router-dom";

import { useProgramBranding } from "../../lib/system-branding";

import BottomNav, { NotificationBell } from "./bottom-nav";

export default function AppLayout() {
  const { systemName, logoUrl } = useProgramBranding();
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-surface)] text-[var(--color-text)]">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 pt-2">
        <Link to="/" title={systemName} className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
          {logoUrl && <img src={logoUrl} alt="" className="h-7 w-7 shrink-0 rounded object-contain" />}
          <span className="min-w-0 truncate">{systemName}</span>
        </Link>
        <div className="shrink-0"><NotificationBell /></div>
      </div>
      <main className="flex-1 pb-20">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
