// panel-filter.test.mjs — 导入面板工作区筛选纯函数。
// lib/panel-filter.mjs 原样内联进 lib/client.js（scripts/build-client.mjs），这里测的就是面板
// 里跑的那份——此前 bundle 里另有一份副本（返回值多了下拉要用的 path、键判定口径也不同），
// 测试覆盖的是一份不发布的代码。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  NO_WORKSPACE_KEY,
  workspaceKey,
  filterByWorkspace,
  buildWorkspaceOptions,
  formatKey,
  filterByFormat,
  buildFormatOptions,
  INTERNAL_SOURCE_FORMATS,
  isInternalFormat,
  STATUS_KINDS,
  statusKey,
  filterByStatus,
  SORT_KEYS,
  sortSessions,
} from '../lib/panel-filter.mjs'
import { inlineModule } from '../scripts/build-client.mjs'

const s = (project, status, extra = {}) => ({
  format: 'cursor',
  sessionId: extra.id || project || 'x',
  sourcePath: '/p',
  project: project || null,
  importStatus: status,
  lastActiveAt: extra.la ?? 0,
  createdAt: extra.ca ?? 0,
  ...(extra.cwd !== undefined ? { cwd: extra.cwd } : {}),
})

test('workspaceKey：有 project 用 basename，无则归入无工作区', () => {
  assert.equal(workspaceKey(s('demo.Client-app', 'not-imported')), 'demo.Client-app')
  assert.equal(workspaceKey(s(null, 'not-imported')), NO_WORKSPACE_KEY)
  assert.equal(workspaceKey(null), NO_WORKSPACE_KEY)
})

test('workspaceKey：非字符串 project 归入无工作区（分组排序对键调用 localeCompare）', () => {
  assert.equal(workspaceKey({ project: 42 }), NO_WORKSPACE_KEY)
  assert.equal(workspaceKey({ project: { name: 'x' } }), NO_WORKSPACE_KEY)
  assert.equal(workspaceKey({ project: '' }), NO_WORKSPACE_KEY)
})

test('filterByWorkspace：空串为全部，否则只保留匹配工作区', () => {
  const items = [s('Desktop', 'not-imported'), s('demo.Client-app', 'not-imported'), s(null, 'not-imported')]
  assert.equal(filterByWorkspace(items, '').length, 3)
  assert.equal(filterByWorkspace(items, 'Desktop').length, 1)
  assert.equal(filterByWorkspace(items, NO_WORKSPACE_KEY).length, 1)
  assert.deepEqual(filterByWorkspace(undefined, 'Desktop'), [])
})

test('buildWorkspaceOptions：按最新活跃降序，无工作区钉最后', () => {
  const items = [
    s(null, 'not-imported', { la: 100 }),
    s('Desktop', 'not-imported', { la: 300 }),
    s('demo.Client-app', 'not-imported', { la: 200 }),
  ]
  const opts = buildWorkspaceOptions(items)
  assert.deepEqual(opts.map((o) => o.key), ['Desktop', 'demo.Client-app', NO_WORKSPACE_KEY])
})

test('buildWorkspaceOptions：path 取组内最活跃会话的 cwd（同名不同路径以它为准，并列取后到的）', () => {
  const opts = buildWorkspaceOptions([
    s('app', 'not-imported', { id: 'a', la: 100, cwd: '/work/old/app' }),
    s('app', 'not-imported', { id: 'b', la: 300, cwd: '/work/new/app' }),
    s('app', 'not-imported', { id: 'c', la: 200, cwd: '/work/mid/app' }),
    s('tie', 'not-imported', { id: 'd', la: 50, cwd: '/first/tie' }),
    s('tie', 'not-imported', { id: 'e', la: 50, cwd: '/second/tie' }),
    s('bare', 'not-imported', { id: 'f', ca: 10 }),
  ])
  assert.deepEqual(opts, [
    { key: 'app', latest: 300, path: '/work/new/app' },
    { key: 'tie', latest: 50, path: '/second/tie' },
    { key: 'bare', latest: 10, path: '' },
  ])
})

test('buildWorkspaceOptions：时间并列按键名升序；非数组输入给空列表', () => {
  const opts = buildWorkspaceOptions([s('b', 'x', { la: 5 }), s('a', 'x', { la: 5 })])
  assert.deepEqual(opts.map((o) => o.key), ['a', 'b'])
  assert.deepEqual(buildWorkspaceOptions(null), [])
})

test('常量：DSH 自家来源清单与四态键顺序', () => {
  assert.deepEqual(INTERNAL_SOURCE_FORMATS, ['dsh', 'dsh4'])
  assert.equal(isInternalFormat('dsh'), true)
  assert.equal(isInternalFormat('dsh4'), true)
  assert.equal(isInternalFormat('codex'), false)
  assert.equal(isInternalFormat(''), false)
  assert.deepEqual(STATUS_KINDS, ['notImported', 'imported', 'updated', 'tombstone'])
})

// ── 来源（harness）筛选 ──────────────────────────────────────────────────────

const f = (format, extra = {}) => ({
  format,
  sessionId: extra.id || format,
  sourcePath: extra.sp || '/p',
  project: null,
  importStatus: extra.status || 'not-imported',
  lastActiveAt: extra.la ?? 0,
  createdAt: extra.ca ?? 0,
  ...(extra.hasUpdate !== undefined ? { hasUpdate: extra.hasUpdate } : {}),
  ...(extra.isTombstone !== undefined ? { isTombstone: extra.isTombstone } : {}),
})

test('formatKey：取 format 短名，缺失/非字符串归空串', () => {
  assert.equal(formatKey(f('codex')), 'codex')
  assert.equal(formatKey(null), '')
  assert.equal(formatKey({}), '')
  assert.equal(formatKey({ format: 42 }), '')
})

test('filterByFormat：单值 / 数组 / Set 都是「任一命中」；空值不筛选但剔除 DSH 自家格式', () => {
  const items = [f('codex'), f('claude'), f('zcode'), f('dsh'), f('dsh4')]
  assert.deepEqual(filterByFormat(items, 'codex').map((x) => x.format), ['codex'])
  assert.deepEqual(filterByFormat(items, ['codex', 'zcode']).map((x) => x.format), ['codex', 'zcode'])
  assert.deepEqual(filterByFormat(items, new Set(['claude'])).map((x) => x.format), ['claude'])
  // 空集 = 「全部」：显式排除 DSH 自家会话日志（拿 DSH 导入 DSH 没有意义）
  assert.deepEqual(filterByFormat(items, new Set()).map((x) => x.format), ['codex', 'claude', 'zcode'])
  assert.deepEqual(filterByFormat(items, '').map((x) => x.format), ['codex', 'claude', 'zcode'])
  // 显式勾选 dsh 时按选择走，不再套用排除
  assert.deepEqual(filterByFormat(items, 'dsh').map((x) => x.format), ['dsh'])
  assert.deepEqual(filterByFormat(null, 'codex'), [])
})

test('buildFormatOptions：按会话数降序；DSH 自家格式钉到最后并在第一个前打 divider', () => {
  const items = [f('codex'), f('codex'), f('codex'), f('claude'), f('zcode'), f('dsh'), f('dsh4')]
  const opts = buildFormatOptions(items)
  assert.deepEqual(opts.map((o) => o.key), ['codex', 'claude', 'zcode', 'dsh', 'dsh4'])
  assert.deepEqual(opts.map((o) => o.count), [3, 1, 1, 1, 1])
  // 数量并列（claude/zcode 都是 1）按键名升序
  assert.ok(opts.findIndex((o) => o.key === 'claude') < opts.findIndex((o) => o.key === 'zcode'))
  // 只有第一个内部格式带 divider
  assert.equal(opts.filter((o) => o.divider === true).length, 1)
  assert.equal(opts.find((o) => o.divider === true).key, 'dsh')
  // 没有内部格式时没有任何 divider
  assert.equal(buildFormatOptions([f('codex')]).some((o) => o.divider === true), false)
  assert.deepEqual(buildFormatOptions(undefined), [])
})

// ── 导入状态四态 ────────────────────────────────────────────────────────────

test('statusKey：墓碑 > 有更新 > 已导入 > 未导入；partial 归未导入', () => {
  assert.equal(statusKey(f('codex', { status: 'imported', isTombstone: true, hasUpdate: true })), 'tombstone')
  assert.equal(statusKey(f('codex', { status: 'imported', hasUpdate: true })), 'updated')
  assert.equal(statusKey(f('codex', { status: 'imported' })), 'imported')
  assert.equal(statusKey(f('codex', { status: 'archived' })), 'imported')
  // partial = 同一 multi 源里别的会话导过了、本条没有 → 对这条就是未导入
  assert.equal(statusKey(f('zcode', { status: 'partial' })), 'notImported')
  assert.equal(statusKey(f('codex', { status: 'not-imported' })), 'notImported')
  assert.equal(statusKey(null), 'notImported')
})

test('filterByStatus：多选任一命中；空集不筛选', () => {
  const items = [
    f('codex', { id: 'a', status: 'imported' }),
    f('codex', { id: 'b', status: 'not-imported' }),
    f('codex', { id: 'c', status: 'imported', hasUpdate: true }),
    f('codex', { id: 'd', status: 'imported', isTombstone: true }),
  ]
  assert.deepEqual(filterByStatus(items, new Set()).map((x) => x.sessionId), ['a', 'b', 'c', 'd'])
  assert.deepEqual(filterByStatus(items, ['tombstone']).map((x) => x.sessionId), ['d'])
  assert.deepEqual(filterByStatus(items, new Set(['updated', 'notImported'])).map((x) => x.sessionId), ['b', 'c'])
  assert.deepEqual(filterByStatus(null, ['imported']), [])
})

// ── 排序 ────────────────────────────────────────────────────────────────────

test('SORT_KEYS：四个可用排序键', () => {
  assert.deepEqual(SORT_KEYS, ['active', 'created', 'title', 'source'])
})

test('sortSessions：时间升降序、缺值当 0、相等项按原始顺序回退（来回切不漂移）', () => {
  const items = [
    f('codex', { id: 'a', la: 100 }),
    f('codex', { id: 'b', la: 300 }),
    f('codex', { id: 'c', la: 200 }),
    f('codex', { id: 'd' }),
  ]
  assert.deepEqual(sortSessions(items, 'active', true).map((x) => x.sessionId), ['b', 'c', 'a', 'd'])
  assert.deepEqual(sortSessions(items, 'active', false).map((x) => x.sessionId), ['d', 'a', 'c', 'b'])
  // 时间并列：保持原始相对顺序（稳定），降序升序来回切两次回到原样
  const ties = [f('codex', { id: 'x', la: 5 }), f('codex', { id: 'y', la: 5 }), f('codex', { id: 'z', la: 5 })]
  assert.deepEqual(sortSessions(ties, 'active', true).map((x) => x.sessionId), ['x', 'y', 'z'])
  assert.deepEqual(sortSessions(ties, 'active', false).map((x) => x.sessionId), ['x', 'y', 'z'])
  assert.deepEqual(sortSessions(null, 'active', true), [])
})

test('sortSessions：标题按中文排序（localeCompare），来源按格式短名', () => {
  const items = [
    f('codex', { id: '1' }),
    f('claude', { id: '2' }),
  ]
  items[0].title = '素材制作'
  items[1].title = '奥德彪拉香蕉'
  // 中文必须走 localeCompare('zh-CN')，按码位排会得出相反顺序
  assert.equal('奥德彪拉香蕉'.localeCompare('素材制作', 'zh-CN') < 0, true)
  assert.deepEqual(sortSessions(items, 'title', false).map((x) => x.sessionId), ['2', '1'])
  assert.deepEqual(sortSessions(items, 'source', false).map((x) => x.sessionId), ['2', '1'])
})

test('lib/client.js 原样内联本模块，面板里不再另存副本', () => {
  const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const module = readFileSync(new URL('../lib/panel-filter.mjs', import.meta.url), 'utf8')
  assert.ok(bundle.includes(inlineModule('lib/panel-filter.mjs', module)),
    'lib/client.js 应原样内联 lib/panel-filter.mjs（改了模块后重跑 npm run build:client）')
  for (const name of ['workspaceKey', 'filterByWorkspace', 'buildWorkspaceOptions']) {
    assert.equal(bundle.split('function ' + name + '(').length - 1, 1, name + ' 在 bundle 里应恰好一份实现')
    assert.equal(bundle.includes('const ' + name + ' ='), false, name + ' 不应再有片段内的同名副本')
  }
  assert.equal(bundle.split('const NO_WORKSPACE_KEY =').length - 1, 1, 'NO_WORKSPACE_KEY 只声明一次')
})
