/**
 * Pruebas de las funciones PURAS del catálogo/gating de agentes
 * (`services/mrgo/agents.ts`): tools efectivos por agente (rol + override del
 * Studio), permiso por tool y saneo del override en `sanitizeAgents`. Prisma se
 * mockea solo porque el módulo lo importa; estas pruebas no tocan la DB.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/prisma', () => ({ prisma: {} }));

import {
  effectiveTools,
  toolAllowedForAgent,
  sanitizeAgents,
} from '../../services/mrgo/agents';

describe('services/mrgo/agents — effectiveTools', () => {
  it('sin override devuelve los tools del rol', () => {
    expect([...effectiveTools('ventas')]).toEqual([
      'generar_link_pago',
      'crear_cliente',
      'enviar_whatsapp',
    ]);
  });

  it('con override restringe dentro del rol (no amplía)', () => {
    // 'crear_reserva' no es de ventas → se ignora; solo queda lo válido del rol.
    expect([...effectiveTools('ventas', { tools: ['enviar_whatsapp', 'crear_reserva'] })]).toEqual([
      'enviar_whatsapp',
    ]);
  });

  it('override vacío = el agente no ejecuta nada', () => {
    expect([...effectiveTools('ventas', { tools: [] })]).toEqual([]);
  });

  it('rol sin tools propios devuelve lista vacía', () => {
    expect([...effectiveTools('operaciones')]).toEqual([]);
  });
});

describe('services/mrgo/agents — toolAllowedForAgent', () => {
  it('permite un tool del rol y rechaza uno fuera del rol', () => {
    expect(toolAllowedForAgent('ventas', 'generar_link_pago')).toBe(true);
    expect(toolAllowedForAgent('soporte', 'generar_link_pago')).toBe(false);
  });

  it('respeta el override del Studio (apagar un tool lo bloquea)', () => {
    const cfg = { tools: ['enviar_whatsapp'] };
    expect(toolAllowedForAgent('ventas', 'enviar_whatsapp', cfg)).toBe(true);
    expect(toolAllowedForAgent('ventas', 'generar_link_pago', cfg)).toBe(false);
  });

  it('el ceo puede todo el catálogo (sin override)', () => {
    expect(toolAllowedForAgent('ceo', 'lanzar_campana')).toBe(true);
    expect(toolAllowedForAgent('ceo', 'crear_reserva')).toBe(true);
  });
});

describe('services/mrgo/agents — sanitizeAgents (override de tools)', () => {
  it('persiste un subconjunto estricto del rol en orden canónico', () => {
    const out = sanitizeAgents([
      { key: 'ventas', tools: ['enviar_whatsapp', 'generar_link_pago'] },
    ]);
    // Orden canónico del catálogo: generar_link_pago antes que enviar_whatsapp.
    expect(out[0].tools).toEqual(['generar_link_pago', 'enviar_whatsapp']);
  });

  it('omite el override si iguala al set completo del rol (= herencia)', () => {
    const out = sanitizeAgents([
      { key: 'ventas', tools: ['generar_link_pago', 'crear_cliente', 'enviar_whatsapp'] },
    ]);
    expect(out[0].tools).toBeUndefined();
  });

  it('descarta claves fuera del rol; si no queda ninguna válida guarda [] (restringe)', () => {
    // soporte solo permite enviar_whatsapp; generar_link_pago se descarta.
    const out = sanitizeAgents([{ key: 'soporte', tools: ['generar_link_pago'] }]);
    expect(out[0].tools).toEqual([]);
  });

  it('sin array de tools = sin override (hereda)', () => {
    const out = sanitizeAgents([{ key: 'ventas' }, { key: 'crm', tools: 'nope' }]);
    expect(out.find((a) => a.key === 'ventas')!.tools).toBeUndefined();
    expect(out.find((a) => a.key === 'crm')!.tools).toBeUndefined();
  });

  it('para un rol sin tools propios no inventa override', () => {
    const out = sanitizeAgents([{ key: 'operaciones', tools: [] }]);
    expect(out[0].tools).toBeUndefined();
  });
});
