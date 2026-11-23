/**
 * Tracking de aperturas/clics de campañas por email (services/campaigns/tracking).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../lib/prisma', () => ({
  prisma: { campaign: { findFirst: vi.fn(), updateMany: vi.fn() } },
}));

import { prisma } from '../../../lib/prisma';
import { cache } from '../../../lib/cache';
import {
  signTrackingToken,
  verifyTrackingToken,
  renderCampaignEmailHtml,
  recordTrackingEvent,
  persistRates,
} from '../../../services/campaigns/tracking';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const ctx = { businessId: 'b1', campaignId: 'c1', recipientId: 'u1' };
const OLD_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  cache.clear();
  process.env.API_PUBLIC_URL = 'https://api.example.com/';
});
afterEach(() => {
  process.env = { ...OLD_ENV };
  vi.useRealTimers();
});

describe('tokens firmados', () => {
  it('ida y vuelta', () => {
    const t = signTrackingToken({ k: 'c', b: 'b1', c: 'c1', r: 'u1', u: 'https://x.com/a?b=1' });
    expect(verifyTrackingToken(t as string, 'c')).toEqual({ k: 'c', b: 'b1', c: 'c1', r: 'u1', u: 'https://x.com/a?b=1' });
  });

  it('rechaza firma alterada, payload alterado, tipo equivocado y basura', () => {
    const t = signTrackingToken({ k: 'o', b: 'b1', c: 'c1', r: 'u1' }) as string;
    expect(verifyTrackingToken(t, 'c')).toBeNull(); // es de apertura, no de clic
    expect(verifyTrackingToken(t.slice(0, -2) + 'xx', 'o')).toBeNull();
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ k: 'o', b: 'otro', c: 'c1', r: 'u1' })).toString('base64url');
    expect(verifyTrackingToken(`${forged}.${sig}`, 'o')).toBeNull();
    expect(verifyTrackingToken(`${body}`, 'o')).toBeNull();
    expect(verifyTrackingToken('', 'o')).toBeNull();
    expect(verifyTrackingToken('a.b', 'o')).toBeNull();
  });

  it('un token de clic con destino no http(s) se rechaza (no javascript:)', () => {
    const t = signTrackingToken({ k: 'c', b: 'b1', c: 'c1', r: 'u1', u: 'javascript:alert(1)' }) as string;
    expect(verifyTrackingToken(t, 'c')).toBeNull();
  });
});

describe('renderCampaignEmailHtml', () => {
  it('escapa el HTML del texto, respeta saltos de línea y agrega el pixel', () => {
    const html = renderCampaignEmailHtml('Hola <script>alert(1)</script>\nChau & gracias', ctx);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<br>');
    expect(html).toContain('Chau &amp; gracias');
    expect(html).toMatch(/<img src="https:\/\/api\.example\.com\/api\/public\/track\/o\/[^"]+\.gif" width="1" height="1"/);
  });

  it('reescribe los links como redirecciones firmadas y conserva la puntuación final', () => {
    const html = renderCampaignEmailHtml('Mirá https://tienda.com/oferta?x=1&y=2.', ctx);
    const href = html.match(/href="([^"]+)"/)?.[1] as string;
    expect(href.startsWith('https://api.example.com/api/public/track/c/')).toBe(true);
    const token = href.split('/track/c/')[1];
    expect(verifyTrackingToken(token, 'c')?.u).toBe('https://tienda.com/oferta?x=1&y=2');
    expect(html).toContain('>https://tienda.com/oferta?x=1&amp;y=2</a>.');
  });

  it('sin API_PUBLIC_URL deja los links directos y no agrega pixel', () => {
    delete process.env.API_PUBLIC_URL;
    const html = renderCampaignEmailHtml('Entrá a https://tienda.com ya', ctx);
    expect(html).toContain('href="https://tienda.com"');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('/track/');
  });

  it('un href con comillas no puede salirse del atributo', () => {
    const html = renderCampaignEmailHtml('https://x.com/"onmouseover="alert(1)', ctx);
    expect(html).not.toMatch(/href="[^"]*"[^>]*onmouseover/);
  });
});

describe('recordTrackingEvent y persistRates', () => {
  it('cuenta una sola vez por destinatario y tipo', async () => {
    expect(await recordTrackingEvent({ k: 'o', b: 'b1', c: 'c1', r: 'u1' })).toBe(true);
    expect(await recordTrackingEvent({ k: 'o', b: 'b1', c: 'c1', r: 'u1' })).toBe(false);
    expect(await recordTrackingEvent({ k: 'o', b: 'b1', c: 'c1', r: 'u2' })).toBe(true);
    expect(await recordTrackingEvent({ k: 'c', b: 'b1', c: 'c1', r: 'u1', u: 'https://x.com' })).toBe(true);
  });

  it('persiste el porcentaje de únicos sobre enviados (con debounce, scopeado por negocio)', async () => {
    vi.useFakeTimers();
    mock(prisma.campaign.findFirst).mockResolvedValue({ sentCount: 4 });
    mock(prisma.campaign.updateMany).mockResolvedValue({ count: 1 });

    await recordTrackingEvent({ k: 'o', b: 'b1', c: 'c9', r: 'u1' });
    await recordTrackingEvent({ k: 'o', b: 'b1', c: 'c9', r: 'u2' });
    await recordTrackingEvent({ k: 'c', b: 'b1', c: 'c9', r: 'u1', u: 'https://x.com' });
    expect(prisma.campaign.updateMany).not.toHaveBeenCalled(); // todavía no pasó el debounce

    await vi.advanceTimersByTimeAsync(5100);
    expect(prisma.campaign.updateMany).toHaveBeenCalledTimes(1); // una escritura, no tres
    expect(prisma.campaign.updateMany).toHaveBeenCalledWith({
      where: { id: 'c9', businessId: 'b1' },
      data: { openRate: 50, clickRate: 25 },
    });
  });

  it('con sentCount 0 no divide por cero y nunca pasa de 100', async () => {
    mock(prisma.campaign.findFirst).mockResolvedValue({ sentCount: 0 });
    await persistRates('b1', 'c1');
    expect(mock(prisma.campaign.updateMany).mock.calls[0][0].data).toEqual({ openRate: 0, clickRate: 0 });

    await recordTrackingEvent({ k: 'o', b: 'b1', c: 'c2', r: 'u1' });
    await recordTrackingEvent({ k: 'o', b: 'b1', c: 'c2', r: 'u2' });
    mock(prisma.campaign.findFirst).mockResolvedValue({ sentCount: 1 });
    await persistRates('b1', 'c2');
    expect(mock(prisma.campaign.updateMany).mock.calls[1][0].data.openRate).toBe(100);
  });

  it('si la campaña no existe (o es de otro negocio) no escribe', async () => {
    mock(prisma.campaign.findFirst).mockResolvedValue(null);
    await persistRates('b1', 'c1');
    expect(prisma.campaign.updateMany).not.toHaveBeenCalled();
    expect(mock(prisma.campaign.findFirst).mock.calls[0][0].where).toEqual({ id: 'c1', businessId: 'b1' });
  });
});
