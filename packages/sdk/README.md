# hyperflow-sdk

SDK TypeScript para los agentes de IA de HyperFlow. Habla MCP (Streamable HTTP)
contra el servidor nativo de HyperFlow, con progreso y task pattern resueltos de
forma transparente.

```bash
npm install hyperflow-sdk
```

```ts
import HyperFlow from 'hyperflow-sdk';

const hf = new HyperFlow({
  url: 'https://<host>/mcp',
  apiKey: process.env.HYPERFLOW_API_KEY!, // key de workspace (hf_...)
});

// Catálogo de agentes del workspace
const agents = await hf.agents.list();

// Corrida corta (síncrona, con progreso)
const icp = await hf.agents.run('icp', 'Construye el ICP para mi SaaS B2B');
console.log(icp.output);

// Corrida larga (task pattern; el SDK hace polling por ti)
const audit = await hf.agents.run('google_ads_audit', 'Audita la cuenta', {
  background: true,
  onProgress: (p) => console.log(p.message),
});

// Búsqueda semántica en la base de conocimiento del workspace
const chunks = await hf.rag.search('política de devoluciones', 5);

await hf.close();
```

## API

- `hf.agents.list()` — manifiesto de agentes (slug, dominio, tools).
- `hf.agents.run(slug, brief, { background, onProgress, signal, pollIntervalMs })`
  — ejecuta cualquier agente; en background la promesa resuelve con el resultado
  final igualmente.
- `hf.agents.waitForTask(taskId)` — espera una tarea lanzada previamente.
- `hf.rag.search(query, topK)` — retrieval del RAG del workspace.
- `hf.tools.list()` / `hf.tools.call(name, args)` — acceso crudo a las tools MCP.

Las API keys se crean desde HyperFlow (Settings → MCP) y quedan acotadas a un
workspace con scopes (`agents:run`, `rag:read`, ...).

Para conectar clientes MCP stdio (Claude Desktop), ver el paquete
[`hyperflow-mcp`](https://www.npmjs.com/package/hyperflow-mcp).
