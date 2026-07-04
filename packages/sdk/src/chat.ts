/**
 * Chat conversacional con agentes Russell/Odin via MCP.
 *
 * `hf.chat.start({ agent: { slug: "dory", version: 3 } })` abre una sesión;
 * el server fija la versión del agente al primer turno (consistencia a mitad
 * de conversación aunque se publique una versión nueva) y devuelve el
 * `session_id`, que el SDK reutiliza en los turnos siguientes.
 */

import type { HyperFlow, ProgressUpdate } from './index.js';

/** Referencia a un agente publicado. Sin `version` → última publicada. */
export interface AgentRef {
  slug: string;
  version?: number;
}

export interface ChatStartOptions {
  agent: AgentRef;
  /** Contacto del CRM al que se asocia la conversación (opcional). */
  contactId?: string;
  /** Reanuda una sesión existente en lugar de crear una nueva. */
  sessionId?: string;
}

export interface ChatSendOptions {
  onProgress?: (update: ProgressUpdate) => void;
  signal?: AbortSignal;
}

export interface ChatTurn {
  /** Respuesta del agente para el cliente. */
  reply: string;
  sessionId?: string;
  intent?: string;
  confianza?: number;
  /** Pregunta que el agente dejó pendiente (intake incompleto). */
  pendingQuestion?: string;
  /** Payload crudo del turno (nodes, progress, commit, trace_ids…). */
  raw: unknown;
}

export class ChatSession {
  readonly agent: AgentRef;
  sessionId?: string;
  private readonly contactId?: string;

  constructor(
    private readonly hf: HyperFlow,
    options: ChatStartOptions,
  ) {
    this.agent = options.agent;
    this.sessionId = options.sessionId;
    this.contactId = options.contactId;
  }

  /** Envía un turno y devuelve la respuesta del agente. */
  async send(message: string, opts: ChatSendOptions = {}): Promise<ChatTurn> {
    const payload = (await this.hf.tools.call(
      'converse_agent',
      {
        agent: this.agent.slug,
        ...(this.agent.version !== undefined ? { version: this.agent.version } : {}),
        message,
        ...(this.sessionId ? { session_id: this.sessionId } : {}),
        ...(this.contactId ? { contact_id: this.contactId } : {}),
      },
      opts,
    )) as Record<string, unknown>;

    if (typeof payload?.session_id === 'string') {
      this.sessionId = payload.session_id;
    }
    return {
      reply: typeof payload?.respuesta === 'string' ? payload.respuesta : '',
      sessionId: this.sessionId,
      intent: typeof payload?.intent === 'string' ? payload.intent : undefined,
      confianza: typeof payload?.confianza === 'number' ? payload.confianza : undefined,
      pendingQuestion:
        typeof payload?.pregunta_pendiente === 'string' ? payload.pregunta_pendiente : undefined,
      raw: payload,
    };
  }
}
