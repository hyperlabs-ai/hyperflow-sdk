#!/usr/bin/env node
/**
 * @hyperflow/mcp — bridge stdio → Streamable HTTP.
 *
 * Para clientes MCP que solo hablan stdio (Claude Desktop, algunos IDEs):
 *
 *   npx @hyperflow/mcp --url https://<host>/mcp --key hf_...
 *
 * También lee HYPERFLOW_MCP_URL y HYPERFLOW_API_KEY del entorno.
 * Sin lógica de negocio: reenvía tools, prompts y resources 1:1.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const REQUEST_TIMEOUT_MS = 15 * 60 * 1000;

function parseArgs(): { url: string; key: string } {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    if (i >= 0 && argv[i + 1]) return argv[i + 1];
    const pref = argv.find((a: string) => a.startsWith(`${flag}=`));
    return pref ? pref.slice(flag.length + 1) : undefined;
  };
  const url = get('--url') ?? process.env.HYPERFLOW_MCP_URL;
  const key = get('--key') ?? process.env.HYPERFLOW_API_KEY;
  if (!url || !key) {
    console.error(
      'Uso: hyperflow-mcp --url https://<host>/mcp --key hf_...\n' +
        '(o variables HYPERFLOW_MCP_URL / HYPERFLOW_API_KEY)',
    );
    process.exit(1);
  }
  return { url, key };
}

async function main(): Promise<void> {
  const { url, key } = parseArgs();

  const remote = new Client({ name: 'hyperflow-mcp-bridge', version: '0.1.0' });
  await remote.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${key}` } },
    }),
  );

  const server = new Server(
    { name: 'hyperflow', version: '0.1.0' },
    { capabilities: { tools: {}, prompts: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => remote.listTools());

  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    remote.callTool(
      { name: req.params.name, arguments: req.params.arguments ?? {} },
      undefined,
      { timeout: REQUEST_TIMEOUT_MS, resetTimeoutOnProgress: true },
    ),
  );

  server.setRequestHandler(ListPromptsRequestSchema, async () => remote.listPrompts());
  server.setRequestHandler(GetPromptRequestSchema, async (req) =>
    remote.getPrompt({ name: req.params.name, arguments: req.params.arguments }),
  );

  server.setRequestHandler(ListResourcesRequestSchema, async () => remote.listResources());
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () =>
    remote.listResourceTemplates(),
  );
  server.setRequestHandler(ReadResourceRequestSchema, async (req) =>
    remote.readResource({ uri: req.params.uri }),
  );

  await server.connect(new StdioServerTransport());
  console.error(`[hyperflow-mcp] bridge conectado a ${url}`);
}

main().catch((err) => {
  console.error('[hyperflow-mcp] error fatal:', err);
  process.exit(1);
});
