# Cloudflare Workers deployment

This project uses OpenNext for Cloudflare and Wrangler. The application is deployed as the generated Worker in `.open-next/worker.js`; `.open-next/` is generated and must not be committed.

## Workers Builds settings

Use the repository root as the root directory and `master` as the production branch.

- Build command: `npx @opennextjs/cloudflare build`
- Deploy command: `npx @opennextjs/cloudflare deploy`
- Local preview only: `npx @opennextjs/cloudflare preview`

Do not put `preview` in the CI/CD deploy command. Preview starts a long-running local Wrangler server, normally on `http://localhost:8787`, so it is not a production deployment step.

The OpenNext build command calls the package `build` script internally. The package script therefore remains a regular Next.js build (`next build --webpack`); changing it to call OpenNext would create a recursive build.

For local use:

```text
npm run build
npm run preview
npm run deploy
```

`npm run deploy` performs an OpenNext build followed by a production Worker deployment. It is intentionally not run by this verification task.

## Wrangler configuration

[`wrangler.jsonc`](../wrangler.jsonc) points Wrangler at `.open-next/worker.js` and `.open-next/assets`, enables `nodejs_compat`, and configures the self-reference service binding required by OpenNext. The Cloudflare Workers Builds project should use this repository's root directory and the generated configuration.

## Environment and secrets

Configure GitHub publishing variables as server-side Cloudflare secrets or environment variables when that route is enabled:

- `GITHUB_TOKEN`
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_BRANCH`
- `GITHUB_CONTENT_PATH`

Never put real values in source control or in `.env.example`. Cloudflare's Workers Builds integration supplies the deployment credentials; no deployment token is required in the repository.

## Production limitations

The CMS still uses browser `localStorage` for content state and local filesystem writes under `public/uploads/media` for media uploads. These are development-oriented assumptions and are not a shared, durable Workers data store. Uploaded files currently become static assets during the build; production media should move to object storage before relying on runtime uploads. The GitHub publishing route also requires its server-side secrets and has not been production-deployed in this task.

OpenNext reports that Windows is not fully supported for its build workflow. Prefer Linux CI or WSL for the Workers build if Windows-specific filesystem locks occur.
