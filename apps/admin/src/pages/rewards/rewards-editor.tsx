import { ui } from "@/lib/ui-text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { fetchApi } from "@/lib/api-client";

interface PointType {
  id: string;
  code: string;
  name: string;
  unitLabel: string;
  redeemable: boolean;
  isActive: boolean;
  archivedAt: string | null;
}
interface Tier {
  id: string;
  name: string;
  rank: number;
}
interface Price {
  pointTypeId: string;
  amount: string;
}
interface Reward {
  name: string;
  description: string | null;
  stock: number | null;
  imageUrl: string | null;
  category: string | null;
  tierRequired: string | null;
  availableFrom: string | null;
  availableUntil: string | null;
  isActive: boolean;
  pointPrices: { pointTypeId: string; amount: number }[];
}

const CATEGORIES = [
  "DISCOUNT_FUTURE",
  "PHYSICAL_PRODUCT",
  "GIFT_CARD",
  "EXPERIENCE",
  "CHARITY_DONATION",
  "COALITION_TRANSFER",
];
const controlClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";

export function RewardsEditorPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [stock, setStock] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [category, setCategory] = useState("");
  const [tierRequired, setTierRequired] = useState("");
  const [availableFrom, setAvailableFrom] = useState("");
  const [availableUntil, setAvailableUntil] = useState("");
  const [isActive, setIsActive] = useState(false);
  const [prices, setPrices] = useState<Price[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const pointTypes = useQuery({
    queryKey: ["point-types", "reward-editor"],
    queryFn: () => fetchApi<PointType[]>("/admin/point-types"),
  });
  const redeemableTypes = (pointTypes.data ?? []).filter(
    (type) => type.redeemable && type.isActive && !type.archivedAt,
  );
  const tiers = useQuery({ queryKey: ["tiers"], queryFn: () => fetchApi<Tier[]>("/admin/tiers") });
  const existing = useQuery({
    queryKey: ["reward", "admin", id],
    queryFn: () => fetchApi<Reward>(`/admin/rewards/${id ?? ""}`),
    enabled: Boolean(id),
  });

  useEffect(() => {
    const reward = existing.data;
    if (!reward) return;
    setName(reward.name);
    setDescription(reward.description ?? "");
    setStock(reward.stock == null ? "" : String(reward.stock));
    setImageUrl(reward.imageUrl ?? "");
    setCategory(reward.category ?? "");
    setTierRequired(reward.tierRequired ?? "");
    setAvailableFrom(reward.availableFrom?.slice(0, 16) ?? "");
    setAvailableUntil(reward.availableUntil?.slice(0, 16) ?? "");
    setIsActive(reward.isActive);
    setPrices(
      reward.pointPrices.map((price) => ({
        pointTypeId: price.pointTypeId,
        amount: String(price.amount),
      })),
    );
  }, [existing.data]);

  useEffect(() => {
    if (!id && prices.length === 0 && redeemableTypes[0]) {
      setPrices([{ pointTypeId: redeemableTypes[0].id, amount: "100" }]);
    }
  }, [id, prices.length, redeemableTypes]);

  const save = useMutation({
    mutationFn: () =>
      fetchApi(id ? `/admin/rewards/${id}` : "/admin/rewards", {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          pointPrices: prices.map((price) => ({
            pointTypeId: price.pointTypeId,
            amount: Number(price.amount),
          })),
          stock: stock.trim() ? Number(stock) : null,
          imageUrl: imageUrl.trim() || null,
          category: category || null,
          tierRequired: tierRequired || null,
          availableFrom: availableFrom ? new Date(availableFrom).toISOString() : null,
          availableUntil: availableUntil ? new Date(availableUntil).toISOString() : null,
          isActive,
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["rewards"] });
      navigate("/rewards");
    },
    onError: (error: Error) => {
      setSubmitError(error.message);
    },
  });

  const addPrice = (): void => {
    const unused = redeemableTypes.find(
      (type) => !prices.some((price) => price.pointTypeId === type.id),
    );
    if (unused) setPrices((current) => [...current, { pointTypeId: unused.id, amount: "100" }]);
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/rewards">
            <ArrowLeft />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{id ? "Edit reward" : "New reward"}</h1>
          <p className="text-sm text-muted-foreground">{ui("Configure one or more accepted point types and prices.")}</p>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{ui("Reward details")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label htmlFor="reward-name" data-help={ui("Member-facing reward name.")}>{ui("Name")}</Label>
            <Input
              id="reward-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </div>
          <div className="md:col-span-2">
            <Label
              htmlFor="reward-description"
              data-help={ui("Member-facing details and fulfillment expectations.")}
            >{ui("Description")}</Label>
            <Textarea
              id="reward-description"
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
            />
          </div>
          <div>
            <Label
              htmlFor="reward-stock"
              data-help={ui("Available units; leave blank for unlimited inventory.")}
            >{ui("Stock")}</Label>
            <Input
              id="reward-stock"
              type="number"
              min="0"
              value={stock}
              onChange={(event) => {
                setStock(event.target.value);
              }}
              placeholder={ui("Unlimited")}
            />
          </div>
          <div>
            <Label
              htmlFor="reward-image"
              data-help={ui("Optional HTTPS image shown in the reward catalog.")}
            >{ui("Image URL")}</Label>
            <Input
              id="reward-image"
              type="url"
              value={imageUrl}
              onChange={(event) => {
                setImageUrl(event.target.value);
              }}
            />
          </div>
          <div>
            <Label htmlFor="reward-category" data-help={ui("Catalog and reporting category.")}>{ui("Category")}</Label>
            <Input
              id="reward-category"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
              }}
              list="reward-category-suggestions"
              placeholder={ui("e.g. food_drinks")}
            />
            <datalist id="reward-category-suggestions">
              {CATEGORIES.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </div>
          <div>
            <Label
              htmlFor="reward-tier"
              data-help={ui("Optional minimum tier name required for redemption.")}
            >{ui("Tier required")}</Label>
            <select
              id="reward-tier"
              className={controlClass}
              value={tierRequired}
              onChange={(event) => {
                setTierRequired(event.target.value);
              }}
            >
              <option value="">{ui("All tiers")}</option>
              {(tiers.data ?? []).map((tier) => (
                <option key={tier.id} value={tier.name}>
                  {tier.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label
              htmlFor="available-from"
              data-help={ui("Optional date and time when this reward becomes redeemable.")}
            >{ui("Available from")}</Label>
            <Input
              id="available-from"
              type="datetime-local"
              value={availableFrom}
              onChange={(event) => {
                setAvailableFrom(event.target.value);
              }}
            />
          </div>
          <div>
            <Label
              htmlFor="available-until"
              data-help={ui("Optional exclusive end date and time for redemption.")}
            >{ui("Available until")}</Label>
            <Input
              id="available-until"
              type="datetime-local"
              value={availableUntil}
              onChange={(event) => {
                setAvailableUntil(event.target.value);
              }}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3 md:col-span-2">
            <Label
              htmlFor="reward-active"
              data-help={ui("Publishes this reward when its availability window, stock and price rules also pass.")}
            >{ui("Active in catalog")}</Label>
            <Switch id="reward-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{ui("Accepted point prices")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {redeemableTypes.length === 0 && (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{ui("No active redeemable point type exists. Enable Redeem on a Point Type first.")}</p>
          )}
          {prices.map((price, index) => (
            <div
              key={`${price.pointTypeId}-${String(index)}`}
              className="grid items-end gap-3 rounded-md border p-3 sm:grid-cols-[2fr_1fr_auto]"
            >
              <div>
                <Label
                  htmlFor={`price-type-${String(index)}`}
                  data-help={ui("Point type accepted as payment for this reward.")}
                >{ui("Point type")}</Label>
                <select
                  id={`price-type-${String(index)}`}
                  className={controlClass}
                  value={price.pointTypeId}
                  onChange={(event) => {
                    setPrices((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, pointTypeId: event.target.value } : item,
                      ),
                    );
                  }}
                >
                  {redeemableTypes.map((type) => (
                    <option
                      key={type.id}
                      value={type.id}
                      disabled={prices.some(
                        (item, itemIndex) => itemIndex !== index && item.pointTypeId === type.id,
                      )}
                    >
                      {type.name} ({type.code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label
                  htmlFor={`price-amount-${String(index)}`}
                  data-help={ui("Exact amount deducted from this point type on redemption.")}
                >{ui("Price")}</Label>
                <Input
                  id={`price-amount-${String(index)}`}
                  type="number"
                  min="1"
                  value={price.amount}
                  onChange={(event) => {
                    setPrices((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, amount: event.target.value } : item,
                      ),
                    );
                  }}
                />
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={ui("Remove price")}
                disabled={prices.length === 1}
                onClick={() => {
                  setPrices((current) => current.filter((_, itemIndex) => itemIndex !== index));
                }}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={prices.length >= redeemableTypes.length}
            onClick={addPrice}
          >
            <Plus />{ui("Add accepted point type")}</Button>
        </CardContent>
      </Card>
      {submitError && (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      )}
      <div className="flex gap-3">
        <Button
          disabled={
            save.isPending ||
            !name.trim() ||
            prices.length === 0 ||
            prices.some((price) => !price.pointTypeId || Number(price.amount) <= 0)
          }
          onClick={() => {
            save.mutate();
          }}
        >
          <Save /> {save.isPending ? ui("Saving…") : ui("Save reward")}
        </Button>
        <Button variant="outline" asChild>
          <Link to="/rewards">{ui("Cancel")}</Link>
        </Button>
      </div>
    </div>
  );
}
