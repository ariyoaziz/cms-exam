import type { Website, WebsiteConfiguration } from "../../types/cms";
import { sectionFieldDefinitions } from "./schemas/sections";

const now = "2026-10-24T00:00:00.000Z";
const config = (allowedSectionTypes: Website["configuration"]["allowedSectionTypes"], contentDirectory: string, editableFields: Partial<WebsiteConfiguration["editableFields"]> = sectionFieldDefinitions): WebsiteConfiguration => ({ allowSectionVisibility: true, allowSectionOrdering: true, allowedSectionTypes, contentDirectory, editableFields });

export const websiteRegistry: Website[] = [
  { id: "site-dapur-kita", websiteId: "site-dapur-kita", name: "Dapur Kita", slug: "dapur-kita", domain: "dapurkita.demo", description: "Demo restoran dengan menu dan cerita kuliner.", status: "active", createdAt: now, updatedAt: now, repository: "demo/dapur-kita", branch: "main", logo: "DK", accent: "#BAF300", deploymentTarget: "Simulated Cloudflare project", configuration: config(["hero", "menu", "about", "gallery", "testimonial", "articles", "cta"], "content/dapur-kita/") },
  { id: "site-studio-karsa", websiteId: "site-studio-karsa", name: "Studio Karsa", slug: "studio-karsa", domain: "studiokarsa.demo", description: "Demo creative studio untuk portofolio dan layanan.", status: "active", createdAt: now, updatedAt: now, repository: "demo/studio-karsa", branch: "main", logo: "SK", accent: "#BAF300", deploymentTarget: "Simulated Cloudflare project", configuration: config(["hero", "gallery", "about", "articles", "cta"], "content/studio-karsa/", { hero: sectionFieldDefinitions.hero, gallery: sectionFieldDefinitions.gallery, about: sectionFieldDefinitions.about, articles: sectionFieldDefinitions.articles, cta: sectionFieldDefinitions.cta }) },
  { id: "site-ruang-sehat", websiteId: "site-ruang-sehat", name: "Ruang Sehat", slug: "ruang-sehat", domain: "ruangsehat.demo", description: "Demo klinik informasi dengan layanan dan kontak.", status: "active", createdAt: now, updatedAt: now, repository: "demo/ruang-sehat", branch: "main", logo: "RS", accent: "#BAF300", deploymentTarget: "Simulated Cloudflare project", configuration: config(["hero", "about", "articles", "cta"], "content/ruang-sehat/", { hero: sectionFieldDefinitions.hero, about: sectionFieldDefinitions.about, articles: sectionFieldDefinitions.articles, cta: sectionFieldDefinitions.cta }) },
];
export const getWebsite = (websiteId: string) => websiteRegistry.find((website) => website.websiteId === websiteId);
export const defaultWebsiteId = websiteRegistry[0].websiteId;
