# Stick Figure Badminton II · HTML5 Replay

这是一个放在本仓库里的纯 HTML5 Canvas 火柴人羽毛球游戏。它参考经典 Flash 版《Stick Figure Badminton》的操作与比赛节奏，用原创 Canvas 绘制实现，不依赖 Flash、Ruffle、外部图片或构建工具。

## 直接运行

打开 [index.html](./index.html) 即可运行。也可以在仓库根目录启动任意静态服务器，例如：

```bash
python3 -m http.server 8080
```

然后访问 `http://localhost:8080`。

## 操作

### 单人 Exhibition

- `A / D`：左右移动
- `W`：跳跃
- `S` 或 `Space`：挥拍

### 本地双人 2 Player

- 玩家 1：`A / D` 移动，`W` 跳跃，`S` 或 `Space` 挥拍
- 玩家 2：`← / →` 移动，`↑` 跳跃，`↓` 挥拍
- `P`：暂停 / 继续
- `M`：静音
- `Esc`：返回菜单

## 玩法

每回合只有一次得分机会，先拿到 7 分获胜。羽毛球拥有高弧线物理、球网碰撞和边墙反弹。跳起后击球可以打出更快的扣杀。单人模式提供 Rookie、Pro、Nightmare 三档电脑难度；移动端提供屏幕按键。

## 项目结构

- `index.html`：菜单、设置、比赛 HUD 和响应式页面
- `styles.css`：深色 Flash 游戏机界面与移动端适配
- `game.js`：Canvas 绘制、输入、物理、电脑 AI、得分和本地双人模式
- `assets/`：仓库原有 Rally Club 素材（当前游戏核心使用 Canvas 原创绘制）

## 说明

这是受经典游戏玩法启发的非官方重制版，未复制原 Flash 的 SWF、图片或音频资源。
