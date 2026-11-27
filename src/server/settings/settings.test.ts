import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { CONFIG_FILE, defaultConfigDir, readSettings } from './settings.ts';

const root = mkdtempSync(join(tmpdir(), 'gittree-settings-'));
let n = 0;
/** A fresh config folder holding `content` as config.json (or nothing). */
function folder(content?: string): string {
  const dir = join(root, String(n++));
  mkdirSync(dir);
  if (content !== undefined) writeFileSync(join(dir, CONFIG_FILE), content);
  return dir;
}
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('defaultConfigDir', () => {
  it('follows XDG_CONFIG_HOME, else ~/.config', () => {
    expect(defaultConfigDir({ XDG_CONFIG_HOME: '/x/config' })).toBe('/x/config/gittree');
    expect(defaultConfigDir({})).toBe(join(homedir(), '.config', 'gittree'));
  });
});

describe('readSettings', () => {
  it('uses defaults when there is no config file', async () => {
    const dir = folder();
    expect(await readSettings(dir)).toEqual({
      path: join(dir, CONFIG_FILE),
      jira: { baseUrl: null, projectKeys: [] },
      problems: [],
    });
  });

  it('reads the Jira base URL and project keys', async () => {
    const dir = folder(JSON.stringify({ jira: { baseUrl: 'https://acme.atlassian.net/', projectKeys: ['SHOP', 'ops', 'SHOP'] } }));
    expect(await readSettings(dir)).toMatchObject({
      jira: { baseUrl: 'https://acme.atlassian.net', projectKeys: ['SHOP', 'OPS'] },
      problems: [],
    });
  });

  it('accepts keys as one comma-separated string, and settings it does not know yet', async () => {
    const dir = folder(JSON.stringify({ scanRoots: ['~/code'], jira: { projectKeys: 'SHOP, OPS' } }));
    expect(await readSettings(dir)).toMatchObject({ jira: { baseUrl: null, projectKeys: ['SHOP', 'OPS'] }, problems: [] });
  });

  it('reports what it could not use and keeps the rest', async () => {
    const dir = folder(JSON.stringify({ jira: { baseUrl: 'javascript:alert(1)', projectKeys: ['SHOP', '1BAD', 'X', 7] } }));
    const settings = await readSettings(dir);
    expect(settings.jira).toEqual({ baseUrl: null, projectKeys: ['SHOP'] });
    expect(settings.problems).toEqual([
      expect.stringContaining('"jira.baseUrl" should be an http(s) URL'),
      'Ignored invalid Jira project keys: "1BAD", "X", 7.',
    ]);
  });

  it('refuses base URLs with credentials', async () => {
    const dir = folder(JSON.stringify({ jira: { baseUrl: 'https://me:secret@acme.atlassian.net' } }));
    expect((await readSettings(dir)).jira.baseUrl).toBeNull();
  });

  it('reports invalid JSON and a non-object file', async () => {
    expect((await readSettings(folder('{ "jira": '))).problems).toEqual([expect.stringMatching(/^The file isn't valid JSON/)]);
    expect((await readSettings(folder('[]'))).problems).toEqual(['The file should contain a JSON object.']);
    expect((await readSettings(folder('{ "jira": "SHOP" }'))).problems).toEqual([expect.stringMatching(/"jira" should be an object/)]);
  });
});
