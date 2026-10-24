import type { Draft, PublishResult } from "../../../types/cms";
import type { PublishingService } from "./types";
export const mockPublisher: PublishingService = { async publish(draft: Draft): Promise<PublishResult> { void draft; return { ok: true, status: "simulated", message: "Website berhasil dipublish dalam mode simulasi.", publishedAt: new Date().toISOString(), deploymentId: `demo-${Math.random().toString(36).slice(2, 9)}` }; } };
