import { initialDraft, website } from "../mock-data";
import type { ContentAdapter } from "./types";
import type { Draft, Website } from "../../../types/cms";
export const mockContentAdapter: ContentAdapter = { async getWebsite(): Promise<Website> { return website; }, async getDraft(): Promise<Draft> { return structuredClone(initialDraft); }, async saveDraft(): Promise<void> { return Promise.resolve(); } };
