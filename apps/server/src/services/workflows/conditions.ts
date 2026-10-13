/**
 * Evaluador de condiciones de reglas de automatización.
 *
 * Una regla puede tener una `condicion` opcional de texto libre simple del tipo
 * `<campo> <op> <valor>` (ej: "monto > 1000", "canal = whatsapp"). Antes la
 * condición no se evaluaba (toda regla activa del trigger matcheaba); ahora
 * `matchesCondition` la compara contra el `payload` del evento.
 *
 * Diseño conservador (compat hacia atrás): si la condición está vacía o NO se
 * puede parsear, se trata como "sin restricción" y la regla matchea igual
 * (fail-open). Así nunca ROMPEMOS reglas existentes con condiciones en prosa; solo
 * AGREGAMOS filtrado para las condiciones bien formadas. La seguridad de los
 * efectos externos ya la cubre el gate de modo (dry_run por defecto).
 *
 * Operadores soportados: = == != > >= < <= y `contiene`/`contains`.
 * Comparación numérica si ambos lados parsean como número; si no, string
 * (case-insensitive para = / != / contiene).
 */

export interface ParsedCondition {
  field: string;
  op: string;
  value: string;
}

// <campo> <op> <valor>. El campo es alfanumérico/guion_bajo; el valor es el resto.
const CONDITION_RE = /^\s*([A-Za-z_][\w]*)\s*(>=|<=|!=|==|=|>|<|contiene|contains)\s*(.+?)\s*$/i;

/** Parsea una condición simple. Devuelve null si no tiene la forma esperada. */
export function parseCondition(condicion: string): ParsedCondition | null {
  const m = CONDITION_RE.exec(condicion);
  if (!m) return null;
  const field = m[1];
  const op = m[2].toLowerCase();
  // Saca comillas envolventes del valor, si las tiene.
  const value = m[3].replace(/^['"]|['"]$/g, '');
  return { field, op, value };
}

/** Compara numéricamente si ambos lados son números; si no, como texto. */
function compare(actual: unknown, op: string, expected: string): boolean {
  const actualStr = actual === null || actual === undefined ? '' : String(actual);
  const actualNum = typeof actual === 'number' ? actual : Number(actualStr);
  const expectedNum = Number(expected);
  const bothNumeric = Number.isFinite(actualNum) && expected.trim() !== '' && Number.isFinite(expectedNum);

  switch (op) {
    case '=':
    case '==':
      return bothNumeric ? actualNum === expectedNum : actualStr.toLowerCase() === expected.toLowerCase();
    case '!=':
      return bothNumeric ? actualNum !== expectedNum : actualStr.toLowerCase() !== expected.toLowerCase();
    case '>':
      return bothNumeric && actualNum > expectedNum;
    case '>=':
      return bothNumeric && actualNum >= expectedNum;
    case '<':
      return bothNumeric && actualNum < expectedNum;
    case '<=':
      return bothNumeric && actualNum <= expectedNum;
    case 'contiene':
    case 'contains':
      return actualStr.toLowerCase().includes(expected.toLowerCase());
    default:
      return false;
  }
}

/**
 * ¿El evento cumple la condición de la regla?
 * - Sin condición → true (sin restricción).
 * - Condición no parseable → true (fail-open, compat con condiciones en prosa).
 * - Parseable → compara `payload[campo]` con el valor según el operador.
 */
export function matchesCondition(
  condicion: string | undefined,
  payload: Record<string, unknown> = {},
): boolean {
  if (!condicion || !condicion.trim()) return true;
  const parsed = parseCondition(condicion);
  if (!parsed) return true; // no sabemos evaluarla → no bloqueamos
  return compare(payload[parsed.field], parsed.op, parsed.value);
}
