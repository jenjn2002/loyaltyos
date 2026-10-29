import { Check, ChevronDown, Code2, Copy, Download, ExternalLink, Search, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getDeveloperApiGuide } from "@/content/developer-api-guide";
import referenceData from "@/content/developer-api-reference.json";
import type { ApiEndpoint, ApiField, ApiReferenceCatalog, ApiSchema } from "@/content/developer-api-types";
import { copyText } from "@/lib/clipboard";

const catalog = referenceData as ApiReferenceCatalog;

const strings = {
  en: {
    eyebrow: "DEVELOPER DOCUMENTATION", title: "Developer document", intro: "Get API access, understand authentication and permissions, then find the exact request fields for every registered HTTP endpoint.",
    guide: "Integration guide", reference: "API reference", baseUrl: "API base URL", baseHint: "Use your API origin and /api/v1, including a port when needed. This changes code examples only.", baseError: "Enter an http:// or https:// URL without credentials, a query, or a fragment.",
    search: "Search the API reference", searchHint: "Search path, field, capability, or keyword…", group: "API group", groupHelp: "Filter endpoints by the API area they belong to; this does not change endpoint access or permissions.", method: "HTTP method", methodHelp: "Show only endpoints that use the selected HTTP method.", access: "Accepted credentials", accessHelp: "Filter routes by the credentials the server accepts. This is documentation only and does not grant access.", all: "All", public: "Public", admin: "Admin / server key", member: "Member session", authenticated: "Authenticated", infrastructure: "Infrastructure", adminSession: "Admin session", serverKey: "SERVER API key", apiKey: "API key", or: "or", noCredential: "No credential listed", infrastructureNoCredential: "Infrastructure · no credential listed",
    download: "Download JSON catalog", pdf: "Export PDF", pdfHint: "Print includes the guide and full details of every filtered endpoint. Choose Save as PDF.", count: "endpoints", of: "of", empty: "No matching endpoints. Change the search or filters.", clear: "Clear filters", expand: "Expand all", collapse: "Collapse all", steps: "Steps", notes: "Notes and limitations", copy: "Copy", copied: "Copied", copyFailed: "Clipboard unavailable. Select and copy the code manually.",
    credentials: "Accepted credentials", capabilities: "Admin capabilities", accessNotes: "Access requirements", params: "Path parameters", query: "Query parameters", headers: "Request headers", body: "Request body", noBody: "No validated request body is declared for this route.", name: "Field", type: "Type", required: "Required", optional: "Optional", requiredWhenPresent: "Required when parent is supplied", defaults: "Default", constraints: "Constraints", examples: "Examples", nullable: "Nullable", alternatives: "Accepted alternatives", validator: "Validator", none: "None declared", requestExample: "Request example", response: "Responses", noResponse: "No response schema is declared here. Inspect the handler and shared error handling before relying on a response shape.", source: "Implementation source", curl: "cURL request template", curlHint: "Replace every {{placeholder}} or <placeholder> and verify required fields before running this template in your own environment. Copying a template does not send a request.",
    readonly: "This document uses source-derived route definitions. API key scope, admin capabilities, member identity, and deployment configuration still govern access; a listed endpoint does not grant permission.", generated: "Catalog generated", fullCatalog: "The JSON download contains the complete catalog; filters affect the list and PDF only.", back: "Back to API reference", linked: "Link to this endpoint", schemaNote: "Fields and validation below reflect the source validator; handler-level rules appear in the endpoint notes.", viewDetails: "View request and response details", hideDetails: "Hide details", noFields: "No validated fields are declared.", filteredPrint: "Filtered API reference", exampleDraft: "Generated template values are examples only; replace them with valid values for your program.",
    backendOrigin: "Direct backend origin (infrastructure routes)", backendHint: "Enter the backend origin without /api/v1. Infrastructure routes marked Backend only may not be forwarded by the public proxy; consult the deployment owner.", backendOnly: "Backend only", backendRequired: "This route needs the direct backend origin; replace {{API_BACKEND_ORIGIN}} or set it above.",
  },
  vi: {
    eyebrow: "TÀI LIỆU CHO LẬP TRÌNH VIÊN", title: "Developer document", intro: "Lấy quyền truy cập API, hiểu cơ chế xác thực và phân quyền, rồi tra cứu chính xác các trường request của toàn bộ HTTP endpoint đã đăng ký.",
    guide: "Hướng dẫn tích hợp", reference: "Danh mục API", baseUrl: "Địa chỉ gốc API", baseHint: "Nhập origin của API và /api/v1, kèm cổng khi cần. Chỉ thay đổi địa chỉ trong ví dụ mã.", baseError: "Nhập URL http:// hoặc https://, không chứa thông tin đăng nhập, query hay fragment.",
    search: "Tìm trong danh mục API", searchHint: "Tìm đường dẫn, trường, capability hoặc từ khóa…", group: "Nhóm API", groupHelp: "Lọc endpoint theo nhóm chức năng API; bộ lọc này không thay đổi quyền truy cập hay phân quyền của endpoint.", method: "Phương thức HTTP", methodHelp: "Chỉ hiển thị endpoint dùng phương thức HTTP đã chọn.", access: "Cách xác thực được chấp nhận", accessHelp: "Lọc route theo thông tin xác thực mà server chấp nhận. Đây chỉ là tài liệu tra cứu, không cấp quyền truy cập.", all: "Tất cả", public: "Công khai", admin: "Admin / server key", member: "Phiên thành viên", authenticated: "Đã xác thực", infrastructure: "Hạ tầng", adminSession: "Phiên Admin", serverKey: "API key SERVER", apiKey: "API key", or: "hoặc", noCredential: "Chưa khai báo thông tin xác thực", infrastructureNoCredential: "Hạ tầng · chưa khai báo thông tin xác thực",
    download: "Tải danh mục JSON", pdf: "Xuất PDF", pdfHint: "Bản in gồm hướng dẫn và đầy đủ chi tiết API đang lọc. Chọn Lưu thành PDF.", count: "endpoint", of: "/", empty: "Không tìm thấy API phù hợp. Hãy đổi từ khóa hoặc bộ lọc.", clear: "Xóa bộ lọc", expand: "Mở tất cả", collapse: "Thu gọn tất cả", steps: "Các bước", notes: "Lưu ý và giới hạn", copy: "Sao chép", copied: "Đã sao chép", copyFailed: "Không truy cập được clipboard. Hãy chọn và sao chép mã thủ công.",
    credentials: "Cách xác thực được chấp nhận", capabilities: "Capability dành cho Admin", accessNotes: "Điều kiện truy cập", params: "Tham số đường dẫn", query: "Tham số query", headers: "Header của request", body: "Nội dung request", noBody: "Route này không khai báo bộ kiểm tra nội dung request.", name: "Trường", type: "Kiểu", required: "Bắt buộc", optional: "Không bắt buộc", requiredWhenPresent: "Bắt buộc khi có đối tượng cha", defaults: "Mặc định", constraints: "Ràng buộc", examples: "Ví dụ", nullable: "Cho phép null", alternatives: "Các kiểu được chấp nhận", validator: "Validator", none: "Không khai báo", requestExample: "Ví dụ request", response: "Phản hồi", noResponse: "Không khai báo schema phản hồi tại đây. Xem handler và cơ chế lỗi chung trước khi phụ thuộc vào cấu trúc phản hồi.", source: "Mã nguồn triển khai", curl: "Mẫu request cURL", curlHint: "Thay mọi {{placeholder}} hoặc <placeholder> và kiểm tra trường bắt buộc trước khi chạy mẫu trong môi trường của bạn. Sao chép mẫu không gửi request.",
    readonly: "Tài liệu được trích từ các route trong mã nguồn. Scope của API key, capability Admin, danh tính thành viên và cấu hình triển khai vẫn quyết định quyền truy cập; có trong danh mục không có nghĩa là được cấp quyền.", generated: "Ngày tạo danh mục", fullCatalog: "Tệp JSON chứa toàn bộ danh mục; bộ lọc chỉ áp dụng cho danh sách và PDF.", back: "Về danh mục API", linked: "Liên kết đến API này", schemaNote: "Các trường và ràng buộc bên dưới phản ánh validator trong mã nguồn; điều kiện ở handler được ghi trong lưu ý endpoint.", viewDetails: "Xem chi tiết request và phản hồi", hideDetails: "Ẩn chi tiết", noFields: "Không khai báo trường được kiểm tra.", filteredPrint: "Danh mục API đã lọc", exampleDraft: "Giá trị trong mẫu tự tạo chỉ để minh họa; hãy thay bằng dữ liệu hợp lệ của chương trình.",
    backendOrigin: "Origin trực tiếp của backend (route hạ tầng)", backendHint: "Nhập origin backend không kèm /api/v1. Các route Chỉ backend có thể không được proxy công khai chuyển tiếp; hỏi người quản lý triển khai.", backendOnly: "Chỉ backend", backendRequired: "Route này cần origin trực tiếp của backend; thay {{API_BACKEND_ORIGIN}} hoặc nhập ở trên.",
  },
} as const;

type CopyStrings = typeof strings.en | typeof strings.vi;

const vietnameseGroups: Record<string, string> = {
  Approvals: "Phê duyệt", "Api access": "Truy cập API", Auth: "Xác thực", Badges: "Huy hiệu", Branding: "Tên và nhận diện hệ thống",
  Campaigns: "Chiến dịch", "Campaign claims": "Nhận thưởng chiến dịch", "Check ins": "Điểm danh",
  Coalition: "Liên minh", Coupons: "Phiếu ưu đãi", Credits: "Điểm / ví", "Credit users": "Tài khoản điểm / ví",
  Dashboard: "Tổng quan", Documentation: "Tài liệu", "Event definitions": "Định nghĩa sự kiện", Events: "Sự kiện",
  Exports: "Xuất dữ liệu", Giftcards: "Thẻ quà tặng", Infrastructure: "Hạ tầng", Issuance: "Phát hành điểm",
  Logs: "Nhật ký", Members: "Thành viên", "Member fields": "Trường thành viên", Notifications: "Thông báo",
  "Point types": "Loại điểm", Programs: "Chương trình", Projects: "Dự án", Rewards: "Phần thưởng",
  Segments: "Phân nhóm", Settings: "Cấu hình", Stats: "Thống kê", Tiers: "Hạng thành viên",
  Wallets: "Ví điểm", Workflows: "Luồng phê duyệt",
};

function groupLabel(group: string, isEnglish: boolean): string {
  if (isEnglish) return group;
  const adminPrefix = "Admin · ";
  const name = group.startsWith(adminPrefix) ? group.slice(adminPrefix.length) : group;
  return `${group.startsWith(adminPrefix) ? adminPrefix : ""}${vietnameseGroups[name] ?? name}`;
}

function valueText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? String(value);
}

function schemaType(schema: ApiSchema): string {
  if (schema.type === "array" && schema.items) return `array<${schemaType(schema.items)}>`;
  if (schema.type === "object" && schema.items && !schema.fields) return `Record<string, ${schemaType(schema.items)}>`;
  return schema.type;
}

function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase();
}

export function normalizeApiBaseUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch { return null; }
}

function endpointUrl(endpoint: ApiEndpoint, baseUrl: string): string {
  if (endpoint.path === "*") return `${baseUrl}/members`;
  const path = endpoint.path.startsWith("/api/v1/") || endpoint.path === "/api/v1"
    ? endpoint.path.slice("/api/v1".length)
    : endpoint.path;
  const origin = endpoint.path.startsWith("/api/v1") ? baseUrl : baseUrl.replace(/\/api\/v1$/, "");
  return `${origin}${path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{{$1}}").replace(/\*/g, "{{ASSET_PATH}}")}`;
}

function shellQuote(value: string): string { return `'${value.replace(/'/g, "'\\''")}'`; }

function exampleForSchema(schema: ApiSchema, name = "value"): unknown {
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  if (schema.alternatives?.length) return exampleForSchema(schema.alternatives[0]!, name);
  if (schema.type === "object" || schema.fields?.length) return Object.fromEntries((schema.fields ?? []).filter((field) => field.required).map((field) => [field.name, exampleForSchema(field, field.name)]));
  if (schema.type === "array") return schema.items ? [exampleForSchema(schema.items, name)] : [];
  if (/number|integer/.test(schema.type)) return 1;
  if (schema.type === "boolean") return false;
  return `{{${name}}}`;
}

export function developerCurlTemplate(endpoint: ApiEndpoint, baseUrl: string): string {
  const parts = [`curl --request ${endpoint.method} ${shellQuote(endpointUrl(endpoint, baseUrl))}`];
  const credentialMethods = acceptedCredentialMethods(endpoint);
  const declaredHeaders = new Set(endpoint.request.headers.map((field) => field.name.toLowerCase()));
  const acceptsApiKey = credentialMethods.includes("serverKey") || credentialMethods.includes("apiKey");
  if (endpoint.access.mode === "member" || (credentialMethods.includes("member") && !acceptsApiKey)) parts.push("  --header 'Authorization: Bearer {{MEMBER_SESSION_TOKEN}}'");
  else if (acceptsApiKey) parts.push(`  --header 'X-API-Key: {{${credentialMethods.includes("serverKey") ? "SERVER_API_KEY" : "API_KEY"}}}'`);
  else if (credentialMethods.includes("adminSession")) parts.push("  --cookie 'loyaltyos_admin_session={{ADMIN_SESSION_COOKIE}}'");
  const needsPublicProgramHeader = ["/api/v1/auth/login", "/api/v1/auth/microsoft"].includes(endpoint.path);
  for (const field of endpoint.request.headers) {
    if (["authorization", "x-api-key", "cookie", "content-type"].includes(field.name.toLowerCase()) || (!field.required && !(needsPublicProgramHeader && field.name.toLowerCase() === "x-program-id"))) continue;
    parts.push(`  --header ${shellQuote(`${field.name}: {{${field.name.toUpperCase().replace(/-/g, "_")}}}`)}`);
  }
  if (endpoint.request.query.some((field) => field.required)) {
    const query = endpoint.request.query.filter((field) => field.required).map((field) => `${encodeURIComponent(field.name)}={{${field.name}}}`).join("&");
    parts[0] = `curl --request ${endpoint.method} ${shellQuote(`${endpointUrl(endpoint, baseUrl)}?${query}`)}`;
  }
  if (endpoint.request.body) {
    parts.push("  --header 'Content-Type: application/json'");
    parts.push(`  --data ${shellQuote(JSON.stringify(endpoint.request.example ?? exampleForSchema(endpoint.request.body), null, 2))}`);
  } else if (declaredHeaders.has("content-type")) parts.push("  --header 'Content-Type: application/json'");
  return parts.join(" \\\n");
}

function CodeSample({ title, code, language, copy }: { title: string; code: string; language: string; copy: CopyStrings }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const copyCode = async () => {
    try {
      await copyText(code);
      setCopied(true);
      setFailed(false);
    } catch { setFailed(true); }
  };
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2200);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return <div className="min-w-0 overflow-hidden rounded-lg border bg-slate-950 text-slate-100">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
      <p className="min-w-0 break-words text-xs font-semibold">{title}<span className="ml-2 font-normal text-slate-400">{language}</span></p>
      <Button className="no-print h-8 border-white/20 bg-transparent text-slate-100 hover:bg-white/10 hover:text-white" variant="outline" size="sm" onClick={() => void copyCode()} aria-label={`${copy.copy}: ${title}`}>{copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}{copied ? copy.copied : copy.copy}</Button>
    </div>
    <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words p-4 text-xs leading-6 [overflow-wrap:anywhere] print:overflow-visible print:text-black"><code>{code}</code></pre>
    {failed && <p role="status" className="no-print px-3 pb-3 text-xs text-amber-200">{copy.copyFailed}</p>}
  </div>;
}

interface DisplayField { field: ApiField; path: string; conditional: boolean }

function flattenFields(fields: ApiField[], prefix = "", parentOptional = false): DisplayField[] {
  return fields.flatMap((field) => {
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    const children = field.fields ?? field.items?.fields ?? [];
    return [{ field, path, conditional: parentOptional && field.required }, ...flattenFields(children, field.type === "array" ? `${path}[]` : path, parentOptional || !field.required)];
  });
}

function FieldsTable({ title, fields, copy }: { title: string; fields: ApiField[]; copy: CopyStrings }): JSX.Element | null {
  if (!fields.length) return null;
  return <section className="min-w-0 space-y-2">
    <h4 className="text-sm font-semibold">{title}</h4>
    <div className="overflow-x-auto rounded-lg border print:overflow-visible">
      <table className="w-full min-w-[540px] text-left text-xs print:min-w-0">
        <thead className="bg-muted/60"><tr><th className="p-3">{copy.name}</th><th className="p-3">{copy.type}</th><th className="p-3">{copy.required}</th><th className="p-3">{copy.constraints} / {copy.defaults} / {copy.examples}</th></tr></thead>
        <tbody className="divide-y">{flattenFields(fields).map(({ field, path, conditional }) => <tr key={path} className="align-top">
          <td className="p-3 font-mono [overflow-wrap:anywhere]">{path}</td>
          <td className="p-3 font-mono [overflow-wrap:anywhere]">{schemaType(field)}{field.nullable && <span className="mt-1 block font-sans text-muted-foreground">{copy.nullable}</span>}</td>
          <td className="p-3">{conditional ? copy.requiredWhenPresent : field.required ? copy.required : copy.optional}</td>
          <td className="max-w-md space-y-1 p-3 [overflow-wrap:anywhere]">
            {field.enum && <p><span className="font-semibold">enum:</span> <code>{field.enum.map(valueText).join(" | ")}</code></p>}
            {field.default !== undefined && <p><span className="font-semibold">{copy.defaults}:</span> <code>{valueText(field.default)}</code></p>}
            {field.constraints?.map((constraint) => <p key={constraint}>{constraint}</p>)}
            {field.alternatives?.length ? <div><span className="font-semibold">{copy.alternatives}:</span>{field.alternatives.map((schema, index) => <p key={index}><code>{schemaType(schema)}</code>{schema.enum?.length ? ` · enum: ${schema.enum.map(valueText).join(" | ")}` : ""}{schema.constraints?.length ? ` · ${schema.constraints.join("; ")}` : ""}</p>)}</div> : null}
            {field.validator && <p><span className="font-semibold">{copy.validator}:</span> <code>{field.validator}</code></p>}
            {field.example !== undefined && <p><span className="font-semibold">{copy.examples}:</span> <code>{valueText(field.example)}</code></p>}
          </td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

function SchemaDetails({ schema, copy }: { schema: ApiSchema; copy: CopyStrings }): JSX.Element {
  const fields = schema.fields ?? schema.items?.fields ?? [];
  return <div className="space-y-3">
    <p className="text-xs"><span className="font-semibold">{copy.type}: </span><code>{schemaType(schema)}</code> · {schema.required ? copy.required : copy.optional}{schema.nullable ? ` · ${copy.nullable}` : ""}</p>
    {schema.constraints?.length ? <ul className="list-disc space-y-1 pl-4 text-xs leading-5">{schema.constraints.map((item) => <li key={item}>{item}</li>)}</ul> : null}
    {schema.default !== undefined && <p className="text-xs">{copy.defaults}: <code>{valueText(schema.default)}</code></p>}
    {schema.enum?.length ? <p className="text-xs">enum: <code>{schema.enum.map(valueText).join(" | ")}</code></p> : null}
    {schema.validator && <p className="break-words text-xs [overflow-wrap:anywhere]">{copy.validator}: <code>{schema.validator}</code></p>}
    <FieldsTable title={copy.body} fields={fields} copy={copy} />
    {schema.alternatives?.map((alternative, index) => <div key={index} className="rounded-md border p-3"><p className="mb-2 text-xs font-semibold">{copy.alternatives} {index + 1}</p><SchemaDetails schema={alternative} copy={copy} /></div>)}
    {schema.example !== undefined && <CodeSample title={copy.requestExample} code={JSON.stringify(schema.example, null, 2)} language="json" copy={copy} />}
  </div>;
}

type CredentialMethod = "member" | "adminSession" | "serverKey" | "apiKey";

function acceptedCredentialMethods(endpoint: ApiEndpoint): CredentialMethod[] {
  const credentials = endpoint.access.credentials.join("; ").toLowerCase();
  const methods: CredentialMethod[] = [];
  if (/member[ -]session|loyaltyos_session|bearer.*member/.test(credentials)) methods.push("member");
  if (/admin[ -]cookie|admin[ -]session|loyaltyos_admin_session/.test(credentials)) methods.push("adminSession");
  if (/server[ -]?(?:scoped )?(?:x-api-key|api key|key)|<server-key>/.test(credentials)) methods.push("serverKey");
  if (/(?:x-api-key.*<api-key>|<api-key>)/.test(credentials)) methods.push("apiKey");
  return methods;
}

function accessProfileKey(endpoint: ApiEndpoint): string {
  const methods = acceptedCredentialMethods(endpoint).sort();
  return methods.length ? methods.join("+") : `${endpoint.access.mode}:none`;
}

function accessName(endpoint: ApiEndpoint, copy: CopyStrings): string {
  const methods = acceptedCredentialMethods(endpoint);
  if (methods.length === 0) {
    if (endpoint.access.mode === "public") return copy.public;
    if (endpoint.access.mode === "infrastructure") return copy.infrastructureNoCredential;
    return copy.noCredential;
  }
  return methods
    .map((method) => method === "member" ? copy.member : copy[method])
    .join(` ${copy.or} `);
}

function EndpointCard({ endpoint, groupName, expanded, printing, onExpand, copy, baseUrl, backendOrigin }: { endpoint: ApiEndpoint; groupName: string; expanded: boolean; printing: boolean; onExpand: () => void; copy: CopyStrings; baseUrl: string; backendOrigin: string | null }): JSX.Element {
  return <article id={`developer-api-${endpoint.id}`} className="developer-endpoint min-w-0 scroll-mt-5 rounded-xl border bg-card p-4 sm:p-5">
    <div className="flex flex-wrap items-start gap-3">
      <span className={`rounded-md px-2.5 py-1 font-mono text-xs font-bold ${endpoint.method === "GET" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : endpoint.method === "DELETE" ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" : "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200"}`}>{endpoint.method}</span>
      <div className="min-w-0 flex-1"><h3 className="break-words font-mono text-sm font-semibold [overflow-wrap:anywhere]">{endpoint.path}</h3><p className="mt-1 text-sm text-muted-foreground">{endpoint.summary}</p></div>
      <a className="no-print rounded p-1 text-muted-foreground hover:text-primary" href={`?section=developer#developer-api-${endpoint.id}`} aria-label={`${copy.linked}: ${endpoint.method} ${endpoint.path}`} onClick={(event) => { event.preventDefault(); if (!expanded) onExpand(); window.history.replaceState(window.history.state, "", `?section=developer#developer-api-${endpoint.id}`); document.getElementById(`developer-api-${endpoint.id}`)?.scrollIntoView({ block: "start", behavior: "smooth" }); }}><ExternalLink className="h-4 w-4" /></a>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]"><span className="rounded-full border px-2 py-1">{groupName}</span><span className="max-w-full break-words rounded-full border px-2 py-1" title={endpoint.access.credentials.join("; ") || copy.noCredential}>{accessName(endpoint, copy)}</span>{endpoint.backendOnly && <span className="rounded-full border border-amber-400/50 bg-amber-100 px-2 py-1 text-amber-900">{copy.backendOnly}</span>}{endpoint.access.capabilities.map((capability) => <code className="break-all rounded bg-muted px-2 py-1" key={capability}>{capability}</code>)}</div>
    <Button className="no-print mt-3 h-auto max-w-full justify-start whitespace-normal px-0 text-xs" size="sm" variant="link" onClick={onExpand} aria-expanded={expanded} aria-controls={`developer-api-details-${endpoint.id}`}><ChevronDown className={`mr-1.5 h-4 w-4 shrink-0 ${expanded ? "rotate-180" : ""}`} />{expanded ? copy.hideDetails : copy.viewDetails}</Button>
    {(expanded || printing) && <div id={`developer-api-details-${endpoint.id}`} className={`developer-endpoint-details mt-4 space-y-5 border-t pt-4 ${expanded ? "block" : "hidden print:block"}`}>
      {endpoint.description && <p className="text-sm leading-6 text-muted-foreground">{endpoint.description}</p>}
      <div className="rounded-lg border bg-muted/25 p-3 text-xs leading-6">
        <p className="font-semibold">{copy.accessNotes}</p>
        <p className="mt-1"><span className="font-semibold">{copy.credentials}:</span> {endpoint.access.credentials.length ? endpoint.access.credentials.join("; ") : copy.none}</p>
        {endpoint.access.capabilities.length > 0 && <p className="mt-1"><span className="font-semibold">{copy.capabilities}:</span> <code className="break-all">{endpoint.access.capabilities.join(", ")}</code></p>}
        {endpoint.access.notes.map((note) => <p key={note} className="mt-1">{note}</p>)}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{copy.schemaNote}</p>
      <FieldsTable title={copy.params} fields={endpoint.request.params} copy={copy} />
      <FieldsTable title={copy.query} fields={endpoint.request.query} copy={copy} />
      <FieldsTable title={copy.headers} fields={endpoint.request.headers} copy={copy} />
      <section className="space-y-2"><h4 className="text-sm font-semibold">{copy.body}</h4>{endpoint.request.body ? <SchemaDetails schema={endpoint.request.body} copy={copy} /> : <p className="text-xs text-muted-foreground">{copy.noBody}</p>}</section>
      {endpoint.request.example !== undefined && <CodeSample title={copy.requestExample} code={JSON.stringify(endpoint.request.example, null, 2)} language="json" copy={copy} />}
      <section className="space-y-3"><h4 className="text-sm font-semibold">{copy.response}</h4>{endpoint.responses.length ? endpoint.responses.map((response, index) => <div key={`${response.status}-${index}`} className="space-y-2 rounded-lg border p-3">
        <p className="text-xs"><code className="font-semibold">{response.status}</code> · <code>{response.type}</code></p>
        <FieldsTable title={copy.response} fields={response.fields ?? []} copy={copy} />
        {response.notes?.map((note) => <p key={note} className="text-xs leading-5 text-muted-foreground">{note}</p>)}
        {response.example !== undefined && <CodeSample title={`${copy.response} ${response.status}`} code={JSON.stringify(response.example, null, 2)} language="json" copy={copy} />}
      </div>) : <p className="text-xs leading-5 text-muted-foreground">{copy.noResponse}</p>}</section>
      {endpoint.notes.length > 0 && <section><h4 className="text-sm font-semibold">{copy.notes}</h4><ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-6">{endpoint.notes.map((note) => <li key={note}>{note}</li>)}</ul></section>}
      <div className="space-y-2"><CodeSample title={copy.curl} code={developerCurlTemplate(endpoint, endpoint.backendOnly ? backendOrigin ?? "{{API_BACKEND_ORIGIN}}" : baseUrl)} language="sh" copy={copy} />{endpoint.backendOnly && !backendOrigin && <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">{copy.backendRequired}</p>}<p className="text-xs leading-5 text-muted-foreground">{copy.curlHint} {copy.exampleDraft}</p></div>
      <p className="break-words border-t pt-3 text-xs text-muted-foreground [overflow-wrap:anywhere]">{copy.source}: <code>{endpoint.source.file}:{endpoint.source.line}</code></p>
    </div>}
  </article>;
}

export function DeveloperDocument({ isEnglish, systemName, active = true }: { isEnglish: boolean; systemName: string; active?: boolean }): JSX.Element {
  const copy = strings[isEnglish ? "en" : "vi"];
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("");
  const [method, setMethod] = useState("");
  const [access, setAccess] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [printing, setPrinting] = useState(false);
  const [baseInput, setBaseInput] = useState(() => `${window.location.origin}/api/v1`);
  const [backendInput, setBackendInput] = useState("");
  const baseUrl = normalizeApiBaseUrl(baseInput);
  const backendOrigin = normalizeApiBaseUrl(backendInput);
  const effectiveBaseUrl = baseUrl ?? "{{API_BASE_URL}}";
  const guide = useMemo(() => getDeveloperApiGuide(isEnglish ? "en" : "vi"), [isEnglish]);
  const groups = useMemo(() => [...new Set(catalog.endpoints.map((endpoint) => endpoint.group))].sort(), []);
  const methods = useMemo(() => [...new Set(catalog.endpoints.map((endpoint) => endpoint.method))].sort(), []);
  const accessOptions = useMemo(() => {
    const unique = new Map<string, ApiEndpoint>();
    catalog.endpoints.forEach((endpoint) => unique.set(accessProfileKey(endpoint), endpoint));
    return [...unique.entries()]
      .map(([value, endpoint]) => ({ value, label: accessName(endpoint, copy) }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [isEnglish]);
  const indexedEndpoints = useMemo(() => catalog.endpoints.map((endpoint) => ({ endpoint, text: normalizeSearch(`${JSON.stringify(endpoint)} ${groupLabel(endpoint.group, false)}`) })), []);
  const filteredEndpoints = useMemo(() => {
    const terms = normalizeSearch(search.trim()).split(/\s+/).filter(Boolean);
    return indexedEndpoints.filter(({ endpoint, text }) => (!group || endpoint.group === group) && (!method || endpoint.method === method) && (!access || accessProfileKey(endpoint) === access) && terms.every((term) => text.includes(term))).map(({ endpoint }) => endpoint);
  }, [search, group, method, access, indexedEndpoints]);

  useEffect(() => {
    if (!active) return;
    const openBookmark = () => {
      if (window.location.hash.startsWith("#developer-guide-") || ["#developer-integration-guide", "#developer-api-reference"].includes(window.location.hash)) {
        return window.setTimeout(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "start" }), 0);
      }
      const id = window.location.hash.slice("#developer-api-".length);
      if (!window.location.hash.startsWith("#developer-api-") || !catalog.endpoints.some((endpoint) => endpoint.id === id)) return;
      setExpanded((current) => new Set([...current, id]));
      const timer = window.setTimeout(() => document.getElementById(`developer-api-${id}`)?.scrollIntoView({ block: "start" }), 0);
      return timer;
    };
    let timer = openBookmark();
    const onHashChange = () => { if (timer !== undefined) window.clearTimeout(timer); timer = openBookmark(); };
    window.addEventListener("hashchange", onHashChange);
    return () => { if (timer !== undefined) window.clearTimeout(timer); window.removeEventListener("hashchange", onHashChange); };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const beforePrint = () => flushSync(() => setPrinting(true));
    const afterPrint = () => setPrinting(false);
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => { window.removeEventListener("beforeprint", beforePrint); window.removeEventListener("afterprint", afterPrint); };
  }, [active]);

  const downloadCatalog = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(catalog, null, 2)], { type: "application/json;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "loyaltyos-api-reference.json";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const toggleEndpoint = (id: string) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return <div className="documentation-print-area developer-document min-w-0 space-y-6">
    <style>{`@media print { .developer-document .developer-endpoint-details { display: block !important; } .developer-document pre { white-space: pre-wrap !important; overflow: visible !important; color: #111 !important; background: #fff !important; } .developer-document table { min-width: 0 !important; table-layout: fixed; } .developer-document td, .developer-document th { overflow-wrap: anywhere; } .developer-document header { background: #fff !important; color: #111 !important; } .developer-document header p { color: #444 !important; } }`}</style>
    <header className="rounded-2xl bg-slate-950 px-5 py-7 text-white sm:px-8 sm:py-9">
      <p className="flex items-center gap-2 text-sm font-medium text-cyan-200"><Code2 className="h-4 w-4" />{copy.eyebrow}</p>
      <h1 className="mt-3 break-words text-3xl font-bold tracking-tight [overflow-wrap:anywhere] sm:text-4xl">{systemName} {copy.title}</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">{copy.intro}</p>
      <div className="no-print mt-5 flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={downloadCatalog}><Download className="mr-1.5 h-4 w-4" />{copy.download}</Button><Button size="sm" variant="secondary" onClick={() => { flushSync(() => setPrinting(true)); window.print(); }}><Download className="mr-1.5 h-4 w-4" />{copy.pdf}</Button></div>
      <p className="no-print mt-3 text-xs leading-5 text-slate-300">{copy.pdfHint}</p>
    </header>
    <div className="flex gap-3 rounded-xl border bg-muted/30 p-4 text-xs leading-6"><ShieldCheck className="mt-1 h-4 w-4 shrink-0 text-primary" /><p>{copy.readonly}</p></div>
    <div className="grid gap-6 xl:grid-cols-[230px_minmax(0,1fr)]">
      <aside className="no-print h-fit rounded-xl border bg-card p-4 xl:sticky xl:top-5 xl:max-h-[calc(100vh-2.5rem)] xl:overflow-y-auto">
        <nav aria-label={copy.guide} className="space-y-4"><div><a href="#developer-integration-guide" className="text-xs font-bold uppercase tracking-wide text-primary">{copy.guide}</a><ul className="mt-3 space-y-2 border-l pl-3">{guide.map((section) => <li key={section.id}><a className="block text-xs leading-5 text-muted-foreground hover:text-primary" href={`#developer-guide-${section.id}`}>{section.title}</a></li>)}</ul></div><a href="#developer-api-reference" className="inline-block border-t pt-4 text-xs font-bold uppercase tracking-wide text-primary">{copy.reference} · {catalog.endpoints.length}</a></nav>
      </aside>
      <main className="min-w-0 space-y-8">
        <section id="developer-integration-guide" className="scroll-mt-5 space-y-4">
          <h2 className="border-b pb-3 text-xl font-bold">{copy.guide}</h2>
          <div className="no-print space-y-4 rounded-xl border bg-card p-4"><div><label className="block space-y-2 text-sm font-semibold">{copy.baseUrl}<Input data-help={copy.baseHint} className="font-mono text-xs" type="url" value={baseInput} onChange={(event) => setBaseInput(event.target.value)} aria-invalid={!baseUrl} aria-describedby="developer-base-hint" placeholder="https://api.example.com/api/v1" /></label><p id="developer-base-hint" className="mt-2 text-xs leading-5 text-muted-foreground">{copy.baseHint}</p>{!baseUrl && <p role="alert" className="mt-2 text-xs text-destructive">{copy.baseError}</p>}</div><div><label className="block space-y-2 text-sm font-semibold">{copy.backendOrigin}<Input data-help={copy.backendHint} className="font-mono text-xs" type="url" value={backendInput} onChange={(event) => setBackendInput(event.target.value)} aria-invalid={Boolean(backendInput && !backendOrigin)} aria-describedby="developer-backend-hint" placeholder="http://backend-host:port" /></label><p id="developer-backend-hint" className="mt-2 text-xs leading-5 text-muted-foreground">{copy.backendHint}</p>{backendInput && !backendOrigin && <p role="alert" className="mt-2 text-xs text-destructive">{copy.baseError}</p>}</div></div>
          {guide.map((section, index) => <article className="scroll-mt-5 space-y-4 rounded-xl border bg-card p-4 sm:p-6" id={`developer-guide-${section.id}`} key={section.id}>
            <h3 className="text-lg font-semibold">{index + 1}. {section.title}</h3><p className="text-sm leading-6 text-muted-foreground">{section.purpose}</p>
            {section.steps.length > 0 && <ol className="list-decimal space-y-2 pl-5 text-sm leading-6">{section.steps.map((step, stepIndex) => <li key={stepIndex}>{step}</li>)}</ol>}
            {section.codeSamples.map((sample, sampleIndex) => <CodeSample key={sampleIndex} title={sample.title} code={sample.code.replaceAll("{{API_BASE_URL}}", effectiveBaseUrl)} language={sample.language} copy={copy} />)}
            {section.notes.length > 0 && <div className="rounded-lg border bg-muted/25 p-3"><h4 className="text-xs font-semibold">{copy.notes}</h4><ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-6">{section.notes.map((note, noteIndex) => <li key={noteIndex}>{note}</li>)}</ul></div>}
          </article>)}
        </section>
        <section id="developer-api-reference" className="scroll-mt-5 space-y-4">
          <h2 className="border-b pb-3 text-xl font-bold">{copy.reference}</h2>
          <div className="no-print space-y-4 rounded-xl border bg-card p-4">
            <label className="relative block"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><span className="sr-only">{copy.search}</span><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={copy.searchHint} /></label>
            <div className="grid gap-3 sm:grid-cols-3"><label className="space-y-1 text-xs font-semibold">{copy.group}<select data-help={copy.groupHelp} className="h-10 w-full rounded-md border bg-background px-3 text-xs" value={group} onChange={(event) => setGroup(event.target.value)}><option value="">{copy.all}</option>{groups.map((item) => <option key={item} value={item}>{groupLabel(item, isEnglish)}</option>)}</select></label><label className="space-y-1 text-xs font-semibold">{copy.method}<select data-help={copy.methodHelp} className="h-10 w-full rounded-md border bg-background px-3 text-xs" value={method} onChange={(event) => setMethod(event.target.value)}><option value="">{copy.all}</option>{methods.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label className="space-y-1 text-xs font-semibold">{copy.access}<select data-help={copy.accessHelp} className="h-10 w-full rounded-md border bg-background px-3 text-xs" value={access} onChange={(event) => setAccess(event.target.value)}><option value="">{copy.all}</option>{accessOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>
            <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" onClick={() => setExpanded(new Set(filteredEndpoints.map((endpoint) => endpoint.id)))}>{copy.expand}</Button><Button size="sm" variant="outline" onClick={() => setExpanded(new Set())}>{copy.collapse}</Button>{(search || group || method || access) && <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setGroup(""); setMethod(""); setAccess(""); }}>{copy.clear}</Button>}</div>
          </div>
          <p aria-live="polite" className="text-xs text-muted-foreground">{filteredEndpoints.length} {copy.of} {catalog.endpoints.length} {copy.count}{(search || group || method || access) && <span className="ml-2">({copy.filteredPrint}: {[search, group ? groupLabel(group, isEnglish) : "", method, accessOptions.find((item) => item.value === access)?.label ?? ""].filter(Boolean).join(" · ")})</span>}</p>
          {filteredEndpoints.length === 0 ? <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{copy.empty}</p> : <div className="space-y-3">{filteredEndpoints.map((endpoint) => <EndpointCard key={endpoint.id} endpoint={endpoint} groupName={groupLabel(endpoint.group, isEnglish)} expanded={expanded.has(endpoint.id)} printing={printing} onExpand={() => toggleEndpoint(endpoint.id)} copy={copy} baseUrl={effectiveBaseUrl} backendOrigin={backendOrigin} />)}</div>}
        </section>
        <footer className="space-y-2 border-t pt-4 text-xs leading-5 text-muted-foreground"><p>{copy.generated}: <time dateTime={catalog.generatedAt}>{catalog.generatedAt}</time> · {catalog.endpoints.length} {copy.count}</p><p>{copy.fullCatalog}</p><a className="no-print inline-block text-primary" href="#developer-api-reference">{copy.back}</a></footer>
      </main>
    </div>
  </div>;
}
