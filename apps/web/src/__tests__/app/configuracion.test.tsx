/**
 * Pruebas de la pantalla de Configuración (`/configuracion`): el guardado no
 * miente (toast de error con el mensaje real), la falla de carga muestra estado
 * de error con "Reintentar" sin habilitar el guardado, y los horarios muestran
 * errores y guardan al perder el foco (no en cada cambio).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const toast = vi.fn();
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast }) }));

const useSettingsMock = vi.fn();
vi.mock('@/hooks/use-settings', () => ({ useSettings: () => useSettingsMock() }));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { name: 'Ana', email: 'ana@x.com' }, updateProfile: vi.fn() }),
}));
vi.mock('@/app/(dashboard)/ia/MotorDeIA', () => ({ MotorDeIA: () => null }));
vi.mock('@/components/auth/RecoveryCodesPanel', () => ({ RecoveryCodesPanel: () => null }));

vi.mock('@/lib/api/auth', () => ({
  getTwoFactorStatus: vi.fn().mockResolvedValue({ enabled: false }),
}));
vi.mock('@/lib/api/schedules', () => ({
  getSchedules: vi.fn(),
  updateSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  createSchedule: vi.fn(),
}));

import ConfiguracionPage from '@/app/(dashboard)/configuracion/page';
import * as schedulesApi from '@/lib/api/schedules';

const mockGetSchedules = schedulesApi.getSchedules as ReturnType<typeof vi.fn>;
const mockUpdateSchedule = schedulesApi.updateSchedule as ReturnType<typeof vi.fn>;
const mockDeleteSchedule = schedulesApi.deleteSchedule as ReturnType<typeof vi.fn>;
const mockCreateSchedule = schedulesApi.createSchedule as ReturnType<typeof vi.fn>;

const SETTINGS = {
  businessName: 'Peluquería Ana',
  slug: 'ana',
  phone: '123',
  email: 'ana@x.com',
  address: 'Calle 1',
  timezone: 'America/Argentina/Buenos_Aires',
  currency: 'ARS',
  theme: 'onyx',
  accentColor: '#38BDF8',
  aiProviders: [],
};

const SCHEDULE = {
  id: 's1',
  dayOfWeek: 1,
  startTime: '09:00',
  endTime: '18:00',
  isActive: true,
  professionalId: 'p1',
};

function mockSettings(overrides: Record<string, unknown> = {}) {
  useSettingsMock.mockReturnValue({
    settings: SETTINGS,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    updateSettings: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
}

async function renderWithSchedule() {
  const utils = render(<ConfiguracionPage />);
  await waitFor(() =>
    expect(utils.container.querySelectorAll('input[type="time"]').length).toBe(2),
  );
  const timeInputs = utils.container.querySelectorAll<HTMLInputElement>('input[type="time"]');
  return { ...utils, start: timeInputs[0] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSchedules.mockResolvedValue([SCHEDULE]);
});

describe('configuracion/page - guardado de datos del negocio', () => {
  it('muestra toast de éxito solo si el guardado funcionó', async () => {
    mockSettings();
    render(<ConfiguracionPage />);
    fireEvent.click(await screen.findByRole('button', { name: /guardar cambios/i }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({ type: 'success', message: 'Configuración guardada correctamente' }),
    );
  });

  it('muestra toast de error con el mensaje real y NO el de éxito cuando falla', async () => {
    mockSettings({ updateSettings: vi.fn().mockRejectedValue(new Error('Sin permisos')) });
    render(<ConfiguracionPage />);
    fireEvent.click(await screen.findByRole('button', { name: /guardar cambios/i }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ type: 'error', message: 'Sin permisos' }));
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });
});

describe('configuracion/page - falla de carga', () => {
  it('muestra error con Reintentar, no muestra datos falsos y deshabilita guardar', async () => {
    const refetch = vi.fn();
    const updateSettings = vi.fn();
    mockSettings({ settings: null, error: 'API caída', refetch, updateSettings });
    render(<ConfiguracionPage />);

    expect(await screen.findByText('API caída')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Mi Negocio')).not.toBeInTheDocument();
    expect(screen.queryByText('Datos del negocio')).not.toBeInTheDocument();

    const save = screen.getByRole('button', { name: /guardar cambios/i });
    expect(save).toBeDisabled();
    fireEvent.submit(save.closest('form')!);
    expect(updateSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('configuracion/page - horarios', () => {
  it('guarda la hora una sola vez al perder el foco, no en cada cambio', async () => {
    mockSettings();
    mockUpdateSchedule.mockResolvedValue({ ...SCHEDULE, startTime: '10:30' });
    const { start } = await renderWithSchedule();

    fireEvent.change(start, { target: { value: '10:00' } });
    fireEvent.change(start, { target: { value: '10:30' } });
    expect(mockUpdateSchedule).not.toHaveBeenCalled();
    expect(start.value).toBe('10:30');

    fireEvent.blur(start);
    await waitFor(() => expect(mockUpdateSchedule).toHaveBeenCalledTimes(1));
    expect(mockUpdateSchedule).toHaveBeenCalledWith('s1', { startTime: '10:30' });
  });

  it('muestra toast de error si falla guardar la hora y vuelve al valor del servidor', async () => {
    mockSettings();
    mockUpdateSchedule.mockRejectedValue(new Error('Horario inválido'));
    const { start } = await renderWithSchedule();

    fireEvent.change(start, { target: { value: '11:00' } });
    fireEvent.blur(start);

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ type: 'error', message: 'Horario inválido' }));
    expect(start.value).toBe('09:00');
  });

  it('muestra toast de error al activar/desactivar, eliminar y agregar si falla', async () => {
    mockSettings();
    mockUpdateSchedule.mockRejectedValue(new Error('Fallo toggle'));
    mockDeleteSchedule.mockRejectedValue(new Error('Fallo delete'));
    mockCreateSchedule.mockRejectedValue(new Error('Fallo create'));
    const { start } = await renderWithSchedule();

    const row = start.parentElement!;
    const [toggle, remove] = Array.from(row.querySelectorAll('button'));
    fireEvent.click(toggle);
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ type: 'error', message: 'Fallo toggle' }));
    fireEvent.click(remove);
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ type: 'error', message: 'Fallo delete' }));
    fireEvent.click(screen.getAllByRole('button', { name: /agregar/i })[0]);
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ type: 'error', message: 'Fallo create' }));
  });
});
