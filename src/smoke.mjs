// 冒烟测试：只渲染几个时间点的帧，确认 lattice 样式正确后再跑全曲。
import { chromium } from 'playwright';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.resolve(here, '..');
const BUNDLE = path.join(toolRoot, 'dist', 'harness.bundle.js');
const LRC = 'C:/Users/admin/Downloads/索瑞・Sorey - Per Te（New Version）_657219724.lrc';
const OUT = path.join(toolRoot, '.render-work', 'smoke');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
// 本地 http 源：about:blank / data: URL 下 localStorage 被禁，i18n 初始化会抛错。
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!DOCTYPE html><html><head><meta charset="utf-8"><title>lattice</title></head><body></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}/`;

try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', m => console.log('[page:' + m.type() + ']', m.text()));
    page.on('pageerror', e => console.error('[pageerror]', e.message));
    await page.goto(origin);
    await page.addScriptTag({ content: fs.readFileSync(BUNDLE, 'utf8') });
    const info = await page.evaluate(
        lrc => window.__lattice.init(lrc, { width: 1280, height: 720, dpr: 1 }),
        fs.readFileSync(LRC, 'utf8'));
    console.log('init:', JSON.stringify(info));
    const gl = await page.evaluate(() => {
        const c = document.createElement('canvas');
        const g = c.getContext('webgl2') || c.getContext('webgl');
        if (!g) return 'NO-WEBGL';
        const dbg = g.getExtension('WEBGL_debug_renderer_info');
        return dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER);
    });
    console.log('WebGL:', gl);
    for (const t of [1.0, 8.0, 20.0, 40.0]) {
        const r = await page.evaluate(time => window.__lattice.frame(time), t);
        const file = path.join(OUT, `smoke_${t.toFixed(1)}.png`);
        fs.writeFileSync(file, Buffer.from(r.png, 'base64'));
        console.log('frame', t, '->', file, 'errors:', r.errors.length);
    }
} finally {
    await browser.close();
    server.close();
}
console.log('SMOKE DONE');
