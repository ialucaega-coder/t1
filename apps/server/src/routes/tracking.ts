/**
 * Endpoints PÚBLICOS de tracking de campañas por email (montados en /api/public/track).
 *  - GET /o/:token.gif → pixel de apertura (siempre devuelve el GIF, sin importar el token).
 *  - GET /c/:token     → cuenta el clic y redirige (302) a la URL firmada en el token.
 * Nada de esto lleva sesión: la autenticidad la da la firma HMAC del token (ver
 * services/campaigns/tracking.ts). Un token inválido no registra nada; en la redirección
 * responde 404 (no hay a dónde ir). Los eventos se cuentan una vez por destinatario.
 */
import { Router, Request, Response } from 'express';
import { recordTrackingEvent, verifyTrackingToken } from '../services/campaigns/tracking';

export const trackingRouter = Router();

// GIF transparente de 1×1.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

function noStore(res: Response): void {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
  });
}

trackingRouter.get('/o/:token', (req: Request, res: Response) => {
  const token = String(req.params.token ?? '').replace(/\.gif$/i, '');
  const payload = verifyTrackingToken(token, 'o');
  if (payload) void recordTrackingEvent(payload);
  noStore(res);
  res.type('image/gif').send(PIXEL);
});

trackingRouter.get('/c/:token', (req: Request, res: Response) => {
  const payload = verifyTrackingToken(String(req.params.token ?? ''), 'c');
  noStore(res);
  if (!payload?.u) {
    res.status(404).type('text/plain').send('Enlace no válido');
    return;
  }
  void recordTrackingEvent(payload);
  res.redirect(302, payload.u);
});
