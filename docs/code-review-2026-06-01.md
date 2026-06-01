# 代码结构 Review（2026-06-01）

针对 PI（Proforma Invoice）模块的结构、逻辑清晰度与潜在混乱点的评审。

## 1. 整体结构（总体良好）

```
functions/            Cloudflare Workers 后端（Hono 路由）
  api/routes/         按资源拆分的路由：pi / products / tickets / options ...
  lib/                领域逻辑：piWorkflow / piAccess / piNumber / piLink ...
shared/               前后端共享（piCapabilities）
web/src/
  pages/              页面级组件（PiPage 等）
  pi/                 PI 领域逻辑与子组件（usePiEditor / LineItem / linkedZhSync ...）
  products/ tickets/  其他领域
  api/client.ts       axios 实例 + 鉴权拦截
```

分层清晰：路由 → lib 领域函数 → 共享能力判断（`piCapabilities`）。前端把状态逻辑收敛到
`usePiEditor` hook，页面只做渲染，是很好的实践。测试覆盖也比较到位（`*.test.ts`）。

## 2. 逻辑不够清晰 / 容易混乱的点

### 2.1 `PiPage` 里 “是否在编辑器” 的判定分散
`inEditor = editing || Boolean(editor.current) || Boolean(linkedPiId)`（PiPage.tsx:61）
同时由本地 `editing` state、`editor.current`、URL 上的 `linkedPiId` 三处推导，三者之间
没有单一来源。ZH 用 `?piId=` 同步 URL，EN 不同步——同一个页面两套行为，读代码时要反复确认
“现在到底处于列表还是编辑态”。建议把视图状态收敛成一个显式的 `view: 'list' | 'editor'`。

### 2.2 “保存按钮文案” 由 helper 决定，行为却在后端
`shouldShowSaveAndSyncButton` 只是改按钮文案（PiPage.tsx:380），真正“创建联动中文草稿”
发生在后端 `POST /pi`（pi.ts:178 `createLinkedZhDraft`）。即“保存”和“同步”是同一个动作的两个
名字，但代码里分散在前端文案 + 后端副作用两处，阅读时很难一眼看出“保存会顺带建中文草稿”。
（这正是你问题 3 的来源，详见下文。）

### 2.3 颜色 tone 是写死的两份表
`sectionTone`（PiPage.tsx:526）和 `productTone`（LineItem.tsx:182）各自硬编码一套
蓝/绿/琥珀/紫色板，两份重复且和站点整体的“蓝色系”主题不协调（你问题 2）。

### 2.4 列表加载没有 loading 态
`usePiEditor.reload()` 与 `PiPage` 的 `loadProducts/loadEnSetup/loadZhSetup` 在语言切换时
各自发请求，期间界面没有任何 loading 占位，列表会“先空后跳出”，看起来像卡顿（你问题 4）。
另外后端 `GET /pi` 每次都先跑 `purgeExpiredDrafts`（pi.ts:70），给读请求加了额外写开销。

### 2.5 其它小点
- `save()` 成功后连续 `await open()` + `await reload()` 两个请求串行，编辑保存后也会有可感知延迟。
- `editor.exportError` 同时承载导出错误和 resync 错误（usePiEditor.ts:243），命名易误导。
- `downloadExcel` 在非 locked 时会先 `save()` 再导出，副作用较隐蔽。

## 3. 待确认后落地的改动
- 统一 PI 各区块配色（问题 2）
- 拆分 EN 的“保存 / 同步中文草稿”，并补 Download（问题 3）
- 列表加载的 loading 态 + 缓存策略（问题 4）
</content>
