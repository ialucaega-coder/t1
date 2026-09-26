/**
 * Pruebas del OTP de reservas (lib/otp.ts): emisión, verificación de un solo
 * uso, intentos, expiración y el gate opt-in. Se mockea Prisma; el round-trip
 * emitir→verificar evita depender del hash interno.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    connection: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from '../../lib/prisma';
import { issueOtp, verifyOtp, generateOtpCode, publicBookingRequiresOtp } from '../../lib/otp';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

describe('lib/otp', () => {
  let storedConfig: Record<string, unknown> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    storedConfig = null;
    mock(prisma.connection.deleteMany).mockResolvedValue({ count: 0 });
    mock(prisma.connection.create).mockImplementation(async (args: { data: { config: Record<string, unknown> } }) => {
      storedConfig = args.data.config;
      return { id: 'otp_1' };
    });
    mock(prisma.connection.delete).mockResolvedValue({});
    mock(prisma.connection.update).mockResolvedValue({});
  });

  it('generateOtpCode devuelve 6 dígitos', () => {
    for (let i = 0; i < 20; i++) expect(generateOtpCode()).toMatch(/^\d{6}$/);
  });

  it('emitir → verificar con el código correcto devuelve ok y consume el OTP', async () => {
    const code = await issueOtp('biz_1', '+549111');
    expect(prisma.connection.deleteMany).toHaveBeenCalled(); // limpia previos
    mock(prisma.connection.findFirst).mockResolvedValue({ id: 'otp_1', config: storedConfig });

    expect(await verifyOtp('biz_1', '+549111', code)).toBe('ok');
    expect(prisma.connection.delete).toHaveBeenCalledWith({ where: { id: 'otp_1' } }); // un solo uso
  });

  it('un código incorrecto devuelve invalid e incrementa intentos', async () => {
    await issueOtp('biz_1', '+549111');
    mock(prisma.connection.findFirst).mockResolvedValue({ id: 'otp_1', config: storedConfig });

    expect(await verifyOtp('biz_1', '+549111', '000000')).toBe('invalid');
    expect(prisma.connection.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'otp_1' }, data: expect.objectContaining({ config: expect.objectContaining({ attempts: 1 }) }) })
    );
  });

  it('un OTP vencido devuelve expired y se borra', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({
      id: 'otp_1',
      config: { phone: '+549111', codeHash: 'x', expiresAt: Date.now() - 1000, attempts: 0 },
    });
    expect(await verifyOtp('biz_1', '+549111', '123456')).toBe('expired');
    expect(prisma.connection.delete).toHaveBeenCalled();
  });

  it('supera el tope de intentos → too_many_attempts', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({
      id: 'otp_1',
      config: { phone: '+549111', codeHash: 'x', expiresAt: Date.now() + 10000, attempts: 5 },
    });
    expect(await verifyOtp('biz_1', '+549111', '123456')).toBe('too_many_attempts');
  });

  it('sin OTP emitido devuelve not_found', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    expect(await verifyOtp('biz_1', '+549111', '123456')).toBe('not_found');
  });

  describe('publicBookingRequiresOtp (gate opt-in)', () => {
    const OLD = process.env.PUBLIC_BOOKING_REQUIRE_OTP;
    beforeEach(() => { delete process.env.PUBLIC_BOOKING_REQUIRE_OTP; });
    afterAll(() => { process.env.PUBLIC_BOOKING_REQUIRE_OTP = OLD; });

    it('off por defecto', () => {
      expect(publicBookingRequiresOtp(true)).toBe(false);
    });
    it('on solo si el flag está y hay canal para enviar', () => {
      process.env.PUBLIC_BOOKING_REQUIRE_OTP = 'true';
      expect(publicBookingRequiresOtp(true)).toBe(true);
      expect(publicBookingRequiresOtp(false)).toBe(false); // sin WhatsApp no se puede verificar
    });
  });
});
