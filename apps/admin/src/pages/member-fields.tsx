import { memberFieldLabel, ui } from "@/lib/ui-text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchApi } from "@/lib/api-client";

type FieldType = "TEXT" | "NUMBER" | "BOOLEAN" | "DATE" | "SELECT";
interface MemberField {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string[] | null;
  isActive: boolean;
  sortOrder: number;
  createdBy?: { id: string; name: string; email: string | null } | null;
}

const TYPES: { value: FieldType; label: string }[] = [
  { value: "TEXT", label: "Text" },
  { value: "NUMBER", label: "Number" },
  { value: "BOOLEAN", label: "Yes / No" },
  { value: "DATE", label: "Date" },
  { value: "SELECT", label: "Select" },
];

export function MemberFieldsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldType>("TEXT");
  const [options, setOptions] = useState("");
  const [required, setRequired] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fields = useQuery({
    queryKey: ["member-fields"],
    queryFn: () => fetchApi<MemberField[]>("/admin/member-fields"),
  });

  const create = useMutation({
    mutationFn: () =>
      fetchApi<MemberField>("/admin/member-fields", {
        method: "POST",
        body: JSON.stringify({
          key: key.trim().toLowerCase(),
          label: label.trim(),
          type,
          required,
          options: options.split(",").map((value) => value.trim()).filter(Boolean),
          sortOrder: fields.data?.length ?? 0,
        }),
      }),
    onSuccess: async () => {
      setKey("");
      setLabel("");
      setOptions("");
      setRequired(false);
      setNotice(ui("Member field created."));
      await queryClient.invalidateQueries({ queryKey: ["member-fields"] });
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const update = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      fetchApi<MemberField>(`/admin/member-fields/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["member-fields"] }),
    onError: (error: Error) => setNotice(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => fetchApi(`/admin/member-fields/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setNotice(ui("Member field archived."));
      await queryClient.invalidateQueries({ queryKey: ["member-fields"] });
    },
    onError: (error: Error) => setNotice(error.message),
  });

  return (
    <div className="space-y-6 pb-10">
      <div>
        <h1 className="text-3xl font-bold">{ui("Member fields")}</h1>
        <p className="mt-1 max-w-4xl text-sm text-muted-foreground">
          {ui("Create extra member attributes for profiles and segment conditions.")}
        </p>
      </div>
      {notice && <div role="status" className="rounded-md border bg-muted p-3 text-sm">{notice}</div>}
      <Card>
        <CardHeader>
          <CardTitle>{ui("Create member field")}</CardTitle>
          <CardDescription>{ui("Use a stable key; campaigns and segments can use this field later.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div><Label htmlFor="field-key">{ui("Key")}</Label><Input id="field-key" value={key} onChange={(event) => setKey(event.target.value)} placeholder="employment_type" /></div>
            <div><Label htmlFor="field-label">{ui("Label")}</Label><Input id="field-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder={ui("Employment type")} /></div>
            <div><Label htmlFor="field-type">{ui("Type")}</Label><select id="field-type" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={type} onChange={(event) => setType(event.target.value as FieldType)}>{TYPES.map((item) => <option key={item.value} value={item.value}>{ui(item.label)}</option>)}</select></div>
            <div><Label htmlFor="field-options">{ui("Options (comma separated)")}</Label><Input id="field-options" value={options} disabled={type !== "SELECT"} onChange={(event) => setOptions(event.target.value)} placeholder="Full-time, Part-time" /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={required} onChange={(event) => setRequired(event.target.checked)} />{ui("Required")}</label>
          <Button disabled={!key.trim() || !label.trim() || create.isPending} onClick={() => create.mutate()}><Plus />{ui("Create field")}</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{ui("Configured member fields")}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(fields.data ?? []).map((field) => (
            <div key={field.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
              <div><p className="font-medium">{memberFieldLabel(field)} <span className="font-mono text-xs text-muted-foreground">({field.key})</span></p><p className="text-xs text-muted-foreground">{ui(field.type === "BOOLEAN" ? "Yes / No" : field.type === "SELECT" ? "Select" : field.type === "NUMBER" ? "Number" : field.type === "DATE" ? "Date" : "Text")} · {field.isActive ? ui("Active") : ui("Inactive")}{field.required ? ` · ${ui("Required")}` : ""}</p><p className="text-xs text-muted-foreground">{ui("Created by")}: {field.createdBy ? `${field.createdBy.name}${field.createdBy.email ? ` · ${field.createdBy.email}` : ""}` : ui("System / legacy")}</p></div>
              <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => update.mutate({ id: field.id, isActive: !field.isActive })}>{field.isActive ? ui("Deactivate") : ui("Activate")}</Button><Button size="sm" variant="destructive" onClick={() => remove.mutate(field.id)}><Trash2 />{ui("Archive")}</Button></div>
            </div>
          ))}
          {!fields.isLoading && !(fields.data ?? []).length && <p className="text-sm text-muted-foreground">{ui("No custom member fields yet.")}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
