// Minimal JSON-schema-style validator (subset) used for every stage output.
// Supported keywords: type, properties, required, items, enum, minLength,
// maxLength, minItems, maxItems, minimum, maximum, pattern, additionalProperties(false).

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function matchesType(v, t) {
  const actual = typeOf(v);
  if (Array.isArray(t)) return t.some((x) => matchesType(v, x));
  if (t === 'number') return actual === 'number' || actual === 'integer';
  return actual === t;
}

export function validate(value, schema, at = '$') {
  const errors = [];
  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${at}: expected ${schema.type}, got ${typeOf(value)}`);
    return errors;
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: must be one of ${schema.enum.join(', ')}`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${at}: longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${at}: does not match ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}: above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${at}: more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, i) => errors.push(...validate(item, schema.items, `${at}[${i}]`)));
  }
  if (typeOf(value) === 'object') {
    for (const key of schema.required || []) {
      if (value[key] === undefined) errors.push(`${at}.${key}: required`);
    }
    for (const [key, sub] of Object.entries(schema.properties || {})) {
      if (value[key] !== undefined) errors.push(...validate(value[key], sub, `${at}.${key}`));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(schema.properties || {})[key]) errors.push(`${at}.${key}: not allowed`);
      }
    }
  }
  return errors;
}

export class ValidationError extends Error {
  constructor(label, errors) {
    super(`${label} failed validation: ${errors.slice(0, 8).join('; ')}`);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

export function assertValid(value, schema, label = 'value') {
  const errors = validate(value, schema);
  if (errors.length) throw new ValidationError(label, errors);
  return value;
}
