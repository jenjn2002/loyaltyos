import { ui } from "@/lib/ui-text";
import { useQuery } from "@tanstack/react-query";
import { Download, FileSpreadsheet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { fetchApi, fetchApiCsv } from "@/lib/api-client";

interface ExportField {
  key: string;
  label: string;
}

interface ExportDataset {
  key: string;
  label: string;
  description: string;
  fields: ExportField[];
}
const DATASET_LABELS: Record<string, string> = {
  point_transactions: "Point wallet transactions (configured point types)",
  credit_transactions: "P-credit / R-credit wallet transactions",
  point_exchange_requests: "Point-type exchange requests",
  credit_exchange_requests: "P-credit / R-credit payout requests",
  bank_cycles: "Point-type bank cycles",
  credit_bank_cycles: "P-credit / R-credit bank cycles",
  bank_transactions: "Point-type bank transactions",
  credit_bank_transactions: "P-credit / R-credit bank transactions",
};

const DATASET_GROUPS: Array<{ label: string; keys: string[] }> = [
  { label: "Members and profile data", keys: ["members", "member_fields"] },
  { label: "Points, wallets and banks", keys: [
    "point_transactions", "credit_transactions", "point_exchange_requests", "credit_exchange_requests",
    "point_types", "point_transfer_rules", "point_issuance_rules", "bank_cycles", "bank_transactions",
    "credit_bank_cycles", "credit_bank_transactions",
  ] },
  { label: "Campaigns, events and audience", keys: [
    "campaigns", "campaign_issuance", "events", "check_ins", "segments", "tiers", "member_tiers", "badges", "member_badges",
  ] },
  { label: "Rewards and recognition", keys: [
    "coupons", "coupon_redemptions", "recognition_categories", "rewards", "reward_redemptions",
  ] },
  { label: "Approvals, operations and notifications", keys: [
    "approval_requests", "workflows", "logs", "notification_templates", "notifications",
  ] },
  { label: "Other connected features", keys: ["gift_card_batches", "coalition_transactions"] },
];

interface ExportCatalog {
  datasets: ExportDataset[];
}

function safeFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "data";
}

export function DataExportPage(): JSX.Element {
  const { i18n } = useTranslation();
  const catalog = useQuery({
    queryKey: ["admin-export-catalog"],
    queryFn: () => fetchApi<ExportCatalog>("/admin/exports/catalog"),
  });
  const datasets = catalog.data?.datasets ?? [];
  const [datasetKey, setDatasetKey] = useState("");
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dataset = useMemo(
    () => datasets.find((item) => item.key === datasetKey),
    [datasetKey, datasets],
  );

  useEffect(() => {
    if (!datasetKey && datasets.length > 0) setDatasetKey(datasets[0]?.key ?? "");
  }, [datasetKey, datasets]);

  useEffect(() => {
    setSelectedFields(dataset?.fields.map((field) => field.key) ?? []);
    setError("");
    setNotice("");
  }, [dataset]);

  async function exportCsv(): Promise<void> {
    if (!dataset || selectedFields.length === 0) return;
    setIsExporting(true);
    setError("");
    setNotice("");
    try {
      const result = await fetchApiCsv("/admin/exports", {
        dataset: dataset.key,
        fields: selectedFields,
        locale: i18n.language === "en-US" ? "en-US" : "vi-VN",
      });
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `loyaltyos-${safeFilename(dataset.key)}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(`${ui("Export complete")}: ${result.rowCount} ${ui("rows")}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : ui("Export failed"));
    } finally {
      setIsExporting(false);
    }
  }

  function toggleField(fieldKey: string, checked: boolean): void {
    setSelectedFields((current) =>
      checked ? [...new Set([...current, fieldKey])] : current.filter((key) => key !== fieldKey),
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{ui("Data export")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {ui("Choose a data type and the readable fields to include in your CSV file.")}
        </p>
      </div>

      {catalog.isLoading && <p className="text-sm text-muted-foreground">{ui("Loading export options…")}</p>}
      {catalog.isError && <p className="text-sm text-destructive">{ui("Could not load export options.")}</p>}
      {datasets.length === 0 && !catalog.isLoading && !catalog.isError && (
        <p className="text-sm text-muted-foreground">{ui("No exportable data types are available for your role.")}</p>
      )}

      {dataset && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" />{ui("Configure export")}</CardTitle>
            <CardDescription>{ui("Exports are CSV files with human-readable column headings. Nested configuration JSON and authentication secrets are excluded.")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="export-dataset">{ui("Data type")}</Label>
              <select
                id="export-dataset"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={datasetKey}
                onChange={(event) => setDatasetKey(event.target.value)}
              >
                {DATASET_GROUPS.map((group) => {
                  const items = group.keys.map((key) => datasets.find((item) => item.key === key)).filter((item): item is ExportDataset => Boolean(item));
                  return items.length ? <optgroup key={group.label} label={ui(group.label)}>{items.map((item) => <option key={item.key} value={item.key}>{ui(DATASET_LABELS[item.key] ?? item.label)}</option>)}</optgroup> : null;
                })}
              </select>
              <p className="text-sm text-muted-foreground">{ui(dataset.description)}</p>
              <p className="text-xs text-muted-foreground">{ui("Related exports are grouped. Point-type exports use configured custom point types; P/R exports use the P-credit and R-credit wallets.")}</p>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-medium">{ui("Fields to export")}</h2>
                  <p className="text-xs text-muted-foreground">
                    {selectedFields.length} / {dataset.fields.length} {ui("fields selected")}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setSelectedFields(dataset.fields.map((field) => field.key))}>{ui("Select all")}</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setSelectedFields([])}>{ui("Clear selection")}</Button>
                </div>
              </div>
              <div className="grid gap-2 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-3">
                {dataset.fields.map((field) => (
                  <label key={field.key} className="flex min-h-8 cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedFields.includes(field.key)}
                      onCheckedChange={(checked) => toggleField(field.key, checked === true)}
                      aria-label={ui(field.label)}
                    />
                    <span>{ui(field.label)}</span>
                  </label>
                ))}
              </div>
            </div>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
            <Button type="button" onClick={() => void exportCsv()} disabled={isExporting || selectedFields.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              {isExporting ? ui("Exporting…") : ui("Export CSV")}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
