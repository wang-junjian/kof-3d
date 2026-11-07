import * as THREE from 'three';
import './style.css';
import { FixedLoop } from './core/loop';
import { InputBuffer, QCF_WINDOW, COMMANDS } from './core/input';
import { clampArena, setArenaHalf } from './core/hitbox';
import { Match } from './core/match';
import { BASE_MOVES, MOVES, SUPER_COST, type CharId, type MoveId } from './core/frames';
import { CHARACTERS } from './core/characters';
import type { FighterState } from './core/state';
import { AIController, type Difficulty } from './fighter/AI';
import { createRig, FEI, RIN, type JointName } from './fighter/rig';
import { RigView } from './fighter/RigView';
import { loadVrmViews, VrmView } from './fighter/VrmView';
import type { CharacterView } from './fighter/CharacterView';
import { Animator, sampleAttackTags, setMotionOverride, type AnimDebug } from './fighter/Animator';
import { Stage } from './view/Stage';
import { GameCamera, type CameraDebug, type FramingProbe } from './view/Camera';
import { Fx, type FxProbe } from './view/Fx';
import { DebugBoxes } from './view/Debug';
import { Hud } from './view/Hud';
import { Sfx } from './view/Audio';
import { Controls, type ControlsProbe } from './view/Controls';
import { Screen, type ScreenProbe } from './view/Screen';

interface FighterSnap {
  hp: number; meter: number; state: string; move: string | null;
  moveLevel: string | null; guardLevel: string | null; landingStun: number;
  x: number; y: number; combo: number; wins: number; facing: number;
}

/** 程序化角色外形探针：骨架指纹保证动作系统不受几何精修影响。 */
interface RigProbe {
  skeleton: string;
  meshes: number;
  boxes: number;
  triangles: number;
  materials: number;
}

interface KofSnapshot {
  ready: boolean;
  /** fps = 逻辑步/秒；renderFps = 真实渲染帧/秒，掉帧时两者会分离。 */
  frame: number; fps: number; renderFps: number; phase: string; round: number; timer: number;
  hitstop: number; maxHitstop: number; hitCount: number; sparks: number; sparksTotal: number;
  p1: FighterSnap; p2: FighterSnap;
  announce: string; winner: string; timerText: string; hp1Width: string;
  bootHidden: boolean;
  characterMode: string;
  vrmBones: number;
  /** M3：两名角色的中文名与 MAX 爆气状态。 */
  characterNames: [string, string];
  maxActive: [boolean, boolean];
  difficulty: Difficulty;
  debug: boolean;
  debugBoxes: number;
  /** 镜头演出状态（命中推镜 / KO 特写）。 */
  camera: CameraDebug;
  /** 视口取景：场地半宽、可见半宽与两人真实投影，供竖屏入画断言读取。 */
  framing: FramingProbe;
  /** 打击演出分项计数：counts = 当前存活，totals = 累计触发。 */
  fx: FxProbe;
  /** 视觉时间：Hitstop 期间刻意冻结，与逻辑帧无关。 */
  visualTime: number;
  comboText: string;
  koVignette: boolean;
  /** 角色身上带贴图材质的网格数；纯 3D 版必须为 0。 */
  texturedMeshes: number;
  /** 程序化角色的骨架指纹与网格统计；VRM 模式下为 null。 */
  rig: RigProbe | null;
  /** 两名角色 root 的 X 缩放：姿态表按 facing=+1 标定，p2 必须为 -1 才朝对手出招。 */
  viewScale: [number, number];
  /** 两人各自的外形统计：剪影差异契约（FEI 的护肩/刘海/马尾与 RIN 不同）。 */
  rigPair: [RigProbe | null, RigProbe | null];
  /** 两名角色当前动作状态，供自检做姿态连续性验证。 */
  anim: [AnimDebug, AnimDebug];
  canvas: { w: number; h: number };
  glLost: boolean;
  /** 移动端全屏 / 手势适配状态，供浏览器自检与线上验证读取。 */
  fullscreen: ScreenProbe;
}

interface PoseOptions {
  guardLevel?: 'stand' | 'crouch';
  airborne?: boolean;
  y?: number;
  /** 摆拍对象：默认玩家侧。指定 1 才能给 AI 侧摆关键帧，验证镜像后的动作方向。 */
  side?: 0 | 1;
}

interface KofApi {
  ready: boolean;
  snapshot: () => KofSnapshot;
  match: Match;
  moves: typeof MOVES;
  /** M2 调参探针：自检从这里读消耗与窗口，避免脚本里硬编码第二份数值。 */
  config: { superCost: number; qcfWindow: number };
  /** M3：两人共用的基础招式清单，镜像 / 伸展契约只对它们做严格跨角色比对。 */
  baseMoves: readonly MoveId[];
  /** M3：通用指令定义表，自检据此生成手摇输入，不再手写第二份序列。 */
  commands: typeof COMMANDS;
  /** M3：角色定义（中文名、指令表、取消图、动作风格）。 */
  characters: typeof CHARACTERS;
  /** M3：临时冻结两人动作风格以验证几何镜像；null 恢复各自风格。 */
  setMotionOverride: (id: CharId | 'none' | null) => void;
  /** 调试钩子：冻结逻辑、摆出超必杀发力帧并触发全部专属演出。 */
  showSuper: () => void;
  /** 切换 AI 难度；同步刷新 HUD 标签。 */
  setDifficulty: (d: Difficulty) => void;
  /** 判定框线框可视化开关（调试用）。 */
  setDebug: (on: boolean) => void;
  /** 调试钩子：冻结逻辑、摆出命中帧并触发全部打击演出，用于演出截图。 */
  showImpact: (heavy?: boolean) => void;
  /** 调试钩子：冻结逻辑、摆出指定动作帧，用于动作关键帧截图与断言。 */
  setPose: (state: FighterState, moveId?: MoveId | null, frame?: number, opts?: PoseOptions) => void;
  clearPose: () => void;
  /** 自检：按帧表返回某个招式的动作分段标签序列。 */
  sampleAttackTags: (id: MoveId) => string[];
  /** 自检探针：左右拳、左右脚的世界坐标，以及头部正面朝向向量，用于量化伸展方向与正脸。 */
  limbs: (side: 0 | 1) => {
    fistL: number[]; fistR: number[]; footL: number[]; footR: number[]; headFront: number[];
  } | null;
  /** 调试钩子：实时覆盖关节角，用于标定动作；不参与正常渲染。 */
  setJoint: (joint: JointName, angles: [number, number, number]) => void;
  clearJoints: () => void;
  /** 输入设备探针：触屏虚拟键与 Gamepad 的汇合状态，供浏览器自检使用。 */
  controls: {
    probe: () => ControlsProbe;
    setTouchVisible: (on: boolean | null) => void;
  };
  /** 全屏状态探针与手动开关（自动全屏在首次交互里已触发）。 */
  fullscreen: {
    probe: () => ScreenProbe;
    enter: () => Promise<boolean>;
    exit: () => Promise<void>;
    toggle: () => Promise<void>;
  };
  /** 取景探针：把任意两个世界 x 投到 NDC，验证极端站位是否仍在画面内。 */
  framing: {
    probe: () => FramingProbe;
    project: (x1: number, x2: number) => [number, number];
  };
}

declare global {
  interface Window {
    __kof?: KofApi;
    /** 构建期由 scripts/inline.mjs 注入：assets/character.vrm 的 base64。 */
    __KOF_VRM__?: string;
  }
}

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;
const boot = document.getElementById('boot') as HTMLElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const stage = new Stage();
const gameCamera = new GameCamera(window.innerWidth / window.innerHeight);
// 必须在 Match 构造（会按边界摆开局站位）之前下发：竖屏场地比默认 ±1.5 窄。
setArenaHalf(gameCamera.framingState.arenaHalf);
const fx = new Fx(stage.scene);
const hud = new Hud(hudRoot);
const sfx = new Sfx();
const input = new InputBuffer();

// 默认纯 3D 程序化角色；若构建时放入 assets/character.vrm，则异步热替换为 VRM 渲染层
let views: CharacterView[] = [
  new RigView(createRig(RIN, 'RIN')),
  new RigView(createRig(FEI, 'FEI')),
];
for (const view of views) {
  stage.scene.add(view.root);
  stage.scene.add(view.shadow);
}
const animators = [new Animator(views[0]), new Animator(views[1])] as const;
let characterMode = 'procedural';
let vrmBones = 0;

const embeddedVrm = window.__KOF_VRM__;
if (embeddedVrm) {
  loadVrmViews(embeddedVrm)
    .then((vrmViews) => {
      for (const view of views) view.dispose();
      views = vrmViews;
      for (const view of views) {
        stage.scene.add(view.root);
        stage.scene.add(view.shadow);
      }
      animators[0].setView(views[0]);
      animators[1].setView(views[1]);
      characterMode = 'vrm';
      vrmBones = views[0] instanceof VrmView ? views[0].boneCount : 0;
    })
    .catch((err: unknown) => {
      // 资产不可用时保持可玩，不阻断对局
      console.warn('[kof-3d] VRM 加载失败，回退程序化角色：', err);
    });
}

let hitCount = 0;
let maxHitstop = 0;
let poseLock = false;

const ai = new AIController();
const match = new Match(ai, {
  onHit: (e) => {
    hitCount++;
    const isSuper = e.move.id === 'SUPER' || e.move.command === '236236';
    const heavy = isSuper || e.move.damage >= 9;
    const facing = e.attacker.facing;
    fx.hit(e.x, e.y, e.blocked, heavy, e.guardBreak);
    fx.speedLines(e.x, e.y, heavy);
    fx.glow(e.x, e.y, heavy, e.blocked);
    fx.arc(e.x, e.y, facing, heavy);
    if (isSuper) {
      fx.superBurst(e.x, e.y, facing);
      hud.superAlert('SUPER FINISH');
      sfx.superMove();
    }
    if (e.guardBreak) {
      const hint = e.move.level === 'low' ? '下段需蹲防' : '上段需站防';
      hud.guardBreak(`GUARD BREAK · ${hint}`);
    }
    gameCamera.impact(e.x, isSuper ? 1.35 : heavy ? 0.95 : 0.55);
    gameCamera.punch(e.blocked ? 0.10 : heavy ? 0.40 : 0.22);
    hud.combo(e.attacker === match.p1 ? 0 : 1, e.attacker.combo);
    hud.flash(isSuper ? 'super' : heavy && !e.blocked && !e.guardBreak ? 'tap' : null);
    sfx.hit(heavy, e.blocked);
  },
  onRoundStart: () => {
    hud.reset();
    gameCamera.reset();
    sfx.announce('round');
  },
  // 每回合 KO / TIME UP 都走特写，不只是整场比赛结束；下一回合 intro 时复位。
  // 焦点取两人中点：倒地者躺下后身体沿地面向外铺开近一个身长，只压胜者会把
  // 一整条身体推出画外，只剩小腿卡在边上。
  onRoundEnd: () => {
    hud.setKo(true);
    hud.flash('ko');
    gameCamera.ko((match.p1.x + match.p2.x) / 2);
  },
  onMatchEnd: (winner) => hud.showWinner(
    winner === 0 ? CHARACTERS.FEILING.name : CHARACTERS.YUEZHENG.name),
  onAnnounce: (text) => {
    hud.announce(text);
    if (text === 'FIGHT') sfx.announce('fight');
    else if (text === 'K.O.' || text === 'TIME UP') sfx.announce('ko');
    else if (text.startsWith('ROUND')) sfx.announce('round');
  },
  onReset: () => { hud.reset(); gameCamera.reset(); },
});

const debug = new DebugBoxes(stage.scene, match);
hud.setDifficulty(ai.level);

const DIFFICULTY_KEYS: Record<string, Difficulty> = {
  Digit1: 'easy', Digit2: 'normal', Digit3: 'hard',
};
window.addEventListener('keydown', (e) => {
  const d = DIFFICULTY_KEYS[e.code];
  if (!d) return;
  ai.setDifficulty(d);
  hud.setDifficulty(d);
});

// 视口尺寸统一入口：全屏切换、地址栏收起、旋转屏幕、visualViewport 变化都走这里。
// rAF 去重，避免一次全屏过渡里连发 resize 造成多次 setSize。
const onResize = (): void => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  gameCamera.resize(w / h);
  // 取景与场地边界必须由同一个 aspect 推导；旋转 / 全屏切换后立刻收拢站位，
  // 不等下一逻辑帧，否则会先闪一帧「人在画外」。
  setArenaHalf(gameCamera.framingState.arenaHalf);
  match.p1.x = clampArena(match.p1.x);
  match.p2.x = clampArena(match.p2.x);
};
let resizeQueued = false;
const scheduleResize = (): void => {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => { resizeQueued = false; onResize(); });
};
const screen = new Screen(scheduleResize);
window.addEventListener('resize', scheduleResize);

input.onFirstInteraction = () => {
  // 必须留在用户手势的同步调用栈里：await / setTimeout 之后浏览器就不再允许全屏。
  screen.enterAuto();
  sfx.unlock();
  document.body.classList.add('started');
  boot.classList.add('gone');
};

// 触屏虚拟键 + Gamepad 与键盘共用 InputBuffer；236 只在可推进对局的阶段排队。
const controls = new Controls(document.body, input, {
  facing: () => (match.p1.facing >= 0 ? 1 : -1),
  canMacro: () => match.phase === 'fight' && match.hitstop === 0,
  // 同一个一键宏：POW 不足半槽摇 236 普通必杀，攒够则升级成 236236 超必杀。
  // 不新增键位，也不在输入层写死第二份数值。
  macroCommand: () => (match.p1.meter >= SUPER_COST ? '236236' : '236'),
});

let time = 0;
const prevLanding = [0, 0];
const prevStrike = [false, false];
const prevSuper = [false, false];
const loop = new FixedLoop(
  () => {
    if (poseLock) {
      time++;
      return;
    }
    // Hitstop 冻结了逻辑，视觉时间也必须一起冻结：否则角色呼吸与姿态平滑
    // 会在「定格」画面里继续动，顿帧感被削弱。逻辑步进与帧表完全不受影响。
    // 用 step() 返回的冻结标志判定，而不是调用前读 hitstop（step 内部会递减它）。
    controls.sync(); // Gamepad 是轮询设备，必须在 sample() 之前把本帧状态汇入
    const frozen = match.step(input.sample());
    maxHitstop = Math.max(maxHitstop, match.hitstop);
    if (!frozen) time++;
  },
  (alpha, dtMs) => {
    animators[0].update(match.p1, time + alpha);
    animators[1].update(match.p2, time + alpha);
    if (!poseLock) {
      for (let i = 0; i < 2; i++) {
        const f = i === 0 ? match.p1 : match.p2;
        const a = animators[i].inspect();
        // 落地烟尘与 Animator 的落地缓冲同源，用 0→>0 边沿触发
        if (prevLanding[i] === 0 && a.landing > 0) fx.dust(f.x);
        prevLanding[i] = a.landing;
        // 发力首帧生成当前姿态的半透明剪影，挥空也保留速度感
        const striking = a.tag.startsWith('strike:');
        if (striking && !prevStrike[i] && fx.canGhost()) {
          fx.ghost(views[i].ghost?.() ?? null, i === 0 ? 0xff7fb2 : 0x63d5f2, f.facing);
        }
        prevStrike[i] = striking;
        // M2 超必杀起招：聚气柔光 + 酸绿提示，让「攒满 → 消费」有即时反馈
        const superActive = f.move?.id === 'SUPER' || f.move?.command === '236236';
        if (superActive && !prevSuper[i]) {
          fx.glow(f.x + f.facing * 0.35, 1.15, true, false);
          const who = i === 0 ? CHARACTERS.FEILING.name : CHARACTERS.YUEZHENG.name;
          hud.superAlert(`${who} · SUPER`);
        }
        prevSuper[i] = superActive;
      }
    }
    gameCamera.update(match.p1.x, match.p2.x);
    fx.update(dtMs);
    hud.update(match);
    debug.update();
    renderer.render(stage.scene, gameCamera.cam);
  },
);

loop.start();

const snapFighter = (f: {
  hp: number; meter: number; state: string;
  move: { id: string; level: string } | null;
  guardLevel: string | null; landingStun: number;
  x: number; y: number; combo: number; wins: number; facing: number;
}): FighterSnap => ({
  hp: f.hp, meter: f.meter, state: f.state, move: f.move?.id ?? null,
  moveLevel: f.move?.level ?? null, guardLevel: f.guardLevel,
  landingStun: f.landingStun,
  x: f.x, y: f.y, combo: f.combo, wins: f.wins, facing: f.facing,
});

const setPose = (state: FighterState, moveId?: MoveId | null, frame = 0, opts: PoseOptions = {}): void => {
  poseLock = true;
  const airMove = moveId ? MOVES[moveId].air === true : false;
  const airborne = opts.airborne ?? (state === 'jump' || airMove);
  // side=1 时把同一套摆拍作用于 AI 侧：两人 facing / x 互为镜像，
  // 这样 limbs(1) 的能量化「对方」的动作是否也朝自己的对手伸展。
  const side = opts.side ?? 0;
  const subject = side === 1 ? match.p2 : match.p1;
  const other = side === 1 ? match.p1 : match.p2;
  subject.state = state;
  subject.stateFrame = frame;
  subject.move = moveId ? MOVES[moveId] : null;
  subject.moveFrame = frame;
  subject.hitId++;
  subject.stunLeft = 24;
  subject.landingStun = 0;
  // 摆拍会冻结逻辑，受击闪红不会自然衰减，必须主动清掉
  subject.flash = 0;
  // 摆拍时抬得太高会超出拼图裁剪区，默认留出头顶余量
  subject.y = airborne ? (opts.y ?? 0.26) : 0;
  subject.vy = 0; subject.vx = 0;
  subject.airborne = airborne;
  subject.guarding = state === 'guard';
  subject.guardLevel = state === 'guard' ? (opts.guardLevel ?? 'crouch') : null;
  subject.crouching = state === 'crouch' || (state === 'guard' && subject.guardLevel === 'crouch');
  subject.x = side === 1 ? 0.92 : -0.92;
  subject.facing = side === 1 ? -1 : 1;
  other.state = 'idle'; other.move = null; other.moveFrame = 0;
  other.x = side === 1 ? -0.92 : 0.92;
  other.y = 0; other.vy = 0; other.vx = 0;
  other.airborne = false; other.facing = side === 1 ? 1 : -1;
  other.guarding = false; other.guardLevel = null; other.crouching = false;
  other.landingStun = 0;
  other.flash = 0;
};

const clearPose = (): void => {
  for (const f of [match.p1, match.p2]) {
    f.state = 'idle'; f.move = null; f.moveFrame = 0;
    f.stateFrame = 0; f.stunLeft = 0; f.landingStun = 0;
    f.y = 0; f.vy = 0; f.vx = 0;
    f.airborne = false; f.guarding = false; f.guardLevel = null; f.crouching = false;
  }
  poseLock = false;
};

/** 调试：冻结逻辑、摆出命中帧并触发全部打击演出，供演出截图与断言使用。 */
const showImpact = (heavy = true): void => {
  poseLock = true;
  const p1 = match.p1;
  const p2 = match.p2;
  match.hitstop = 0;
  match.phase = 'fight';
  p1.state = 'attack';
  p1.move = MOVES[heavy ? 'HP' : 'LP'];
  p1.moveFrame = 7;
  p1.stateFrame = 7;
  p1.hitId++;
  p1.x = -0.62; p1.facing = 1; p1.y = 0; p1.vy = 0; p1.vx = 0;
  p1.airborne = false; p1.flash = 0; p1.combo = 3; p1.comboTimer = 40;
  p2.state = 'hitstun'; p2.move = null; p2.stunLeft = 22; p2.stateFrame = 0;
  p2.x = 0.62; p2.y = 0; p2.facing = -1; p2.flash = 0;
  // 先把姿态推进到发力帧，残影克隆出来的才是 strike 剪影而非上一帧
  animators[0].update(p1, time + 1);
  animators[1].update(p2, time + 1);
  const x = 0.02;
  const y = 1.16;
  fx.hit(x, y, false, heavy);
  fx.speedLines(x, y, heavy);
  fx.glow(x, y, heavy, false);
  fx.arc(x, y, 1, heavy);
  if (fx.canGhost()) fx.ghost(views[0].ghost?.() ?? null, 0xff7fb2, 1);
  gameCamera.impact(x, heavy ? 0.95 : 0.55);
  hud.combo(0, 3);
  hud.flash('tap');
};

/** 调试：摆出超必杀发力帧并触发全部专属演出，供 09-super.png 与特效断言使用。 */
const showSuper = (): void => {
  poseLock = true;
  const p1 = match.p1;
  const p2 = match.p2;
  // 摆拍用玩家角色的真实超必杀（绯翎·天翔），而不是仅供兼容链路的旧 SUPER。
  const superMove = MOVES[CHARACTERS.FEILING.superMove];
  match.hitstop = 0;
  match.phase = 'fight';
  p1.state = 'attack';
  p1.move = superMove;
  p1.moveFrame = superMove.startup;
  p1.stateFrame = superMove.startup;
  p1.hitId++;
  p1.x = -0.72; p1.facing = 1; p1.y = 0; p1.vy = 0; p1.vx = 0;
  p1.airborne = false; p1.flash = 0; p1.combo = 3; p1.comboTimer = 40;
  p2.state = 'hitstun'; p2.move = null; p2.stunLeft = 30; p2.stateFrame = 0;
  p2.x = 0.72; p2.y = 0; p2.facing = -1; p2.flash = 0;
  animators[0].update(p1, time + 1);
  animators[1].update(p2, time + 1);
  const x = 0.06;
  const y = 1.22;
  fx.hit(x, y, false, true);
  fx.superBurst(x, y, 1);
  hud.superAlert('SUPER FINISH');
  hud.flash('super');
  hud.combo(0, 3);
  gameCamera.impact(x, 1.35);
  if (fx.canGhost()) fx.ghost(views[0].ghost?.() ?? null, 0xff7fb2, 1);
};

const rigProbe = (i: 0 | 1): RigProbe | null => {
  const v = views[i];
  if (!(v instanceof RigView)) return null;
  return { skeleton: v.skeletonSignature(), ...v.geometryStats() };
};

window.__kof = {
  ready: true,
  match,
  moves: MOVES,
  config: { superCost: SUPER_COST, qcfWindow: QCF_WINDOW },
  baseMoves: BASE_MOVES,
  commands: COMMANDS,
  characters: CHARACTERS,
  setMotionOverride,
  showSuper,
  setDifficulty: (d) => { ai.setDifficulty(d); hud.setDifficulty(d); },
  setDebug: (on) => debug.setEnabled(on),
  setPose,
  clearPose,
  showImpact,
  sampleAttackTags,
  limbs: (side: 0 | 1) => {
    const v = views[side];
    if (!(v instanceof RigView)) return null;
    // 头部局部 +Z 是脸的正面；取两点之差得到世界朝向，用来检测 p2 是否被
    // 重复的头部补偿转成侧脸（z 分量会明显掉下去）。
    const o = v.worldPoint('head', [0, 0, 0]);
    const n = v.worldPoint('head', [0, 0, 0.1]);
    return {
      fistL: v.worldPoint('elbowL', [0, -0.305, 0]),
      fistR: v.worldPoint('elbowR', [0, -0.305, 0]),
      footL: v.worldPoint('kneeL', [0, -0.43, 0.052]),
      footR: v.worldPoint('kneeR', [0, -0.43, 0.052]),
      headFront: [(n[0] - o[0]) * 10, (n[1] - o[1]) * 10, (n[2] - o[2]) * 10],
    };
  },
  controls: {
    probe: () => controls.probe(),
    setTouchVisible: (on) => controls.setTouchVisible(on),
  },
  fullscreen: {
    probe: () => screen.probe(),
    enter: () => screen.enter('manual'),
    exit: () => screen.exit(),
    toggle: () => screen.toggle(),
  },
  framing: {
    probe: () => gameCamera.framingProbe(),
    project: (x1, x2) => gameCamera.project(x1, x2),
  },
  setJoint: (joint, angles) => {
    const v = views[0];
    if (v instanceof RigView) v.setOverride(joint, angles);
  },
  clearJoints: () => {
    const v = views[0];
    if (v instanceof RigView) v.clearOverrides();
  },
  snapshot: (): KofSnapshot => ({
    ready: true,
    frame: match.frame,
    fps: loop.fps,
    renderFps: loop.renderFps,
    phase: match.phase,
    round: match.round,
    timer: match.timeLeft,
    hitstop: match.hitstop,
    maxHitstop,
    hitCount,
    sparks: fx.count,
    sparksTotal: fx.total,
    p1: snapFighter(match.p1),
    p2: snapFighter(match.p2),
    announce: document.getElementById('announce')?.textContent ?? '',
    winner: document.getElementById('winner')?.textContent ?? '',
    timerText: document.getElementById('timer')?.textContent ?? '',
    hp1Width: (document.getElementById('hp1') as HTMLElement | null)?.style.width ?? '',
    bootHidden: boot.classList.contains('gone'),
    characterMode,
    vrmBones,
    characterNames: [match.p1.char.name, match.p2.char.name],
    maxActive: [match.p1.isMax, match.p2.isMax],
    difficulty: ai.level,
    debug: debug.enabled,
    debugBoxes: debug.count,
    camera: gameCamera.inspect(),
    framing: gameCamera.framingProbe(),
    fx: fx.inspect(),
    visualTime: time,
    comboText: document.getElementById('combo1')?.textContent ?? '',
    koVignette: document.getElementById('ko-vignette')?.classList.contains('on') ?? false,
    texturedMeshes: views.reduce((n, v) => n + (v instanceof RigView ? v.texturedMeshes : 0), 0),
    rig: rigProbe(0),
    rigPair: [rigProbe(0), rigProbe(1)],
    viewScale: [views[0].root.scale.x, views[1].root.scale.x],
    anim: [animators[0].inspect(), animators[1].inspect()],
    canvas: { w: canvas.width, h: canvas.height },
    glLost: renderer.getContext().isContextLost(),
    fullscreen: screen.probe(),
  }),
};
