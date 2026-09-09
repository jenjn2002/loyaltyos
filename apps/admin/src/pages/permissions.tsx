import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { fetchApi } from "@/lib/api-client";

type Role = "SUPER_ADMIN" | "OPERATOR" | "ANALYST";
type ConfigurableRole = Exclude<Role, "SUPER_ADMIN">;
interface PermissionData {
  capabilities: string[];
  roles: { role: Role; label: string; permissions: Record<string, boolean> }[];
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
    description: "Version rates and approve, pay, reject or refund requests.",
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
    description: "Read campaigns, tiers, badges, coupons, segments and coalition data.",
  },
  "campaign.manage": {
    label: "Manage engagement",
    description: "Change campaigns, tiers, badges, coupons, segments and coalition configuration.",
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
};

export function PermissionsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, Record<string, boolean>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const permissions = useQuery({
    queryKey: ["admin", "permissions"],
    queryFn: () => fetchApi<PermissionData>("/admin/permissions"),
  });

  useEffect(() => {
    if (!permissions.data) return;
    setDrafts(
      Object.fromEntries(
        permissions.data.roles.map((role) => [role.role, { ...role.permissions }]),
      ),
    );
  }, [permissions.data]);

  const save = useMutation({
    mutationFn: (role: ConfigurableRole) =>
      fetchApi(`/admin/permissions/${role}`, {
        method: "PATCH",
        body: JSON.stringify({ permissions: drafts[role] ?? {} }),
      }),
    onSuccess: async () => {
      setNotice("Role permissions saved and audit logged.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "permissions"] });
    },
    onError: (error: Error) => {
      setNotice(error.message);
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <ShieldCheck /> Roles & permissions
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Owner always has every capability and cannot be locked out. Operator performs day-to-day
          work; Auditor is read-only by default. Overrides apply program-wide and are audit logged.
        </p>
      </div>
      {notice && (
        <div role="status" className="rounded-md border bg-muted p-3 text-sm">
          {notice}
        </div>
      )}
      {permissions.isError && (
        <div className="rounded-md border border-destructive p-3 text-sm text-destructive">
          Only an Owner with permission-management access can open this page.
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-3">
        {(permissions.data?.roles ?? []).map((role) => {
          const immutable = role.role === "SUPER_ADMIN";
          return (
            <Card key={role.role}>
              <CardHeader>
                <CardTitle>{role.label}</CardTitle>
                <CardDescription>
                  {immutable
                    ? "Full access; immutable safety role."
                    : role.role === "OPERATOR"
                      ? "Operational access; destructive configuration is restricted by default."
                      : "Read-only oversight by default."}
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
                      <Label htmlFor={id} data-help={copy.description} className="leading-snug">
                        {copy.label}
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
                    {save.isPending ? "Saving…" : `Save ${role.label}`}
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
