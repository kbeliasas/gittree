import { z } from 'zod';

import { AUTH_PATH, cookieNameFor } from '../security/guard.ts';
import { messagePage, SIGN_IN_HINT } from '../security/pages.ts';
import type { Session } from '../security/session.ts';
import type { App } from '../app.ts';

/** Swaps the one-time token from the CLI's link for the session cookie, then drops the token from the URL. */
export function authRoutes(app: App, options: { session: Session; port: () => number }): void {
  app.get(
    AUTH_PATH,
    { schema: { querystring: z.object({ token: z.string().max(200).optional() }) } },
    async (request, reply) => {
      const cookieName = cookieNameFor(options.port());
      reply.header('Cache-Control', 'no-store');

      // Opening the link again in a browser that is already signed in just continues.
      if (options.session.isValidCookie(request.cookies[cookieName])) return reply.redirect('/', 302);

      const result = options.session.redeem(request.query.token);
      if ('failure' in result) {
        const title = result.failure === 'used' ? 'This sign-in link was already used' : 'This sign-in link isn’t valid';
        return reply.code(401).type('text/html; charset=utf-8').send(messagePage(title, SIGN_IN_HINT));
      }

      reply.setCookie(cookieName, result.secret, { httpOnly: true, sameSite: 'strict', path: '/' });
      return reply.redirect('/', 302);
    },
  );
}
