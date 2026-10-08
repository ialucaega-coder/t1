import { test, expect } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://localhost:4000';

test.describe('Chatbot público', () => {
  test('/chat/demo carga el widget con el bot demo activo', async ({ page, request }) => {
    const demo = await request.get(`${API}/api/public/bot/demo`);
    test.skip(!demo.ok(), 'No hay bot ACTIVE en la DB (GET /api/public/bot/demo != 200)');

    await page.goto('/chat/demo');
    await expect(page.getByPlaceholder('Escribí un mensaje...')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enviar mensaje' })).toBeVisible();
  });

  // Nota: no depende de que la IA esté configurada. Sin API key válida el backend responde un
  // texto de fallback ("no puedo responder automáticamente..."), y el test solo verifica que
  // el widget envía el mensaje y renderiza la respuesta del backend. Efecto lateral: crea una
  // conversación WEB en la DB del bot demo.
  test('el widget envía un mensaje y muestra la respuesta del bot', async ({ page, request }) => {
    const demo = await request.get(`${API}/api/public/bot/demo`);
    test.skip(!demo.ok(), 'No hay bot ACTIVE en la DB (GET /api/public/bot/demo != 200)');

    await page.goto('/chat/demo');
    const input = page.getByPlaceholder('Escribí un mensaje...');
    await expect(input).toBeVisible();
    // Esperar hidratación para que el click use el handler de React
    await page.waitForFunction(() => {
      const el = document.querySelector('input[placeholder="Escribí un mensaje..."]');
      return !!el && Object.keys(el).some((k) => k.startsWith('__reactProps'));
    });
    await input.fill('Hola, ¿qué servicios ofrecen?');

    const respuesta = page.waitForResponse(
      (r) => r.url().includes('/api/public/chat') && r.request().method() === 'POST',
      { timeout: 60_000 },
    );
    await page.getByRole('button', { name: 'Enviar mensaje' }).click();
    const res = await respuesta;
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    expect(typeof data.text).toBe('string');
    expect(data.text.length).toBeGreaterThan(0);
    await expect(page.getByText(data.text, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('No pude conectarme con el bot')).toHaveCount(0);
  });
});
