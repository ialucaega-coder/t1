import type { ParamField, TemplateVariable } from '@/lib/api/workflows';

/**
 * Validación en el front de los parámetros de una acción (espejo de la del
 * backend, que es la que manda): obligatorios, largo y {{variables}}. Devuelve un
 * mapa campo → mensaje (vacío = todo bien).
 */
export function validateParams(
  fields: ParamField[],
  values: Record<string, string>,
  variables: TemplateVariable[],
): Record<string, string> {
  const known = new Set(variables.map((v) => v.key));
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const value = (values[f.key] ?? '').trim();
    if (!value) {
      if (f.required) errors[f.key] = `${f.label} es obligatorio`;
      continue;
    }
    if (f.maxLength && value.length > f.maxLength) {
      errors[f.key] = `${f.label}: máximo ${f.maxLength} caracteres`;
      continue;
    }
    if (f.type === 'select' && !f.options?.some((o) => o.value === value)) {
      errors[f.key] = `${f.label}: elegí una opción válida`;
      continue;
    }
    if (f.template) {
      const token = /\{\{\s*([a-z_]+)\s*(?:\|[^{}|]{0,40})?\}\}/g;
      const unknown = [...value.matchAll(token)].map((m) => m[1]).find((k) => !known.has(k));
      if (unknown) {
        errors[f.key] = `${f.label}: la variable {{${unknown}}} no existe`;
      } else {
        const rest = value.replace(token, '');
        if (rest.includes('{{') || rest.includes('}}')) {
          errors[f.key] = `${f.label}: hay llaves {{ }} mal cerradas`;
        }
      }
    }
  }
  return errors;
}

/** Deja solo los params con valor (los vacíos no se mandan). */
export function cleanParams(fields: ParamField[], values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = (values[f.key] ?? '').trim();
    if (v) out[f.key] = v;
  }
  return out;
}
