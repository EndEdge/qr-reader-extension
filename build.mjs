import { build } from 'esbuild';
import { cp, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });

// content.js 必须是单文件 IIFE（chrome.scripting 注入不支持模块），
// background / popup 同样整包无动态导入，统一 IIFE 即可。
await Promise.all([
  build({
    entryPoints: ['src/background/index.ts'],
    bundle: true,
    outfile: 'dist/background.js',
    format: 'iife',
    target: 'chrome120',
    minify: true,
  }),
  build({
    entryPoints: ['src/content/index.ts'],
    bundle: true,
    outfile: 'dist/content.js',
    format: 'iife',
    target: 'chrome120',
    minify: true,
  }),
  build({
    entryPoints: ['src/popup/popup.ts'],
    bundle: true,
    outfile: 'dist/popup.js',
    format: 'iife',
    target: 'chrome120',
    minify: true,
  }),
]);

await cp('public', 'dist', { recursive: true });

console.log('build complete: dist/');
