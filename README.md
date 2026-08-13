# Discogs Album Feed

A tiny GitHub Actions + GitHub Pages service for the `wookie61` Discogs collection. The Discogs personal access token is used only inside GitHub Actions. The public site contains a compact JSON snapshot and never contains credentials, collection notes, conditions, or other private fields.

## What gets published

`collection.json` contains the artist, title, year, genres, styles, formats, labels, Discogs release ID, collection instance ID, and folder ID. It also includes verification metadata. The workflow refuses to publish unless every reported page was fetched, the fetched total matches Discogs' reported total, and instance IDs are unique.

## One-time setup

1. Create a new **public** GitHub repository (for example, `discogs-album-feed`). Copy all files from this folder into it and push the default branch.
2. In Discogs, create a personal access token from **Settings → Developers**.
3. In the GitHub repository, open **Settings → Secrets and variables → Actions → New repository secret**. Name it `DISCOGS_TOKEN` and paste the token as its value. Do not put the token in a file, commit, issue, workflow input, or automation prompt.
4. Open **Settings → Pages**. Under **Build and deployment**, set **Source** to **GitHub Actions**.
5. Open **Actions → Refresh Discogs collection feed → Run workflow**. When it finishes, the deployment URL appears in the run and in **Settings → Pages**.

The public endpoint will normally be:

`https://YOUR-GITHUB-USERNAME.github.io/discogs-album-feed/collection.json`

If the repository is named `YOUR-GITHUB-USERNAME.github.io`, use:

`https://YOUR-GITHUB-USERNAME.github.io/collection.json`

## Refresh behavior

The workflow runs daily at 4:17 AM in `Pacific/Honolulu` and can also be run manually from the Actions tab. GitHub runs scheduled workflows from the latest default-branch commit. Change the `cron` and `timezone` values in `.github/workflows/refresh.yml` if desired.

For each refresh, the script requests folder `0` (the Discogs “All” folder), follows every page reported by the first response, and uses 100 items per page. It retries network failures, HTTP 429 responses, and HTTP 5xx responses with bounded exponential backoff; `Retry-After` and Discogs rate-limit reset headers are honored when present. Authentication errors, malformed responses, changed pagination metadata, count mismatches, and duplicate instance IDs fail the run. Because deployment is the final step, a failed refresh leaves the last verified Pages snapshot live.

Use the Actions run log to diagnose failures. It logs counts and errors, never the token or request headers. GitHub masks exact secret values in logs, but the workflow also avoids printing them.

## Point the daily album task at the feed

Edit the existing daily task and replace its Discogs API/token instructions with the prompt below, substituting the real Pages URL:

> Read `https://YOUR-GITHUB-USERNAME.github.io/discogs-album-feed/collection.json`. Before choosing an album, require `schema_version` to equal `1`, `verification.complete` to be `true`, and `verification.fetched_items` to equal both `verification.reported_items` and the length of `releases`. If the feed cannot be read, is stale by more than 48 hours according to `generated_at`, or fails validation, report that clearly and do not invent a pick. Otherwise, choose today's Album of the Day only from `releases`, vary artists and styles when possible, and cite the artist, title, and year from the selected entry. Never request or use a Discogs token.

Schedule the GitHub refresh before the album task. The included 4:17 AM Hawaii-time refresh leaves a practical buffer for a later morning recommendation. Run both once manually after setup to verify the end-to-end path.

## Local testing (optional)

With Node.js 22 or newer installed, run `npm test`. A live local refresh additionally requires `DISCOGS_TOKEN`; its output is ignored by Git.

## Security notes

- Keep the repository public only because ChatGPT must be able to read the JSON without authentication.
- GitHub Pages publishes only the `public` directory artifact, not repository secrets.
- Rotate the Discogs token immediately if it is ever pasted into a commit, issue, log, or chat.
- Review the JSON after the first deployment to confirm the selected fields are acceptable for public exposure.
