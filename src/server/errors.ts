import type { FastifyError, FastifyInstance } from 'fastify';

import { GitError } from './git/errors.ts';

/** Thrown by route handlers for expected failures; becomes `{ error, message }` JSON. */
export class HttpError extends Error {
  override readonly name = 'HttpError';
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | HttpError | GitError, request, reply) => {
    reply.header('Cache-Control', 'no-store');

    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
    if (error instanceof GitError) {
      request.log.warn({ err: error }, 'git command failed');
      const status = error.code === 'GIT_TIMEOUT' ? 504 : error.code === 'GIT_DISALLOWED' ? 403 : 500;
      return reply.code(status).send({ error: error.code.toLowerCase(), message: error.message });
    }
    if (('validation' in error && error.validation) || error.code === 'FST_ERR_VALIDATION') {
      return reply.code(400).send({ error: 'bad_request', message: error.message });
    }
    const status = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'request failed');
      return reply.code(500).send({ error: 'internal_error', message: 'Internal server error.' });
    }
    return reply.code(status).send({ error: error.code ?? 'request_error', message: error.message });
  });
}
