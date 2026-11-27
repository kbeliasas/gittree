import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { JiraSettings, SettingsResponse } from '../../shared/api.ts';

/**
 * gittree's settings folder (PLAN §8): `$XDG_CONFIG_HOME/gittree`, else
 * `~/.config/gittree`. Settings never live inside your repositories.
 */
export function defaultConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME !== '' ? env.XDG_CONFIG_HOME : join(homedir(), '.config');
  return join(base, 'gittree');
}

export const CONFIG_FILE = 'config.json';

/** Jira project keys: an uppercase letter, then uppercase letters, digits or underscores. */
const PROJECT_KEY = /^[A-Z][A-Z0-9_]{1,49}$/;

/**
 * Reads the config file. In M2 it is edited by hand (M4 adds the Settings
 * view), so it is read on every request and problems are reported rather
 * than fatal: a missing file means defaults, a bad value is skipped.
 */
export async function readSettings(configDir: string): Promise<SettingsResponse> {
  const path = join(configDir, CONFIG_FILE);
  const problems: string[] = [];
  const settings: SettingsResponse = { path, jira: { baseUrl: null, projectKeys: [] }, problems };

  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') problems.push(`Couldn't read the file (${code ?? String(error)}).`);
    return settings;
  }

  let config: unknown;
  try {
    config = JSON.parse(text);
  } catch (error) {
    problems.push(`The file isn't valid JSON: ${(error as Error).message}`);
    return settings;
  }
  if (!isObject(config)) {
    problems.push('The file should contain a JSON object.');
    return settings;
  }
  if (config.jira !== undefined) settings.jira = readJira(config.jira, problems);
  return settings;
}

function readJira(value: unknown, problems: string[]): JiraSettings {
  const jira: JiraSettings = { baseUrl: null, projectKeys: [] };
  if (!isObject(value)) {
    problems.push('"jira" should be an object with "baseUrl" and "projectKeys".');
    return jira;
  }

  if (value.baseUrl !== undefined && value.baseUrl !== null && value.baseUrl !== '') {
    const url = typeof value.baseUrl === 'string' ? parseHttpUrl(value.baseUrl.trim()) : null;
    if (url) jira.baseUrl = url;
    else problems.push('"jira.baseUrl" should be an http(s) URL such as "https://acme.atlassian.net".');
  }

  if (value.projectKeys !== undefined) {
    // A list, or one string such as "SHOP, OPS".
    const raw = typeof value.projectKeys === 'string' ? value.projectKeys.split(',') : value.projectKeys;
    if (!Array.isArray(raw)) {
      problems.push('"jira.projectKeys" should be a list of keys such as ["SHOP", "OPS"].');
    } else {
      const invalid: string[] = [];
      for (const item of raw) {
        const key = typeof item === 'string' ? item.trim().toUpperCase() : '';
        if (PROJECT_KEY.test(key)) {
          if (!jira.projectKeys.includes(key)) jira.projectKeys.push(key);
        } else if (key !== '' || typeof item !== 'string') {
          invalid.push(JSON.stringify(item));
        }
      }
      if (invalid.length > 0) problems.push(`Ignored invalid Jira project keys: ${invalid.join(', ')}.`);
    }
  }
  return jira;
}

function parseHttpUrl(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username !== '' || url.password !== '') return null;
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
