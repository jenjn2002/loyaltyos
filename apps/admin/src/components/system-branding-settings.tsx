import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchApi } from "@/lib/api-client";
import {
  ADMIN_BRANDING_QUERY_KEY,
  AUTHENTICATED_BRANDING_QUERY_KEY,
  SYSTEM_BRANDING_QUERY_KEY,
  type SystemBranding,
} from "@/lib/system-branding";
import { SystemLogoError, systemLogoFileToDataUrl } from "@/lib/system-logo";

type BrandingNotice = "saved" | "required" | "tooLong" | "saveError" | SystemLogoError["notice"];
interface BrandingUpdate {
  systemName: string;
  logoUrl?: string | null;
}

export function SystemBrandingSettings({ canManage }: { canManage: boolean }): JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [logoDraft, setLogoDraft] = useState<string | null | undefined>(undefined);
  const [isProcessingLogo, setIsProcessingLogo] = useState(false);
  const processingLogo = useRef(false);
  const [notice, setNotice] = useState<BrandingNotice | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const branding = useQuery({
    queryKey: ADMIN_BRANDING_QUERY_KEY,
    queryFn: () => fetchApi<SystemBranding>("/admin/settings/branding"),
  });
  const systemName = draft ?? branding.data?.systemName ?? "";
  const logoUrl = logoDraft === undefined ? branding.data?.logoUrl ?? null : logoDraft;
  const save = useMutation({
    mutationFn: (update: BrandingUpdate) => fetchApi<SystemBranding>("/admin/settings/branding", {
      method: "PUT",
      body: JSON.stringify(update),
    }),
    onSuccess: (data) => {
      queryClient.setQueryData(ADMIN_BRANDING_QUERY_KEY, data);
      queryClient.setQueryData(AUTHENTICATED_BRANDING_QUERY_KEY, data);
      setDraft(null);
      setLogoDraft(undefined);
      setNotice("saved");
      void queryClient.invalidateQueries({ queryKey: SYSTEM_BRANDING_QUERY_KEY });
    },
    onError: (error: Error) => {
      setNotice("saveError");
      setServerError(error.message);
    },
  });
  const disabled = !canManage || branding.isPending || branding.isError || save.isPending || isProcessingLogo;

  async function handleLogoChange(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !canManage || !branding.data || save.isPending || processingLogo.current) return;
    processingLogo.current = true;
    setIsProcessingLogo(true);
    setNotice(null);
    setServerError(null);
    try {
      setLogoDraft(await systemLogoFileToDataUrl(file));
    } catch (error) {
      setNotice(error instanceof SystemLogoError ? error.notice : "logoError");
    } finally {
      processingLogo.current = false;
      setIsProcessingLogo(false);
    }
  }

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (!canManage || !branding.data || save.isPending || processingLogo.current) return;
    setServerError(null);
    const name = systemName.trim();
    if (!name) {
      setNotice("required");
      return;
    }
    if (name.length > 80) {
      setNotice("tooLong");
      return;
    }
    setNotice(null);
    save.mutate({ systemName: name, ...(logoDraft !== undefined ? { logoUrl: logoDraft } : {}) });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.branding.title")}</CardTitle>
        <CardDescription>{t("settings.branding.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="system-name">{t("settings.branding.systemName")}</Label>
            <Input
              id="system-name"
              value={systemName}
              disabled={disabled}
              aria-describedby="system-name-help"
              aria-invalid={notice === "required" || notice === "tooLong"}
              onChange={(event) => {
                setDraft(event.target.value);
                setNotice(null);
                setServerError(null);
              }}
            />
            <p id="system-name-help" className="text-xs text-muted-foreground">
              {t("settings.branding.systemNameHelp")}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="system-logo">{t("settings.branding.logo")}</Label>
            <div className="flex items-center gap-3">
              {logoUrl ? (
                <img src={logoUrl} alt={t("settings.branding.logoPreview")} className="h-16 w-16 shrink-0 rounded-md border bg-muted object-contain p-1" />
              ) : <p className="text-sm text-muted-foreground">{t("settings.branding.noLogo")}</p>}
              {canManage && logoUrl && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => {
                    setLogoDraft(null);
                    setNotice(null);
                    setServerError(null);
                  }}
                >
                  {t("settings.branding.removeLogo")}
                </Button>
              )}
            </div>
            <Input
              id="system-logo"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              disabled={disabled}
              aria-describedby="system-logo-help"
              onChange={(event) => { void handleLogoChange(event); }}
            />
            <p id="system-logo-help" className="text-xs text-muted-foreground">{t("settings.branding.logoHelp")}</p>
            {isProcessingLogo && <p role="status" className="text-sm">{t("settings.branding.processingLogo")}</p>}
          </div>
          {branding.isError && <p role="alert" className="text-sm text-destructive">{t("settings.branding.loadError")}</p>}
          {notice && (
            <p role={notice === "saved" ? "status" : "alert"} className={notice === "saved" ? "text-sm" : "text-sm text-destructive"}>
              {t(`settings.branding.${notice}`)}{serverError ? ` ${serverError}` : ""}
            </p>
          )}
          {canManage ? (
            <Button type="submit" disabled={disabled}>
              <Save className="mr-2 h-4 w-4" />
              {t(save.isPending ? "settings.branding.saving" : "settings.branding.save")}
            </Button>
          ) : <p className="text-sm text-muted-foreground">{t("settings.branding.readOnly")}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
