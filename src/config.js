import * as z from 'zod/v4';

function asBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function asInteger(value, fallback) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function csv(value) {
  return (value ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

const authModeSchema = z.enum(['none', 'bearer', 'client_credentials']);

export const config = {
  port: asInteger(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  allowedHosts: csv(process.env.MCP_ALLOWED_HOSTS || 'localhost,127.0.0.1'),
  mcpBearerToken: process.env.MCP_BEARER_TOKEN || '',

  oidcDiscoveryUrl:
    process.env.EDL_OIDC_DISCOVERY_URL ||
    'https://edlcare.edl.lk/.well-known/openid-configuration',

  apiBaseUrl: process.env.EDL_API_BASE_URL || 'https://edlcare.edl.lk',
  authMode: authModeSchema.parse(process.env.EDL_AUTH_MODE || 'none'),
  accessToken: process.env.EDL_ACCESS_TOKEN || '',
  clientId: process.env.EDL_CLIENT_ID || '',
  clientSecret: process.env.EDL_CLIENT_SECRET || '',
  scope: process.env.EDL_SCOPE || 'cebcare-api-app',
  tokenUrl: process.env.EDL_TOKEN_URL || 'https://edlcare.edl.lk/connect/token',

  paths: {
    accounts: process.env.EDL_PATH_ACCOUNTS || '',
    balance: process.env.EDL_PATH_BALANCE || '',
    billHistory: process.env.EDL_PATH_BILL_HISTORY || '',
    usage: process.env.EDL_PATH_USAGE || '',
    outages: process.env.EDL_PATH_OUTAGES || '',
    paymentHistory: process.env.EDL_PATH_PAYMENT_HISTORY || '',
  },

  enableRawGet: asBoolean(process.env.EDL_ENABLE_RAW_GET, false),
  timeoutMs: asInteger(process.env.EDL_TIMEOUT_MS, 15_000),
  maxResponseBytes: asInteger(process.env.EDL_MAX_RESPONSE_BYTES, 1_048_576),
  allowInsecureHttp: asBoolean(process.env.EDL_ALLOW_INSECURE_HTTP, false),
};

export function assertSecureUrl(value, label) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !config.allowInsecureHttp) {
    throw new Error(`${label} must use HTTPS. Set EDL_ALLOW_INSECURE_HTTP=true only for local testing.`);
  }
  return url;
}
