import { useMutation, useQuery } from "@tanstack/react-query";
import { KeyRound, Loader2, Mail } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { getAuthMethods, loginWithPassword, startMicrosoftLogin } from "../lib/auth";

export function MemberLoginForm(): JSX.Element {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const methods = useQuery({
    queryKey: ["auth-methods"],
    queryFn: getAuthMethods,
    staleTime: 60_000,
  });
  const login = useMutation({
    mutationFn: () => loginWithPassword(username, password),
    onSuccess: () => {
      window.dispatchEvent(new CustomEvent("loyaltyos:auth-required"));
      window.location.reload();
    },
  });

  return (
    <div className="space-y-4">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (username.trim() && password) login.mutate();
        }}
      >
        <label className="block">
          <span className="text-sm font-medium">{t("username")}</span>
          <input
            name="username"
            autoComplete="username"
            required
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
            }}
            className="mt-1 block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">{t("password")}</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={10}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            className="mt-1 block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
          />
        </label>
        {login.isError && (
          <p role="alert" className="text-sm text-red-600">
            {login.error instanceof Error ? login.error.message : t("invalidCredentials")}
          </p>
        )}
        <p className="text-xs text-[var(--color-text-secondary)]">{t("passwordHelp")}</p>
        <button
          type="submit"
          disabled={login.isPending || !username.trim() || !password}
          className="w-full rounded-lg bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
        >
          {login.isPending ? (
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          ) : (
            <KeyRound className="mr-2 inline h-4 w-4" />
          )}
          {login.isPending ? t("signingIn") : t("signInWithPassword")}
        </button>
      </form>
      {methods.data?.microsoft && (
        <>
          <div className="flex items-center gap-3 text-xs text-[var(--color-text-secondary)]">
            <span className="h-px flex-1 bg-[var(--color-border)]" />
            <span>{t("or")}</span>
            <span className="h-px flex-1 bg-[var(--color-border)]" />
          </div>
          <button
            type="button"
            onClick={startMicrosoftLogin}
            className="w-full rounded-lg border border-[var(--color-border)] px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-[var(--color-surface)]"
          >
            <Mail className="mr-2 inline h-4 w-4" />
            {t("microsoftSignIn")}
          </button>
        </>
      )}
    </div>
  );
}
