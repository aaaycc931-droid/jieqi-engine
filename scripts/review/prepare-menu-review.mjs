import { cp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(root, 'review-output');
await rm(output, { recursive: true, force: true });
await cp(resolve(root, 'dist'), output, { recursive: true });
await cp(resolve(root, 'review/menu-reference'), resolve(output, 'review/menu-reference'), { recursive: true });
console.log('Review copy now uses the adopted runtime homepage; no duplicate art or controls are injected.');
