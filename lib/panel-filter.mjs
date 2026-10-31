// lib/panel-filter.mjs — 导入面板的工作区筛选纯函数（工作区下拉 / 过滤 / 分组键）
//
// 浏览器面板里跑的就是这一份：scripts/build-client.mjs 把本文件去掉 export、整体缩进后原样
// 内联进 lib/client.js（见该脚本文件头的「内联模块」），测试直接 import 本模块。因此本文件
// 必须保持「零 import、只有顶格 export 声明、无跨行模板字符串」的纯模块形态。

/** 无真实工作区（project 为空）条目的内部键：排序钉最后，显示时经 t("noWorkspace") 翻译。 */
export const NO_WORKSPACE_KEY = '__no_workspace__'

/**
 * 会话 → 工作区筛选键。discovery 的 project 是文件夹名字符串或 null；非字符串一律归入
 * 无工作区桶（分组排序对键调用 localeCompare，键必须是字符串）。
 */
export function workspaceKey(entry) {
  if (entry && typeof entry.project === 'string' && entry.project) return entry.project
  return NO_WORKSPACE_KEY
}

/** 按工作区键过滤（'' = 全部）。 */
export function filterByWorkspace(items, workspaceFilter) {
  const list = Array.isArray(items) ? items : []
  if (!workspaceFilter) return list
  return list.filter((s) => workspaceKey(s) === workspaceFilter)
}

/**
 * 工作区下拉的选项 `{ key, latest, path }`：key / latest 供排序与过滤；path 是该组里最新
 * 会话的 cwd（discovery 的 project 通常只是文件夹名，下拉里用更淡的字把路径画在后面；同名
 * 不同路径时以最活跃的那个会话为准，时间并列取后到的）。按组内最新活跃（缺省创建）时间
 * 降序，时间并列按键名升序，无工作区钉最后。
 */
export function buildWorkspaceOptions(items) {
  const map = new Map()
  for (const s of Array.isArray(items) ? items : []) {
    const key = workspaceKey(s)
    const at = (typeof s.lastActiveAt === 'number' ? s.lastActiveAt : 0)
      || (typeof s.createdAt === 'number' ? s.createdAt : 0)
    const path = typeof s.cwd === 'string' ? s.cwd : ''
    const prev = map.get(key)
    if (!prev) {
      map.set(key, { key, latest: at, path })
    } else if (at >= prev.latest) {
      prev.latest = at
      prev.path = path
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.key === NO_WORKSPACE_KEY) return 1
    if (b.key === NO_WORKSPACE_KEY) return -1
    return (b.latest - a.latest) || String(a.key).localeCompare(String(b.key))
  })
}

// ── 来源（harness）筛选 ──────────────────────────────────────────────────────
// 与工作区筛选同一套形状：纯函数、零 import、由本文件内联进 client bundle，
// 测试可以直接 import 这一份（不必维护镜像副本）。

/** 会话 → 来源格式键（discovery 的 format 短名，如 codex / claude；缺失归空串）。 */
export function formatKey(entry) {
  return entry && typeof entry.format === 'string' ? entry.format : ''
}

/**
 * 按来源格式（harness）过滤。`formatFilter` 可以是单个 key、key 数组或 Set（多选）；
 * 空值 / 空集合 = 不筛选。多选语义是「任一命中」，与勾选框的直觉一致。
 */
export function filterByFormat(items, formatFilter) {
  const list = Array.isArray(items) ? items : []
  if (!formatFilter) return list
  const allow = formatFilter instanceof Set
    ? formatFilter
    : Array.isArray(formatFilter)
      ? new Set(formatFilter)
      : new Set([formatFilter])
  if (allow.size === 0) return list
  return list.filter((s) => allow.has(formatKey(s)))
}

/**
 * 来源下拉的选项 `{ key, count, latest }`：只列当前结果里**真实出现过**的格式，
 * 不列硬编码的 33 种空档——没数据的 harness 不该占一个下拉项。按会话数降序，
 * 数量并列按键名升序，保证两次渲染顺序一致。
 */
export function buildFormatOptions(items) {
  const map = new Map()
  for (const s of Array.isArray(items) ? items : []) {
    const key = formatKey(s)
    if (!key) continue
    const at = (typeof s.lastActiveAt === 'number' ? s.lastActiveAt : 0)
      || (typeof s.createdAt === 'number' ? s.createdAt : 0)
    const prev = map.get(key)
    if (!prev) map.set(key, { key, count: 1, latest: at })
    else {
      prev.count++
      if (at > prev.latest) prev.latest = at
    }
  }
  return [...map.values()].sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key))
}

// ── 排序 ────────────────────────────────────────────────────────────────────

/** 可用排序键：active = 最后活跃（缺省创建）、created、title、source。 */
export const SORT_KEYS = ['active', 'created', 'title', 'source']

/**
 * 排序：`sortKey` 取 SORT_KEYS 之一，`descending` 决定方向。
 *
 * 两条硬性要求都在这里兑现：
 *  - **稳定**：相等项按原始下标回退，来回切升降序不会让行漂移；
 *  - **中文可读**：标题与来源走 `localeCompare(..., 'zh-CN')`；按 UTF-16 码位排出来的
 *    中文顺序没有意义（'奥德彪'.localeCompare('素材') 与 '奥德彪' < '素材' 结论相反）。
 * 时间用数值差（缺值当 0），每次比较都 new Date 会白烧 CPU。
 */
export function sortSessions(items, sortKey, descending) {
  const list = Array.isArray(items) ? items : []
  const dir = descending ? -1 : 1
  const timeOf = (s, key) => (key === 'created'
    ? (s.createdAt ?? 0)
    : (s.lastActiveAt ?? s.createdAt ?? 0))
  const cmp = (a, b) => {
    if (sortKey === 'title') return String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN')
    if (sortKey === 'source') return formatKey(a).localeCompare(formatKey(b))
    return timeOf(a, sortKey) - timeOf(b, sortKey)
  }
  return list
    .map((s, i) => ({ s, i }))
    .sort((x, y) => (cmp(x.s, y.s) * dir) || (x.i - y.i))
    .map((x) => x.s)
}
