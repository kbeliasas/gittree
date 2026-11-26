import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { HOST, json, makeTestApp, signIn, TEST_PORT, type TestApp } from '../../test/helpers/app.ts';
import type { RepoInfo, ReposResponse } from '../shared/api.ts';
import { VERSION } from './version.ts';

const { repos } = inject('fixtures');
const webRoot = mkdtempSync(join(tmpdir(), 'gittree-web-'));
mkdirSync(join(webRoot, 'assets'));
writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>test-spa</title>');
writeFileSync(join(webRoot, 'assets', 'app-abc123.js'), 'console.log("app")');

let t: TestApp;
let cookie: string;

beforeAll(async () => {
  t = await makeTestApp([repos.linear.dir, repos.detached.dir, repos.empty.dir], { webRoot });
  cookie = await signIn(t);
});
afterAll(async () => {
  await t.app.close();
  rmSync(webRoot, { recursive: true, force: true });
});

const get = (url: string, headers: Record<string, string> = {}) =>
  t.app.inject({ method: 'GET', url, headers: { host: HOST, cookie, ...headers } });

describe('sign-in', () => {
  it('swaps the one-time token for an HttpOnly, SameSite=Strict session cookie', async () => {
    const fresh = await makeTestApp([repos.linear.dir]);
    const response = await fresh.app.inject({ url: `/auth?token=${fresh.session.token}`, headers: { host: HOST } });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.cookies).toEqual([
      expect.objectContaining({ name: `gittree_${TEST_PORT}`, httpOnly: true, sameSite: 'Strict', path: '/' }),
    ]);
    await fresh.app.close();
  });

  it('refuses a wrong token and a token that was already used', async () => {
    const wrong = await t.app.inject({ url: '/auth?token=guess', headers: { host: HOST, accept: 'text/html' } });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.body).toContain('This sign-in link isn’t valid');
    expect(wrong.cookies).toEqual([]);

    const reused = await t.app.inject({ url: `/auth?token=${t.session.token}`, headers: { host: HOST } });
    expect(reused.statusCode).toBe(401);
    expect(reused.body).toContain('already used');
  });

  it('lets an already signed-in browser open the link again', async () => {
    const again = await get(`/auth?token=${t.session.token}`);
    expect(again.statusCode).toBe(302);
    expect(again.headers.location).toBe('/');
  });

  it('requires the session cookie everywhere else', async () => {
    const api = await t.app.inject({ url: '/api/health', headers: { host: HOST } });
    expect(api.statusCode).toBe(401);
    expect(json(api)).toEqual({ error: 'unauthorized', message: expect.any(String) });

    const page = await t.app.inject({ url: '/', headers: { host: HOST, accept: 'text/html' } });
    expect(page.statusCode).toBe(401);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.body).toContain('isn’t signed in');

    const forged = await t.app.inject({ url: '/api/health', headers: { host: HOST, cookie: `gittree_${TEST_PORT}=forged` } });
    expect(forged.statusCode).toBe(401);
  });
});

describe('request guard', () => {
  it.each(['evil.example', `evil.example:${TEST_PORT}`, '127.0.0.1:1', `localhost.evil.example:${TEST_PORT}`, `[::1]:${TEST_PORT}`])(
    'rejects Host %s (DNS rebinding)',
    async (host) => {
      const response = await get('/api/health', { host });
      expect(response.statusCode).toBe(403);
      expect(json(response)).toMatchObject({ error: 'bad_host' });
    },
  );

  it('accepts both loopback host names', async () => {
    expect((await get('/api/health', { host: `localhost:${TEST_PORT}` })).statusCode).toBe(200);
    expect((await get('/api/health', { host: `127.0.0.1:${TEST_PORT}` })).statusCode).toBe(200);
  });

  it('rejects foreign origins but accepts its own and configured ones', async () => {
    expect(json(await get('/api/health', { origin: 'http://evil.example' }))).toMatchObject({ error: 'bad_origin' });
    expect((await get('/api/health', { origin: 'http://127.0.0.1:5173' })).statusCode).toBe(403);
    expect((await get('/api/health', { origin: `http://127.0.0.1:${TEST_PORT}` })).statusCode).toBe(200);

    const dev = await makeTestApp([repos.linear.dir], { extraOrigins: ['http://127.0.0.1:5173'] });
    const devCookie = await signIn(dev);
    const response = await dev.app.inject({
      url: '/api/health',
      headers: { host: HOST, cookie: devCookie, origin: 'http://127.0.0.1:5173' },
    });
    expect(response.statusCode).toBe(200);
    await dev.app.close();
  });

  it('rejects cross-site requests, and same-site ones unless they are page navigations', async () => {
    expect((await get('/api/health', { 'sec-fetch-site': 'cross-site' })).statusCode).toBe(403);
    expect((await get('/api/health', { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'cors' })).statusCode).toBe(403);
    expect((await get('/', { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'navigate' })).statusCode).toBe(200);
    expect((await get('/api/health', { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' })).statusCode).toBe(200);
    expect((await get('/', { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate' })).statusCode).toBe(200);
  });

  it('sends security headers and never CORS headers', async () => {
    for (const response of [await get('/api/health'), await get('/'), await t.app.inject({ url: '/', headers: { host: 'evil.example' } })]) {
      expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    }
    const preflight = await t.app.inject({
      method: 'OPTIONS',
      url: '/api/health',
      headers: { host: HOST, cookie, origin: `http://127.0.0.1:${TEST_PORT}`, 'access-control-request-method': 'GET' },
    });
    expect(preflight.statusCode).toBe(404);
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('API', () => {
  it('GET /api/health reports gittree and git versions', async () => {
    const response = await get('/api/health');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(json(response)).toEqual({ ok: true, version: VERSION, git: { version: '2.99.0' } });
  });

  it('GET /api/repos lists the open repositories', async () => {
    const body = json<ReposResponse>(await get('/api/repos'));
    expect(body.repos.map((r) => r.name)).toEqual(['linear', 'detached', 'empty']);
    expect(body.repos[0]).toEqual({ id: t.repos[0]?.id, name: 'linear', path: repos.linear.dir, bare: false });
  });

  it('GET /api/repos/:id describes HEAD and the graph size', async () => {
    const [linear, detached, empty] = t.repos;
    expect(json<RepoInfo>(await get(`/api/repos/${linear?.id}`))).toMatchObject({
      name: 'linear',
      head: { branch: 'main', sha: repos.linear.shas.head },
      commitCount: 6,
    });
    expect(json<RepoInfo>(await get(`/api/repos/${detached?.id}`)).head.branch).toBeNull();
    expect(json<RepoInfo>(await get(`/api/repos/${empty?.id}`))).toMatchObject({ head: { sha: null }, commitCount: 0 });
  });

  it('answers unknown and malformed repository ids with JSON errors', async () => {
    const unknown = await get('/api/repos/0123456789ab');
    expect(unknown.statusCode).toBe(404);
    expect(json(unknown)).toMatchObject({ error: 'repo_not_found' });

    const malformed = await get('/api/repos/..%2F..%2Fetc');
    expect(malformed.statusCode).toBe(400);
    expect(json(malformed)).toMatchObject({ error: 'bad_request' });

    const missing = await get('/api/nope');
    expect(missing.statusCode).toBe(404);
    expect(json(missing)).toMatchObject({ error: 'not_found' });
  });
});

describe('web app', () => {
  it('serves index.html for the root and for deep links', async () => {
    for (const url of ['/', '/history/abc?ref=main']) {
      const response = await get(url, { accept: 'text/html' });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('test-spa');
      expect(response.headers['cache-control']).toBe('no-cache');
    }
  });

  it('serves hashed assets with long-lived caching, and 404s for missing files', async () => {
    const asset = await get('/assets/app-abc123.js');
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await get('/assets/missing.js')).statusCode).toBe(404);
  });

  it('explains when the web app has not been built', async () => {
    const bare = await makeTestApp([repos.linear.dir], { webRoot: null });
    const response = await bare.app.inject({ url: '/', headers: { host: HOST, cookie: await signIn(bare), accept: 'text/html' } });
    expect(response.statusCode).toBe(503);
    expect(response.body).toContain('pnpm build');
    await bare.app.close();
  });
});
