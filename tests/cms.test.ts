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
import { createInitialCmsBootstrap, restoreCmsBootstrap } from "../lib/cms/client-bootstrap";
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
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("website registry and namespaced persistence", () => {
  it("contains distinct valid demo websites", () => { expect(websiteRegistry).toHaveLength(3); expect(new Set(websiteRegistry.map((site) => site.websiteId)).size).toBe(3); expect(getWebsite("unknown-site")).toBeUndefined(); });
  it("keeps drafts, baselines, and snapshots isolated per website", () => { installBrowser(); const studio = makeState("site-studio-karsa"); studio.draft.pages[0].name = "Studio Draft"; studio.baseline.pages[0].name = "Studio Draft"; studio.published = { id: "studio-s1", version: 1, draft: cloneDraft(studio.draft), publishedAt: "2026-10-25T00:00:00.000Z", source: "dummy" }; expect(writeCmsState(studio)).toBe(true); const clinic = makeState("site-ruang-sehat"); expect(writeCmsState(clinic)).toBe(true); const restoredStudio = readCmsState(initialDraftForWebsite("site-studio-karsa"), "site-studio-karsa"); const restoredClinic = readCmsState(initialDraftForWebsite("site-ruang-sehat"), "site-ruang-sehat"); expect(restoredStudio.draft.pages[0].name).toBe("Studio Draft"); expect(restoredStudio.published?.version).toBe(1); expect(restoredClinic.draft.pages[0].name).not.toBe("Studio Draft"); restoredStudio.draft.pages[0].name = "Changed After Publish"; expect(restoredStudio.published?.draft.pages[0].name).toBe("Studio Draft"); });
  it("migrates legacy single-site data without deleting the source", () => { const storage = installBrowser(); const draft = initialDraftForWebsite(defaultWebsiteId); storage.setItem("ber-workshed-cms-state", JSON.stringify({ version: 3, draft, published: null, savedAt: "legacy" })); const restored = readCmsState(draft, defaultWebsiteId); expect(restored.draft.website.websiteId).toBe(defaultWebsiteId); expect(storage.getItem("ber-workshed-cms-state")).not.toBeNull(); expect(storage.getItem("ber-workshed-cms-state-v5-site-dapur-kita")).not.toBeNull(); });
  it("recovers safely from malformed and unsupported data", () => { const storage = installBrowser(); const fallback = initialDraftForWebsite(defaultWebsiteId); storage.setItem("ber-workshed-cms-state-v5-site-dapur-kita", "not-json"); expect(readCmsState(fallback, defaultWebsiteId).storageError).toContain("could not be read"); storage.setItem("ber-workshed-cms-state-v5-site-dapur-kita", JSON.stringify({ version: 99 })); expect(readCmsState(fallback, defaultWebsiteId).storageError).toContain("not recognized"); });
  it("falls back from an unknown active website id", () => { const storage = installBrowser(); storage.setItem("ber-workshed-active-website-v1", "unknown-site"); expect(readActiveWebsiteId(defaultWebsiteId)).toBe(defaultWebsiteId); });
  it("reports persistence failure without changing the in-memory draft", () => { const draft = initialDraftForWebsite(defaultWebsiteId); draft.pages[0].name = "Keep in memory"; vi.stubGlobal("window", { localStorage: { setItem: () => { throw new Error("quota"); } } }); expect(writeCmsState(makeState(defaultWebsiteId))).toBe(false); expect(draft.pages[0].name).toBe("Keep in memory"); });
});

describe("client hydration bootstrap", () => {
  it("keeps the first render deterministic, then restores the saved website after hydration", () => {
    const serverInitial = createInitialCmsBootstrap();
    const storage = installBrowser();
    const saved = makeState("site-studio-karsa");
    saved.draft.sections[0].content.title = "Saved browser title";
    expect(writeCmsState(saved)).toBe(true);
    storage.setItem("ber-workshed-active-website-v1", "site-studio-karsa");

    const firstRender = createInitialCmsBootstrap();
    expect(firstRender).toEqual(serverInitial);
    expect(firstRender.activeWebsiteId).toBe(defaultWebsiteId);
    expect(firstRender.cmsState.draft.website.websiteId).toBe(defaultWebsiteId);
    expect(firstRender.cmsState.draft.sections[0].content.title).not.toBe("Saved browser title");

    const restored = restoreCmsBootstrap();
    expect(restored.activeWebsiteId).toBe("site-studio-karsa");
    expect(restored.cmsState.draft.sections[0].content.title).toBe("Saved browser title");
  });
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
  it("rejects an empty content export before any GitHub request", () => {
    const draft = initialDraftForWebsite(defaultWebsiteId);
    draft.pages = [];
    expect(() => serializeWebsiteContent(draft)).toThrow();
  });
  it("returns a generic configuration error and logs only missing variable names", async () => {
    for (const key of ["GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO", "GITHUB_BRANCH", "GITHUB_CONTENT_PATH"] as const) vi.stubEnv(key, "");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const draft = initialDraftForWebsite(defaultWebsiteId);
    const response = await publishContent(new Request("http://localhost/api/publish", { method: "POST", body: JSON.stringify({ websiteId: defaultWebsiteId, draft }), headers: { "Content-Type": "application/json" } }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).not.toContain("GITHUB_TOKEN");
    expect(fetchMock).not.toHaveBeenCalled();
    const diagnostic = JSON.parse(errorLog.mock.calls[0][1] as string);
    expect(diagnostic).toEqual({ category: "missing_configuration", missingVariables: ["GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO", "GITHUB_BRANCH", "GITHUB_CONTENT_PATH"] });
  });
  it("does not mislabel invalid GitHub settings as missing configuration", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token"); vi.stubEnv("GITHUB_OWNER", "bad/owner"); vi.stubEnv("GITHUB_REPO", "cms-exam"); vi.stubEnv("GITHUB_BRANCH", "master"); vi.stubEnv("GITHUB_CONTENT_PATH", "content/dapur-kita/content.v1.json");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const draft = initialDraftForWebsite(defaultWebsiteId);
    const response = await publishContent(new Request("http://localhost/api/publish", { method: "POST", body: JSON.stringify({ websiteId: defaultWebsiteId, draft }), headers: { "Content-Type": "application/json" } }));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain("tidak valid");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(errorLog.mock.calls[0][1] as string)).toEqual({ category: "invalid_configuration", missingVariables: [] });
  });
  it("rejects a content path outside the server-approved export path before contacting GitHub", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token"); vi.stubEnv("GITHUB_OWNER", "ariyoaziz"); vi.stubEnv("GITHUB_REPO", "cms-exam"); vi.stubEnv("GITHUB_BRANCH", "master"); vi.stubEnv("GITHUB_CONTENT_PATH", "content/dapur-kita/../private.json");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const draft = initialDraftForWebsite(defaultWebsiteId);
    const response = await publishContent(new Request("http://localhost/api/publish", { method: "POST", body: JSON.stringify({ websiteId: defaultWebsiteId, draft }), headers: { "Content-Type": "application/json" } }));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain("tidak valid");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(errorLog.mock.calls[0][1] as string).category).toBe("invalid_configuration");
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
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.github.com/repos/owner/repo/contents/content/dapur-kita/content.v1.json?ref=main");
    expect(fetchMock.mock.calls[0][1].method).toBe("GET"); expect(fetchMock.mock.calls[1][1].method).toBe("PUT");
    const put = JSON.parse(fetchMock.mock.calls[1][1].body as string); expect(put.sha).toBe("old-sha"); expect(put.branch).toBe("main");
  });
  it("logs safe 403 diagnostics, including the required permission and request id", async () => {
    vi.stubEnv("GITHUB_TOKEN", "private-test-token"); vi.stubEnv("GITHUB_OWNER", "ariyoaziz"); vi.stubEnv("GITHUB_REPO", "cms-exam"); vi.stubEnv("GITHUB_BRANCH", "cms-exam"); vi.stubEnv("GITHUB_CONTENT_PATH", "content/dapur-kita/content.v1.json");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Resource not accessible by personal access token", content: "PRIVATE_FILE_CONTENT" }), { status: 403, headers: { "X-Accepted-GitHub-Permissions": "contents=read", "X-GitHub-Request-Id": "req-abc123" } })));
    const draft = initialDraftForWebsite(defaultWebsiteId);
    const response = await publishContent(new Request("http://localhost/api/publish", { method: "POST", body: JSON.stringify({ websiteId: defaultWebsiteId, draft }), headers: { "Content-Type": "application/json" } }));
    const result = await response.json();
    expect(response.status).toBe(502);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("(403)");
    expect(result.message).not.toContain("contents=read");
    expect(result.message).not.toContain("Resource not accessible");
    expect(result.message).not.toContain("private-test-token");
    const serializedLog = errorLog.mock.calls.map((call) => call.join(" ")).join(" ");
    const diagnostic = JSON.parse(errorLog.mock.calls[0][1] as string);
    expect(diagnostic).toMatchObject({ operation: "read", method: "GET", status: 403, category: "access_denied_permission_or_policy", githubMessage: "Resource not accessible by personal access token", acceptedPermissions: "contents=read", requestId: "req-abc123" });
    expect(diagnostic.endpoint).toBe("/repos/ariyoaziz/cms-exam/contents/content/dapur-kita/content.v1.json?ref=cms-exam");
    expect(serializedLog).not.toContain("private-test-token"); expect(serializedLog).not.toContain("Authorization"); expect(serializedLog).not.toContain("PRIVATE_FILE_CONTENT");
  });
  it("categorizes SSO restrictions without logging or returning the authorization URL", async () => {
    vi.stubEnv("GITHUB_TOKEN", "private-test-token"); vi.stubEnv("GITHUB_OWNER", "ariyoaziz"); vi.stubEnv("GITHUB_REPO", "cms-exam"); vi.stubEnv("GITHUB_BRANCH", "main"); vi.stubEnv("GITHUB_CONTENT_PATH", "content/dapur-kita/content.v1.json");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Resource protected by SAML SSO" }), { status: 403, headers: { "X-GitHub-SSO": "required; url=https://github.com/orgs/example/sso" } })));
    const result = await publishToGitHub(initialDraftForWebsite(defaultWebsiteId));
    expect(result.message).toContain("SSO"); expect(result.message).toContain("403");
    expect(result.message).not.toContain("github.com/orgs/example/sso");
    expect(JSON.parse(errorLog.mock.calls[0][1] as string).category).toBe("organization_sso_or_approval");
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain("github.com/orgs/example/sso");
  });
  it("distinguishes a missing configured branch and does not attempt a write", async () => {
    vi.stubEnv("GITHUB_TOKEN", "private-test-token"); vi.stubEnv("GITHUB_OWNER", "ariyoaziz"); vi.stubEnv("GITHUB_REPO", "cms-exam"); vi.stubEnv("GITHUB_BRANCH", "cms-exam"); vi.stubEnv("GITHUB_CONTENT_PATH", "content/dapur-kita/content.v1.json");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "No commit found for the ref cms-exam" }), { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await publishToGitHub(initialDraftForWebsite(defaultWebsiteId));
    expect(result.message.toLowerCase()).toContain("branch"); expect(result.message).not.toContain("cms-exam");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(errorLog.mock.calls[0][1] as string).category).toBe("branch_not_found");
  });
  it("creates a missing content file without a SHA", async () => {
    vi.stubEnv("GITHUB_TOKEN", "private-test-token"); vi.stubEnv("GITHUB_OWNER", "ariyoaziz"); vi.stubEnv("GITHUB_REPO", "cms-exam"); vi.stubEnv("GITHUB_BRANCH", "master"); vi.stubEnv("GITHUB_CONTENT_PATH", "content/dapur-kita/content.v1.json");
    const infoLog = vi.spyOn(console, "info").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ message: "Not Found" }), { status: 404 })).mockResolvedValueOnce(new Response(JSON.stringify({ commit: { sha: "created-sha" } }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await publishToGitHub(initialDraftForWebsite(defaultWebsiteId));
    expect(result.ok).toBe(true); expect(result.commitSha).toBe("created-sha");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(putBody).not.toHaveProperty("sha");
    const published = JSON.parse(Buffer.from(putBody.content, "base64").toString("utf8"));
    expect(published.pages.length).toBeGreaterThan(0); expect(published.sections.length).toBeGreaterThan(0);
    expect(JSON.parse(infoLog.mock.calls[0][1] as string)).toMatchObject({ method: "GET", status: 404, category: "content_file_missing_will_create" });
  });
  it("maps an invalid token to an upstream failure status instead of HTTP 200", async () => {
    vi.stubEnv("GITHUB_TOKEN", "invalid-test-token"); vi.stubEnv("GITHUB_OWNER", "ariyoaziz"); vi.stubEnv("GITHUB_REPO", "cms-exam"); vi.stubEnv("GITHUB_BRANCH", "master"); vi.stubEnv("GITHUB_CONTENT_PATH", "content/dapur-kita/content.v1.json");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401, headers: { "X-GitHub-Request-Id": "auth-req-1" } })));
    const draft = initialDraftForWebsite(defaultWebsiteId);
    const response = await publishContent(new Request("http://localhost/api/publish", { method: "POST", body: JSON.stringify({ websiteId: defaultWebsiteId, draft }), headers: { "Content-Type": "application/json" } }));
    expect(response.status).toBe(502);
    expect((await response.json()).message).toContain("Autentikasi GitHub gagal");
    expect(JSON.parse(errorLog.mock.calls[0][1] as string)).toMatchObject({ status: 401, category: "token_invalid_or_expired", requestId: "auth-req-1" });
  });
  it("returns HTTP 409 when the existing content changed before the PUT", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token"); vi.stubEnv("GITHUB_OWNER", "ariyoaziz"); vi.stubEnv("GITHUB_REPO", "cms-exam"); vi.stubEnv("GITHUB_BRANCH", "master"); vi.stubEnv("GITHUB_CONTENT_PATH", "content/dapur-kita/content.v1.json");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ sha: "fresh-sha" }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ message: "sha does not match" }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    const draft = initialDraftForWebsite(defaultWebsiteId);
    const response = await publishContent(new Request("http://localhost/api/publish", { method: "POST", body: JSON.stringify({ websiteId: defaultWebsiteId, draft }), headers: { "Content-Type": "application/json" } }));
    expect(response.status).toBe(409);
    expect((await response.json()).message).toContain("berubah selama publish");
    expect(JSON.parse(errorLog.mock.calls[0][1] as string)).toMatchObject({ operation: "write", method: "PUT", status: 409, category: "content_conflict" });
  });
  it("does not attempt a write when an existing file response has no SHA", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token"); vi.stubEnv("GITHUB_OWNER", "ariyoaziz"); vi.stubEnv("GITHUB_REPO", "cms-exam"); vi.stubEnv("GITHUB_BRANCH", "master"); vi.stubEnv("GITHUB_CONTENT_PATH", "content/dapur-kita/content.v1.json");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ type: "file" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await publishToGitHub(initialDraftForWebsite(defaultWebsiteId));
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(errorLog.mock.calls[0][1] as string).category).toBe("existing_file_missing_sha");
  });
  it("returns a generic 404 error and logs sanitized write diagnostics", async () => {
    vi.stubEnv("GITHUB_TOKEN", "private-test-token"); vi.stubEnv("GITHUB_OWNER", "ariyoaziz"); vi.stubEnv("GITHUB_REPO", "cms-exam"); vi.stubEnv("GITHUB_BRANCH", "master"); vi.stubEnv("GITHUB_CONTENT_PATH", "content/dapur-kita/content.v1.json");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ message: "Not Found" }), { status: 404 })).mockResolvedValueOnce(new Response(JSON.stringify({ message: "Not Found", content: "PRIVATE_FILE_CONTENT" }), { status: 404, headers: { "X-GitHub-Request-Id": "write-req-1" } }));
    vi.stubGlobal("fetch", fetchMock);
    const draft = initialDraftForWebsite(defaultWebsiteId);
    const response = await publishContent(new Request("http://localhost/api/publish", { method: "POST", body: JSON.stringify({ websiteId: defaultWebsiteId, draft }), headers: { "Content-Type": "application/json" } }));
    const result = await response.json();
    expect(response.status).toBe(502);
    expect(result.message).toContain("(404)"); expect(result.message).not.toContain("GITHUB_OWNER"); expect(result.message).not.toContain("ariyoaziz");
    const diagnostic = JSON.parse(errorLog.mock.calls[0][1] as string);
    expect(diagnostic).toMatchObject({ operation: "write", method: "PUT", status: 404, category: "repository_branch_or_path_not_found", githubMessage: "Not Found", requestId: "write-req-1" });
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain("private-test-token"); expect(errorLog.mock.calls.flat().join(" ")).not.toContain("PRIVATE_FILE_CONTENT");
  });
});
