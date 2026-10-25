# dsh-workspace-status · 工作区状态标记

[English](./README.md) · [中文](./README.zh-CN.md)

给侧边栏的**工作区行**加彩色状态标记：等你处理、正在运行、刚刚完成——折叠或滚动后也能一眼看出哪个文件夹里有事。

## 快速开始

```sh
dsh plugin --profile web add dsh-workspace-status
```

重启 Harness（或刷新 Web 界面）。工作区行上会出现彩色状态标记。

## 功能

- **聚合状态**：由该工作区下所有会话聚合而来，一眼看出「有事」还是「没事」。
- **三种状态**：等你处理（琥珀）、正在运行（蓝）、刚刚完成（绿）。
- **跟随主题**：颜色取自 Harness 主题变量，深浅色都协调。
- **可关闭**：设置里可开关标记显示。
- **双语标签**：跟随界面语言。

## 要求

DeepSeek Harness `>=0.2.1-rc.3 <0.3.0-0`，Web profile（桌面版或 Web 界面）

## 相关链接

- 英文说明（完整细节）：[README.md](./README.md)
- npm：<https://www.npmjs.com/package/dsh-workspace-status>
- 更新记录：[CHANGELOG.md](./CHANGELOG.md)

<sub>同系列插件：[情绪板](https://github.com/Stijnus/dsh-moodboard) · [输入补全](https://github.com/Stijnus/dsh-composer-predictions) · [移动到工作区](https://github.com/Stijnus/dsh-move-to-workspace) · [工作区状态](https://github.com/Stijnus/dsh-workspace-status) · [提示词改写](https://github.com/Stijnus/dsh-prompt-optimizer)</sub>

<sub>⭐ 如果它帮你省了一步，点个 star 能让更多 DSH 用户发现它。</sub>
