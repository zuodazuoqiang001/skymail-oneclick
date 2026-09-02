# Security

skymail-oneclick is an MIT-licensed local wizard. The GitHub tree is the only official distribution.

## What it is allowed to do

- Run a local HTTP wizard on `127.0.0.1` only.
- Call `api.cloudflare.com` with the **User API Token you paste**.
- Clone the latest Cloud Mail source from GitHub on this machine and run `wrangler deploy` locally.

## What it must not do

- Upload your Cloudflare token or JWT to any third-party server.
- Phone home or collect telemetry.
- Ship obfuscated binaries.

The API token stays in the browser tab / local Node process. `.skymail-state.json` is gitignored.

## GitHub Actions (optional)

You may store `CLOUDFLARE_API_TOKEN` as a GitHub Actions secret on **your fork** and run `.github/workflows/deploy.yml`. The token is sent only to GitHub-hosted runners and `api.cloudflare.com`. Do not put the token on someone else's repository. Public logs must not contain the token or full JWT (`--ci`).

## Reporting

Open a GitHub issue. Include the commit hash you inspected.