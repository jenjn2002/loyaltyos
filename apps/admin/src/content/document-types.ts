export interface GuideScenario {
  title: string;
  when: string;
  steps: string[];
  expected: string;
  help?: string;
}

export interface GuideLocaleContent {
  title: string;
  section: string;
  route: string;
  purpose: string;
  prerequisites?: string;
  steps: string[];
  result: string;
  notes: string[];
  scenarios: GuideScenario[];
  imageAlt?: string;
}

export interface GuideScreenshot {
  step: number;
  imageData: string;
  caption: { vi: string; en: string };
}

export interface GuideArticleContent {
  vi: GuideLocaleContent;
  en: GuideLocaleContent;
  screenshots?: GuideScreenshot[];
}

export interface GuideArticle {
  id: string;
  audience: "CUSTOMER" | "ADMIN";
  slug: string;
  status: "DRAFT" | "PUBLISHED";
  sortOrder: number;
  imageKey: string | null;
  imageData: string | null;
  content: GuideArticleContent;
  createdAt?: string;
  updatedAt?: string;
}
