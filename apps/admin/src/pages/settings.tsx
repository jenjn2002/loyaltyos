import { ui } from "@/lib/ui-text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, FlaskConical, Save, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { fetchApi } from "@/lib/api-client";

interface MicrosoftSettings {
  enabled: boolean;
  tenantId: string | null;
  clientId: string | null;
  clientSecretConfigured: boolean;
  clientSecretMasked: string | null;
  scopes: string[];
  autoProvisionMembers: boolean;
  configured: boolean;
  redirectUri: string;
  adminRedirectUri: string;
}

const DEFAULT_SCOPES = ["openid", "profile", "email"];

export function SettingsPage(): JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    enabled: false,
    tenantId: "",
    clientId: "",
    clientSecret: "",
    scopes: DEFAULT_SCOPES,
    autoProvisionMembers: true,
  });
  const [notice, setNotice] = useState<string | null>(null);
  const settings = useQuery({
    queryKey: ["admin", "settings", "microsoft"],
    queryFn: () => fetchApi<MicrosoftSettings>("/admin/settings/microsoft"),
  });

  useEffect(() => {
    if (!settings.data) return;
    setForm((current) => ({
      ...current,
      enabled: settings.data.enabled,
      tenantId: settings.data.tenantId ?? "",
      clientId: settings.data.clientId ?? "",
      scopes: settings.data.scopes,
      autoProvisionMembers: settings.data.autoProvisionMembers,
      clientSecret: "",
    }));
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () =>
      fetchApi<MicrosoftSettings>("/admin/settings/microsoft", {
        method: "PUT",
        body: JSON.stringify({
          enabled: form.enabled,
          tenantId: form.tenantId,
          clientId: form.clientId,
          ...(form.clientSecret ? { clientSecret: form.clientSecret } : {}),
          scopes: form.scopes,
          autoProvisionMembers: form.autoProvisionMembers,
        }),
      }),
    onSuccess: async () => {
      setForm((current) => ({ ...current, clientSecret: "" }));
      setNotice(t("settings.microsoft.saved"));
      await queryClient.invalidateQueries({ queryKey: ["admin", "settings", "microsoft"] });
    },
    onError: (error: Error) => {
      setNotice(error.message);
    },
  });

  const test = useMutation({
    mutationFn: () =>
      fetchApi<{ ok: boolean; issuer: string }>("/admin/settings/microsoft/test", {
        method: "POST",
      }),
    onSuccess: (data) => {
      setNotice(t("settings.microsoft.connectionValid", { issuer: data.issuer }));
    },
    onError: (error: Error) => {
      setNotice(error.message);
    },
  });

  const redirectUri = settings.data?.redirectUri ?? "";
  const adminRedirectUri = settings.data?.adminRedirectUri ?? "";

  function toggleScope(scope: string): void {
    setForm((current) => {
      const next = current.scopes.includes(scope)
        ? current.scopes.filter((item) => item !== scope)
        : [...current.scopes, scope];
      return { ...current, scopes: next };
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <ShieldCheck className="h-7 w-7" /> {t("settings.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.microsoft.pageDescription")}
        </p>
      </div>
      {notice && (
        <div role="status" className="rounded-md border bg-muted p-3 text-sm">
          {notice}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.microsoft.title")}</CardTitle>
          <CardDescription>{t("settings.microsoft.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="microsoft-enabled">{t("settings.microsoft.enabled")}</Label>
              <HelpTooltip label={t("settings.microsoft.enabledHelpLabel")}>
                {t("settings.microsoft.enabledHelp")}
              </HelpTooltip>
            </div>
            <Switch
              id="microsoft-enabled"
              checked={form.enabled}
              onCheckedChange={(enabled) => {
                setForm((current) => ({ ...current, enabled }));
              }}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="microsoft-tenant">{t("settings.microsoft.tenantId")}</Label>
                <HelpTooltip label={t("settings.microsoft.tenantIdHelpLabel")}>
                  {t("settings.microsoft.tenantIdHelp")}
                </HelpTooltip>
              </div>
              <Input
                id="microsoft-tenant"
                value={form.tenantId}
                onChange={(event) => {
                  setForm((current) => ({ ...current, tenantId: event.target.value }));
                }}
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="microsoft-client">{t("settings.microsoft.clientId")}</Label>
                <HelpTooltip label={t("settings.microsoft.clientIdHelpLabel")}>
                  {t("settings.microsoft.clientIdHelp")}
                </HelpTooltip>
              </div>
              <Input
                id="microsoft-client"
                value={form.clientId}
                onChange={(event) => {
                  setForm((current) => ({ ...current, clientId: event.target.value }));
                }}
                placeholder={ui("Application client ID")}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="microsoft-secret">{t("settings.microsoft.clientSecret")}</Label>
              <HelpTooltip label={t("settings.microsoft.clientSecretHelpLabel")}>
                {t("settings.microsoft.clientSecretHelp")}
              </HelpTooltip>
            </div>
            <Input
              id="microsoft-secret"
              type="password"
              autoComplete="new-password"
              value={form.clientSecret}
              onChange={(event) => {
                setForm((current) => ({ ...current, clientSecret: event.target.value }));
              }}
              placeholder={
                settings.data?.clientSecretConfigured
                  ? t("settings.microsoft.secretPlaceholderConfigured")
                  : t("settings.microsoft.secretPlaceholderRequired")
              }
            />
            {settings.data?.clientSecretConfigured && (
              <p className="text-xs text-muted-foreground">
                {t("settings.microsoft.secretConfigured", {
                  masked: settings.data.clientSecretMasked,
                })}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>{t("settings.microsoft.scopes")}</Label>
              <HelpTooltip label={t("settings.microsoft.scopesHelpLabel")}>
                {t("settings.microsoft.scopesHelp")}
              </HelpTooltip>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              {DEFAULT_SCOPES.map((scope) => (
                <label key={scope} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.scopes.includes(scope)}
                    onChange={() => {
                      toggleScope(scope);
                    }}
                  />
                  {scope}
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-start gap-2">
            <input
              id="microsoft-auto-provision"
              type="checkbox"
              checked={form.autoProvisionMembers}
              onChange={(event) => {
                setForm((current) => ({
                  ...current,
                  autoProvisionMembers: event.target.checked,
                }));
              }}
            />
            <div>
              <div className="flex items-center gap-2">
                <Label htmlFor="microsoft-auto-provision">
                  {t("settings.microsoft.autoProvisionMembers")}
                </Label>
                <HelpTooltip label={t("settings.microsoft.autoProvisionMembersHelpLabel")}>
                  {t("settings.microsoft.autoProvisionMembersHelp")}
                </HelpTooltip>
              </div>
            </div>
          </div>

          <div className="rounded-md bg-muted p-4 text-sm">
            <div className="mb-2 flex items-center gap-2 font-medium">
              {t("settings.microsoft.customerRedirectUri")}
              <HelpTooltip label={t("settings.microsoft.redirectUriHelpLabel")}>
                {t("settings.microsoft.redirectUriHelp")}
              </HelpTooltip>
            </div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all text-xs">
                {redirectUri || t("settings.microsoft.loading")}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (redirectUri) void navigator.clipboard.writeText(redirectUri);
                }}
              >
                <Copy className="mr-1 h-3.5 w-3.5" /> {t("settings.microsoft.copy")}
              </Button>
            </div>
            <div className="mt-4 border-t pt-4">
              <div className="mb-2 flex items-center gap-2 font-medium">
                {t("settings.microsoft.adminRedirectUri")}
              </div>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all text-xs">
                  {adminRedirectUri || t("settings.microsoft.loading")}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (adminRedirectUri) void navigator.clipboard.writeText(adminRedirectUri);
                  }}
                >
                  <Copy className="mr-1 h-3.5 w-3.5" /> {t("settings.microsoft.copy")}
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("settings.microsoft.adminRedirectUriHelp")}
              </p>
            </div>
          </div>

          <div className="rounded-md border p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{t("settings.microsoft.azureChecklist")}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>{t("settings.microsoft.registerApp")}</li>
              <li>{t("settings.microsoft.addRedirect")}</li>
              <li>{t("settings.microsoft.createSecret")}</li>
              <li>{t("settings.microsoft.linkIdentity")}</li>
            </ul>
          </div>

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button
              type="button"
              disabled={save.isPending}
              onClick={() => {
                save.mutate();
              }}
            >
              <Save className="mr-2 h-4 w-4" />
              {save.isPending ? t("settings.microsoft.saving") : t("settings.microsoft.save")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={test.isPending || !settings.data?.configured}
              onClick={() => {
                test.mutate();
              }}
            >
              <FlaskConical className="mr-2 h-4 w-4" />
              {test.isPending ? t("settings.microsoft.testing") : t("settings.microsoft.test")}
            </Button>
            {settings.data?.enabled && settings.data.configured && (
              <Badge className="gap-1" variant="default">
                <Check className="h-3 w-3" /> {t("settings.microsoft.enabledConfigured")}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
