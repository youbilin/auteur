---
archetype: operational
attention: 5s
density: 4
style: dark-tech
decoration: 0
library: react-custom
---

# 定位卡 — Auteur Studio

## 主决策

让用户在不打开终端、不手改 JSON 的情况下，60 秒内从 brief 走到一条可播放、可审片、可修复的成片。

## 证据（必须真的出现在页面里）

1. 当前模型与角色状态（director / coder / vision，真实 model 名与可用性）—— 顶栏右侧
2. 当前 VideoPlan 的真实 scene 数、时长、layout、copy 与 callout —— 中栏 scene 列表
3. 真实 QA 分数、verdict、issue 列表与音频 LUFS —— 右栏
4. 真实成片 `<video>` 播放器，带音频，可从本地 API 直接播放 —— 右栏顶部
5. 真实文件路径（plan.json / video.mp4 / qa.md / composition）—— 右栏底部

## 锚点

- Linear：取顶栏密度、hairline 分隔、短标签与紧凑下拉，不取深紫渐变。
- Rive：取“画布 + inspector”的分屏工作台关系，不取彩色玻璃和营销动效。

## 反例

- 不做 landing page：没有 hero、没有三件套、没有大标题占满首屏。
- 不把每个区块包成卡片，也不在卡片里再套卡片；用细线和留白分组。
- 不使用两种高饱和强调色；全站只有一个强调色 `#8BD3FF`。
- 不使用 emoji 当功能图标；图标统一 lucide，尺寸 14–16px。
- 不使用全屏 spinner；加载用局部 skeleton/状态行，错误必须可重试。
- 不使用等宽等高网格堆满整页；中栏按 scene 纵向排列，右栏 inspector 结构不同。
- 不使用假数据：所有 scene/QA/model 状态来自真实 API；空态写清楚下一步。
- 不移除 focus ring；所有按钮/输入有可见 focus。

## 差异化

不是“聊天框生成视频”，而是把 **plan / render / QA / fix / audio / files** 放在同一个可复现工作台里：每一个分数和问题都能点回具体 scene 和文件。

## 派生（Step 2）

- 页面骨架：44px 顶栏；下方三栏 — 左 300px 输入/配置，中 1fr scene plan，右 380px preview/QA。窄屏折成单栏。
- 组件库与关键组件：React + 原生控件 + lucide 图标；无成品 UI 库。按钮、segmented、select、textarea、video、issue row 自写 token 化样式。
- 字号 / 行高 / 间距：12px 标签 / 13px 正文 / 14px 输入 / 16px 区块标题 / 20px 页面标题；行高 1.4–1.5；区块 16–20px，组 8–12px，元素 4–6px。
- 圆角 / 阴影：圆角 6px（控件）/ 8px（面板）；阴影仅 video hover 一档；面板靠 hairline 分隔。
- 允许的装饰：0；只有一处 1px 的 accent 进度/状态线。
- 必须的 mockup：真实 video 播放器、真实 scene 列表、真实 QA issue 列表、模型状态行。
- 必须的三态：加载（局部 skeleton）、空态（引导写 brief / 生成第一条）、错误（可重试，不静默）。
