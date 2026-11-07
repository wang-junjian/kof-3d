# 绯翎 vs 岳铮 · 3D 格斗垂直切片

原创角色的 1v1 单机 3D 格斗网页切片（Three.js + Vite + TypeScript）。致敬式借鉴格斗游戏规则，不使用 SNK 角色与「拳皇」名称；两名角色均为原创成年格斗家：**绯翎 · 疾影**（轻装迅捷、多段连击、空中派生）与 **岳铮 · 铁山**（重装力量、指令投、派生重压），外形、动作风格与招式表各自独立。

> **在线试玩 / Play online**：<https://wangjunjian.com/kof-3d/> — 打开即玩、零安装；手机横屏 / 竖屏都自动出现虚拟键并自动全屏，竖屏场地会收进窗口内，标准手柄即插即用。试玩页同时提供 `kof-3d.html` 供下载后离线双击打开。
>
> **备用地址 / Fallback**：<https://wang-junjian.github.io/kof-3d/>（GitHub Pages 官方入口，会自动 301 跳转到上面的自定义域；主站域名变更时仍可访问）。
>
> **开源仓库**：<https://github.com/wang-junjian/kof-3d> · **MIT License**（见 [LICENSE](LICENSE)）· 第三方素材出处见 [CREDITS.md](CREDITS.md)。
>
> **商标声明 / Trademark**：`kof-3d` 只是本项目沿用的历史代号，与 SNK CORPORATION 及 "THE KING OF FIGHTERS" 系列没有任何关联、授权或背书；仓库不含任何 SNK 角色、美术或商标素材。

**范围**：M0 + M1 + M2 + **M3 指令格斗**。已落地：站/蹲防与 GUARD BREAK、跳跃攻击（前跳 / 短跳分档）、Hitstop、三回合流程、三档 AI、程序化 Q 版角色与可替换 VRM 资产槽；以及 M3 的 **23 招帧表、5 类指令（236 / 214 / 623 / 41236 / 236236）、每角色独立指令表与取消图、4 条派生追加输入链、3 个多 hit 招式、简化近身指令投、MAX 爆气（1.5× 伤害）、防御破坏与紧急回避**。POW 槽封顶 100、每回合清零，消费点为超必杀（50）与 MAX 爆气（50）。仍未解禁：选人界面、联机对战、原作级逐帧手绘表现。

**English**: An original single-player 1v1 3D fighting vertical slice built with Three.js + Vite + TypeScript. No SNK characters or assets are used. Two distinct fighters — **Feiling ("Swift Shadow")**, a light, fast multi-hit combo character, and **Yuezheng ("Iron Mountain")**, a heavy grappler — each ship their own geometry, motion style and move table. Scope covers M0–M3: 23 frame-data moves, five command inputs, per-character command maps and cancel graphs, four branching follow-up chains, three multi-hit moves, a simplified close-range command grab, MAX mode (1.5× damage), guard crush, evasive roll, jump tiers and hitstop. Also implemented are stand/crouch guard levels with guard breaks, a three-round match flow with three AI difficulties, and mobile play through on-screen virtual keys (fullscreen on first tap, scale locked so rapid taps never double-tap zoom; iPhone Safari needs Add to Home Screen). Portrait viewports shrink the arena and pull the camera back just enough to keep both fighters framed. Standard gamepads work out of the box; a playable single-file build is published to GitHub Pages. Out of scope: character select, online/netcode play, and frame-by-frame hand-drawn animation fidelity. MIT-licensed; see `LICENSE` and `CREDITS.md`.

---

## 快速开始 / Quick start

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # 纯逻辑单测（node --test，不需要浏览器）
npm run build       # → kof-3d.html / kof-3d-vrm.html
npm run verify      # 浏览器端到端自检 + 截图 + shots/report.json
npm run smoke       # 只跑 boot 段只读断言
npm run dev         # 开发模式（Vite，127.0.0.1）
```

- `npm run build` 产出的 **`kof-3d.html` 是可离线双击打开的单文件**（`file://` 下零外部请求、无 CDN）。`kof-3d-vrm.html` 是内联 `assets/character.vrm` 的可替换资产槽演示版。
- 本仓库**只提交源码**：两份单文件 HTML 与 `shots/` 截图都在 `.gitignore` 中，clone 后跑 `npm install && npm run build` 即可得到可玩文件。线上试玩页由 `.github/workflows/pages.yml` 在 push 到 `main` 时自动构建并发布，产物同样不进仓库。
- `npm run verify` 需要本机 Chrome / Chromium。默认按常见路径自动探测；找不到时设 `CHROME_PATH=/path/to/chrome npm run verify`。拼图与近景图由浏览器 Canvas / `deviceScaleFactor` 生成，**不依赖 ImageMagick**。默认模式执行完整断言集，`npm run smoke` 只跑 boot 段；实际通过数由脚本末尾的「结果：X/Y 通过」汇总打印，不在文档中写死数量以免增删断言后失真。
- 环境：Node 22+。`puppeteer-core` 与 `esbuild` 都已声明在 devDependencies，换机器 `npm install` 即可跑全套自检。
- 验收顺序固定：`npm test` → `npm run build` → `npm run verify` 连跑两次全绿 → **人工看图**。数值全绿不等于视觉成立，历次靠 `shots/08-detail.png`、`06-poses.png`、`07-impact.png`、`09-super.png`、`10-touch-ui.png`、`11-mobile-landscape.png`、`12-mobile-portrait.png` 发现过姿态、裁切、特效质感、文字可读性、触屏布局与两人出画问题。

### 在线试玩 / Play online

<https://wangjunjian.com/kof-3d/>

`index.html` 就是构建出的 `kof-3d.html`，同目录另有 `kof-3d.html` 可直接下载离线游玩。自定义域来自用户站点仓库 `wang-junjian/wang-junjian.github.io` 已绑定的 `wangjunjian.com`：本仓库启用 Pages 后，项目站点自动挂到该域的 `/kof-3d/` 路径下，所以 `wang-junjian.github.io/kof-3d/` 会 301 跳转到这里（备用地址见文首）。两个入口返回的是同一份产物，可用 SHA256 复核；本仓库不配置 CNAME、不改动域名或 DNS。部署走官方 `actions/deploy-pages`：push 到 `main` 触发 `npm ci → npm test → typecheck → build → 构建可复现性检查 → 完整浏览器自检 → upload-pages-artifact → deploy`，也可在 Actions 里手动 `workflow_dispatch` 重跑。CI 通过 `browser-actions/setup-chrome` 提供浏览器并跑**完整** `npm run verify`，失败时上传 `shots/` 供排查。仓库**不提交任何构建产物**，Pages 的内容完全由 Actions 从源码重建；线上只发布默认版，`kof-3d-vrm.html` 为本地资产槽演示、线上 404 属既定设计。

---

## 操作 / Controls

| 按键 | 动作 |
|---|---|
| `A` / `D` | 左右移动 |
| `W` | 跳跃（朝对手方向为更高更远的前跳） |
| 按住**后方向** | 站防（挡中段 / 上段，漏下段） |
| 后方向 + `S` | 蹲防（挡中段 / 下段，漏上段） |
| 单按 `S` | 只下蹲，**不防御** |
| `J` / `K` / `L` / `I` | 轻拳 / 重拳 / 轻踢 / 重踢 |
| `→ + K` / `↘ + I` | 特殊技：绯翎 流光刺 / 燕落，岳铮 铁肩撞 / 踏山 |
| `S` → `S` + 前方向 → 松 `S` 保持方向 + 攻击键（`236`） | 绯翎 **千羽连**（三段，不耗 POW）；岳铮无此指令 |
| `214` / `623` / `41236` | 崩山拳·续·裂地 / 翎升·岳起 / 岳落（近身不可防投技，仅岳铮） |
| `236236` | 角色专属超必杀 **绯翎·天翔 / 铮·裂地**（消耗 50 POW，多 hit） |
| 千羽连 / 崩山拳 命中后按 `K` 或 `I` | 派生追加输入（羽落→天翔落 / 续·崩山→裂地） |
| 通常技命中后摇指令 | 按角色取消图取消进必杀 / 超杀 |
| `J` + `K` 同按 | MAX 爆气（消耗 50 POW，8 秒内伤害 1.5 倍） |
| 后方向 + `J` + `I` 同按 | 紧急回避（前 10 帧无敌） |
| `S` + 踢 | 下段扫腿（击倒） |
| 空中按攻击键 | 跳跃轻拳 / 跳跃重踢（上段） |
| `1` / `2` / `3` | 切换 AI 难度 EASY / NORMAL / HARD |

防御姿势选错会按普通命中结算，并弹出 `GUARD BREAK` 提示；连续格挡压力到 `GUARD_CRUSH_LIMIT` 会强制破防。命中取消需满足「本招已命中、已过 `startup`、目标在角色取消图内」，指令取消优先于按键取消。

**指令 / Commands**：`src/core/input.ts` 的 `COMMANDS` 表是唯一真值，方向用**相对 `facing` 的数字方位**（6 前 / 4 后 / 3 下前 / 1 下后 / 2 下 / 5 中立 / 8 跳），`Match` 知道朝向并把每帧归约成方位历史，倒序子序列匹配允许按住方向产生的重复帧。指令表按长度降序，一次摇杆同时满足多条时**超杀优先**；`CommandId → MoveId` 的映射放在 `src/core/characters.ts`，两人不同，这是角色独特性的核心。输入模型只有 `dir: -1|0|1` 与 `down`，↘ 用「`down` + `dir`」表达。POW 不足 50 时 `236236` 会按优先级自动降级成 `236` 普通必杀，一分 POW 不扣；窗口过期、背向摇杆、人在空中同样回退。顿帧期间摇出的指令会缓存到 `pendingCommands`，解冻帧照常结算。

**触屏 / Touch**：触屏设备（或 `pointer: coarse`）自动在左下显示十字方向键、右下显示「轻拳 / 重拳 / 轻踢 / 重踢」四键与绿色「236 必杀/超杀」键；横屏视野更宽，竖屏同样可玩。这一个宏键由对局状态决定：POW 不足半槽排 `236`，攒够自动升级成 `236236`。宏把指令序列排成逐帧输入喂给 `InputBuffer`，**走的是与键盘手摇完全相同的 `detectCommands()` 判定链路**，不是另一套规则。开机遮罩期间虚拟键不显示，触屏开机页也只显示设备对应的一行说明。

**竖屏取景 / Portrait framing**：手机竖屏时横向可见范围只有横屏的几分之一，原先固定的场地半宽 `3.35` 会让两人走出画面。`src/view/Framing.ts` 把视口宽高比翻译成一份取景契约：**横屏 / 桌面场地仍是 ±3.35、机位与演出完全不变；竖屏（aspect < 1）把场地收窄到约 ±1.30，同时把相机拉到「场地 + 角色肩膀余量」刚好入画的距离**（390×844 时 `cameraZ ≈ 14.16`、可见半宽 `2.00`），而不是把相机拉到 29 让角色缩成小点。边界经 `core/hitbox.ts` 的 `setArenaHalf()` 注入，`clampArena()` / `separate()` 的靠墙补偿、开局站位与旋转后的位置收拢都跟着走；帧表、判定框、AI 一律不动。竖屏镜头跟紧两人中点、减弱命中推镜与 KO 偏心，最后每帧用**真实相机矩阵投影**做硬兜底：任一人 NDC 超出 0.92 立即拉远机位，因此击退、旋转、摆拍等瞬态也不会出画。代价是竖屏最大间距约 2.6（横屏 6.7），拉开距离的战术空间变小。

**移动端全屏 / Mobile fullscreen**：**首次点击 / 触屏 / 按键开始游戏时自动进入全屏**（只在触屏设备触发，桌面保持浏览器窗口），并尝试锁定横屏；全屏、旋转、地址栏收起都会重算渲染尺寸。HUD 右侧常驻「⛶」按钮，按 Esc 或系统手势退出全屏后可随时重新进入。高频连点不会触发浏览器双击放大：`viewport` 锁了缩放，页面根层 `touch-action: none` + `overscroll-behavior: none`，另有 `dblclick` / iOS `gesture*` / 多指与拖动的手势兜底；单指 `touchstart` 刻意不拦，保证「左手方向 + 右手攻击」的多指同时按键照常生效。

> **iPhone Safari 的限制**：iOS 不提供元素级 Fullscreen API，网页内无法真正隐藏地址栏。页面已声明 `apple-mobile-web-app-capable` 等 meta，开机页会给出提示：**Safari「分享 → 添加到主屏幕」，再从主屏图标打开**即以 standalone 无地址栏全屏运行（此时不会再发起全屏请求）。Android Chrome / 多数 WebView 直接自动全屏，无需此步骤。

**手柄 / Gamepad**：标准手柄左摇杆 / 十字键控制方向，`A` `B` `X` `Y` 对应轻拳 / 重拳 / 轻踢 / 重踢，`RB` 是与触屏同源的一键指令（边缘触发，按住不重复排队，POW 满半槽自动升级超杀）。连接 / 断开会在底部提示。摇杆死区 `0.35`，斜下能同时给出 `down` + 方向，因此也可以手动摇任意指令。键盘、触屏、手柄按「或」合并、按来源分桶持有，松开其中一个不会误清另一个。

---

## 工程约定 / Hard constraints

1. **骨架指纹是硬断言**。`RigView.skeletonSignature()` 把关节父子关系 + 局部坐标 + 马尾链拼成指纹，基线写死在 `scripts/verify.mjs` 的 `RIG_BASELINE`。**不得改动 `JOINTS` 层级、骨骼长度与末端局部坐标**——`__kof.limbs()` 坐标探针与全部动作断言都依赖这些数值。几何精修只换外形网格；角色动作个性化由 `MotionStyle` **只缩放/偏移关节角**，不动骨架。
2. **纯 3D、零贴图**。`texturedMeshes === 0`；2D 脸部贴图路线已被彻底删除且不再恢复。角色外观只允许「纯 3D 几何」或「真实 VRM 资产」。
3. **默认单文件 < 1 MB**，零外部资源，可 `file://` 双击打开。`scripts/inline.mjs` 要求 dist 恰好一个 JS chunk、至多一个 CSS chunk，多 chunk 直接报错（避免静默覆盖产出坏文件）。VRM 插槽版因内联 `assets/character.vrm` 约 3.8 MB，属演示产物、不受 1 MB 限制；`verify.mjs` 的 1 MB 断言只校验默认版 `kof-3d.html`。
4. **逻辑与视觉时间分离**。逻辑固定 60Hz 步进 + 渲染插值；`rAF` 不直接驱动逻辑。Hitstop 冻结逻辑帧时**同时冻结视觉时间**（`Match.step()` 返回冻结标志），但 FX 仍按渲染 dt 推进。改帧表或步进方式会破坏可复现性。
5. **判定层自研**：状态机 + AABB（hitbox / hurtbox / pushbox），不上物理引擎。判定框局部坐标随 `facing` 镜像；单段招式命中只在 active 窗口结算一次，多段招式按 `HitWindow.frame` 逐段结算并用 `hitFrames` 去重；`resolveHits()` 先快照双方判定再统一结算，避免同帧互击恒为 p1 先手。
6. **改动收口**：纯逻辑规则改 `src/core/**` / `src/fighter/**` 时同步更新 `tests/*.test.mjs`；渲染 / 演出改动同步更新 `scripts/verify.mjs`。两层断言必须同时全绿。
7. **帧表 / 指令表 / 角色表是唯一真值**。`MOVES`（`core/frames.ts`）、`COMMANDS`（`core/input.ts`）、`CHARACTERS`（`core/characters.ts`）分别定义招式、指令与角色映射；`SUPER_COST = 50`、`QCF_WINDOW = 20` 经 `window.__kof.config` 暴露给自检，脚本不得硬编码第二份。加招只改数据，不在 `Fighter` / `Animator` / `Match` 里加按 id 的分支；基础 8 招数值与镜像 / 伸展下限冻结，新招按姿态类别走通用契约。
8. **输入设备归约单一入口**。键盘 / 触屏 / Gamepad 统一归约成 8 个 `InputRole`，经 `InputBuffer.press()/release(role, source)` 按来源分桶持有；纯逻辑层只认 `InputFrame`，不认识任何设备。`Controls.sync()` 必须在 `input.sample()` 之前调用。一键宏只做 `queueCommand()` 排帧，不得绕过 `Match.track()` 改写指令识别。
9. **仓库只提交源码**。`kof-3d*.html`、`dist/`、`shots/`、`tests/.build/` 均不入库；线上页面由 `.github/workflows/pages.yml` 从源码重建，禁止手工往仓库提交构建产物或往 Pages 分支塞 HTML。
10. **全屏只能在用户手势的同步栈里请求**。`Screen.enterAuto()` 由 `InputBuffer.onFirstInteraction` **同步**调用；任何 `await` / `setTimeout` 之后再 `requestFullscreen()` 都会因 transient activation 失效而被浏览器拒绝。手势护栏刻意不拦单指 `touchstart`，否则「左手方向 + 右手攻击」的多指同时按键会被吞。
11. **视口取景单一来源**。`framingFor(aspect)`（`src/view/Framing.ts`）是「场地半宽 + 机位距离」的唯一推导处；`main.ts` 的 resize 入口把 `gameCamera.framingState.arenaHalf` 下发给 `setArenaHalf()`，相机与逻辑层必须消费同一份契约。场地边界是**屏幕物理约束**而不是游戏规则：帧表、hitbox / hurtbox / pushbox 与 AI 距离分档都不随视口变化。
12. **镜像验证必须冻结动作风格**。两名角色的 `MotionStyle` 会变换关节角；`scripts/verify.mjs` 在跑严格镜像断言前调 `setMotionOverride('none')`，结束后恢复，否则测到的是风格差异而非 `root.scale.x = facing` 的几何对称性。

---

## 目录结构 / Layout

```
src/core/       loop / input / pad / state / frames / characters / hitbox / match   （纯逻辑，单测直接覆盖）
src/fighter/    Fighter / AI / Animator / rig / RigView / VrmView / CharacterView
src/view/       Stage / Camera / Framing（视口取景契约）/ Fx / Hud / Audio / Debug / Controls（触控 + 手柄 UI）/ Screen（全屏）/ Gestures（手势护栏）
scripts/        inline.mjs（单文件内联） / bundle-logic.mjs（单测打包） / verify.mjs（浏览器自检）
tests/          *.test.mjs（node --test 纯逻辑断言，含 m3.test.mjs 的指令 / 派生 / 攻防行为）
assets/         character.vrm（CC0 的 VRM 插槽输入，见 CREDITS.md）
.github/        workflows/pages.yml（构建并发布在线试玩页）
LICENSE         MIT License
CREDITS.md      第三方素材与依赖许可说明
```

`assets/candidates/`、`assets/art/`、`assets/faces/` 是本地历史调研素材，`shots/` 是自检截图，均不入库。渲染层通过 `CharacterView` 接口消费 `Pose`，因此程序化骨架与 VRM 共用同一套动作系统。

---

## `__kof` 调试 API

浏览器控制台里可用（`window.__kof`）：

| API | 用途 |
|---|---|
| `snapshot()` | 全部运行时状态：血量 / 阶段 / 镜头 / 取景 / FX 计数 / 骨架指纹 / `anim` / `fps` 与 `renderFps`；M3 另有 `characterNames`（中文名）与 `maxActive` |
| `framing.probe()` | 视口取景：`aspect` / 是否竖屏 / 基准与当前机位 / 场地半宽 / 可见半宽 / 两人实时 NDC |
| `framing.project(x1, x2)` | 用当前相机矩阵把任意两个世界 x 投影成 NDC |
| `match`、`moves` | 直接访问比赛状态机与完整招式帧表（自检用） |
| `baseMoves` | 两人共用的基础 8 招，镜像 / 伸展契约只对它们做严格跨角色比对 |
| `commands` | 指令定义表（id / 数字方位序列 / 窗口），自检据此生成手摇输入 |
| `characters` | 角色定义（中文名、称号、动作风格、指令表、取消图、专属超杀） |
| `setMotionOverride(id \| 'none' \| null)` | 临时冻结 / 恢复动作风格，用于验证几何镜像 |
| `config` | 数值单一来源：`superCost`（50）/ `qcfWindow`（20 帧） |
| `controls.probe()` | 触控 / 手柄汇合状态：可见性、设备判定、手柄角色、宏排队、按住的 `InputRole` |
| `controls.setTouchVisible(on)` | 桌面调试用：强制显示 / 隐藏虚拟键，传 `null` 回到设备自动判定 |
| `fullscreen.probe()` | 全屏状态：是否支持 / 当前是否全屏 / 触屏判定 / standalone / 自动请求次数 / 最近错误 |
| `fullscreen.enter()` · `exit()` · `toggle()` | 手动进入 / 退出 / 切换全屏（异步，返回 Promise） |
| `setPose(state, moveId?, frame?, opts?)` | 冻结逻辑并摆出指定动作帧；`opts` 支持 `guardLevel / airborne / y / side`，`side:1` 摆 AI 侧 |
| `clearPose()` | 解冻并复位两人 |
| `showImpact(heavy?)` | 摆出命中帧并触发全部打击演出，用于 `07-impact.png` |
| `showSuper()` | 摆出玩家角色真实超必杀发力帧并触发全部专属演出，用于 `09-super.png` |
| `sampleAttackTags(id)` | 按帧表抽样四段标签（windup / strike / follow / recovery） |
| `limbs(side)` | 左右拳套 / 左右脚的世界坐标与头部正面朝向，用于量化伸展方向 |
| `setDebug(true)` | 叠加 hurtbox / active hitbox / pushbox 线框 |
| `setDifficulty(d)`、`setJoint()` / `clearJoints()` | 难度切换、单关节角覆盖 |

---

## 已知差距 / Known gaps

- 程序化角色仍是 5 头身 Q 版手办；几何精修抬高的是下限，颜值上限需要真实 VRM 资产。动作由 13 关节欧拉角 + 3 段关键帧插值 + 姿态风格覆盖生成，能表达出拳 / 出腿 / 前冲 / 腾空 / 下砸，但**做不了**原作逐帧手绘的招式个性与抓取对位。
- VRM 插槽演示版不生成攻击残影（`SkinnedMesh` 克隆会共享实时骨架，剪影无法定格在发力帧）。
- 触屏布局以横屏为主；竖屏虽已保证两人始终入画，但场地收窄到约 ±1.30（最大间距 2.6），贴身战偏多、按键也更紧凑，且没有自定义键位 / 透明度设置。Android 全屏后会尝试锁横屏，iOS 只能由用户自行旋转。**iPhone Safari 网页内无法真正全屏**，需「添加到主屏幕」后以 standalone 运行。手柄映射写死为标准布局，无重绑定、无振动反馈。
- 指令族已覆盖 5 类，但**没有蓄力、连打计数、空中必杀、返技 / 当身、飞行道具、受身 / 倒地回避、拆投与 MAX 版超杀演出**；投技是「近距离 + 不可防 + 击飞」的简化版，不做双方骨骼对位。
- 没有选人界面：绯翎固定为 P1、岳铮固定为 CPU；AI 会按自身取消图 / 派生链 / 指令表出招，但两名角色的指令表不共享，玩家不能操作岳铮。
- POW 槽有两个消费点：超必杀（50）与 MAX 爆气（50），必杀本身 `meterGain = 0` 不回攒气。攻击者按帧表 `meterGain` 攒气（被防住也攒），防守方格挡 +3 / 受击 +2；封顶 `MAX_METER = 100`，每回合清零、胜场保留。暂无濒死无限超杀 / 储气 / 能量反击。
- `fps` 统计逻辑步/秒，`renderFps` 统计真实渲染帧/秒，掉帧时看后者。

---

## 开源与许可 / License & credits

- **代码**：[MIT License](LICENSE)，Copyright © 2026 Junjian Wang。欢迎 issue / PR；改动请遵守上文硬约束，并保证 `npm test` 与 `npm run verify` 两层断言全绿。
- **随仓库分发的素材**：`assets/character.vrm`（"Rose" / Polygonal Mind）为 **CC0**，字段与复核命令见 [CREDITS.md](CREDITS.md)。默认单文件产物 `kof-3d.html` 是纯 3D 程序化几何，**不含任何第三方模型、贴图或音频**。
- **npm 依赖**（three / @pixiv/three-vrm / vite / typescript / esbuild / puppeteer-core）经 `package-lock.json` 安装，许可证随各自 npm 包提供，本仓库不内嵌其源码。

**English**: Source code is MIT-licensed. The only bundled asset is a CC0 VRM sample documented in `CREDITS.md`; the default offline build contains no third-party model or texture.

---

## English summary

A deterministic 60 Hz logic step drives a Three.js render loop with interpolation. Fighters are a hand-written state machine with AABB hit/hurt/push boxes and a table-driven 23-move frame-data set (startup / active / recovery, mid / low / overhead guard levels, multi-hit windows, branching follow-ups, per-character cancel graphs, close-range unblockable grabs). Five relative-facing motion commands (236 / 214 / 623 / 41236 / 236236) are matched against a notation history and resolved through per-character command maps, so the two fighters genuinely play differently. MAX mode, guard crush, evasive roll, jump tiers and hitstop round out the system. Keyboard, touch and gamepad inputs are all reduced to eight `InputRole`s in `InputBuffer`; the touch macro and gamepad RB replay the same logical frames as a hand-rolled command and auto-upgrade to a super at 50 POW. The procedural characters are pure 3D geometry (no textures, no external assets) and share their `Pose` contract with an optional VRM slot. `npm test` covers the pure logic layer offline; `npm run verify` drives a real headless Chrome for rendering, screenshots, a simulated gamepad, touch viewports and the offline/zero-request contract, and runs in CI too. The playable single-file build is published to GitHub Pages by an Actions workflow, with no build artifacts committed. Never change joint hierarchy, bone lengths or end-point local coordinates — the skeleton signature in `verify.mjs` will fail immediately.
