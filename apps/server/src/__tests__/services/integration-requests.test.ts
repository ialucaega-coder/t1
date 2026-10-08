/**
 * Pruebas del servicio de solicitudes de integración
 * (`src/services/integrations/requests.ts`): carga/normalización y alta/baja
 * idempotente con lock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    connection: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma';
import { loadIntegrationRequests, toggleIntegrationRequest } from '../../services/integrations/requests';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (cb: (tx: typeof prisma) => unknown) => cb(prisma)
  );
  (prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  mock(prisma.connection.update).mockResolvedValue({});
  mock(prisma.connection.create).mockResolvedValue({ id: 'c_new' });
  mock(prisma.connection.findUnique).mockResolvedValue({ config: { requested: [] } });
});

describe('services/integrations/requests', () => {
  it('loadIntegrationRequests devuelve [] sin registro', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    expect(await loadIntegrationRequests('biz_1')).toEqual([]);
  });

  it('loadIntegrationRequests normaliza (dedup + saca no-strings)', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ config: { requested: ['HubSpot', 'HubSpot', 2, ''] } });
    expect(await loadIntegrationRequests('biz_1')).toEqual(['HubSpot']);
  });

  it('agrega una solicitud creando el registro cuando no existe', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    const res = await toggleIntegrationRequest('biz_1', 'Google Calendar', true);
    expect(prisma.connection.create).toHaveBeenCalledTimes(1);
    expect(res).toEqual(['Google Calendar']);
  });

  it('agrega mergeando sin pisar las existentes (con lock)', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ id: 'c1' });
    mock(prisma.connection.findUnique).mockResolvedValue({ config: { requested: ['HubSpot'] } });
    const res = await toggleIntegrationRequest('biz_1', 'Notion', true);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(res).toEqual(['HubSpot', 'Notion']);
  });

  it('quita una solicitud existente', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ id: 'c1' });
    mock(prisma.connection.findUnique).mockResolvedValue({ config: { requested: ['HubSpot', 'Notion'] } });
    const res = await toggleIntegrationRequest('biz_1', 'HubSpot', false);
    expect(res).toEqual(['Notion']);
  });
});
