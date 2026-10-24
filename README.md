# folia-lattice-video

把 **folia-major** 音乐播放器的 **lattice 歌词播放样式** 提取成的独立离线渲染工具：导入一个音乐文件 + 一个歌词文件，按 folia 原版渲染管线从头到尾逐帧绘制歌词动画（等价于播放时录屏），最后导出为带音轨的 **MP4** 视频。

![](docs/example-frame.png)

## 效果特征（与 folia 原版一致）

以下全部来自 folia 源码 `src/components/app/lattice/lyrics/` 的**原版模块**，不是重新实现：

- **逐句卡拉 OK 扫光**：当前行按 `word` 级时间轴从左到右点亮，扫光边缘带软化渐变（`latticeLyricFilters.ts` 的 sweep shader，逐像素与 folia 相同）；
- **三行层次**：已唱行缩小变淡在上、当前行放大加粗居中、未唱行缩小变淡在下，弹簧插值滚动（`MONET_SCROLL_SPRING` / `MONET_SCALE_SPRING`）；
- **间奏圆点**：`......` 间奏行按 folia 的 `INTERLUDE_FULL_TEXT` 语义渲染成节奏圆点；
- **字号自适应**：`resolveLatticeTypography` 在 64→24px 区间按"歌词预算"搜索字号，长句自动折行（`layoutLatticeLine`）；
- **歌词解析**：走 folia 自己的 `parseLyricsByFormat`（支持 `.lrc` / 逐字增强 lrc / `.vtt` / `.yrc` / `.qrc` 等），时间轴语义与播放器内完全一致。

## 环境要求

| 组件 | 说明 |
| --- | --- |
| Node.js ≥ 18 | 加入 PATH，或保留本工具同级的便携版 `dl\node\...`（脚本会自动探测） |
| Chrome 或 Edge | 任一即可；渲染在无头模式 + WebGL（无 GPU 时用 SwiftShader 软件渲染）下进行 |
| ffmpeg | 加入 PATH，或 `pip install imageio-ffmpeg`（脚本自动探测两者） |

依赖 npm 包首次运行时自动安装（约 30 个，无 electron 等重型包）。

## 用法

### 一键（推荐）

```powershell
.\render.ps1 -Audio "歌曲.mp3" -Lyric "歌词.lrc"                    # 输出 歌曲.lattice.mp4
.\render.ps1 -Audio "歌曲.mp3" -Lyric "歌词.lrc" -Cover "封面.jpg"    # 用封面做模糊背景
.\render.ps1 -Audio "歌曲.mp3" -Lyric "歌词.lrc" -Output "成片.mp4" -Fps 60 -Width 1920 -Height 1080
```

Windows 下也可以把「音频 + 歌词」两个文件直接拖到 `render.cmd` 上。

### 手动（分步）

```bash
npm install          # 首次
npm run build        # esbuild 打包 folia 渲染模块 -> dist/harness.bundle.js
npm run render -- 歌曲.mp3 歌词.lrc 输出.mp4 --fps 30 --width 1280 --height 720 --cover 封面.jpg
```

### 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--fps` | 30 | 输出帧率（动画始终按 60Hz 物理步进，只是采样输出） |
| `--width` / `--height` | 1280 × 720 | 输出分辨率，需为偶数 |
| `--cover` | 无 | 背景图（自动铺满+模糊压暗）；不给则用深色渐变背景 |

## 工作原理

```
歌词文件 ──> folia parseLyricsByFormat（原版解析, 秒为单位时间轴）
                │
                ▼
harness-entry.js：MotionValue 时间轴 + 确定性 requestAnimationFrame 帧泵
                │   （注入全局 rAF 桩，每帧显式推进 60Hz 时钟并收敛弹簧，
                │    等价于逐帧截屏回放，结果完全可复现）
                ▼
headless Chrome (WebGL/SwiftShader) 内运行 folia 原版 lattice 运行时
                │   vendor/folia/ 下 45 个源文件与上游逐字节一致（见"差异说明"）
                ▼
PNG 帧序列（1280×720, 每帧 canvas 直读）
                │
                ▼
ffmpeg：渐变/封面背景 + 帧序列 + 原始音频 → libx264 + aac MP4
```

- **离线逐帧渲染**而非实时录屏：时长精确等于音频（±0.05s）、画质无损、可复现；117s 成片实测约 205s 渲染完成（1280×720@30fps，软件渲染环境）；
- 时间轴、弹簧、扫光全部由 folia 源码计算；本工具只提供「喂时间 + 截图」的外壳。

## 目录结构

```
lattice-video/
├─ render.ps1 / render.cmd     一键脚本（依赖检查 + 打包 + 渲染 + 合成）
├─ package.json                依赖清单（pixi.js 8 / framer-motion / pretext 等）
├─ vendor/folia/src/           folia 渲染闭包 45 个源文件（原样拷贝，见差异说明）
├─ src/
│  ├─ harness-entry.js         浏览器侧入口：解析歌词、驱动 lattice 运行时、逐帧泵
│  ├─ build.mjs                esbuild 打包（@ 别名 -> vendor/folia/src）
│  ├─ render.mjs               Playwright 驱动 + 帧序列 + ffmpeg 合成 + 自检
│  └─ smoke.mjs                冒烟测试（抽 4 帧人工检查样式）
├─ dist/harness.bundle.js      打包产物（构建时生成）
├─ output/                     默认输出目录
└─ .render-work/               中间帧与临时文件（渲染后可整目录删除）
```

## 差异说明（相对 folia 上游）

`vendor/folia/src/` 中的文件与 folia-major 上游**逐字节一致**，只有两处带 `[lattice-video 兼容补丁]` 注释的最小改动，均针对无 GPU 的软件渲染环境：

1. `createLatticeLyricRuntime.ts`：`antialias: true → false`。
   SwiftShader 下 MSAA 纹理 resolve 会产生噪点；此样式全部为纹理贴图四边形，MSAA 无实际画质收益。
2. `latticeLyricScene.ts`：停用两层 `BlurFilter`（光晕层 near/far + 景深层 container）。
   实测 SwiftShader 下 pixi v8 的 BlurFilter 渲染纹理采样会输出噪点块。
   **在有真实 GPU 的机器上如需恢复**：把该文件 `latticeLyricScene.ts` 第 26–28 行恢复为上游原样
   （`near.filters = [...]` / `far.filters = [...]` / `container.filters = [blur]`）并 `npm run build` 即可，
   景深/光晕会随真实 GPU 一起回来；无 GPU 机器请保持补丁状态。

其余行为——时间轴、弹簧、扫光 shader、排版、层次缩放淡入淡出——与 folia 完全一致。

### 上游同步记录

`vendor/folia/src/` 已与上游 `chthollyphile/folia-major` **main 分支提交
`1f6d0f468f5bc81b23a8b40ad7ca96ccd4b1ecbe`**（2026-10-24）逐文件核对：

| 项 | 结果 |
| --- | --- |
| vendored 文件总数 | 45 |
| 与上游逐字节一致 | 43 |
| 仅因本工具补丁而不同 | 2（即上面两处） |

同步时上游新增的 9 个文件差异（`types.ts`、`types/onlineMusic.ts`、`visualizer/definition.ts`、
`visualizer/backgrounds/definition.ts`、`utils/appPlaybackGuards.ts`、`utils/lyrics/lyricSources.ts`、
`i18n/locales/{en,in,zh-CN}.ts`）**均为与 lattice 渲染无关的功能新增**（智能动感/beat FX、歌曲交接
songHandoff、personal FM、翻译文案），已并入 vendor。

**A/B 字节级验证**：用同步前的 vendor 与同步后的 vendor 各自打包，渲染同一批时间点（t=1/8/20/40s），
输出 PNG **逐字节完全相同**——即本次同步对渲染结果零影响。

复现核对（需能访问 GitHub）：`python compare-vendor.py`（读取上游 tree 的 blob SHA 与本地
`git hash-object` 比对，无需下载整个仓库）。

## 支持的歌词格式

走 folia 原版解析器，按内容自动识别（`detectTimedLyricFormat`）：

- `.lrc`（普通逐句）
- 增强 LRC（`<00:12.34>` 逐字时间轴、`[00:12.34]` 内联逐字）
- `.vtt`
- `.yrc` / `.qrc` / `.krc` / `.awlrc` / `.ttml`（按扩展名）

逐字（word-by-word）歌词会呈现完整的逐字扫光；只有逐句时间轴时按整行进度扫光。

## 验证记录（验收样例）

样例：`索瑞・Sorey - Per Te（New Version）`（mp3 117.45s + lrc 26 行）

- 输出 `output/PerTe.lattice.mp4`：117.47s，H.264 High 1280×720@30fps，AAC 44.1kHz 立体声，5.6MB ✅
- 抽帧与 LRC 时间轴比对：
  - t=8.0s：`stringimi forte amore`（7.41–9.30s）处于激活行且扫光进行到约 1/3 ✅
  - t=70.0s：`perché il cuore…`（63.35s 起）激活，`una vita…`（70.51s 起）未唱在下 ✅
  - t=110.0s：`scritto da una penna senza inchiostro`（106.33s 起）激活，上下行层次正确 ✅
- 全曲 3524 帧渲染无 JS 错误（0 errors），渲染耗时约 205s（约为实时的 0.6 倍）。

## 许可

folia-major 源码遵循 AGPL-3.0；`vendor/folia/` 内的拷贝同样受 AGPL-3.0 约束，派生使用请遵守其条款。
