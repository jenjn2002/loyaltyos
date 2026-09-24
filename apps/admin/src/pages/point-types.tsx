import { ui } from "@/lib/ui-text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Award,
  ArchiveRestore,
  Banknote,
  CircleDollarSign,
  Coins,
  Copy,
  CreditCard,
  Gift,
  Heart,
  Landmark,
  Medal,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  Star,
  Trash2,
  Trophy,
  Upload,
  WalletCards,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { fetchApi } from "@/lib/api-client";

type ExpiryMode = "NEVER" | "AFTER_DAYS" | "FIXED_DATE" | "PER_GRANT";
type GiveSource = "BALANCE" | "ALLOWANCE" | "BOTH";
export type PointTypesView = "registry" | "editor";

interface TransferRule {
  id?: string;
  destinationPointTypeId: string;
  sourceAmount: number;
  destinationAmount: number;
  isActive: boolean;
  destinationType?: {
    id: string;
    code: string;
    name: string;
    isActive: boolean;
    archivedAt: string | null;
  };
}

interface PointType {
  id: string;
  code: string;
  name: string;
  unitLabel: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  expiryMode: ExpiryMode;
  expiryDays: number | null;
  fixedExpiryAt: string | null;
  expiryWarningDays: number[];
  allowNegativeBalance: boolean;
  allowManualAdjustment: boolean;
  transferable: boolean;
  redeemable: boolean;
  exchangeable: boolean;
  cashEligible: boolean;
  bankEnabled: boolean;
  giveEnabled: boolean;
  giveSource: GiveSource;
  allowanceAmount: number | null;
  allowanceCycleDays: number;
  allowanceCarryOver: boolean;
  pairLimit: number | null;
  pairLimitPeriodDays: number;
  requireGiveMessage: boolean;
  allowMultiRecipient: boolean;
  maxRecipients: number;
  showOnMemberProfile: boolean;
  showZeroBalance: boolean;
  isPrimary: boolean;
  sortOrder: number;
  isActive: boolean;
  archivedAt: string | null;
  metadata: Record<string, unknown> | null;
  outgoingTransferRules: TransferRule[];
  createdBy?: { id: string; name: string; email: string | null } | null;
}

interface RuleDraft {
  destinationPointTypeId: string;
  sourceAmount: string;
  destinationAmount: string;
  isActive: boolean;
}

interface Draft {
  code: string;
  name: string;
  unitLabel: string;
  description: string;
  icon: string;
  color: string;
  expiryMode: ExpiryMode;
  expiryDays: string;
  fixedExpiryAt: string;
  expiryWarningDays: string;
  allowNegativeBalance: boolean;
  allowManualAdjustment: boolean;
  transferable: boolean;
  redeemable: boolean;
  exchangeable: boolean;
  cashEligible: boolean;
  bankEnabled: boolean;
  giveEnabled: boolean;
  giveSource: GiveSource;
  allowanceAmount: string;
  allowanceCycleDays: string;
  allowanceCarryOver: boolean;
  pairLimit: string;
  pairLimitPeriodDays: string;
  requireGiveMessage: boolean;
  allowMultiRecipient: boolean;
  maxRecipients: string;
  showOnMemberProfile: boolean;
  showZeroBalance: boolean;
  isPrimary: boolean;
  sortOrder: string;
  isActive: boolean;
  metadata: string;
  transferRules: RuleDraft[];
}

const POINT_ICON_OPTIONS: Array<{ value: string; label: string; Icon: LucideIcon }> = [
  { value: "star", label: "Star", Icon: Star },
  { value: "wallet", label: "Wallet", Icon: WalletCards },
  { value: "gift", label: "Gift", Icon: Gift },
  { value: "trophy", label: "Trophy", Icon: Trophy },
  { value: "medal", label: "Medal", Icon: Medal },
  { value: "award", label: "Award", Icon: Award },
  { value: "coins", label: "Coins", Icon: Coins },
  { value: "credit-card", label: "Credit card", Icon: CreditCard },
  { value: "banknote", label: "Banknote", Icon: Banknote },
  { value: "landmark", label: "Bank", Icon: Landmark },
  { value: "circle-dollar-sign", label: "Dollar", Icon: CircleDollarSign },
  { value: "heart", label: "Heart", Icon: Heart },
  { value: "sparkles", label: "Sparkles", Icon: Sparkles },
  { value: "zap", label: "Lightning", Icon: Zap },
];

function isImageIcon(value: string): boolean {
  return value.startsWith("data:image/") || /^https?:\/\//i.test(value);
}

function iconChoice(value: string): string {
  if (!value) return "";
  if (isImageIcon(value)) return "__uploaded__";
  if (POINT_ICON_OPTIONS.some((option) => option.value === value)) return value;
  return "__custom__";
}

function PointTypeIcon({ icon, className = "h-5 w-5" }: { icon: string | null; className?: string }): JSX.Element {
  if (icon && isImageIcon(icon)) {
    return <img src={icon} alt="" className={`${className} rounded object-cover`} />;
  }
  const preset = POINT_ICON_OPTIONS.find((option) => option.value === icon);
  if (preset) {
    const Icon = preset.Icon;
    return <Icon className={className} aria-hidden="true" />;
  }
  if (icon && icon.length <= 8) {
    return <span className={`${className} inline-flex items-center justify-center text-base`} aria-hidden="true">{icon}</span>;
  }
  return <WalletCards className={className} aria-hidden="true" />;
}

function imageFileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Unsupported image type"));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      reject(new Error("Image must be 5 MB or smaller"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read image"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Unable to decode image"));
      image.onload = () => {
        const maxDimension = 256;
        const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
        const scale = longestSide > maxDimension ? maxDimension / longestSide : 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Unable to process image"));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error("Unable to encode image"));
            return;
          }
          const output = new FileReader();
          output.onerror = () => reject(new Error("Unable to encode image"));
          output.onload = () => resolve(String(output.result));
          output.readAsDataURL(blob);
        }, "image/png");
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

const blankDraft: Draft = {
  code: "",
  name: "",
  unitLabel: "points",
  description: "",
  icon: "",
  color: "#7c3aed",
  expiryMode: "NEVER",
  expiryDays: "365",
  fixedExpiryAt: "",
  expiryWarningDays: "30, 7",
  allowNegativeBalance: false,
  allowManualAdjustment: true,
  transferable: false,
  redeemable: false,
  exchangeable: false,
  cashEligible: false,
  bankEnabled: false,
  giveEnabled: false,
  giveSource: "BALANCE",
  allowanceAmount: "0",
  allowanceCycleDays: "30",
  allowanceCarryOver: false,
  pairLimit: "",
  pairLimitPeriodDays: "30",
  requireGiveMessage: true,
  allowMultiRecipient: true,
  maxRecipients: "500",
  showOnMemberProfile: true,
  showZeroBalance: true,
  isPrimary: false,
  sortOrder: "0",
  isActive: true,
  metadata: "{}",
  transferRules: [],
};

function asDateInput(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}

function draftFrom(pointType: PointType): Draft {
  return {
    code: pointType.code,
    name: pointType.name,
    unitLabel: pointType.unitLabel,
    description: pointType.description ?? "",
    icon: pointType.icon ?? "",
    color: pointType.color ?? "",
    expiryMode: pointType.expiryMode,
    expiryDays: pointType.expiryDays == null ? "" : String(pointType.expiryDays),
    fixedExpiryAt: asDateInput(pointType.fixedExpiryAt),
    expiryWarningDays: pointType.expiryWarningDays.join(", "),
    allowNegativeBalance: pointType.allowNegativeBalance,
    allowManualAdjustment: pointType.allowManualAdjustment,
    transferable: pointType.transferable,
    redeemable: pointType.redeemable,
    exchangeable: pointType.exchangeable,
    cashEligible: pointType.cashEligible,
    bankEnabled: pointType.bankEnabled,
    giveEnabled: pointType.giveEnabled,
    giveSource: pointType.giveSource,
    allowanceAmount: pointType.allowanceAmount == null ? "" : String(pointType.allowanceAmount),
    allowanceCycleDays: String(pointType.allowanceCycleDays),
    allowanceCarryOver: pointType.allowanceCarryOver,
    pairLimit: pointType.pairLimit == null ? "" : String(pointType.pairLimit),
    pairLimitPeriodDays: String(pointType.pairLimitPeriodDays),
    requireGiveMessage: pointType.requireGiveMessage,
    allowMultiRecipient: pointType.allowMultiRecipient,
    maxRecipients: String(pointType.maxRecipients),
    showOnMemberProfile: pointType.showOnMemberProfile,
    showZeroBalance: pointType.showZeroBalance,
    isPrimary: pointType.isPrimary,
    sortOrder: String(pointType.sortOrder),
    isActive: pointType.isActive,
    metadata: JSON.stringify(pointType.metadata ?? {}, null, 2),
    transferRules: pointType.outgoingTransferRules.map((rule) => ({
      destinationPointTypeId:
        rule.destinationPointTypeId === pointType.id ? "SELF" : rule.destinationPointTypeId,
      sourceAmount: String(rule.sourceAmount),
      destinationAmount: String(rule.destinationAmount),
      isActive: rule.isActive,
    })),
  };
}

function nullableInt(value: string): number | null {
  return value.trim() ? Number(value) : null;
}

function Field({
  id,
  label,
  help,
  children,
  className = "",
}: {
  id: string;
  label: string;
  help: string;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={className}>
      <Label htmlFor={id} data-help={help} className="mb-1.5 block">
        {label}
      </Label>
      {children}
    </div>
  );
}

function Toggle({
  id,
  label,
  help,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string;
  label: string;
  help: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <div className="flex min-h-16 items-center justify-between gap-3 rounded-md border p-3">
      <Label htmlFor={id} data-help={help} className="leading-snug">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

export function PointTypesPage({ view = "registry" }: { view?: PointTypesView }): JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { id: routePointTypeId } = useParams<{ id: string }>();
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [iconUploadError, setIconUploadError] = useState<string | null>(null);

  const pointTypes = useQuery({
    queryKey: ["point-types", "admin"],
    queryFn: () => fetchApi<PointType[]>("/admin/point-types"),
  });
  const activeTypes = useMemo(
    () => (pointTypes.data ?? []).filter((type) => !type.archivedAt),
    [pointTypes.data],
  );
  const selected = (pointTypes.data ?? []).find((type) => type.id === editingId);

  useEffect(() => {
    if (view !== "editor") return;
    if (!routePointTypeId) {
      if (editingId !== null) {
        setEditingId(null);
        setDraft({ ...blankDraft, transferRules: [] });
      }
      return;
    }
    const pointType = (pointTypes.data ?? []).find((item) => item.id === routePointTypeId);
    if (pointType && editingId !== pointType.id) {
      setEditingId(pointType.id);
      setDraft(draftFrom(pointType));
    }
  }, [editingId, pointTypes.data, routePointTypeId, view]);

  const update = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const reset = (): void => {
    setEditingId(null);
    setDraft({ ...blankDraft, transferRules: [] });
    setIconUploadError(null);
    if (view === "editor") navigate("/point-types");
  };

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ["point-types"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      let metadata: Record<string, unknown>;
      try {
        metadata = JSON.parse(draft.metadata) as Record<string, unknown>;
      } catch {
        throw new Error("Advanced metadata must be valid JSON.");
      }
      const expiryWarningDays = draft.expiryWarningDays
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value >= 0);
      const body = {
        code: draft.code.trim().toUpperCase(),
        name: draft.name.trim(),
        unitLabel: draft.unitLabel.trim(),
        description: draft.description.trim() || null,
        icon: draft.icon.trim() || null,
        color: draft.color.trim() || null,
        expiryMode: draft.expiryMode,
        expiryDays: draft.expiryMode === "AFTER_DAYS" ? nullableInt(draft.expiryDays) : null,
        fixedExpiryAt:
          draft.expiryMode === "FIXED_DATE" && draft.fixedExpiryAt
            ? new Date(`${draft.fixedExpiryAt}T23:59:59.999Z`).toISOString()
            : null,
        expiryWarningDays,
        allowNegativeBalance: draft.allowNegativeBalance,
        allowManualAdjustment: draft.allowManualAdjustment,
        // `transferable` is retained as a storage compatibility field. Give is
        // the single user-facing switch so administrators do not have to keep
        // two overlapping capabilities in sync.
        transferable: draft.giveEnabled,
        redeemable: draft.redeemable,
        exchangeable: draft.exchangeable,
        cashEligible: draft.cashEligible,
        bankEnabled: draft.bankEnabled,
        giveEnabled: draft.giveEnabled,
        giveSource: draft.giveSource,
        allowanceAmount:
          draft.giveEnabled && (draft.giveSource === "ALLOWANCE" || draft.giveSource === "BOTH")
            ? nullableInt(draft.allowanceAmount)
            : null,
        allowanceCycleDays: Number(draft.allowanceCycleDays),
        allowanceCarryOver: draft.allowanceCarryOver,
        pairLimit: nullableInt(draft.pairLimit),
        pairLimitPeriodDays: Number(draft.pairLimitPeriodDays),
        requireGiveMessage: draft.requireGiveMessage,
        allowMultiRecipient: draft.allowMultiRecipient,
        maxRecipients: draft.allowMultiRecipient ? Number(draft.maxRecipients) : 1,
        showOnMemberProfile: draft.showOnMemberProfile,
        showZeroBalance: draft.showZeroBalance,
        isPrimary: draft.isPrimary,
        sortOrder: Number(draft.sortOrder),
        isActive: draft.isActive,
        metadata,
        transferRules: draft.giveEnabled
          ? draft.transferRules.map((rule) => ({
              destinationPointTypeId: rule.destinationPointTypeId,
              sourceAmount: Number(rule.sourceAmount),
              destinationAmount: Number(rule.destinationAmount),
              isActive: rule.isActive,
            }))
          : [],
      };
      return fetchApi<PointType>(
        editingId ? `/admin/point-types/${editingId}` : "/admin/point-types",
        {
          method: editingId ? "PATCH" : "POST",
          body: JSON.stringify(body),
        },
      );
    },
    onSuccess: async (saved) => {
      setNotice(`${saved.name} saved.`);
      reset();
      await refresh();
    },
    onError: (error: Error) => {
      setNotice(error.message);
    },
  });

  const applyTemplate = useMutation({
    mutationFn: () =>
      fetchApi("/admin/point-types/templates/credit-recognition/apply", { method: "POST" }),
    onSuccess: async () => {
      setNotice("Credit & Recognition template applied. P and R remain fully editable.");
      await refresh();
    },
    onError: (error: Error) => {
      setNotice(error.message);
    },
  });

  const remove = useMutation({
    mutationFn: (pointType: PointType) =>
      fetchApi<{ mode: "DELETED" | "ARCHIVED" }>(`/admin/point-types/${pointType.id}`, {
        method: "DELETE",
      }),
    onSuccess: async (result) => {
      setNotice(
        result.mode === "DELETED"
          ? "Unused point type permanently deleted."
          : "Point type archived because it has a balance or business history.",
      );
      reset();
      await refresh();
    },
    onError: (error: Error) => {
      setNotice(error.message);
    },
  });

  const restore = useMutation({
    mutationFn: (id: string) => fetchApi(`/admin/point-types/${id}/restore`, { method: "POST" }),
    onSuccess: async () => {
      setNotice("Point type restored.");
      await refresh();
    },
    onError: (error: Error) => {
      setNotice(error.message);
    },
  });

  const clone = useMutation({
    mutationFn: ({ pointType, code, name }: { pointType: PointType; code: string; name: string }) =>
      fetchApi(`/admin/point-types/${pointType.id}/clone`, {
        method: "POST",
        body: JSON.stringify({ code, name }),
      }),
    onSuccess: async () => {
      setNotice("Point type cloned. Review the cloned transfer matrix before launch.");
      await refresh();
    },
    onError: (error: Error) => {
      setNotice(error.message);
    },
  });

  const expire = useMutation({
    mutationFn: (pointTypeId: string) =>
      fetchApi<{ expired: number; runId: string | null }>("/admin/credits/expire", {
        method: "POST",
        body: JSON.stringify({ pointTypeId }),
      }),
    onSuccess: async (result) => {
      setNotice(`${String(result.expired)} ${ui("expired lot(s) processed.")}`);
      await refresh();
    },
    onError: (error: Error) => {
      setNotice(error.message);
    },
  });

  const resetExpire = useMutation({
    mutationFn: (pointTypeId: string) =>
      fetchApi<{ restored: number; runId: string }>("/admin/credits/expire/reset", {
        method: "POST",
        body: JSON.stringify({ pointTypeId }),
      }),
    onSuccess: async (result) => {
      setNotice(`${String(result.restored)} ${ui("expired point(s) restored.")}`);
      await refresh();
    },
    onError: (error: Error) => {
      setNotice(error.message);
    },
  });

  const addRule = (): void => {
    setDraft((current) => ({
      ...current,
      transferable: true,
      giveEnabled: true,
      transferRules: [
        ...current.transferRules,
        {
          destinationPointTypeId: "SELF",
          sourceAmount: "1",
          destinationAmount: "1",
          isActive: true,
        },
      ],
    }));
  };

  const updateRule = <K extends keyof RuleDraft>(
    index: number,
    key: K,
    value: RuleDraft[K],
  ): void => {
    setDraft((current) => ({
      ...current,
      transferRules: current.transferRules.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, [key]: value } : rule,
      ),
    }));
  };

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Settings2 className="h-6 w-6" />
            {view === "registry"
              ? "Point type registry"
              : editingId
                ? `Edit ${selected?.name ?? ui("point type")}`
                : "Create point type"}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {view === "registry"
              ? "Review all configured wallet types, their lifecycle and allowed transfer paths."
              : "Configure identity, expiry, visibility, operations and the explicit Give transfer matrix."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {view === "registry" ? (
            <>
              <Button
                variant="outline"
                disabled={applyTemplate.isPending}
                onClick={() => {
                  applyTemplate.mutate();
                }}
              >{ui("Apply optional P/R template")}</Button>
              <Button
                onClick={() => {
                  navigate("/point-types/new");
                }}
              >
                <Plus />{ui("Create point type")}</Button>
            </>
          ) : (
            <Button variant="outline" onClick={reset}>{ui("Back to registry")}</Button>
          )}
        </div>
      </div>

      {notice && (
        <div role="status" className="rounded-md border bg-muted p-3 text-sm">
          {notice}
        </div>
      )}

      {view === "editor" && (
        <Card>
          <CardHeader>
            <CardTitle>
              {editingId ? `Edit ${selected?.name ?? ui("point type")}` : "New point type"}
            </CardTitle>
            <CardDescription>{ui("Configure identity, lifecycle, member visibility and allowed business operations.")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-7">
            <section>
              <h2 className="mb-3 font-semibold">{ui("Identity")}</h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Field
                  id="point-code"
                  label={ui("Code")}
                  help={ui("Stable identifier used by APIs and bulk import columns such as point_MILES.")}
                >
                  <Input
                    id="point-code"
                    value={draft.code}
                    disabled={Boolean(editingId)}
                    onChange={(event) => {
                      update("code", event.target.value);
                    }}
                    placeholder="MILES"
                  />
                </Field>
                <Field
                  id="point-name"
                  label={ui("Name")}
                  help={ui("Member-facing and administrator-facing point type name.")}
                >
                  <Input
                    id="point-name"
                    value={draft.name}
                    onChange={(event) => {
                      update("name", event.target.value);
                    }}
                    placeholder={ui("Travel miles")}
                  />
                </Field>
                <Field
                  id="unit-label"
                  label={ui("Unit label")}
                  help={ui("Text displayed beside a wallet amount, for example miles or credits.")}
                >
                  <Input
                    id="unit-label"
                    value={draft.unitLabel}
                    onChange={(event) => {
                      update("unitLabel", event.target.value);
                    }}
                  />
                </Field>
                <Field
                  id="sort-order"
                  label={ui("Sort order")}
                  help={ui("Lower numbers appear first in Admin and Portal wallet lists.")}
                >
                  <Input
                    id="sort-order"
                    type="number"
                    value={draft.sortOrder}
                    onChange={(event) => {
                      update("sortOrder", event.target.value);
                    }}
                  />
                </Field>
                <Field
                  id="point-description"
                  label={ui("Description")}
                  help={ui("Explains what this balance represents and how members may use it.")}
                  className="md:col-span-2"
                >
                  <Textarea
                    id="point-description"
                    value={draft.description}
                    onChange={(event) => {
                      update("description", event.target.value);
                    }}
                  />
                </Field>
                <Field
                  id="point-icon"
                  label={ui("Icon")}
                  help={ui("Choose a built-in icon, enter a symbol, or upload an image for this point type.")}
                >
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <PointTypeIcon icon={draft.icon || null} className="h-6 w-6 shrink-0" />
                      <select
                        id="point-icon"
                        className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
                        value={iconChoice(draft.icon)}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (value === "__uploaded__") return;
                          if (value === "__custom__") {
                            update("icon", "");
                            setIconUploadError(null);
                            return;
                          }
                          update("icon", value);
                          setIconUploadError(null);
                        }}
                      >
                        <option value="">{ui("No icon")}</option>
                        {POINT_ICON_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {ui(option.label)}
                          </option>
                        ))}
                        {isImageIcon(draft.icon) && <option value="__uploaded__">{ui("Uploaded image")}</option>}
                        <option value="__custom__">{ui("Custom symbol or name")}</option>
                      </select>
                    </div>
                    {!isImageIcon(draft.icon) && (!draft.icon || iconChoice(draft.icon) === "__custom__") && (
                      <Input
                        aria-label={ui("Custom symbol or name")}
                        value={draft.icon}
                        onChange={(event) => {
                          update("icon", event.target.value);
                        }}
                        placeholder={ui("For example: ✨ or a custom icon name")}
                      />
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <label
                        htmlFor="point-icon-file"
                        className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted"
                      >
                        <Upload className="h-4 w-4" />
                        {ui("Upload image")}
                      </label>
                      <input
                        id="point-icon-file"
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;
                          const input = event.currentTarget;
                          setIconUploadError(null);
                          void imageFileToDataUrl(file)
                            .then((icon) => {
                              update("icon", icon);
                            })
                            .catch((error: unknown) => {
                              setIconUploadError(
                                error instanceof Error ? error.message : ui("Unable to upload image"),
                              );
                              input.value = "";
                            });
                        }}
                      />
                      {isImageIcon(draft.icon) && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            update("icon", "");
                            setIconUploadError(null);
                          }}
                        >
                          {ui("Remove image")}
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {ui("Choose an icon from the list or upload a JPG, PNG, GIF or WebP image. Images are resized automatically.")}
                    </p>
                    {iconUploadError && <p className="text-xs text-destructive">{iconUploadError}</p>}
                  </div>
                </Field>
                <Field
                  id="point-color"
                  label={ui("Color")}
                  help={ui("Optional CSS color used to distinguish this wallet.")}
                >
                  <Input
                    id="point-color"
                    type="color"
                    value={draft.color || "#7c3aed"}
                    onChange={(event) => {
                      update("color", event.target.value);
                    }}
                  />
                </Field>
              </div>
            </section>

            <section>
              <h2 className="mb-3 font-semibold">{ui("Expiry policy")}</h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Field
                  id="expiry-mode"
                  label={ui("Expiry mode")}
                  help={ui("Never, a fixed number of days from point creation, one fixed program date, or an expiry supplied per grant.")}
                >
                  <select
                    id="expiry-mode"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={draft.expiryMode}
                    onChange={(event) => {
                      update("expiryMode", event.target.value as ExpiryMode);
                    }}
                  >
                    <option value="NEVER">{ui("Never expires")}</option>
                    <option value="AFTER_DAYS">{ui("After a number of days from creation")}</option>
                    <option value="FIXED_DATE">{ui("Fixed date")}</option>
                    <option value="PER_GRANT">{ui("Per grant")}</option>
                  </select>
                </Field>
                <Field
                  id="expiry-days"
                  label={ui("Expiry days")}
                  help={ui("The point type expires this many days after it is created; every grant uses the same expiry date.")}
                >
                  <Input
                    id="expiry-days"
                    type="number"
                    min="1"
                    disabled={draft.expiryMode !== "AFTER_DAYS"}
                    value={draft.expiryDays}
                    onChange={(event) => {
                      update("expiryDays", event.target.value);
                    }}
                  />
                </Field>
                <Field
                  id="fixed-expiry"
                  label={ui("Fixed expiry date")}
                  help={ui("All grants use this exact end date when expiry mode is Fixed date.")}
                >
                  <Input
                    id="fixed-expiry"
                    type="date"
                    disabled={draft.expiryMode !== "FIXED_DATE"}
                    value={draft.fixedExpiryAt}
                    onChange={(event) => {
                      update("fixedExpiryAt", event.target.value);
                    }}
                  />
                </Field>
                <Field
                  id="warning-days"
                  label={ui("Expiry warning days")}
                  help={ui("Comma-separated reminder offsets, for example 30, 7, 1.")}
                >
                  <Input
                    id="warning-days"
                    value={draft.expiryWarningDays}
                    onChange={(event) => {
                      update("expiryWarningDays", event.target.value);
                    }}
                    placeholder="30, 7"
                  />
                </Field>
              </div>
            </section>

            <section>
              <h2 className="mb-3 font-semibold">{ui("Availability and visibility")}</h2>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <Toggle
                  id="point-active"
                  label={ui("Active")}
                  help={ui("Allows new operations with this type; turning it off keeps all balances and history.")}
                  checked={draft.isActive}
                  onCheckedChange={(checked) => {
                    setDraft((current) => ({
                      ...current,
                      isActive: checked,
                      isPrimary: checked ? current.isPrimary : false,
                    }));
                  }}
                />
                <Toggle
                  id="point-primary"
                  label={ui("Primary type")}
                  help={ui("Fallback used by events and integrations that omit pointTypeId. Only one type can be primary.")}
                  checked={draft.isPrimary}
                  onCheckedChange={(checked) => {
                    setDraft((current) => ({
                      ...current,
                      isPrimary: checked,
                      isActive: checked || current.isActive,
                    }));
                  }}
                />
                <Toggle
                  id="show-profile"
                  label={ui("Show on member profile")}
                  help={ui("Makes this wallet available to the member-facing Portal.")}
                  checked={draft.showOnMemberProfile}
                  onCheckedChange={(checked) => {
                    update("showOnMemberProfile", checked);
                  }}
                />
                <Toggle
                  id="show-zero"
                  label={ui("Show zero balance")}
                  help={ui("Shows the wallet even when the member has not received this type yet.")}
                  checked={draft.showZeroBalance}
                  onCheckedChange={(checked) => {
                    update("showZeroBalance", checked);
                  }}
                />
                <Toggle
                  id="negative-balance"
                  label={ui("Allow negative balance")}
                  help={ui("Permits debit below zero; normally disabled for stored-value programs.")}
                  checked={draft.allowNegativeBalance}
                  onCheckedChange={(checked) => {
                    update("allowNegativeBalance", checked);
                  }}
                />
                <Toggle
                  id="manual-adjustment"
                  label={ui("Allow manual adjustment")}
                  help={ui("Lets an authorized operator add or remove this balance with an audit reason.")}
                  checked={draft.allowManualAdjustment}
                  onCheckedChange={(checked) => {
                    update("allowManualAdjustment", checked);
                  }}
                />
              </div>
            </section>

            <section>
              <h2 className="mb-3 font-semibold">{ui("Capabilities")}</h2>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <Toggle
                  id="bank-enabled"
                  label={ui("Use credit bank")}
                  help={ui("Positive issuance must be funded from a governed central pool.")}
                  checked={draft.bankEnabled}
                  onCheckedChange={(checked) => {
                    update("bankEnabled", checked);
                  }}
                />
                <Toggle
                  id="give-enabled"
                  label={ui("Enable Give")}
                  help={ui("Allows member-to-member transfers only through the transfer matrix below.")}
                  checked={draft.giveEnabled}
                  onCheckedChange={(checked) => {
                    setDraft((current) => ({
                      ...current,
                      giveEnabled: checked,
                      transferable: checked,
                    }));
                  }}
                />
                <Toggle
                  id="redeemable"
                  label={ui("Redeemable")}
                  help={ui("Allows this type to be configured as a price for rewards.")}
                  checked={draft.redeemable}
                  onCheckedChange={(checked) => {
                    update("redeemable", checked);
                  }}
                />
                <Toggle
                  id="exchangeable"
                  label={ui("Exchangeable")}
                  help={ui("Allows members to submit exchange requests against versioned rates.")}
                  checked={draft.exchangeable}
                  onCheckedChange={(checked) => {
                    setDraft((current) => ({
                      ...current,
                      exchangeable: checked,
                      cashEligible: checked ? current.cashEligible : false,
                    }));
                  }}
                />
                <Toggle
                  id="cash-eligible"
                  label={ui("Cash eligible")}
                  help={ui("Allows cash payout rates; exchange must also be enabled.")}
                  checked={draft.cashEligible}
                  disabled={!draft.exchangeable}
                  onCheckedChange={(checked) => {
                    update("cashEligible", checked);
                  }}
                />
              </div>
            </section>

            {draft.giveEnabled && (
              <section className="space-y-4 rounded-lg border p-4">
                <div>
                  <h2 className="font-semibold">{ui("Give policy and transfer matrix")}</h2>
                  <p className="text-sm text-muted-foreground">
                    {ui("No destination is implicit. A source can transfer only to the types explicitly listed here, with the configured conversion ratio.")}
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <Field
                    id="give-source"
                    label={ui("Give source")}
                    help={ui("Choose owned balance, a renewable allowance, or let members explicitly choose either source for each Give.")}
                  >
                    <select
                      id="give-source"
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={draft.giveSource}
                      onChange={(event) => {
                        update("giveSource", event.target.value as GiveSource);
                      }}
                    >
                      <option value="BALANCE">{ui("Owned balance")}</option>
                      <option value="ALLOWANCE">{ui("Separate allowance")}</option>
                      <option value="BOTH">{ui("Member chooses balance or allowance")}</option>
                    </select>
                  </Field>
                  <Field
                    id="allowance-amount"
                    label={ui("Allowance per cycle")}
                    help={ui("Give budget allocated independently from owned balance each cycle.")}
                  >
                    <Input
                      id="allowance-amount"
                      type="number"
                      min="0"
                      disabled={draft.giveSource === "BALANCE"}
                      value={draft.allowanceAmount}
                      onChange={(event) => {
                        update("allowanceAmount", event.target.value);
                      }}
                    />
                  </Field>
                  <Field
                    id="allowance-cycle"
                    label={ui("Allowance cycle days")}
                    help={ui("Number of days before a fresh Give allowance is created.")}
                  >
                    <Input
                      id="allowance-cycle"
                      type="number"
                      min="1"
                      value={draft.allowanceCycleDays}
                      onChange={(event) => {
                        update("allowanceCycleDays", event.target.value);
                      }}
                    />
                  </Field>
                  <Field
                    id="max-recipients"
                    label={ui("Maximum recipients")}
                    help={ui("Maximum unique members accepted in one Give request.")}
                  >
                    <Input
                      id="max-recipients"
                      type="number"
                      min="1"
                      disabled={!draft.allowMultiRecipient}
                      value={draft.allowMultiRecipient ? draft.maxRecipients : "1"}
                      onChange={(event) => {
                        update("maxRecipients", event.target.value);
                      }}
                    />
                  </Field>
                  <Field
                    id="pair-limit"
                    label={ui("Pair limit")}
                    help={ui("Optional maximum one member may Give to the same recipient in the period.")}
                  >
                    <Input
                      id="pair-limit"
                      type="number"
                      min="1"
                      value={draft.pairLimit}
                      onChange={(event) => {
                        update("pairLimit", event.target.value);
                      }}
                      placeholder={ui("No limit")}
                    />
                  </Field>
                  <Field
                    id="pair-period"
                    label={ui("Pair limit period days")}
                    help={ui("Rolling window used to calculate the giver-to-recipient limit.")}
                  >
                    <Input
                      id="pair-period"
                      type="number"
                      min="1"
                      value={draft.pairLimitPeriodDays}
                      onChange={(event) => {
                        update("pairLimitPeriodDays", event.target.value);
                      }}
                    />
                  </Field>
                  <Toggle
                    id="carry-over"
                    label={ui("Carry over allowance")}
                    help={ui("Adds unused allowance to the next cycle instead of discarding it.")}
                    checked={draft.allowanceCarryOver}
                    disabled={draft.giveSource === "BALANCE"}
                    onCheckedChange={(checked) => {
                      update("allowanceCarryOver", checked);
                    }}
                  />
                  <Toggle
                    id="require-message"
                    label={ui("Require Give message")}
                    help={ui("Rejects Give operations that do not include a recognition message.")}
                    checked={draft.requireGiveMessage}
                    onCheckedChange={(checked) => {
                      update("requireGiveMessage", checked);
                    }}
                  />
                  <Toggle
                    id="multi-recipient"
                    label={ui("Allow multiple recipients")}
                    help={ui("Allows one request to recognize more than one unique member.")}
                    checked={draft.allowMultiRecipient}
                    onCheckedChange={(checked) => {
                      setDraft((current) => ({
                        ...current,
                        allowMultiRecipient: checked,
                        maxRecipients: checked ? current.maxRecipients : "1",
                      }));
                    }}
                  />
                </div>

                <div className="space-y-3">
                  {draft.transferRules.map((rule, index) => (
                    <div
                      key={`${rule.destinationPointTypeId}-${String(index)}`}
                      className="grid items-end gap-3 rounded-md bg-muted/40 p-3 md:grid-cols-[2fr_1fr_1fr_auto_auto]"
                    >
                      <Field
                        id={`rule-target-${String(index)}`}
                        label={ui("Destination type")}
                        help={ui("Only this point type may be received from the current source type.")}
                      >
                        <select
                          id={`rule-target-${String(index)}`}
                          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                          value={rule.destinationPointTypeId}
                          onChange={(event) => {
                            updateRule(index, "destinationPointTypeId", event.target.value);
                          }}
                        >
                          <option value="SELF">{ui("Same type (self)")}</option>
                          {activeTypes
                            .filter((type) => type.id !== editingId)
                            .map((type) => (
                              <option key={type.id} value={type.id}>
                                {type.name} ({type.code})
                              </option>
                            ))}
                        </select>
                      </Field>
                      <Field
                        id={`rule-source-${String(index)}`}
                        label={ui("Source amount")}
                        help={ui("Number of source units consumed for this ratio.")}
                      >
                        <Input
                          id={`rule-source-${String(index)}`}
                          type="number"
                          min="1"
                          value={rule.sourceAmount}
                          onChange={(event) => {
                            updateRule(index, "sourceAmount", event.target.value);
                          }}
                        />
                      </Field>
                      <Field
                        id={`rule-destination-${String(index)}`}
                        label={ui("Destination amount")}
                        help={ui("Number of destination units granted for each source ratio.")}
                      >
                        <Input
                          id={`rule-destination-${String(index)}`}
                          type="number"
                          min="1"
                          value={rule.destinationAmount}
                          onChange={(event) => {
                            updateRule(index, "destinationAmount", event.target.value);
                          }}
                        />
                      </Field>
                      <Toggle
                        id={`rule-active-${String(index)}`}
                        label={ui("Enabled")}
                        help={ui("Temporarily enables or disables this exact transfer path.")}
                        checked={rule.isActive}
                        onCheckedChange={(checked) => {
                          updateRule(index, "isActive", checked);
                        }}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={ui("Remove transfer rule")}
                        onClick={() => {
                          setDraft((current) => ({
                            ...current,
                            transferRules: current.transferRules.filter(
                              (_, ruleIndex) => ruleIndex !== index,
                            ),
                          }));
                        }}
                      >
                        <X />
                      </Button>
                    </div>
                  ))}
                  <Button type="button" variant="outline" onClick={addRule}>
                    <Plus />{ui("Add allowed destination")}</Button>
                </div>
              </section>
            )}

            <section>
              <Field
                id="point-metadata"
                label={ui("Advanced metadata (JSON)")}
                help={ui("Extension data for integrations and future custom behavior without adding fixed database columns.")}
              >
                <Textarea
                  id="point-metadata"
                  className="font-mono"
                  value={draft.metadata}
                  onChange={(event) => {
                    update("metadata", event.target.value);
                  }}
                />
              </Field>
            </section>

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={save.isPending || !draft.code.trim() || !draft.name.trim()}
                onClick={() => {
                  save.mutate();
                }}
              >
                <Save /> {save.isPending ? ui("Saving…") : ui("Save point type")}
              </Button>
              {editingId && (
                <Button variant="outline" onClick={reset}>{ui("Cancel")}</Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {view === "registry" && (
        <Card>
          <CardHeader>
            <CardTitle>{ui("Point type registry")}</CardTitle>
            <CardDescription>
              {ui("P and R have no special lock. Delete any unused type; a used type is safely archived and removed from member profiles.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {pointTypes.isLoading && <p className="text-sm text-muted-foreground">{ui("Loading…")}</p>}
            {!pointTypes.isLoading && (pointTypes.data ?? []).length === 0 && (
              <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{ui("No point types configured. Create one or apply the optional P/R template.")}</p>
            )}
            {(pointTypes.data ?? []).map((pointType) => (
              <div
                key={pointType.id}
                className={`rounded-md border p-4 ${pointType.archivedAt ? "opacity-60" : ""}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <PointTypeIcon icon={pointType.icon} className="h-5 w-5" />
                      <span className="font-semibold">{pointType.name}</span>
                      <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                        {pointType.code}
                      </span>
                      {pointType.isPrimary && (
                        <span className="rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground">{ui("Primary")}</span>
                      )}
                      {pointType.archivedAt ? (
                        <span className="rounded bg-muted px-2 py-0.5 text-xs">{ui("Archived")}</span>
                      ) : !pointType.isActive ? (
                        <span className="rounded bg-muted px-2 py-0.5 text-xs">{ui("Inactive")}</span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {pointType.description ?? ui("No description")}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {pointType.expiryMode.replaceAll("_", " ")} · Give{" "}
                      {pointType.giveEnabled ? `from ${pointType.giveSource.toLowerCase()}` : "off"}{" "}
                      · {pointType.outgoingTransferRules.length} allowed destination(s) · Portal{" "}
                      {pointType.showOnMemberProfile ? "visible" : "hidden"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{ui("Created by")}: {pointType.createdBy ? `${pointType.createdBy.name}${pointType.createdBy.email ? ` · ${pointType.createdBy.email}` : ""}` : ui("System / legacy")}</p>
                    {pointType.outgoingTransferRules.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {pointType.outgoingTransferRules.map((rule) => (
                          <span
                            key={rule.id ?? rule.destinationPointTypeId}
                            className="rounded border px-2 py-1 text-xs"
                          >
                            {pointType.code} {rule.sourceAmount}:{rule.destinationAmount}{" "}
                            {rule.destinationType?.code ?? "?"}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {pointType.archivedAt ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={restore.isPending}
                        onClick={() => {
                          restore.mutate(pointType.id);
                        }}
                      >
                        <ArchiveRestore />{ui("Restore")}</Button>
                    ) : (
                      <>
                        {pointType.isActive && pointType.expiryMode !== "NEVER" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={expire.isPending || resetExpire.isPending}
                              onClick={() => {
                                if (!window.confirm(ui("Run expiry for this point type now?"))) return;
                                expire.mutate(pointType.id);
                              }}
                            >
                              <RefreshCw />{ui("Run expiry")}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={expire.isPending || resetExpire.isPending}
                              onClick={() => {
                                if (!window.confirm(ui("Reset the most recent expiry run for this point type?"))) return;
                                resetExpire.mutate(pointType.id);
                              }}
                            >
                              <RefreshCw />{ui("Reset expiry")}
                            </Button>
                          </>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            navigate(`/point-types/${pointType.id}/edit`);
                          }}
                        >{ui("Edit")}</Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={clone.isPending}
                          onClick={() => {
                            const code = window.prompt(
                              "Code for the cloned type",
                              `${pointType.code}_COPY`,
                            );
                            if (!code) return;
                            const name = window.prompt(
                              "Name for the cloned type",
                              `${pointType.name} copy`,
                            );
                            if (name) clone.mutate({ pointType, code, name });
                          }}
                        >
                          <Copy />{ui("Clone")}</Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={remove.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete ${pointType.name}? Unused types are deleted; types with balances or history are archived.`,
                              )
                            )
                              remove.mutate(pointType);
                          }}
                        >
                          <Trash2 />{ui("Delete")}</Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
