/**
 * Pruebas del push best-effort a Cal.com (`src/services/calcom/sync.ts`): debe
 * omitir en silencio si no está conectado/habilitado o faltan datos, crear la
 * reserva cuando todo está, y nunca lanzar si la API falla.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/calcom/config', () => ({ loadCalcomConfig: vi.fn() }));
vi.mock('../../services/calcom/client', () => ({ createBooking: vi.fn() }));

import { loadCalcomConfig } from '../../services/calcom/config';
import { createBooking } from '../../services/calcom/client';
import { syncBookingToCalcom } from '../../services/calcom/sync';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const booking = { start: '2026-02-01T10:00:00', clientName: 'Ana', clientEmail: 'ana@x.com' };

beforeEach(() => vi.clearAllMocks());

describe('services/calcom/sync', () => {
  it('omite cuando Cal.com no está conectado', async () => {
    mock(loadCalcomConfig).mockResolvedValue(null);
    expect(await syncBookingToCalcom('biz_1', booking)).toBe(false);
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('omite cuando está deshabilitado o sin eventTypeId', async () => {
    mock(loadCalcomConfig).mockResolvedValue({ apiKey: 'k', eventTypeId: null, enabled: true });
    expect(await syncBookingToCalcom('biz_1', booking)).toBe(false);
    mock(loadCalcomConfig).mockResolvedValue({ apiKey: 'k', eventTypeId: 5, enabled: false });
    expect(await syncBookingToCalcom('biz_1', booking)).toBe(false);
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('omite cuando falta email o nombre del cliente', async () => {
    mock(loadCalcomConfig).mockResolvedValue({ apiKey: 'k', eventTypeId: 5, enabled: true });
    expect(await syncBookingToCalcom('biz_1', { ...booking, clientEmail: null })).toBe(false);
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('crea la reserva en Cal.com cuando todo está presente', async () => {
    mock(loadCalcomConfig).mockResolvedValue({ apiKey: 'k', eventTypeId: 5, enabled: true });
    mock(createBooking).mockResolvedValue({ id: 99 });

    expect(await syncBookingToCalcom('biz_1', booking)).toBe(true);
    expect(createBooking).toHaveBeenCalledWith('k', expect.objectContaining({
      eventTypeId: 5, name: 'Ana', email: 'ana@x.com', start: '2026-02-01T10:00:00',
    }));
  });

  it('devuelve false (no lanza) si la API de Cal.com falla', async () => {
    mock(loadCalcomConfig).mockResolvedValue({ apiKey: 'k', eventTypeId: 5, enabled: true });
    mock(createBooking).mockRejectedValue(new Error('500'));
    expect(await syncBookingToCalcom('biz_1', booking)).toBe(false);
  });
});
