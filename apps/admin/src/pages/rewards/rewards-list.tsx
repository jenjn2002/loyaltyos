import { ui } from "@/lib/ui-text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Grid3X3, List, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

interface Reward {
  id: string;
  name: string;
  description: string | null;
  pointsCost: number;
  stock: number | null;
  imageUrl: string | null;
  category: string | null;
  tierRequired: string | null;
  isActive: boolean;
  redemptions: { id: string; memberId: string }[];
  pointPrices: {
    pointTypeId: string;
    amount: number;
    pointType: { code: string; name: string; unitLabel: string };
  }[];
  createdAt: string;
  createdBy?: { id: string; name: string; email: string | null } | null;
}

interface RewardsResponse {
  items: Reward[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  DISCOUNT_FUTURE: "Discount",
  PHYSICAL_PRODUCT: "Product",
  GIFT_CARD: "Gift Card",
  EXPERIENCE: "Experience",
  CHARITY_DONATION: "Charity",
  COALITION_TRANSFER: "Coalition",
};

export function RewardsListPage(): JSX.Element {
  const [view, setView] = useState<"table" | "grid">("table");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<RewardsResponse>({
    queryKey: ["rewards", page, search],
    queryFn: () => fetchApi<RewardsResponse>(`/admin/rewards?page=${String(page)}&pageSize=20`),
  });
  const visibleRewards = (data?.items ?? []).filter((reward) =>
    reward.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const deleteReward = useMutation({
    mutationFn: (id: string) =>
      fetchApi(`/admin/rewards/${id}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["rewards"] });
    },
  });
  const handleDelete = (reward: Reward): void => {
    if (
      !window.confirm(
        `Delete “${reward.name}”? It will be removed from the catalog while redemption history is retained.`,
      )
    )
      return;
    deleteReward.mutate(reward.id);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{ui("Rewards")}</h1>
          <p className="text-sm text-muted-foreground">{ui("Manage your rewards catalog")}</p>
        </div>
        <Button asChild>
          <Link to="/rewards/new">
            <Plus className="mr-2 h-4 w-4" />{ui("New Reward")}</Link>
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={ui("Search rewards...")}
            className="pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="flex items-center rounded-md border">
          <Button
            variant={view === "table" ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              setView("table");
            }}
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant={view === "grid" ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              setView("grid");
            }}
          >
            <Grid3X3 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <RewardsSkeleton view={view} />
      ) : view === "table" ? (
        <RewardsTable
          rewards={visibleRewards}
          onEdit={(id) => {
            navigate(`/rewards/${id}/edit`);
          }}
          onDelete={handleDelete}
          deletingId={deleteReward.isPending ? deleteReward.variables : null}
        />
      ) : (
        <RewardsGrid
          rewards={visibleRewards}
          onEdit={(id) => {
            navigate(`/rewards/${id}/edit`);
          }}
          onDelete={handleDelete}
          deletingId={deleteReward.isPending ? deleteReward.variables : null}
        />
      )}

      {deleteReward.isError && (
        <p role="alert" className="text-sm text-destructive">{ui("Could not delete the reward. Please try again.")}</p>
      )}

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * 20 + 1} – {Math.min(page * 20, data.total)} of {data.total}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => {
                setPage((p) => p - 1);
              }}
            >{ui("Previous")}</Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.totalPages}
              onClick={() => {
                setPage((p) => p + 1);
              }}
            >{ui("Next")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function RewardsTable({
  rewards,
  onEdit,
  onDelete,
  deletingId,
}: {
  rewards: Reward[];
  onEdit: (id: string) => void;
  onDelete: (reward: Reward) => void;
  deletingId: string | null | undefined;
}): JSX.Element {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{ui("Name")}</TableHead>
            <TableHead>{ui("Category")}</TableHead>
            <TableHead>{ui("Cost")}</TableHead>
            <TableHead>{ui("Stock")}</TableHead>
            <TableHead>{ui("Tier")}</TableHead>
            <TableHead>{ui("Status")}</TableHead>
            <TableHead>{ui("Created by")}</TableHead>
            <TableHead className="w-20">{ui("Actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rewards.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground">{ui("No rewards found")}</TableCell>
            </TableRow>
          ) : (
            rewards.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>
                  {r.category ? (
                    <Badge variant="secondary">{CATEGORY_LABELS[r.category] ?? r.category}</Badge>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  {r.pointPrices
                    .map((price) => `${price.amount.toLocaleString()} ${price.pointType.unitLabel}`)
                    .join(" · ")}
                </TableCell>
                <TableCell>{r.stock ?? "∞"}</TableCell>
                <TableCell>{r.tierRequired ?? ui("All")}</TableCell>
                <TableCell>
                  <Badge variant={r.isActive ? "default" : "outline"}>
                    {r.isActive ? ui("Active") : "Draft"}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">
                  {r.createdBy ? <><p className="font-medium">{r.createdBy.name}</p><p className="text-xs text-muted-foreground">{r.createdBy.email}</p></> : <span className="text-muted-foreground">{ui("System / legacy")}</span>}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        onEdit(r.id);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" asChild>
                      <Link to={`/rewards/${r.id}/redemptions`}>
                        <List className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      aria-label={`Delete ${r.name}`}
                      title={ui("Delete reward")}
                      disabled={deletingId === r.id}
                      onClick={() => {
                        onDelete(r);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function RewardsGrid({
  rewards,
  onEdit,
  onDelete,
  deletingId,
}: {
  rewards: Reward[];
  onEdit: (id: string) => void;
  onDelete: (reward: Reward) => void;
  deletingId: string | null | undefined;
}): JSX.Element {
  if (rewards.length === 0) {
    return <p className="text-center text-muted-foreground py-12">{ui("No rewards found")}</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rewards.map((r) => (
        <Card key={r.id} className="overflow-hidden">
          <div className="aspect-video bg-muted flex items-center justify-center">
            {r.imageUrl ? (
              <img src={r.imageUrl} alt={r.name} className="h-full w-full object-cover" />
            ) : (
              <span className="text-4xl text-muted-foreground">&#127873;</span>
            )}
          </div>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold">{r.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {r.pointPrices
                    .map((price) => `${price.amount.toLocaleString()} ${price.pointType.unitLabel}`)
                    .join(" · ")}
                  {r.tierRequired ? ` · ${r.tierRequired}+` : ""}
                </p>
              </div>
              <Badge variant={r.isActive ? "default" : "outline"}>
                {r.isActive ? ui("Active") : "Draft"}
              </Badge>
            </div>
            {r.stock != null && (
              <p className="mt-2 text-xs text-muted-foreground">Stock: {r.stock}</p>
            )}
            <div className="mt-3 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onEdit(r.id);
                }}
              >
                <Pencil className="mr-1 h-3 w-3" />{ui("Edit")}</Button>
              <Button variant="outline" size="sm" asChild>
                <Link to={`/rewards/${r.id}/redemptions`}>
                  <List className="mr-1 h-3 w-3" />
                  Redemptions ({r.redemptions.length})
                </Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive"
                disabled={deletingId === r.id}
                onClick={() => {
                  onDelete(r);
                }}
              >
                <Trash2 className="mr-1 h-3 w-3" />{ui("Delete")}</Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function RewardsSkeleton({ view }: { view: "table" | "grid" }): JSX.Element {
  if (view === "grid") {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={String(i)}>
            <Skeleton className="aspect-video rounded-b-none" />
            <CardContent className="p-4 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={String(i)} className="h-12 w-full" />
      ))}
    </div>
  );
}
