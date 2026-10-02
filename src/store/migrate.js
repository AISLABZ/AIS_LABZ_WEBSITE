import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../config.js';

/** Apply numbered migrations in migrations/ that have not yet been applied. */
export async function migrate(store, { migrationsDir = path.join(ROOT, 'migrations'), log = () => {} } = {}) {
  const state = store.readJson('schema-version.json', { version: 0, applied: [] });
  const files = fs.readdirSync(migrationsDir).filter((f) => /^\d{3}_.+\.js$/.test(f)).sort();
  const applied = [];
  for (const f of files) {
    const version = Number.parseInt(f.slice(0, 3), 10);
    if (version <= state.version) continue;
    const mod = await import(pathToFileURL(path.join(migrationsDir, f)).href);
    await mod.up(store);
    state.version = version;
    state.applied.push({ version, file: f, at: new Date().toISOString() });
    store.writeJson('schema-version.json', state);
    applied.push(f);
    log(`applied migration ${f}`);
  }
  return { version: state.version, applied };
}
