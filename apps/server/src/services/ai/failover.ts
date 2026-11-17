/**
 * Respaldo (failover) entre proveedores de IA.
 *
 * `FailoverProvider` envuelve al proveedor del motor activo y, si falla (timeout,
 * 429, 5xx, red, key revocada), reintenta la MISMA generación con el siguiente
 * proveedor configurado.
 *
 * Por qué no duplica acciones en vivo: el contrato `AIProvider.generateResponse`
 * es texto-entra / texto-sale y no ejecuta nada. Las acciones de Mr Go y del bot
 * (reservas, confirmaciones, pedidos) se ejecutan DESPUÉS, una sola vez, a partir
 * de la respuesta que finalmente vuelve; si el primer proveedor falló no hay
 * respuesta que ejecutar. La idempotencia de las acciones en sí ya vive en las
 * rutas (`claimIdempotentKey` en /mrgo/run|orchestrate|confirm).
 *
 * Corte de circuito: tras un fallo, el proveedor caído se saltea durante
 * `DOWN_MS` para no pagar el timeout (hasta 30 s) en cada mensaje.
 *
 * `AI_FAILOVER=false` lo desactiva (engine.ts no arma el wrapper).
 */
import type { AIProvider, ConversationContext } from './provider';

export const DOWN_MS = 60_000;

export interface FallbackSlot {
  /** Etiqueta para logs (ej: "openai:gpt-4o-mini"). */
  label: string;
  /** Se arma recién si hace falta (evita instanciar clientes sin usarlos). */
  build: () => AIProvider;
}

export class FailoverProvider implements AIProvider {
  readonly name: string;
  private downUntil = new Map<string, number>();

  constructor(
    private readonly primary: AIProvider,
    private readonly primaryLabel: string,
    private readonly fallbacks: FallbackSlot[],
    private readonly now: () => number = Date.now,
  ) {
    this.name = primary.name;
  }

  private isDown(label: string): boolean {
    const until = this.downUntil.get(label);
    return until !== undefined && until > this.now();
  }

  private markDown(label: string): void {
    this.downUntil.set(label, this.now() + DOWN_MS);
  }

  async generateResponse(prompt: string, context: ConversationContext): Promise<string> {
    const chain: Array<{ label: string; get: () => AIProvider }> = [
      { label: this.primaryLabel, get: () => this.primary },
      ...this.fallbacks.map((f) => ({ label: f.label, get: f.build })),
    ];
    // Si TODOS están marcados caídos igual probamos el principal (mejor intentar
    // que quedar mudo: la marca es una heurística, no un hecho).
    const live = chain.filter((c) => !this.isDown(c.label));
    const order = live.length > 0 ? live : [chain[0]];

    let lastError: unknown;
    for (const candidate of order) {
      try {
        const provider = candidate.get();
        const text = await provider.generateResponse(prompt, context);
        return text;
      } catch (err) {
        lastError = err;
        this.markDown(candidate.label);
        console.error(`Proveedor de IA "${candidate.label}" falló, probando el siguiente:`, (err as Error).message);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Fallaron todos los proveedores de IA');
  }
}
