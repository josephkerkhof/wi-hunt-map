import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, normalizePath, transformWithOxc, type Plugin } from 'vite';

const workerSource = fileURLToPath(new URL('./src/worker/sw.ts', import.meta.url));

function offlineWorker(): Plugin {
  return {
    name: 'field-hours-offline',
    apply: 'build',
    buildStart() {
      this.addWatchFile(workerSource);
    },
    async writeBundle({ dir }) {
      if (!dir) throw new Error('The offline build requires an output directory');

      const source = await readFile(workerSource, 'utf8');
      const { code } = await transformWithOxc(source, workerSource, { target: 'es2022' });
      const files = await readdir(dir, { recursive: true, withFileTypes: true });

      const paths = files
        .flatMap(file =>
          file.isFile() ? [normalizePath(relative(dir, join(file.parentPath, file.name)))] : [],
        )
        .sort();

      const digest = createHash('sha256').update(code);
      const precache: string[] = [];

      for (const path of paths) {
        if (path === 'sw.js') continue;
        digest.update(path);
        digest.update(await readFile(join(dir, path)));

        if (path !== '_headers') precache.push(path === 'index.html' ? './' : path);
      }

      const release = digest.digest('hex').slice(0, 16);
      const constants = `const RELEASE = ${JSON.stringify(release)};\nconst PRECACHE = ${JSON.stringify(precache)};\n`;
      await writeFile(join(dir, 'sw.js'), constants + code);
    },
  };
}

export default defineConfig({
  base: './',
  server: { host: '127.0.0.1' },
  plugins: [offlineWorker()],
});
