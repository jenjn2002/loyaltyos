import { ui } from "@/lib/ui-text";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import type { PaginatedResponse, Segment, SegmentMember } from "@/types";

export function SegmentsListPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [memberSegmentId, setMemberSegmentId] = useState<string | null>(null);
  const [memberPage, setMemberPage] = useState(1);
  const pageSize = 20;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["segments", page, typeFilter],
    queryFn: () => {
      const type = typeFilter !== "all" ? `&type=${typeFilter}` : "";
      return fetchApi<PaginatedResponse<Segment>>(
        `/admin/segments?page=${String(page)}&pageSize=${String(pageSize)}&isActive=true${type}`,
      );
    },
  });

  const { data: segmentMembers, isLoading: membersLoading } = useQuery({
    queryKey: ["segment-members", memberSegmentId, memberPage],
    queryFn: () =>
      fetchApi<PaginatedResponse<SegmentMember>>(
        `/admin/segments/${String(memberSegmentId)}/members?page=${String(memberPage)}&pageSize=20`,
      ),
    enabled: Boolean(memberSegmentId),
  });

  const handleDelete = async (id: string) => {
    await fetchApi(`/admin/segments/${id}`, { method: "DELETE" });
    void queryClient.invalidateQueries({ queryKey: ["segments"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t("segments.title")}</h1>
        <Button
          onClick={() => {
            navigate("/segments/new");
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          {t("segments.createSegment")}
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{ui("All Segments")}</CardTitle>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder={ui("Type")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{ui("All Types")}</SelectItem>
              <SelectItem value="DYNAMIC">{ui("Dynamic")}</SelectItem>
              <SelectItem value="STATIC">{ui("Static")}</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : isError || !data ? (
            <p className="text-destructive">{ui("Failed to load segments.")}</p>
          ) : data.items.length === 0 ? (
            <p className="text-muted-foreground">{t("common.noResults")}</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("common.name")}</TableHead>
                    <TableHead>{t("campaigns.type")}</TableHead>
                    <TableHead>{ui("Members")}</TableHead>
                    <TableHead>{t("common.status")}</TableHead>
                    <TableHead>{ui("Created")}</TableHead>
                    <TableHead>{ui("Created by")}</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{s.type}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {s.type === "STATIC" ? s.memberIds.length : ui("Dynamic")}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={
                            s.isActive
                              ? "bg-green-100 text-green-800"
                              : "bg-slate-100 text-slate-800"
                          }
                        >
                          {s.isActive ? t("common.active") : t("common.inactive")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(s.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-sm">
                        {s.createdBy ? <><p className="font-medium">{s.createdBy.name}</p><p className="text-xs text-muted-foreground">{s.createdBy.email}</p></> : <span className="text-muted-foreground">{ui("System / legacy")}</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            title={ui("View members")}
                            onClick={() => {
                              setMemberPage(1);
                              setMemberSegmentId(s.id);
                            }}
                          >
                            <Users className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              navigate(`/segments/${s.id}/edit`);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => {
                              void handleDelete(s.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {data.totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => {
                      setPage((p) => p - 1);
                    }}
                  >
                    {t("common.previous")}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {page} of {data.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= data.totalPages}
                    onClick={() => {
                      setPage((p) => p + 1);
                    }}
                  >
                    {t("common.next")}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(memberSegmentId)}
        onOpenChange={(open) => {
          if (!open) setMemberSegmentId(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{ui("Segment members")}</DialogTitle>
            <DialogDescription>{ui("Members currently included in this segment.")}</DialogDescription>
          </DialogHeader>
          {membersLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !segmentMembers || segmentMembers.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{ui("No members in this segment.")}</p>
          ) : (
            <>
              <div className="max-h-[50vh] overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{ui("Member")}</TableHead>
                      <TableHead>{ui("Email")}</TableHead>
                      <TableHead>{ui("Department")}</TableHead>
                      <TableHead>{ui("Status")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {segmentMembers.items.map((member) => {
                      const name = [member.firstName, member.lastName].filter(Boolean).join(" ");
                      return (
                        <TableRow key={member.id}>
                          <TableCell className="font-medium">{name || member.email || member.id}</TableCell>
                          <TableCell>{member.email ?? "--"}</TableCell>
                          <TableCell>{member.department ?? "--"}</TableCell>
                          <TableCell>{member.status}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {segmentMembers.totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={memberPage <= 1}
                    onClick={() => {
                      setMemberPage((current) => current - 1);
                    }}
                  >
                    {t("common.previous")}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {memberPage} / {segmentMembers.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={memberPage >= segmentMembers.totalPages}
                    onClick={() => {
                      setMemberPage((current) => current + 1);
                    }}
                  >
                    {t("common.next")}
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
