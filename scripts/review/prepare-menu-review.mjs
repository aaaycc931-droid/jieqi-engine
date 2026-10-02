import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(root, 'review-output');
await rm(output, { recursive: true, force: true });
await cp(resolve(root, 'dist'), output, { recursive: true });
await mkdir(resolve(output, 'review/menu-reference'), { recursive: true });
await cp(resolve(root, 'review/menu-reference'), resolve(output, 'review/menu-reference'), { recursive: true });
let html = await readFile(resolve(root, 'web/index.html'), 'utf8');
html = html.replace('</head>', '<link rel="stylesheet" href="../review/menu-reference/menu-reference.css">\n</head>');
const art = `
  <svg class="reference-paper" viewBox="0 620 941 355" preserveAspectRatio="none" aria-hidden="true">
    <image href="../review/menu-reference/approved-menu.png" width="941" height="1672" />
  </svg>
  <div class="reference-header" aria-hidden="true"><img src="../review/menu-reference/approved-menu.png" alt=""></div>
  <div class="reference-footer" aria-hidden="true"><img src="../review/menu-reference/approved-menu.png" alt=""></div>
`;
html = html.replace(/(<section id="main-menu-view"[^>]*>)/, `$1${art}`);
await writeFile(resolve(output, 'web/index.html'), html);
console.log('Reference-only menu review prepared in review-output; Android assets are unchanged.');
