import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pages = readdirSync(root).filter((file) => file.endsWith('.html'));
const missing = [];
const check = (file, url) => {
  if (!url || /^(?:https?:|data:|mailto:|tel:|#|\/\/)/i.test(url)) return;
  const path = decodeURIComponent(url.split(/[?#]/, 1)[0]).replace(/^\//, '');
  if (!path || !extname(path)) return;
  if (!existsSync(resolve(root, path)) && !existsSync(resolve(root, 'public', path))) {
    missing.push(`${file}: ${url}`);
  }
};
for (const page of pages) {
  const html = readFileSync(resolve(root, page), 'utf8');
  for (const match of html.matchAll(/\b(?:href|src|poster)="([^"]+)"/g)) check(page, match[1]);
}
const css = readFileSync(resolve(root, 'styles.css'), 'utf8');
for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) check('styles.css', match[1]);
const atlas = JSON.parse(readFileSync(resolve(root, 'backend', 'atlas-data.json'), 'utf8'));
for (const place of atlas.places) check(`atlas:${place.id}`, place.image);
for (const place of atlas.places) {
  if (!pages.includes(`place-${place.id}.html`) || !atlas.quizzes[place.id]?.length) {
    missing.push(`atlas:${place.id}: page or quiz missing`);
  }
}
if (missing.length) {
  console.error(`Missing resources (${missing.length}):\n${missing.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`${pages.length} pages, ${atlas.places.length} places and their local assets are present.`);
}
