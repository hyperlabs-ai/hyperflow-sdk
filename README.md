# hyperflow-sdk

SDK y bridge MCP para consumir los agentes de HyperFlow desde cualquier app o cliente MCP.

| Paquete | Qué es |
|---|---|
| `hyperflow-sdk` | Cliente TypeScript tipado: `hf.agents.run(slug, brief, { onProgress })` con progreso y task pattern transparentes. Habla MCP (Streamable HTTP) contra `hyperflow-llm /mcp`. |
| `hyperflow-mcp` | Bridge stdio→remoto para clientes sin soporte de HTTP remoto (Claude Desktop): `npx hyperflow-mcp --url https://<host>/mcp --key hf_...` |

## Requisitos

- Una API key de workspace (`hf_...`), creada desde HyperFlow Mind → Settings → MCP
  (o `POST /v1/mcp/keys` con JWT de owner/admin).
- Node 20+.

## Uso del SDK

```ts
import HyperFlow from 'hyperflow-sdk';

const hf = new HyperFlow({
  url: 'https://<railway-host>/mcp',
  apiKey: process.env.HYPERFLOW_API_KEY!,
});

// Catálogo de agentes del workspace
const agents = await hf.agents.list();

// Corrida corta (síncrona, con heartbeat de progreso)
const icp = await hf.agents.run('icp', 'Construye el ICP para mi SaaS B2B');

// Corrida larga (task pattern; el SDK hace polling por ti)
const audit = await hf.agents.run('google_ads_audit', 'Audita la cuenta', {
  background: true,
  onProgress: (p) => console.log(p.message),
});

// Búsqueda en la base de conocimiento (RAG)
const chunks = await hf.rag.search('política de devoluciones', 5);

await hf.close();
```

## Claude Desktop (stdio)

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

Claude web/Cursor soportan el conector remoto directo: URL `https://<host>/mcp`
con header `Authorization: Bearer hf_...` — el bridge solo hace falta para stdio.

## Desarrollo

```bash
npm install
npm run build        # compila ambos paquetes
```

Publicación: `npm publish --access public` en cada paquete (pendiente de cuenta npm de la org).
