import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { buildServer } from './server.js';

void serveStdio(buildServer);
console.error('EDLCare MCP server running on stdio');
