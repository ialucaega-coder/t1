/** /workflows y /prompt: eliminar una regla / un prompt pide confirmación. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const removeRule = vi.fn();
vi.mock('@/lib/api/workflows', () => ({
  list: vi.fn().mockResolvedValue({
    rules: [{ id: 'r1', nombre: 'Avisar reserva', activo: true, trigger: 't', accion: 'a' }],
    triggers: [{ key: 't', label: 'Reserva creada', description: '' }],
    actions: [{ key: 'a', label: 'Notificar', description: '' }],
  }),
  getSettings: vi.fn().mockResolvedValue({ live: false }),
  setSettings: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  runWorkflow: vi.fn(),
  remove: (...a: unknown[]) => removeRule(...a),
}));

const deletePrompt = vi.fn();
vi.mock('@/lib/api/prompts', () => ({
  getPrompts: vi.fn(),
  createPrompt: vi.fn(),
  updatePrompt: vi.fn(),
  deletePrompt: (...a: unknown[]) => deletePrompt(...a),
}));
vi.mock('@/hooks/use-prompts', () => ({
  usePrompts: () => ({
    prompts: [{ id: 'p1', name: 'Saludo', category: 'General', content: 'Hola', isActive: true }],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/hooks', () => ({ useClipboard: () => ({ copiedId: null, copy: vi.fn() }) }));

import WorkflowsPage from '@/app/(dashboard)/workflows/page';
import PromptPage from '@/app/(dashboard)/prompt/page';

beforeEach(() => {
  removeRule.mockReset().mockResolvedValue(undefined);
  deletePrompt.mockReset().mockResolvedValue(undefined);
});

describe('workflows: eliminar regla', () => {
  it('no elimina hasta confirmar', async () => {
    render(<WorkflowsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar regla' }));
    expect(removeRule).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(removeRule).toHaveBeenCalledWith('r1'));
  });
});

describe('prompt: eliminar prompt', () => {
  it('no elimina hasta confirmar', async () => {
    render(<PromptPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar prompt Saludo' }));
    expect(deletePrompt).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(deletePrompt).toHaveBeenCalledWith('p1'));
  });
});
