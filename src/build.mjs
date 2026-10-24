// esbuild 打包：harness-entry + vendor/folia 的 45 个 folia 原版模块 -> dist/harness.bundle.js。
import { build } from 'esbuild';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.resolve(here, '..');
const foliaSrc = path.join(toolRoot, 'vendor', 'folia', 'src');

await build({
    entryPoints: [path.join(here, 'harness-entry.js')],
    bundle: true,
    outfile: path.join(toolRoot, 'dist', 'harness.bundle.js'),
    format: 'iife',
    platform: 'browser',
    target: ['chrome110'],
    alias: {
        '@': foliaSrc,
        // folia 构建期由 traditionalLocalePlugin 生成的虚拟模块，这里直接用 zh-CN。
        'virtual:folia-locale-zh-TW': path.join(foliaSrc, 'i18n', 'locales', 'zh-CN.ts'),
    },
    loader: { '.ts': 'ts' },
    define: {
        'process.env.NODE_ENV': '"production"',
        '__APP_VERSION__': '"1.0.0"',
    },
    logLevel: 'info',
});
console.log('[build] dist/harness.bundle.js ready');
