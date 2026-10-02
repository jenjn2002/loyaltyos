// The portal owns the canonical customer guide content. Expose it as a
// workspace package so the admin editor can migrate the same bilingual seed
// articles without maintaining a second copy.
export { customerGuide } from "../../../apps/portal/src/content/document-guide";
export type { CustomerGuideTopic } from "../../../apps/portal/src/content/document-guide";
export { customerGuideEnglish } from "../../../apps/portal/src/content/document-guide.en";
export { customerGuideExpanded } from "../../../apps/portal/src/content/document-guide-expanded";
