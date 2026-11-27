import { SettingsResponse } from '../../shared/api.ts';
import type { App } from '../app.ts';
import { readSettings } from '../settings/settings.ts';

/** Read-only in M2 (the config file is edited by hand); M4 adds PUT and the Settings view. */
export function settingsRoutes(app: App, options: { configDir: string }): void {
  app.get('/api/settings', { schema: { response: { 200: SettingsResponse } } }, async () => readSettings(options.configDir));
}
