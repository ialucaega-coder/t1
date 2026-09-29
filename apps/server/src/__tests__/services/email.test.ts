/**
 * Pruebas del servicio de envío de email (`src/services/email.ts`).
 *
 * Lo importante es la RESILIENCIA: el envío nunca debe lanzar (un fallo de
 * email no puede tumbar el flujo de reserva/pedido). Se cubre:
 *  - degradación a `false` sin lanzar cuando falta RESEND_API_KEY,
 *  - `false` cuando Resend devuelve error o lanza excepción,
 *  - `true` en el happy path y el subject/destinatario correctos por función.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendMock = vi.fn();

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
}));

import {
  sendBookingConfirmation,
  sendBookingReminder,
  sendOrderStatusUpdate,
  sendWelcomeEmail,
  sendInvoiceEmail,
  sendGenericNotification,
} from '../../services/email';

const savedKey = process.env.RESEND_API_KEY;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = 'test-key';
  sendMock.mockResolvedValue({ error: null });
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = savedKey;
});

const booking = { clientName: 'Ana', serviceName: 'Corte', date: '2026-02-01', time: '10:00' };

describe('services/email', () => {
  describe('resiliencia / degradación', () => {
    it('devuelve false sin lanzar cuando no hay RESEND_API_KEY', async () => {
      delete process.env.RESEND_API_KEY;
      await expect(sendBookingConfirmation('a@b.com', booking)).resolves.toBe(false);
      expect(sendMock).not.toHaveBeenCalled();
    });

    it('devuelve false cuando Resend responde con error', async () => {
      sendMock.mockResolvedValue({ error: { message: 'rate limited' } });
      await expect(sendBookingConfirmation('a@b.com', booking)).resolves.toBe(false);
    });

    it('devuelve false (no propaga) cuando Resend lanza una excepción', async () => {
      sendMock.mockRejectedValue(new Error('network down'));
      await expect(sendBookingConfirmation('a@b.com', booking)).resolves.toBe(false);
    });
  });

  describe('happy path y subjects', () => {
    it('sendBookingConfirmation envía con el subject del servicio', async () => {
      const ok = await sendBookingConfirmation('a@b.com', booking);
      expect(ok).toBe(true);
      const arg = sendMock.mock.calls[0][0];
      expect(arg.to).toBe('a@b.com');
      expect(arg.subject).toBe('Reserva confirmada - Corte');
      expect(arg.html).toContain('¡Reserva confirmada!');
    });

    it('sendBookingReminder incluye servicio y fecha en el subject', async () => {
      await sendBookingReminder('a@b.com', booking);
      expect(sendMock.mock.calls[0][0].subject).toBe('Recordatorio: Corte - 2026-02-01');
    });

    it('sendOrderStatusUpdate usa el estado en el subject', async () => {
      await sendOrderStatusUpdate('a@b.com', {
        clientName: 'A',
        orderId: 'o1',
        status: 'entregado',
        totalPrice: '$100',
      });
      expect(sendMock.mock.calls[0][0].subject).toBe('Tu pedido está entregado');
    });

    it('sendWelcomeEmail cae a "Local B" cuando no hay nombre de negocio', async () => {
      await sendWelcomeEmail('a@b.com', 'Ana', '');
      expect(sendMock.mock.calls[0][0].subject).toBe('Bienvenido/a a Local B');
    });

    it('sendInvoiceEmail usa el número de comprobante en el subject', async () => {
      await sendInvoiceEmail('a@b.com', {
        clientName: 'A',
        invoiceNumber: 'F-001',
        amount: '$100',
        date: 'd',
      });
      expect(sendMock.mock.calls[0][0].subject).toBe('Comprobante de pago - F-001');
    });

    it('sendGenericNotification respeta el subject provisto', async () => {
      await sendGenericNotification('a@b.com', 'Aviso importante', '<p>hola</p>');
      const arg = sendMock.mock.calls[0][0];
      expect(arg.subject).toBe('Aviso importante');
      expect(arg.html).toContain('<p>hola</p>');
    });
  });
});
