import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Plus } from "lucide-react";
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
import type { Member, PaginatedResponse } from "@/types";

interface NewMemberForm {
  email: string;
  firstName: string;
  lastName: string;
  externalId: string;
}

const emptyMemberForm: NewMemberForm = {
  email: "",
  firstName: "",
  lastName: "",
  externalId: "",
};

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t("members.title")}</h1>
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

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <Input
              placeholder={t("members.searchPlaceholder")}
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
              <option value="ACTIVE">Active members</option>
              <option value="INACTIVE">Inactive members</option>
              <option value="">All status</option>
            </select>
            <Input
              placeholder="Department"
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
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>{t("common.email")}</TableHead>
                  <TableHead>{t("members.externalId")}</TableHead>
                  <TableHead>{t("members.balance")}</TableHead>
                  <TableHead>{t("members.joinedAt")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-4 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-40" />
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
                    <TableHead>{t("common.name")}</TableHead>
                    <TableHead>{t("common.email")}</TableHead>
                    <TableHead>{t("members.externalId")}</TableHead>
                    <TableHead>{t("members.balance")}</TableHead>
                    <TableHead>{t("members.joinedAt")}</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell className="font-medium">
                        {(member.firstName ?? member.lastName)
                          ? `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim()
                          : t("members.na")}
                      </TableCell>
                      <TableCell>{member.email ?? t("members.na")}</TableCell>
                      <TableCell>{member.externalId ?? "--"}</TableCell>
                      <TableCell>
                        <div className="text-xs">
                          {(member.pointWallets ?? []).length === 0 ? (
                            <span className="text-muted-foreground">No configured wallets</span>
                          ) : (
                            member.pointWallets?.map((wallet) => (
                              <div key={wallet.pointTypeId}>
                                {wallet.code}: {wallet.balance.toLocaleString()}
                                {wallet.allowance
                                  ? ` · Give ${wallet.allowance.remaining.toLocaleString()}`
                                  : ""}
                              </div>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{new Date(member.joinedAt).toLocaleDateString()}</TableCell>
                      <TableCell>{member.status ?? "ACTIVE"}</TableCell>
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
