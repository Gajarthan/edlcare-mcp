const OIDC = "https://edlcare.edl.lk/.well-known/openid-configuration";
const ME = "https://edlcare.edl.lk/api/auth/me";

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization, mcp-session-id",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      ...extra,
    },
  });
}

function rpc(id, result) {
  return json({ jsonrpc: "2.0", id, result });
}

function rpcError(id, code, message, data) {
  return json({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } });
}

function getEdlCookie() {
  try {
    if (typeof EDL_COOKIE === "string" && EDL_COOKIE.trim()) return EDL_COOKIE.trim();
  } catch {}
  return "";
}

async function fetchMe() {
  const cookie = getEdlCookie();
  if (!cookie) {
    return { configured: false, ok: false, status: 503, data: { error: "EDL_COOKIE secret is not configured" } };
  }

  const r = await fetch(ME, {
    method: "GET",
    headers: {
      accept: "application/json",
      cookie,
      "user-agent": "edlcare-mcp/0.2.0",
    },
    redirect: "manual",
  });

  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 2000) };
  }

  return { configured: true, ok: r.ok, status: r.status, data };
}

async function handleMcp(req) {
  if (req.method === "GET") {
    return json({
      name: "edlcare-mcp",
      description: "Read-only MCP server for EDLCare / CEB Sri Lanka",
      transport: "streamable-http",
      endpoint: "/mcp",
    });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  const id = body.id ?? null;
  const method = body.method;

  if (method === "initialize") {
    return rpc(id, {
      protocolVersion: body?.params?.protocolVersion || "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "edlcare-mcp", version: "0.2.0" },
    });
  }

  if (method === "notifications/initialized") return new Response(null, { status: 202 });
  if (method === "ping") return rpc(id, {});

  if (method === "tools/list") {
    return rpc(id, {
      tools: [
        {
          name: "edl_status",
          description: "Check EDLCare MCP, upstream identity endpoint, and whether EDLCare session auth is configured.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
        },
        {
          name: "edl_oidc_metadata",
          description: "Fetch the public EDLCare OpenID Connect discovery metadata.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
        },
        {
          name: "edl_me",
          description: "Return the currently authenticated EDLCare profile using the server-side EDL_COOKIE secret.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
        },
      ],
    });
  }

  if (method === "tools/call") {
    const name = body?.params?.name;

    if (name === "edl_status") {
      let upstream = { ok: false };
      try {
        const r = await fetch(OIDC, { headers: { accept: "application/json" } });
        upstream = { ok: r.ok, status: r.status };
      } catch (e) {
        upstream = { ok: false, error: String(e) };
      }

      return rpc(id, {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                service: "edlcare-mcp",
                version: "0.2.0",
                mode: "read-only",
                edlCookieConfigured: Boolean(getEdlCookie()),
                upstream,
              },
              null,
              2,
            ),
          },
        ],
      });
    }

    if (name === "edl_oidc_metadata") {
      try {
        const r = await fetch(OIDC, { headers: { accept: "application/json" } });
        const text = await r.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text };
        }

        return rpc(id, {
          content: [{ type: "text", text: JSON.stringify({ status: r.status, data }, null, 2) }],
          isError: !r.ok,
        });
      } catch (e) {
        return rpc(id, {
          content: [{ type: "text", text: "EDLCare OIDC request failed: " + String(e) }],
          isError: true,
        });
      }
    }

    if (name === "edl_me") {
      const result = await fetchMe();
      return rpc(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      });
    }

    return rpcError(id, -32602, "Unknown tool");
  }

  return rpcError(id, -32601, "Method not found");
}

addEventListener("fetch", (event) => {
  event.respondWith(
    (async () => {
      const req = event.request;
      const url = new URL(req.url);

      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "content-type, authorization, mcp-session-id",
            "access-control-allow-methods": "GET, POST, OPTIONS",
          },
        });
      }

      if (url.pathname === "/mcp") return handleMcp(req);

      if (url.pathname === "/test/me") {
        const result = await fetchMe();
        return json(result, result.ok ? 200 : result.status);
      }

      if (url.pathname === "/" || url.pathname === "/health") {
        return json({
          ok: true,
          name: "edlcare-mcp",
          version: "0.2.0",
          mcp: "/mcp",
          testMe: "/test/me",
          edlCookieConfigured: Boolean(getEdlCookie()),
        });
      }

      return json({ error: "Not found" }, 404);
    })(),
  );
});
