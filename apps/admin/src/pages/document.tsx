import { ArrowRight, BookOpen, CheckCircle2, ChevronDown, CircleAlert, Download, ImagePlus, Pencil, Plus, Search, ShieldCheck, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fetchApi } from "@/lib/api-client";
import { builtInGuideArticles } from "@/content/document-seed";
import type { GuideArticle, GuideArticleContent, GuideLocaleContent, GuideScenario, GuideScreenshot } from "@/content/document-types";

const emptyLocale = (): GuideLocaleContent => ({
  title: "", section: "", route: "", purpose: "", prerequisites: "", steps: [""], result: "", notes: [], scenarios: [], imageAlt: "",
});

type ArticleDraft = Omit<GuideArticle, "id" | "createdAt" | "updatedAt"> & { id?: string };
interface AdminDocumentationResponse { articles: GuideArticle[]; configured: boolean; importedArticles?: number }
type RenderTopic = GuideLocaleContent & { id: string; slug: string; audience: GuideArticle["audience"]; status: GuideArticle["status"]; imageKey: string | null; imageData: string | null; screenshots: GuideScreenshot[]; searchText?: string[] };

function newDraft(): ArticleDraft {
  return {
    audience: "ADMIN", slug: "new-guide", status: "DRAFT", sortOrder: (Date.now() % 100_000), imageKey: "table", imageData: null,
    content: { vi: emptyLocale(), en: emptyLocale(), screenshots: [] },
  };
}

function toDataUrl(file: File, maxDataLength = 480_000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("Chỉ hỗ trợ tệp hình ảnh."));
    if (file.size > 8 * 1024 * 1024) return reject(new Error("Ảnh gốc phải nhỏ hơn 8 MB."));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Không đọc được ảnh."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Tệp này không phải ảnh hợp lệ."));
      image.onload = () => {
        const maxDimension = 1400;
        const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) return reject(new Error("Trình duyệt không xử lý được ảnh."));
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const encode = (quality: number): string => canvas.toDataURL("image/jpeg", quality);
        let data = encode(0.72);
        for (const quality of [0.62, 0.52, 0.42]) {
          if (data.length <= maxDataLength) break;
          data = encode(quality);
        }
        if (data.length > maxDataLength) return reject(new Error("Ảnh sau nén vẫn quá lớn; hãy chọn ảnh nhỏ hoặc cắt gọn ảnh."));
        resolve(data);
      };
      image.src = String(reader.result ?? "");
    };
    reader.readAsDataURL(file);
  });
}

function editorFrom(article: GuideArticle): ArticleDraft {
  return JSON.parse(JSON.stringify(article)) as ArticleDraft;
}

function isGeneratedPlaceholderScenario(scenario: GuideScenario): boolean {
  return /^(?:luồng sử dụng thông thường|typical workflow|normal workflow|không thấy thao tác hoặc thao tác đang bị khóa|when an action is missing or blocked|tình huống cần lưu ý\s*\d*|important case\s*\d*|use case\s*\d*)$/i.test(scenario.title.trim());
}

function articleToTopic(article: GuideArticle, isEnglish: boolean): RenderTopic {
  const language = isEnglish ? article.content.en : article.content.vi;
  const fallback = isEnglish ? article.content.vi : article.content.en;
  return {
    ...fallback,
    ...language,
    section: documentationSection(article.slug, isEnglish, language.section),
    scenarios: (language.scenarios ?? fallback.scenarios ?? []).filter((scenario) => !isGeneratedPlaceholderScenario(scenario)),
    id: article.slug,
    slug: article.slug,
    audience: article.audience,
    status: article.status,
    imageKey: article.imageKey,
    imageData: article.imageData,
    screenshots: article.content.screenshots ?? [],
    searchText: guideLocaleSearchText(fallback),
  };
}
function guideLocaleSearchText(locale: GuideLocaleContent): string[] {
  return [locale.title, locale.section, locale.route, locale.purpose, locale.prerequisites ?? "", locale.result, ...locale.steps, ...locale.notes, ...locale.scenarios.flatMap((scenario) => [scenario.title, scenario.when, scenario.expected, scenario.help ?? "", ...scenario.steps])];
}

const guideSearchStopWords = new Set(["a", "an", "and", "are", "as", "at", "by", "for", "from", "how", "in", "is", "it", "of", "on", "or", "the", "to", "with", "cac", "cach", "cho", "cua", "de", "la", "lam", "mot", "nhung", "phan", "theo", "va", "voi"]);

function normalizeGuideSearchText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function searchGuideTopics<T extends RenderTopic>(topics: T[], query: string): T[] {
  const normalizedQuery = normalizeGuideSearchText(query);
  if (!normalizedQuery) return [...topics];
  const terms = [...new Set(normalizedQuery.split(/\s+/).filter((term) => term && !guideSearchStopWords.has(term)))];
  if (!terms.length) return [...topics];
  const ranked = topics.flatMap((topic, index) => {
    const fields: Array<{ text: string; weight: number }> = [
      { text: topic.title, weight: 100 }, { text: topic.section, weight: 65 }, { text: topic.route, weight: 55 },
      { text: topic.purpose, weight: 35 }, { text: topic.prerequisites ?? "", weight: 22 }, { text: topic.result, weight: 22 },
      ...topic.steps.map((text) => ({ text, weight: 24 })), ...topic.notes.map((text) => ({ text, weight: 12 })),
      ...topic.scenarios.flatMap((scenario) => [{ text: scenario.title, weight: 28 }, { text: scenario.when, weight: 16 }, { text: scenario.expected, weight: 14 }, { text: scenario.help ?? "", weight: 10 }, ...scenario.steps.map((text) => ({ text, weight: 16 }))]),
      ...(topic.searchText ?? []).map((text) => ({ text, weight: 45 })),
    ].map((field) => ({ ...field, text: normalizeGuideSearchText(field.text) }));
    let score = 0;
    for (const term of terms) {
      let best = 0;
      for (const field of fields) {
        const hit = field.text.split(" ").some((word) => word === term || word.startsWith(term) || (term.endsWith("s") && word === term.slice(0, -1)));
        if (hit) best = Math.max(best, field.weight + 8);
      }
      if (!best) return [];
      score += best;
    }
    if (fields.some((field) => field.text.includes(normalizedQuery))) score += 60;
    if (normalizeGuideSearchText(topic.title).startsWith(normalizedQuery)) score += 100;
    return [{ topic, index, score }];
  });
  return ranked.sort((left, right) => right.score - left.score || left.index - right.index).map(({ topic }) => topic);
}

function documentationSection(slug: string, isEnglish: boolean, fallback: string): string {
  const section = (vi: string, en: string) => isEnglish ? en : vi;
  if (slug === "dashboard" || slug === "how-dashboard-widgets") return section("Dashboard", "Dashboard");
  if (slug === "roles-permissions" || slug === "how-admin-accounts-roles" || slug === "how-settings-microsoft-login") return section("Tài khoản admin và phân quyền", "Admin accounts & access");
  if (slug === "members" || slug === "member-fields" || slug === "member-import" || slug.startsWith("how-member-")) return section("Thành viên và dữ liệu", "Members & data");
  if (slug === "point-types" || slug === "wallet-adjustments" || slug === "issuance-rules" || slug === "banks-cycles" || slug === "ledger" || slug.startsWith("how-point-") || slug.startsWith("how-wallet-") || slug.startsWith("how-bank-") || slug.startsWith("how-ledger-")) return section("Điểm, ví và sổ cái", "Points, wallets & ledger");
  if (slug === "segments" || slug === "recognition-categories" || slug === "tiers-badges" || slug.startsWith("how-segment-") || slug.startsWith("how-tiers-") || slug.startsWith("how-badges-") || slug.startsWith("how-recognition-categories")) return section("Phân nhóm và thành tích", "Audience & recognition");
  if (slug === "events" || slug === "campaigns" || slug === "workflows-approvals" || slug === "approval-inbox" || slug.startsWith("how-event-") || slug.startsWith("how-campaign-") || slug.startsWith("how-workflow-") || slug.startsWith("how-approval-")) return section("Campaign, event và phê duyệt", "Campaigns, events & approvals");
  if (slug === "projects" || slug.startsWith("how-project-")) return section("Quản lý dự án", "Project management");
  if (slug === "rewards" || slug === "coupons" || slug === "exchange" || slug.startsWith("how-reward-") || slug.startsWith("how-coupons-") || slug.startsWith("how-exchange-")) return section("Rewards, coupons và exchange", "Rewards, coupons & exchange");
  if (slug === "notification-templates" || slug.startsWith("how-notification-") || slug.startsWith("how-admin-approval-notifications")) return section("Thông báo", "Notifications");
  if (slug === "logs" || slug === "data-export" || slug.startsWith("how-logs-") || slug.startsWith("how-data-export-")) return section("Logs và xuất dữ liệu", "Logs & data exports");
  if (slug === "settings") return section("Cấu hình hệ thống", "System settings");
  return fallback;
}

function ImageBlock({ topic, isEnglish }: { topic: RenderTopic; isEnglish: boolean }): JSX.Element {
  if (topic.imageData) {
    return <figure className="overflow-hidden rounded-xl border bg-background">
      <img src={topic.imageData} alt={topic.imageAlt || topic.title} className="max-h-[480px] w-full object-contain" />
      <figcaption className="border-t px-3 py-2 text-xs text-muted-foreground">{topic.imageAlt || topic.title}</figcaption>
    </figure>;
  }
  return <figure className="grid min-h-56 place-items-center rounded-xl border border-dashed bg-muted/20 p-5 text-center text-sm text-muted-foreground">
    {isEnglish ? "No real feature screenshot has been added yet. Upload one in Manage guides." : "Chưa có ảnh chụp màn hình thật cho tính năng này. Hãy tải ảnh lên trong Quản lý hướng dẫn."}
  </figure>;
}

function ScreenshotGallery({ screenshots, isEnglish }: { screenshots: GuideScreenshot[]; isEnglish: boolean }): JSX.Element | null {
  if (screenshots.length === 0) return null;
  return <section className="space-y-2">
    <h3 className="text-sm font-semibold">{isEnglish ? "Screenshots for each step" : "Ảnh chụp theo từng bước"}</h3>
    <div className="grid gap-3 sm:grid-cols-2">
      {[...screenshots].sort((left, right) => left.step - right.step).map((screenshot, index) => <figure className="overflow-hidden rounded-lg border bg-background" key={`${screenshot.step}-${index}`}>
        <img loading="lazy" src={screenshot.imageData} alt={isEnglish ? screenshot.caption.en : screenshot.caption.vi} className="max-h-[360px] w-full object-contain" />
        <figcaption className="border-t px-3 py-2 text-xs leading-5 text-muted-foreground"><strong className="mr-1 text-foreground">{isEnglish ? `Step ${screenshot.step}` : `Bước ${screenshot.step}`}.</strong>{isEnglish ? screenshot.caption.en : screenshot.caption.vi}</figcaption>
      </figure>)}
    </div>
  </section>;
}

function ScreenshotEditor({
  screenshots,
  isEnglish,
  onChange,
  onError,
}: {
  screenshots: GuideScreenshot[];
  isEnglish: boolean;
  onChange: (next: GuideScreenshot[]) => void;
  onError: (message: string | null) => void;
}): JSX.Element {
  const addScreenshot = async (file: File) => {
    try {
      const imageData = await toDataUrl(file, 240_000);
      onChange([...screenshots, {
        step: screenshots.length + 1,
        imageData,
        caption: { vi: "", en: "" },
      }]);
      onError(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Image upload failed");
    }
  };
  const updateScreenshot = (index: number, update: Partial<GuideScreenshot>) => onChange(screenshots.map((screenshot, screenshotIndex) => screenshotIndex === index ? { ...screenshot, ...update } : screenshot));

  return <section className="mt-5 space-y-3 rounded-lg border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h4 className="text-sm font-semibold">{isEnglish ? "Step-by-step screenshots" : "Ảnh chụp theo từng bước"}</h4><p className="mt-1 text-xs text-muted-foreground">{isEnglish ? "Add up to four actual app screenshots, each with a step number and Vietnamese/English caption." : "Thêm tối đa bốn ảnh chụp app thật; mỗi ảnh có số bước và chú thích tiếng Việt/Anh."}</p></div>
      <label className={`inline-flex items-center rounded-md border px-3 py-1.5 text-xs font-medium ${screenshots.length >= 4 ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-muted"}`}>
        <input className="sr-only" type="file" accept="image/*" disabled={screenshots.length >= 4} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void addScreenshot(file); }} />
        {isEnglish ? "Add step screenshot" : "Thêm ảnh bước"}
      </label>
    </div>
    {screenshots.map((screenshot, index) => <div key={index} className="grid gap-3 rounded-md border bg-muted/20 p-3 md:grid-cols-[minmax(180px,0.8fr)_minmax(0,1.2fr)]">
      <div className="space-y-2"><img src={screenshot.imageData} alt={screenshot.caption[isEnglish ? "en" : "vi"] || (isEnglish ? `Screenshot for step ${screenshot.step}` : `Ảnh minh họa bước ${screenshot.step}`)} className="max-h-56 w-full rounded-md border bg-background object-contain" /><div className="flex items-center gap-2"><label className="flex items-center gap-2 text-xs font-medium">{isEnglish ? "Step" : "Bước"}<Input className="w-20" type="number" min={1} max={40} value={screenshot.step} onChange={(event) => updateScreenshot(index, { step: Number(event.target.value) })} /></label><Button type="button" size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => onChange(screenshots.filter((_, screenshotIndex) => screenshotIndex !== index))}><X className="mr-1 h-3.5 w-3.5" />{isEnglish ? "Remove" : "Gỡ ảnh"}</Button></div></div>
      <div className="grid content-start gap-2"><label className="space-y-1 text-xs font-medium">{isEnglish ? "Vietnamese caption" : "Chú thích tiếng Việt"}<Input value={screenshot.caption.vi} onChange={(event) => updateScreenshot(index, { caption: { ...screenshot.caption, vi: event.target.value } })} /></label><label className="space-y-1 text-xs font-medium">{isEnglish ? "English caption" : "Chú thích tiếng Anh"}<Input value={screenshot.caption.en} onChange={(event) => updateScreenshot(index, { caption: { ...screenshot.caption, en: event.target.value } })} /></label></div>
    </div>)}
    {screenshots.length === 0 && <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">{isEnglish ? "No step screenshots have been added yet." : "Chưa có ảnh theo bước. Mỗi ảnh nên thể hiện một màn hình/thao tác cụ thể."}</p>}
  </section>;
}

function LocaleEditor({
  value,
  onChange,
  isEnglish,
}: {
  value: GuideLocaleContent;
  onChange: (next: GuideLocaleContent) => void;
  isEnglish: boolean;
}): JSX.Element {
  const label = isEnglish
    ? { title: "Title", section: "Section", route: "App path", purpose: "Purpose", pre: "Before you start", steps: "Main workflow · one step per line", result: "Expected result", notes: "Notes / known limitations · one per line", scenarios: "Use cases and troubleshooting", addCase: "Add use case", when: "When to use this path", caseSteps: "Actions · one per line", expected: "Expected result", help: "If it still does not work", imageAlt: "Image description" }
    : { title: "Tiêu đề", section: "Nhóm tính năng", route: "Đường dẫn trong app", purpose: "Mục đích", pre: "Trước khi bắt đầu", steps: "Luồng chính · mỗi bước một dòng", result: "Kết quả mong đợi", notes: "Lưu ý / giới hạn · mỗi ý một dòng", scenarios: "Tình huống sử dụng và cách xử lý", addCase: "Thêm tình huống", when: "Khi nào dùng luồng này", caseSteps: "Các bước xử lý · mỗi bước một dòng", expected: "Kết quả mong đợi", help: "Nếu vẫn chưa xử lý được", imageAlt: "Mô tả ảnh" };
  const update = <K extends keyof GuideLocaleContent>(key: K, next: GuideLocaleContent[K]) => onChange({ ...value, [key]: next });
  const lines = (items: string[]) => items.join("\n");
  const fromLines = (text: string) => text.split("\n").map((line) => line.trim()).filter(Boolean);
  const setScenario = (index: number, scenario: GuideScenario) => update("scenarios", value.scenarios.map((item, itemIndex) => itemIndex === index ? scenario : item));
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm font-medium">{label.title}<Input value={value.title} onChange={(event) => update("title", event.target.value)} /></label>
      <label className="space-y-1 text-sm font-medium">{label.section}<Input value={value.section} onChange={(event) => update("section", event.target.value)} /></label>
      <label className="space-y-1 text-sm font-medium sm:col-span-2">{label.route}<Input value={value.route} onChange={(event) => update("route", event.target.value)} placeholder="/members" /></label>
      <label className="space-y-1 text-sm font-medium sm:col-span-2">{label.purpose}<Textarea value={value.purpose} onChange={(event) => update("purpose", event.target.value)} /></label>
      <label className="space-y-1 text-sm font-medium sm:col-span-2">{label.pre}<Textarea value={value.prerequisites ?? ""} onChange={(event) => update("prerequisites", event.target.value)} /></label>
      <label className="space-y-1 text-sm font-medium sm:col-span-2">{label.steps}<Textarea value={lines(value.steps)} onChange={(event) => update("steps", fromLines(event.target.value))} /></label>
      <label className="space-y-1 text-sm font-medium sm:col-span-2">{label.result}<Textarea value={value.result} onChange={(event) => update("result", event.target.value)} /></label>
      <label className="space-y-1 text-sm font-medium sm:col-span-2">{label.notes}<Textarea value={lines(value.notes)} onChange={(event) => update("notes", fromLines(event.target.value))} /></label>
      <label className="space-y-1 text-sm font-medium sm:col-span-2">{label.imageAlt}<Input value={value.imageAlt ?? ""} onChange={(event) => update("imageAlt", event.target.value)} /></label>
    </div>
    <section className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold">{label.scenarios}</h4><Button type="button" size="sm" variant="outline" onClick={() => update("scenarios", [...value.scenarios, { title: "", when: "", steps: [], expected: "", help: "" }])}><Plus className="mr-1 h-4 w-4" />{label.addCase}</Button></div>
      {value.scenarios.length === 0 && <p className="text-xs text-muted-foreground">{isEnglish ? "Add alternate flows, exceptional dates, denied/pending cases, or troubleshooting steps." : "Thêm luồng thay thế, ngoại lệ, trường hợp bị từ chối/đang chờ hoặc các bước xử lý lỗi."}</p>}
      {value.scenarios.map((scenario, index) => <div key={index} className="space-y-3 rounded-md border bg-muted/20 p-3">
        <div className="flex items-start gap-2"><label className="flex-1 space-y-1 text-xs font-medium">{label.title}<Input value={scenario.title} onChange={(event) => setScenario(index, { ...scenario, title: event.target.value })} /></label><Button className="mt-5" type="button" variant="ghost" size="icon" aria-label={isEnglish ? "Remove use case" : "Xóa tình huống"} onClick={() => update("scenarios", value.scenarios.filter((_, itemIndex) => itemIndex !== index))}><X className="h-4 w-4" /></Button></div>
        <label className="block space-y-1 text-xs font-medium">{label.when}<Textarea value={scenario.when} onChange={(event) => setScenario(index, { ...scenario, when: event.target.value })} /></label>
        <label className="block space-y-1 text-xs font-medium">{label.caseSteps}<Textarea value={lines(scenario.steps)} onChange={(event) => setScenario(index, { ...scenario, steps: fromLines(event.target.value) })} /></label>
        <label className="block space-y-1 text-xs font-medium">{label.expected}<Textarea value={scenario.expected} onChange={(event) => setScenario(index, { ...scenario, expected: event.target.value })} /></label>
        <label className="block space-y-1 text-xs font-medium">{label.help}<Textarea value={scenario.help ?? ""} onChange={(event) => setScenario(index, { ...scenario, help: event.target.value })} /></label>
      </div>)}
    </section>
  </div>;
}

export function AdminDocumentPage(): JSX.Element {
  const { i18n } = useTranslation();
  const isEnglish = i18n.resolvedLanguage?.startsWith("en") ?? i18n.language.startsWith("en");
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [contentsOpen, setContentsOpen] = useState(false);
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [managementMode, setManagementMode] = useState(false);
  const [draft, setDraft] = useState<ArticleDraft | null>(null);
  const [editLanguage, setEditLanguage] = useState<"vi" | "en">(isEnglish ? "en" : "vi");
  const [imageError, setImageError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showDrafts, setShowDrafts] = useState(false);
  const [editorSession, setEditorSession] = useState(0);
  const editorRef = useRef<HTMLDivElement>(null);
  const copy = isEnglish
    ? {
        eyebrow: "ADMINISTRATOR GUIDE", title: "LoyaltyOS Admin guide", intro: "Find a feature to learn its purpose, prerequisites, workflows, alternate cases, and expected results.", searchLabel: "Search the admin guide", searchPlaceholder: "Search: member import, workflow, bank cycle...", contents: "Contents by taskbar group", home: "Back to Dashboard", permissionsTitle: "Permissions:", permissionsBody: "Menus and actions depend on each role's capabilities. If an option is missing, check permissions first.", liveTitle: "Live actions:", liveBody: "Wallet adjustments, point imports, Run campaign now, approvals, and project awards can change real data or balances.", empty: "No matching topics. Try a different search term.", purpose: "What is this feature for?", prerequisites: "Before you start:", steps: "Main workflow", result: "Expected result", notes: "Important notes", situations: "Use cases and troubleshooting", caseWhen: "Use this path when", caseHelp: "If it still does not work", footer: "LoyaltyOS Admin guide · Illustrations use sample data only.", exportPdf: "Export PDF", pdfHint: "In the print dialog, choose Save as PDF.", manage: "Manage guides", stopManaging: "Done", create: "New guide", publish: "Published", draft: "Draft", audience: "Audience", customer: "Customer", admin: "Admin", sortOrder: "Display order", slug: "Article key", save: "Save guide", cancel: "Cancel", delete: "Delete", edit: "Edit", view: "View", image: "Feature screenshot", removeImage: "Remove image", upload: "Upload screenshot", all: "All articles", publishedOnly: "Published only", vi: "Vietnamese", en: "English", confirmDelete: "Permanently delete this guide? This cannot be undone.", saveError: "Unable to save the guide.", deleteError: "Unable to delete the guide.", introManage: "Create, edit, publish, or delete bilingual articles. Customer users see published customer guides only.", status: "Publishing status", altImage: "Feature illustration", generatedImage: "Upload a screenshot for this feature; otherwise a sample mockup is shown.", noAdminAccess: "Changes require Manage documentation permission.", addProcedures: (count: number) => `Add ${count} new built-in procedures`,
      }
    : {
        eyebrow: "CẨM NANG QUẢN TRỊ", title: "Hướng dẫn LoyaltyOS Admin", intro: "Tra cứu mục đích, điều kiện, luồng chính, tình huống thay thế và kết quả mong đợi của từng tính năng.", searchLabel: "Tìm trong hướng dẫn admin", searchPlaceholder: "Tìm: member import, workflow, bank cycle...", contents: "Mục lục theo taskbar", home: "Về Dashboard", permissionsTitle: "Quyền hạn:", permissionsBody: "Menu và thao tác thay đổi theo role/capability. Nếu thiếu nút, kiểm tra quyền trước khi coi đó là lỗi.", liveTitle: "Thao tác thật:", liveBody: "Điều chỉnh ví, import điểm, Run campaign now, duyệt và issue project có thể làm thay đổi dữ liệu/điểm thật.", empty: "Không tìm thấy nội dung phù hợp. Thử từ khóa khác.", purpose: "Tính năng này để làm gì?", prerequisites: "Trước khi bắt đầu:", steps: "Luồng chính", result: "Kết quả mong đợi", notes: "Lưu ý quan trọng", situations: "Tình huống sử dụng và xử lý", caseWhen: "Dùng luồng này khi", caseHelp: "Nếu vẫn chưa xử lý được", footer: "Hướng dẫn dành cho LoyaltyOS Admin · Chỉ dùng dữ liệu ví dụ trong minh họa.", exportPdf: "Xuất PDF", pdfHint: "Trong hộp thoại in, chọn Lưu thành PDF.", manage: "Quản lý hướng dẫn", stopManaging: "Hoàn tất", create: "Thêm hướng dẫn", publish: "Đã xuất bản", draft: "Bản nháp", audience: "Đối tượng", customer: "Customer", admin: "Admin", sortOrder: "Thứ tự hiển thị", slug: "Mã bài viết", save: "Lưu hướng dẫn", cancel: "Hủy", delete: "Xóa", edit: "Sửa", view: "Xem", image: "Ảnh chụp tính năng", removeImage: "Gỡ ảnh", upload: "Tải ảnh hướng dẫn", all: "Tất cả bài", publishedOnly: "Chỉ đã xuất bản", vi: "Tiếng Việt", en: "Tiếng Anh", confirmDelete: "Xóa vĩnh viễn hướng dẫn này? Không thể hoàn tác.", saveError: "Không lưu được hướng dẫn.", deleteError: "Không xóa được hướng dẫn.", introManage: "Tạo, sửa, xuất bản hoặc xóa bài hướng dẫn song ngữ. Customer chỉ xem hướng dẫn customer đã xuất bản.", status: "Trạng thái xuất bản", altImage: "Mô tả ảnh minh họa", generatedImage: "Tải ảnh chụp riêng cho tính năng; nếu chưa có, hệ thống sẽ hiện mockup mẫu.", noAdminAccess: "Thay đổi cần quyền Manage documentation.", addProcedures: (count: number) => `Thêm ${count} bài hướng dẫn chi tiết mới`,
      };

  const articles = useQuery({
    queryKey: ["admin", "documentation"],
    queryFn: async () => {
      const current = await fetchApi<AdminDocumentationResponse>("/admin/documentation");
      if (current.configured || current.articles.length) return current;
      try {
        return await fetchApi<AdminDocumentationResponse>("/admin/documentation/seed", { method: "POST", body: JSON.stringify({ articles: builtInGuideArticles }) });
      } catch {
        return current;
      }
    },
  });
  const save = useMutation({
    mutationFn: async (value: ArticleDraft) => {
      const body = JSON.stringify({ ...value, id: undefined });
      return fetchApi<GuideArticle>(value.id ? `/admin/documentation/${value.id}` : "/admin/documentation", { method: value.id ? "PATCH" : "POST", body });
    },
    onSuccess: async () => { setDraft(null); setNotice(isEnglish ? "Guide saved." : "Đã lưu hướng dẫn."); await queryClient.invalidateQueries({ queryKey: ["admin", "documentation"] }); },
    onError: (error) => setNotice(error instanceof Error ? error.message : copy.saveError),
  });
  const remove = useMutation({
    mutationFn: (id: string) => fetchApi<void>(`/admin/documentation/${id}`, { method: "DELETE" }),
    onSuccess: async () => { setNotice(isEnglish ? "Guide deleted." : "Đã xóa hướng dẫn."); await queryClient.invalidateQueries({ queryKey: ["admin", "documentation"] }); },
    onError: (error) => setNotice(error instanceof Error ? error.message : copy.deleteError),
  });

  const importMissing = useMutation({
    mutationFn: async (pendingArticles: GuideArticle[]) => fetchApi<AdminDocumentationResponse>("/admin/documentation/seed", {
      method: "POST",
      body: JSON.stringify({ articles: pendingArticles, missingOnly: true }),
    }),
    onSuccess: async (response) => {
      setNotice(isEnglish
        ? `Added ${response.importedArticles ?? 0} new guide articles. Existing CMS articles were left unchanged.`
        : `Đã thêm ${response.importedArticles ?? 0} bài hướng dẫn mới. Các bài CMS hiện có được giữ nguyên.`);
      await queryClient.invalidateQueries({ queryKey: ["admin", "documentation"] });
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : copy.noAdminAccess),
  });

  const allArticles = articles.data?.configured
    ? articles.data.articles
    : articles.data?.articles.length
      ? articles.data.articles
      : builtInGuideArticles;
  const adminArticles = allArticles.filter((article) => article.audience === "ADMIN");
  const managementArticles = articles.data?.articles ?? [];
  const existingGuideKeys = new Set(managementArticles.map((article) => `${article.audience}:${article.slug}`));
  const missingBuiltInArticles = builtInGuideArticles.filter((article) => !existingGuideKeys.has(`${article.audience}:${article.slug}`));
  const visibleArticles = adminArticles.filter((article) => showDrafts || article.status === "PUBLISHED");
  const localizedTopics = visibleArticles.map((article) => articleToTopic(article, isEnglish));
  const filteredTopics = useMemo(() => {
    return searchGuideTopics(localizedTopics, query);
  }, [localizedTopics, query]);
  const groups = [...new Set(filteredTopics.map((topic) => topic.section))];
  const filteredTopicKey = filteredTopics.map((topic) => topic.id).join("\u0000");

  useEffect(() => {
    const topicIds = filteredTopicKey ? filteredTopicKey.split("\u0000") : [];
    if (topicIds.length === 0) {
      setActiveTopicId(null);
      return;
    }
    const firstTopicId = topicIds[0];
    if (!firstTopicId) return;

    let frame: number | undefined;
    const updateActiveTopic = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        const readingLine = Math.min(window.innerHeight * 0.28, 240);
        let currentTopicId = firstTopicId;
        for (const topicId of topicIds) {
          const article = document.getElementById(topicId);
          if (!article) continue;
          if (article.getBoundingClientRect().top > readingLine) break;
          currentTopicId = topicId;
        }
        setActiveTopicId((previous) => previous === currentTopicId ? previous : currentTopicId);
      });
    };

    updateActiveTopic();
    window.addEventListener("scroll", updateActiveTopic, { passive: true });
    window.addEventListener("resize", updateActiveTopic);
    window.addEventListener("hashchange", updateActiveTopic);
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateActiveTopic);
      window.removeEventListener("resize", updateActiveTopic);
      window.removeEventListener("hashchange", updateActiveTopic);
    };
  }, [filteredTopicKey]);

  useEffect(() => {
    if (!activeTopicId || window.matchMedia("(max-width: 1279px)").matches) return;
    document.getElementById(`guide-nav-${activeTopicId}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTopicId]);

  const saveDraft = () => {
    if (!draft) return;
    const screenshots = draft.content.screenshots ?? [];
    if (screenshots.some((screenshot) => !screenshot.caption.vi.trim() || !screenshot.caption.en.trim())) {
      setNotice(isEnglish ? "Add a caption in both languages for every step screenshot." : "Hãy thêm chú thích tiếng Việt và tiếng Anh cho tất cả ảnh theo bước.");
      return;
    }
    const prepared = {
      ...draft,
      content: {
        vi: { ...draft.content.vi, scenarios: draft.content.vi.scenarios.filter((item) => item.title.trim()) },
        en: { ...draft.content.en, scenarios: draft.content.en.scenarios.filter((item) => item.title.trim()) },
        screenshots,
      },
    };
    save.mutate(prepared);
  };

  const openEditor = (value: ArticleDraft) => {
    setDraft(value);
    setImageError(null);
    setNotice(null);
    setEditorSession((session) => session + 1);
  };

  useEffect(() => {
    if (!editorSession) return;
    const frame = window.requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editorSession]);

  return (
    <div className="documentation-print-area mx-auto max-w-7xl">
      <header className="overflow-hidden rounded-2xl bg-slate-950 px-5 py-7 text-white sm:px-8 sm:py-9">
        <div className="max-w-4xl">
          <div className="flex items-center gap-2 text-sm font-medium text-violet-200"><BookOpen className="h-4 w-4" /> {copy.eyebrow}</div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{copy.title}</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">{copy.intro}</p>
          <label className="no-print mt-6 flex max-w-2xl items-center gap-3 rounded-xl border border-white/15 bg-white/10 px-4 py-3 focus-within:ring-2 focus-within:ring-violet-300">
            <Search className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" /><span className="sr-only">{copy.searchLabel}</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchPlaceholder} className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-400" />
          </label>
        </div>
        <div className="no-print mt-5 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => window.print()}><Download className="mr-1.5 h-4 w-4" />{copy.exportPdf}</Button><span className="self-center text-xs text-slate-300">{copy.pdfHint}</span>
          <Button size="sm" variant={managementMode ? "secondary" : "outline"} className={managementMode ? "" : "border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"} onClick={() => { setManagementMode((value) => !value); setDraft(null); }}><Pencil className="mr-1.5 h-4 w-4" />{managementMode ? copy.stopManaging : copy.manage}</Button>
        </div>
      </header>

      {managementMode && <section className="no-print mt-5 rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">{copy.manage}</h2><p className="mt-1 text-sm text-muted-foreground">{copy.introManage}</p></div><div className="flex flex-wrap gap-2">{missingBuiltInArticles.length > 0 && <Button variant="outline" size="sm" disabled={importMissing.isPending} onClick={() => importMissing.mutate(missingBuiltInArticles)}>{copy.addProcedures(missingBuiltInArticles.length)}</Button>}<Button variant="outline" size="sm" onClick={() => setShowDrafts((value) => !value)}>{showDrafts ? copy.publishedOnly : copy.all}</Button><Button size="sm" onClick={() => { openEditor(newDraft()); setEditLanguage(isEnglish ? "en" : "vi"); }}><Plus className="mr-1.5 h-4 w-4" />{copy.create}</Button></div></div>
        {notice && <p role="status" className="mt-3 rounded-md border bg-muted px-3 py-2 text-sm">{notice}</p>}
        {articles.isError && <p role="alert" className="mt-3 rounded-md border border-destructive/40 px-3 py-2 text-sm">{copy.noAdminAccess}</p>}
        {articles.isFetching && <p className="mt-3 text-xs text-muted-foreground">{isEnglish ? "Loading articles…" : "Đang tải bài hướng dẫn…"}</p>}
        <div className="mt-4 divide-y rounded-md border">
          {managementArticles.map((article) => <div key={article.id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{article.content[isEnglish ? "en" : "vi"].title || article.content.vi.title}</p><p className="text-xs text-muted-foreground">{article.audience === "CUSTOMER" ? copy.customer : copy.admin} · {article.status === "PUBLISHED" ? copy.publish : copy.draft} · /{article.slug}</p></div>
            <Button size="sm" variant="outline" onClick={() => openEditor(editorFrom(article))}><Pencil className="mr-1 h-3.5 w-3.5" />{copy.edit}</Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { if (window.confirm(copy.confirmDelete)) remove.mutate(article.id); }}><Trash2 className="mr-1 h-3.5 w-3.5" />{copy.delete}</Button>
          </div>)}
          {managementArticles.length === 0 && <p className="p-3 text-sm text-muted-foreground">{copy.noAdminAccess}</p>}
        </div>
        {draft && <div ref={editorRef} className="mt-5 scroll-mt-5 rounded-xl border bg-background p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-base font-semibold">{draft.id ? copy.edit : copy.create}</h3><Button variant="ghost" size="icon" aria-label={copy.cancel} onClick={() => { setDraft(null); setImageError(null); }}><X className="h-4 w-4" /></Button></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1 text-sm font-medium">{copy.audience}<select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={draft.audience} onChange={(event) => setDraft({ ...draft, audience: event.target.value as GuideArticle["audience"] })}><option value="ADMIN">{copy.admin}</option><option value="CUSTOMER">{copy.customer}</option></select></label>
            <label className="space-y-1 text-sm font-medium">{copy.status}<select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as GuideArticle["status"] })}><option value="DRAFT">{copy.draft}</option><option value="PUBLISHED">{copy.publish}</option></select></label>
            <label className="space-y-1 text-sm font-medium">{copy.sortOrder}<Input type="number" min={0} value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) })} /></label>
            <label className="space-y-1 text-sm font-medium">{copy.slug}<Input value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} /></label>
          </div>
          <div className="mt-5 flex flex-wrap gap-2 border-b pb-3"><Button type="button" size="sm" variant={editLanguage === "vi" ? "default" : "outline"} onClick={() => setEditLanguage("vi")}>{copy.vi}</Button><Button type="button" size="sm" variant={editLanguage === "en" ? "default" : "outline"} onClick={() => setEditLanguage("en")}>{copy.en}</Button></div>
          <div className="mt-4"><LocaleEditor value={draft.content[editLanguage]} isEnglish={editLanguage === "en"} onChange={(locale) => setDraft({ ...draft, content: { ...draft.content, [editLanguage]: locale } as GuideArticleContent })} /></div>
          <div className="mt-5 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2"><ImagePlus className="h-4 w-4" /><strong className="text-sm">{copy.image}</strong><label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"><input className="sr-only" type="file" accept="image/*" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (!file) return; setImageError(null); void toDataUrl(file).then((imageData) => setDraft({ ...draft, imageData, imageKey: null })).catch((error: unknown) => setImageError(error instanceof Error ? error.message : "Image upload failed")); }} />{copy.upload}</label>{draft.imageData && <Button size="sm" variant="ghost" onClick={() => setDraft({ ...draft, imageData: null })}><X className="mr-1 h-3.5 w-3.5" />{copy.removeImage}</Button>}</div>
            <p className="mt-2 text-xs text-muted-foreground">{isEnglish ? "Upload an actual screenshot of this feature. No sample mockup is used." : "Tải ảnh chụp màn hình thật của tính năng. Không sử dụng mockup mẫu."}</p>
            {draft.imageData ? <img src={draft.imageData} alt={draft.content[editLanguage].imageAlt || draft.content[editLanguage].title} className="mt-3 max-h-72 rounded-md border object-contain" /> : <div className="mt-3 rounded-md border border-dashed p-4 text-xs text-muted-foreground">{isEnglish ? "No actual feature screenshot uploaded yet." : "Chưa tải ảnh chụp màn hình thật cho tính năng."}</div>}
            {imageError && <p className="mt-2 text-sm text-destructive">{imageError}</p>}
          </div>
          <ScreenshotEditor screenshots={draft.content.screenshots ?? []} isEnglish={isEnglish} onChange={(screenshots) => setDraft((current) => current ? { ...current, content: { ...current.content, screenshots } } : current)} onError={setImageError} />
          <div className="mt-5 flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => setDraft(null)}>{copy.cancel}</Button><Button disabled={save.isPending} onClick={saveDraft}>{save.isPending ? (isEnglish ? "Saving…" : "Đang lưu…") : copy.save}</Button></div>
        </div>}
      </section>}

      <div className="mt-6 grid gap-6 xl:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="no-print h-fit rounded-xl border bg-card p-4 xl:sticky xl:top-5 xl:max-h-[calc(100vh-2.5rem)] xl:overflow-y-auto">
          <button type="button" aria-expanded={contentsOpen} aria-controls="admin-guide-contents" className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm font-semibold xl:hidden" onClick={() => setContentsOpen((open) => !open)}>
            <span>{copy.contents}<span className="mt-1 block text-xs font-normal text-muted-foreground">{filteredTopics.find((topic) => topic.id === activeTopicId)?.title}</span></span>
            <ChevronDown aria-hidden="true" className={"h-5 w-5 shrink-0 transition-transform " + (contentsOpen ? "rotate-180" : "")} />
          </button>
          <p className="hidden text-xs font-bold uppercase tracking-wide text-muted-foreground xl:block">{copy.contents}</p>
          <div id="admin-guide-contents" className={(contentsOpen ? "block " : "hidden ") + "xl:block"}>
          <nav className="mt-3 space-y-4" aria-label={copy.contents}>{groups.map((group) => <div key={group}><p className="mb-1.5 text-xs font-semibold">{group}</p><ul className="space-y-1 border-l pl-3">{filteredTopics.filter((topic) => topic.section === group).map((topic) => {
            const isActive = activeTopicId === topic.id;
            return <li key={topic.id}><a id={`guide-nav-${topic.id}`} aria-current={isActive ? "location" : undefined} className={`block rounded-md px-2 py-1 text-xs leading-5 transition-colors ${isActive ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} href={`#${topic.id}`}>{topic.title}</a></li>;
          })}</ul></div>)}</nav>
          </div>
          <div className="mt-5 border-t pt-4"><Link to="/" className="inline-flex items-center gap-1 text-xs font-semibold text-primary">{copy.home}<ArrowRight className="h-3 w-3" /></Link></div>
        </aside>
        <main className="min-w-0">
          <div className="no-print mb-5 grid gap-3 rounded-xl border bg-muted/30 p-4 text-xs leading-5 sm:grid-cols-2"><div className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /><p><strong>{copy.permissionsTitle}</strong> {copy.permissionsBody}</p></div><div className="flex gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><p><strong>{copy.liveTitle}</strong> {copy.liveBody}</p></div></div>
          {filteredTopics.length === 0 ? <div className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">{copy.empty}</div> : <div className="space-y-4">{filteredTopics.map((topic, index) => <div key={topic.id}>{(index === 0 || filteredTopics[index - 1]?.section !== topic.section) && <h2 className="border-b pb-2 pt-3 text-lg font-bold tracking-tight">{topic.section}</h2>}<article id={topic.id} className={`scroll-mt-5 rounded-xl border p-4 shadow-sm transition-colors sm:p-6 ${activeTopicId === topic.id ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border bg-card"}`}>
            <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(310px,0.8fr)] 2xl:items-start">
              <div><div className="flex flex-wrap items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{index + 1}</span><span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{topic.section}</span><Link to={topic.route || "/"} className="ml-auto rounded-md border px-2 py-1 font-mono text-[10px] text-muted-foreground hover:text-primary">{topic.route || "/"}</Link></div>
                <h2 className="mt-3 text-xl font-bold tracking-tight">{topic.title}</h2><div className="mt-4 rounded-lg border bg-muted/20 p-4"><h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{copy.purpose}</h3><p className="mt-1.5 text-sm leading-6">{topic.purpose}</p></div>
                {topic.prerequisites && <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-950 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100"><strong>{copy.prerequisites}</strong> {topic.prerequisites}</p>}
                <div className="mt-4"><h3 className="text-sm font-semibold">{copy.steps}</h3><ol className="mt-2 space-y-2.5">{topic.steps.map((step, stepIndex) => <li className="flex gap-2.5 text-sm leading-6 text-muted-foreground" key={`${stepIndex}-${step}`}><span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-bold text-foreground">{stepIndex + 1}</span><span>{step}</span></li>)}</ol></div>
              </div>
              <div className="space-y-3"><ImageBlock topic={topic} isEnglish={isEnglish} /><ScreenshotGallery screenshots={topic.screenshots} isEnglish={isEnglish} /><div className="rounded-lg border bg-background p-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="h-4 w-4 text-emerald-600" />{copy.result}</h3><p className="mt-1.5 text-sm leading-6 text-muted-foreground">{topic.result}</p></div>{topic.notes.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><h3 className="text-xs font-bold uppercase tracking-wide">{copy.notes}</h3><ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5">{topic.notes.map((note) => <li key={note}>{note}</li>)}</ul></div>}</div>
            </div>
            {topic.scenarios.length > 0 && <section className="mt-5 border-t pt-4"><h3 className="mb-3 text-sm font-bold">{copy.situations}</h3><div className="grid gap-3 lg:grid-cols-2">{topic.scenarios.map((scenario, scenarioIndex) => <div className="rounded-lg border bg-background p-4" key={`${scenarioIndex}-${scenario.title}`}><h4 className="font-semibold">{scenario.title}</h4><p className="mt-1 text-xs leading-5 text-muted-foreground"><strong>{copy.caseWhen}:</strong> {scenario.when}</p><ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-5">{scenario.steps.map((step, stepIndex) => <li key={`${stepIndex}-${step}`}>{step}</li>)}</ol>{scenario.expected && <p className="mt-2 text-xs leading-5"><strong>{copy.result}:</strong> {scenario.expected}</p>}{scenario.help && <p className="mt-2 rounded bg-amber-50 p-2 text-xs leading-5 text-amber-950"><strong>{copy.caseHelp}:</strong> {scenario.help}</p>}</div>)}</div></section>}
          </article></div>)}</div>}
          <footer className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-xs text-muted-foreground"><span>{isEnglish ? "LoyaltyOS Admin guide · Screenshots are captured from the actual application." : "Hướng dẫn LoyaltyOS Admin · Ảnh chụp được lấy từ giao diện thực tế của ứng dụng."}</span><Link className="no-print font-semibold text-primary" to="/">{copy.home}</Link></footer>
        </main>
      </div>
    </div>
  );
}
