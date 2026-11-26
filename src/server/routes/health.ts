import { HealthResponse } from '../../shared/api.ts';
import type { App } from '../app.ts';
import { VERSION } from '../version.ts';

export function healthRoutes(app: App, options: { gitVersion: string }): void {
  app.get('/api/health', { schema: { response: { 200: HealthResponse } } }, async () => ({
    ok: true as const,
    version: VERSION,
    git: { version: options.gitVersion },
  }));
}
