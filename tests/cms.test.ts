import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { cloneDraft, dirtyFields } from "../lib/cms/draft-state";
import { initialDraftForWebsite } from "../lib/cms/mock-data";
import { maxImageBytes, processImageUpload, validateImageUpload } from "../lib/cms/media";
import { localDevelopmentAssetStorage } from "../lib/cms/media-storage";
import { readCmsState, writeCmsState } from "../lib/cms/storage";
import type { StoredCmsState } from "../lib/cms/storage";
import { POST as uploadMedia } from "../app/api/media/route";
import { DELETE as deleteMedia } from "../app/api/media/[id]/route";
import { defaultWebsiteId, getWebsite, websiteRegistry } from "../lib/cms/website-registry";
import { readActiveWebsiteId } from "../lib/cms/website-storage";
import type { MediaAsset } from "../types/cms";
import { exportWebsiteContent, serializeWebsiteContent } from "../lib/cms/publishing/content-export";
import { POST as publishContent } from "../app/api/publish/route";
import { publishToGitHub } from "../lib/cms/publishing/github-publisher";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
const installBrowser = () => { const localStorage = new MemoryStorage(); vi.stubGlobal("window", { localStorage }); return localStorage; };
const makeState = (websiteId: string): StoredCmsState => { const draft = initialDraftForWebsite(websiteId); return { version: 4, draft, baseline: cloneDraft(draft), published: null, savedAt: "" }; };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("website registry and namespaced persistence", () => {
  it("contains distinct valid demo websites", () => { expect(websiteRegistry).toHaveLength(3); expect(new Set(websiteRegistry.map((site) => site.websiteId)).size).toBe(3); expect(getWebsite("unknown-site")).toBeUndefined(); });
  it("keeps drafts, baselines, and snapshots isolated per website", () => { installBrowser(); const studio = makeState("site-studio-karsa"); studio.draft.pages[0].name = "Studio Draft"; studio.baseline.pages[0].name = "Studio Draft"; studio.published = { id: "studio-s1", version: 1, draft: cloneDraft(studio.draft), publishedAt: "2026-10-25T00:00:00.000Z", source: "dummy" }; expect(writeCmsState(studio)).toBe(true); const clinic = makeState("site-ruang-sehat"); expect(writeCmsState(clinic)).toBe(true); const restoredStudio = readCmsState(initialDraftForWebsite("site-studio-karsa"), "site-studio-karsa"); const restoredClinic = readCmsState(initialDraftForWebsite("site-ruang-sehat"), "site-ruang-sehat"); expect(restoredStudio.draft.pages[0].name).toBe("Studio Draft"); expect(restoredStudio.published?.version).toBe(1); expect(restoredClinic.draft.pages[0].name).not.toBe("Studio Draft"); restoredStudio.draft.pages[0].name = "Changed After Publish"; expect(restoredStudio.published?.draft.pages[0].name).toBe("Studio Draft"); });
  it("migrates legacy single-site data without deleting the source", () => { const storage = installBrowser(); const draft = initialDraftForWebsite(defaultWebsiteId); storage.setItem("ber-workshed-cms-state", JSON.stringify({ version: 3, draft, published: null, savedAt: "legacy" })); const restored = readCmsState(draft, defaultWebsiteId); expect(restored.draft.website.websiteId).toBe(defaultWebsiteId); expect(storage.getItem("ber-workshed-cms-state")).not.toBeNull(); expect(storage.getItem("ber-workshed-cms-state-v5-site-dapur-kita")).not.toBeNull(); });
  it("recovers safely from malformed and unsupported data", () => { const storage = installBrowser(); const fallback = initialDraftForWebsite(defaultWebsiteId); storage.setItem("ber-workshed-cms-state-v5-site-dapur-kita", "not-json"); expect(readCmsState(fallback, defaultWebsiteId).storageError).toContain("could not be read"); storage.setItem("ber-workshed-cms-state-v5-site-dapur-kita", JSON.stringify({ version: 99 })); expect(readCmsState(fallback, defaultWebsiteId).storageError).toContain("not recognized"); });
  it("falls back from an unknown active website id", () => { const storage = installBrowser(); storage.setItem("ber-workshed-active-website-v1", "unknown-site"); expect(readActiveWebsiteId(defaultWebsiteId)).toBe(defaultWebsiteId); });
  it("reports persistence failure without changing the in-memory draft", () => { const draft = initialDraftForWebsite(defaultWebsiteId); draft.pages[0].name = "Keep in memory"; vi.stubGlobal("window", { localStorage: { setItem: () => { throw new Error("quota"); } } }); expect(writeCmsState(makeState(defaultWebsiteId))).toBe(false); expect(draft.pages[0].name).toBe("Keep in memory"); });
});

describe("draft and publish invariants", () => {
  it("derives dirty fields from actual differences and clears reverted fields", () => { const draft = initialDraftForWebsite(defaultWebsiteId); const baseline = cloneDraft(draft); draft.pages[0].name = "Changed"; expect(dirtyFields(baseline, draft)).toContain("pages[0].name"); draft.pages[0].name = baseline.pages[0].name; expect(dirtyFields(baseline, draft)).toEqual([]); });
  it("does not mutate a published snapshot when draft values change", () => { const draft = initialDraftForWebsite(defaultWebsiteId); const snapshot = cloneDraft(draft); draft.sections[0].content.title = "New title"; expect(snapshot.sections[0].content.title).not.toBe("New title"); });
});

describe("media security boundaries", () => {
  it("rejects unsupported, oversized, and malformed uploads", async () => { expect(validateImageUpload({ type: "image/svg+xml", size: 20 })).toContain("JPG"); expect(validateImageUpload({ type: "image/png", size: maxImageBytes + 1 })).toContain("5 MB"); await expect(processImageUpload(Buffer.from("not an image"), "spoof.png", defaultWebsiteId)).rejects.toBeInstanceOf(Error); });
  it("processes valid images into scoped WebP metadata", async () => { const input = await sharp({ create: { width: 40, height: 30, channels: 3, background: "red" } }).png().toBuffer(); const processed = await processImageUpload(input, "photo.png", "site-studio-karsa"); expect(processed.asset.websiteId).toBe("site-studio-karsa"); expect(processed.asset.mimeType).toBe("image/webp"); expect(processed.asset.url).toContain("/site-studio-karsa/"); });
  it("does not allow storage operations to cross website directories", async () => { const asset: MediaAsset = { id: "site-studio-karsa:test", websiteId: "site-studio-karsa", filename: "missing.webp", originalFilename: "missing.webp", url: "/uploads/media/site-studio-karsa/missing.webp", mimeType: "image/webp", width: 1, height: 1, sizeBytes: 1, altText: "", createdAt: "", status: "ready" }; await expect(localDevelopmentAssetStorage.remove({ ...asset, websiteId: "site-ruang-sehat" })).rejects.toBeDefined(); });
  it("rejects unknown website ids at the upload boundary", async () => { const form = new FormData(); form.append("websiteId", "unknown-site"); form.append("file", new File(["not-used"], "x.png", { type: "image/png" })); const response = await uploadMedia(new Request("http://localhost/api/media", { method: "POST", body: form })); expect(response.status).toBe(404); });
  it("enforces website scope at the delete boundary", async () => { const input = await sharp({ create: { width: 4, height: 4, channels: 3, background: "blue" } }).png().toBuffer(); const processed = await processImageUpload(input, "scope.png", "site-studio-karsa"); await localDevelopmentAssetStorage.store(processed.buffer, processed.asset); const wrong = await deleteMedia(new Request(`http://localhost/api/media/${encodeURIComponent(processed.asset.id)}?websiteId=site-ruang-sehat`, { method: "DELETE" }), { params: Promise.resolve({ id: processed.asset.id }) }); expect(wrong.status).toBe(404); const correct = await deleteMedia(new Request(`http://localhost/api/media/${encodeURIComponent(processed.asset.id)}?websiteId=site-studio-karsa`, { method: "DELETE" }), { params: Promise.resolve({ id: processed.asset.id }) }); expect(correct.status).toBe(200); });
});

describe("GitHub publishing contract", () => {
  it("exports only the configured active website and excludes local media internals", () => {
    const draft = initialDraftForWebsite(defaultWebsiteId);
    draft.sections[0].content.imageAssetId = "site-dapur-kita:local";
    const exported = exportWebsiteContent(draft);
    expect(exported.schemaVersion).toBe(1);
    expect(exported.website.websiteId).toBe("site-dapur-kita");
    expect(exported.sections[0].content).not.toHaveProperty("imageAssetId");
    expect(serializeWebsiteContent(draft)).not.toContain("localStorage");
    expect(() => exportWebsiteContent(initialDraftForWebsite("site-studio-karsa"))).toThrow("belum diaktifkan");
  });
  it("rejects local upload URLs instead of publishing them as production content", () => {
    const draft = initialDraftForWebsite(defaultWebsiteId);
    draft.sections[0].content.image = "/uploads/media/site-dapur-kita/local.webp";
    expect(() => exportWebsiteContent(draft)).toThrow("URL produksi yang stabil");
  });
  it("returns a configuration error without contacting GitHub", async () => {
    const draft = initialDraftForWebsite(defaultWebsiteId);
    const response = await publishContent(new Request("http://localhost/api/publish", { method: "POST", body: JSON.stringify({ websiteId: defaultWebsiteId, draft }), headers: { "Content-Type": "application/json" } }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("GITHUB_TOKEN");
  });
  it("does not allow a different website to use the configured publishing endpoint", async () => {
    const draft = initialDraftForWebsite("site-studio-karsa");
    const response = await publishContent(new Request("http://localhost/api/publish", { method: "POST", body: JSON.stringify({ websiteId: "site-studio-karsa", draft }), headers: { "Content-Type": "application/json" } }));
    expect(response.status).toBe(403);
  });
  it("updates an existing configured file and returns the GitHub commit SHA", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token"); vi.stubEnv("GITHUB_OWNER", "owner"); vi.stubEnv("GITHUB_REPO", "repo"); vi.stubEnv("GITHUB_BRANCH", "main"); vi.stubEnv("GITHUB_CONTENT_PATH", "content/dapur-kita/content.v1.json");
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ sha: "old-sha" }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ commit: { sha: "new-sha" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await publishToGitHub(initialDraftForWebsite(defaultWebsiteId));
    expect(result.ok).toBe(true); expect(result.commitSha).toBe("new-sha"); expect(fetchMock).toHaveBeenCalledTimes(2);
    const put = JSON.parse(fetchMock.mock.calls[1][1].body as string); expect(put.sha).toBe("old-sha"); expect(put.branch).toBe("main");
  });
});
