/** El log de acceso no imprime tokens de la query (el del chat público incluido). */
import { describe, it, expect } from 'vitest';
import express from 'express';
import morgan from 'morgan';
import request from 'supertest';

import { redactUrl } from '../../middleware/accessLog'; // registra el token `url` redactado

describe('accessLog', () => {
  it('redactUrl tapa token/chatToken/access_token y conserva el resto', () => {
    expect(redactUrl('/api/public/chat/b1/messages?conversationId=c1&token=SECRETO&after=2026')).toBe(
      '/api/public/chat/b1/messages?conversationId=c1&token=[redacted]&after=2026',
    );
    expect(redactUrl('/x?access_token=abc&chatToken=def')).toBe('/x?access_token=[redacted]&chatToken=[redacted]');
    expect(redactUrl('/api/health')).toBe('/api/health');
  });

  it('la línea que escribe morgan (formato dev) no contiene el token', async () => {
    const lines: string[] = [];
    const app = express();
    app.use(morgan('dev', { stream: { write: (l: string) => lines.push(l) } }));
    app.get('/api/public/chat/:botId/messages', (_req, res) => res.json({ ok: true }));

    await request(app).get('/api/public/chat/b1/messages?conversationId=c1&token=TOKEN_SECRETO_123');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('/api/public/chat/b1/messages');
    expect(lines[0]).not.toContain('TOKEN_SECRETO_123');
    expect(lines[0]).toContain('token=[redacted]');
  });
});
