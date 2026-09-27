import { assertSecureUrl, config } from './config.js';

let cachedClientToken = null;

function endpoint(template, values) {
  if (!template) {
    throw new Error(
      'This EDLCare endpoint is not configured. Set the corresponding EDL_PATH_* environment variable after verifying the official/authorized route.',
    );
  }

  let out = template;
  for (const [key, value] of Object.entries(values)) {
    const replacement = value == null ? '' : encodeURIComponent(String(value));
    out = out.replaceAll(`{${key}}`, replacement);
  }

  if (/^https?:\/\//i.test(out)) {
    throw new Error('EDL_PATH_* values must be relative paths, not absolute URLs.');
  }

  return out.startsWith('/') ? out : `/${out}`;
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'error' });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`EDLCare request timed out after ${config.timeoutMs} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function getClientCredentialsToken() {
  const now = Date.now();
  if (cachedClientToken && cachedClientToken.expiresAtMs - 30_000 > now) {
    return cachedClientToken.token;
  }

  if (!config.clientId || !config.clientSecret) {
    throw new Error('EDL_CLIENT_ID and EDL_CLIENT_SECRET are required for client_credentials mode.');
  }

  const tokenUrl = assertSecureUrl(config.tokenUrl, 'EDL_TOKEN_URL');
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: config.scope,
  });

  const response = await fetchWithTimeout(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error(
      `EDLCare token request failed (${response.status}): ${data.error_description || data.error || 'no access token returned'}`,
    );
  }

  cachedClientToken = {
    token: data.access_token,
    expiresAtMs: now + Math.max(60, data.expires_in ?? 300) * 1000,
  };

  return data.access_token;
}

async function authorizationHeader() {
  switch (config.authMode) {
    case 'none':
      return {};
    case 'bearer':
      if (!config.accessToken) {
        throw new Error('EDL_ACCESS_TOKEN is required when EDL_AUTH_MODE=bearer.');
      }
      return { authorization: `Bearer ${config.accessToken}` };
    case 'client_credentials':
      return { authorization: `Bearer ${await getClientCredentialsToken()}` };
    default:
      throw new Error(`Unsupported EDL auth mode: ${config.authMode}`);
  }
}

async function readLimited(response) {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > config.maxResponseBytes) {
    throw new Error(`EDLCare response exceeds ${config.maxResponseBytes} bytes.`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > config.maxResponseBytes) {
    throw new Error(`EDLCare response exceeds ${config.maxResponseBytes} bytes.`);
  }

  const text = new TextDecoder().decode(bytes);
  if (!text) return null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('json')) {
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }
  return { raw: text };
}

async function apiGet(path, query = {}) {
  const base = assertSecureUrl(config.apiBaseUrl, 'EDL_API_BASE_URL');
  const url = new URL(path, base);

  if (url.origin !== base.origin) {
    throw new Error('Refusing to call a host different from EDL_API_BASE_URL.');
  }

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  const headers = {
    accept: 'application/json',
    'user-agent': 'edlcare-mcp/0.1.0',
    ...(await authorizationHeader()),
  };

  const response = await fetchWithTimeout(url, { method: 'GET', headers });
  const body = await readLimited(response);

  if (!response.ok) {
    throw new Error(`EDLCare API returned HTTP ${response.status}: ${JSON.stringify(body).slice(0, 1500)}`);
  }

  return { url: url.toString(), status: response.status, data: body };
}

export async function getOidcMetadata() {
  const url = assertSecureUrl(config.oidcDiscoveryUrl, 'EDL_OIDC_DISCOVERY_URL');
  const response = await fetchWithTimeout(url, { headers: { accept: 'application/json' } });
  const body = await readLimited(response);
  if (!response.ok) throw new Error(`OIDC discovery returned HTTP ${response.status}.`);
  return body;
}

export const edl = {
  listAccounts: () => apiGet(endpoint(config.paths.accounts, {})),

  getBalance: (accountNumber) =>
    apiGet(endpoint(config.paths.balance, { accountNumber })),

  getBillHistory: (accountNumber, limit) =>
    apiGet(endpoint(config.paths.billHistory, { accountNumber, limit }), { limit }),

  getUsage: (accountNumber, from, to) =>
    apiGet(endpoint(config.paths.usage, { accountNumber, from, to }), { from, to }),

  getOutages: (accountNumber, from, to) =>
    apiGet(endpoint(config.paths.outages, { accountNumber, from, to }), {
      accountNumber,
      from,
      to,
    }),

  getPaymentHistory: (accountNumber, limit) =>
    apiGet(endpoint(config.paths.paymentHistory, { accountNumber, limit }), { limit }),

  rawGet: (path, query) => {
    if (!config.enableRawGet) {
      throw new Error('Raw GET is disabled. Set EDL_ENABLE_RAW_GET=true to enable it.');
    }
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('..')) {
      throw new Error('Raw path must be an absolute path on the configured EDLCare host and cannot contain ..');
    }
    return apiGet(path, query ?? {});
  },
};
