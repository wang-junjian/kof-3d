# RIN vs FEI · 3D 格斗垂直切片

原创角色的 1v1 单机 3D 格斗网页切片（Three.js + Vite + TypeScript）。致敬式借鉴格斗游戏规则，不使用 SNK 角色与「拳皇」名称；角色为原创成年女性格斗家，时尚竞技路线。

> **开源仓库**：<https://github.com/wang-junjian/kof-3d> · **MIT License**（见 [LICENSE](LICENSE)）· 第三方素材出处见 [CREDITS.md](CREDITS.md)。
>
> **商标声明 / Trademark**：`kof-3d` 只是本项目沿用的历史代号，与 SNK CORPORATION 及 "THE KING OF FIGHTERS" 系列没有任何关联、授权或背书；仓库不含任何 SNK 角色、美术或商标素材。

**范围**：M0 + M1（可打完一局）。M2（236 指令必杀 / 能量消费 / 连段取消 / 第二角色 / 选人界面）与 M3（美术打磨 / 联机）**未解禁**，POW 槽目前只是展示属性。

**English**: An original single-player 1v1 3D fighting vertical slice built with Three.js + Vite + TypeScript. No SNK characters or assets are used; the fighters are original adult characters in a competitive-sports style. Scope is M0 + M1 only — combos, meter-consuming supers, extra characters and online play are intentionally out of scope. MIT-licensed; see `LICENSE` and `CREDITS.md`.

---

## 快速开始 / Quick start

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # 38 条纯逻辑单测（node --test，不需要浏览器）
npm run build       # → kof-3d.html / kof-3d-vrm.html
npm run verify      # 浏览器端到端自检 + 截图 + shots/report.json
npm run dev         # 开发模式（Vite，127.0.0.1）
```

- `npm run build` 产出的 **`kof-3d.html` 是可离线双击打开的单文件**（`file://` 下零外部请求、无 CDN）。`kof-3d-vrm.html` 是内联 `assets/character.vrm` 的可替换资产槽演示版。
- 本仓库**只提交源码**：两份单文件 HTML 与 `shots/` 截图都在 `.gitignore` 中，clone 后跑 `npm install && npm run build` 即可得到可玩文件。
- `npm run verify` 需要本机 Chrome / Chromium。默认按常见路径自动探测；找不到时设 `CHROME_PATH=/path/to/chrome npm run verify`。拼图与近景图由浏览器 Canvas / `deviceScaleFactor` 生成，**不依赖 ImageMagick**。
- 环境：Node 22+。`puppeteer-core` 与 `esbuild` 都已声明在 devDependencies，换机器 `npm install` 即可跑全套自检。
- 验收顺序固定：`npm test` → `npm run build` → `npm run verify` 连跑两次全绿 → **人工看图**。数值全绿不等于视觉成立，历次靠 `shots/08-detail.png`、`06-poses.png`、`07-impact.png` 发现过姿态、裁切与特效质感问题。

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
| `S` + 踢 | 下段扫腿（击倒） |
| 空中按攻击键 | 跳跃轻拳 / 跳跃重踢（上段） |
| `1` / `2` / `3` | 切换 AI 难度 EASY / NORMAL / HARD |

防御姿势选错会按普通命中结算，并弹出 `GUARD BREAK` 提示。

---

## 工程约定 / Hard constraints

1. **骨架指纹是硬断言**。`RigView.skeletonSignature()` 把关节父子关系 + 局部坐标 + 马尾链拼成指纹，基线写死在 `scripts/verify.mjs` 的 `RIG_BASELINE`。**不得改动 `JOINTS` 层级、骨骼长度与末端局部坐标**——`__kof.limbs()` 坐标探针与全部动作断言都依赖这些数值。几何精修只换外形网格。
2. **纯 3D、零贴图**。`texturedMeshes === 0`；2D 脸部贴图路线已被彻底删除且不再恢复。角色外观只允许「纯 3D 几何」或「真实 VRM 资产」。
3. **单文件 < 1 MB**，零外部资源，可 `file://` 双击打开。`scripts/inline.mjs` 要求 dist 恰好一个 JS chunk、至多一个 CSS chunk，多 chunk 直接报错（避免静默覆盖产出坏文件）。
4. **逻辑与视觉时间分离**。逻辑固定 60Hz 步进 + 渲染插值；`rAF` 不直接驱动逻辑。Hitstop 冻结逻辑帧时**同时冻结视觉时间**（`Match.step()` 返回冻结标志），但 FX 仍按渲染 dt 推进。改帧表或步进方式会破坏可复现性。
5. **判定层自研**：状态机 + AABB（hitbox / hurtbox / pushbox），不上物理引擎。判定框局部坐标随 `facing` 镜像，命中只在 active 窗口结算，每个招式 `hitId` 保证一次结算。
6. **改动收口**：纯逻辑规则改 `src/core/**` / `src/fighter/**` 时同步更新 `tests/*.test.mjs`；渲染 / 演出改动同步更新 `scripts/verify.mjs`。两层断言必须同时全绿。

---

## 目录结构 / Layout

```
src/core/       loop / input / state / frames / hitbox / match   （纯逻辑，单测直接覆盖）
src/fighter/    Fighter / AI / Animator / rig / RigView / VrmView / CharacterView
src/view/       Stage / Camera / Fx / Hud / Audio / Debug
scripts/        inline.mjs（单文件内联） / bundle-logic.mjs（单测打包） / verify.mjs（浏览器自检）
tests/          *.test.mjs（node --test 纯逻辑断言）
assets/         character.vrm（CC0 的 VRM 插槽输入，见 CREDITS.md）
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
| `match`、`moves` | 直接访问比赛状态机与帧表（自检用） |
| `setPose(state, moveId?, frame?, opts?)` | 冻结逻辑并摆出指定动作帧；`opts` 支持 `guardLevel / airborne / y` |
| `clearPose()` | 解冻并复位两人 |
| `showImpact(heavy?)` | 摆出命中帧并触发全部打击演出，用于 `07-impact.png` |
| `sampleAttackTags(id)` | 按帧表抽样四段标签（windup / strike / follow / recovery） |
| `limbs(side)` | 左右拳套 / 左右脚的世界坐标，用于量化伸展方向 |
| `setDebug(true)` | 叠加 hurtbox / active hitbox / pushbox 线框 |
| `setDifficulty(d)`、`setJoint()` / `clearJoints()` | 难度切换、单关节角覆盖 |

---

## 已知差距 / Known gaps

- 程序化角色仍是 5 头身 Q 版手办；几何精修抬高的是下限，颜值上限需要真实 VRM 资产。
- VRM 插槽演示版不生成攻击残影（`SkinnedMesh` 克隆会共享实时骨架，剪影无法定格在发力帧）。
- 移动端目前只能看、不能玩；虚拟方向键 + 四攻击键 + Gamepad 排在后续路线图。
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

A deterministic 60 Hz logic step drives a Three.js render loop with interpolation. Fighters are a hand-written state machine with AABB hit/hurt/push boxes and frame-data driven moves (startup / active / recovery, mid / low / overhead guard levels, jump attacks, hitstop, pushback, three-round match flow). The procedural character is pure 3D geometry (no textures, no external assets) and shares its `Pose` contract with an optional VRM slot. `npm test` covers the pure logic layer offline; `npm run verify` drives a real headless Chrome for rendering, screenshots and the offline/zero-request contract. Never change joint hierarchy, bone lengths or end-point local coordinates — the skeleton signature in `verify.mjs` will fail immediately.
