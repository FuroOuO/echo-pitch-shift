========================================================================
 EchoMusic 歌曲变调插件 - FFmpeg 辅助程序说明
========================================================================

本插件基于音频流实时转码算法（asetrate + atempo）实现无损升降调。
转码依赖 FFmpeg 命令行工具。

【配置方式（二选一即可）】：

方式一（推荐，随插件便携）：
直接将编译好的 ffmpeg 可执行文件放入当前 bin 文件夹中：
  - Windows 系统：放置 ffmpeg.exe
  - macOS 系统：放置 ffmpeg（赋予可执行权限：chmod +x ffmpeg）
  - Linux 系统：放置 ffmpeg（赋予可执行权限：chmod +x ffmpeg）

方式二（系统全局已安装）：
如果您的操作系统中已经安装过 FFmpeg 并且已经添加到了系统环境变量 (PATH) 中，
插件会自动检测并调用系统中的 ffmpeg，无需在此文件夹放置任何文件。

【官方静态编译免安装版下载链接】：
- Windows (精简版): https://www.gyan.dev/ffmpeg/builds/ (下载 release-essentials.zip 解压其中的 ffmpeg.exe)
- macOS: https://evermeet.cx/ffmpeg/
- Linux: https://johnvansickle.com/ffmpeg/
