// 驱动端：headless Chrome (WebGL) 逐帧渲染 lattice 歌词动画 -> PNG 序列 -> ffmpeg 合成带音轨的 MP4。
// 用法: node src/render.mjs <音频文件> <歌词文件(.lrc等)> [输出.mp4] [--fps 30] [--width 1280] [--height 720] [--cover 封面图]
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.resolve(here, '..');
const BUNDLE = path.join(toolRoot, 'dist', 'harness.bundle.js');

// ---- 参数解析 ----
const argv = process.argv.slice(2);
const positional = [];
const flags = {};
for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
        const key = argv[i].slice(2);
        flags[key] = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
    } else positional.push(argv[i]);
}
if (positional.length < 2) {
    console.error('用法: node src/render.mjs <音频文件> <歌词文件> [输出.mp4] [--fps 30] [--width 1280] [--height 720] [--cover 封面.png|jpg]');
    process.exit(2);
}
const audioPath = path.resolve(positional[0]);
const lyricPath = path.resolve(positional[1]);
const outputMp4 = path.resolve(positional[2] || path.join(toolRoot, 'output', path.parse(audioPath).name + '.lattice.mp4'));
const FPS = Math.max(1, Number(flags.fps) || 30);
const WIDTH = Math.max(64, Number(flags.width) || 1280);
const HEIGHT = Math.max(64, Number(flags.height) || 720);
const COVER = flags.cover ? path.resolve(String(flags.cover)) : null;

for (const p of [audioPath, lyricPath]) if (!fs.existsSync(p)) { console.error('文件不存在:', p); process.exit(2); }
if (!fs.existsSync(BUNDLE)) { console.error('缺少 dist/harness.bundle.js，请先运行 npm run build'); process.exit(2); }

// ---- ffmpeg / Chrome 定位 ----
function findFfmpeg() {
    if (process.env.FFMPEG && fs.existsSync(process.env.FFMPEG)) return process.env.FFMPEG;
    const probe = spawnSync('where', ['ffmpeg'], { encoding: 'utf8' });
    if (probe.status === 0 && probe.stdout.trim()) return probe.stdout.trim().split(/\r?\n/)[0];
    // imageio-ffmpeg 的自带二进制
    const py = spawnSync('python', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' });
    if (py.status === 0 && py.stdout.trim()) return py.stdout.trim();
    throw new Error('找不到 ffmpeg：请安装 ffmpeg 或 pip install imageio-ffmpeg，也可设置环境变量 FFMPEG');
}
function findChrome() {
    if (process.env.CHROME && fs.existsSync(process.env.CHROME)) return process.env.CHROME;
    for (const candidate of [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ]) if (fs.existsSync(candidate)) return candidate;
    return null; // 回退到 playwright 自带 chromium
}
const FFMPEG = findFfmpeg();
const CHROME = findChrome();

/** 从 `ffmpeg -i` 的 stderr 里读时长（秒）。 */
function probeDurationSeconds(file) {
    const probe = spawnSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' });
    const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(probe.stderr || '');
    if (!m) throw new Error('无法读取媒体时长: ' + file);
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// ---- 主流程 ----
const workDir = path.join(toolRoot, '.render-work', path.parse(audioPath).name);
const framesDir = path.join(workDir, 'frames');
fs.rmSync(workDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });

console.log(`[render] 音频: ${audioPath}`);
console.log(`[render] 歌词: ${lyricPath}`);
console.log(`[render] ${WIDTH}x${HEIGHT} @ ${FPS}fps, ffmpeg=${FFMPEG}`);
if (CHROME) console.log(`[render] Chrome: ${CHROME}`);

const lrcText = fs.readFileSync(lyricPath, 'utf8');
const audioDuration = probeDurationSeconds(audioPath);
const totalFrames = Math.ceil(audioDuration * FPS);
console.log(`[render] 音频时长 ${audioDuration.toFixed(2)}s -> ${totalFrames} 帧`);

const browser = await chromium.launch({
    executablePath: CHROME || undefined,
    headless: true,
    args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--enable-unsafe-swiftshader',
        '--use-angle=swiftshader',
        '--force-device-scale-factor=1',
        '--hide-scrollbars',
        '--force-color-profile=srgb',
    ],
});
try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
    page.on('console', msg => { if (msg.type() === 'error' || msg.type() === 'warning') console.log('[page]', msg.text()); });
    page.on('pageerror', err => console.error('[pageerror]', err));
    // about:blank 下 localStorage 被禁，i18n 初始化会抛错；用本地 http 源。
    const origin = await new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<!DOCTYPE html><html><head><meta charset="utf-8"><title>lattice</title></head><body></body></html>');
        });
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/`));
        page.on('close', () => server.close());
    });
    await page.goto(origin);
    await page.addScriptTag({ content: fs.readFileSync(BUNDLE, 'utf8') });

    const info = await page.evaluate(
        ([lrc, opts]) => window.__lattice.init(lrc, opts),
        [lrcText, { width: WIDTH, height: HEIGHT, dpr: 1 }]);
    console.log(`[render] 运行时就绪: ${info.lineCount} 行歌词, canvas ${info.canvas.width}x${info.canvas.height}`);
    if (info.errors.length) console.warn('[render] init 错误:', info.errors);

    // WebGL 上下文自检
    const gl = await page.evaluate(() => {
        const c = document.createElement('canvas');
        const g = c.getContext('webgl2') || c.getContext('webgl');
        if (!g) return 'NO-WEBGL';
        const dbg = g.getExtension('WEBGL_debug_renderer_info');
        return dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER);
    });
    console.log(`[render] WebGL renderer: ${gl}`);

    // 逐帧渲染（每批 10 帧一次 RPC，降低通道开销）
    const started = Date.now();
    const BATCH = 10;
    for (let start = 0; start < totalFrames; start += BATCH) {
        const times = [];
        for (let i = start; i < Math.min(start + BATCH, totalFrames); i++) times.push(i / FPS);
        const frames = await page.evaluate((list) => list.map(t => window.__lattice.frame(t)), times);
        for (let k = 0; k < frames.length; k++) {
            const index = start + k;
            fs.writeFileSync(
                path.join(framesDir, `frame_${String(index).padStart(6, '0')}.png`),
                Buffer.from(frames[k].png, 'base64'));
            if (frames[k].errors.length) console.warn(`[render] frame ${index} 错误:`, frames[k].errors);
        }
        if (start % (BATCH * 20) === 0 || start + BATCH >= totalFrames) {
            const done = Math.min(start + BATCH, totalFrames);
            const elapsed = (Date.now() - started) / 1000;
            console.log(`[render] ${done}/${totalFrames} 帧 (${(done / totalFrames * 100).toFixed(0)}%, ${elapsed.toFixed(0)}s)`);
        }
    }
} finally {
    await browser.close();
}

// ---- ffmpeg 合成 ----
console.log('[render] ffmpeg 合成 MP4...');
fs.mkdirSync(path.dirname(outputMp4), { recursive: true });
const filterParts = [];
if (COVER) {
    // 封面铺满 -> 高斯模糊压暗做背景，贴合 folia 海报卡的观感
    filterParts.push(`[1:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},boxblur=luma_radius=24:luma_power=2,eq=brightness=-0.28:saturation=0.85[bg]`);
} else {
    filterParts.push(`gradients=s=${WIDTH}x${HEIGHT}:c0=0x181822:c1=0x0b0b10:x0=0:y0=0:x1=${WIDTH}:y1=${HEIGHT}:d=1[bg]`);
}
filterParts.push(`[bg][0:v]overlay=0:0:format=auto,format=yuv420p[v]`);

const ffArgs = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-framerate', String(FPS), '-start_number', '0',
    '-i', path.join(framesDir, 'frame_%06d.png'),
];
if (COVER) ffArgs.push('-i', COVER);
ffArgs.push(
    '-i', audioPath,
    '-filter_complex', filterParts.join(';'),
    '-map', '[v]', '-map', `${COVER ? 2 : 1}:a`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k',
    '-t', audioDuration.toFixed(3),
    '-movflags', '+faststart',
    outputMp4);
const encode = spawnSync(FFMPEG, ffArgs, { encoding: 'utf8' });
if (encode.status !== 0) {
    console.error(encode.stderr);
    throw new Error('ffmpeg 合成失败');
}

// ---- 自检 ----
const outDuration = probeDurationSeconds(outputMp4);
const report = spawnSync(FFMPEG, ['-hide_banner', '-i', outputMp4], { encoding: 'utf8' });
const videoLine = (report.stderr || '').split(/\r?\n/).find(l => l.includes('Video:')) || '';
const audioLine = (report.stderr || '').split(/\r?\n/).find(l => l.includes('Audio:')) || '';
console.log('[verify] 输出时长:', outDuration.toFixed(2) + 's', '(音频', audioDuration.toFixed(2) + 's)');
console.log('[verify]', videoLine.trim());
console.log('[verify]', audioLine.trim());
const ok = Math.abs(outDuration - audioDuration) < 1.0 && videoLine.includes('h264') && audioLine.includes('aac');
console.log(ok ? `[render] ✅ 完成: ${outputMp4}` : `[render] ⚠️ 校验异常: ${outputMp4}`);
process.exit(ok ? 0 : 1);
