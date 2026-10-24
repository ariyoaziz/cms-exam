import { z } from "zod";
export const stableIdSchema = z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/);
export const imageUrlSchema = z.string().url().or(z.string().startsWith("/"));
export const sectionContentSchema = z.object({ eyebrow: z.string(), title: z.string(), description: z.string(), primaryLabel: z.string(), secondaryLabel: z.string(), image: imageUrlSchema, imageAlt: z.string(), imageAssetId: z.string().optional(), linkType: z.enum(["section", "url", "whatsapp"]), linkTarget: z.string() });
