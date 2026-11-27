import { expose } from 'comlink';
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { bundledLanguages, bundledLanguagesInfo } from 'shiki/langs';
import { bundledThemes } from 'shiki/themes';

import type { Highlighted, TokenStyle } from './highlight.ts';
import { languageFor } from './language.ts';

/**
 * Syntax highlighting off the main thread (PLAN §9: Shiki, grammars loaded
 * on demand). The JavaScript regex engine needs no WebAssembly, so the page's
 * Content-Security-Policy stays as strict as it is.
 */
const THEMES = { light: 'github-light', dark: 'github-dark' } as const;
/** Longer lines stay plain: tokenizing minified code is slow and useless. */
const MAX_LINE_LENGTH = 2_000;

const canonical = new Map<string, string>();
for (const info of bundledLanguagesInfo) {
  canonical.set(info.id, info.id);
  for (const alias of info.aliases ?? []) canonical.set(alias, info.id);
}

let highlighter: Promise<HighlighterCore> | undefined;

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [bundledThemes[THEMES.light](), bundledThemes[THEMES.dark]()],
    langs: [],
    // Skip the rare grammar patterns JavaScript regexes can't express instead of failing the whole file.
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return highlighter;
}

const api = {
  /** Highlights each text as `path`'s language; null when it is plain text. */
  async highlight(path: string, texts: readonly string[]): Promise<Highlighted | null> {
    const lang = languageFor(path, (id) => canonical.get(id) ?? null);
    if (lang === null) return null;
    const core = await getHighlighter();
    if (!core.getLoadedLanguages().includes(lang)) {
      const load = bundledLanguages[lang as keyof typeof bundledLanguages];
      if (!load) return null;
      await core.loadLanguage(load);
    }

    const styles: TokenStyle[] = [];
    const styleIds = new Map<string, number>();
    const styleOf = (light: string, dark: string, fontStyle: number) => {
      const key = `${light}|${dark}|${fontStyle}`;
      let id = styleIds.get(key);
      if (id === undefined) {
        id = styles.push({ light, dark, ...(fontStyle & 1 ? { italic: true } : {}), ...(fontStyle & 2 ? { bold: true } : {}) }) - 1;
        styleIds.set(key, id);
      }
      return id;
    };

    const lines = texts.map((text) =>
      core
        .codeToTokensWithThemes(text, { lang, themes: THEMES, tokenizeMaxLineLength: MAX_LINE_LENGTH, tokenizeTimeLimit: 300 })
        .map((tokens) => {
          const flat: number[] = [];
          for (const token of tokens) {
            const light = token.variants.light;
            const dark = token.variants.dark;
            const style = styleOf(light?.color ?? '', dark?.color ?? '', light?.fontStyle ?? 0);
            // Merge neighbours with the same style: fewer spans to render.
            if (flat.length > 0 && flat[flat.length - 1] === style) flat[flat.length - 2]! += token.content.length;
            else flat.push(token.content.length, style);
          }
          return flat;
        }),
    );
    return { lang, styles, lines };
  },
};

export type HighlightWorkerApi = typeof api;

expose(api);
