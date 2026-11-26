import type { ServerResponse } from 'node:http';

/**
 * Aborts when the client disconnects before the response is complete, so git
 * work for an abandoned request is killed. (The request's own 'close' event
 * fires as soon as its body is read, so the response is what has to be watched.)
 */
export function clientGoneSignal(response: ServerResponse): AbortSignal {
  const controller = new AbortController();
  response.once('close', () => {
    if (!response.writableFinished) controller.abort();
  });
  return controller.signal;
}
