/**
 * Pruebas del Copiloto del inbox (`src/services/ai/copilot.ts`):
 * parseo robusto de la salida del modelo, scope multi-tenant (404 si la
 * conversación no es del negocio), armado del transcript (Cliente/Negocio) y
 * uso del motor de IA del negocio. Se mockea Prisma, el motor y la identidad.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    conversation: { findFirst: vi.fn() },
    message: { findMany: vi.fn() },
    business: { findUnique: vi.fn() },
  },
}));

vi.mock('../../services/ai/engine', () => ({
  getAIProviderForBusiness: vi.fn(),
}));

vi.mock('../../services/ai/system-prompt', () => ({
  loadSystemPrompt: vi.fn(async () => ''),
}));

vi.mock('../../services/brand/config', () => ({
  loadBrandVoice: vi.fn(async () => ({})),
  buildBrandVoicePrompt: vi.fn(() => ''),
}));

import { prisma } from '../../lib/prisma';
import { getAIProviderForBusiness } from '../../services/ai/engine';
import { generateCopilot, parseCopilot } from '../../services/ai/copilot';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

describe('services/ai/copilot', () => {
  describe('parseCopilot', () => {
    it('parte la salida en resumen + sugerencia por los marcadores', () => {
      const raw = 'RESUMEN:\nEl cliente quiere un turno.\n\nSUGERENCIA:\n¿Mañana o tarde?';
      expect(parseCopilot(raw)).toEqual({
        summary: 'El cliente quiere un turno.',
        suggestedReply: '¿Mañana o tarde?',
      });
    });

    it('degrada sin romper: si no respeta el formato, todo va al resumen', () => {
      const raw = 'El cliente quiere un turno para el sábado.';
      expect(parseCopilot(raw)).toEqual({
        summary: 'El cliente quiere un turno para el sábado.',
        suggestedReply: '',
      });
    });

    it('tolera entrada vacía / nula', () => {
      expect(parseCopilot('')).toEqual({ summary: '', suggestedReply: '' });
      expect(parseCopilot(undefined as unknown as string)).toEqual({ summary: '', suggestedReply: '' });
    });
  });

  describe('generateCopilot', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mock(prisma.business.findUnique).mockResolvedValue({ name: 'Pelu Luca' });
    });

    it('devuelve null si la conversación no es del negocio (multi-tenant)', async () => {
      mock(prisma.conversation.findFirst).mockResolvedValue(null);

      const result = await generateCopilot('biz_1', 'c_otro');

      expect(result).toBeNull();
      expect(getAIProviderForBusiness).not.toHaveBeenCalled();
    });

    it('arma el transcript (Cliente/Negocio) y devuelve el resultado parseado', async () => {
      mock(prisma.conversation.findFirst).mockResolvedValue({ id: 'c1', contactName: 'Ana' });
      mock(prisma.message.findMany).mockResolvedValue([
        // Vienen en orden desc (más nuevo primero); el servicio los invierte a
        // cronológico: primero el saludo del Negocio, luego el pedido del Cliente.
        { role: 'USER', text: 'Quiero un turno.' },
        { role: 'BOT', text: '¡Hola! ¿En qué te ayudo?' },
      ]);
      const generateResponse = vi.fn(async () => 'RESUMEN:\nQuiere turno.\n\nSUGERENCIA:\nClaro, ¿qué día?');
      mock(getAIProviderForBusiness).mockResolvedValue({ name: 'anthropic', generateResponse });

      const result = await generateCopilot('biz_1', 'c1');

      expect(result).toEqual({ summary: 'Quiere turno.', suggestedReply: 'Claro, ¿qué día?' });
      // El transcript (primer argumento) etiqueta por rol y respeta el orden cronológico.
      const calls = generateResponse.mock.calls as unknown as unknown[][];
      const instruction = calls[0][0] as string;
      expect(instruction).toContain('Negocio: ¡Hola! ¿En qué te ayudo?');
      expect(instruction).toContain('Cliente: Quiero un turno.');
      expect(instruction.indexOf('Cliente: Quiero un turno.')).toBeGreaterThan(
        instruction.indexOf('Negocio: ¡Hola! ¿En qué te ayudo?'),
      );
      // Historial vacío: la charla va como texto en un único turno de usuario.
      const context = calls[0][1] as { history: unknown[] };
      expect(context.history).toEqual([]);
    });
  });
});
