import { ArrowRight, BookOpen, CheckCircle2, ChevronDown, Download, Search, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { customerGuide } from "../content/document-guide";
import { customerGuideEnglish } from "../content/document-guide.en";
import { customerGuideExpanded } from "../content/document-guide-expanded";
import { configuredProgramId } from "../lib/api-client";

interface GuideScenario {
  title: string;
  when: string;
  steps: string[];
  expected: string;
  help?: string;
}

interface GuideLocale {
  title: string;
  section: string;
  route?: string;
  purpose: string;
  prerequisites?: string;
  steps: string[];
  result: string;
  notes?: string[];
  scenarios?: GuideScenario[];
  imageAlt?: string;
}

interface GuideScreenshot { step: number; imageData: string; caption: { vi: string; en: string } }

interface GuideArticle {
  id: string;
  audience: "CUSTOMER" | "ADMIN";
  slug: string;
  status: "DRAFT" | "PUBLISHED";
  imageKey: string | null;
  imageData: string | null;
  content: { vi: GuideLocale; en: GuideLocale; screenshots?: GuideScreenshot[] };
}
interface PublicDocumentationResponse { articles: GuideArticle[]; configured: boolean }

interface CustomerTopic extends GuideLocale {
  id: string;
  slug: string;
  image: string;
  imageData: string | null;
  screenshots?: GuideScreenshot[];
  searchText?: string[];
}

function isGeneratedPlaceholderScenario(scenario: GuideScenario): boolean {
  return /^(?:luồng sử dụng thông thường|typical workflow|normal workflow|không thấy thao tác hoặc thao tác đang bị khóa|when an action is missing or blocked|tình huống cần lưu ý\s*\d*|important case\s*\d*|use case\s*\d*)$/i.test(scenario.title.trim());
}
function guideLocaleSearchText(locale: { title: string; section?: string; area?: string; route?: string; purpose?: string; prerequisites?: string; result?: string; steps?: string[]; notes?: string[]; scenarios?: GuideScenario[] }): string[] {
  return [locale.title, locale.section ?? locale.area ?? "", locale.route ?? "", locale.purpose ?? "", locale.prerequisites ?? "", locale.result ?? "", ...(locale.steps ?? []), ...(locale.notes ?? []), ...(locale.scenarios ?? []).flatMap((scenario) => [scenario.title, scenario.when, scenario.expected, scenario.help ?? "", ...scenario.steps])];
}

const guideSearchStopWords = new Set(["a", "an", "and", "are", "as", "at", "by", "for", "from", "how", "in", "is", "it", "of", "on", "or", "the", "to", "with", "cac", "cach", "cho", "cua", "de", "la", "lam", "mot", "nhung", "phan", "theo", "va", "voi"]);

function normalizeGuideSearchText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function searchGuideTopics<T extends CustomerTopic>(topics: T[], query: string): T[] {
  const normalizedQuery = normalizeGuideSearchText(query);
  if (!normalizedQuery) return [...topics];
  const terms = [...new Set(normalizedQuery.split(/\s+/).filter((term) => term && !guideSearchStopWords.has(term)))];
  if (!terms.length) return [...topics];
  const ranked = topics.flatMap((topic, index) => {
    const fields: Array<{ text: string; weight: number }> = [
      { text: topic.title, weight: 100 }, { text: topic.section, weight: 65 }, { text: topic.route ?? "", weight: 55 },
      { text: topic.purpose, weight: 35 }, { text: topic.prerequisites ?? "", weight: 22 }, { text: topic.result, weight: 22 },
      ...(topic.steps ?? []).map((text) => ({ text, weight: 24 })), ...(topic.notes ?? []).map((text) => ({ text, weight: 12 })),
      ...(topic.scenarios ?? []).flatMap((scenario) => [{ text: scenario.title, weight: 28 }, { text: scenario.when, weight: 16 }, { text: scenario.expected, weight: 14 }, { text: scenario.help ?? "", weight: 10 }, ...scenario.steps.map((text) => ({ text, weight: 16 }))]),
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
  if (slug === "home-balance" || slug === "claim-points" || slug === "checkin" || slug === "transactions" || slug.startsWith("how-point-") || slug.startsWith("how-tier-") || slug.startsWith("how-campaign-claim") || slug.startsWith("how-daily-check-in") || slug.startsWith("how-transaction-")) return section("Điểm và hoạt động", "Points & activity");
  if (slug === "credits" || slug.startsWith("how-give-recognition") || slug.startsWith("how-submit-exchange") || slug.startsWith("how-track-exchange") || slug.startsWith("how-recognition-feed")) return section("Credits, recognition và exchange", "Credits, recognition & exchange");
  if (slug === "notifications" || slug.startsWith("how-notification-")) return section("Thông báo", "Notifications");
  if (slug === "projects" || slug.startsWith("how-project-")) return section("Projects", "Projects");
  if (slug === "rewards" || slug.startsWith("how-browse-rewards") || slug.startsWith("how-redeem-reward") || slug.startsWith("how-rewarded-")) return section("Rewards", "Rewards");
  if (slug === "badges" || slug.startsWith("how-badges-")) return section("Thành tích", "Achievements");
  if (slug === "profile" || slug.startsWith("how-member-login") || slug.startsWith("how-edit-profile") || slug.startsWith("how-personal-settings") || slug.startsWith("how-export-member-")) return section("Hồ sơ và tài khoản", "Profile & account");
  return fallback;
}

function fallbackTopics(isEnglish: boolean): CustomerTopic[] {
  const overviewTopics = customerGuide.map((base) => {
    const localized = { ...base, ...(isEnglish ? (customerGuideEnglish[base.id] ?? {}) : {}) };
    return {
      ...localized,
      section: documentationSection(base.id, isEnglish, localized.area),
      id: base.id,
      slug: base.id,
      image: base.image,
      imageData: null,
      searchText: guideLocaleSearchText(isEnglish ? base : (customerGuideEnglish[base.id] ?? base)),
      scenarios: [],
    };
  });
  const detailedTopics = customerGuideExpanded.map((article) => {
    const localized = isEnglish ? article.content.en : article.content.vi;
    const fallback = isEnglish ? article.content.vi : article.content.en;
    return {
      ...fallback,
      ...localized,
      section: documentationSection(article.slug, isEnglish, localized.section),
      id: article.slug,
      slug: article.slug,
      image: article.imageKey ?? "home",
      imageData: article.imageData,
      searchText: guideLocaleSearchText(fallback),
      scenarios: localized.scenarios,
    };
  });
  return [...overviewTopics, ...detailedTopics];
}

function uploadedImage(topic: CustomerTopic, isEnglish: boolean): JSX.Element {
  if (!topic.imageData) return <figure className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-[var(--color-border)] p-5 text-center text-sm text-[var(--color-text-secondary)]">{isEnglish ? "No actual feature screenshot is available yet." : "Chưa có ảnh chụp màn hình thật cho tính năng này."}</figure>;
  return <figure className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"><img src={topic.imageData} alt={topic.imageAlt || topic.title} className="max-h-[480px] w-full object-contain" /><figcaption className="border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-secondary)]">{topic.imageAlt || topic.title}</figcaption></figure>;
}

function screenshotGallery(screenshots: GuideScreenshot[] | undefined, isEnglish: boolean): JSX.Element | null {
  if (!screenshots?.length) return null;
  return <section className="space-y-2">
    <h3 className="text-sm font-semibold">{isEnglish ? "Screenshots for each step" : "Ảnh chụp theo từng bước"}</h3>
    <div className="grid gap-3 sm:grid-cols-2">
      {[...screenshots].sort((left, right) => left.step - right.step).map((screenshot, index) => <figure className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]" key={`${screenshot.step}-${index}`}>
        <img loading="lazy" src={screenshot.imageData} alt={isEnglish ? screenshot.caption.en : screenshot.caption.vi} className="max-h-[360px] w-full object-contain" />
        <figcaption className="border-t border-[var(--color-border)] px-3 py-2 text-xs leading-5 text-[var(--color-text-secondary)]"><strong className="mr-1 text-[var(--color-text)]">{isEnglish ? `Step ${screenshot.step}` : `Bước ${screenshot.step}`}.</strong>{isEnglish ? screenshot.caption.en : screenshot.caption.vi}</figcaption>
      </figure>)}
    </div>
  </section>;
}

export default function CustomerDocumentPage(): JSX.Element {
  const { i18n } = useTranslation();
  const isEnglish = i18n.resolvedLanguage?.startsWith("en") ?? i18n.language.startsWith("en");
  const [query, setQuery] = useState("");
  const [contentsOpen, setContentsOpen] = useState(false);
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [documentation, setDocumentation] = useState<PublicDocumentationResponse | null>(null);
  useEffect(() => {
    let active = true;
    const programId = configuredProgramId();
    void fetch(`/api/v1/public/documentation?programId=${encodeURIComponent(programId)}`, { headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Documentation is unavailable");
        return (await response.json()) as { data?: PublicDocumentationResponse };
      })
      .then((body) => { if (active) setDocumentation(body.data ?? { articles: [], configured: false }); })
      .catch(() => { if (active) setDocumentation({ articles: [], configured: false }); });
    return () => { active = false; };
  }, []);

  const copy = isEnglish
    ? {
        eyebrow: "MEMBER GUIDE", title: "How to use LoyaltyOS", intro: "Learn each feature's purpose, normal workflow, common use cases, and what to check if something does not work.", searchLabel: "Search the guide", searchPlaceholder: "Search: claim points, transactions, projects...", contents: "Contents", navLabel: "Guide contents", profile: "Open profile", illustrationNotice: "Illustrations use sample data. Balances, limits, and available actions depend on your program settings.", empty: "No matching topics. Try a different search term.", purpose: "What is this feature for?", steps: "Main workflow", result: "Expected result", notes: "Important notes", situations: "Use cases and troubleshooting", caseWhen: "Use this path when", caseHelp: "If it still does not work", footer: "LoyaltyOS member guide · Illustrations use sample data.", home: "Back to Home", exportPdf: "Export PDF", pdfHint: "In the print dialog, choose Save as PDF.",
      }
    : {
        eyebrow: "CẨM NANG THÀNH VIÊN", title: "Hướng dẫn sử dụng LoyaltyOS", intro: "Tra cứu mục đích, luồng thông thường, tình huống sử dụng và cách xử lý khi thao tác không như mong đợi.", searchLabel: "Tìm trong hướng dẫn", searchPlaceholder: "Tìm: claim điểm, giao dịch, dự án...", contents: "Mục lục", navLabel: "Mục lục hướng dẫn", profile: "Mở hồ sơ", illustrationNotice: "Hình minh họa dùng dữ liệu giả. Số dư, giới hạn và thao tác khả dụng phụ thuộc cấu hình chương trình.", empty: "Không tìm thấy nội dung phù hợp. Thử từ khóa khác nhé.", purpose: "Tính năng này để làm gì?", steps: "Luồng chính", result: "Kết quả mong đợi", notes: "Lưu ý", situations: "Tình huống sử dụng và xử lý", caseWhen: "Dùng luồng này khi", caseHelp: "Nếu vẫn chưa xử lý được", footer: "Tài liệu dành cho thành viên LoyaltyOS · Hình minh họa dùng dữ liệu mẫu.", home: "Về Trang chủ", exportPdf: "Xuất PDF", pdfHint: "Trong hộp thoại in, chọn Lưu thành PDF.",
      };

  const localizedTopics = useMemo(() => {
    const published = documentation?.articles.filter((article) => article.audience === "CUSTOMER" && article.status === "PUBLISHED") ?? [];
    if (!documentation?.configured) return fallbackTopics(isEnglish);
    return published.map((article) => {
      const locale = isEnglish ? article.content.en : article.content.vi;
      const fallback = isEnglish ? article.content.vi : article.content.en;
      return {
        ...fallback,
        ...locale,
        section: documentationSection(article.slug, isEnglish, locale.section),
        scenarios: (locale.scenarios ?? fallback.scenarios ?? []).filter((scenario) => !isGeneratedPlaceholderScenario(scenario)),
        id: article.slug,
        slug: article.slug,
        image: article.imageKey ?? "home",
        imageData: article.imageData,
        searchText: guideLocaleSearchText(fallback),
        screenshots: article.content.screenshots ?? [],
      };
    });
  }, [documentation, isEnglish]);

  const filteredTopics = useMemo(() => {
    return searchGuideTopics(localizedTopics, query);
  }, [localizedTopics, query]);
  const areas = [...new Set(filteredTopics.map((topic) => topic.section))];
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
    if (!activeTopicId || window.matchMedia("(max-width: 1023px)").matches) return;
    document.getElementById(`guide-nav-${activeTopicId}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTopicId]);

  return (
    <div className="documentation-print-area mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="overflow-hidden rounded-3xl bg-slate-950 px-5 py-7 text-white sm:px-9 sm:py-10">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 text-sm font-medium text-violet-200"><BookOpen className="h-4 w-4" /> {copy.eyebrow}</div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{copy.title}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">{copy.intro}</p>
          <label className="no-print mt-6 flex max-w-xl items-center gap-3 rounded-xl border border-white/15 bg-white/10 px-4 py-3 focus-within:ring-2 focus-within:ring-violet-300">
            <Search className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" /><span className="sr-only">{copy.searchLabel}</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchPlaceholder} className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-400" />
          </label>
        </div>
        <div className="no-print mt-5 flex flex-wrap items-center gap-3"><button type="button" className="inline-flex h-9 items-center rounded-md bg-white px-3 text-sm font-medium text-slate-900 hover:bg-slate-100" onClick={() => window.print()}><Download className="mr-1.5 h-4 w-4" />{copy.exportPdf}</button><span className="text-xs text-slate-300">{copy.pdfHint}</span></div>
      </header>

      <div className="mt-7 grid gap-7 lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="no-print h-fit rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-4 lg:sticky lg:top-5 lg:max-h-[calc(100vh-2.5rem)] lg:overflow-y-auto">
          <button type="button" aria-expanded={contentsOpen} aria-controls="guide-contents" className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm font-semibold lg:hidden" onClick={() => setContentsOpen((open) => !open)}>
            <span>{copy.contents}<span className="mt-1 block text-xs font-normal text-[var(--color-text-secondary)]">{filteredTopics.find((topic) => topic.id === activeTopicId)?.title}</span></span>
            <ChevronDown aria-hidden="true" className={"h-5 w-5 shrink-0 transition-transform " + (contentsOpen ? "rotate-180" : "")} />
          </button>
          <p className="hidden text-xs font-bold uppercase tracking-wide text-[var(--color-text-secondary)] lg:block">{copy.contents}</p>
          <div id="guide-contents" className={(contentsOpen ? "block " : "hidden ") + "lg:block"}>
          <nav className="mt-3 space-y-4" aria-label={copy.navLabel}>{areas.map((area) => <div key={area}><p className="mb-1.5 text-xs font-semibold text-[var(--color-text)]">{area}</p><ul className="space-y-1 border-l border-[var(--color-border)] pl-3">{filteredTopics.filter((topic) => topic.section === area).map((topic) => {
            const isActive = activeTopicId === topic.id;
            return <li key={topic.id}><a id={`guide-nav-${topic.id}`} aria-current={isActive ? "location" : undefined} className={`block rounded-md px-2 py-1 text-xs leading-5 transition-colors ${isActive ? "bg-[var(--color-primary)] text-white font-semibold" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)] hover:text-[var(--color-primary)]"}`} href={`#${topic.id}`}>{topic.title}</a></li>;
          })}</ul></div>)}</nav>
          </div>
          <div className="mt-5 border-t border-[var(--color-border)] pt-4"><Link to="/profile" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-primary)]">{copy.profile}<ArrowRight className="h-3 w-3" /></Link></div>
        </aside>
        <main className="min-w-0">
          <div className="no-print mb-5 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"><ShieldCheck className="h-4 w-4 shrink-0" />{isEnglish ? "Screenshots are captured from the actual application; available actions and displayed data vary by program settings." : "Ảnh chụp được lấy từ ứng dụng thực tế; thao tác và dữ liệu hiển thị tùy theo cấu hình chương trình."}</div>
          {filteredTopics.length === 0 ? <div className="rounded-2xl border border-dashed border-[var(--color-border)] px-6 py-12 text-center text-sm text-[var(--color-text-secondary)]">{copy.empty}</div> : <div className="space-y-5">{filteredTopics.map((topic, index) => <div key={topic.id}>{(index === 0 || filteredTopics[index - 1]?.section !== topic.section) && <h2 className="border-b border-[var(--color-border)] pb-2 pt-3 text-lg font-bold tracking-tight">{topic.section}</h2>}<article id={topic.id} className={`scroll-mt-5 rounded-2xl border p-4 shadow-sm transition-colors sm:p-6 ${activeTopicId === topic.id ? "border-2 border-[var(--color-primary)] bg-[var(--color-surface)]" : "border-[var(--color-border)] bg-[var(--color-surface-secondary)]"}`}>
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.82fr)] xl:items-start">
              <div><div className="flex items-center gap-2"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--color-primary)] text-xs font-bold text-white">{index + 1}</span><span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">{topic.section}</span></div>
                <h2 className="mt-3 text-xl font-bold tracking-tight">{topic.title}</h2><div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"><h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-secondary)]">{copy.purpose}</h3><p className="mt-1.5 text-sm leading-6">{topic.purpose}</p></div>
                {topic.prerequisites && <p className="mt-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-950"><strong>{isEnglish ? "Before you start:" : "Trước khi bắt đầu:"}</strong> {topic.prerequisites}</p>}
                <div className="mt-4"><h3 className="text-sm font-semibold">{copy.steps}</h3><ol className="mt-2 space-y-2.5">{topic.steps.map((step, stepIndex) => <li key={`${stepIndex}-${step}`} className="flex gap-2.5 text-sm leading-6 text-[var(--color-text-secondary)]"><span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--color-border)] text-[10px] font-bold text-[var(--color-text)]">{stepIndex + 1}</span><span>{step}</span></li>)}</ol></div>
              </div>
              <div className="space-y-3">{uploadedImage(topic, isEnglish)}{screenshotGallery(topic.screenshots, isEnglish)}<div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="h-4 w-4 text-emerald-600" />{copy.result}</h3><p className="mt-1.5 text-sm leading-6 text-[var(--color-text-secondary)]">{topic.result}</p></div>{(topic.notes?.length ?? 0) > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><h3 className="text-xs font-bold uppercase tracking-wide">{copy.notes}</h3><ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5">{topic.notes?.map((note) => <li key={note}>{note}</li>)}</ul></div>}</div>
            </div>
            {(topic.scenarios?.length ?? 0) > 0 && <section className="mt-5 border-t border-[var(--color-border)] pt-4"><h3 className="mb-3 text-sm font-bold">{copy.situations}</h3><div className="grid gap-3 lg:grid-cols-2">{topic.scenarios?.map((scenario, scenarioIndex) => <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4" key={`${scenarioIndex}-${scenario.title}`}><h4 className="font-semibold">{scenario.title}</h4><p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]"><strong>{copy.caseWhen}:</strong> {scenario.when}</p><ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-5">{scenario.steps.map((step, stepIndex) => <li key={`${stepIndex}-${step}`}>{step}</li>)}</ol>{scenario.expected && <p className="mt-2 text-xs leading-5"><strong>{copy.result}:</strong> {scenario.expected}</p>}{scenario.help && <p className="mt-2 rounded bg-amber-50 p-2 text-xs leading-5 text-amber-950"><strong>{copy.caseHelp}:</strong> {scenario.help}</p>}</div>)}</div></section>}
          </article></div>)}</div>}
          <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-5 text-xs text-[var(--color-text-secondary)]"><span>{isEnglish ? "LoyaltyOS member guide · Screenshots are captured from the actual application." : "Hướng dẫn dành cho thành viên LoyaltyOS · Ảnh chụp được lấy từ giao diện thực tế của ứng dụng."}</span><Link className="no-print font-semibold text-[var(--color-primary)]" to="/">{copy.home}</Link></footer>
        </main>
      </div>
    </div>
  );
}
