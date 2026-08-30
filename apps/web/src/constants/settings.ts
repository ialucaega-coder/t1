export interface ThemeOption {
  name: string;
  bg: string;
  text: string;
  desc: string;
}

export const AI_PROVIDERS: string[] = [
  'Claude (Anthropic)',
  'ChatGPT (OpenAI)',
  'Gemini (Google)',
  'Grok (xAI)',
];

export const THEME_OPTIONS: ThemeOption[] = [
  { name: 'Nimbus', bg: 'bg-slate-100', text: 'text-slate-800', desc: 'Claro' },
  { name: 'Onyx', bg: 'bg-slate-900', text: 'text-white', desc: 'Oscuro' },
  { name: 'Terra', bg: 'bg-amber-50', text: 'text-amber-900', desc: 'Cálido' },
];
