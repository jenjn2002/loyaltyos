import { adminGuide, type AdminGuideTopic } from "./document-guide";
import { adminGuideEnglish } from "./document-guide.en";
import { customerGuide, customerGuideEnglish, customerGuideExpanded, type CustomerGuideTopic } from "@loyaltyos/documentation-content";
import type { GuideArticle, GuideLocaleContent } from "./document-types";
import { expandedAdminGuideArticles } from "./document-guide-expanded";

function adminArticle(topic: AdminGuideTopic, index: number): GuideArticle {
  const en = adminGuideEnglish[topic.id] ?? {
    title: topic.title, group: topic.group, purpose: topic.purpose, prerequisites: topic.prerequisites,
    steps: topic.steps, result: topic.result, notes: topic.notes,
  };
  const viContent: GuideLocaleContent = {
    title: topic.title, section: topic.group, route: topic.route, purpose: topic.purpose,
    prerequisites: topic.prerequisites, steps: topic.steps, result: topic.result,
    notes: topic.notes ?? [], scenarios: [], imageAlt: `Hướng dẫn ${topic.title}`,
  };
  const enContent: GuideLocaleContent = {
    title: en.title, section: en.group, route: topic.route, purpose: en.purpose,
    prerequisites: en.prerequisites, steps: en.steps, result: en.result,
    notes: en.notes ?? [], scenarios: [], imageAlt: `Guide: ${en.title}`,
  };
  return {
    id: `admin-${topic.id}`, audience: "ADMIN", slug: topic.id, status: "PUBLISHED", sortOrder: index * 10,
    imageKey: topic.image, imageData: null, content: { vi: viContent, en: enContent, screenshots: [] },
  };
}

function customerArticle(topic: CustomerGuideTopic, index: number): GuideArticle {
  const en = customerGuideEnglish[topic.id] ?? {
    title: topic.title, area: topic.area, purpose: topic.purpose, steps: topic.steps,
    result: topic.result, notes: topic.notes,
  };
  const viContent: GuideLocaleContent = {
    title: topic.title, section: topic.area, route: "/", purpose: topic.purpose,
    steps: topic.steps, result: topic.result, notes: topic.notes ?? [], scenarios: [],
    imageAlt: `Hướng dẫn ${topic.title}`,
  };
  const enContent: GuideLocaleContent = {
    title: en.title, section: en.area, route: "/", purpose: en.purpose,
    steps: en.steps, result: en.result, notes: en.notes ?? [], scenarios: [],
    imageAlt: `Guide: ${en.title}`,
  };
  return {
    id: `customer-${topic.id}`, audience: "CUSTOMER", slug: topic.id, status: "PUBLISHED", sortOrder: index * 10,
    imageKey: topic.image, imageData: null, content: { vi: viContent, en: enContent, screenshots: [] },
  };
}

export const builtInGuideArticles = [
  ...adminGuide.map(adminArticle),
  ...expandedAdminGuideArticles,
  ...customerGuide.map(customerArticle),
  ...customerGuideExpanded,
];
