/**
 * Tema de la landing. La elección se guarda en una cookie para que el SERVIDOR
 * renderice el tema correcto desde el primer byte: sin script inline, sin
 * parpadeo y sin desajustes de hidratación. Sin cookie arranca en claro
 * (papel crema).
 */
export const THEME_COOKIE = 'poster-theme';
export type PosterTheme = 'light' | 'dark';

export function parseTheme(value: string | undefined | null): PosterTheme {
  return value === 'dark' ? 'dark' : 'light';
}

/** Cookie de 1 año, solo para el sitio, legible por el servidor. */
export function themeCookie(theme: PosterTheme): string {
  return `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; SameSite=Lax`;
}
