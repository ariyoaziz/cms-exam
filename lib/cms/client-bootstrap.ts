import type { StoredCmsState } from "./storage";
import { readCmsState } from "./storage";
import { cloneDraft } from "./draft-state";
import { initialDraftForWebsite } from "./mock-data";
import { defaultWebsiteId } from "./website-registry";
import { readActiveWebsiteId } from "./website-storage";

export type CmsBootstrapState = { activeWebsiteId: string; cmsState: StoredCmsState };

/** Must be deterministic so the server render and first browser render match. */
export function createInitialCmsBootstrap(): CmsBootstrapState {
  const draft = initialDraftForWebsite(defaultWebsiteId);
  return {
    activeWebsiteId: defaultWebsiteId,
    cmsState: { version: 4, draft, baseline: cloneDraft(draft), published: null, savedAt: "" },
  };
}

/** Read browser persistence only after hydration has completed. */
export function restoreCmsBootstrap(): CmsBootstrapState {
  const activeWebsiteId = readActiveWebsiteId(defaultWebsiteId);
  return {
    activeWebsiteId,
    cmsState: readCmsState(initialDraftForWebsite(activeWebsiteId), activeWebsiteId),
  };
}
