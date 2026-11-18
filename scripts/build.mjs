import { createHash } from 'node:crypto';
import { cp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../public/', import.meta.url));
const output = fileURLToPath(new URL('../dist/', import.meta.url));
const worker = 'sw.js';
const assets = (await readdir(source, { recursive: true, withFileTypes: true }))
  .filter(entry => entry.isFile())
  .map(entry => resolve(entry.parentPath, entry.name).slice(source.length))
  .sort();
const digest = createHash('sha256');
for (const asset of assets) {
  digest.update(asset);
  digest.update(await readFile(resolve(source, asset)));
}
const release = digest.digest('hex').slice(0, 16);
const precache = assets
  .filter(asset => asset !== worker && asset !== '_headers')
  .map(asset => asset === 'index.html' ? './' : asset);
const template = await readFile(resolve(source, worker), 'utf8');

await rm(output, { recursive: true, force: true });
await cp(source, output, { recursive: true });
await writeFile(resolve(output, worker), template
  .replace('__RELEASE__', release)
  .replace('__PRECACHE__', JSON.stringify(precache)));

console.log(`Built dist/ (release ${release}, ${precache.length} offline assets)`);
