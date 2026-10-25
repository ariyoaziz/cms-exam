import { NextResponse } from "next/server";
import { getWebsite } from "../../../lib/cms/website-registry";
import { publishToGitHub, GitHubConfigurationError } from "../../../lib/cms/publishing/github-publisher";
import { githubWebsiteId, exportWebsiteContent } from "../../../lib/cms/publishing/content-export";
import type { Draft } from "../../../types/cms";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { websiteId?: unknown; draft?: unknown };
    if (body.websiteId !== githubWebsiteId || !getWebsite(githubWebsiteId)) return NextResponse.json({ ok: false, error: "Website ini belum diaktifkan untuk GitHub publishing." }, { status: 403 });
    if (!body.draft || typeof body.draft !== "object") return NextResponse.json({ ok: false, error: "Draft wajib dikirim." }, { status: 400 });
    const draft = body.draft as Draft;
    exportWebsiteContent(draft);
    const result = await publishToGitHub(draft);
    const { httpStatus, ...publicResult } = result;
    const status = result.ok ? 200 : httpStatus === 409 ? 409 : httpStatus === 422 ? 422 : httpStatus === 429 ? 503 : 502;
    return NextResponse.json(publicResult, { status });
  } catch (error) {
    if (error instanceof GitHubConfigurationError) {
      console.error("cms-github-configuration-failure", JSON.stringify({ category: error.category, missingVariables: error.missingVariables }));
      const missing = error.category === "missing_configuration";
      return NextResponse.json(
        { ok: false, error: missing ? "Konfigurasi GitHub publishing belum lengkap. Hubungi administrator." : "Konfigurasi GitHub publishing tidak valid. Hubungi administrator." },
        { status: missing ? 503 : 500 },
      );
    }
    const message = error instanceof Error ? error.message : "Draft tidak dapat divalidasi.";
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
