import type { Draft, PublishResult } from "../../../types/cms";
import { serializeWebsiteContent } from "./content-export";

type GitHubConfig = { token: string; owner: string; repo: string; branch: string; contentPath: string };
const githubApi = "https://api.github.com";

export class GitHubConfigurationError extends Error {}

function readConfig(): GitHubConfig {
  const values = {
    token: process.env.GITHUB_TOKEN,
    owner: process.env.GITHUB_OWNER,
    repo: process.env.GITHUB_REPO,
    branch: process.env.GITHUB_BRANCH,
    contentPath: process.env.GITHUB_CONTENT_PATH,
  };
  const envNames: Record<keyof typeof values, string> = { token: "GITHUB_TOKEN", owner: "GITHUB_OWNER", repo: "GITHUB_REPO", branch: "GITHUB_BRANCH", contentPath: "GITHUB_CONTENT_PATH" };
  const missing = Object.entries(values).filter(([, value]) => !value).map(([key]) => envNames[key as keyof typeof values]);
  if (missing.length) throw new GitHubConfigurationError(`Konfigurasi GitHub belum lengkap: ${missing.join(", ")}.`);
  if (!/^[A-Za-z0-9_.-]+$/.test(values.owner!) || !/^[A-Za-z0-9_.-]+$/.test(values.repo!) || !/^[A-Za-z0-9._/-]+$/.test(values.branch!) || !/^content\/dapur-kita\/[A-Za-z0-9._/-]+$/.test(values.contentPath!)) {
    throw new GitHubConfigurationError("Konfigurasi repository GitHub tidak diizinkan.");
  }
  return values as GitHubConfig;
}

async function githubRequest<T>(url: string, init: RequestInit, token: string): Promise<{ response: Response; data: T | null }> {
  const response = await fetch(url, { ...init, headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const data = response.status === 204 ? null : await response.json().catch(() => null) as T | null;
  return { response, data };
}

export async function publishToGitHub(draft: Draft): Promise<PublishResult> {
  const config = readConfig();
  const content = serializeWebsiteContent(draft);
  const encodedPath = config.contentPath.split("/").map(encodeURIComponent).join("/");
  const baseUrl = `${githubApi}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodedPath}`;
  try {
    const current = await githubRequest<{ sha?: string }>(`${baseUrl}?ref=${encodeURIComponent(config.branch)}`, { method: "GET" }, config.token);
    if (!current.response.ok && current.response.status !== 404) return { ok: false, status: "failed", message: `GitHub menolak pembacaan content (${current.response.status}).` };
    const body = { message: "chore(cms): publish Dapur Kita content", content: Buffer.from(content, "utf8").toString("base64"), branch: config.branch, ...(current.response.ok && current.data?.sha ? { sha: current.data.sha } : {}) };
    const committed = await githubRequest<{ commit?: { sha?: string } }>(baseUrl, { method: "PUT", body: JSON.stringify(body) }, config.token);
    if (!committed.response.ok) return { ok: false, status: "failed", message: `GitHub gagal membuat commit (${committed.response.status}).` };
    const commitSha = committed.data?.commit?.sha;
    return { ok: true, status: "github", message: "Commit GitHub berhasil dibuat. Deployment Cloudflare belum dilacak.", publishedAt: new Date().toISOString(), commitSha, repository: `${config.owner}/${config.repo}`, path: config.contentPath, deploymentStatus: "not-tracked" };
  } catch {
    return { ok: false, status: "failed", message: "GitHub tidak dapat dihubungi. Draft tetap tersimpan di CMS." };
  }
}
