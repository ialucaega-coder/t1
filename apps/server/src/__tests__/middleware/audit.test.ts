/**
 * Auditoría (middleware/audit.ts): el recurso que se loguea no filtra secretos de la URL (B5).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request } from 'express';
import { auditAuthEvent } from '../../middleware/audit';

describe('middleware/audit: la URL se redacta', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('auditAuthEvent no deja tokens/api_key de la query en el log', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const req = {
      originalUrl: '/api/auth/login?token=SECRETO123&x=1&api_key=ABCDEF',
      headers: {},
      socket: { remoteAddress: '1.2.3.4' },
      ip: '1.2.3.4',
    } as unknown as Request;

    auditAuthEvent('AUTH_LOGIN_FAILURE', req, { userId: 'u1' });

    const line = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(line).not.toContain('SECRETO123');
    expect(line).not.toContain('ABCDEF');
    expect(line).toContain('token=[redacted]');
    expect(line).toContain('x=1');
  });
});
