/**
 * Pruebas del Lead scoring (`src/services/ai/lead-score.ts`):
 * parseo robusto de la salida del modelo (temperatura/puntaje/motivo, con
 * clamp y derivación), scope multi-tenant (404 si la conversación no es del
 * negocio) y armado del transcript (Cliente/Negocio) usando el motor del negocio.
 * Se mockea Prisma, el motor y el prompt de sistema.
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

import { prisma } from '../../lib/prisma';
import { getAIProviderForBusiness } from '../../services/ai/engine';
import { generateLeadScore, parseLeadScore } from '../../services/ai/lead-score';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

describe('services/ai/lead-score', () => {
  describe('parseLeadScore', () => {
    it('parsea temperatura + puntaje + motivo por los marcadores', () => {
      const raw = 'TEMPERATURA: CALIENTE\nPUNTAJE: 85\nMOTIVO: Pidió precio y disponibilidad para el sábado.';
      expect(parseLeadScore(raw)).toEqual({
        temperature: 'CALIENTE',
        score: 85,
        reason: 'Pidió precio y disponibilidad para el sábado.',
      });
    });

    it('clampa el puntaje a 0-100 y deriva la temperatura si no vino', () => {
      const raw = 'PUNTAJE: 150\nMOTIVO: Quiere pagar ya.';
      expect(parseLeadScore(raw)).toEqual({
        temperature: 'CALIENTE', // derivada del puntaje (100)
        score: 100,
        reason: 'Quiere pagar ya.',
      });
    });

    it('tolera "FRÍO" con acento', () => {
      const raw = 'TEMPERATURA: FRÍO\nPUNTAJE: 10\nMOTIVO: Solo curiosea.';
      expect(parseLeadScore(raw).temperature).toBe('FRIO');
    });

    it('degrada sin romper: sin formato, puntaje 0, FRÍO y el texto como motivo', () => {
      const raw = 'No parece interesado, solo pregunta cosas sueltas.';
      expect(parseLeadScore(raw)).toEqual({
        temperature: 'FRIO',
        score: 0,
        reason: 'No parece interesado, solo pregunta cosas sueltas.',
      });
    });

    it('tolera entrada vacía / nula', () => {
      expect(parseLeadScore('')).toEqual({ temperature: 'FRIO', score: 0, reason: '' });
      expect(parseLeadScore(undefined as unknown as string)).toEqual({ temperature: 'FRIO', score: 0, reason: '' });
    });
  });

  describe('generateLeadScore', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mock(prisma.business.findUnique).mockResolvedValue({ name: 'Pelu Luca' });
    });

    it('devuelve null si la conversación no es del negocio (multi-tenant)', async () => {
      mock(prisma.conversation.findFirst).mockResolvedValue(null);

      const result = await generateLeadScore('biz_1', 'c_otro');

      expect(result).toBeNull();
      expect(getAIProviderForBusiness).not.toHaveBeenCalled();
    });

    it('arma el transcript (Cliente/Negocio) y devuelve el score parseado con timestamp', async () => {
      mock(prisma.conversation.findFirst).mockResolvedValue({ id: 'c1', contactName: 'Ana' });
      mock(prisma.message.findMany).mockResolvedValue([
        // Orden desc (más nuevo primero); el servicio lo invierte a cronológico.
        { role: 'USER', text: 'Quiero reservar una mesa para el sábado.' },
        { role: 'BOT', text: '¡Hola! ¿Para cuántas personas?' },
      ]);
      const generateResponse = vi.fn(async () => 'TEMPERATURA: CALIENTE\nPUNTAJE: 90\nMOTIVO: Pide reservar con fecha concreta.');
      mock(getAIProviderForBusiness).mockResolvedValue({ name: 'anthropic', generateResponse });

      const result = await generateLeadScore('biz_1', 'c1');

      expect(result).toMatchObject({ temperature: 'CALIENTE', score: 90, reason: 'Pide reservar con fecha concreta.' });
      expect(typeof result?.at).toBe('string');
      expect(result?.at).toBeTruthy();

      // El transcript (primer argumento) etiqueta por rol y respeta el orden cronológico.
      const calls = generateResponse.mock.calls as unknown as unknown[][];
      const instruction = calls[0][0] as string;
      expect(instruction).toContain('Negocio: ¡Hola! ¿Para cuántas personas?');
      expect(instruction).toContain('Cliente: Quiero reservar una mesa para el sábado.');
      expect(instruction.indexOf('Cliente: Quiero reservar una mesa para el sábado.')).toBeGreaterThan(
        instruction.indexOf('Negocio: ¡Hola! ¿Para cuántas personas?'),
      );
      // Historial vacío: la charla va como texto en un único turno de usuario.
      const context = calls[0][1] as { history: unknown[] };
      expect(context.history).toEqual([]);
    });
  });
});
