/**
 * Pruebas de las plantillas de email (`src/services/email-templates.ts`).
 * Son funciones puras que generan HTML; se verifica sobre todo:
 *  - el escaping de datos de usuario (defensa anti-inyección en el email),
 *  - el mapeo de estados a emoji con fallback,
 *  - las filas opcionales (profesional, descripción) que aparecen/omiten,
 *  - el formateo del id de pedido.
 */
import { describe, it, expect } from 'vitest';
import {
  bookingConfirmationTemplate,
  bookingReminderTemplate,
  orderStatusTemplate,
  welcomeTemplate,
  invoiceTemplate,
  genericNotificationTemplate,
} from '../../services/email-templates';

describe('services/email-templates', () => {
  describe('bookingConfirmationTemplate', () => {
    it('incluye los datos de la reserva y arma un documento HTML completo', () => {
      const html = bookingConfirmationTemplate({
        clientName: 'Ana',
        serviceName: 'Corte de pelo',
        date: '2026-02-01',
        time: '15:30',
      });
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('¡Reserva confirmada!');
      expect(html).toContain('Ana');
      expect(html).toContain('Corte de pelo');
      expect(html).toContain('15:30');
    });

    it('escapa el nombre del cliente (evita inyección de HTML en el email)', () => {
      const html = bookingConfirmationTemplate({
        clientName: '<script>alert(1)</script>',
        serviceName: 'Corte',
        date: 'd',
        time: 't',
      });
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('muestra la fila de profesional solo cuando se provee', () => {
      const sin = bookingConfirmationTemplate({ clientName: 'A', serviceName: 'S', date: 'd', time: 't' });
      const con = bookingConfirmationTemplate({
        clientName: 'A',
        serviceName: 'S',
        date: 'd',
        time: 't',
        professionalName: 'Dr. López',
      });
      expect(sin).not.toContain('Profesional');
      expect(con).toContain('Profesional');
      expect(con).toContain('Dr. López');
    });
  });

  describe('bookingReminderTemplate', () => {
    it('usa el copy de recordatorio', () => {
      const html = bookingReminderTemplate({ clientName: 'A', serviceName: 'S', date: 'd', time: 't' });
      expect(html).toContain('Recordatorio de tu cita');
    });
  });

  describe('orderStatusTemplate', () => {
    it('mapea el estado conocido a su emoji y capitaliza', () => {
      const html = orderStatusTemplate({
        clientName: 'A',
        orderId: 'order_abcdef123456',
        status: 'entregado',
        totalPrice: '$1.000',
      });
      expect(html).toContain('🚚');
      expect(html).toContain('Entregado');
    });

    it('usa el emoji de fallback para un estado desconocido', () => {
      const html = orderStatusTemplate({
        clientName: 'A',
        orderId: 'order_x',
        status: 'estado-raro',
        totalPrice: '$0',
      });
      expect(html).toContain('🔔');
    });

    it('muestra los últimos 6 caracteres del id en mayúscula', () => {
      const html = orderStatusTemplate({
        clientName: 'A',
        orderId: 'order_abc123def456',
        status: 'pendiente',
        totalPrice: '$0',
      });
      expect(html).toContain('#DEF456');
    });
  });

  describe('welcomeTemplate', () => {
    it('incluye el negocio cuando se provee', () => {
      const html = welcomeTemplate('Ana', 'Barbería X');
      expect(html).toContain('Ana');
      expect(html).toContain('Barbería X');
    });

    it('funciona sin nombre de negocio (usa Local B en el preheader)', () => {
      const html = welcomeTemplate('Ana', '');
      expect(html).toContain('Ana');
      expect(html).toContain('Bienvenido/a a Local B');
    });

    it('escapa el nombre de usuario', () => {
      const html = welcomeTemplate('<b>x</b>', 'Neg');
      expect(html).not.toContain('<b>x</b>');
      expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    });
  });

  describe('invoiceTemplate', () => {
    it('incluye el concepto solo cuando se provee', () => {
      const sin = invoiceTemplate({ clientName: 'A', invoiceNumber: 'F-1', amount: '$10', date: 'd' });
      const con = invoiceTemplate({
        clientName: 'A',
        invoiceNumber: 'F-1',
        amount: '$10',
        date: 'd',
        description: 'Servicio mensual',
      });
      expect(sin).not.toContain('Concepto');
      expect(con).toContain('Concepto');
      expect(con).toContain('Servicio mensual');
    });
  });

  describe('genericNotificationTemplate', () => {
    it('escapa el título pero inyecta el contenido HTML tal cual (por diseño)', () => {
      const html = genericNotificationTemplate('<i>título</i>', '<p>cuerpo confiable</p>');
      expect(html).toContain('&lt;i&gt;título&lt;/i&gt;'); // título escapado
      expect(html).toContain('<p>cuerpo confiable</p>'); // contenido crudo
    });
  });
});
