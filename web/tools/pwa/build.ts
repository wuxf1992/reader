import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Include the actual emitted HTML, CSS, fonts and public assets in one version. */
export function pwa() {
  return {
    name: 'reader-pwa',
    apply: 'build',
    async writeBundle(options) {
      const directory = resolve(options.dir ?? 'dist');
      const files = (await readdir(directory, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name).slice(directory.length + 1).replaceAll('\\', '/'))
        .filter((name) => name !== 'sw.js' && !name.endsWith('.map'))
        .sort();
      // Keep native-shell filenames stable, while browser URLs change with the
      // content. CDN caches may ignore reload/no-cache on fixed asset URLs.
      const revisions = new Map<string, string>();
      for (const file of files.filter(name => /\.(js|css)$/.test(name))) {
        const hash = createHash('sha256').update(await readFile(join(directory, file))).digest('hex').slice(0, 20);
        revisions.set(file, `${file}?v=${hash}`);
      }
      const indexPath = join(directory, 'index.html');
      const index = await readFile(indexPath, 'utf8');
      await writeFile(indexPath, index.replace(/(src|href)="(\.\/)?([^"?]+)"/g, (tag, attribute: string, relative: string | undefined, file: string) => {
        const versioned = revisions.get(file);
        return versioned ? `${attribute}="${relative ?? ''}${versioned}"` : tag;
      }));
      const precache = files.map(file => revisions.get(file) ?? file);
      const template = await readFile(new URL('./sw.js', import.meta.url), 'utf8');
      const digest = createHash('sha256').update(template);
      for (const file of files) digest.update(file).update(await readFile(join(directory, file)));
      const worker = template.replace('__VERSION__', digest.digest('hex').slice(0, 20))
        .replace('__PRECACHE__', JSON.stringify(precache));
      await writeFile(join(directory, 'sw.js'), worker);
    },
  } satisfies Plugin;
}
