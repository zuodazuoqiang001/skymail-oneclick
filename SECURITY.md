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

## Reporting

Open a GitHub issue. Include the commit hash you inspected.