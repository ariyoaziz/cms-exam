import type { Draft, PublishResult, Website } from "../../../types/cms";
export interface ContentAdapter { getWebsite(): Promise<Website>; getDraft(): Promise<Draft>; saveDraft(draft: Draft): Promise<void>; }
export type RepositoryMapping = { repository: string; branch: string; contentDirectory: string };
export interface FutureGitHubAdapter extends ContentAdapter { readRepositoryContent(mapping: RepositoryMapping): Promise<unknown>; updateApprovedContent(mapping: RepositoryMapping, draft: Draft): Promise<{ commitId: string }>; }
export interface FuturePublisher { publish(draft: Draft): Promise<PublishResult>; }
