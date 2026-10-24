import type { ContentAdapter } from "./adapters/types";
import { validateDraft } from "./validation";
import type { Draft, SectionType, Website, WebsitePage, WebsiteSection } from "../../types/cms";
export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: string };
export class ContentService {
  constructor(private readonly adapter: ContentAdapter) {}
  getWebsite(): Promise<Website> { return this.adapter.getWebsite(); }
  getDraft(): Promise<Draft> { return this.adapter.getDraft(); }
  async getPage(pageId: string): Promise<ServiceResult<WebsitePage>> { const draft = await this.adapter.getDraft(); const page = draft.pages.find((item) => item.id === pageId); return page ? { ok: true, value: page } : { ok: false, error: `Page ${pageId} tidak ditemukan.` }; }
  async getSections(pageId: string): Promise<ServiceResult<WebsiteSection[]>> { const draft = await this.adapter.getDraft(); const page = draft.pages.find((item) => item.id === pageId); if (!page) return { ok: false, error: `Page ${pageId} tidak ditemukan.` }; return { ok: true, value: page.sectionIds.map((id) => draft.sections.find((section) => section.id === id)).filter((section): section is WebsiteSection => Boolean(section)) }; }
  async updateSectionField(draft: Draft, sectionId: string, fieldKey: string, value: string): Promise<ServiceResult<Draft>> { const section = draft.sections.find((item) => item.id === sectionId); if (!section) return { ok: false, error: "Section tidak ditemukan." }; const field = (draft.website.configuration.editableFields[section.type] ?? []).find((item) => item.key === fieldKey); if (!field || !field.editable) return { ok: false, error: `Field ${fieldKey} tidak dapat diedit.` }; if (field.validation?.maxLength && value.length > field.validation.maxLength) return { ok: false, error: `${field.label} melebihi batas karakter.` }; const next: Draft = { ...draft, sections: draft.sections.map((item) => item.id === sectionId ? { ...item, content: { ...item.content, [fieldKey]: value } } : item) }; return { ok: true, value: next };
  }
  async saveDraft(draft: Draft): Promise<ServiceResult<Draft>> { const validation = validateDraft(draft); if (!validation.ok) return { ok: false, error: validation.errors[0] }; await this.adapter.saveDraft(draft); return { ok: true, value: draft }; }
  isAllowedSectionType(draft: Draft, type: SectionType): boolean { return draft.website.configuration.allowedSectionTypes.includes(type); }
}
