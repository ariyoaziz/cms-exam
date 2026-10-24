import type { Article, Draft, Product, WebsitePage, WebsiteSection } from "../../../types/cms";
import { z } from "zod";
import { getWebsite } from "../website-registry";
import { validateDraft } from "../validation";

export const githubWebsiteId = "site-dapur-kita";
export const githubContentPath = "content/dapur-kita/content.v1.json";

export type ContentExport = {
  schemaVersion: 1;
  website: { websiteId: string; slug: string; name: string; domain: string };
  pages: WebsitePage[];
  sections: WebsiteSection[];
  products: Product[];
  articles: Article[];
};

export class ContentExportError extends Error {}

const pageSchema = z.object({ id: z.string().min(1), name: z.string(), slug: z.string(), sectionIds: z.array(z.string().min(1)) });
const productSchema = z.object({ id: z.string().min(1), name: z.string(), description: z.string(), price: z.string(), image: z.string(), imageAlt: z.string() });
const articleSchema = z.object({ id: z.string().min(1), title: z.string(), excerpt: z.string(), content: z.string(), coverImage: z.string(), status: z.enum(["draft", "published"]), publishedAt: z.string().optional() });
const sectionSchema = z.object({ id: z.string().min(1), type: z.enum(["hero", "menu", "about", "gallery", "testimonial", "articles", "cta", "basic"]), label: z.string(), visible: z.boolean(), content: z.object({ eyebrow: z.string(), title: z.string(), description: z.string(), primaryLabel: z.string(), secondaryLabel: z.string(), image: z.string().url(), imageAlt: z.string(), linkType: z.enum(["section", "url", "whatsapp"]), linkTarget: z.string() }) });
const contentExportSchema = z.object({ schemaVersion: z.literal(1), website: z.object({ websiteId: z.string(), slug: z.string(), name: z.string(), domain: z.string() }), pages: z.array(pageSchema), sections: z.array(sectionSchema), products: z.array(productSchema), articles: z.array(articleSchema) });

const isStableImageUrl = (value: string) => /^https:\/\//i.test(value) && !/[\r\n]/.test(value);

function cloneExport<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sanitizeSections(draft: Draft): WebsiteSection[] {
  return draft.sections.map((section) => {
    if (!draft.website.configuration.allowedSectionTypes.includes(section.type)) {
      throw new ContentExportError(`Section ${section.id} tidak diizinkan oleh schema website.`);
    }
    if (!isStableImageUrl(section.content.image)) {
      throw new ContentExportError(`Gambar section ${section.label} belum memiliki URL produksi yang stabil.`);
    }
    const content = { ...section.content };
    delete content.imageAssetId;
    return { ...section, content };
  });
}

export function exportWebsiteContent(draft: Draft): ContentExport {
  const configured = getWebsite(githubWebsiteId);
  if (!configured || draft.website.websiteId !== githubWebsiteId) {
    throw new ContentExportError("Website ini belum diaktifkan untuk GitHub publishing.");
  }
  const validation = validateDraft({ ...draft, website: configured });
  if (!validation.ok) throw new ContentExportError(validation.errors.join(" "));

  const exported = {
    schemaVersion: 1 as const,
    website: { websiteId: configured.websiteId, slug: configured.slug, name: configured.name, domain: configured.domain },
    pages: draft.pages,
    sections: sanitizeSections(draft),
    products: draft.products,
    articles: draft.articles,
  } satisfies ContentExport;
  const parsed = contentExportSchema.safeParse(exported);
  if (!parsed.success) throw new ContentExportError("Struktur content export tidak valid.");
  return cloneExport(parsed.data) as ContentExport;
}

export function serializeWebsiteContent(draft: Draft): string {
  return `${JSON.stringify(exportWebsiteContent(draft), null, 2)}\n`;
}
