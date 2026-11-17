/**
 * Normaliza un texto para COMPARAR (búsquedas, filtros, matching de nombres):
 * minúsculas, sin acentos/tildes y sin espacios sobrantes en los extremos.
 * "Gastronomía" y "gastronomia " dan lo mismo. No se usa para mostrar texto.
 */
export function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Convierte un nombre de ícono PascalCase/camelCase ("CreditCard", "heartPulse")
 * a kebab-case ("credit-card", "heart-pulse"). Si ya viene en kebab-case, queda igual.
 */
export function toKebabCase(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}
