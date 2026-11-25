/**
 * /workflows: editar una regla (con los parámetros de su acción) y confirmar la
 * ejecución EN VIVO antes de activarla.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const updateRule = vi.fn();
const createRule = vi.fn();
const setSettings = vi.fn();
const getSettings = vi.fn();

const catalog = {
  rules: [
    {
      id: 'r1',
      nombre: 'Saludo',
      activo: true,
      trigger: 'lead_nuevo',
      accion: 'enviar_whatsapp',
      params: { texto: 'Hola {{nombre}}' },
    },
    // regla vieja: sin params
    { id: 'r0', nombre: 'Vieja', activo: true, trigger: 'lead_nuevo', accion: 'enviar_whatsapp' },
  ],
  triggers: [{ key: 'lead_nuevo', label: 'Lead nuevo', description: '' }],
  actions: [
    {
      key: 'enviar_whatsapp',
      label: 'Enviar WhatsApp',
      description: '',
      params: [
        { key: 'texto', label: 'Mensaje', type: 'textarea', required: true, maxLength: 1000, template: true },
      ],
    },
    {
      key: 'mover_lifecycle',
      label: 'Mover etapa',
      description: '',
      params: [
        {
          key: 'etapa',
          label: 'Mover al cliente a la etapa',
          type: 'select',
          required: true,
          options: [
            { value: 'HOT', label: 'Caliente' },
            { value: 'CUSTOMER', label: 'Cliente' },
          ],
        },
      ],
    },
  ],
  variables: [
    { key: 'nombre', label: 'Nombre', example: 'Lucía' },
    { key: 'monto', label: 'Monto', example: '100' },
  ],
};

vi.mock('@/lib/api/workflows', () => ({
  list: vi.fn(async () => catalog),
  getSettings: (...a: unknown[]) => getSettings(...a),
  setSettings: (...a: unknown[]) => setSettings(...a),
  create: (...a: unknown[]) => createRule(...a),
  update: (...a: unknown[]) => updateRule(...a),
  runWorkflow: vi.fn(),
  remove: vi.fn(),
}));

import WorkflowsPage from '@/app/(dashboard)/workflows/page';

beforeEach(() => {
  updateRule.mockReset().mockImplementation(async (id: string, data: Record<string, unknown>) => ({
    ...catalog.rules.find((r) => r.id === id),
    ...data,
  }));
  createRule.mockReset();
  getSettings.mockReset().mockResolvedValue({ live: false });
  setSettings.mockReset().mockImplementation(async (live: boolean) => ({ live }));
});

async function openEditorFor(name: string) {
  const row = (await screen.findByText(name)).closest('div.rounded-xl') as HTMLElement;
  fireEvent.click(row.querySelector('button[aria-label="Editar regla"]') as HTMLElement);
  return screen.findByRole('dialog', { name: 'Editar automatización' });
}

describe('workflows: editar regla', () => {
  it('abre el formulario con los datos y los parámetros de la regla y guarda los cambios por PATCH', async () => {
    render(<WorkflowsPage />);
    await openEditorFor('Saludo');

    const texto = screen.getByLabelText('Mensaje') as HTMLTextAreaElement;
    expect(texto.value).toBe('Hola {{nombre}}');
    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('Saludo');

    fireEvent.change(texto, { target: { value: 'Hola {{nombre}}, ¿en qué te ayudo?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() =>
      expect(updateRule).toHaveBeenCalledWith('r1', {
        nombre: 'Saludo',
        trigger: 'lead_nuevo',
        accion: 'enviar_whatsapp',
        condicion: '',
        params: { texto: 'Hola {{nombre}}, ¿en qué te ayudo?' },
      }),
    );
    expect(createRule).not.toHaveBeenCalled();
  });

  it('valida en el front: variable inexistente y texto vacío bloquean el guardado', async () => {
    render(<WorkflowsPage />);
    await openEditorFor('Saludo');

    const texto = screen.getByLabelText('Mensaje');
    fireEvent.change(texto, { target: { value: 'Hola {{apellido}}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('la variable {{apellido}} no existe');

    fireEvent.change(texto, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mensaje es obligatorio');

    expect(updateRule).not.toHaveBeenCalled();
  });

  it('una regla vieja sin params pide completar el texto al editarla (compat)', async () => {
    render(<WorkflowsPage />);
    await openEditorFor('Vieja');

    expect((screen.getByLabelText('Mensaje') as HTMLTextAreaElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Mensaje es obligatorio');
    expect(updateRule).not.toHaveBeenCalled();
  });

  it('al cambiar de acción se muestran los campos de la nueva y se descartan los anteriores', async () => {
    render(<WorkflowsPage />);
    await openEditorFor('Saludo');

    fireEvent.change(screen.getByLabelText('Hacé (acción)'), { target: { value: 'mover_lifecycle' } });
    expect(screen.queryByLabelText('Mensaje')).toBeNull();
    fireEvent.change(screen.getByLabelText('Mover al cliente a la etapa'), { target: { value: 'HOT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() =>
      expect(updateRule).toHaveBeenCalledWith(
        'r1',
        expect.objectContaining({ accion: 'mover_lifecycle', params: { etapa: 'HOT' } }),
      ),
    );
  });

  it('crear una regla manda los params de la acción', async () => {
    createRule.mockResolvedValue({ id: 'n', nombre: 'Nueva', activo: true, trigger: 'lead_nuevo', accion: 'enviar_whatsapp' });
    render(<WorkflowsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Nueva regla/ }));

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Nueva' } });
    fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: 'Hola {{nombre|amigo}}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));

    await waitFor(() =>
      expect(createRule).toHaveBeenCalledWith({
        nombre: 'Nueva',
        trigger: 'lead_nuevo',
        accion: 'enviar_whatsapp',
        condicion: undefined,
        params: { texto: 'Hola {{nombre|amigo}}' },
      }),
    );
  });
});

describe('workflows: ejecución EN VIVO', () => {
  it('activar EN VIVO pide confirmación explícita y no cambia nada hasta confirmar', async () => {
    render(<WorkflowsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Activar ejecución en vivo' }));

    expect(await screen.findByRole('alertdialog')).toHaveTextContent('¿Activar la ejecución EN VIVO?');
    expect(setSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Sí, activar en vivo' }));
    await waitFor(() => expect(setSettings).toHaveBeenCalledWith(true));
  });

  it('cancelar la confirmación deja la simulación activa', async () => {
    render(<WorkflowsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Activar ejecución en vivo' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));

    expect(setSettings).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('volver a simulación (desactivar) no pide confirmación', async () => {
    getSettings.mockResolvedValue({ live: true });
    render(<WorkflowsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Desactivar ejecución en vivo' }));

    await waitFor(() => expect(setSettings).toHaveBeenCalledWith(false));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
