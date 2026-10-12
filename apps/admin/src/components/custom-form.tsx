import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ui } from "@/lib/ui-text";

export type CustomFormField = {
  id?: string;
  key: string;
  label: string;
  type: "TEXT" | "LONG_TEXT" | "NUMBER" | "BOOLEAN" | "DATE" | "DATETIME" | "SELECT" | "MULTI_SELECT" | "EMAIL" | "URL" | "FILE";
  required?: boolean;
  options?: string[];
  sortOrder?: number;
  isActive?: boolean;
  description?: string | null;
};

export type CustomFormFile = { kind: "FILE"; attachmentId: string; name?: string };

interface CustomFormProps {
  fields: CustomFormField[];
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
  idPrefix?: string;
  onFileUpload?: (fieldKey: string, file: File) => Promise<CustomFormFile>;
  onFileDownload?: (file: CustomFormFile) => void;
  fileUploadDisabled?: boolean;
}

export function CustomForm({
  fields,
  value,
  onChange,
  errors = {},
  disabled = false,
  idPrefix = "custom-field",
  onFileUpload,
  onFileDownload,
  fileUploadDisabled = false,
}: CustomFormProps): JSX.Element | null {
  const latestValue = useRef(value);
  const latestOnChange = useRef(onChange);
  latestValue.current = value;
  latestOnChange.current = onChange;
  const [uploadingFields, setUploadingFields] = useState<string[]>([]);
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
  const activeFields = fields
    .filter((field) => field.isActive !== false)
    .slice()
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));

  if (!activeFields.length) return null;

  return (
    <div className="space-y-4">
      {activeFields.map((field) => {
        const id = `${idPrefix}-${field.key}`;
        const error = errors[field.key];
        const fieldValue = value[field.key];
        if (field.type === "BOOLEAN") {
          return (
            <div key={field.key}>
              <label htmlFor={id} className="flex items-center gap-2 text-sm">
                <input
                  id={id}
                  type="checkbox"
                  checked={Boolean(fieldValue)}
                  disabled={disabled}
                  aria-invalid={Boolean(error)}
                  onChange={(event) => onChange({ ...value, [field.key]: event.target.checked })}
                />
                <span>{field.label}{field.required ? " *" : ""}</span>
              </label>
              {field.description && <p className="mt-1 text-xs text-muted-foreground">{field.description}</p>}
              {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
            </div>
          );
        }

        const commonProps = {
          id,
          disabled,
          "aria-invalid": Boolean(error),
          "aria-describedby": error ? `${id}-error` : undefined,
        };

        if (field.type === "FILE") {
          const fileValue = fieldValue && typeof fieldValue === "object" && !Array.isArray(fieldValue)
            ? fieldValue as CustomFormFile
            : null;
          const uploading = uploadingFields.includes(field.key);
          const fileError = uploadErrors[field.key];
          return (
            <div key={field.key}>
              <Label htmlFor={id}>{field.label}{field.required ? " *" : ""}</Label>
              {fileValue?.attachmentId && (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                  <span className="truncate">{fileValue.name || ui("Attached file")}</span>
                  {onFileDownload && <button type="button" className="text-primary underline" onClick={() => onFileDownload(fileValue)}>{ui("Download")}</button>}
                  {!disabled && <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ ...value, [field.key]: null })}>{ui("Remove attachment")}</Button>}
                </div>
              )}
              <Input
                {...commonProps}
                className="mt-1"
                type="file"
                disabled={disabled || fileUploadDisabled || !onFileUpload || uploading}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (!file || !onFileUpload) return;
                  event.currentTarget.value = "";
                  setUploadErrors((current) => ({ ...current, [field.key]: "" }));
                  setUploadingFields((current) => current.includes(field.key) ? current : [...current, field.key]);
                  void onFileUpload(field.key, file)
                    .then((uploaded) => {
                      const nextValue = { ...latestValue.current, [field.key]: uploaded };
                      latestValue.current = nextValue;
                      latestOnChange.current(nextValue);
                    })
                    .catch((uploadError: unknown) => setUploadErrors((current) => ({
                      ...current,
                      [field.key]: uploadError instanceof Error ? uploadError.message : ui("Unable to upload file."),
                    })))
                    .finally(() => setUploadingFields((current) => current.filter((key) => key !== field.key)));
                }}
              />
              {uploading && <p className="mt-1 text-xs text-muted-foreground">{ui("Uploading…")}</p>}
              {field.description && <p className="mt-1 text-xs text-muted-foreground">{field.description}</p>}
              {(fileError || error) && <p id={`${id}-error`} className="mt-1 text-xs text-destructive">{fileError || error}</p>}
            </div>
          );
        }

        if (field.type === "MULTI_SELECT") {
          const selectedValues = Array.isArray(fieldValue) ? fieldValue.map(String) : [];
          return (
            <fieldset key={field.key} className="space-y-2">
              <legend className="text-sm font-medium">{field.label}{field.required ? " *" : ""}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {(field.options ?? []).map((option) => (
                  <label key={option} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedValues.includes(option)}
                      disabled={disabled}
                      onChange={(event) => onChange({
                        ...value,
                        [field.key]: event.target.checked
                          ? [...new Set([...selectedValues, option])]
                          : selectedValues.filter((item) => item !== option),
                      })}
                    />
                    {option}
                  </label>
                ))}
              </div>
              {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
              {error && <p className="text-xs text-destructive">{error}</p>}
            </fieldset>
          );
        }

        return (
          <div key={field.key}>
            <Label htmlFor={id}>{field.label}{field.required ? " *" : ""}</Label>
            {field.type === "SELECT" ? (
              <select
                {...commonProps}
                className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={String(fieldValue ?? "")}
                onChange={(event) => onChange({ ...value, [field.key]: event.target.value })}
              >
                <option value="">{ui("Select")}</option>
                {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            ) : field.type === "LONG_TEXT" ? (
              <Textarea
                {...commonProps}
                className="mt-1 min-h-24"
                value={String(fieldValue ?? "")}
                onChange={(event) => onChange({ ...value, [field.key]: event.target.value })}
              />
            ) : (
              <Input
                {...commonProps}
                className="mt-1"
                type={field.type === "NUMBER" ? "number" : field.type === "DATE" ? "date" : field.type === "DATETIME" ? "datetime-local" : field.type === "EMAIL" ? "email" : field.type === "URL" ? "url" : "text"}
                value={field.type === "DATETIME" && fieldValue ? (() => {
                  const date = new Date(String(fieldValue));
                  return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
                })() : String(fieldValue ?? "")}
                onChange={(event) => onChange({ ...value, [field.key]: field.type === "NUMBER" ? event.target.value === "" ? "" : Number(event.target.value) : field.type === "DATETIME" ? event.target.value ? new Date(event.target.value).toISOString() : "" : event.target.value})}
              />
            )}
            {field.description && <p className="mt-1 text-xs text-muted-foreground">{field.description}</p>}
            {error && <p id={`${id}-error`} className="mt-1 text-xs text-destructive">{error}</p>}
          </div>
        );
      })}
    </div>
  );
}
