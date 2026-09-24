import { ui } from "@/lib/ui-text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ShieldCheck, UserCog } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { fetchApi } from "@/lib/api-client";

type Role = "SUPER_ADMIN" | "OPERATOR" | "ANALYST";
type ConfigurableRole = Exclude<Role, "SUPER_ADMIN">;
interface PermissionData {
  capabilities: string[];
  roles: { role: Role; label: string; permissions: Record<string, boolean> }[];
}
interface AdminAccount {
  id: string;
  email: string;
  name: string;
  role: Role;
  roleLabel: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  createdBy?: { id: string; name: string; email: string | null } | null;
}
interface AccountDraft {
  role: Role;
  isActive: boolean;
}

const CAPABILITY_COPY: Record<string, { label: string; description: string }> = {
  "dashboard.view": {
    label: "View dashboard",
    description: "See aggregate program metrics and trends.",
  },
  "member.view": {
    label: "View members",
    description: "See member profiles, wallet balances and history.",
  },
  "member.manage": {
    label: "Manage members",
    description: "Create, edit, import, reactivate and offboard members.",
  },
  "member.credentials.manage": {
    label: "Manage member sign-in",
    description: "Provision portal passwords and link or unlink Microsoft identities.",
  },
  "wallet.view": {
    label: "View wallet ledger",
    description: "Read wallet transactions and recognition categories.",
  },
  "wallet.adjust": {
    label: "Adjust wallets",
    description: "Add, remove, expire or clear member wallet value.",
  },
  "point_type.view": {
    label: "View point types",
    description: "Read point-type behavior, expiry and transfer rules.",
  },
  "point_type.manage": {
    label: "Manage point types",
    description: "Create, edit, archive, delete and restore point types.",
  },
  "bank.view": {
    label: "View banks",
    description: "Read central funding balances and allocation cycles.",
  },
  "bank.manage": {
    label: "Manage banks",
    description: "Fund banks and open or close allocation cycles.",
  },
  "exchange.view": {
    label: "View exchanges",
    description: "Read rates and member exchange requests.",
  },
  "exchange.manage": {
    label: "Manage exchanges",
    description: "Version rates and cancel, reject or refund requests.",
  },
  "exchange.approve": {
    label: "Approve exchange vouchers",
    description:
      "Approve a pending accounting voucher after reviewing its immutable rate snapshot.",
  },
  "exchange.complete": {
    label: "Complete exchange vouchers",
    description:
      "Mark an approved voucher completed and record its accounting or payment reference.",
  },
  "reward.view": {
    label: "View rewards",
    description: "Read rewards, prices, stock and fulfillment records.",
  },
  "reward.manage": {
    label: "Manage rewards",
    description: "Create rewards, configure prices and fulfill redemptions.",
  },
  "campaign.view": {
    label: "View engagement",
    description: "Read campaign configuration and campaign activity.",
  },
  "campaign.manage": {
    label: "Manage engagement",
    description: "Create, edit, activate, pause and archive campaigns.",
  },
  "campaign.execute": {
    label: "Run campaigns",
    description: "Run an approved campaign immediately and issue or create its member grants.",
  },
  "segment.view": {
    label: "View segments",
    description: "Read segment definitions and their matched members.",
  },
  "segment.manage": {
    label: "Manage segments",
    description: "Create, edit and delete static or dynamic member segments.",
  },
  "tier.view": {
    label: "View tiers",
    description: "Read tier levels, qualification rules and member distribution.",
  },
  "tier.manage": {
    label: "Manage tiers",
    description: "Create, edit, reorder and delete tier qualification rules.",
  },
  "badge.view": {
    label: "View badges",
    description: "Read badge definitions and member award statistics.",
  },
  "badge.manage": {
    label: "Manage badges",
    description: "Create, edit, activate and archive badges.",
  },
  "coupon.view": {
    label: "View coupons",
    description: "Read coupon codes, usage and validity settings.",
  },
  "coupon.manage": {
    label: "Manage coupons",
    description: "Create, generate, edit and deactivate coupon codes.",
  },
  "event.view": {
    label: "View event definitions",
    description: "Read trigger event definitions used by campaign automation.",
  },
  "event.manage": {
    label: "Manage event definitions",
    description: "Create, edit and deactivate campaign trigger event definitions.",
  },
  "issuance.view": {
    label: "View issuance rules",
    description: "Read legacy point issuance rules and their schedules.",
  },
  "issuance.manage": {
    label: "Manage issuance rules",
    description: "Create, edit and delete legacy point issuance rules.",
  },
  "recognition.view": {
    label: "View recognition categories",
    description: "Read categories used to classify member recognition transactions.",
  },
  "recognition.manage": {
    label: "Manage recognition categories",
    description: "Create, edit and archive member recognition categories.",
  },
  "notification.view": {
    label: "View notifications",
    description: "Read templates, deliveries and webhook configuration.",
  },
  "notification.manage": {
    label: "Manage notifications",
    description: "Change templates, delivery settings and webhooks.",
  },
  "audit.view": {
    label: "View audit log",
    description: "Inspect security and business-operation audit records.",
  },
  "permission.manage": {
    label: "Manage permissions",
    description: "Change the Operator and Auditor capability matrix.",
  },
  "workflow.view": {
    label: "View workflows",
    description: "Review configured approval layers and their assignees.",
  },
  "workflow.manage": {
    label: "Manage workflows",
    description: "Create, edit, activate and remove program approval workflows.",
  },
  "approval.inbox": {
    label: "View approval inbox",
    description: "See pending requests assigned to the current administrator.",
  },
  "approval.view": {
    label: "View approval history",
    description: "Inspect approval request progress, snapshots and decisions.",
  },
  "approval.decide": {
    label: "Decide approvals",
    description: "Approve or reject the active layer of an assigned request.",
  },
  "settings.view": {
    label: "View settings",
    description: "View program integration settings and masked configuration status.",
  },
  "settings.manage": {
    label: "Manage settings",
    description: "Configure and test Microsoft 365 sign-in for the program.",
  },
};

export function PermissionsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, Record<string, boolean>>>({});
  const [accountDrafts, setAccountDrafts] = useState<Record<string, AccountDraft>>({});
  const [newAccount, setNewAccount] = useState({
    name: "",
    email: "",
    password: "",
    role: "OPERATOR" as ConfigurableRole,
  });
  const [newAccountErrors, setNewAccountErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const permissions = useQuery({
    queryKey: ["admin", "permissions"],
    queryFn: () => fetchApi<PermissionData>("/admin/permissions"),
  });
  const accounts = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => fetchApi<AdminAccount[]>("/admin/users"),
  });

  useEffect(() => {
    if (!permissions.data) return;
    setDrafts(
      Object.fromEntries(
        permissions.data.roles.map((role) => [role.role, { ...role.permissions }]),
      ),
    );
  }, [permissions.data]);

  useEffect(() => {
    if (!accounts.data) return;
    setAccountDrafts(
      Object.fromEntries(
        accounts.data.map((account) => [
          account.id,
          { role: account.role, isActive: account.isActive },
        ]),
      ),
    );
  }, [accounts.data]);

  const save = useMutation({
    mutationFn: (role: ConfigurableRole) =>
      fetchApi(`/admin/permissions/${role}`, {
        method: "PATCH",
        body: JSON.stringify({ permissions: drafts[role] ?? {} }),
      }),
    onSuccess: async () => {
      setNotice(ui("Role permissions saved and audit logged."));
      await queryClient.invalidateQueries({ queryKey: ["admin", "permissions"] });
    },
    onError: (error: Error) => {
      setNotice(error.message);
    },
  });
  const createAccount = useMutation({
    mutationFn: () =>
      fetchApi<AdminAccount>("/admin/users", {
        method: "POST",
        body: JSON.stringify(newAccount),
      }),
    onSuccess: async () => {
      setNewAccount({ name: "", email: "", password: "", role: "OPERATOR" });
      setNewAccountErrors({});
      setNotice(ui("Administrator account created and audit logged."));
      await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (error: Error) => {
      setNotice(error.message);
    },
  });

  function validateNewAccount(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!newAccount.name.trim()) errors.name = "Name is required.";
    if (!/^\S+@\S+\.\S+$/.test(newAccount.email.trim()))
      errors.email = "Enter a valid administrator email.";
    const passwordClasses = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z\d]/].filter((pattern) =>
      pattern.test(newAccount.password),
    ).length;
    if (newAccount.password.length < 12) errors.password = "Use at least 12 characters.";
    else if (passwordClasses < 3)
      errors.password = "Use at least 3 of lowercase, uppercase, number and symbol.";
    return errors;
  }

  function submitNewAccount(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const errors = validateNewAccount();
    setNewAccountErrors(errors);
    if (Object.keys(errors).length > 0) return;
    createAccount.mutate();
  }
  const updateAccount = useMutation({
    mutationFn: (account: AdminAccount) =>
      fetchApi<AdminAccount>(`/admin/users/${account.id}`, {
        method: "PATCH",
        body: JSON.stringify(accountDrafts[account.id]),
      }),
    onSuccess: async () => {
      setNotice(ui("Administrator role and status saved immediately."));
      await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-me"] });
    },
    onError: (error: Error) => {
      setNotice(error.message);
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <ShieldCheck />{ui("Roles & permissions")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {ui("Owner always has every capability and cannot be locked out. Operator performs day-to-day work; Auditor is read-only by default. Overrides apply program-wide and are audit logged.")}
        </p>
      </div>
      {notice && (
        <div role="status" className="rounded-md border bg-muted p-3 text-sm">
          {notice}
        </div>
      )}
      {permissions.isError && (
        <div className="rounded-md border border-destructive p-3 text-sm text-destructive">{ui("Only an Owner with permission-management access can open this page.")}</div>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5" />{ui("Administrator accounts")}</CardTitle>
          <CardDescription>
            {ui("Assign an administrative role to each back-office user. Microsoft 365 sign-ins create inactive pending accounts here; activate one to approve access. Member accounts use the Portal and never receive administrative capabilities.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <form
            className="grid gap-3 rounded-md border p-4 md:grid-cols-2 xl:grid-cols-5"
            onSubmit={submitNewAccount}
            noValidate
          >
            <div>
              <Label htmlFor="admin-name" data-help={ui("Display name for this administrator.")}>{ui("Name")}</Label>
              <Input
                id="admin-name"
                value={newAccount.name}
                aria-invalid={Boolean(newAccountErrors.name)}
                aria-describedby={newAccountErrors.name ? "admin-name-error" : undefined}
                onChange={(event) => {
                  setNewAccount((current) => ({ ...current, name: event.target.value }));
                }}
              />
              {newAccountErrors.name && (
                <p id="admin-name-error" className="text-xs text-destructive">
                  {newAccountErrors.name}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="admin-email" data-help={ui("Unique email used to sign in to Admin.")}>{ui("Email")}</Label>
              <Input
                id="admin-email"
                type="email"
                value={newAccount.email}
                aria-invalid={Boolean(newAccountErrors.email)}
                aria-describedby={newAccountErrors.email ? "admin-email-error" : undefined}
                onChange={(event) => {
                  setNewAccount((current) => ({ ...current, email: event.target.value }));
                }}
              />
              {newAccountErrors.email && (
                <p id="admin-email-error" className="text-xs text-destructive">
                  {newAccountErrors.email}
                </p>
              )}
            </div>
            <div>
              <Label
                htmlFor="admin-password"
                data-help={ui("Temporary password with at least 12 characters. Share it outside LoyaltyOS.")}
              >{ui("Temporary password")}</Label>
              <Input
                id="admin-password"
                type="password"
                minLength={12}
                value={newAccount.password}
                aria-invalid={Boolean(newAccountErrors.password)}
                aria-describedby="admin-password-help"
                onChange={(event) => {
                  setNewAccount((current) => ({ ...current, password: event.target.value }));
                }}
              />
              <p id="admin-password-help" className="text-xs text-muted-foreground">{ui("At least 12 characters and 3 character classes.")}</p>
              {newAccountErrors.password && (
                <p className="text-xs text-destructive">{newAccountErrors.password}</p>
              )}
            </div>
            <div>
              <Label htmlFor="admin-role" data-help={ui("Role whose capability matrix applies.")}>{ui("Role")}</Label>
              <select
                id="admin-role"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={newAccount.role}
                onChange={(event) => {
                  setNewAccount((current) => ({
                    ...current,
                    role: event.target.value as ConfigurableRole,
                  }));
                }}
              >
                <option value="OPERATOR">{ui("Operator")}</option>
                <option value="ANALYST">{ui("Auditor")}</option>
              </select>
            </div>
            <Button type="submit" className="self-end" disabled={createAccount.isPending}>
              <Plus className="h-4 w-4" /> {createAccount.isPending ? ui("Creating…") : ui("Create admin")}
            </Button>
          </form>

          <div className="space-y-3">
            {accounts.isLoading && <p className="text-sm text-muted-foreground">{ui("Loading users…")}</p>}
            {accounts.isError && (
              <p className="text-sm text-destructive">{ui("Administrator accounts could not be loaded.")}</p>
            )}
            {(accounts.data ?? []).map((account) => {
              const immutable = account.role === "SUPER_ADMIN";
              const draft = accountDrafts[account.id] ?? {
                role: account.role,
                isActive: account.isActive,
              };
              return (
                <div
                  key={account.id}
                  className="grid items-end gap-3 rounded-md border p-4 md:grid-cols-[minmax(0,2fr)_minmax(10rem,1fr)_auto_auto]"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{account.name}</p>
                    <p className="truncate text-sm text-muted-foreground">{account.email}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {ui("Last login:")} {" "}
                      {account.lastLoginAt
                        ? new Date(account.lastLoginAt).toLocaleString()
                        : ui("Never")}
                    </p>
                    <p className="text-xs text-muted-foreground">{ui("Created by")}: {account.createdBy ? `${account.createdBy.name}${account.createdBy.email ? ` · ${account.createdBy.email}` : ""}` : ui("System / legacy")}</p>
                  </div>
                  <div>
                    <Label
                      htmlFor={`account-role-${account.id}`}
                      data-help={ui("Changing role applies the selected capability matrix on the next request.")}
                    >{ui("Assigned role")}</Label>
                    <select
                      id={`account-role-${account.id}`}
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-60"
                      value={draft.role}
                      disabled={immutable}
                      onChange={(event) => {
                        setAccountDrafts((current) => ({
                          ...current,
                          [account.id]: {
                            ...draft,
                            role: event.target.value as ConfigurableRole,
                          },
                        }));
                      }}
                    >
                      {immutable && <option value="SUPER_ADMIN">{ui("Owner")}</option>}
                      <option value="OPERATOR">{ui("Operator")}</option>
                      <option value="ANALYST">{ui("Auditor")}</option>
                    </select>
                  </div>
                  <div className="flex h-10 items-center gap-2">
                    <Label
                      htmlFor={`account-active-${account.id}`}
                      data-help={ui("Inactive administrators cannot use Admin; their active sessions are revoked.")}
                    >{ui("Active")}</Label>
                    <Switch
                      id={`account-active-${account.id}`}
                      checked={draft.isActive}
                      disabled={immutable}
                      onCheckedChange={(checked) => {
                        setAccountDrafts((current) => ({
                          ...current,
                          [account.id]: { ...draft, isActive: checked },
                        }));
                      }}
                    />
                  </div>
                  <Button
                    variant="outline"
                    disabled={immutable || updateAccount.isPending}
                    onClick={() => {
                      updateAccount.mutate(account);
                    }}
                  >
                    {immutable ? ui("Protected") : ui("Save user")}
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-6 xl:grid-cols-3">
        {(permissions.data?.roles ?? []).map((role) => {
          const immutable = role.role === "SUPER_ADMIN";
          return (
            <Card key={role.role}>
              <CardHeader>
                <CardTitle>{role.label}</CardTitle>
                <CardDescription>
                  {immutable
                    ? ui("Full access; immutable safety role.")
                    : role.role === "OPERATOR"
                      ? ui("Operational access; destructive configuration is restricted by default.")
                      : ui("Read-only oversight by default.")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {permissions.data?.capabilities.map((capability) => {
                  const copy = CAPABILITY_COPY[capability] ?? {
                    label: capability,
                    description: `Controls ${capability}.`,
                  };
                  const id = `${role.role}-${capability}`;
                  return (
                    <div
                      key={capability}
                      className="flex items-center justify-between gap-3 rounded-md border p-3"
                    >
                      <Label htmlFor={id} data-help={ui(copy.description)} className="leading-snug">
                        {ui(copy.label)}
                      </Label>
                      <Switch
                        id={id}
                        checked={drafts[role.role]?.[capability] ?? false}
                        disabled={immutable}
                        onCheckedChange={(checked) => {
                          setDrafts((current) => ({
                            ...current,
                            [role.role]: { ...current[role.role], [capability]: checked },
                          }));
                        }}
                      />
                    </div>
                  );
                })}
                {!immutable && (
                  <Button
                    className="w-full"
                    disabled={save.isPending}
                    onClick={() => {
                      save.mutate(role.role as ConfigurableRole);
                    }}
                  >
                    {save.isPending ? ui("Saving…") : `${ui("Save")} ${role.label}`}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
