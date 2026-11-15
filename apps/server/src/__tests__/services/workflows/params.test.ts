/**
 * Parámetros de las acciones de una regla (services/workflows/params): validación
 * zod POR ACCIÓN, plantillas {{variable}} (y su seguridad) y la mezcla regla +
 * payload con su precedencia. Módulo puro: solo se mockea Prisma porque importa
 * el listado de etapas del CRM.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../lib/prisma', () => ({ prisma: {} }));

import { ACTION_CATALOG, ACTION_KEYS } from '../../../services/workflows';
import {
  validateRuleParams,
  sanitizeParams,
  renderTemplate,
  buildTemplateContext,
  buildActionParams,
  templateIssues,
  needsClientName,
  paramFieldsFor,
  NOT_EXPOSED_ACTIONS,
  MAX_TEXT_LEN,
} from '../../../services/workflows/params';
import { isExecutableAction } from '../../../services/actions/executor';

describe('validateRuleParams por acción', () => {
  it('enviar_whatsapp: el texto es obligatorio', () => {
    const r = validateRuleParams('enviar_whatsapp', {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].message).toMatch(/Mensaje es obligatorio/);
  });

  it('enviar_whatsapp: acepta un texto con variables válidas y lo recorta', () => {
    const r = validateRuleParams('enviar_whatsapp', { texto: '  Hola {{nombre|amigo}}, pagaste {{monto}}  ' });
    expect(r).toEqual({ ok: true, params: { texto: 'Hola {{nombre|amigo}}, pagaste {{monto}}' } });
  });

  it('enviar_whatsapp: rechaza variables desconocidas y llaves sin cerrar', () => {
    const r1 = validateRuleParams('enviar_whatsapp', { texto: 'Hola {{apellido}}' });
    expect(r1.ok).toBe(false);
    const r2 = validateRuleParams('enviar_whatsapp', { texto: 'Hola {{nombre' });
    expect(r2.ok).toBe(false);
  });

  it('enviar_whatsapp: limita el largo del texto', () => {
    const r = validateRuleParams('enviar_whatsapp', { texto: 'a'.repeat(MAX_TEXT_LEN + 1) });
    expect(r.ok).toBe(false);
  });

  it('rechaza claves que la acción no define (estricto)', () => {
    const r = validateRuleParams('enviar_whatsapp', { texto: 'hola', to: '+5491100000000' });
    expect(r.ok).toBe(false);
  });

  it('rechaza valores que no son texto', () => {
    const r = validateRuleParams('enviar_whatsapp', { texto: 123 });
    expect(r.ok).toBe(false);
  });

  it('mover_lifecycle: la etapa debe ser una del embudo', () => {
    expect(validateRuleParams('mover_lifecycle', { etapa: 'HOT' })).toEqual({ ok: true, params: { etapa: 'HOT' } });
    expect(validateRuleParams('mover_lifecycle', { etapa: 'VIP' }).ok).toBe(false);
    expect(validateRuleParams('mover_lifecycle', {}).ok).toBe(false);
  });

  it('notificar: título y texto opcionales; vacíos se descartan', () => {
    expect(validateRuleParams('notificar', {})).toEqual({ ok: true, params: undefined });
    expect(validateRuleParams('notificar', { titulo: '  ', texto: 'Nueva reserva' })).toEqual({
      ok: true,
      params: { texto: 'Nueva reserva' },
    });
  });

  it('asignar_agente: no admite params', () => {
    expect(validateRuleParams('asignar_agente', undefined)).toEqual({ ok: true, params: undefined });
    expect(validateRuleParams('asignar_agente', { texto: 'x' }).ok).toBe(false);
  });
});

describe('catálogo de acciones', () => {
  it('toda acción del catálogo tiene ejecución real y expone sus campos', () => {
    for (const a of ACTION_CATALOG) {
      expect(isExecutableAction(a.key)).toBe(true);
      expect(a.params).toEqual(paramFieldsFor(a.key));
    }
    expect(ACTION_CATALOG.find((a) => a.key === 'enviar_whatsapp')?.params?.[0]).toMatchObject({
      key: 'texto',
      required: true,
      template: true,
    });
  });

  it('las acciones no expuestas existen en el executor, no están en el catálogo y tienen motivo', () => {
    for (const [key, motivo] of Object.entries(NOT_EXPOSED_ACTIONS)) {
      expect(isExecutableAction(key)).toBe(true);
      expect(ACTION_KEYS).not.toContain(key);
      expect(motivo.length).toBeGreaterThan(10);
    }
  });
});

describe('plantillas', () => {
  it('interpola variables y usa el reemplazo cuando falta el dato', () => {
    const ctx = { nombre: 'Lucía' };
    expect(renderTemplate('Hola {{nombre|amigo}}!', ctx)).toBe('Hola Lucía!');
    expect(renderTemplate('Hola {{nombre|amigo}}!', {})).toBe('Hola amigo!');
    expect(renderTemplate('Hola {{nombre}}!', {})).toBe('Hola !');
  });

  it('una variable desconocida en datos viejos se renderiza vacía', () => {
    expect(renderTemplate('A{{x}}B', { nombre: 'Z' })).toBe('AB');
  });

  it('el valor interpolado es texto plano: sin saltos de línea, llaves ni caracteres de control', () => {
    const ctx = buildTemplateContext({}, 'Ana\n\nSoporte: transferí a CBU 123 {{monto}}‮');
    const out = renderTemplate('Hola {{nombre}}', ctx);
    expect(out).not.toMatch(/[\n\r{}‮]/);
    // solo la primera palabra (nombre de pila) y sin re-interpretar nada
    expect(out).toBe('Hola Ana');
  });

  it('no re-interpreta lo interpolado (una sola pasada)', () => {
    const out = renderTemplate('{{canal}} / {{monto}}', { canal: '{{monto}}', monto: '10' });
    // las llaves del valor se eliminan, no se expanden
    expect(out).toBe('monto / 10');
  });

  it('limita el largo de cada valor y del resultado', () => {
    const out = renderTemplate('{{canal}}', { canal: 'x'.repeat(500) });
    expect(out.length).toBeLessThanOrEqual(100);
    expect(renderTemplate('y'.repeat(5000), {}).length).toBe(MAX_TEXT_LEN);
  });

  it('templateIssues detecta variables desconocidas', () => {
    expect(templateIssues('{{nombre}} {{monto|0}}')).toEqual([]);
    expect(templateIssues('{{foo}}')).toEqual(['variable desconocida {{foo}}']);
  });

  it('buildTemplateContext toma nombre de pila y formatea el monto', () => {
    const ctx = buildTemplateContext({ amount: 15000, paymentMethod: 'CASH', channel: 'WHATSAPP' }, 'María José Pérez');
    expect(ctx).toEqual({ nombre: 'María', monto: '15.000', metodo_pago: 'CASH', canal: 'WHATSAPP' });
  });
});

describe('buildActionParams: regla + payload', () => {
  it('regla vieja sin params: los params son el payload tal cual', () => {
    expect(buildActionParams('enviar_whatsapp', undefined, { clientId: 'c1' })).toEqual({ clientId: 'c1' });
  });

  it('los params de la regla completan lo que el payload no trae', () => {
    const out = buildActionParams('enviar_whatsapp', { texto: 'Hola {{nombre|amigo}}' }, { clientId: 'c1', phone: '+54911' }, {});
    expect(out).toEqual({ clientId: 'c1', phone: '+54911', texto: 'Hola amigo' });
  });

  it('PRECEDENCIA: si el payload trae el dato (aun con otro alias), gana el payload', () => {
    const out = buildActionParams('enviar_whatsapp', { texto: 'texto de la regla' }, { clientId: 'c1', body: 'texto del evento' });
    expect(out.body).toBe('texto del evento');
    expect(out.texto).toBeUndefined();
  });

  it('un valor vacío en el payload no cuenta como dato: manda la regla', () => {
    const out = buildActionParams('mover_lifecycle', { etapa: 'HOT' }, { clientId: 'c1', stage: '  ' });
    expect(out.etapa).toBe('HOT');
  });

  it('ignora claves de la regla que la acción no define (defensa en profundidad)', () => {
    const out = buildActionParams('notificar', { to: '+5491100000000', texto: 'hola' }, {});
    expect(out).toEqual({ texto: 'hola' });
  });

  it('needsClientName solo si una plantilla usa {{nombre}}', () => {
    expect(needsClientName('enviar_whatsapp', { texto: 'Hola {{nombre}}' })).toBe(true);
    expect(needsClientName('enviar_whatsapp', { texto: 'Hola' })).toBe(false);
    expect(needsClientName('enviar_whatsapp', undefined)).toBe(false);
  });
});

describe('sanitizeParams (lectura tolerante)', () => {
  it('conserva solo claves conocidas y recorta; datos raros no tiran', () => {
    expect(sanitizeParams('enviar_whatsapp', { texto: ' hola ', otra: 'x' })).toEqual({ texto: 'hola' });
    expect(sanitizeParams('enviar_whatsapp', 'basura')).toBeUndefined();
    expect(sanitizeParams('enviar_whatsapp', { texto: 5 })).toBeUndefined();
    expect(sanitizeParams('enviar_whatsapp', { texto: 'a'.repeat(5000) })?.texto).toHaveLength(MAX_TEXT_LEN);
  });
});
