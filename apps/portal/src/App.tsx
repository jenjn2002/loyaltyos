import { type ReactNode, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { AutoFieldHelp } from "./components/auto-field-help";
import AppLayout from "./components/layout/app-layout";
import { bootstrapSession, isAuthenticated } from "./lib/auth";
import Badges from "./pages/badges";
import Credits from "./pages/credits";
import Home from "./pages/home";
import Notifications from "./pages/notifications";
import Profile from "./pages/profile";
import RewardDetail from "./pages/reward-detail";
import Rewards from "./pages/rewards";
import Transactions from "./pages/transactions";
import Verify from "./pages/verify";

function AuthGuard({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(isAuthenticated);

  useEffect(() => {
    const syncAuthentication = (): void => {
      setAuthenticated(isAuthenticated());
    };
    window.addEventListener("loyaltyos:auth-required", syncAuthentication);
    window.addEventListener("storage", syncAuthentication);
    return () => {
      window.removeEventListener("loyaltyos:auth-required", syncAuthentication);
      window.removeEventListener("storage", syncAuthentication);
    };
  }, []);

  if (!authenticated) {
    return <Navigate to="/profile" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  const [authReady, setAuthReady] = useState(isAuthenticated);

  useEffect(() => {
    if (isAuthenticated()) {
      setAuthReady(true);
      return;
    }
    void bootstrapSession().finally(() => {
      setAuthReady(true);
    });
  }, []);

  if (!authReady) {
    return <div className="min-h-screen bg-[var(--color-surface)]" />;
  }

  return (
    <>
      <AutoFieldHelp />
      <Routes>
        <Route path="/verify" element={<Verify />} />
        <Route element={<AppLayout />}>
          <Route path="/" element={<Home />} />
          <Route
            path="/transactions"
            element={
              <AuthGuard>
                <Transactions />
              </AuthGuard>
            }
          />
          <Route
            path="/credits"
            element={
              <AuthGuard>
                <Credits />
              </AuthGuard>
            }
          />
          <Route
            path="/notifications"
            element={
              <AuthGuard>
                <Notifications />
              </AuthGuard>
            }
          />
          <Route
            path="/rewards"
            element={
              <AuthGuard>
                <Rewards />
              </AuthGuard>
            }
          />
          <Route
            path="/rewards/:id"
            element={
              <AuthGuard>
                <RewardDetail />
              </AuthGuard>
            }
          />
          <Route
            path="/badges"
            element={
              <AuthGuard>
                <Badges />
              </AuthGuard>
            }
          />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}
