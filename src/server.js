import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { config } from './config.js';
import { edl, getOidcMetadata } from './edl-client.js';

const accountNumber = z
  .string()
  .regex(/^\d{8,12}$/, 'Account number must contain 8 to 12 digits.');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

function ok(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: { result: data },
  };
}

function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

export function buildServer() {
  const server = new McpServer({
    name: 'edlcare-sri-lanka',
    version: '0.1.0',
  });

  server.registerTool(
    'edl_status',
    {
      title: 'EDLCare MCP status',
      description: 'Show safe configuration status without exposing credentials.',
      inputSchema: z.object({}),
    },
    async () =>
      ok({
        apiBaseUrl: config.apiBaseUrl,
        authMode: config.authMode,
        oidcDiscoveryUrl: config.oidcDiscoveryUrl,
        configuredEndpoints: Object.fromEntries(
          Object.entries(config.paths).map(([key, value]) => [key, Boolean(value)]),
        ),
        rawGetEnabled: config.enableRawGet,
      }),
  );

  server.registerTool(
    'edl_oidc_metadata',
    {
      title: 'EDLCare OIDC metadata',
      description: 'Fetch the public EDLCare OpenID Connect discovery document.',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return ok(await getOidcMetadata());
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'edl_list_accounts',
    {
      title: 'List electricity accounts',
      description: 'List electricity accounts visible to the authorized EDLCare identity.',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return ok(await edl.listAccounts());
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'edl_get_balance',
    {
      title: 'Get electricity account balance',
      description: 'Get the current balance for one authorized electricity account.',
      inputSchema: z.object({ accountNumber }),
    },
    async ({ accountNumber }) => {
      try {
        return ok(await edl.getBalance(accountNumber));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'edl_get_bill_history',
    {
      title: 'Get bill history',
      description: 'Get recent billing history for an authorized electricity account.',
      inputSchema: z.object({
        accountNumber,
        limit: z.number().int().min(1).max(100).default(24),
      }),
    },
    async ({ accountNumber, limit }) => {
      try {
        return ok(await edl.getBillHistory(accountNumber, limit));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'edl_get_usage',
    {
      title: 'Get electricity usage',
      description: 'Get consumption/usage data for an authorized electricity account.',
      inputSchema: z.object({
        accountNumber,
        from: isoDate.optional(),
        to: isoDate.optional(),
      }),
    },
    async ({ accountNumber, from, to }) => {
      try {
        return ok(await edl.getUsage(accountNumber, from, to));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'edl_get_outages',
    {
      title: 'Get outages',
      description: 'Get configured EDLCare outage/interruption information.',
      inputSchema: z.object({
        accountNumber: accountNumber.optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
      }),
    },
    async ({ accountNumber, from, to }) => {
      try {
        return ok(await edl.getOutages(accountNumber, from, to));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'edl_get_payment_history',
    {
      title: 'Get payment history',
      description: 'Get recent payment records for an authorized electricity account.',
      inputSchema: z.object({
        accountNumber,
        limit: z.number().int().min(1).max(100).default(24),
      }),
    },
    async ({ accountNumber, limit }) => {
      try {
        return ok(await edl.getPaymentHistory(accountNumber, limit));
      } catch (error) {
        return fail(error);
      }
    },
  );

  if (config.enableRawGet) {
    server.registerTool(
      'edl_raw_get',
      {
        title: 'EDLCare raw read-only GET',
        description:
          'Advanced debugging tool. Performs a GET only against EDL_API_BASE_URL. Disabled by default.',
        inputSchema: z.object({
          path: z.string().min(1),
          query: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
        }),
      },
      async ({ path, query }) => {
        try {
          return ok(await edl.rawGet(path, query));
        } catch (error) {
          return fail(error);
        }
      },
    );
  }

  return server;
}
