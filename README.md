# EDLCare / CEB Sri Lanka MCP

A read-only starter MCP server for Electricity Distribution Lanka (EDL/EDLCare; formerly CEBCare).

## What is implemented

- Streamable HTTP MCP endpoint at `/mcp`
- Local stdio transport
- Public EDLCare OIDC discovery tool
- Configurable read-only tools for accounts, balances, bills, usage, outages, and payment history
- Optional OAuth2 client-credentials mode when EDL officially issues application credentials
- Static bearer protection for the public MCP endpoint
- HTTPS enforcement, SSRF protection, request timeouts, and response-size limits
- Docker support

## Important limitation

EDLCare's private customer API routes are not publicly documented. This project intentionally does **not** invent endpoints or embed private credentials.

Configure the `EDL_PATH_*` values only after verifying the real routes from official documentation or network traffic from an EDLCare account you are authorized to use.

Public OIDC discovery:

`https://edlcare.edl.lk/.well-known/openid-configuration`

## Quick start

```bash
cp .env.example .env
npm install
npm run dev
```

Health check:

```bash
curl http://127.0.0.1:3000/health
```

MCP endpoint:

`http://127.0.0.1:3000/mcp`

## stdio

```bash
npm run stdio
```

Example client configuration:

```json
{
  "command": "npm",
  "args": ["run", "stdio"],
  "cwd": "/path/to/edlcare-mcp"
}
```

## Authentication modes

### Public/no auth

```env
EDL_AUTH_MODE=none
```

### Existing authorized bearer token

```env
EDL_AUTH_MODE=bearer
EDL_ACCESS_TOKEN=...
```

### Official client credentials

Only use this when EDL has registered the application and issued credentials.

```env
EDL_AUTH_MODE=client_credentials
EDL_CLIENT_ID=...
EDL_CLIENT_SECRET=...
EDL_SCOPE=cebcare-api-app
EDL_TOKEN_URL=https://edlcare.edl.lk/connect/token
```

## Endpoint configuration

The following are **format examples only**, not verified EDLCare routes:

```env
EDL_PATH_BALANCE=/api/accounts/{accountNumber}/balance
EDL_PATH_BILL_HISTORY=/api/accounts/{accountNumber}/bills
EDL_PATH_USAGE=/api/accounts/{accountNumber}/usage
```

Supported substitutions:

- `{accountNumber}`
- `{from}`
- `{to}`
- `{limit}`

## MCP tools

- `edl_status`
- `edl_oidc_metadata`
- `edl_list_accounts`
- `edl_get_balance`
- `edl_get_bill_history`
- `edl_get_usage`
- `edl_get_outages`
- `edl_get_payment_history`
- `edl_raw_get` when `EDL_ENABLE_RAW_GET=true`

## Cloudflare Worker

A Cloudflare-hosted version can expose:

`https://<worker>.<workers-subdomain>.workers.dev/mcp`

The current Node/Express source in this repository is the portable server implementation. A Cloudflare-native Worker entrypoint can be maintained separately because Workers do not run a long-lived Express listener in the same way as a normal Node server.

## Docker

```bash
docker build -t edlcare-mcp .
docker run --rm -p 3000:3000 --env-file .env edlcare-mcp
```

For a public deployment, set:

```env
MCP_ALLOWED_HOSTS=your-mcp-domain.example
MCP_BEARER_TOKEN=a-long-random-secret
```

## Security

This version is intentionally read-only. It does not include:

- electricity bill payment submission
- account mutations
- complaint submission
- credential scraping

Do not commit `.env`, access tokens, client secrets, or customer credentials.

## Next step

Capture authorized EDLCare browser network traffic for:

1. account list
2. current balance
3. bill history
4. usage
5. outages
6. payment history

Then verify the API base URL, route paths, methods, headers/scopes, and response schemas before populating `EDL_PATH_*`.
