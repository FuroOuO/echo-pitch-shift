// EchoMusic 歌曲变调助手插件
// 作者：FuroOuO

let currentSemitones = 0;
let activeFfmpegPid = null;
let streamPortCounter = 39300;
let lastCmdTime = 0;
let pollTimer = null;
let activePopoverEl = null;

export function activate(ctx) {
  // -------------------------------------------------------------
  // 1. 状态辅助读取 (兼容 Pinia Store 与 Vue 响应式 Ref)
  // -------------------------------------------------------------
  function getCurrentTrack() {
    const store = ctx.player?.store;
    if (store?.currentTrackSnapshot) return store.currentTrackSnapshot;
    const trackRef = ctx.player?.currentTrack;
    return trackRef?.value || trackRef || null;
  }

  function getCurrentTrackId() {
    const store = ctx.player?.store;
    if (store?.currentTrackId) return String(store.currentTrackId);
    const idRef = ctx.player?.currentTrackId;
    const val = idRef?.value ?? idRef;
    return val ? String(val) : "";
  }

  function getCurrentTime() {
    const store = ctx.player?.store;
    if (typeof store?.currentTime === "number") return store.currentTime;
    const timeRef = ctx.player?.currentTime;
    const val = timeRef?.value ?? timeRef;
    return typeof val === "number" ? val : 0;
  }

  function getIsPlaying() {
    const store = ctx.player?.store;
    if (typeof store?.isPlaying === "boolean") return store.isPlaying;
    const playRef = ctx.player?.isPlaying;
    const val = playRef?.value ?? playRef;
    return Boolean(val);
  }

  // -------------------------------------------------------------
  // 2. 主辅窗口跨进程通信 (通过 electron-store 轮询同步，避开 Chromium file:// 隔离)
  // -------------------------------------------------------------
  async function syncStateToStorage() {
    try {
      const track = getCurrentTrack();
      const title = track?.title || track?.name || "";
      const artist =
        track?.artist ||
        (Array.isArray(track?.artists) ? track.artists.map((a) => a.name).join("/") : "");

      await ctx.storage?.set?.("pitch_state", {
        semitones: currentSemitones,
        title,
        artist,
        isPlaying: getIsPlaying(),
        t: Date.now(),
      });
    } catch {}
  }

  async function checkExternalCommand() {
    try {
      const cmd = await ctx.storage?.get?.("pitch_cmd");
      if (cmd && typeof cmd === "object" && cmd.t && cmd.t > lastCmdTime) {
        lastCmdTime = cmd.t;
        if (typeof cmd.semitones === "number") {
          setPitch(cmd.semitones);
        }
      }
    } catch {}
  }

  pollTimer = setInterval(() => {
    checkExternalCommand();
    syncStateToStorage();
  }, 180);

  // -------------------------------------------------------------
  // 3. 注册音频源拦截转换器 (audioSource.register)
  // -------------------------------------------------------------
  if (ctx.player?.audioSource?.register) {
    ctx.player.audioSource.register({
      id: "echo-pitch-shift-source",
      order: 1000,
      match() {
        return currentSemitones !== 0;
      },
      async transform({ source }) {
        if (!source?.url || currentSemitones === 0) {
          return null;
        }

        // 避免自身转码流循环拦截
        if (source.url.includes("/pitch-stream.mp3")) {
          return null;
        }

        // 终止上一次转码进程
        if (activeFfmpegPid) {
          try {
            await ctx.process?.terminate?.(activeFfmpegPid);
          } catch {}
          activeFfmpegPid = null;
        }

        // 计算升降调参数 (半音比例)
        const ratio = Math.pow(2, currentSemitones / 12);
        const sampleRate = Math.round(44100 * ratio);
        const tempo = (1 / ratio).toFixed(6);
        const filter = `asetrate=${sampleRate},atempo=${tempo}`;

        // 轮转本地端口 (39300 - 39800)
        streamPortCounter = 39300 + ((streamPortCounter - 39300 + 1) % 500);
        const port = streamPortCounter;

        const ffmpegArgs = [
          "-hide_banner",
          "-loglevel", "error",
          "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "-reconnect", "1",
          "-reconnect_streamed", "1",
          "-reconnect_delay_max", "5",
          "-i", source.url,
          "-af", filter,
          "-c:a", "libmp3lame",
          "-b:a", "320k",
          "-f", "mp3",
          "-listen", "1",
          `http://127.0.0.1:${port}/pitch-stream.mp3`,
        ];

        try {
          const launchRes = await ctx.process?.launch?.({
            executable: "bin/ffmpeg.exe",
            args: ffmpegArgs,
          });

          if (!launchRes?.ok) {
            console.warn("[echo-pitch-shift] 启动转码进程失败:", launchRes?.error);
            if (launchRes?.canceled) {
              ctx.toast?.warning?.("【变调助手】已取消启动本地转码，变调暂未生效");
            } else {
              ctx.toast?.error?.(`【变调助手】转码进程启动失败: ${launchRes?.error || "未知原因"}`);
            }
            return null;
          }

          activeFfmpegPid = launchRes.pid;

          // 短暂等待 socket 端口完成监听绑定
          await new Promise((resolve) => setTimeout(resolve, 150));

          const streamUrl = `http://127.0.0.1:${port}/pitch-stream.mp3`;
          return {
            url: streamUrl,
            urls: [streamUrl, ...(source.urls || [])],
          };
        } catch (err) {
          console.error("[echo-pitch-shift] 拦截转换异常:", err);
          return null;
        }
      },
    });
  }

  // -------------------------------------------------------------
  // 4. 变调状态更新
  // -------------------------------------------------------------
  async function setPitch(newSemitones) {
    if (newSemitones < -6) newSemitones = -6;
    if (newSemitones > 6) newSemitones = 6;
    if (currentSemitones === newSemitones) return;

    currentSemitones = newSemitones;
    await ctx.storage?.set?.("semitones", currentSemitones);

    updateBadgeDisplay();
    updatePopoverUI();
    syncStateToStorage();

    // 如果正在播放歌曲，刷新音源以使变调立刻生效
    const isPlaying = getIsPlaying();
    const trackId = getCurrentTrackId();
    if (isPlaying && trackId) {
      const curTime = getCurrentTime();

      try {
        if (activeFfmpegPid) {
          try {
            await ctx.process?.terminate?.(activeFfmpegPid);
          } catch {}
          activeFfmpegPid = null;
        }

        const store = ctx.player?.store;
        if (typeof store?.refreshCurrentTrack === "function") {
          // 优先使用官方原生的 refreshCurrentTrack 重新触发解析与转码
          await store.refreshCurrentTrack();
        } else if (ctx.player?.playTrack) {
          // 备用：重新触发 playTrack
          await ctx.player.playTrack(trackId);
          setTimeout(() => {
            if (typeof ctx.player?.seek === "function" && curTime > 0.5) {
              ctx.player.seek(curTime);
            }
          }, 260);
        }
      } catch (err) {
        console.warn("[echo-pitch-shift] 刷新变调音源提示:", err);
      }
    }
  }

  function updateBadgeDisplay() {
    const badges = document.querySelectorAll(".echo-pitch-badge-text");
    badges.forEach((el) => {
      if (currentSemitones === 0) {
        el.style.display = "none";
      } else {
        el.style.display = "inline-block";
        el.textContent = currentSemitones > 0 ? `+${currentSemitones}` : `${currentSemitones}`;
      }
    });
  }

  // 初始化从存储加载调号
  (async () => {
    try {
      const saved = await ctx.storage?.get?.("semitones");
      if (typeof saved === "number") {
        currentSemitones = saved;
        updateBadgeDisplay();
      }
    } catch {}
  })();

  const openFloatingWindow = () => {
    try {
      ctx.windows?.show?.("pitch-panel", { alwaysOnTop: true });
    } catch (err) {
      console.error("[echo-pitch-shift] 打开独立变调面板失败:", err);
    }
  };

  // -------------------------------------------------------------
  // 5. 页内原生弹出面板 (零延迟直连、无拖拽冲突、100% 顺畅关闭)
  // -------------------------------------------------------------
  function closePopover() {
    if (activePopoverEl) {
      activePopoverEl.remove();
      activePopoverEl = null;
    }
  }

  function getPitchDesc(v) {
    if (v === 0) return "原调 (±0)";
    const sign = v > 0 ? "+" : "";
    return `${sign}${v} 半音 (${v > 0 ? "升调" : "降调"})`;
  }

  function getRatioDesc(v) {
    const ratio = Math.pow(2, v / 12);
    return `${ratio.toFixed(3)}x 频响`;
  }

  function updatePopoverUI() {
    if (!activePopoverEl) return;
    const pitchValEl = activePopoverEl.querySelector(".echo-pop-pitch-val");
    if (pitchValEl) pitchValEl.textContent = getPitchDesc(currentSemitones);

    const ratioEl = activePopoverEl.querySelector(".echo-pop-ratio");
    if (ratioEl) ratioEl.textContent = getRatioDesc(currentSemitones);

    const resetBtn = activePopoverEl.querySelector(".echo-pop-reset-btn");
    if (resetBtn) {
      if (currentSemitones === 0) {
        resetBtn.style.background = "rgba(56, 189, 248, 0.25)";
        resetBtn.style.borderColor = "#38bdf8";
        resetBtn.style.color = "#38bdf8";
      } else {
        resetBtn.style.background = "rgba(255, 255, 255, 0.08)";
        resetBtn.style.borderColor = "rgba(255, 255, 255, 0.12)";
        resetBtn.style.color = "#f8fafc";
      }
    }

    const tags = activePopoverEl.querySelectorAll(".echo-pop-tag");
    tags.forEach((tag) => {
      const val = parseInt(tag.dataset.val, 10);
      if (val === currentSemitones) {
        tag.style.background = "#38bdf8";
        tag.style.color = "#0f172a";
        tag.style.fontWeight = "700";
      } else {
        tag.style.background = "rgba(255, 255, 255, 0.05)";
        tag.style.color = "#94a3b8";
        tag.style.fontWeight = "normal";
      }
    });

    const track = getCurrentTrack();
    const trackNameEl = activePopoverEl.querySelector(".echo-pop-track-name");
    if (trackNameEl) {
      const title = track?.title || track?.name || "未在播放歌曲";
      const artist =
        track?.artist ||
        (Array.isArray(track?.artists) ? track.artists.map((a) => a.name).join("/") : "");
      trackNameEl.textContent = artist ? `${title} - ${artist}` : title;
      trackNameEl.title = trackNameEl.textContent;
    }
  }

  function togglePopover(btnEl) {
    if (activePopoverEl) {
      closePopover();
      return;
    }

    const rect = btnEl.getBoundingClientRect();
    const popover = document.createElement("div");
    activePopoverEl = popover;
    popover.id = "echo-pitch-popover";
    popover.style.cssText = `
      position: fixed;
      bottom: ${window.innerHeight - rect.top + 8}px;
      right: ${Math.max(12, window.innerWidth - rect.right - 100)}px;
      width: 290px;
      padding: 14px 16px;
      background: rgba(22, 26, 35, 0.96);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 14px;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.6);
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      z-index: 999999;
      user-select: none;
      animation: echoFadeIn 0.18s ease-out;
    `;

    const track = getCurrentTrack();
    const title = track?.title || track?.name || "未在播放歌曲";
    const artist =
      track?.artist ||
      (Array.isArray(track?.artists) ? track.artists.map((a) => a.name).join("/") : "");
    const songFull = artist ? `${title} - ${artist}` : title;

    popover.innerHTML = `
      <style>
        @keyframes echoFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .echo-pop-btn:hover { background: rgba(56, 189, 248, 0.2) !important; color: #38bdf8 !important; border-color: rgba(56, 189, 248, 0.4) !important; }
        .echo-pop-btn:active { transform: scale(0.96); }
        .echo-pop-tag:hover { background: rgba(255, 255, 255, 0.15) !important; color: #fff !important; }
      </style>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#94a3b8;">
          <span>🎵</span><span>歌曲升降调</span>
          <span style="font-size:10px;padding:1px 5px;background:rgba(56,189,248,0.15);color:#38bdf8;border-radius:4px;cursor:pointer;" class="echo-pop-popout-btn" title="在新窗口中打开">独立浮窗 ↗</span>
        </div>
        <button class="echo-pop-close-btn" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.1);color:#94a3b8;width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;line-height:1;" title="关闭面板">×</button>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <div class="echo-pop-track-name" title="${songFull}" style="font-size:12px;color:#cbd5e1;max-width:170px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${songFull}</div>
        <div class="echo-pop-ratio" style="font-size:11px;color:#38bdf8;background:rgba(56,189,248,0.12);padding:2px 6px;border-radius:4px;">${getRatioDesc(
          currentSemitones
        )}</div>
      </div>

      <div style="text-align:center;margin:6px 0;">
        <span class="echo-pop-pitch-val" style="font-size:18px;font-weight:700;color:#38bdf8;letter-spacing:0.5px;">${getPitchDesc(
          currentSemitones
        )}</span>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <button class="echo-pop-btn echo-pop-down-btn" style="flex:1;padding:6px 0;border:1px solid rgba(255,255,255,0.12);border-radius:8px;background:rgba(255,255,255,0.08);color:#f8fafc;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.15s ease;">♭ 降半音</button>
        <button class="echo-pop-btn echo-pop-reset-btn" style="flex:1;padding:6px 0;border:1px solid ${
          currentSemitones === 0 ? "#38bdf8" : "rgba(255,255,255,0.12)"
        };border-radius:8px;background:${
      currentSemitones === 0 ? "rgba(56,189,248,0.25)" : "rgba(255,255,255,0.08)"
    };color:${
      currentSemitones === 0 ? "#38bdf8" : "#f8fafc"
    };font-size:12px;font-weight:600;cursor:pointer;transition:all 0.15s ease;">原调</button>
        <button class="echo-pop-btn echo-pop-up-btn" style="flex:1;padding:6px 0;border:1px solid rgba(255,255,255,0.12);border-radius:8px;background:rgba(255,255,255,0.08);color:#f8fafc;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.15s ease;">♯ 升半音</button>
      </div>

      <div style="display:flex;justify-content:space-between;gap:4px;">
        ${[-3, -2, -1, 0, 1, 2, 3]
          .map(
            (v) => `
          <span class="echo-pop-tag" data-val="${v}" style="flex:1;text-align:center;padding:4px 0;font-size:11px;border-radius:5px;cursor:pointer;transition:all 0.12s ease;background:${
              v === currentSemitones ? "#38bdf8" : "rgba(255,255,255,0.05)"
            };color:${v === currentSemitones ? "#0f172a" : "#94a3b8"};font-weight:${
              v === currentSemitones ? "700" : "normal"
            };">${v === 0 ? "0" : v > 0 ? `+${v}` : `${v}`}</span>
        `
          )
          .join("")}
      </div>
    `;

    // 绑定事件
    const closeBtn = popover.querySelector(".echo-pop-close-btn");
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      closePopover();
    };

    const popoutBtn = popover.querySelector(".echo-pop-popout-btn");
    popoutBtn.onclick = (e) => {
      e.stopPropagation();
      closePopover();
      openFloatingWindow();
    };

    const downBtn = popover.querySelector(".echo-pop-down-btn");
    downBtn.onclick = (e) => {
      e.stopPropagation();
      setPitch(currentSemitones - 1);
    };

    const upBtn = popover.querySelector(".echo-pop-up-btn");
    upBtn.onclick = (e) => {
      e.stopPropagation();
      setPitch(currentSemitones + 1);
    };

    const resetBtn = popover.querySelector(".echo-pop-reset-btn");
    resetBtn.onclick = (e) => {
      e.stopPropagation();
      setPitch(0);
    };

    const tagEls = popover.querySelectorAll(".echo-pop-tag");
    tagEls.forEach((tag) => {
      tag.onclick = (e) => {
        e.stopPropagation();
        const v = parseInt(tag.dataset.val, 10);
        setPitch(v);
      };
    });

    popover.onclick = (e) => e.stopPropagation();

    // 点击外部自动收起
    const onOutsideClick = (e) => {
      if (!popover.contains(e.target) && !btnEl.contains(e.target)) {
        closePopover();
        document.removeEventListener("pointerdown", onOutsideClick, true);
      }
    };
    setTimeout(() => {
      document.addEventListener("pointerdown", onOutsideClick, true);
    }, 50);

    document.body.appendChild(popover);
  }

  // -------------------------------------------------------------
  // 6. 注入播放控制栏按钮
  // -------------------------------------------------------------
  const injectPlayerBarButton = (container) => {
    if (container.querySelector(".echo-pitch-control-btn")) return;

    const btn = document.createElement("button");
    btn.className =
      "echo-pitch-control-btn relative flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[var(--control-hover-bg,rgba(255,255,255,0.1))] text-text-main/80 hover:text-text-main transition-all cursor-pointer";
    btn.style.margin = "0 2px";
    btn.title = "歌曲变调调节 (点击打开调音面板)";
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 10a2 2 0 1 0 4 0a2 2 0 1 0-4 0m2-6v4m0 4v8m6-4a2 2 0 1 0 4 0a2 2 0 1 0-4 0m2-12v10m0 4v2m6-10a2 2 0 1 0 4 0a2 2 0 1 0-4 0m2-6v4m0 4v8"/>
      </svg>
      <span class="echo-pitch-badge-text" style="position:absolute;top:-3px;right:-3px;font-size:9px;font-weight:700;line-height:1;background:#38bdf8;color:#0f172a;border-radius:6px;padding:2px 3px;display:${
        currentSemitones === 0 ? "none" : "inline-block"
      };pointer-events:none;">
        ${currentSemitones > 0 ? `+${currentSemitones}` : `${currentSemitones}`}
      </span>
    `;

    btn.onclick = (e) => {
      e.stopPropagation();
      togglePopover(btn);
    };

    container.insertBefore(btn, container.firstChild);
  };

  if (ctx.dom?.observe) {
    ctx.dom.observe(".player-actions", (actionsContainer) => {
      injectPlayerBarButton(actionsContainer);
    });

    ctx.dom.observe(".player-bar", (bar) => {
      const actions = bar.querySelector(".player-actions");
      if (actions) {
        injectPlayerBarButton(actions);
      }
    });
  }

  // -------------------------------------------------------------
  // 7. 侧边栏入口 (ctx.ui.sidebar.addItem)
  // -------------------------------------------------------------
  if (ctx.ui?.sidebar?.addItem) {
    try {
      ctx.ui.sidebar.addItem({
        id: "echo-pitch-shift-nav",
        title: "歌曲变调",
        icon: ctx.icons?.iconAdjustments || "tabler:adjustments",
        onClick: openFloatingWindow,
      });
    } catch {}
  }

  // 激活成功提示气泡
  ctx.toast?.success?.("【变调助手】已激活！");

  return {
    setPitch,
    getPitch: () => currentSemitones,
    openPanel: openFloatingWindow,
  };
}

export function deactivate(ctx) {
  closePopover();

  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  try {
    ctx.windows?.close?.("pitch-panel");
  } catch {}

  const btn = document.querySelector(".echo-pitch-control-btn");
  if (btn) btn.remove();

  if (activeFfmpegPid) {
    try {
      ctx.process?.terminate?.(activeFfmpegPid);
    } catch {}
    activeFfmpegPid = null;
  }
}
