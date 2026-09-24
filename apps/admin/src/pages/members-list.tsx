import { ui } from "@/lib/ui-text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, Eye, Plus } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchApi } from "@/lib/api-client";
import type { Member, PaginatedResponse } from "@/types";

interface NewMemberForm {
  email: string;
  firstName: string;
  lastName: string;
  externalId: string;
  phone: string;
  department: string;
  photoUrl: string;
  username: string;
  password: string;
}

const emptyMemberForm: NewMemberForm = {
  email: "",
  firstName: "",
  lastName: "",
  externalId: "",
  phone: "",
  department: "",
  photoUrl: "",
  username: "",
  password: "",
};

const MEMBER_EXPORT_PROFILE_COLUMNS = [
  "memberId",
  "email",
  "externalId",
  "phone",
  "firstName",
  "lastName",
  "department",
  "photoUrl",
  "status",
  "username",
] as const;

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function memberExportValue(
  member: Member,
  column: (typeof MEMBER_EXPORT_PROFILE_COLUMNS)[number],
): string | null | undefined {
  if (column === "memberId") return member.id;
  if (column === "email") return member.email;
  if (column === "externalId") return member.externalId;
  if (column === "phone") return member.phone;
  if (column === "firstName") return member.firstName;
  if (column === "lastName") return member.lastName;
  if (column === "department") return member.department;
  if (column === "photoUrl") return member.photoUrl;
  if (column === "status") return member.status;
  return member.username;
}

export function MembersListPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE" | "">("ACTIVE");
  const [department, setDepartment] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [newMember, setNewMember] = useState<NewMemberForm>(emptyMemberForm);
  const [selectedMembers, setSelectedMembers] = useState<Record<string, Member>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [search]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["members", page, debouncedSearch, status, department],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "20");
      if (debouncedSearch) {
        params.set("search", debouncedSearch);
      }
      if (status) params.set("status", status);
      if (department) params.set("department", department);
      return fetchApi<PaginatedResponse<Member>>(`/members?${params.toString()}`);
    },
  });

  const createMutation = useMutation({
    mutationFn: (form: NewMemberForm) =>
      fetchApi<Member>("/members", {
        method: "POST",
        body: JSON.stringify({
          email: form.email,
          ...(form.firstName ? { firstName: form.firstName } : {}),
          ...(form.lastName ? { lastName: form.lastName } : {}),
          ...(form.externalId ? { externalId: form.externalId } : {}),
          ...(form.phone ? { phone: form.phone } : {}),
          ...(form.department ? { department: form.department } : {}),
          ...(form.photoUrl ? { photoUrl: form.photoUrl } : {}),
          ...(form.username ? { username: form.username } : {}),
          ...(form.password ? { password: form.password } : {}),
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["members"] });
      setNewMember(emptyMemberForm);
      setCreateOpen(false);
    },
  });

  function handleCreate(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    createMutation.mutate(newMember);
  }

  const visibleMembers = data?.items ?? [];
  const selectedMemberList = Object.values(selectedMembers);
  const allVisibleSelected =
    visibleMembers.length > 0 && visibleMembers.every((member) => Boolean(selectedMembers[member.id]));
  const someVisibleSelected = visibleMembers.some((member) => Boolean(selectedMembers[member.id]));

  function toggleMember(member: Member, checked: boolean): void {
    setSelectedMembers((current) => {
      const next = { ...current };
      if (checked) next[member.id] = member;
      else delete next[member.id];
      return next;
    });
  }

  function toggleVisibleMembers(checked: boolean): void {
    setSelectedMembers((current) => {
      const next = { ...current };
      for (const member of visibleMembers) {
        if (checked) next[member.id] = member;
        else delete next[member.id];
      }
      return next;
    });
  }

  function exportSelectedMembers(): void {
    if (selectedMemberList.length === 0) return;
    const exportWallets = (() => {
      const byCode = new Map<string, NonNullable<Member["pointWallets"]>[number]>();
      for (const member of selectedMemberList) {
        for (const wallet of member.pointWallets ?? []) {
          if (!byCode.has(wallet.code)) byCode.set(wallet.code, wallet);
        }
      }
      return [...byCode.values()];
    })();
    const exportColumns = [
      ...MEMBER_EXPORT_PROFILE_COLUMNS,
      ...exportWallets.map((wallet) => `balance_${wallet.code}`),
      ...exportWallets
        .filter((wallet) => wallet.expiryMode === "PER_GRANT")
        .map((wallet) => `expiry_${wallet.code}`),
    ];
    const rows = selectedMemberList.map((member) =>
      exportColumns.map((column) => {
        if (column.startsWith("balance_")) {
          const code = column.slice("balance_".length);
          return csvCell(member.pointWallets?.find((wallet) => wallet.code === code)?.balance ?? 0);
        }
        if (column.startsWith("expiry_")) return "";
        return csvCell(memberExportValue(member, column as (typeof MEMBER_EXPORT_PROFILE_COLUMNS)[number]));
      }).join(","),
    );
    // Prefix UTF-8 BOM so Excel and other spreadsheet apps decode Vietnamese text correctly.
    const csv = `\uFEFF${[exportColumns.join(","), ...rows, ""].join("\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "loyaltyos-selected-members.csv";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t("members.title")}</h1>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={selectedMemberList.length === 0}
            onClick={exportSelectedMembers}
          >
            <Download className="mr-2 h-4 w-4" />
            {ui("Export selected")} ({selectedMemberList.length})
          </Button>
          <Button
            onClick={() => {
              createMutation.reset();
              setCreateOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t("members.addMember")}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <Input
              placeholder={ui("Search name, email, external ID or member ID")}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              className="max-w-sm"
            />
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as "ACTIVE" | "INACTIVE" | "");
                setPage(1);
              }}
            >
              <option value="ACTIVE">{ui("Active members")}</option>
              <option value="INACTIVE">{ui("Inactive members")}</option>
              <option value="">{ui("All status")}</option>
            </select>
            <Input
              placeholder={ui("Department")}
              value={department}
              onChange={(event) => {
                setDepartment(event.target.value);
                setPage(1);
              }}
              className="max-w-xs"
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>{t("common.email")}</TableHead>
                  <TableHead>{ui("Department")}</TableHead>
                  <TableHead>{ui("Member ID")}</TableHead>
                  <TableHead>{t("members.externalId")}</TableHead>
                  <TableHead>{t("members.balance")}</TableHead>
                    <TableHead>{t("members.joinedAt")}</TableHead>
                    <TableHead>{ui("Created by")}</TableHead>
                    <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                  <TableCell>
                      <Skeleton className="h-4 w-4" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-40" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-28" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-8 w-8" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : isError || !data ? (
            <div className="py-8 text-center">
              <p className="text-destructive">
                {error instanceof Error ? error.message : t("members.failedToLoad")}
              </p>
            </div>
          ) : data.items.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-muted-foreground">{t("members.noMembersFound")}</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label={ui("Select all visible members")}
                        checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                        onCheckedChange={(checked) => {
                          toggleVisibleMembers(checked === true);
                        }}
                      />
                    </TableHead>
                    <TableHead>{t("common.name")}</TableHead>
                    <TableHead>{t("common.email")}</TableHead>
                    <TableHead>{ui("Department")}</TableHead>
                    <TableHead>{ui("Member ID")}</TableHead>
                    <TableHead>{t("members.externalId")}</TableHead>
                    <TableHead>{t("members.balance")}</TableHead>
                    <TableHead>{t("members.joinedAt")}</TableHead>
                    <TableHead>{ui("Status")}</TableHead>
                    <TableHead>{ui("Created by")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell>
                        <Checkbox
                          aria-label={`${ui("Select member")} ${member.id}`}
                          checked={Boolean(selectedMembers[member.id])}
                          onCheckedChange={(checked) => {
                            toggleMember(member, checked === true);
                          }}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {member.photoUrl ? (
                            <img
                              src={member.photoUrl}
                              alt={ui("Member photo")}
                              className="h-8 w-8 rounded-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                              {`${member.firstName?.[0] ?? ""}${member.lastName?.[0] ?? ""}`.toUpperCase() || "?"}
                            </div>
                          )}
                          <span>
                            {(member.firstName ?? member.lastName)
                              ? `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim()
                              : t("members.na")}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{member.email ?? t("members.na")}</TableCell>
                      <TableCell>{member.department ?? "--"}</TableCell>
                      <TableCell>
                        <div className="flex max-w-44 items-center gap-1">
                          <code className="truncate text-xs" title={member.id}>
                            {member.id}
                          </code>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            aria-label={`Copy member ID ${member.id}`}
                            onClick={() => void navigator.clipboard.writeText(member.id)}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>{member.externalId ?? "--"}</TableCell>
                      <TableCell>
                        <div className="text-xs">
                          {(member.pointWallets ?? []).length === 0 ? (
                            <span className="text-muted-foreground">{ui("No configured wallets")}</span>
                          ) : (
                            member.pointWallets?.map((wallet) => (
                              <div key={wallet.pointTypeId}>
                                {wallet.code}: {wallet.balance.toLocaleString()}
                                {wallet.allowance
                                  ? ` · ${ui("Give remaining:")} ${wallet.allowance.remaining.toLocaleString()}`
                                  : ""}
                              </div>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{new Date(member.joinedAt).toLocaleDateString()}</TableCell>
                      <TableCell>{member.status ?? "ACTIVE"}</TableCell>
                      <TableCell className="text-sm">
                        {member.createdBy ? <><p className="font-medium">{member.createdBy.name}</p><p className="text-xs text-muted-foreground">{member.createdBy.email}</p></> : <span className="text-muted-foreground">{ui("System / legacy")}</span>}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            navigate(`/members/${member.id}`);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {t("common.pageInfo", {
                    page: data.page,
                    totalPages: data.totalPages,
                    total: data.total,
                  })}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={data.page <= 1}
                    onClick={() => {
                      setPage((p) => p - 1);
                    }}
                  >
                    {t("common.previous")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={data.page >= data.totalPages}
                    onClick={() => {
                      setPage((p) => p + 1);
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("members.createTitle")}</DialogTitle>
            <DialogDescription>{t("members.createDescription")}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleCreate}>
            <div className="space-y-2">
              <Label htmlFor="member-email">{t("common.email")}</Label>
              <Input
                id="member-email"
                type="email"
                required
                value={newMember.email}
                onChange={(event) => {
                  setNewMember((current) => ({ ...current, email: event.target.value }));
                }}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="member-first-name">{t("members.firstName")}</Label>
                <Input
                  id="member-first-name"
                  value={newMember.firstName}
                  onChange={(event) => {
                    setNewMember((current) => ({ ...current, firstName: event.target.value }));
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="member-last-name">{t("members.lastName")}</Label>
                <Input
                  id="member-last-name"
                  value={newMember.lastName}
                  onChange={(event) => {
                    setNewMember((current) => ({ ...current, lastName: event.target.value }));
                  }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="member-external-id">{t("members.externalIdOptional")}</Label>
              <Input
                id="member-external-id"
                value={newMember.externalId}
                onChange={(event) => {
                  setNewMember((current) => ({ ...current, externalId: event.target.value }));
                }}
                />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="member-phone">{ui("Phone")}</Label>
                <Input
                  id="member-phone"
                  value={newMember.phone}
                  onChange={(event) => {
                    setNewMember((current) => ({ ...current, phone: event.target.value }));
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="member-department">{ui("Department")}</Label>
                <Input
                  id="member-department"
                  value={newMember.department}
                  onChange={(event) => {
                    setNewMember((current) => ({ ...current, department: event.target.value }));
                  }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="member-photo-url">{ui("Photo URL (optional)")}</Label>
              <Input
                id="member-photo-url"
                type="url"
                value={newMember.photoUrl}
                onChange={(event) => {
                  setNewMember((current) => ({ ...current, photoUrl: event.target.value }));
                }}
                placeholder="https://"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="member-username">{t("members.username")}</Label>
                  <HelpTooltip label={t("members.portalUsernameHelpLabel")}>
                    {ui("Unique case-insensitively within this program. Leave blank to provision the member without portal login.")}
                  </HelpTooltip>
                </div>
                <Input
                  id="member-username"
                  autoComplete="off"
                  value={newMember.username}
                  onChange={(event) => {
                    setNewMember((current) => ({ ...current, username: event.target.value }));
                  }}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="member-password">{t("members.passwordOptional")}</Label>
                  <HelpTooltip label={t("members.resetPasswordHelpLabel")}>
                    {t("members.passwordHelp")}
                  </HelpTooltip>
                </div>
                <Input
                  id="member-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  value={newMember.password}
                  onChange={(event) => {
                    setNewMember((current) => ({ ...current, password: event.target.value }));
                  }}
                />
              </div>
            </div>
            {createMutation.isError && (
              <p className="text-sm text-destructive">
                {createMutation.error instanceof Error
                  ? createMutation.error.message
                  : t("members.createFailed")}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCreateOpen(false);
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? t("common.loading") : t("common.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
