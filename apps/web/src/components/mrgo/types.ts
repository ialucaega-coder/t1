// Tipos y catálogo de la marca "Mr Go".
// Esta es la capa de datos pura (sin JSX) que consumen los componentes visuales.

// Emociones que puede expresar Mr Go. Cada una cambia ojos/boca/gestos en el avatar.
export type MrGoEmotion =
  | 'happy' // sonrisa grande
  | 'working' // saluda con la mano animada (+ glow opcional)
  | 'thinking' // boca "o" chica
  | 'nerd' // anteojos negros
  | 'angry' // cejas enojadas + boca recta
  | 'sleepy' // ojos cerrados + "z"
  | 'love'; // ojos corazón rosas

// Claves de la familia de 14 colores de Mr Go. Cada color representa un rubro.
export type MrGoColorKey =
  | 'LILA'
  | 'RED'
  | 'PINK'
  | 'LIGHT_BLUE'
  | 'WHITE'
  | 'ORANGE'
  | 'BROWN'
  | 'BEIGE'
  | 'TURQUOISE'
  | 'GREEN'
  | 'LIME'
  | 'BLACK'
  | 'BLUE'
  | 'YELLOW';

// Describe cada integrante de la familia: color base + etiqueta legible (rubro/giro).
export interface MrGoColorInfo {
  /** Color base del cuerpo en hexadecimal */
  hex: string;
  /** Rol o rubro que representa (para mostrar al usuario) */
  label: string;
}

// Catálogo completo de la familia Mr Go. El LILA es el color insignia (CEO/Director).
export const MR_GO_COLORS: Record<MrGoColorKey, MrGoColorInfo> = {
  LILA: { hex: '#A855F7', label: 'CEO / Director' },
  RED: { hex: '#EF4444', label: 'Peluquería' },
  PINK: { hex: '#FF8EC7', label: 'Estética' },
  LIGHT_BLUE: { hex: '#7EC8E3', label: 'Odontología' },
  WHITE: { hex: '#F5F5F5', label: 'Médico' },
  ORANGE: { hex: '#FF8C42', label: 'Gym / Retail' },
  BROWN: { hex: '#8B5A2B', label: 'Restaurante' },
  BEIGE: { hex: '#E6D5B8', label: 'Cafetería' },
  TURQUOISE: { hex: '#40E0D0', label: 'Spa' },
  GREEN: { hex: '#6BCB77', label: 'Veterinaria' },
  LIME: { hex: '#A8E063', label: 'Inmobiliaria' },
  BLACK: { hex: '#2D2D2D', label: 'Taller' },
  BLUE: { hex: '#4A90E2', label: 'Legal' },
  YELLOW: { hex: '#FFD93D', label: 'Contable' },
};

// Orden canónico de la familia, útil para iterar la grilla de previsualización.
export const MR_GO_COLOR_ORDER: MrGoColorKey[] = [
  'LILA',
  'RED',
  'PINK',
  'LIGHT_BLUE',
  'WHITE',
  'ORANGE',
  'BROWN',
  'BEIGE',
  'TURQUOISE',
  'GREEN',
  'LIME',
  'BLACK',
  'BLUE',
  'YELLOW',
];
