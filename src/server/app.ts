import fastifyCookie from '@fastify/cookie';
import Fastify, {
  LogController,
  type FastifyBaseLogger,
  type FastifyInstance,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
} from 'fastify';
import type { AddressInfo } from 'node:net';

import { installErrorHandler } from './errors.ts';
import type { GitRunner } from './git/runner.ts';
import { consoleLogger, redactToken } from './logger.ts';
import type { RepoRegistry } from './repos/registry.ts';
import { authRoutes } from './routes/auth.ts';
import { graphRoutes } from './routes/graph.ts';
import { healthRoutes } from './routes/health.ts';
import { repoRoutes } from './routes/repos.ts';
import { installGuard } from './security/guard.ts';
import type { Session } from './security/session.ts';
import { registerWeb } from './web.ts';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from './zod.ts';

export type App = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  FastifyBaseLogger,
  ZodTypeProvider
>;

export interface AppOptions {
  git: GitRunner;
  gitVersion: string;
  registry: RepoRegistry;
  session: Session;
  /** Folder with the built web app (index.html + assets); null serves an explanatory page instead. */
  webRoot: string | null;
  /** Port clients use, for the Host check. Defaults to the listening port; inject()-based tests set it. */
  port?: number;
  /** Extra Origin values to accept (the Vite dev server in `pnpm dev`). */
  extraOrigins?: readonly string[];
  /** Print one line per request (tokens redacted). */
  logRequests?: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Every registered route as "METHOD /url"; lets tests insist that each endpoint is covered. */
    gittreeRoutes: readonly string[];
  }
}

export async function createApp(options: AppOptions): Promise<App> {
  const fastify = Fastify({
    loggerInstance: consoleLogger('warn'),
    // Fastify's own request logs would include /auth?token=…; logRequests below redacts it.
    logController: new LogController({ disableRequestLogging: true }),
  });

  const routes: string[] = [];
  fastify.decorate('gittreeRoutes', routes);
  fastify.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) routes.push(`${method} ${route.url}`);
  });

  const port = () => options.port ?? (fastify.server.address() as AddressInfo | null)?.port ?? 0;

  await fastify.register(fastifyCookie); // parses cookies in its own onRequest hook, before the guard runs
  installGuard(fastify, { session: options.session, port, extraOrigins: options.extraOrigins });
  installErrorHandler(fastify);
  if (options.logRequests) {
    fastify.addHook('onResponse', async (request, reply) => {
      const ms = reply.elapsedTime.toFixed(0);
      process.stdout.write(`${request.method} ${redactToken(request.url)} ${reply.statusCode} ${ms}ms\n`);
    });
  }

  const app: App = fastify.withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  authRoutes(app, { session: options.session, port });
  healthRoutes(app, { gitVersion: options.gitVersion });
  repoRoutes(app, { git: options.git, registry: options.registry });
  graphRoutes(app, { git: options.git, registry: options.registry });
  await registerWeb(fastify, { webRoot: options.webRoot });

  return app;
}
