# RIN vs FEI · 3D 格斗垂直切片

原创角色的 1v1 单机 3D 格斗网页切片（Three.js + Vite + TypeScript）。致敬式借鉴格斗游戏规则，不使用 SNK 角色与「拳皇」名称；角色为原创成年女性格斗家，时尚竞技路线。

> **在线试玩 / Play online**：<https://wangjunjian.com/kof-3d/> — 打开即玩、零安装；手机横屏自动出现虚拟键，标准手柄即插即用。试玩页同时提供 `kof-3d.html` 供下载后离线双击打开。
>
> **备用地址 / Fallback**：<https://wang-junjian.github.io/kof-3d/>（GitHub Pages 官方入口，会自动 301 跳转到上面的自定义域；主站域名变更时仍可访问）。
>
> **开源仓库**：<https://github.com/wang-junjian/kof-3d> · **MIT License**（见 [LICENSE](LICENSE)）· 第三方素材出处见 [CREDITS.md](CREDITS.md)。
>
> **商标声明 / Trademark**：`kof-3d` 只是本项目沿用的历史代号，与 SNK CORPORATION 及 "THE KING OF FIGHTERS" 系列没有任何关联、授权或背书；仓库不含任何 SNK 角色、美术或商标素材。

**范围**：M0 + M1 + **M2 最小闭环**（可打完一局，并围绕 POW 槽形成「攒气 → 236 → 消费 → 演出」的玩法目标）。已落地：站/蹲防与 GUARD BREAK、跳跃攻击、Hitstop、三回合流程、三档 AI、**轻拳接触后取消接重拳/重踢**的连段取消、**236 指令超必杀「流星直拳」**（消耗 50 POW，配专属姿态、打击演出与 HUD 反馈），以及**触屏虚拟方向键 + 四攻击键 + 236 快捷键、标准 Gamepad 支持**，以及**移动端自动全屏与防误缩放**。**未解禁**：选人界面（RIN 与 FEI 两名角色已内置但不可选，AI 不放必杀）、M3 的美术打磨 / 联机。POW 槽随攻击、格挡、受击累积，封顶 100、每回合清零，目前唯一的消费点是超必杀。

**English**: An original single-player 1v1 3D fighting vertical slice built with Three.js + Vite + TypeScript. No SNK characters or assets are used; the fighters are original adult characters in a competitive-sports style. Scope covers M0 + M1 plus a minimal M2 loop: a 236 motion-input super ("Meteor Straight") that spends 50 POW, with its own pose, hit FX and HUD feedback. Also implemented are a light-punch cancel into heavy punch / heavy kick, stand / crouch guard levels with guard breaks, jump attacks, hitstop, and a three-round match flow with three AI difficulties. Mobile play works through on-screen virtual keys with a one-tap 236 macro, enters fullscreen on the first tap and locks scaling so rapid taps never trigger double-tap zoom (iPhone Safari has no element fullscreen API and needs Add to Home Screen instead); standard gamepads work out of the box; a playable build is published to GitHub Pages. Out of scope: a character-select screen (RIN / FEI both ship built-in but are not selectable, and the AI never uses supers), art polish and online multiplayer. The POW meter accumulates, caps at 100, resets each round, and has exactly one spend path. MIT-licensed; see `LICENSE` and `CREDITS.md`.

---

## 快速开始 / Quick start

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # 67 条纯逻辑单测（node --test，不需要浏览器）
npm run build       # → kof-3d.html / kof-3d-vrm.html
npm run verify      # 浏览器端到端自检 + 截图 + shots/report.json
npm run dev         # 开发模式（Vite，127.0.0.1）
```

- `npm run build` 产出的 **`kof-3d.html` 是可离线双击打开的单文件**（`file://` 下零外部请求、无 CDN）。`kof-3d-vrm.html` 是内联 `assets/character.vrm` 的可替换资产槽演示版。
- 本仓库**只提交源码**：两份单文件 HTML 与 `shots/` 截图都在 `.gitignore` 中，clone 后跑 `npm install && npm run build` 即可得到可玩文件。线上试玩页由 `.github/workflows/pages.yml` 在 push 到 `main` 时自动构建并发布，产物同样不进仓库。
- `npm run verify` 需要本机 Chrome / Chromium。默认按常见路径自动探测；找不到时设 `CHROME_PATH=/path/to/chrome npm run verify`。拼图与近景图由浏览器 Canvas / `deviceScaleFactor` 生成，**不依赖 ImageMagick**。当前共 **103 条**浏览器断言。
- 环境：Node 22+。`puppeteer-core` 与 `esbuild` 都已声明在 devDependencies，换机器 `npm install` 即可跑全套自检。
- 验收顺序固定：`npm test` → `npm run build` → `npm run verify` 连跑两次全绿 → **人工看图**。数值全绿不等于视觉成立，历次靠 `shots/08-detail.png`、`06-poses.png`、`07-impact.png`、`09-super.png`、`10-touch-ui.png`、`11-mobile-landscape.png` 发现过姿态、裁切、特效质感、文字可读性与触屏布局问题。

### 在线试玩 / Play online

<https://wangjunjian.com/kof-3d/>

`index.html` 就是构建出的 `kof-3d.html`，同目录另有 `kof-3d.html` 可直接下载离线游玩。自定义域来自用户站点仓库 `wang-junjian/wang-junjian.github.io` 已绑定的 `wangjunjian.com`：本仓库启用 Pages 后，项目站点自动挂到该域的 `/kof-3d/` 路径下，所以 `wang-junjian.github.io/kof-3d/` 会 301 跳转到这里（备用地址见文首）。两个入口返回的是同一份产物，可用 SHA256 复核；本仓库不配置 CNAME、不改动域名或 DNS。部署走官方 `actions/deploy-pages`：push 到 `main` 触发 `npm ci → npm test → typecheck → build → upload-pages-artifact → deploy`，也可在 Actions 里手动 `workflow_dispatch` 重跑。CI 不跑 `npm run verify`（需要本机 Chrome），浏览器自检在本地验收时完成。仓库**不提交任何构建产物**，Pages 的内容完全由 Actions 从源码重建。

---

## 操作 / Controls

| 按键 | 动作 |
|---|---|
| `A` / `D` | 左右移动 |
| `W` | 跳跃 |
| 按住**后方向** | 站防（挡中段 / 上段，漏下段） |
| 后方向 + `S` | 蹲防（挡中段 / 下段，漏上段） |
| 单按 `S` | 只下蹲，**不防御** |
| `J` / `K` / `L` / `I` | 轻拳 / 重拳 / 轻踢 / 重踢 |
| `J` 接触后立刻按 `K` / `I` | 连段取消：轻拳接重拳 / 重踢 |
| `S` → `S` + 朝对手方向 → 松 `S` 保持方向 + 任一攻击键（`236`） | **超必杀「流星直拳」**，消耗 50 POW |
| `S` + 踢 | 下段扫腿（击倒） |
| 空中按攻击键 | 跳跃轻拳 / 跳跃重踢（上段） |
| `1` / `2` / `3` | 切换 AI 难度 EASY / NORMAL / HARD |

防御姿势选错会按普通命中结算，并弹出 `GUARD BREAK` 提示。连段取消需同时满足「轻拳已接触（命中或被防住都算）、已过 `startup`、按的是 `HP`/`HK`」；取消会重置招式帧与 `hitId`，新招式可再次结算命中。其余招式的 `cancelInto` 为空，不能连锁。

236 指令在 **20 逻辑帧（约 333ms）**窗口内识别：先按住 `S`（↓），再保持 `S` 加朝对手方向（↘），最后松开 `S`、保持该方向并按下任一攻击键（→ + 键）。输入模型只有 `dir: -1|0|1` 与 `down`、没有独立斜下方向，所以 ↘ 用「`down` + `dir`」组合表达；识别结果是**绝对**方向，`Fighter` 比对 `facing` 后才放行——站到对手右侧需要反摇 ↓↙←。POW 不足 50、背向摇杆、人在空中或窗口过期，都会回退成该键对应的普通招式，且一分 POW 不扣。指令目前只对玩家侧识别，AI 不放必杀。

**触屏 / Touch**：触屏设备（或 `pointer: coarse`）自动在左下显示十字方向键、右下显示「轻拳 / 重拳 / 轻踢 / 重踢」四键与绿色「236 必杀」键；建议横屏。一键 236 会把 ↓ → ↘ → →+攻击 排成 3 个逻辑帧喂给 `InputBuffer`，**走的是与键盘手摇完全相同的 `detectQcf()` 判定链路**，不是另一套规则。开机遮罩期间虚拟键不显示，触屏开机页也只显示设备对应的一行说明。

**移动端全屏 / Mobile fullscreen**：**首次点击 / 触屏 / 按键开始游戏时自动进入全屏**（只在触屏设备触发，桌面保持浏览器窗口），并尝试锁定横屏；全屏、旋转、地址栏收起都会重算渲染尺寸。HUD 右侧常驻「⛶」按钮，按 Esc 或系统手势退出全屏后可随时重新进入。高频连点不会触发浏览器双击放大：`viewport` 锁了缩放，页面根层 `touch-action: none` + `overscroll-behavior: none`，另有 `dblclick` / iOS `gesture*` / 多指与拖动的手势兜底；单指 `touchstart` 刻意不拦，保证「左手方向 + 右手攻击」的多指同时按键照常生效。

> **iPhone Safari 的限制**：iOS 不提供元素级 Fullscreen API，网页内无法真正隐藏地址栏。页面已声明 `apple-mobile-web-app-capable` 等 meta，开机页会给出提示：**Safari「分享 → 添加到主屏幕」，再从主屏图标打开**即以 standalone 无地址栏全屏运行（此时不会再发起全屏请求）。Android Chrome / 多数 WebView 直接自动全屏，无需此步骤。

**手柄 / Gamepad**：标准手柄左摇杆 / 十字键控制方向，`A` `B` `X` `Y` 对应轻拳 / 重拳 / 轻踢 / 重踢，`RB` 一键 236（边缘触发，按住不重复排队）。连接 / 断开会在底部提示。摇杆死区 `0.35`，斜下能同时给出 `down` + 方向，因此也可以手动摇 236。键盘、触屏、手柄按「或」合并、按来源分桶持有，松开其中一个不会误清另一个。

---

## 工程约定 / Hard constraints

1. **骨架指纹是硬断言**。`RigView.skeletonSignature()` 把关节父子关系 + 局部坐标 + 马尾链拼成指纹，基线写死在 `scripts/verify.mjs` 的 `RIG_BASELINE`。**不得改动 `JOINTS` 层级、骨骼长度与末端局部坐标**——`__kof.limbs()` 坐标探针与全部动作断言都依赖这些数值。几何精修只换外形网格。
2. **纯 3D、零贴图**。`texturedMeshes === 0`；2D 脸部贴图路线已被彻底删除且不再恢复。角色外观只允许「纯 3D 几何」或「真实 VRM 资产」。
3. **默认单文件 < 1 MB**，零外部资源，可 `file://` 双击打开。`scripts/inline.mjs` 要求 dist 恰好一个 JS chunk、至多一个 CSS chunk，多 chunk 直接报错（避免静默覆盖产出坏文件）。VRM 插槽版因内联 `assets/character.vrm` 约 3.8 MB，属演示产物、不受 1 MB 限制；`verify.mjs` 的 1 MB 断言只校验默认版 `kof-3d.html`。
4. **逻辑与视觉时间分离**。逻辑固定 60Hz 步进 + 渲染插值；`rAF` 不直接驱动逻辑。Hitstop 冻结逻辑帧时**同时冻结视觉时间**（`Match.step()` 返回冻结标志），但 FX 仍按渲染 dt 推进。改帧表或步进方式会破坏可复现性。
5. **判定层自研**：状态机 + AABB（hitbox / hurtbox / pushbox），不上物理引擎。判定框局部坐标随 `facing` 镜像，命中只在 active 窗口结算，每个招式 `hitId` 保证一次结算。
6. **改动收口**：纯逻辑规则改 `src/core/**` / `src/fighter/**` 时同步更新 `tests/*.test.mjs`；渲染 / 演出改动同步更新 `scripts/verify.mjs`。两层断言必须同时全绿。
7. **236 数值与方向判定单一来源**。`QCF_WINDOW = 20`（`core/input.ts`）与 `SUPER_COST = 50`（`core/frames.ts`）是唯一数值来源，经 `window.__kof.config` 暴露给 `verify.mjs`，自检脚本不得硬编码第二份。`detectQcf()` 只产出**绝对**方向，`facing` 比对只在 `Fighter.tryStartMove()` 里做；改站位镜像时不要把角色状态掺进输入层。
8. **输入设备归约单一入口**。键盘 / 触屏 / Gamepad 统一归约成 8 个 `InputRole`，经 `InputBuffer.press()/release(role, source)` 按来源分桶持有；纯逻辑层（`frames` / `Match` / `Fighter`）只认 `InputFrame`，不认识任何设备。新增设备不得在 `Fighter` 里加分支；`Controls.sync()` 必须在 `input.sample()` 之前调用，手柄轮询才不会慢一帧。
9. **仓库只提交源码**。`kof-3d*.html`、`dist/`、`shots/`、`tests/.build/` 均不入库；线上页面由 `.github/workflows/pages.yml` 从源码重建，禁止手工往仓库提交构建产物或往 Pages 分支塞 HTML。
10. **全屏只能在用户手势的同步栈里请求**。`Screen.enterAuto()` 由 `InputBuffer.onFirstInteraction` **同步**调用；任何 `await` / `setTimeout` 之后再 `requestFullscreen()` 都会因 transient activation 失效而被浏览器拒绝。手势护栏刻意不拦单指 `touchstart`，否则「左手方向 + 右手攻击」的多指同时按键会被吞。

---

## 目录结构 / Layout

```
src/core/       loop / input / pad / state / frames / hitbox / match   （纯逻辑，单测直接覆盖）
src/fighter/    Fighter / AI / Animator / rig / RigView / VrmView / CharacterView
src/view/       Stage / Camera / Fx / Hud / Audio / Debug / Controls（触控 + 手柄 UI）/ Screen（全屏）/ Gestures（手势护栏）
scripts/        inline.mjs（单文件内联） / bundle-logic.mjs（单测打包） / verify.mjs（浏览器自检）
tests/          *.test.mjs（node --test 纯逻辑断言）
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
| `snapshot()` | 全部运行时状态：血量 / 阶段 / 镜头 / FX 计数 / 骨架指纹 / `anim` / `fps` 与 `renderFps` |
| `match`、`moves` | 直接访问比赛状态机与帧表（含 `SUPER`；自检用） |
| `config` | M2 数值单一来源：`superCost`（50）/ `qcfWindow`（20 帧） |
| `controls.probe()` | 触控 / 手柄汇合状态：可见性、设备判定、手柄角色、宏排队、按住的 `InputRole` |
| `controls.setTouchVisible(on)` | 桌面调试用：强制显示 / 隐藏虚拟键，传 `null` 回到设备自动判定 |
| `fullscreen.probe()` | 全屏状态：是否支持 / 当前是否全屏 / 触屏判定 / standalone / 自动请求次数 / 最近错误 |
| `fullscreen.enter()` · `exit()` · `toggle()` | 手动进入 / 退出 / 切换全屏（异步，返回 Promise） |
| `setPose(state, moveId?, frame?, opts?)` | 冻结逻辑并摆出指定动作帧；`opts` 支持 `guardLevel / airborne / y` |
| `clearPose()` | 解冻并复位两人 |
| `showImpact(heavy?)` | 摆出命中帧并触发全部打击演出，用于 `07-impact.png` |
| `showSuper()` | 摆出超必杀发力帧并触发全部专属演出，用于 `09-super.png` |
| `sampleAttackTags(id)` | 按帧表抽样四段标签（windup / strike / follow / recovery） |
| `limbs(side)` | 左右拳套 / 左右脚的世界坐标，用于量化伸展方向 |
| `setDebug(true)` | 叠加 hurtbox / active hitbox / pushbox 线框 |
| `setDifficulty(d)`、`setJoint()` / `clearJoints()` | 难度切换、单关节角覆盖 |

---

## 已知差距 / Known gaps

- 程序化角色仍是 5 头身 Q 版手办；几何精修抬高的是下限，颜值上限需要真实 VRM 资产。
- VRM 插槽演示版不生成攻击残影（`SkinnedMesh` 克隆会共享实时骨架，剪影无法定格在发力帧）。
- 触屏布局按横屏设计；竖屏只给提示（Android 全屏后会尝试锁横屏，iOS 只能由用户自行旋转），按键紧凑且没有自定义键位 / 透明度设置。**iPhone Safari 网页内无法真正全屏**，需「添加到主屏幕」后以 standalone 运行。手柄映射写死为标准布局，无重绑定、无振动反馈。
- POW 槽只有一个消费点：236 超必杀扣 50（半槽，攒满可连放两次），必杀本身 `meterGain = 0` 不再攒气。攻击者按帧表 `meterGain` 攒气（被防住也攒），防守方格挡 +3 / 受击 +2，KO 分支不攒气；封顶 `MAX_METER = 100`，`resetForRound()` 每回合清零、胜场保留。暂无多级超必杀 / MAX 模式。
- 236 指令目前只接玩家侧，AI 不会放必杀；也没有选人界面与指令变体（214 / 623），普通招式不能取消进必杀。
- `fps` 统计逻辑步/秒，`renderFps` 统计真实渲染帧/秒，掉帧时看后者。

---

## 开源与许可 / License & credits

- **代码**：[MIT License](LICENSE)，Copyright © 2026 Junjian Wang。欢迎 issue / PR；改动请遵守上文硬约束，并保证 `npm test` 与 `npm run verify` 两层断言全绿。
- **随仓库分发的素材**：`assets/character.vrm`（"Rose" / Polygonal Mind）为 **CC0**，字段与复核命令见 [CREDITS.md](CREDITS.md)。默认单文件产物 `kof-3d.html` 是纯 3D 程序化几何，**不含任何第三方模型、贴图或音频**。
- **npm 依赖**（three / @pixiv/three-vrm / vite / typescript / esbuild / puppeteer-core）经 `package-lock.json` 安装，许可证随各自 npm 包提供，本仓库不内嵌其源码。
- **历史脚本**：`scripts/prepare-faces.sh` 属于已被否决的 2D 脸部贴图实验，当前构建**完全不引用**（`texturedMeshes === 0`），所依赖的 `assets/art/` 原图也不在仓库中；保留文件仅作演进记录。

**English**: Source code is MIT-licensed. The only bundled asset is a CC0 VRM sample documented in `CREDITS.md`; the default offline build contains no third-party model or texture. `scripts/prepare-faces.sh` is a deprecated experiment from the discarded 2D-texture approach and is not used by the build.

---

## English summary

A deterministic 60 Hz logic step drives a Three.js render loop with interpolation. Fighters are a hand-written state machine with AABB hit/hurt/push boxes and frame-data driven moves (startup / active / recovery, mid / low / overhead guard levels, jump attacks, hitstop, pushback, three-round match flow), a light-punch cancel window into heavy attacks, and a 236 motion-input super that spends 50 POW with its own pose, burst FX and HUD feedback. The POW meter accumulates per frame table, caps at 100 and resets each round; the super is its only spend path. Keyboard, touch and gamepad inputs are all reduced to eight `InputRole`s in `InputBuffer`, so the logic layer stays device-agnostic; the touch macro and the gamepad RB button replay the same three logical frames that a hand-rolled 236 produces. The procedural character is pure 3D geometry (no textures, no external assets) and shares its `Pose` contract with an optional VRM slot. `npm test` covers the pure logic layer offline; `npm run verify` drives a real headless Chrome for rendering, screenshots, a simulated gamepad, a touch viewport and the offline/zero-request contract. The playable single-file build is published to GitHub Pages by an Actions workflow, with no build artifacts committed to the repository. Never change joint hierarchy, bone lengths or end-point local coordinates — the skeleton signature in `verify.mjs` will fail immediately.
