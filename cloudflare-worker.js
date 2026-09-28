
const BASE = "https://edlcare.edl.lk";
const OIDC = BASE + "/.well-known/openid-configuration";
const ME = BASE + "/api/auth/me";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization, mcp-session-id",
      "access-control-allow-methods": "GET, POST, OPTIONS"
    }
  });
}
function rpc(id, result) { return json({ jsonrpc: "2.0", id, result }); }
function rpcError(id, code, message, data) {
  return json({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } });
}
function textResult(id, value, isError = false) {
  return rpc(id, { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], isError });
}
function getEdlCookie() {
  try {
    const parts = [];
    if (typeof EDL_COOKIE_1 === "string" && EDL_COOKIE_1) parts.push(EDL_COOKIE_1);
    if (typeof EDL_COOKIE_2 === "string" && EDL_COOKIE_2) parts.push(EDL_COOKIE_2);
    if (typeof EDL_COOKIE_3 === "string" && EDL_COOKIE_3) parts.push(EDL_COOKIE_3);
    if (parts.length) return parts.join("").trim();
    if (typeof EDL_COOKIE === "string" && EDL_COOKIE.trim()) return EDL_COOKIE.trim();
  } catch {}
  return "";
}
function configuredPath(key) {
  try {
    switch (key) {
      case "accounts": return typeof EDL_PATH_ACCOUNTS === "string" ? EDL_PATH_ACCOUNTS.trim() : "";
      case "balance": return typeof EDL_PATH_BALANCE === "string" ? EDL_PATH_BALANCE.trim() : "";
      case "latestBill": return typeof EDL_PATH_LATEST_BILL === "string" ? EDL_PATH_LATEST_BILL.trim() : "";
      case "billHistory": return typeof EDL_PATH_BILL_HISTORY === "string" ? EDL_PATH_BILL_HISTORY.trim() : "";
      case "usage": return typeof EDL_PATH_USAGE === "string" ? EDL_PATH_USAGE.trim() : "";
      case "paymentHistory": return typeof EDL_PATH_PAYMENT_HISTORY === "string" ? EDL_PATH_PAYMENT_HISTORY.trim() : "";
      case "outages": return typeof EDL_PATH_OUTAGES === "string" ? EDL_PATH_OUTAGES.trim() : "";
      default: return "";
    }
  } catch { return ""; }
}
function validAccountNumber(v) {
  return typeof v === "string" && /^\d{8,12}$/.test(v);
}
function renderPath(template, args = {}) {
  if (!template) return "";
  if (!template.startsWith("/") || template.includes("://")) throw new Error("Configured path must be a relative EDLCare path");
  return template.replace(/\{(accountNumber|from|to|limit)\}/g, (_, key) => {
    const value = args[key];
    if (value === undefined || value === null || value === "") throw new Error("Missing required parameter: " + key);
    return encodeURIComponent(String(value));
  });
}
async function edlGet(path) {
  const cookie = getEdlCookie();
  if (!cookie) return { configured: false, ok: false, status: 503, data: { error: "EDL cookie secrets are not configured" } };
  const url = new URL(path, BASE);
  if (url.origin !== new URL(BASE).origin) {
    return { configured: true, ok: false, status: 400, data: { error: "Cross-origin EDLCare request blocked" } };
  }
  let r;
  try {
    r = await fetch(url.toString(), {
      method: "GET",
      headers: { accept: "application/json, text/plain, */*", cookie, "user-agent": "edlcare-mcp/0.3.2" },
      redirect: "manual"
    });
  } catch (e) {
    return { configured: true, ok: false, status: 502, data: { error: String(e) } };
  }
  const body = await r.text();
  let data;
  try { data = JSON.parse(body); } catch { data = { raw: body.slice(0, 100000) }; }
  return { configured: true, ok: r.ok, status: r.status, url: url.pathname + url.search, data };
}
async function fetchConfigured(key, args = {}) {
  const template = configuredPath(key);
  if (!template) {
    return {
      configured: false,
      ok: false,
      status: 503,
      data: {
        error: "EDLCare endpoint not configured",
        binding: {
          accounts: "EDL_PATH_ACCOUNTS",
          balance: "EDL_PATH_BALANCE",
          latestBill: "EDL_PATH_LATEST_BILL",
          billHistory: "EDL_PATH_BILL_HISTORY",
          usage: "EDL_PATH_USAGE",
          paymentHistory: "EDL_PATH_PAYMENT_HISTORY",
          outages: "EDL_PATH_OUTAGES"
        }[key]
      }
    };
  }
  try { return await edlGet(renderPath(template, args)); }
  catch (e) { return { configured: true, ok: false, status: 400, data: { error: String(e) } }; }
}
async function fetchMe() { return edlGet("/api/auth/me"); }

async function discoverApiPaths() {
  const paths = new Set();
  let homeStatus = null;
  let scriptsScanned = 0;
  let bytesScanned = 0;
  const keywordHits = [];
  const scriptUrlsSeen = [];
  const maxScripts = 20;
  const maxBytes = 6 * 1024 * 1024;

  function collect(text) {
    if (!text) return;
    const lower = text.toLowerCase();
    const keywords = ["account", "bill", "billing", "consumption", "payment", "outage", "meter", "transaction"];
    for (const keyword of keywords) {
      let from = 0;
      let count = 0;
      while (count < 5) {
        const idx = lower.indexOf(keyword, from);
        if (idx < 0) break;
        const start = Math.max(0, idx - 140);
        const end = Math.min(text.length, idx + keyword.length + 220);
        const snippet = text.slice(start, end).replace(/\s+/g, " ");
        if (!keywordHits.some(h => h.snippet === snippet)) keywordHits.push({ keyword, snippet });
        from = idx + keyword.length;
        count++;
        if (keywordHits.length >= 40) break;
      }
      if (keywordHits.length >= 40) break;
    }
    const patterns = [
      /["'`](\/api\/[A-Za-z0-9_?&=./{}:$%+-]+)["'`]/g,
      /["'`](api\/[A-Za-z0-9_?&=./{}:$%+-]+)["'`]/g
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(text)) !== null) {
        let p = m[1];
        if (!p.startsWith("/")) p = "/" + p;
        if (p.length <= 300) paths.add(p);
        if (paths.size >= 200) return;
      }
    }
  }

  try {
    const home = await fetch(BASE + "/", {
      headers: { accept: "text/html,*/*", "user-agent": "edlcare-mcp/0.3.2" },
      redirect: "follow"
    });
    homeStatus = home.status;
    const html = await home.text();
    collect(html);

    const scriptUrls = [];
    const re = /<script[^>]+src=["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(html)) !== null && scriptUrls.length < maxScripts) {
      try {
        const u = new URL(m[1], BASE);
        if (u.origin === new URL(BASE).origin) {
          scriptUrls.push(u.toString());
          scriptUrlsSeen.push(u.pathname);
        }
      } catch {}
    }

    for (const u of scriptUrls) {
      if (bytesScanned >= maxBytes) break;
      try {
        const r = await fetch(u, {
          headers: { accept: "application/javascript,text/javascript,*/*", "user-agent": "edlcare-mcp/0.3.2" },
          redirect: "follow"
        });
        if (!r.ok) continue;
        const t = await r.text();
        bytesScanned += t.length;
        scriptsScanned++;
        collect(t);
      } catch {}
    }
  } catch (e) {
    return { ok: false, error: String(e), homeStatus, scriptsScanned, candidates: [], keywordHits, scriptUrls: scriptUrlsSeen };
  }

  return {
    ok: true,
    homeStatus,
    scriptsScanned,
    bytesScanned,
    scriptUrls: scriptUrlsSeen,
    candidates: Array.from(paths).sort(),
    keywordHits
  };
}

const tools = [
  { name: "edl_status", description: "Check MCP health, EDLCare reachability, session configuration, and endpoint configuration.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "edl_oidc_metadata", description: "Fetch public EDLCare OpenID Connect discovery metadata.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "edl_me", description: "Return the currently authenticated EDLCare user profile.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "edl_list_accounts", description: "List electricity accounts linked to the authenticated EDLCare user.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "edl_get_balance", description: "Get current balance/outstanding amount for an electricity account.", inputSchema: { type: "object", properties: { accountNumber: { type: "string", pattern: "^\\d{8,12}$" } }, required: ["accountNumber"], additionalProperties: false } },
  { name: "edl_get_latest_bill", description: "Get the latest bill for an electricity account.", inputSchema: { type: "object", properties: { accountNumber: { type: "string", pattern: "^\\d{8,12}$" } }, required: ["accountNumber"], additionalProperties: false } },
  { name: "edl_get_bill_history", description: "Get bill history for an electricity account.", inputSchema: { type: "object", properties: { accountNumber: { type: "string", pattern: "^\\d{8,12}$" }, from: { type: "string" }, to: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, required: ["accountNumber"], additionalProperties: false } },
  { name: "edl_get_usage", description: "Get electricity consumption history for an account.", inputSchema: { type: "object", properties: { accountNumber: { type: "string", pattern: "^\\d{8,12}$" }, from: { type: "string" }, to: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, required: ["accountNumber"], additionalProperties: false } },
  { name: "edl_get_payment_history", description: "Get payment history for an electricity account.", inputSchema: { type: "object", properties: { accountNumber: { type: "string", pattern: "^\\d{8,12}$" }, from: { type: "string" }, to: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, required: ["accountNumber"], additionalProperties: false } },
  { name: "edl_get_outages", description: "Get outage information. Account number is optional if the configured EDLCare route is global.", inputSchema: { type: "object", properties: { accountNumber: { type: "string", pattern: "^\\d{8,12}$" } }, additionalProperties: false } }
];

async function callTool(name, args) {
  if (name === "edl_status") {
    let upstream = { ok: false };
    try {
      const r = await fetch(OIDC, { headers: { accept: "application/json" } });
      upstream = { ok: r.ok, status: r.status };
    } catch (e) { upstream = { ok: false, error: String(e) }; }
    const session = await fetchMe();
    const discovery = await discoverApiPaths();
    return {
      ok: true,
      service: "edlcare-mcp",
      version: "0.3.2",
      mode: "read-only",
      edlCookieConfigured: Boolean(getEdlCookie()),
      upstream,
      session: {
        ok: session.ok,
        status: session.status,
        user: session.ok && session.data && typeof session.data === "object" ? {
          username: session.data.username ?? null,
          fullName: session.data.fullName ?? null,
          portalAccessAllowed: session.data.portalAccessAllowed ?? null
        } : null,
        error: session.ok ? null : session.data?.error ?? session.data?.raw ?? null
      },
      discovery,
      endpoints: {
        accounts: Boolean(configuredPath("accounts")),
        balance: Boolean(configuredPath("balance")),
        latestBill: Boolean(configuredPath("latestBill")),
        billHistory: Boolean(configuredPath("billHistory")),
        usage: Boolean(configuredPath("usage")),
        paymentHistory: Boolean(configuredPath("paymentHistory")),
        outages: Boolean(configuredPath("outages"))
      }
    };
  }
  if (name === "edl_oidc_metadata") {
    try {
      const r = await fetch(OIDC, { headers: { accept: "application/json" } });
      const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = { raw: t }; }
      return { ok: r.ok, status: r.status, data };
    } catch (e) { return { ok: false, status: 502, data: { error: String(e) } }; }
  }
  if (name === "edl_me") return fetchMe();
  if (name === "edl_list_accounts") return fetchConfigured("accounts", args);
  if (name === "edl_get_outages") {
    if (args.accountNumber && !validAccountNumber(args.accountNumber)) return { ok: false, status: 400, data: { error: "Invalid account number" } };
    return fetchConfigured("outages", args);
  }
  if (!validAccountNumber(args.accountNumber)) return { ok: false, status: 400, data: { error: "Invalid account number" } };
  if (name === "edl_get_balance") return fetchConfigured("balance", args);
  if (name === "edl_get_latest_bill") return fetchConfigured("latestBill", args);
  if (name === "edl_get_bill_history") return fetchConfigured("billHistory", args);
  if (name === "edl_get_usage") return fetchConfigured("usage", args);
  if (name === "edl_get_payment_history") return fetchConfigured("paymentHistory", args);
  return { ok: false, status: 404, data: { error: "Unknown tool" } };
}

async function handleMcp(req) {
  if (req.method === "GET") return json({ name: "edlcare-mcp", version: "0.3.2", transport: "streamable-http", endpoint: "/mcp" });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body; try { body = await req.json(); } catch { return rpcError(null, -32700, "Parse error"); }
  const id = body.id ?? null;
  if (body.method === "initialize") return rpc(id, { protocolVersion: body?.params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "edlcare-mcp", version: "0.3.2" } });
  if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
  if (body.method === "ping") return rpc(id, {});
  if (body.method === "tools/list") return rpc(id, { tools });
  if (body.method === "tools/call") {
    const name = body?.params?.name;
    const args = body?.params?.arguments || {};
    const result = await callTool(name, args);
    return textResult(id, result, result.ok === false);
  }
  return rpcError(id, -32601, "Method not found");
}

addEventListener("fetch", event => event.respondWith((async () => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, authorization, mcp-session-id",
    "access-control-allow-methods": "GET, POST, OPTIONS"
  }});
  if (url.pathname === "/mcp") return handleMcp(req);
  if (url.pathname === "/test/me") {
    const result = await fetchMe();
    return json(result, result.ok ? 200 : result.status);
  }
  if (url.pathname === "/" || url.pathname === "/health") {
    const status = await callTool("edl_status", {});
    return json(status);
  }
  return json({ error: "Not found" }, 404);
})()));
