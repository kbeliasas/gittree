import type { AddressInfo } from 'node:net';

import { createApp, type App, type AppOptions } from './app.ts';
import { AUTH_PATH } from './security/guard.ts';

export interface StartOptions extends Omit<AppOptions, 'port'> {
  /** 0 picks a random free port. */
  listenPort: number;
}

export interface RunningServer {
  app: App;
  port: number;
  /** http://127.0.0.1:<port> */
  origin: string;
  /** The one-time sign-in link to open in the browser. */
  authUrl: string;
  close(): Promise<void>;
}

/** Starts gittree on 127.0.0.1 only; nothing else on the network can reach it. */
export async function startServer(options: StartOptions): Promise<RunningServer> {
  const app = await createApp(options);
  await app.listen({ host: '127.0.0.1', port: options.listenPort });
  const { port } = app.server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  return {
    app,
    port,
    origin,
    authUrl: `${origin}${AUTH_PATH}?token=${encodeURIComponent(options.session.token)}`,
    close: () => app.close(),
  };
}
