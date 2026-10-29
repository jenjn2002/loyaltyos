import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, EyeOff, KeyRound, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copyText } from "@/lib/clipboard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchApi } from "@/lib/api-client";
import { useAdminPermissions } from "@/lib/admin-permissions";

interface ApiAccess {
  programId: string;
  environment: string;
  apiBasePath: string;
}

interface ApiKeyMetadata {
  id: string;
  name: string | null;
  scope: "SERVER" | "CLIENT";
  isActive: boolean;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

interface CreateKeyInput {
  name: string;
  scope: ApiKeyMetadata["scope"];
  expiresInDays: number | null;
}

const strings = {
  en: {
    title: "Program ID & API access",
    description:
      "Use this program identifier and API base URL when integrating with your current environment.",
    programId: "Program ID",
    programHint:
      "This identifier belongs to the signed-in program. Changing it would break existing integrations.",
    environment: "Environment",
    production: "Production",
    staging: "Staging",
    development: "Development",
    test: "Test",
    apiUrl: "API base URL",
    apiHint:
      "This URL uses the current site origin. Use the API origin configured for your integration if it differs.",
    copyProgram: "Copy Program ID",
    copyUrl: "Copy API base URL",
    copied: "Copied.",
    copyFailed: "Clipboard unavailable. Select the value and copy it manually.",
    loading: "Loading…",
    loadError: "Could not load API access settings.",
    docs: "Open developer documentation",
    keys: "API keys",
    keysDescription:
      "Manage integration credentials for this program. Existing key secrets cannot be retrieved.",
    noPermission: "You do not have permission to view API keys.",
    readOnly:
      "You can view API key details. Creating or revoking keys requires the API key management permission.",
    noKeys: "No API keys have been created.",
    keysError: "Could not load API keys.",
    name: "Key name",
    scope: "Scope",
    client: "CLIENT — limited access",
    server: "SERVER — full program access",
    clientHint:
      "CLIENT keys have limited endpoint access. Protected member requests still require a member session.",
    serverWarning:
      "SERVER keys bypass admin role permissions and grant full program access. Use them only on trusted servers; never include them in browser, mobile, or public code.",
    expiry: "Expires in (days)",
    expiryHelp: "Controls how long this key can authenticate API requests. After it expires, requests using it are rejected; this does not affect member point expiry.",
    expiryHint: "Choose 1–3650 days. The default is 90 days.",
    unlimited: "No expiry",
    unlimitedHelp: "No automatic expiry: this key remains usable until revoked, subject to its scope and access checks.",
    unlimitedHint: "A key without an expiry stays valid until revoked. Rotate it regularly.",
    create: "Create API key",
    creating: "Creating…",
    required: "Enter a key name (1–120 characters).",
    invalidExpiry: "Expiry must be a whole number from 1 to 3650 days, or choose No expiry.",
    createError: "Could not create the API key.",
    created: "API key created.",
    oneTime: "New API key (shown once)",
    secretHint:
      "Copy this key to your secure credential store now. After dismissal or leaving this page, its secret cannot be retrieved.",
    copySecret: "Copy API key",
    show: "Show API key",
    hide: "Hide API key",
    dismiss: "I saved it — dismiss",
    status: "Status",
    active: "Active",
    revoked: "Revoked",
    expired: "Expired",
    createdAt: "Created",
    expiresAt: "Expires",
    lastUsedAt: "Last used",
    never: "Never",
    noExpiry: "No expiry",
    actions: "Actions",
    revoke: "Revoke",
    revokeTitle: "Revoke API key?",
    revokeDescription:
      "Integrations using this key will stop working immediately. This cannot be undone.",
    cancel: "Cancel",
    confirmRevoke: "Revoke key",
    revoking: "Revoking…",
    revokeError: "Could not revoke the API key.",
    revokeSuccess: "API key revoked.",
    forbidden:
      "Access denied (403). Your current admin session does not have permission for this action. Ask an Owner to review your API key permissions.",
  },
  vi: {
    title: "Program ID & truy cập API",
    description: "Dùng mã chương trình và địa chỉ gốc API này để tích hợp với môi trường hiện tại.",
    programId: "Program ID",
    programHint:
      "Mã này thuộc chương trình của tài khoản đang đăng nhập. Thay đổi mã sẽ làm hỏng các tích hợp hiện có.",
    environment: "Môi trường",
    production: "Production",
    staging: "Staging",
    development: "Phát triển",
    test: "Kiểm thử",
    apiUrl: "Địa chỉ gốc API",
    apiHint:
      "Địa chỉ này dùng origin của trang hiện tại. Nếu tích hợp dùng origin API khác, hãy dùng địa chỉ đã được cấu hình.",
    copyProgram: "Sao chép Program ID",
    copyUrl: "Sao chép địa chỉ gốc API",
    copied: "Đã sao chép.",
    copyFailed: "Không truy cập được clipboard. Hãy chọn giá trị và sao chép thủ công.",
    loading: "Đang tải…",
    loadError: "Không tải được cấu hình truy cập API.",
    docs: "Mở tài liệu cho lập trình viên",
    keys: "API key",
    keysDescription:
      "Quản lý thông tin xác thực tích hợp cho chương trình này. Không thể xem lại giá trị bí mật của key đã tạo.",
    noPermission: "Bạn không có quyền xem API key.",
    readOnly: "Bạn có thể xem thông tin API key. Tạo hoặc thu hồi key cần quyền quản lý API key.",
    noKeys: "Chưa có API key nào.",
    keysError: "Không tải được danh sách API key.",
    name: "Tên key",
    scope: "Phạm vi",
    client: "CLIENT — quyền truy cập giới hạn",
    server: "SERVER — toàn quyền chương trình",
    clientHint:
      "Key CLIENT chỉ truy cập được một số endpoint. Request thành viên được bảo vệ vẫn cần phiên đăng nhập thành viên.",
    serverWarning:
      "Key SERVER bỏ qua phân quyền vai trò Admin và có toàn quyền chương trình. Chỉ dùng trên máy chủ đáng tin cậy; không đưa vào mã trình duyệt, ứng dụng di động hay mã công khai.",
    expiry: "Hết hạn sau (ngày)",
    expiryHelp: "Thiết lập thời gian key được dùng để xác thực request API. Sau khi hết hạn, request dùng key sẽ bị từ chối; thời hạn này không ảnh hưởng đến điểm của thành viên.",
    expiryHint: "Chọn từ 1–3650 ngày. Mặc định là 90 ngày.",
    unlimited: "Không hết hạn",
    unlimitedHelp: "Key không tự hết hạn và tiếp tục dùng được đến khi bị thu hồi, trong phạm vi quyền và các bước kiểm tra truy cập của key.",
    unlimitedHint: "Key không có thời hạn sẽ có hiệu lực đến khi thu hồi. Hãy thay key định kỳ.",
    create: "Tạo API key",
    creating: "Đang tạo…",
    required: "Nhập tên key (1–120 ký tự).",
    invalidExpiry: "Thời hạn phải là số nguyên từ 1 đến 3650 ngày, hoặc chọn Không hết hạn.",
    createError: "Không tạo được API key.",
    created: "Đã tạo API key.",
    oneTime: "API key mới (chỉ hiển thị một lần)",
    secretHint:
      "Sao chép key vào nơi lưu thông tin xác thực an toàn ngay. Sau khi đóng hoặc rời trang, không thể xem lại giá trị bí mật này.",
    copySecret: "Sao chép API key",
    show: "Hiện API key",
    hide: "Ẩn API key",
    dismiss: "Đã lưu — đóng",
    status: "Trạng thái",
    active: "Đang hoạt động",
    revoked: "Đã thu hồi",
    expired: "Đã hết hạn",
    createdAt: "Ngày tạo",
    expiresAt: "Hết hạn",
    lastUsedAt: "Dùng lần cuối",
    never: "Chưa dùng",
    noExpiry: "Không hết hạn",
    actions: "Thao tác",
    revoke: "Thu hồi",
    revokeTitle: "Thu hồi API key?",
    revokeDescription:
      "Các tích hợp đang dùng key này sẽ ngừng hoạt động ngay. Không thể hoàn tác thao tác này.",
    cancel: "Hủy",
    confirmRevoke: "Thu hồi key",
    revoking: "Đang thu hồi…",
    revokeError: "Không thu hồi được API key.",
    revokeSuccess: "Đã thu hồi API key.",
    forbidden:
      "Truy cập bị từ chối (403). Phiên Admin hiện tại không có quyền thực hiện thao tác này. Hãy nhờ Owner kiểm tra quyền API key của bạn.",
  },
} as const;

type CopyStrings = typeof strings.en | typeof strings.vi;

function errorText(error: unknown, fallback: string, text: CopyStrings): string {
  const message = error instanceof Error ? error.message : "";
  if (/403|forbidden|permission denied|admin session required/i.test(message))
    return text.forbidden;
  return message ? `${fallback} ${message}` : fallback;
}

export function ApiAccessSettings(): JSX.Element | null {
  const permissions = useAdminPermissions();
  if (!permissions.can("settings.view")) return null;
  return (
    <ApiAccessPanel
      key={permissions.data?.id ?? "current-admin"}
      adminId={permissions.data?.id ?? "current-admin"}
      canViewKeys={permissions.can("api_key.view") || permissions.can("api_key.manage")}
      canManage={permissions.can("api_key.manage")}
    />
  );
}

function ApiAccessPanel({
  adminId,
  canViewKeys,
  canManage,
}: {
  adminId: string;
  canViewKeys: boolean;
  canManage: boolean;
}): JSX.Element {
  const { i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? i18n.language).startsWith("vi") ? "vi-VN" : "en-US";
  const text = locale === "vi-VN" ? strings.vi : strings.en;
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<ApiKeyMetadata["scope"]>("CLIENT");
  const [expiryDays, setExpiryDays] = useState("90");
  const [unlimited, setUnlimited] = useState(false);
  const [secret, setSecret] = useState<{ value: string; sessionKey: string } | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyMetadata | null>(null);
  const mounted = useRef(true);
  const createRequest = useRef<AbortController | null>(null);
  const access = useQuery({
    queryKey: ["admin", "settings", "api-access", adminId],
    queryFn: () => fetchApi<ApiAccess>("/admin/settings/api-access"),
    gcTime: 0,
    retry: false,
  });
  const sessionKey = `${adminId}:${access.data?.programId ?? ""}`;
  const currentSession = useRef({ sessionKey, canManage });
  currentSession.current = { sessionKey, canManage };
  const keyQueryKey = ["admin", "settings", "api-keys", sessionKey] as const;
  const keys = useQuery({
    queryKey: keyQueryKey,
    queryFn: () => fetchApi<{ keys: ApiKeyMetadata[] }>("/admin/settings/api-keys"),
    enabled: canViewKeys && Boolean(access.data),
    gcTime: 0,
    retry: false,
  });

  const create = useMutation({
    // Return no response data: the one-time secret must never enter a mutation cache.
    mutationFn: async ({
      input,
      owner,
    }: {
      input: CreateKeyInput;
      owner: string;
    }): Promise<void> => {
      const controller = new AbortController();
      createRequest.current = controller;
      try {
        const result = await fetchApi<{ key: ApiKeyMetadata; secret: string }>(
          "/admin/settings/api-keys",
          {
            method: "POST",
            body: JSON.stringify(input),
            signal: controller.signal,
          },
        );
        if (
          mounted.current &&
          currentSession.current.canManage &&
          currentSession.current.sessionKey === owner &&
          !controller.signal.aborted
        ) {
          setSecret({ value: result.secret, sessionKey: owner });
          setShowSecret(false);
        }
      } finally {
        if (createRequest.current === controller) createRequest.current = null;
      }
    },
    gcTime: 0,
    onSuccess: (_, variables) => {
      create.reset();
      if (
        !mounted.current ||
        !currentSession.current.canManage ||
        currentSession.current.sessionKey !== variables.owner
      )
        return;
      setName("");
      setNotice(text.created);
      void queryClient.invalidateQueries({ queryKey: keyQueryKey });
    },
    onError: (cause: Error, variables) => {
      if (
        mounted.current &&
        currentSession.current.canManage &&
        currentSession.current.sessionKey === variables.owner
      ) {
        setError(errorText(cause, text.createError, text));
      }
    },
  });

  const revoke = useMutation({
    mutationFn: async ({ id }: { id: string; owner: string }): Promise<void> => {
      await fetchApi<{ key: ApiKeyMetadata }>(
        `/admin/settings/api-keys/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
    },
    gcTime: 0,
    onSuccess: (_, variables) => {
      if (
        !mounted.current ||
        !currentSession.current.canManage ||
        currentSession.current.sessionKey !== variables.owner
      )
        return;
      setRevokeTarget(null);
      setNotice(text.revokeSuccess);
      void queryClient.invalidateQueries({ queryKey: keyQueryKey });
    },
    onError: (cause: Error, variables) => {
      if (
        mounted.current &&
        currentSession.current.canManage &&
        currentSession.current.sessionKey === variables.owner
      ) {
        setRevokeTarget(null);
        setError(errorText(cause, text.revokeError, text));
      }
    },
  });

  const resetCreate = create.reset;
  useEffect(() => {
    setSecret(null);
    setShowSecret(false);
    setRevokeTarget(null);
    setNotice(null);
    setError(null);
    createRequest.current?.abort();
    resetCreate();
  }, [sessionKey, canManage, resetCreate]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      createRequest.current?.abort();
      resetCreate();
    };
  }, [resetCreate]);

  const visibleSecret = canManage && secret?.sessionKey === sessionKey ? secret.value : null;
  const apiUrl = access.data
    ? new URL(access.data.apiBasePath, window.location.origin).toString()
    : "";
  const environment = access.data?.environment ?? "";
  const environmentLabel =
    (
      {
        production: text.production,
        staging: text.staging,
        development: text.development,
        test: text.test,
      } as Record<string, string>
    )[environment.toLowerCase()] ?? environment;
  const busy = create.isPending || revoke.isPending;

  async function copyValue(value: string): Promise<void> {
    if (!value) return;
    try {
      await copyText(value);
      if (mounted.current) {
        setNotice(text.copied);
        setError(null);
      }
    } catch {
      if (mounted.current) {
        setError(text.copyFailed);
        setNotice(null);
      }
    }
  }

  function dismissSecret(): void {
    setSecret(null);
    setShowSecret(false);
    setNotice(null);
    create.reset();
  }

  function handleCreate(event: React.FormEvent): void {
    event.preventDefault();
    if (!canManage || !access.data || busy || visibleSecret) return;
    setError(null);
    setNotice(null);
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > 120) {
      setError(text.required);
      return;
    }
    const days = Number(expiryDays);
    if (!unlimited && (!expiryDays.trim() || !Number.isInteger(days) || days < 1 || days > 3650)) {
      setError(text.invalidExpiry);
      return;
    }
    create.mutate({
      input: { name: trimmedName, scope, expiresInDays: unlimited ? null : days },
      owner: sessionKey,
    });
  }

  function dateLabel(value: string | null, fallback: string): string {
    if (!value) return fallback;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(locale);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          {text.title}
        </CardTitle>
        <CardDescription>{text.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {access.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorText(access.error, text.loadError, text)}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="api-program-id">{text.programId}</Label>
                {access.data && (
                  <Badge variant="outline">
                    {text.environment}: {environmentLabel}
                  </Badge>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  id="api-program-id"
                  readOnly
                  value={access.data?.programId ?? ""}
                  placeholder={text.loading}
                  aria-describedby="api-program-id-help"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!access.data}
                  aria-label={text.copyProgram}
                  onClick={() => {
                    void copyValue(access.data?.programId ?? "");
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p id="api-program-id-help" className="text-xs text-muted-foreground">
                {text.programHint}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-base-url">{text.apiUrl}</Label>
              <div className="flex gap-2">
                <Input
                  id="api-base-url"
                  readOnly
                  value={apiUrl}
                  placeholder={text.loading}
                  aria-describedby="api-base-url-help"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!apiUrl}
                  aria-label={text.copyUrl}
                  onClick={() => {
                    void copyValue(apiUrl);
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p id="api-base-url-help" className="text-xs text-muted-foreground">
                {text.apiHint}
              </p>
            </div>
          </div>
        )}
        <Button asChild type="button" variant="link" className="h-auto p-0">
          <Link to="/document?section=developer">{text.docs}</Link>
        </Button>
        <section className="space-y-4 border-t pt-5" aria-labelledby="api-keys-title">
          <div>
            <h3 id="api-keys-title" className="font-semibold">
              {text.keys}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{text.keysDescription}</p>
          </div>
          {!canViewKeys ? (
            <p className="text-sm text-muted-foreground">{text.noPermission}</p>
          ) : (
            <>
              {!canManage && <p className="text-sm text-muted-foreground">{text.readOnly}</p>}
              {keys.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  {errorText(keys.error, text.keysError, text)}
                </p>
              ) : keys.isPending ? (
                <p className="text-sm text-muted-foreground">{text.loading}</p>
              ) : !keys.data?.keys.length ? (
                <p className="text-sm text-muted-foreground">{text.noKeys}</p>
              ) : (
                <Table aria-label={text.keys}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{text.name}</TableHead>
                      <TableHead>{text.scope}</TableHead>
                      <TableHead>{text.status}</TableHead>
                      <TableHead>{text.createdAt}</TableHead>
                      <TableHead>{text.expiresAt}</TableHead>
                      <TableHead>{text.lastUsedAt}</TableHead>
                      {canManage && <TableHead>{text.actions}</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keys.data.keys.map((key) => {
                      const isExpired = Boolean(
                        key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now(),
                      );
                      return (
                        <TableRow key={key.id}>
                          <TableCell className="font-medium">{key.name || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{key.scope}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={key.isActive && !isExpired ? "secondary" : "outline"}>
                              {!key.isActive
                                ? text.revoked
                                : isExpired
                                  ? text.expired
                                  : text.active}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {dateLabel(key.createdAt, "—")}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {dateLabel(key.expiresAt, text.noExpiry)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {dateLabel(key.lastUsedAt, text.never)}
                          </TableCell>
                          {canManage && (
                            <TableCell>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={!key.isActive || busy}
                                aria-label={`${text.revoke} ${key.name}`}
                                onClick={() => {
                                  if (canManage && key.isActive && !busy) {
                                    setError(null);
                                    setNotice(null);
                                    setRevokeTarget(key);
                                  }
                                }}
                              >
                                <Trash2 className="mr-1 h-3.5 w-3.5" />
                                {text.revoke}
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </>
          )}
          {canManage && visibleSecret && (
            <div className="space-y-3 rounded-md border border-primary/40 bg-muted p-4">
              <Label htmlFor="new-api-key">{text.oneTime}</Label>
              <p id="new-api-key-help" className="text-sm">
                {text.secretHint}
              </p>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="new-api-key"
                  type={showSecret ? "text" : "password"}
                  readOnly
                  autoComplete="off"
                  spellCheck={false}
                  value={visibleSecret}
                  aria-describedby="new-api-key-help"
                  className="min-w-0 flex-1 font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  aria-label={showSecret ? text.hide : text.show}
                  onClick={() => {
                    setShowSecret((current) => !current);
                  }}
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void copyValue(visibleSecret);
                  }}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  {text.copySecret}
                </Button>
              </div>
              <Button type="button" variant="outline" onClick={dismissSecret}>
                {text.dismiss}
              </Button>
            </div>
          )}
          {canManage && (
            <form onSubmit={handleCreate} noValidate className="space-y-4 rounded-md border p-4">
              <fieldset
                disabled={!access.data || busy || Boolean(visibleSecret)}
                className="space-y-4"
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="api-key-name">{text.name}</Label>
                    <Input
                      id="api-key-name"
                      value={name}
                      maxLength={120}
                      autoComplete="off"
                      onChange={(event) => {
                        setName(event.target.value);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="api-key-scope">{text.scope}</Label>
                    <select
                      id="api-key-scope"
                      value={scope}
                      onChange={(event) => {
                        setScope(event.target.value === "SERVER" ? "SERVER" : "CLIENT");
                      }}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="CLIENT">{text.client}</option>
                      <option value="SERVER">{text.server}</option>
                    </select>
                  </div>
                </div>
                <p
                  role={scope === "SERVER" ? "note" : undefined}
                  className={
                    scope === "SERVER"
                      ? "rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
                      : "text-xs text-muted-foreground"
                  }
                >
                  {scope === "SERVER" ? text.serverWarning : text.clientHint}
                </p>
                <div className="space-y-2">
                  <Label htmlFor="api-key-expiry">{text.expiry}</Label>
                  <Input
                    id="api-key-expiry"
                    type="number"
                    data-help={text.expiryHelp}
                    min={1}
                    max={3650}
                    step={1}
                    value={expiryDays}
                    disabled={unlimited}
                    onChange={(event) => {
                      setExpiryDays(event.target.value);
                    }}
                    aria-describedby="api-key-expiry-help"
                    className="max-w-48"
                  />
                  <p id="api-key-expiry-help" className="text-xs text-muted-foreground">
                    {text.expiryHint}
                  </p>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      data-help={text.unlimitedHelp}
                      checked={unlimited}
                      onChange={(event) => {
                        setUnlimited(event.target.checked);
                      }}
                    />
                    {text.unlimited}
                  </label>
                  {unlimited && (
                    <p className="text-xs text-muted-foreground">{text.unlimitedHint}</p>
                  )}
                </div>
                <Button type="submit">
                  <Plus className="mr-2 h-4 w-4" />
                  {create.isPending ? text.creating : text.create}
                </Button>
              </fieldset>
            </form>
          )}
        </section>
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialog
          open={canManage && Boolean(revokeTarget)}
          onOpenChange={(open) => {
            if (!open && !revoke.isPending) setRevokeTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{text.revokeTitle}</AlertDialogTitle>
              <AlertDialogDescription>
                {revokeTarget?.name}: {text.revokeDescription}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={revoke.isPending}>{text.cancel}</AlertDialogCancel>
              <AlertDialogAction
                disabled={revoke.isPending}
                onClick={(event) => {
                  event.preventDefault();
                  if (!canManage || !revokeTarget?.isActive || busy) return;
                  revoke.mutate({ id: revokeTarget.id, owner: sessionKey });
                }}
              >
                {revoke.isPending ? text.revoking : text.confirmRevoke}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
