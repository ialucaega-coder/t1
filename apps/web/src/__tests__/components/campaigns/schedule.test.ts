/** Utilidades de programación: hora argentina (UTC-3), validación de fecha futura y estados. */
import { describe, it, expect } from 'vitest';
import {
  argentinaInputToIso,
  isoToArgentinaInput,
  formatArgentina,
  validateScheduleInput,
  describeCampaignStatus,
  campaignFailedMessage,
} from '@/components/campaigns/schedule';

describe('conversión hora argentina <-> UTC', () => {
  it('interpreta el input como hora argentina', () => {
    expect(argentinaInputToIso('2026-11-15T18:30')).toBe('2026-11-15T21:30:00.000Z');
  });

  it('es la inversa de isoToArgentinaInput', () => {
    expect(isoToArgentinaInput('2026-11-15T21:30:00.000Z')).toBe('2026-11-15T18:30');
    expect(isoToArgentinaInput(argentinaInputToIso('2030-03-01T00:15') as string)).toBe('2030-03-01T00:15');
  });

  it('cruza el día correctamente (02:00 UTC es 23:00 del día anterior en Argentina)', () => {
    expect(isoToArgentinaInput('2026-11-16T02:00:00.000Z')).toBe('2026-11-15T23:00');
  });

  it('rechaza valores inválidos', () => {
    expect(argentinaInputToIso('')).toBeNull();
    expect(argentinaInputToIso('mañana')).toBeNull();
  });

  it('formatea en hora argentina sin depender de la zona del navegador', () => {
    expect(formatArgentina('2026-11-15T21:30:00.000Z')).toBe('15/11/2026, 18:30');
  });
});

describe('validateScheduleInput', () => {
  const now = new Date('2026-11-15T12:00:00.000Z').getTime(); // 09:00 en Argentina

  it('acepta una hora futura (en hora argentina)', () => {
    expect(validateScheduleInput('2026-11-15T10:00', now)).toEqual({ iso: '2026-11-15T13:00:00.000Z' });
  });

  it('rechaza una hora que ya pasó en Argentina', () => {
    expect(validateScheduleInput('2026-11-15T08:59', now)).toHaveProperty('error');
  });

  it('rechaza ahora mismo y valores vacíos', () => {
    expect(validateScheduleInput('2026-11-15T09:00', now)).toHaveProperty('error');
    expect(validateScheduleInput('', now)).toHaveProperty('error');
  });
});

describe('describeCampaignStatus', () => {
  it.each([
    ['draft', 'Borrador'],
    ['scheduled', 'Programada'],
    ['sending', 'Enviando…'],
    ['sent', 'Enviada'],
    ['failed', 'No se envió'],
    ['cancelled', 'Cancelada'],
  ])('%s tiene etiqueta de texto', (status, label) => {
    expect(describeCampaignStatus({ status, scheduledAt: null }).label).toBe(label);
  });

  it('distingue vencida (más de 6 h) de falla de envío', () => {
    const expired = describeCampaignStatus({
      status: 'failed',
      scheduledAt: '2026-11-10T10:00:00.000Z',
      updatedAt: '2026-11-10T16:00:01.000Z',
    });
    expect(expired.description).toMatch(/venció la hora programada hace más de 6 h/);

    const failed = describeCampaignStatus({
      status: 'failed',
      scheduledAt: '2026-11-10T10:00:00.000Z',
      updatedAt: '2026-11-10T15:59:00.000Z',
    });
    expect(failed.description).toMatch(/El envío falló/);
  });
});

describe('campaignFailedMessage y failReason', () => {
  it('singular y plural de mensajes fallidos', () => {
    expect(campaignFailedMessage('X', 'retries_exhausted', { fallidos: 1 })).toBe('No se pudo enviar la campaña X: 1 mensaje falló');
    expect(campaignFailedMessage('X', 'retries_exhausted', { fallidos: 4 })).toBe('No se pudo enviar la campaña X: 4 mensajes fallaron');
  });

  it('failReason pisa la heurística', () => {
    const base = { status: 'failed', scheduledAt: '2026-11-10T10:00:00.000Z', updatedAt: '2026-11-10T10:01:00.000Z' };
    expect(describeCampaignStatus({ ...base, failReason: 'expired' }).description).toMatch(/venció/);
    expect(
      describeCampaignStatus({ ...base, updatedAt: '2026-11-11T10:00:00.000Z', failReason: 'retries_exhausted' }).description,
    ).toMatch(/El envío falló/);
  });
});
