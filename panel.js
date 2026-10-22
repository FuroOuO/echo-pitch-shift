export function activateWindow(ctx) {
  const vue = ctx.vue || ctx;
  const { h, createApp, ref, computed, onMounted, onBeforeUnmount } = vue;

  const App = {
    setup() {
      const semitones = ref(0);
      const songTitle = ref("未在播放歌曲");
      let pollTimer = null;

      // -------------------------------------------------------------
      // 1. 关闭面板 (多通道确保 100% 成功关闭)
      // -------------------------------------------------------------
      const closePanel = (e) => {
        if (e) {
          e.preventDefault?.();
          e.stopPropagation?.();
        }
        try {
          ctx.window?.close?.();
        } catch {}
        try {
          ctx.window?.hide?.();
        } catch {}
        try {
          window.close?.();
        } catch {}
      };

      // -------------------------------------------------------------
      // 2. 状态读取与同步
      // -------------------------------------------------------------
      const parseTrackInfo = (snapshot) => {
        const p = snapshot?.playback;
        if (!p) return null;
        const name = p.title || p.name || p.track?.title || p.track?.name || "";
        const artist =
          p.artist ||
          p.track?.artist ||
          (Array.isArray(p.artists) ? p.artists.map((a) => a.name).join("/") : "");
        if (name) {
          return artist ? `${name} - ${artist}` : name;
        }
        return null;
      };

      const syncStatus = async () => {
        // 读取存储中的主窗口状态
        try {
          const state = await ctx.storage?.get?.("pitch_state");
          if (state && typeof state === "object") {
            if (typeof state.semitones === "number") {
              semitones.value = state.semitones;
            }
            if (state.title) {
              songTitle.value = state.artist ? `${state.title} - ${state.artist}` : state.title;
              return;
            }
          }
        } catch {}

        // 备用读取系统快照
        try {
          const snapshot = await ctx.nowPlaying?.getSnapshot?.();
          const info = parseTrackInfo(snapshot);
          if (info) {
            songTitle.value = info;
            return;
          }
        } catch {}
      };

      onMounted(async () => {
        // 读取初始调号
        try {
          const saved = await ctx.storage?.get?.("semitones");
          if (typeof saved === "number") {
            semitones.value = saved;
          }
        } catch {}

        await syncStatus();

        // 监听快照
        ctx.nowPlaying?.onSnapshot?.((snapshot) => {
          const info = parseTrackInfo(snapshot);
          if (info) {
            songTitle.value = info;
          }
        });

        // 定时与主窗口存储同步 (250ms)
        pollTimer = setInterval(syncStatus, 250);

        // 仅将拖拽绑定在标题区域，避免拦截关闭按钮事件
        setTimeout(() => {
          const titleEl = document.querySelector(".panel-title");
          if (titleEl && ctx.window?.drag?.bind) {
            try {
              ctx.window.drag.bind(titleEl);
            } catch {}
          }
        }, 120);
      });

      onBeforeUnmount(() => {
        if (pollTimer) clearInterval(pollTimer);
      });

      // -------------------------------------------------------------
      // 3. 调音操作触发 (写入主进程存储指令)
      // -------------------------------------------------------------
      const applyPitch = async (val) => {
        if (val < -6) val = -6;
        if (val > 6) val = 6;
        semitones.value = val;

        try {
          await ctx.storage?.set?.("semitones", val);
          await ctx.storage?.set?.("pitch_cmd", {
            action: "SET_PITCH",
            semitones: val,
            t: Date.now(),
          });
        } catch {}
      };

      const changePitch = (delta) => {
        applyPitch(semitones.value + delta);
      };

      const resetPitch = () => {
        applyPitch(0);
      };

      const pitchDesc = computed(() => {
        const v = semitones.value;
        if (v === 0) return "原调 (±0)";
        const sign = v > 0 ? "+" : "";
        return `${sign}${v} 半音 (${v > 0 ? "升调" : "降调"})`;
      });

      const ratioDesc = computed(() => {
        const ratio = Math.pow(2, semitones.value / 12);
        return `${ratio.toFixed(3)}x 频响`;
      });

      return () =>
        h("div", { class: "pitch-card" }, [
          h("div", { class: "panel-header" }, [
            h("div", { class: "panel-title" }, [
              h("span", { class: "icon" }, "🎵"),
              h("span", { class: "text" }, "升降调调节"),
            ]),
            h(
              "button",
              {
                class: "btn-close",
                onClick: closePanel,
                onMousedown: closePanel,
                onPointerdown: closePanel,
                title: "关闭面板",
              },
              "×"
            ),
          ]),

          h("div", { class: "track-info" }, [
            h("div", { class: "track-name", title: songTitle.value }, songTitle.value),
            h("div", { class: "ratio-badge" }, ratioDesc.value),
          ]),

          h("div", { class: "pitch-meter" }, [
            h("span", { class: "pitch-val" }, pitchDesc.value),
          ]),

          h("div", { class: "control-row" }, [
            h(
              "button",
              {
                class: "btn-action btn-down",
                onClick: () => changePitch(-1),
                title: "降半音 (-1)",
              },
              "♭ 降调"
            ),
            h(
              "button",
              {
                class: ["btn-action", "btn-reset", semitones.value === 0 ? "is-active" : ""],
                onClick: resetPitch,
                title: "恢复原调 (0)",
              },
              "原调"
            ),
            h(
              "button",
              {
                class: "btn-action btn-up",
                onClick: () => changePitch(1),
                title: "升半音 (+1)",
              },
              "♯ 升调"
            ),
          ]),

          h("div", { class: "quick-tags" }, [
            [-3, -2, -1, 0, 1, 2, 3].map((val) =>
              h(
                "span",
                {
                  class: ["tag-item", semitones.value === val ? "is-selected" : ""],
                  onClick: () => applyPitch(val),
                },
                val === 0 ? "0" : val > 0 ? `+${val}` : `${val}`
              )
            ),
          ]),
        ]);
    },
  };

  const app = createApp(App);
  const mountTarget = document.getElementById("app") || document.body;
  app.mount(mountTarget);
}
