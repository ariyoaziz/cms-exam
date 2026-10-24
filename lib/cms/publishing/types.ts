import type { Draft, PublishResult } from "../../../types/cms";
export interface PublishingService { publish(draft: Draft): Promise<PublishResult>; }
