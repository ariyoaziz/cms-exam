import type { ContentField, SectionType, WebsiteConfiguration } from "../../../types/cms";
const text = (key: string, label: string, maxLength: number, required = true): ContentField => ({ key, label, type: "text", defaultValue: "", required, editable: true, validation: { maxLength } });
const textarea = (key: string, label: string, maxLength: number): ContentField => ({ key, label, type: "textarea", defaultValue: "", required: true, editable: true, validation: { maxLength } });
export const sectionFieldDefinitions: Record<SectionType, ContentField[]> = {
  hero: [text("eyebrow", "Label Kecil", 50), text("title", "Judul Utama", 100), textarea("description", "Deskripsi", 200), { key: "image", label: "Banner image", type: "image", defaultValue: "", required: true, editable: true }, text("primaryLabel", "Tombol Utama", 30), text("secondaryLabel", "Tombol Kedua", 30, false), { key: "linkTarget", label: "Tujuan link", type: "url", defaultValue: "", required: false, editable: true }],
  menu: [text("title", "Judul", 100), textarea("description", "Deskripsi", 200)],
  about: [text("title", "Judul", 100), textarea("description", "Deskripsi", 200), { key: "image", label: "Gambar", type: "image", defaultValue: "", required: false, editable: true }],
  gallery: [text("title", "Judul", 100), textarea("description", "Deskripsi", 200)],
  testimonial: [text("title", "Judul", 100), textarea("description", "Deskripsi", 200)],
  articles: [text("title", "Judul", 100), textarea("description", "Deskripsi", 200)],
  cta: [text("title", "Judul", 100), textarea("description", "Deskripsi", 200)],
  basic: [text("title", "Judul", 100), textarea("description", "Deskripsi", 200)],
};
export const dapurKitaConfiguration: WebsiteConfiguration = { allowSectionVisibility: true, allowSectionOrdering: true, allowedSectionTypes: ["hero", "menu", "about", "gallery", "testimonial", "articles", "cta"], contentDirectory: "content/", editableFields: sectionFieldDefinitions };
