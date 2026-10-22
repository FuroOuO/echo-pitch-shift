# EchoMusic 歌曲变调助手插件 (Echo Pitch Shift)

> 专为 [EchoMusic](https://github.com/hoowhoami/EchoMusic) 打造的实时歌曲升调、降调插件。  
> 采用方案 A（音源拦截 + 本地流式转码代理），无需修改或重新编译播放器客户端即可直接使用。

- **作者**：FuroOuO  
- **当前版本**：1.0.0  
- **适配客户端**：EchoMusic >= 2.2.0  

---

## 一、 功能特性

* 🎵 **平滑变调**：支持 $\pm 6$ 个半音（Semitones）的升降调微调；
* ⚡ **变调不变速**：基于 `asetrate` 与 `atempo` 补偿算法，严格保持原曲节拍速度不变；
* 🎛️ **独立悬浮调节面板**：
  * 精准显示当前曲目、升降半音数及实时频响倍率；
  * 提供 `♭ 降调`、`♯ 升调`、`原调` 快捷按键；
  * 提供 `-3 ~ +3` 常用半音快速切换标签；
  * 优雅的磨砂玻璃悬浮窗风格，支持自由拖拽；
* 📌 **播放栏无缝集成**：在播放栏右侧实时展示当前调号 Badge（如 `原调`、`+1`、`-2`），点击即刻呼出/隐藏调节面板；
* 🛡️ **智能生命周期**：切歌或关闭时自动释放转码子进程与代理连接，不占系统闲置资源。

---

## 二、 运行依赖（FFmpeg 配置）

本插件的实时音频流转码依赖 **FFmpeg**。支持以下任一配置方式：

### 方式 1：随插件便携存放（推荐）
下载官方精简编译版 `ffmpeg.exe`，直接放入本项目下的 `bin` 文件夹即可：
```text
D:\Company\Project\echo-pitch-shift\bin\ffmpeg.exe
```
> **免安装版下载链接**：
> - Windows: [Gyan.dev FFmpeg Builds (release-essentials.zip)](https://www.gyan.dev/ffmpeg/builds/)（解压出 `ffmpeg.exe` 放入 `bin/`）
> - macOS: [Evermeet.cx FFmpeg](https://evermeet.cx/ffmpeg/)
> - Linux: [John Van Sickle FFmpeg](https://johnvansickle.com/ffmpeg/)

### 方式 2：使用系统环境变量
如果你的电脑本身已经安装了 FFmpeg 并在系统环境变量（PATH）中，插件会自动识别并优先调用，无需在 `bin/` 下放置文件。

---

## 三、 安装与使用方式

### 步骤 1：将插件导入 EchoMusic
1. 打开 **EchoMusic** 客户端；
2. 点击左下角 **设置** → **插件管理** → **打开插件目录**；
3. 将本项目文件夹 `echo-pitch-shift` 复制到该目录下（或者使用软链接/快捷方式接入）：
   ```powershell
   # PowerShell 软链接示例（请将路径替换为你的实际插件目录）
   New-Item -ItemType SymbolicLink -Path "$env:APPDATA\EchoMusic\plugins\echo-pitch-shift" -Target "D:\Company\Project\echo-pitch-shift"
   ```

### 步骤 2：启用插件与授权
1. 在 EchoMusic 插件管理列表中找到 **歌曲变调助手**，开启右侧开关；
2. 首次启动时，主程序会弹窗提示请求“本地辅助进程 (process)”权限，点击 **允许**。

### 步骤 3：调节歌曲音调
1. 播放任意歌曲；
2. 在底部播放控制栏右侧会看到 **“歌曲升降调”** 图标与调号徽标；
3. 点击图标呼出调节面板，点击 `♭` 降调或 `♯` 升调，歌曲将即时应用新调号播放！

---

## 四、 核心算法原理

对于半音数偏移量 $N \in [-6, +6]$：
1. 计算音高倍率：$R = 2^{N / 12}$；
2. 重设采样率（升高/降低音调）：$\text{asetrate} = 44100 \times R$；
3. 补偿播放速度（抵消加速/减速，维持原速度）：$\text{atempo} = \frac{1}{R}$；
4. 滤镜组合：`-af "asetrate=44100*R,atempo=(1/R)"`。

该算法完全使用 FFmpeg 原生内置组件，无需第三方扩展，性能稳定可靠。
