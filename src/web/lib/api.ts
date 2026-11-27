import type { z } from 'zod';

import { ApiErrorBody } from '../../shared/api.ts';

/** The session cookie is missing or stale: the user needs a fresh link from the terminal. */
export class SignedOutError extends Error {
  override readonly name = 'SignedOutError';
}

export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** GETs a JSON endpoint and checks the response against its shared schema. */
export async function getJson<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' }, signal });
  if (response.status === 401) throw new SignedOutError('Signed out');
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ApiErrorBody.safeParse(body);
    throw parsed.success
      ? new ApiError(response.status, parsed.data.error, parsed.data.message)
      : new ApiError(response.status, 'http_error', `${response.status} ${response.statusText}`);
  }
  return schema.parse(body);
}

/**
 * Reads a newline-delimited JSON stream, checking each line against its shared schema. An error
 * answer before the stream starts throws like getJson; aborting `signal` ends the stream.
 */
export async function* streamJson<T>(path: string, schema: z.ZodType<T>, signal: AbortSignal): AsyncGenerator<T> {
  const response = await fetch(path, { headers: { accept: 'application/x-ndjson' }, signal });
  if (response.status === 401) throw new SignedOutError('Signed out');
  if (!response.ok || !response.body) {
    const body: unknown = await response.json().catch(() => null);
    const parsed = ApiErrorBody.safeParse(body);
    throw parsed.success
      ? new ApiError(response.status, parsed.data.error, parsed.data.message)
      : new ApiError(response.status, 'http_error', `${response.status} ${response.statusText}`);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      for (let newline = buffer.indexOf('\n'); newline !== -1; newline = buffer.indexOf('\n')) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim() !== '') yield schema.parse(JSON.parse(line));
      }
    }
    if (buffer.trim() !== '') yield schema.parse(JSON.parse(buffer));
  } finally {
    reader.cancel().catch(() => {});
  }
}
