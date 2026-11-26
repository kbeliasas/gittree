/** Minimal standalone HTML pages for states where the web app can't load. */
export function messagePage(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)} · gittree</title>
<style>
  :root { color-scheme: light dark; --fg: #1f2328; --muted: #59636e; --bg: #ffffff; --code: #eff2f5; }
  @media (prefers-color-scheme: dark) { :root { --fg: #e6edf3; --muted: #9198a1; --bg: #0d1117; --code: #262c36; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg);
         font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 32rem; padding: 2rem 1.5rem; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  p { margin: 0 0 .75rem; color: var(--muted); }
  code { background: var(--code); padding: .1rem .35rem; border-radius: 4px; color: var(--fg); }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
${message}
</main>
</body>
</html>
`;
}

export const SIGN_IN_HINT =
  '<p>gittree only answers the browser that opened the link printed in your terminal. ' +
  'Run <code>gittree</code> again to get a fresh link.</p>';

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
