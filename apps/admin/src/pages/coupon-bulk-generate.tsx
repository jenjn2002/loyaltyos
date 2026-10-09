import { ui } from "@/lib/ui-text";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Check, Copy, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchApi } from "@/lib/api-client";
import type { CouponDiscountType } from "@/types";

const CHANNELS = ["EMAIL", "SMS", "PUSH", "IN_APP", "WEBHOOK"] as const;

const optionalNumber = (numberSchema: z.ZodNumber) =>
  z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    numberSchema.optional(),
  );

const DISCOUNT_TYPES: { value: CouponDiscountType; label: string }[] = [
  { value: "PERCENTAGE", label: "Percentage" },
  { value: "FIXED", label: "Fixed Amount" },
  { value: "FREE_PRODUCT", label: "Free Product" },
  { value: "FREE_SHIPPING", label: "Free Shipping" },
  { value: "EXTRA_POINTS", label: "Extra Points" },
  { value: "EXPERIENCE", label: "Experience" },
];

const schema = z.object({
  prefix: z.string().max(10, "Code prefix must be 10 characters or fewer.").optional(),
  count: z.coerce
    .number()
    .int("Enter a whole number from 1 to 10,000.")
    .min(1, "Enter a whole number from 1 to 10,000.")
    .max(10000, "Enter a whole number from 1 to 10,000."),
  length: optionalNumber(
    z.coerce
      .number()
      .int("Code length must be a whole number from 6 to 20.")
      .min(6, "Code length must be a whole number from 6 to 20.")
      .max(20, "Code length must be a whole number from 6 to 20."),
  ),
  discountType: z.enum([
    "PERCENTAGE",
    "FIXED",
    "FREE_PRODUCT",
    "FREE_SHIPPING",
    "EXTRA_POINTS",
    "EXPERIENCE",
  ], { errorMap: () => ({ message: "Choose a valid discount type." }) }),
  discountValue: optionalNumber(
    z.coerce.number().min(0, "Enter a discount value of 0 or greater."),
  ),
  minPurchase: optionalNumber(
    z.coerce
      .number()
      .int("Minimum purchase must be a non-negative whole number.")
      .min(0, "Minimum purchase must be a non-negative whole number."),
  ),
  maxUses: optionalNumber(
    z.coerce
      .number()
      .int("Maximum uses must be a whole number of at least 1.")
      .min(1, "Maximum uses must be a whole number of at least 1."),
  ),
  maxUsesPerMember: optionalNumber(
    z.coerce
      .number()
      .int("Maximum uses per member must be a whole number of at least 1.")
      .min(1, "Maximum uses per member must be a whole number of at least 1."),
  ),
  isStackable: z.boolean().optional(),
  channels: z.array(z.string()).optional(),
  startsAt: z.string().optional(),
  expiresAt: z.string().optional(),
});

type FormData = z.infer<typeof schema>;
type FormFieldName = keyof FormData;

const FIELD_LABELS: Record<FormFieldName, string> = {
  prefix: "Code Prefix",
  count: "Number of Codes",
  length: "Code Length",
  discountType: "Discount Type",
  discountValue: "Discount Value",
  minPurchase: "Minimum Purchase (points)",
  maxUses: "Max Uses Per Coupon",
  maxUsesPerMember: "Max Uses Per Member",
  isStackable: "Stackable with points",
  channels: "Valid Channels",
  startsAt: "Start Date",
  expiresAt: "Expiry Date",
};

const FORM_FIELD_ORDER = Object.keys(FIELD_LABELS) as FormFieldName[];

export function CouponBulkGeneratePage(): JSX.Element {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const validationSummaryRef = useRef<HTMLDivElement>(null);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    shouldFocusError: false,
    defaultValues: {
      prefix: "",
      count: 100,
      length: 8,
      discountType: "PERCENTAGE",
      isStackable: false,
      channels: [],
    },
  });

  const fieldError = (name: FormFieldName): string | undefined => {
    const message = form.formState.errors[name]?.message;
    return typeof message === "string" ? ui(message) : undefined;
  };
  const errorText = (name: FormFieldName): JSX.Element | null => {
    const message = fieldError(name);
    return message ? (
      <p id={`${name}-error`} className="text-sm text-destructive">
        {message}
      </p>
    ) : null;
  };
  const invalidFields = FORM_FIELD_ORDER.flatMap((name) => {
    const message = fieldError(name);
    return message ? [{ name, label: ui(FIELD_LABELS[name]), message }] : [];
  });

  useEffect(() => {
    if (form.formState.submitCount > 0 && invalidFields.length > 0) {
      validationSummaryRef.current?.focus();
      validationSummaryRef.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [form.formState.submitCount, invalidFields.length]);

  const handleGenerate = async (values: FormData) => {
    setSaving(true);
    setError(null);
    try {
      const codes = await fetchApi<string[]>("/admin/coupons/generate", {
        method: "POST",
        body: JSON.stringify({
          ...values,
          channels: values.channels ?? [],
          startsAt: values.startsAt !== "" ? values.startsAt : undefined,
          expiresAt: values.expiresAt !== "" ? values.expiresAt : undefined,
          discountValue: Number.isFinite(values.discountValue) ? values.discountValue : undefined,
          minPurchase: Number.isFinite(values.minPurchase) ? values.minPurchase : undefined,
          maxUses: Number.isFinite(values.maxUses) ? values.maxUses : undefined,
          maxUsesPerMember: Number.isFinite(values.maxUsesPerMember)
            ? values.maxUsesPerMember
            : undefined,
        }),
      });
      setResults(codes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate coupons");
    } finally {
      setSaving(false);
    }
  };

  const handleCopyAll = async () => {
    if (!results) return;
    await navigator.clipboard.writeText(results.join("\n"));
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            navigate("/coupons");
          }}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />{ui("Back")}</Button>
        <h1 className="text-3xl font-bold">{ui("Bulk Generate Coupons")}</h1>
      </div>

      <form
        noValidate
        onSubmit={(e) => {
          void form.handleSubmit(handleGenerate)(e);
        }}
        className="space-y-6"
      >
        {form.formState.submitCount > 0 && invalidFields.length > 0 && (
          <div
            ref={validationSummaryRef}
            role="alert"
            tabIndex={-1}
            className="rounded-md border border-destructive/50 bg-destructive/5 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="font-medium">
              {ui("Please correct the highlighted fields before generating coupons.")}
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {invalidFields.map(({ name, label, message }) => (
                <li key={name}>
                  <button
                    type="button"
                    className="text-left underline underline-offset-2"
                    onClick={() => document.getElementById(name)?.focus()}
                  >
                    {label}: {message}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Card>
          <CardHeader>
            <CardTitle>{ui("Generation Settings")}</CardTitle>
            <CardDescription>{ui("Configure how many codes to generate and their format.")}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="prefix">{ui("Code Prefix")}</Label>
              <Input
                id="prefix"
                maxLength={10}
                aria-invalid={Boolean(fieldError("prefix"))}
                aria-describedby={fieldError("prefix") ? "prefix-help prefix-error" : "prefix-help"}
                {...form.register("prefix")}
                placeholder={ui("e.g. SUMMER")}
              />
              <p id="prefix-help" className="text-xs text-muted-foreground">
                {ui("Prefix is optional and can be up to 10 characters.")}
              </p>
              {errorText("prefix")}
            </div>
            <div className="space-y-2">
              <Label htmlFor="count">{ui("Number of Codes")}</Label>
              <Input
                id="count"
                type="number"
                aria-invalid={Boolean(fieldError("count"))}
                aria-describedby={fieldError("count") ? "count-error" : undefined}
                {...form.register("count")}
              />
              {errorText("count")}
            </div>
            <div className="space-y-2">
              <Label htmlFor="length">{ui("Code Length")}</Label>
              <Input
                id="length"
                type="number"
                aria-invalid={Boolean(fieldError("length"))}
                aria-describedby={fieldError("length") ? "length-error" : undefined}
                {...form.register("length")}
                placeholder="8"
              />
              {errorText("length")}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{ui("Discount Configuration")}</CardTitle>
            <CardDescription>{ui("Set the discount type, value, and usage limits.")}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="discountType">{ui("Discount Type")}</Label>
              <Select
                value={form.watch("discountType")}
                onValueChange={(v) => {
                  form.setValue("discountType", v as CouponDiscountType);
                }}
              >
                <SelectTrigger
                  id="discountType"
                  aria-invalid={Boolean(fieldError("discountType"))}
                  aria-describedby={fieldError("discountType") ? "discountType-error" : undefined}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DISCOUNT_TYPES.map((dt) => (
                    <SelectItem key={dt.value} value={dt.value}>
                      {ui(dt.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errorText("discountType")}
            </div>
            <div className="space-y-2">
              <Label htmlFor="discountValue">{ui("Discount Value")}</Label>
              <Input
                id="discountValue"
                type="number"
                step="0.01"
                aria-invalid={Boolean(fieldError("discountValue"))}
                aria-describedby={
                  fieldError("discountValue") ? "discountValue-error" : undefined
                }
                {...form.register("discountValue")}
              />
              {errorText("discountValue")}
            </div>
            <div className="space-y-2">
              <Label htmlFor="minPurchase">{ui("Minimum Purchase (points)")}</Label>
              <Input
                id="minPurchase"
                type="number"
                aria-invalid={Boolean(fieldError("minPurchase"))}
                aria-describedby={
                  fieldError("minPurchase") ? "minPurchase-error" : undefined
                }
                {...form.register("minPurchase")}
                placeholder="0"
              />
              {errorText("minPurchase")}
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxUses">{ui("Max Uses Per Coupon")}</Label>
              <Input
                id="maxUses"
                type="number"
                aria-invalid={Boolean(fieldError("maxUses"))}
                aria-describedby={fieldError("maxUses") ? "maxUses-error" : undefined}
                {...form.register("maxUses")}
                placeholder={ui("Unlimited")}
              />
              {errorText("maxUses")}
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxUsesPerMember">{ui("Max Uses Per Member")}</Label>
              <Input
                id="maxUsesPerMember"
                type="number"
                aria-invalid={Boolean(fieldError("maxUsesPerMember"))}
                aria-describedby={
                  fieldError("maxUsesPerMember") ? "maxUsesPerMember-error" : undefined
                }
                {...form.register("maxUsesPerMember")}
                placeholder="1"
              />
              {errorText("maxUsesPerMember")}
            </div>
            <div className="flex items-center justify-between self-end">
              <Label htmlFor="isStackable">{ui("Stackable with points")}</Label>
              <input
                id="isStackable"
                type="checkbox"
                checked={form.watch("isStackable")}
                onChange={(e) => {
                  form.setValue("isStackable", e.target.checked);
                }}
                className="h-4 w-4"
                aria-invalid={Boolean(fieldError("isStackable"))}
                aria-describedby={fieldError("isStackable") ? "isStackable-error" : undefined}
              />
              {errorText("isStackable")}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{ui("Channels & Schedule")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p id="channels-label" className="text-sm font-medium">{ui("Valid Channels")}</p>
              <div className="flex flex-wrap gap-4">
                {CHANNELS.map((ch) => (
                  <div key={ch} className="flex items-center gap-2">
                    <Checkbox
                      id={`gen-ch-${ch}`}
                      aria-labelledby="channels-label"
                      aria-invalid={Boolean(fieldError("channels"))}
                      aria-describedby={fieldError("channels") ? "channels-error" : undefined}
                      checked={(form.watch("channels") ?? []).includes(ch)}
                      onCheckedChange={(checked) => {
                        const current = form.watch("channels") ?? [];
                        if (checked) {
                          form.setValue("channels", [...current, ch]);
                        } else {
                          form.setValue(
                            "channels",
                            current.filter((c) => c !== ch),
                          );
                        }
                      }}
                    />
                    <Label htmlFor={`gen-ch-${ch}`}>{ch}</Label>
                  </div>
                ))}
              </div>
              {errorText("channels")}
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="startsAt">{ui("Start Date")}</Label>
                <Input
                  id="startsAt"
                  type="datetime-local"
                  aria-invalid={Boolean(fieldError("startsAt"))}
                  aria-describedby={fieldError("startsAt") ? "startsAt-error" : undefined}
                  {...form.register("startsAt")}
                />
                {errorText("startsAt")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="expiresAt">{ui("Expiry Date")}</Label>
                <Input
                  id="expiresAt"
                  type="datetime-local"
                  aria-invalid={Boolean(fieldError("expiresAt"))}
                  aria-describedby={fieldError("expiresAt") ? "expiresAt-error" : undefined}
                  {...form.register("expiresAt")}
                />
                {errorText("expiresAt")}
              </div>
            </div>
          </CardContent>
        </Card>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={saving} size="lg">
          <Save className="mr-2 h-4 w-4" />
          {saving ? "Generating..." : ui("Generate Coupons")}
        </Button>
      </form>

      {results && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Generated Codes ({results.length})</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void handleCopyAll();
              }}
            >
              {copied ? (
                <>
                  <Check className="mr-2 h-4 w-4" />{ui("Copied")}</>
              ) : (
                <>
                  <Copy className="mr-2 h-4 w-4" />{ui("Copy All")}</>
              )}
            </Button>
          </CardHeader>
          <CardContent>
            <div className="max-h-96 overflow-y-auto rounded-md border bg-muted p-4">
              <div className="grid grid-cols-2 gap-1 font-mono text-sm md:grid-cols-3 lg:grid-cols-4">
                {results.map((code, i) => (
                  <span key={i} className="rounded px-1 py-0.5 hover:bg-accent">
                    {code}
                  </span>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
