/**
 * @hyperflow/sdk — cliente TypeScript de los agentes de HyperFlow.
 *
 * Habla MCP (Streamable HTTP) contra el servidor nativo de hyperflow-llm:
 * la misma superficie uniforme que usan Claude/Cursor, con progreso y task
 * pattern resueltos de forma transparente.
 *
 * ```ts
 * const hf = new HyperFlow({ url: "https://<railway-host>/mcp", apiKey: "hf_..." });
 * const agents = await hf.agents.list();
 * const result = await hf.agents.run("google_ads_audit", "Audita mi cuenta", {
 *   onProgress: (p) => console.log(p.message),
 * });
 * ```
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { ChatSession, type ChatStartOptions } from './chat.js';

export { ChatSession } from './chat.js';
export type { AgentRef, ChatSendOptions, ChatStartOptions, ChatTurn } from './chat.js';

export interface HyperFlowOptions {
  /** URL del MCP nativo, p. ej. https://<host>/mcp */
  url: string;
  /** API key de workspace (hf_...) o JWT de Supabase. */
  apiKey: string;
  /** Timeout por request en ms (default 15 min; los agentes son lentos). */
  requestTimeoutMs?: number;
}

export interface ProgressUpdate {
  progress: number;
  total?: number;
  message?: string;
}

export interface RunAgentOptions {
  /** true → task pattern (no bloquea; el SDK hace polling por ti). */
  background?: boolean;
  /** Progreso de la corrida (heartbeat del server). */
  onProgress?: (update: ProgressUpdate) => void;
  /** Cancela la espera (no la corrida remota en modo background). */
  signal?: AbortSignal;
  /** Intervalo de polling para tareas background (default 3000 ms). */
  pollIntervalMs?: number;
}

export interface AgentInfo {
  slug: string;
  name: string;
  domain: string;
  tools: string[];
}

export interface AgentRunResult {
  output?: string;
  steps?: Array<{ tool: string; input: string }>;
  taskId?: string;
  status?: string;
  raw: unknown;
}

export interface KnowledgeResult {
  content: string;
  similarity: number;
  document_id: string | null;
  chunk_index: number;
}

interface ToolCallOutcome {
  structured: unknown;
  text: string;
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

export class HyperFlow {
  private readonly options: HyperFlowOptions;
  private clientPromise: Promise<Client> | null = null;

  constructor(options: HyperFlowOptions) {
    this.options = options;
  }

  private async client(): Promise<Client> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const transport = new StreamableHTTPClientTransport(new URL(this.options.url), {
          requestInit: {
            headers: { Authorization: `Bearer ${this.options.apiKey}` },
          },
        });
        const client = new Client({ name: 'hyperflow-sdk', version: '0.1.1' });
        await client.connect(transport);
        return client;
      })();
      this.clientPromise.catch(() => {
        this.clientPromise = null; // permite reintentar tras un fallo de conexión
      });
    }
    return this.clientPromise;
  }

  private async callTool(
    name: string,
    args: Record<string, unknown>,
    opts: { onProgress?: (u: ProgressUpdate) => void; signal?: AbortSignal } = {},
  ): Promise<ToolCallOutcome> {
    const client = await this.client();
    const result = await client.callTool({ name, arguments: args }, undefined, {
      timeout: this.options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      resetTimeoutOnProgress: true,
      signal: opts.signal,
      onprogress: opts.onProgress
        ? (p) => opts.onProgress!({ progress: p.progress, total: p.total, message: p.message })
        : undefined,
    });

    const content = Array.isArray(result.content) ? result.content : [];
    const text = content
      .filter((c): c is { type: 'text'; text: string } => c?.type === 'text')
      .map((c) => c.text)
      .join('\n');

    if (result.isError) {
      throw new Error(`Tool ${name} falló: ${text || 'error desconocido'}`);
    }

    let structured: unknown = (result as { structuredContent?: unknown }).structuredContent;
    if (structured === undefined && text) {
      try {
        structured = JSON.parse(text);
      } catch {
        structured = undefined;
      }
    }
    return { structured, text };
  }

  /** Cierra la sesión MCP subyacente. */
  async close(): Promise<void> {
    if (this.clientPromise) {
      const client = await this.clientPromise;
      await client.close();
      this.clientPromise = null;
    }
  }

  readonly agents = {
    /** Manifiesto de agentes disponibles en el workspace. */
    list: async (): Promise<AgentInfo[]> => {
      const { structured } = await this.callTool('list_agents', {});
      return unwrapList(structured) as AgentInfo[];
    },

    /**
     * Ejecuta un agente por slug. En modo background el SDK lanza la tarea y
     * hace polling de get_task_result hasta que termina — la promesa siempre
     * resuelve con el resultado final.
     */
    run: async (
      slug: string,
      message: string,
      opts: RunAgentOptions = {},
    ): Promise<AgentRunResult> => {
      const { structured } = await this.callTool(
        'run_agent',
        { agent: slug, message, background: opts.background ?? false },
        { onProgress: opts.onProgress, signal: opts.signal },
      );
      const payload = (structured ?? {}) as Record<string, unknown>;

      if (typeof payload.task_id === 'string' && payload.status === 'running') {
        return this.agents.waitForTask(payload.task_id, opts);
      }
      return toRunResult(payload);
    },

    /** Espera una tarea background hasta su resultado final. */
    waitForTask: async (
      taskId: string,
      opts: Pick<RunAgentOptions, 'onProgress' | 'signal' | 'pollIntervalMs'> = {},
    ): Promise<AgentRunResult> => {
      const interval = opts.pollIntervalMs ?? 3000;
      for (;;) {
        opts.signal?.throwIfAborted();
        const { structured } = await this.callTool('get_task_result', { task_id: taskId });
        const payload = (structured ?? {}) as Record<string, unknown>;
        const status = String(payload.status ?? 'running');
        if (status !== 'running') {
          if (status === 'failed') {
            throw new Error(`Tarea ${taskId} falló: ${String(payload.error ?? 'sin detalle')}`);
          }
          const result = (payload.result ?? {}) as Record<string, unknown>;
          return { ...toRunResult(result), taskId, status };
        }
        opts.onProgress?.({ progress: 0, message: `Tarea ${taskId} en ejecución` });
        await sleep(interval, opts.signal);
      }
    },
  };

  readonly chat = {
    /**
     * Abre una sesión de chat con un agente publicado (Russell/Odin).
     * El server fija la versión del agente al primer turno y la sesión
     * la conserva aunque se publique una versión nueva.
     */
    start: (options: ChatStartOptions): ChatSession => new ChatSession(this, options),
  };

  readonly rag = {
    /** Búsqueda semántica en la base de conocimiento del workspace. */
    search: async (query: string, topK = 5): Promise<KnowledgeResult[]> => {
      const { structured } = await this.callTool('search_knowledge_base', {
        query,
        top_k: topK,
      });
      return unwrapList(structured) as KnowledgeResult[];
    },
  };

  readonly tools = {
    /** Lista cruda de tools MCP anunciadas por el server. */
    list: async () => {
      const client = await this.client();
      const res = await client.listTools();
      return res.tools;
    },
    /** Escape hatch: invoca cualquier tool MCP por nombre. */
    call: async (
      name: string,
      args: Record<string, unknown> = {},
      opts: { onProgress?: (u: ProgressUpdate) => void; signal?: AbortSignal } = {},
    ): Promise<unknown> => {
      const { structured, text } = await this.callTool(name, args, opts);
      return structured ?? text;
    },
  };
}

function toRunResult(payload: Record<string, unknown>): AgentRunResult {
  return {
    output: typeof payload.output === 'string' ? payload.output : undefined,
    steps: Array.isArray(payload.steps)
      ? (payload.steps as AgentRunResult['steps'])
      : undefined,
    taskId: typeof payload.task_id === 'string' ? payload.task_id : undefined,
    status: typeof payload.status === 'string' ? payload.status : undefined,
    raw: payload,
  };
}

/** FastMCP envuelve listas como { result: [...] } en structuredContent. */
function unwrapList(structured: unknown): unknown[] {
  if (Array.isArray(structured)) return structured;
  if (structured && typeof structured === 'object') {
    const inner = (structured as Record<string, unknown>).result;
    if (Array.isArray(inner)) return inner;
  }
  return [];
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error('aborted'));
      },
      { once: true },
    );
  });
}

export default HyperFlow;
