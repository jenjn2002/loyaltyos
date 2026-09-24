import { memberFieldLabel, ui } from "@/lib/ui-text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Copy, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchApi } from "@/lib/api-client";
import type { Member, MemberPointWallet, PaginatedResponse, PointTransaction } from "@/types";

const transactionTypeColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  EARN: "default",
  REDEEM: "destructive",
  REVERSAL: "secondary",
  EXPIRY: "outline",
  ADJUSTMENT: "secondary",
  GIVE_IN: "default",
  GIVE_OUT: "secondary",
  GIVE_ALLOWANCE_OUT: "secondary",
  EXCHANGE: "destructive",
};

interface MemberProfileForm {
  email: string;
  externalId: string;
  phone: string;
  firstName: string;
  lastName: string;
  department: string;
  photoUrl: string;
}

interface MemberFieldDefinition {
  id: string;
  key: string;
  label: string;
  type: "TEXT" | "NUMBER" | "BOOLEAN" | "DATE" | "SELECT";
  required: boolean;
  options: string[] | null;
  isActive: boolean;
}

const emptyProfileForm: MemberProfileForm = {
  email: "",
  externalId: "",
  phone: "",
  firstName: "",
  lastName: "",
  department: "",
  photoUrl: "",
};

export function MemberDetailPage(): JSX.Element {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const memberId = id ?? "";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [statusReason, setStatusReason] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [credentialUsername, setCredentialUsername] = useState("");
  const [credentialPassword, setCredentialPassword] = useState("");
  const [credentialMessage, setCredentialMessage] = useState<string | null>(null);
  const [identitySubject, setIdentitySubject] = useState("");
  const [identityTenant, setIdentityTenant] = useState("");
  const [identityEmail, setIdentityEmail] = useState("");
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileForm, setProfileForm] = useState<MemberProfileForm>(emptyProfileForm);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});

  const {
    data: member,
    isLoading: memberLoading,
    isError: memberError,
  } = useQuery({
    queryKey: ["member", memberId],
    queryFn: () => fetchApi<Member>(`/members/${memberId}`),
    enabled: Boolean(memberId),
  });

  const admin = useQuery({
    queryKey: ["admin-me"],
    queryFn: () => fetchApi<{ capabilities: Record<string, boolean> }>("/admin/me"),
  });

  const customFields = useQuery({
    queryKey: ["member-fields"],
    queryFn: () => fetchApi<MemberFieldDefinition[]>("/admin/member-fields"),
    enabled: Boolean(memberId),
  });

  useEffect(() => {
    if (member) setCredentialUsername(member.username ?? "");
  }, [member]);

  useEffect(() => {
    if (!member || profileEditing) return;
    setProfileForm({
      email: member.email ?? "",
      externalId: member.externalId ?? "",
      phone: member.phone ?? "",
      firstName: member.firstName ?? "",
      lastName: member.lastName ?? "",
      department: member.department ?? "",
      photoUrl: member.photoUrl ?? "",
    });
  }, [member, profileEditing]);

  useEffect(() => {
    if (!member || profileEditing) return;
    const metadata = member.metadata;
    setCustomValues(
      metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : {},
    );
  }, [member, profileEditing]);

  const updateMemberProfile = useMutation({
    mutationFn: () =>
      fetchApi<Member>(`/members/${memberId}`, {
        method: "PATCH",
        body: JSON.stringify({
          email: profileForm.email.trim() || null,
          externalId: profileForm.externalId.trim() || null,
          phone: profileForm.phone.trim() || null,
          firstName: profileForm.firstName.trim() || null,
          lastName: profileForm.lastName.trim() || null,
          department: profileForm.department.trim() || null,
          photoUrl: profileForm.photoUrl.trim() || null,
          metadata: customValues,
        }),
      }),
    onSuccess: async () => {
      setProfileEditing(false);
      setProfileMessage(ui("Member profile updated."));
      await queryClient.invalidateQueries({ queryKey: ["member", memberId] });
      await queryClient.invalidateQueries({ queryKey: ["members"] });
    },
    onError: (error: Error) => {
      setProfileMessage(error.message);
    },
  });

  const saveCredentials = useMutation({
    mutationFn: () =>
      fetchApi<{ username: string | null; credentialsConfigured: boolean }>(
        `/admin/members/${memberId}/credentials`,
        {
          method: "PUT",
          body: JSON.stringify({
            username: credentialUsername,
            ...(credentialPassword ? { password: credentialPassword } : {}),
          }),
        },
      ),
    onSuccess: async () => {
      setCredentialPassword("");
      setCredentialMessage(t("members.credentialsSaved"));
      await queryClient.invalidateQueries({ queryKey: ["member", memberId] });
    },
    onError: (error: Error) => {
      setCredentialMessage(error.message);
    },
  });

  const removeCredentials = useMutation({
    mutationFn: () =>
      fetchApi<unknown>(`/admin/members/${memberId}/credentials`, { method: "DELETE" }),
    onSuccess: async () => {
      setCredentialUsername("");
      setCredentialPassword("");
      setCredentialMessage(t("members.credentialsRemoved"));
      await queryClient.invalidateQueries({ queryKey: ["member", memberId] });
    },
    onError: (error: Error) => {
      setCredentialMessage(error.message);
    },
  });

  const identities = useQuery({
    queryKey: ["member-identities", memberId],
    queryFn: () =>
      fetchApi<{ id: string; providerSubject: string; tenantId: string; email: string | null }[]>(
        `/admin/members/${memberId}/microsoft-identities`,
      ),
    enabled: Boolean(memberId) && admin.data?.capabilities["member.credentials.manage"] !== false,
  });

  const linkIdentity = useMutation({
    mutationFn: () =>
      fetchApi(`/admin/members/${memberId}/microsoft-identities`, {
        method: "POST",
        body: JSON.stringify({
          providerSubject: identitySubject,
          tenantId: identityTenant,
          ...(identityEmail ? { email: identityEmail } : {}),
        }),
      }),
    onSuccess: async () => {
      setIdentitySubject("");
      setIdentityTenant("");
      setIdentityEmail("");
      setCredentialMessage(t("members.microsoftIdentityLinked"));
      await queryClient.invalidateQueries({ queryKey: ["member-identities", memberId] });
    },
    onError: (error: Error) => {
      setCredentialMessage(error.message);
    },
  });

  const unlinkIdentity = useMutation({
    mutationFn: (identityId: string) =>
      fetchApi<unknown>(`/admin/members/${memberId}/microsoft-identities/${identityId}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      setCredentialMessage(t("members.microsoftIdentityUnlinked"));
      await queryClient.invalidateQueries({ queryKey: ["member-identities", memberId] });
    },
    onError: (error: Error) => {
      setCredentialMessage(error.message);
    },
  });

  const { data: wallets, isLoading: balanceLoading } = useQuery({
    queryKey: ["member-balance", memberId],
    queryFn: () => fetchApi<MemberPointWallet[]>(`/members/${memberId}/balance`),
    enabled: Boolean(memberId),
  });

  const [txPage, setTxPage] = useState(1);
  const { data: transactions, isLoading: txsLoading } = useQuery({
    queryKey: ["member-transactions", memberId, txPage],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("page", String(txPage));
      params.set("pageSize", "10");
      return fetchApi<PaginatedResponse<PointTransaction>>(
        `/members/${memberId}/transactions?${params.toString()}`,
      );
    },
    enabled: Boolean(memberId),
  });

  const updateMemberStatus = async (status: "ACTIVE" | "INACTIVE"): Promise<void> => {
    if (!statusReason.trim()) {
      setStatusMessage("A reason is required.");
      return;
    }
    setStatusUpdating(true);
    setStatusMessage(null);
    try {
      await fetchApi(`/admin/members/${memberId}/status`, {
        method: "POST",
        body: JSON.stringify({ status, reason: statusReason }),
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      setStatusReason("");
      setStatusMessage(
        status === "INACTIVE"
          ? "Member offboarded; all configured wallets and allowances were cleared and retained in history."
          : "Member reactivated; wallets remain zero until a new grant.",
      );
      void queryClient.invalidateQueries({ queryKey: ["member", memberId] });
      void queryClient.invalidateQueries({ queryKey: ["member-balance", memberId] });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Status update failed");
    } finally {
      setStatusUpdating(false);
    }
  };

  const deleteMember = async (): Promise<void> => {
    if (!window.confirm(ui("Delete this member? Their account will be removed from active members and wallets cleared. History is retained."))) return;
    setStatusUpdating(true);
    setStatusMessage(null);
    try {
      await fetchApi(`/admin/members/${memberId}`, {
        method: "DELETE",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      await queryClient.invalidateQueries({ queryKey: ["members"] });
      navigate("/members");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : ui("Member deletion failed"));
      setStatusUpdating(false);
    }
  };

  if (memberError || (!memberLoading && !member)) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" asChild>
          <Link to="/members">
            <ChevronLeft className="mr-2 h-4 w-4" />
            {t("members.backToList")}
          </Link>
        </Button>
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-destructive">{ui("Member not found")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" asChild>
          <Link to="/members">
            <ChevronLeft className="mr-2 h-4 w-4" />
            {t("members.backToList")}
          </Link>
        </Button>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>
                {memberLoading ? (
                  <Skeleton className="h-6 w-48" />
                ) : (
                  `${member?.firstName ?? ""} ${member?.lastName ?? ""}`.trim() || "N/A"
                )}
              </CardTitle>
              <CardDescription>{ui("Member Profile")}</CardDescription>
            </div>
            {admin.data?.capabilities["member.manage"] !== false && !memberLoading && (
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setProfileMessage(null);
                    setProfileEditing((editing) => !editing);
                  }}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  {profileEditing ? t("common.cancel") : t("common.edit")}
                </Button>
                {admin.data?.capabilities["member.manage"] === true && !member?.deletedAt && (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={statusUpdating}
                    onClick={() => {
                      void deleteMember();
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {ui("Delete member")}
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {memberLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : profileEditing ? (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                setProfileMessage(null);
                updateMemberProfile.mutate();
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="member-profile-first-name">{t("members.firstName")}</Label>
                  <Input
                    id="member-profile-first-name"
                    value={profileForm.firstName}
                    onChange={(event) => {
                      setProfileForm((current) => ({ ...current, firstName: event.target.value }));
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="member-profile-last-name">{t("members.lastName")}</Label>
                  <Input
                    id="member-profile-last-name"
                    value={profileForm.lastName}
                    onChange={(event) => {
                      setProfileForm((current) => ({ ...current, lastName: event.target.value }));
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="member-profile-email">{t("common.email")}</Label>
                  <Input
                    id="member-profile-email"
                    type="email"
                    value={profileForm.email}
                    onChange={(event) => {
                      setProfileForm((current) => ({ ...current, email: event.target.value }));
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="member-profile-phone">{ui("Phone")}</Label>
                  <Input
                    id="member-profile-phone"
                    value={profileForm.phone}
                    onChange={(event) => {
                      setProfileForm((current) => ({ ...current, phone: event.target.value }));
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="member-profile-external-id">{t("members.externalId")}</Label>
                  <Input
                    id="member-profile-external-id"
                    value={profileForm.externalId}
                    onChange={(event) => {
                      setProfileForm((current) => ({ ...current, externalId: event.target.value }));
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="member-profile-department">{ui("Department")}</Label>
                  <Input
                    id="member-profile-department"
                    value={profileForm.department}
                    onChange={(event) => {
                      setProfileForm((current) => ({ ...current, department: event.target.value }));
                    }}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="member-profile-photo-url">{ui("Photo URL (optional)")}</Label>
                <Input
                  id="member-profile-photo-url"
                  type="url"
                  value={profileForm.photoUrl}
                  onChange={(event) => {
                    setProfileForm((current) => ({ ...current, photoUrl: event.target.value }));
                  }}
                  placeholder="https://"
                />
              </div>
              {customFields.data?.some((field) => field.isActive) && (
                <div className="grid gap-4 rounded-md border p-4 sm:grid-cols-2">
                  {customFields.data.filter((field) => field.isActive).map((field) => {
                    const value = customValues[field.key];
                    const inputId = `member-custom-${field.key}`;
                    return (
                      <div className="space-y-2" key={field.id}>
                        <Label htmlFor={inputId}>{memberFieldLabel(field)}{field.required ? " *" : ""}</Label>
                        {field.type === "BOOLEAN" ? (
                          <label className="flex h-10 items-center gap-2 text-sm"><input id={inputId} type="checkbox" checked={value === true} onChange={(event) => setCustomValues((current) => ({ ...current, [field.key]: event.target.checked }))} />{ui("Yes")}</label>
                        ) : field.type === "SELECT" ? (
                          <select id={inputId} className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={String(value ?? "")} onChange={(event) => setCustomValues((current) => ({ ...current, [field.key]: event.target.value }))}><option value="">{ui("Select")}</option>{(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}</select>
                        ) : (
                          <Input id={inputId} type={field.type === "NUMBER" ? "number" : field.type === "DATE" ? "date" : "text"} value={String(value ?? "")} onChange={(event) => setCustomValues((current) => ({ ...current, [field.key]: field.type === "NUMBER" ? Number(event.target.value) : event.target.value }))} />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {updateMemberProfile.isError && profileMessage && (
                <p className="text-sm text-destructive">{profileMessage}</p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setProfileEditing(false);
                    setProfileMessage(null);
                  }}
                >
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={updateMemberProfile.isPending}>
                  {updateMemberProfile.isPending ? t("common.loading") : t("common.save")}
                </Button>
              </div>
            </form>
          ) : (
            <>
              <div className="mb-4 flex items-center gap-3">
                {member?.photoUrl ? (
                  <img
                    src={member.photoUrl}
                    alt={ui("Member photo")}
                    className="h-16 w-16 rounded-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold">
                    {`${member?.firstName?.[0] ?? ""}${member?.lastName?.[0] ?? ""}`.toUpperCase() || "?"}
                  </div>
                )}
                <div>
                  <p className="text-sm text-muted-foreground">{ui("Department")}</p>
                  <p>{member?.department ?? "--"}</p>
                </div>
              </div>
              <dl className="grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-sm text-muted-foreground">{ui("Member ID")}</dt>
                  <dd className="flex items-center gap-1">
                    <code className="break-all text-xs">{member?.id}</code>
                    {member?.id && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        aria-label={ui("Copy member ID")}
                        onClick={() => void navigator.clipboard.writeText(member.id)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">{ui("Email")}</dt>
                  <dd>{member?.email ?? "N/A"}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">{ui("Phone")}</dt>
                  <dd>{member?.phone ?? "N/A"}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">{ui("External ID")}</dt>
                  <dd>{member?.externalId ?? "--"}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">{ui("Department")}</dt>
                  <dd>{member?.department ?? "--"}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">{ui("Photo URL (optional)")}</dt>
                  <dd className="max-w-full truncate" title={member?.photoUrl ?? undefined}>
                    {member?.photoUrl ?? "--"}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">{ui("Joined")}</dt>
                  <dd>{member ? new Date(member.joinedAt).toLocaleDateString() : "--"}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">{ui("Status")}</dt>
                  <dd>{member?.status ?? "ACTIVE"}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-sm text-muted-foreground">{ui("Credit wallets")}</dt>
                  <dd className="mt-1 flex flex-wrap gap-2 text-sm">
                    {(member?.pointWallets ?? []).length === 0 ? (
                      <span className="text-muted-foreground">{ui("No configured wallets")}</span>
                    ) : (
                      member?.pointWallets?.map((wallet) => (
                        <span key={wallet.pointTypeId} className="rounded bg-muted px-2 py-1">
                          {wallet.name}: {wallet.balance.toLocaleString()} {wallet.unitLabel}
                          {wallet.allowance
                            ? ` · ${ui("Give remaining:")} ${wallet.allowance.remaining.toLocaleString()}`
                            : ""}
                        </span>
                      ))
                    )}
                  </dd>
                </div>
                {member?.tags && member.tags.length > 0 && (
                  <div className="sm:col-span-2">
                    <dt className="mb-1 text-sm text-muted-foreground">{ui("Tags")}</dt>
                    <dd className="flex flex-wrap gap-1">
                      {member.tags.map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </dd>
                  </div>
                )}
                {customFields.data?.filter((field) => field.isActive).map((field) => {
                  const value = customValues[field.key];
                  const hasValue = value !== undefined && value !== null && value !== "";
                  const displayValue = !hasValue
                    ? "--"
                    : field.type === "BOOLEAN"
                      ? value === true ? ui("Yes") : ui("No")
                      : String(value);
                  return (
                    <div key={field.id}>
                      <dt className="text-sm text-muted-foreground">{memberFieldLabel(field)}</dt>
                      <dd>{displayValue}</dd>
                    </div>
                  );
                })}
              </dl>
            </>
          )}
          {profileMessage && !profileEditing && (
            <p className="mt-3 text-sm text-muted-foreground">{profileMessage}</p>
          )}
          <div className="mt-4 flex flex-wrap items-end gap-2 border-t pt-4">
            <div className="min-w-64 flex-1">
              <Label htmlFor="status-reason">{ui("Status / offboarding reason")}</Label>
              <Input
                id="status-reason"
                value={statusReason}
                onChange={(event) => {
                  setStatusReason(event.target.value);
                }}
                placeholder={ui("Reason is required")}
              />
            </div>
            {member?.status === "INACTIVE" ? (
              <Button disabled={statusUpdating} onClick={() => void updateMemberStatus("ACTIVE")}>{ui("Reactivate")}</Button>
            ) : (
              <Button
                variant="destructive"
                disabled={statusUpdating}
                onClick={() => void updateMemberStatus("INACTIVE")}
              >{ui("Offboard & clear wallets")}</Button>
            )}
            {statusMessage && (
              <p className="w-full text-sm text-muted-foreground">{statusMessage}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {admin.data?.capabilities["member.credentials.manage"] !== false && (
        <Card>
          <CardHeader>
            <CardTitle>{t("members.portalAccess")}</CardTitle>
            <CardDescription>{t("members.portalAccessDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="credential-username">{t("members.username")}</Label>
                  <HelpTooltip label={t("members.portalUsernameHelpLabel")}>
                    {t("members.portalUsernameHelp")}
                  </HelpTooltip>
                </div>
                <Input
                  id="credential-username"
                  value={credentialUsername}
                  onChange={(event) => {
                    setCredentialUsername(event.target.value);
                  }}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="credential-password">{t("members.resetPassword")}</Label>
                  <HelpTooltip label={t("members.resetPasswordHelpLabel")}>
                    {t("members.resetPasswordHelp")}
                  </HelpTooltip>
                </div>
                <Input
                  id="credential-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  value={credentialPassword}
                  onChange={(event) => {
                    setCredentialPassword(event.target.value);
                  }}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                disabled={saveCredentials.isPending || credentialUsername.trim().length < 3}
                onClick={() => {
                  saveCredentials.mutate();
                }}
              >
                {t("members.saveCredentials")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={removeCredentials.isPending || !member?.credentialsConfigured}
                onClick={() => {
                  removeCredentials.mutate();
                }}
              >
                {t("members.credentialsRemoved")}
              </Button>
              <span className="text-sm text-muted-foreground">
                {member?.credentialsConfigured
                  ? t("members.configured")
                  : t("members.notConfigured")}
              </span>
            </div>

            <div className="border-t pt-4">
              <div className="mb-3 flex items-center gap-2 font-medium">
                {t("members.microsoftIdentityLinks")}
                <HelpTooltip label={t("members.microsoftIdentityLinksHelpLabel")}>
                  {t("members.microsoftIdentityLinksHelp")}
                </HelpTooltip>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <Input
                  aria-label={t("members.microsoftSubject")}
                  placeholder={t("members.providerSubject")}
                  value={identitySubject}
                  onChange={(event) => {
                    setIdentitySubject(event.target.value);
                  }}
                />
                <Input
                  aria-label={t("members.microsoftTenantId")}
                  placeholder={t("members.tenantId")}
                  value={identityTenant}
                  onChange={(event) => {
                    setIdentityTenant(event.target.value);
                  }}
                />
                <Input
                  aria-label={t("members.microsoftVerifiedEmail")}
                  type="email"
                  placeholder={t("members.verifiedEmailOptional")}
                  value={identityEmail}
                  onChange={(event) => {
                    setIdentityEmail(event.target.value);
                  }}
                />
              </div>
              <Button
                type="button"
                className="mt-3"
                variant="outline"
                disabled={linkIdentity.isPending || !identitySubject || !identityTenant}
                onClick={() => {
                  linkIdentity.mutate();
                }}
              >
                {t("members.linkMicrosoftIdentity")}
              </Button>
              <div className="mt-3 space-y-2 text-sm">
                {(identities.data ?? []).map((identity) => (
                  <div
                    key={identity.id}
                    className="flex flex-wrap items-center gap-2 rounded bg-muted p-2"
                  >
                    <code>{identity.providerSubject}</code>
                    <span>{identity.tenantId}</span>
                    {identity.email && <span>{identity.email}</span>}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        unlinkIdentity.mutate(identity.id);
                      }}
                    >
                      {t("members.unlink")}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
            {credentialMessage && (
              <p className="text-sm text-muted-foreground">{credentialMessage}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Balance */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>{ui("Configured wallets")}</CardTitle>
          </CardHeader>
          <CardContent>
            {balanceLoading ? (
              <div className="grid grid-cols-3 gap-4">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {(wallets ?? []).map((wallet) => (
                  <div key={wallet.pointTypeId} className="rounded-lg bg-muted p-4">
                    <p className="text-sm text-muted-foreground">
                      {wallet.name} ({wallet.code})
                    </p>
                    <p className="text-2xl font-bold">{wallet.balance.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{wallet.unitLabel}</p>
                    {wallet.allowance && (
                      <p className="mt-1 text-xs">
                        {ui("Give allowance:")} {wallet.allowance.remaining.toLocaleString()} /{" "}
                        {wallet.allowance.allocated.toLocaleString()}
                      </p>
                    )}
                  </div>
                ))}
                {(wallets ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">{ui("No active point types are configured.")}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Transactions */}
      <Card>
        <CardHeader>
          <CardTitle>{ui("Transaction History")}</CardTitle>
        </CardHeader>
        <CardContent>
          {txsLoading ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{ui("Date")}</TableHead>
                  <TableHead>{ui("Type")}</TableHead>
                  <TableHead>{ui("Amount")}</TableHead>
                  <TableHead>{ui("Balance After")}</TableHead>
                  <TableHead>{ui("Source")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : !transactions || transactions.items.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-muted-foreground">{ui("No transactions yet")}</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{ui("Date")}</TableHead>
                    <TableHead>{ui("Type")}</TableHead>
                    <TableHead>{ui("Amount")}</TableHead>
                    <TableHead>{ui("Balance After")}</TableHead>
                    <TableHead>{ui("Source")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.items.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell>{new Date(tx.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <Badge variant={transactionTypeColors[tx.action] ?? "outline"}>
                          {tx.action}
                        </Badge>
                      </TableCell>
                      <TableCell className={tx.amount > 0 ? "text-green-600" : "text-red-600"}>
                        {tx.amount > 0 ? "+" : ""}
                        {tx.amount.toLocaleString()}
                      </TableCell>
                      <TableCell>{tx.balanceAfter.toLocaleString()}</TableCell>
                      <TableCell>
                        {tx.pointType.code} · {tx.sourceLabel ?? tx.source}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Page {transactions.page} of {transactions.totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={transactions.page <= 1}
                    onClick={() => {
                      setTxPage((p) => p - 1);
                    }}
                  >
                    {t("common.previous")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={transactions.page >= transactions.totalPages}
                    onClick={() => {
                      setTxPage((p) => p + 1);
                    }}
                  >
                    {t("common.next")}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
