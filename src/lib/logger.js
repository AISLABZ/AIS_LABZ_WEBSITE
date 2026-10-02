// Structured JSON logger that never prints secret values.

const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|JSON|HASH)/i;

function secretValues() {
  return Object.entries(process.env)
    .filter(([k, v]) => SECRET_NAME.test(k) && v && v.length >= 8)
    .map(([, v]) => v);
}

export function redact(input) {
  let s = typeof input === 'string' ? input : JSON.stringify(input);
  if (s === undefined) return s;
  for (const v of secretValues()) s = s.split(v).join('[REDACTED]');
  s = s.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, '$1[REDACTED]');
  s = s.replace(/("?(?:api[_-]?key|x-api-key|x-subscription-token|authorization|private_key)"?\s*[:=]\s*")[^"]+"/gi, '$1[REDACTED]"');
  s = s.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]');
  return s;
}

export function createLogger(context = {}, sink = (line) => process.stderr.write(line + '\n')) {
  const log = (level, msg, extra = {}) => {
    const entry = { ts: new Date().toISOString(), level, msg, ...context, ...extra };
    if (extra.err instanceof Error) entry.err = { message: extra.err.message, name: extra.err.name };
    sink(redact(entry));
    return entry;
  };
  return {
    info: (m, e) => log('info', m, e),
    warn: (m, e) => log('warn', m, e),
    error: (m, e) => log('error', m, e),
    child: (ctx) => createLogger({ ...context, ...ctx }, sink),
  };
}

export const logger = createLogger();
