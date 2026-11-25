/**
 * Criterio de reintento de mensajes entrantes (services/channels/inboundRetry.ts):
 * se relanza (la cola reintenta) SOLO si no quedó nada guardado ni enviado.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({ prisma: { message: { findFirst: vi.fn() } } }));

import { prisma } from '../../lib/prisma';
import { runInbound, wasAnythingPersisted, INBOUND_RETRY } from '../../services/channels/inboundRetry';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const ctx = { businessId: 'biz_1', contact: '+549' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('runInbound', () => {
  it('si todo sale bien no hace nada extra', async () => {
    await expect(runInbound('x', ctx, async (p) => p.processed())).resolves.toBeUndefined();
    expect(prisma.message.findFirst).not.toHaveBeenCalled();
  });

  it('falla antes de procesar y no hay nada guardado: relanza (la cola reintenta)', async () => {
    mock(prisma.message.findFirst).mockResolvedValue(null);

    await expect(runInbound('x', ctx, async () => { throw new Error('db caída'); })).rejects.toThrow('db caída');
  });

  it('falla con un mensaje ya guardado: NO relanza (evita duplicar el mensaje del cliente)', async () => {
    mock(prisma.message.findFirst).mockResolvedValue({ id: 'm1' });

    await expect(runInbound('x', ctx, async () => { throw new Error('boom'); })).resolves.toBeUndefined();
  });

  it('falla después de procesar (envío): NO relanza ni consulta la DB', async () => {
    await expect(
      runInbound('x', ctx, async (p) => {
        p.processed();
        throw new Error('proveedor caído');
      }),
    ).resolves.toBeUndefined();
    expect(prisma.message.findFirst).not.toHaveBeenCalled();
  });

  it('si no se puede averiguar qué se guardó (DB caída), relanza: se prefiere reintentar a perder el mensaje', async () => {
    mock(prisma.message.findFirst).mockRejectedValue(new Error('db caída'));

    await expect(runInbound('x', ctx, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});

describe('wasAnythingPersisted', () => {
  it('busca mensajes del contacto DEL NEGOCIO desde el inicio del trabajo (con holgura de reloj)', async () => {
    mock(prisma.message.findFirst).mockResolvedValue(null);
    const since = Date.parse('2026-06-01T12:00:00Z');

    expect(await wasAnythingPersisted('biz_1', '+549', since)).toBe(false);

    const where = mock(prisma.message.findFirst).mock.calls[0][0].where;
    expect(where.conversation).toEqual({ businessId: 'biz_1', contactPhone: '+549' });
    expect(where.createdAt.gte.getTime()).toBeLessThan(since);
  });
});

describe('wasAnythingPersisted con externalId propio', () => {
  it('sin USER guardado con ese id: false (se puede reintentar)', async () => {
    mock(prisma.message.findFirst).mockResolvedValue(null);

    expect(await wasAnythingPersisted('biz_1', '+549', Date.now(), 'SM_1')).toBe(false);
    expect(mock(prisma.message.findFirst).mock.calls[0][0].where).toEqual({
      role: 'USER',
      metadata: { path: ['externalId'], equals: 'SM_1' },
      conversation: { businessId: 'biz_1' },
    });
  });

  it('USER guardado pero sin respuesta del bot: false (el reintento continúa sin duplicar el USER)', async () => {
    mock(prisma.message.findFirst)
      .mockResolvedValueOnce({ conversationId: 'c1', createdAt: new Date('2026-01-01T10:00:00Z') })
      .mockResolvedValueOnce(null);

    expect(await wasAnythingPersisted('biz_1', '+549', Date.now(), 'SM_1')).toBe(false);
    expect(mock(prisma.message.findFirst).mock.calls[1][0].where).toMatchObject({ conversationId: 'c1', role: 'BOT' });
  });

  it('USER y respuesta del bot posterior: true (no se reintenta)', async () => {
    mock(prisma.message.findFirst)
      .mockResolvedValueOnce({ conversationId: 'c1', createdAt: new Date('2026-01-01T10:00:00Z') })
      .mockResolvedValueOnce({ id: 'm_bot' });

    expect(await wasAnythingPersisted('biz_1', '+549', Date.now(), 'SM_1')).toBe(true);
  });

  it('mensajes de OTROS contactos no cuentan (ya no hay falso positivo por "cualquier mensaje reciente")', async () => {
    mock(prisma.message.findFirst).mockResolvedValue(null);

    expect(await wasAnythingPersisted('biz_1', '+549', Date.now(), 'SM_1')).toBe(false);
    expect(mock(prisma.message.findFirst).mock.calls[0][0].where.conversation).toEqual({ businessId: 'biz_1' });
  });

  it('runInbound usa el externalId: con solo el USER guardado relanza para reintentar', async () => {
    mock(prisma.message.findFirst)
      .mockResolvedValueOnce({ conversationId: 'c1', createdAt: new Date() })
      .mockResolvedValueOnce(null);

    await expect(
      runInbound('x', { ...ctx, externalId: 'SM_1' }, async () => { throw new Error('falló la IA'); }),
    ).rejects.toThrow('falló la IA');
  });

  it('runInbound con el bot ya respondido no relanza', async () => {
    mock(prisma.message.findFirst)
      .mockResolvedValueOnce({ conversationId: 'c1', createdAt: new Date() })
      .mockResolvedValueOnce({ id: 'm_bot' });

    await expect(
      runInbound('x', { ...ctx, externalId: 'SM_1' }, async () => { throw new Error('falló al enviar el reintento'); }),
    ).resolves.toBeUndefined();
  });
});

describe('configuración de reintentos', () => {
  it('hay más de un intento con backoff', () => {
    expect(INBOUND_RETRY.attempts).toBeGreaterThan(1);
    expect(INBOUND_RETRY.backoffMs).toBeGreaterThan(0);
  });
});
