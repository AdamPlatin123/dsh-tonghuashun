import { join } from 'node:path';
import { homedir } from 'node:os';
import { createMetricsService } from './host/service.js';
import { createLedgerHandler } from './http.js';
import { projectKey } from './core/metrics.js';

export const name = 'tonghuashun';
export const inject = ['sessions', 'sessionQuery', 'tools', 'webServer'];

export async function apply(ctx, config = {}) {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
  const file = join(config.dataDir || join(home, 'statistics', 'tonghuashun'), 'ledger.json');
  const service = await createMetricsService({ file, query: ctx.sessionQuery, onError: error => ctx.logger.warn(error) });
  ctx.on('tools/execute', (exec, next) => service.capture(exec, next));
  ctx.on('session/event', (session, event) => service.ingest(session, event).catch(error => ctx.logger.warn(error)));
  const initializing = new Map();
  const initialized = new Set();
  const api = {
    ...service,
    async getProject(root, { refresh = false } = {}) {
      const existing = service.getProject(root);
      const key = projectKey(root);
      if (existing && initialized.has(key)) return refresh ? service.ensureProject(root) : existing;
      if (!initializing.has(key)) initializing.set(key, (async () => {
        if (!existing) {
          const sessions = await ctx.sessionQuery.listSessions();
          const allowed = sessions.find(({ header }) => header?.cwd && projectKey(header.cwd) === key);
          if (!allowed) return null;
          await service.ensureProject(allowed.header.cwd);
        } else await service.ensureProject(root);
        await service.backfill(root);
        initialized.add(key);
        return service.getProject(root);
      })().finally(() => initializing.delete(key)));
      return initializing.get(key);
    },
  };
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/tonghuashun/ledger', handler: createLedgerHandler(api) }));
  ctx.effect(() => () => service.close());
  await service.backfill();
}
