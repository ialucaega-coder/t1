/**
 * Pruebas de los superpoderes de análisis (`src/services/superpowers/analysis.ts`).
 *
 *  - analyzeConversation: arma el transcript (filtra SYSTEM), parsea el JSON del
 *    modelo (tolera fences) y cae a un resultado best-effort si no hay JSON.
 *  - detectKnowledgeGaps: heurística sin IA — detecta conversaciones en HANDOFF
 *    o donde el bot "no supo", extrae la pregunta representativa, la clasifica en
 *    un tema y agrupa/ordena por ocurrencias (con tope y dedup de ejemplos).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const generateResponse = vi.fn();

vi.mock('../../services/ai', () => ({
  getDefaultAIProvider: vi.fn(() => ({ generateResponse })),
}));

vi.mock('../../lib/prisma', () => ({
  prisma: {
    conversation: { findMany: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma';
import { analyzeConversation, detectKnowledgeGaps } from '../../services/superpowers/analysis';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

type Role = 'USER' | 'BOT' | 'SYSTEM';
const msg = (role: Role, text: string) => ({ role, text });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('services/superpowers/analysis', () => {
  describe('analyzeConversation', () => {
    it('parsea el JSON del modelo (tolera fences ```json)', async () => {
      generateResponse.mockResolvedValue(
        '```json\n{"intencion":"reservar","satisfaccion":"alta","objeciones":["precio"],"siguientePaso":"confirmar","resumen":"quiere turno"}\n```'
      );

      const result = await analyzeConversation('biz_1', [msg('USER', 'quiero un turno')]);

      expect(result).toEqual({
        intencion: 'reservar',
        satisfaccion: 'alta',
        objeciones: ['precio'],
        siguientePaso: 'confirmar',
        resumen: 'quiere turno',
      });
    });

    it('filtra los mensajes SYSTEM del transcript que se manda al modelo', async () => {
      generateResponse.mockResolvedValue('{"resumen":"ok"}');

      await analyzeConversation('biz_1', [
        msg('SYSTEM', 'system prompt interno'),
        msg('USER', 'hola'),
        msg('BOT', 'buenas'),
      ]);

      const [prompt] = generateResponse.mock.calls[0];
      expect(prompt).not.toContain('system prompt interno');
      expect(prompt).toContain('Cliente: hola');
      expect(prompt).toContain('Asistente: buenas');
    });

    it('normaliza objeciones tipo string a un array', async () => {
      generateResponse.mockResolvedValue('{"objeciones":"muy caro"}');
      const result = await analyzeConversation('biz_1', [msg('USER', 'x')]);
      expect(result.objeciones).toEqual(['muy caro']);
    });

    it('cae a best-effort cuando el modelo no devuelve JSON (usa el texto crudo como resumen)', async () => {
      generateResponse.mockResolvedValue('No pude analizar, lo siento.');
      const result = await analyzeConversation('biz_1', [msg('USER', 'x')]);
      expect(result.resumen).toBe('No pude analizar, lo siento.');
      expect(result.intencion).toBe('');
      expect(result.objeciones).toEqual([]);
    });
  });

  describe('detectKnowledgeGaps', () => {
    it('devuelve resumen "sin huecos" cuando no hay problemas', async () => {
      mock(prisma.conversation.findMany).mockResolvedValue([
        { status: 'ACTIVE', messages: [msg('USER', 'hola'), msg('BOT', 'buenas, ¿en qué ayudo?')] },
      ]);

      const result = await detectKnowledgeGaps('biz_1');

      expect(result.analizadas).toBe(1);
      expect(result.conHuecos).toBe(0);
      expect(result.gaps).toEqual([]);
      expect(result.resumen).toMatch(/No se detectaron huecos/);
    });

    it('detecta un "no sé" del bot y clasifica la pregunta previa por tema', async () => {
      mock(prisma.conversation.findMany).mockResolvedValue([
        {
          status: 'ACTIVE',
          messages: [
            msg('USER', '¿Cuánto cuesta el corte?'),
            msg('BOT', 'No tengo esa información en este momento.'),
          ],
        },
      ]);

      const result = await detectKnowledgeGaps('biz_1');

      expect(result.conHuecos).toBe(1);
      expect(result.gaps).toHaveLength(1);
      expect(result.gaps[0].tema).toBe('Precios y costos');
      expect(result.gaps[0].ocurrencias).toBe(1);
      expect(result.gaps[0].ejemplos).toEqual(['¿Cuánto cuesta el corte?']);
      expect(result.gaps[0].sugerencia).toMatch(/precios/i);
    });

    it('cuenta las conversaciones en HANDOFF aunque el bot no haya dicho "no sé"', async () => {
      mock(prisma.conversation.findMany).mockResolvedValue([
        {
          status: 'HANDOFF',
          messages: [msg('USER', '¿Hacen envío a domicilio?'), msg('BOT', 'Déjame ver.')],
        },
      ]);

      const result = await detectKnowledgeGaps('biz_1');

      expect(result.conHuecos).toBe(1);
      expect(result.gaps[0].tema).toBe('Ubicación y envíos');
    });

    it('ignora conversaciones resueltas (ni handoff ni "no sé")', async () => {
      mock(prisma.conversation.findMany).mockResolvedValue([
        { status: 'ACTIVE', messages: [msg('USER', 'gracias'), msg('BOT', 'de nada')] },
      ]);
      const result = await detectKnowledgeGaps('biz_1');
      expect(result.conHuecos).toBe(0);
    });

    it('agrupa por tema y ordena por ocurrencias descendente', async () => {
      const unknown = (q: string) => ({
        status: 'ACTIVE',
        messages: [msg('USER', q), msg('BOT', 'no puedo responder eso')],
      });
      mock(prisma.conversation.findMany).mockResolvedValue([
        unknown('¿precio del combo?'),
        unknown('¿cuánto sale el envío?'), // "sale " y "envío" -> Precios matchea primero? 'sale ' está en Precios
        unknown('¿qué horarios tienen?'),
      ]);

      const result = await detectKnowledgeGaps('biz_1');

      // 2 de precios, 1 de horarios -> precios primero.
      expect(result.gaps[0].ocurrencias).toBeGreaterThanOrEqual(result.gaps[1].ocurrencias);
      expect(result.gaps[0].tema).toBe('Precios y costos');
    });

    it('limita los ejemplos a 3, los deduplica y trunca los largos a 160 chars', async () => {
      const largo = 'precio '.repeat(40).trim(); // > 160 chars, tema Precios
      const convo = (q: string) => ({
        status: 'ACTIVE',
        messages: [msg('USER', q), msg('BOT', 'no dispongo de eso')],
      });
      mock(prisma.conversation.findMany).mockResolvedValue([
        convo('¿precio 1?'),
        convo('¿precio 1?'), // duplicado exacto -> no se repite en ejemplos
        convo('¿precio 2?'),
        convo('¿precio 3?'),
        convo('¿precio 4?'), // 5º ejemplo -> excede el tope de 3
        convo(largo),
      ]);

      const result = await detectKnowledgeGaps('biz_1');
      const precios = result.gaps.find((g) => g.tema === 'Precios y costos')!;

      expect(precios.ocurrencias).toBe(6); // cuenta todas
      expect(precios.ejemplos.length).toBeLessThanOrEqual(3); // tope de ejemplos
      const truncados = precios.ejemplos.filter((e) => e.endsWith('...'));
      truncados.forEach((e) => expect(e.length).toBe(160));
    });
  });
});
