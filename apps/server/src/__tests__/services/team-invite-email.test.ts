/**
 * Mail de invitación al equipo: plantilla (escapa datos, link como botón) y envío
 * (`sendTeamInviteEmail`): degrada a false sin RESEND_API_KEY y no loguea el link.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendMock = vi.fn();
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
}));

import { sendTeamInviteEmail } from '../../services/email';
import { teamInviteTemplate, safeDisplayName } from '../../services/email-templates';

const savedKey = process.env.RESEND_API_KEY;
const invite = {
  businessName: 'Peluquería <b>Sol</b>',
  roleLabel: 'Profesional',
  acceptUrl: 'https://panel.test.example/aceptar-invitacion#token=biz_1.SECRETO',
  expiresLabel: '22 de noviembre de 2026',
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = 'test-key';
  sendMock.mockResolvedValue({ error: null });
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = savedKey;
});

describe('mail de invitación al equipo', () => {
  it('la plantilla trae el link, el vencimiento y escapa el nombre del negocio (sin inyección HTML)', () => {
    const html = teamInviteTemplate(invite);
    expect(html).toContain('href="https://panel.test.example/aceptar-invitacion#token=biz_1.SECRETO"');
    expect(html).toContain('22 de noviembre de 2026');
    expect(html).toContain('Peluquería &lt;b&gt;Sol&lt;/b&gt;');
    expect(html).not.toContain('<b>Sol</b>');
  });

  it('envía al invitado con el asunto del negocio', async () => {
    await expect(sendTeamInviteEmail('nueva@example.com', invite)).resolves.toBe(true);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'nueva@example.com',
        subject: expect.stringContaining('Te invitaron a'),
        html: expect.stringContaining('#token=biz_1.SECRETO'),
      }),
    );
  });

  it('MEDIUM-3: el asunto es FIJO: el nombre del negocio (elegido por el usuario) no viaja en él', async () => {
    const hostile = { ...invite, businessName: 'Banco Seguro\r\nBcc: victima@example.com — verificá tu cuenta' };
    await sendTeamInviteEmail('nueva@example.com', hostile);
    const sent = sendMock.mock.calls[0][0];
    expect(sent.subject).toBe('Te invitaron a unirte a un equipo en Mr. Go Assistance');
    expect(sent.subject).not.toMatch(/Banco|\r|\n/);
  });

  it('MEDIUM-3: en el cuerpo el nombre sale sin saltos de línea ni caracteres de control y truncado a 80', () => {
    const html = teamInviteTemplate({ ...invite, businessName: 'Banco\n\u202EAlerta\u0007' + 'x'.repeat(200) });
    expect(html).not.toContain('\u202E');
    expect(html).not.toContain('\u0007');
    expect(html).toContain('<strong>Banco Alerta');
    expect(html.match(/<strong>(Banco[^<]*)<\/strong>/)![1].length).toBeLessThanOrEqual(80);
  });

  it('safeDisplayName limpia, colapsa espacios y trunca', () => {
    expect(safeDisplayName('  Mi \n\t Negocio  ')).toBe('Mi Negocio');
    expect(safeDisplayName('a'.repeat(100))).toHaveLength(80);
    expect(safeDisplayName('\u0000\u200B')).toBe('');
  });

  it('sin RESEND_API_KEY devuelve false sin lanzar (la UI avisa que no salió)', async () => {
    delete process.env.RESEND_API_KEY;
    await expect(sendTeamInviteEmail('nueva@example.com', invite)).resolves.toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('no escribe el link (token) en los logs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendTeamInviteEmail('nueva@example.com', invite);
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRETO');
    log.mockRestore();
  });
});
