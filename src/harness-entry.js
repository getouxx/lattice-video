// folia lattice 歌词渲染 harness（浏览器侧入口）。
// 以 esbuild 打包 vendor/folia 里的 folia 原版模块；只在这里注入确定性帧驱动，不改动 folia 源码。
import { MotionValue } from 'framer-motion';
import { createLatticeLyricRuntime } from '@/components/app/lattice/lyrics/createLatticeLyricRuntime';
import { parseLyricsByFormat } from '@/utils/lyrics/parserCore';
import { detectTimedLyricFormat } from '@/utils/lyrics/formatDetection';

// ---- 确定性 requestAnimationFrame 桩 ----
// folia 的 latticeLyricFrameLoop 默认取全局 requestAnimationFrame；在 init 之前替换它，
// 就能让每一帧由我们显式泵入（等价于逐帧截屏回放），不依赖真实时钟。
const pendingFrames = new Map();
let nextFrameHandle = 1;
let clockMs = 0;
window.requestAnimationFrame = (callback) => {
    const handle = nextFrameHandle++;
    pendingFrames.set(handle, callback);
    return handle;
};
window.cancelAnimationFrame = (handle) => { pendingFrames.delete(handle); };

/** 泵入若干个 60fps 时钟步进，直到动画收敛（folia 的 draw 返回“仍在运动”时会自行续帧）。 */
function pump(maxSteps = 12) {
    let steps = 0;
    while (pendingFrames.size > 0 && steps < maxSteps) {
        const batch = [...pendingFrames.values()];
        pendingFrames.clear();
        clockMs += 1000 / 60;
        for (const callback of batch) {
            try { callback(clockMs); } catch (error) { reportFrameError(error); }
        }
        steps++;
    }
    return pendingFrames.size === 0;
}

const frameErrors = [];
function reportFrameError(error) {
    frameErrors.push(String(error && error.stack || error));
    console.warn('[lattice-video] frame error', error);
}

// ---- 渲染会话状态 ----
let runtime = null;
let input = null;
let host = null;
let lines = [];
let songDuration = 0;

// folia 默认主题的近似值：lattice 海报卡在深色背景上的白字 + 蓝色强调（与 folia classic 主题一致）。
const BASE_THEME = {
    name: 'lattice-video',
    backgroundColor: '#101014',
    primaryColor: '#f4f4f5',
    accentColor: '#60a5fa',
    secondaryColor: '#a1a1aa',
    fontStyle: 'sans',
    fontWeight: 600,
    animationIntensity: 'normal',
    wordColors: [],
};

function lineIndexAt(timeSec) {
    let index = 0;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startTime <= timeSec) index = i; else break;
    }
    return index;
}

window.__lattice = {
    /** 初始化：解析歌词 -> 创建 folia lattice 运行时 -> 收敛首帧。 */
    async init(lrcText, options) {
        const width = options.width, height = options.height;
        const parsed = parseLyricsByFormat(detectTimedLyricFormat(lrcText), lrcText, '', {});
        lines = (parsed && parsed.lines || []).filter(line => line.fullText && line.fullText.trim());
        if (lines.length === 0) throw new Error('歌词解析结果为空：请确认歌词文件含有效时间轴');
        songDuration = lines[lines.length - 1].endTime;

        await (document.fonts ? document.fonts.ready : Promise.resolve());

        const theme = { ...BASE_THEME, ...(options.theme || {}) };
        input = {
            songKey: 'lattice-video',
            currentTime: new MotionValue(0),
            currentLineIndex: 0,
            lines,
            theme,
            subtitleTheme: { ...theme, primaryColor: theme.secondaryColor },
            showSubtitleTranslation: true,
            hideTranslationSubtitle: false,
            subtitleContentMode: 'translation',
            paused: false,
            staticMode: false,
            keywordColoringEnabled: false,
            reducedMotion: false,
            fontsEpoch: 0,
        };

        host = document.createElement('div');
        host.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;overflow:hidden;`;
        document.body.appendChild(host);

        runtime = await createLatticeLyricRuntime(host, input, new AbortController().signal,
            error => reportFrameError(error));
        if (!runtime) throw new Error('lattice 运行时初始化被中止');
        runtime.setVisible(true);
        runtime.resize(width, height, options.dpr || 1);
        pump(30); // 收敛初始布局（字号搜索 + 首个可见行的弹簧）

        const canvas = host.querySelector('canvas');
        return {
            lineCount: lines.length,
            lyricDuration: songDuration,
            canvas: { width: canvas.width, height: canvas.height },
            errors: frameErrors.slice(),
        };
    },

    /** 渲染某个内容时间点，返回该帧的 PNG base64（WebGL 缓冲在同任务内读取，可靠）。 */
    frame(timeSec) {
        if (!runtime) throw new Error('尚未 init');
        input.currentTime.set(Math.max(0, timeSec));
        input.currentLineIndex = lineIndexAt(timeSec);
        pump(12);
        const dataUrl = host.querySelector('canvas').toDataURL('image/png');
        return { png: dataUrl.slice(dataUrl.indexOf(',') + 1), errors: frameErrors.slice() };
    },

    destroy() {
        if (runtime) { try { runtime.destroy(); } catch (error) { reportFrameError(error); } }
        if (host && host.parentNode) host.parentNode.removeChild(host);
        runtime = null; host = null;
    },
};
