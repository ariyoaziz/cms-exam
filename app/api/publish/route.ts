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
    return NextResponse.json(await publishToGitHub(draft));
  } catch (error) {
    if (error instanceof GitHubConfigurationError) return NextResponse.json({ ok: false, error: error.message }, { status: 503 });
    const message = error instanceof Error ? error.message : "Draft tidak dapat divalidasi.";
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
