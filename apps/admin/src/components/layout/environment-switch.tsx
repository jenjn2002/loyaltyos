import { ArrowLeftRight, LoaderCircle } from "lucide-react";
import { useState } from "react";

import { fetchApi } from "@/lib/api-client";

const environment = import.meta.env.VITE_LOYALTYOS_ENVIRONMENT ?? "production";
const switchUrl = import.meta.env.VITE_LOYALTYOS_SWITCH_URL as string | undefined;

export function EnvironmentSwitch(): JSX.Element | null {
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!switchUrl) return null;

  const sandbox = environment === "sandbox";
  const destination = sandbox ? "production" : "sandbox";

  const switchEnvironment = async (): Promise<void> => {
    setSwitching(true);
    setError(null);
    try {
      const result = await fetchApi<{ ticket: string; returnTo: string }>("/auth/environment-handoff", {
        method: "POST",
        body: JSON.stringify({
          kind: "admin",
          target: destination,
          returnTo: `${window.location.pathname}${window.location.search}`,
        }),
      });
      const target = new URL(switchUrl);
      const returnUrl = new URL(result.returnTo, target.origin);
      target.pathname = returnUrl.pathname;
      target.search = returnUrl.search;
      target.hash = `loyaltyos-handoff=${encodeURIComponent(result.ticket)}`;
      window.location.assign(target.toString());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to switch environment.");
      setSwitching(false);
    }
  };

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => void switchEnvironment()}
        disabled={switching}
        className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-xs font-semibold transition-colors disabled:opacity-60 ${sandbox ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" : "border-red-200 bg-red-50 text-red-900 hover:bg-red-100 dark:border-red-900 dark:bg-red-950 dark:text-red-200"}`}
        aria-label={`Switch to ${destination}`}
      >
        {switching ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ArrowLeftRight className="h-3.5 w-3.5" />}
        <span className="flex-1">{sandbox ? "SANDBOX · Switch to production" : "PRODUCTION · Switch to sandbox"}</span>
      </button>
      {error && <p role="alert" className="px-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
