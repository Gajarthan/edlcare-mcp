import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { config } from './config.js';
import { buildServer } from './server.js';

const app = createMcpExpressApp({
  host: config.host,
  allowedHosts: config.allowedHosts,
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'edlcare-mcp', version: '0.1.0' });
});

const handler = createMcpHandler(buildServer);
const nodeHandler = toNodeHandler(handler, {
  onerror(error) {
    console.error('[mcp]', error);
  },
});

app.all('/mcp', (req, res, next) => {
  if (config.mcpBearerToken) {
    const authorization = req.headers.authorization || '';
    const expected = `Bearer ${config.mcpBearerToken}`;
    if (authorization !== expected) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
  }
  next();
});

app.all('/mcp', (req, res) => void nodeHandler(req, res, req.body));

const httpServer = app.listen(config.port, config.host, () => {
  console.error(`EDLCare MCP listening on http://${config.host}:${config.port}/mcp`);
  if (!config.mcpBearerToken) {
    console.error('WARNING: MCP_BEARER_TOKEN is empty. Do not expose this service publicly without authentication.');
  }
});

async function shutdown(signal) {
  console.error(`${signal}: shutting down`);
  httpServer.close(async () => {
    await handler.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
