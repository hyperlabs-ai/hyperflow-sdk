# hyperflow-mcp

Bridge stdio → Streamable HTTP para el servidor MCP de HyperFlow. Para clientes
MCP que solo hablan stdio (Claude Desktop y algunos IDEs).

```bash
npx hyperflow-mcp --url https://<host>/mcp --key hf_...
```

También lee `HYPERFLOW_MCP_URL` y `HYPERFLOW_API_KEY` del entorno.

## Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hyperflow": {
      "command": "npx",
      "args": ["-y", "hyperflow-mcp", "--url", "https://<host>/mcp", "--key", "hf_..."]
    }
  }
}
```

Claude web y Cursor soportan el conector remoto directo (URL `https://<host>/mcp`
con `Authorization: Bearer hf_...`) — este bridge solo hace falta para stdio.

Reenvía tools, prompts y resources 1:1; no contiene lógica propia. Para uso
programático desde TypeScript, ver
[`hyperflow-sdk`](https://www.npmjs.com/package/hyperflow-sdk).
