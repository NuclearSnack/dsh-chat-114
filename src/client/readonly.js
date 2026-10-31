    // ── 导入会话只读锁（A 方案）────────────────────────────────────────────
    //
    // 官方只提供一条路：conversation.blocks。ui-conversation 的源码注释原话是
    // "the one way another plugin stops a session's input"，并且 block.reason 会被
    // 直接渲染成输入框的灰字占位文本、编辑器同时变 inert —— 「此对话来源于 X」和
    // 「不能在这里续聊」本来就是同一个动作的两面，不需要两套实现。
    //
    // 续聊的唯一出口是 DSH 原生分叉：子会话拿到新的 sessionId，不在 registry 里，
    // 因此不被本锁覆盖。正因如此这里不维护任何「解锁状态」——没有状态，也就不存在
    // 状态与磁盘不一致、重启后要重算的问题。
    //
    // 只读解锁的判定只看一件事：这个 sessionId 是否出现在 /api-import/readonly-map
    // 的返回里。路由不可用（老宿主 / 路由被摘）时静默降级为「不锁」，绝不阻塞面板。
    const READONLY_MAP_URL = "/api-import/readonly-map";
    const readonlyInfo = new Map(); // sessionId → { format, importedAt, sourcePath }
    const readonlyApplied = new Set(); // 已经 set 过 block 的会话（重复 set 无副作用但没必要）
    const readonlyWatchers = new Set(); // 映射变化后通知已挂载的横幅重渲染

    function useReadonlyInfo(sessionId) {
      const [, bump] = React.useState(0);
      React.useEffect(() => {
        const fn = () => bump((n) => n + 1);
        readonlyWatchers.add(fn);
        return () => { readonlyWatchers.delete(fn); };
      }, []);
      return sessionId ? readonlyInfo.get(sessionId) || null : null;
    }

    function readonlyDay(ms) {
      if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
      const d = new Date(ms);
      const p = (n) => String(n).padStart(2, "0");
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
    }

    /** 来源展示名：复用 sources.js 的 format → 展示名口径，取不到就退回原始 format。 */
    function readonlyLabel(format) {
      const raw = typeof format === "string" && format ? format : "";
      if (!raw) return "外部工具";
      try {
        const label = sourceLabel(raw);
        if (typeof label === "string" && label) return label;
      } catch (_) { /* sources.js 口径不可用时退回原始短名 */ }
      return raw;
    }

    /** 输入框灰字：「此对话来源于 Codex·2026-09-13」。日期取导入时间。 */
    function readonlyReason(info) {
      const label = readonlyLabel(info && info.format);
      const day = readonlyDay(info && info.importedAt);
      return "此对话来源于 " + label + (day ? "·" + day : "");
    }

    /** 把所有导入会话标成只读。服务/注册表缺席时什么都不做（安全降级）。 */
    function applyReadonlyBlocks(conversation) {
      if (!conversation || !conversation.blocks || typeof conversation.blocks.set !== "function") return;
      for (const [sessionId, info] of readonlyInfo) {
        if (readonlyApplied.has(sessionId)) continue;
        try {
          conversation.blocks.set(sessionId, { reason: readonlyReason(info) });
          readonlyApplied.add(sessionId);
        } catch (_) { /* 单个会话设置失败不影响其余 */ }
      }
    }

    /** 拉一次只读映射并重设全部 block；面板导入新会话后调用即可增量生效。 */
    async function refreshReadonly(conversation) {
      try {
        const resp = await fetch(READONLY_MAP_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        if (!resp || !resp.ok) return;
        const data = await resp.json();
        readonlyInfo.clear();
        readonlyApplied.clear();
        const sessions = (data && data.sessions) || {};
        for (const [id, info] of Object.entries(sessions)) readonlyInfo.set(id, info);
        applyReadonlyBlocks(conversation);
        for (const fn of readonlyWatchers) fn();
      } catch (_) { /* 路由不可用：降级为不锁 */ }
    }

    /** 分叉：走后端原生 forkSession，子会话不在只读表里，进去就能聊。 */
    function forkReadonlySession(ctx, sessionId) {
      if (!sessionId) return false;
      try {
        const ws = ctx.get("uiWorkspace");
        if (ws && typeof ws.forkSession === "function") {
          const p = ws.forkSession(sessionId);
          if (p && typeof p.catch === "function") {
            p.catch(() => showAppToast("无法分叉会话，请稍后重试", []));
          }
          return true;
        }
      } catch (_) { /* 落到下面的提示 */ }
      showAppToast("无法分叉会话，请稍后重试", []);
      return false;
    }

    /** 输入框上方的只读横幅：只在导入会话里出现，其余会话完全不渲染。 */
    function ReadonlyBanner(props) {
      const { sessionId, onFork, t } = props;
      const info = useReadonlyInfo(sessionId);
      if (!info) return null;
      const label = readonlyLabel(info.format);
      const day = readonlyDay(info.importedAt);
      return h("div", {
        style: {
          display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap",
          margin: "0 0 8px", padding: "6px 10px", borderRadius: "8px",
          border: "1px solid " + COLORS.border, background: COLORS.surface,
          color: COLORS.dim, fontSize: "12px", lineHeight: "18px",
        },
        "data-import-readonly": sessionId,
      },
        h("span", { style: { fontWeight: 600, color: COLORS.warn } }, "只读"),
        h("span", null, "此对话来源于 " + label + (day ? "·" + day : "") + "，导入后不可在原会话继续"),
        h("button", {
          type: "button",
          onClick: () => onFork(sessionId),
          title: "分叉出一个可对话的新会话",
          style: {
            marginLeft: "auto", padding: "3px 10px", borderRadius: "6px", cursor: "pointer",
            border: "1px solid " + COLORS.border, background: COLORS.hover,
            color: COLORS.text, fontSize: "12px",
          },
        }, "分叉后继续对话"));
    }

    /**
     * 安装只读锁。每一步各自 try/catch：槽注册或服务订阅任何一步失败，
     * 都只让「锁不生效」，绝不把 apply 抛出去——插件其余部分（面板/设置/footer）
     * 必须照常工作，这是本插件能用的底线。
     */
    function installReadonly(ctx) {
      try {
        ctx.slots.inject("conversation.input.dock", () =>
          ctx.slots.register({
            name: "conversation.input.dock",
            id: "chat-114-readonly",
            order: -10,
            inject: (sessionId) => ({ sessionId, onFork: (id) => forkReadonlySession(ctx, id) }),
          }, ReadonlyBanner));
      } catch (_) { /* 横幅不上就不上，锁仍会生效 */ }
      try {
        if (typeof ctx.inject === "function") {
          ctx.inject(["conversation"], (scope) => {
            refreshReadonly(scope.get("conversation"));
          });
        }
      } catch (_) { /* 拿不到 conversation 服务：锁不生效，整插件照常 */ }
    }
