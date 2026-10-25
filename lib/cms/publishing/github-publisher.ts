import type { Draft, PublishResult } from "../../../types/cms";
import { githubContentPath, serializeWebsiteContent } from "./content-export";

type GitHubConfig = { token: string; owner: string; repo: string; branch: string; contentPath: string };
const githubApi = "https://api.github.com";
const githubOwner = "ariyoaziz";
const githubRepo = "cms-exam";

export class GitHubConfigurationError extends Error {
  constructor(
    message: string,
    readonly category: "missing_configuration" | "invalid_configuration",
    readonly missingVariables: string[] = [],
  ) {
    super(message);
    this.name = "GitHubConfigurationError";
  }
}

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
  if (missing.length) throw new GitHubConfigurationError(`Konfigurasi GitHub belum lengkap: ${missing.join(", ")}.`, "missing_configuration", missing);
  const branchParts = values.branch!.split("/");
  const branchIsValid = /^[A-Za-z0-9._/-]+$/.test(values.branch!)
    && branchParts.every((part) => part.length > 0 && part !== "." && part !== ".." && !part.startsWith(".") && !part.endsWith(".lock"))
    && !values.branch!.includes("@{")
    && !values.branch!.endsWith(".");
  if (values.owner !== githubOwner || values.repo !== githubRepo || !branchIsValid || values.contentPath !== githubContentPath) {
    throw new GitHubConfigurationError("Konfigurasi repository GitHub tidak diizinkan.", "invalid_configuration");
  }
  return values as GitHubConfig;
}

async function githubRequest<T>(url: string, init: RequestInit, token: string): Promise<{ response: Response; data: T | null }> {
  const response = await fetch(url, { ...init, headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const data = response.status === 204 ? null : await response.json().catch(() => null) as T | null;
  return { response, data };
}

function acceptedPermissions(response: Response): string | undefined {
  const value = response.headers.get("X-Accepted-GitHub-Permissions")?.trim();
  if (!value || value.length > 240) return undefined;
  const groups = value.split(";");
  const valid = groups.every((group) => group.trim().split(",").every((item) => /^[a-z][a-z0-9_]*=(read|write)$/i.test(item.trim())));
  return valid ? value : undefined;
}

function githubRequestId(response: Response): string | undefined {
  const value = response.headers.get("X-GitHub-Request-Id");
  return value && /^[A-Za-z0-9:-]{1,100}$/.test(value) ? value : undefined;
}

function safeGitHubMessage(message: unknown, config: GitHubConfig): string {
  if (typeof message !== "string" || !message.trim()) return "GitHub tidak memberikan pesan error.";
  return message
    .replaceAll(config.token, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/https?:\/\/\S+/gi, "[URL disembunyikan]")
    .replaceAll(`${config.owner}/${config.repo}`, "[repository]")
    .replaceAll(config.owner, "[owner]")
    .replaceAll(config.repo, "[repository]")
    .replaceAll(config.contentPath, "[content path]")
    .replace(/[\r\n\t\x00-\x1f]/g, " ")
    .trim()
    .slice(0, 240);
}

function githubFailureMessage(response: Response, rawMessage: unknown, config: GitHubConfig, operation: "read" | "write", endpoint: string): string {
  const status = response.status;
  const verb = operation === "read" ? "GET" : "PUT";
  const githubMessage = safeGitHubMessage(rawMessage, config);
  const permissions = acceptedPermissions(response);
  const lowered = typeof rawMessage === "string" ? rawMessage.toLowerCase() : "";
  const ssoRequired = /required/i.test(response.headers.get("X-GitHub-SSO") ?? "");
  const organizationApproval = /(?:organization|org).{0,80}(?:approval|policy)|(?:approval|policy).{0,80}(?:organization|org)|pending approval|awaiting approval|saml|single sign-on/i.test(lowered);
  const requestId = githubRequestId(response);
  const rateLimited = /rate limit/i.test(lowered) || response.headers.get("X-RateLimit-Remaining") === "0";
  const branchMissing = status === 404 && operation === "read" && /no commit found for (?:the )?ref/i.test(lowered);
  let category = "unexpected_api_error";
  let userMessage: string;

  if (status === 403 && rateLimited) {
    category = "rate_limited";
    userMessage = `GitHub membatasi request content (${status}). Coba lagi nanti.`;
  } else if (status === 403 && (ssoRequired || organizationApproval)) {
    category = "organization_sso_or_approval";
    userMessage = `GitHub memerlukan otorisasi SSO atau persetujuan organisasi (${status}). Hubungi administrator repository.`;
  } else if (status === 403) {
    category = permissions ? "access_denied_permission_or_policy" : "access_denied_unspecified";
    userMessage = `GitHub menolak akses repository (${status}). Periksa akses token, izin Contents yang dibutuhkan, dan persetujuan organisasi.`;
  } else if (status === 401) {
    category = "token_invalid_or_expired";
    userMessage = `Autentikasi GitHub gagal (${status}). Administrator perlu memeriksa secret token.`;
  } else if (branchMissing) {
    category = "branch_not_found";
    userMessage = `Branch GitHub yang dikonfigurasi tidak ditemukan (${status}). Hubungi administrator repository.`;
  } else if (status === 404) {
    category = "repository_branch_or_path_not_found";
    userMessage = `Repository, branch, atau content path tidak ditemukan atau tidak dapat diakses (${status}). Periksa konfigurasi GitHub.`;
  } else if (status === 409) {
    category = "content_conflict";
    userMessage = `File content berubah selama publish (${status}). Muat ulang lalu coba lagi.`;
  } else {
    userMessage = `GitHub API mengembalikan error yang tidak terduga (${status}). Coba lagi nanti.`;
  }

  console.error("cms-github-api-failure", JSON.stringify({
    operation,
    method: verb,
    endpoint,
    status,
    category,
    githubMessage,
    ...(permissions ? { acceptedPermissions: permissions } : {}),
    ...(requestId ? { requestId } : {}),
  }));
  return userMessage;
}

export async function publishToGitHub(draft: Draft): Promise<PublishResult> {
  const config = readConfig();
  const content = serializeWebsiteContent(draft);
  if (!content.trim()) return { ok: false, status: "failed", message: "Export content kosong; file repository tidak diubah.", httpStatus: 422 };
  const encodedPath = config.contentPath.split("/").map(encodeURIComponent).join("/");
  const baseUrl = `${githubApi}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodedPath}`;
  try {
    const readUrl = `${baseUrl}?ref=${encodeURIComponent(config.branch)}`;
    const readEndpoint = new URL(readUrl).pathname + new URL(readUrl).search;
    const current = await githubRequest<{ sha?: string; message?: unknown }>(readUrl, { method: "GET" }, config.token);
    if (!current.response.ok && current.response.status !== 404) {
      return { ok: false, status: "failed", message: githubFailureMessage(current.response, current.data?.message, config, "read", readEndpoint), httpStatus: current.response.status };
    }
    if (current.response.status === 404 && /no commit found for (?:the )?ref/i.test(typeof current.data?.message === "string" ? current.data.message : "")) {
      return { ok: false, status: "failed", message: githubFailureMessage(current.response, current.data?.message, config, "read", readEndpoint), httpStatus: current.response.status };
    }
    if (current.response.status === 404) {
      const permissions = acceptedPermissions(current.response);
      const requestId = githubRequestId(current.response);
      console.info("cms-github-content-missing", JSON.stringify({ method: "GET", endpoint: readEndpoint, status: 404, category: "content_file_missing_will_create", githubMessage: safeGitHubMessage(current.data?.message, config), ...(permissions ? { acceptedPermissions: permissions } : {}), ...(requestId ? { requestId } : {}) }));
    }
    let existingSha: string | undefined;
    if (current.response.ok) {
      if (typeof current.data?.sha !== "string" || !current.data.sha.trim()) {
        console.error("cms-github-api-failure", JSON.stringify({ operation: "read", method: "GET", endpoint: readEndpoint, status: 502, category: "existing_file_missing_sha" }));
        return { ok: false, status: "failed", message: "GitHub tidak mengembalikan SHA file yang ada; konten tidak diubah.", httpStatus: 502 };
      }
      existingSha = current.data.sha;
    }
    const body = { message: "chore(cms): publish Dapur Kita content", content: Buffer.from(content, "utf8").toString("base64"), branch: config.branch, ...(existingSha ? { sha: existingSha } : {}) };
    const committed = await githubRequest<{ commit?: { sha?: string }; message?: unknown }>(baseUrl, { method: "PUT", body: JSON.stringify(body) }, config.token);
    if (!committed.response.ok) {
      return { ok: false, status: "failed", message: githubFailureMessage(committed.response, committed.data?.message, config, "write", new URL(baseUrl).pathname), httpStatus: committed.response.status };
    }
    const commitSha = committed.data?.commit?.sha;
    return { ok: true, status: "github", message: "Commit GitHub berhasil dibuat. Deployment Cloudflare belum dilacak.", publishedAt: new Date().toISOString(), commitSha, repository: `${config.owner}/${config.repo}`, path: config.contentPath, deploymentStatus: "not-tracked" };
  } catch {
    return { ok: false, status: "failed", message: "GitHub tidak dapat dihubungi. Draft tetap tersimpan di CMS.", httpStatus: 502 };
  }
}
