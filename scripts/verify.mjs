import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// 自检只依赖 npm 安装产物与本机浏览器：换机器无需改脚本。
// CHROME_PATH 可显式指定；否则按 macOS / Linux / Windows 常见路径探测。
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
  '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean).find((p) => fs.existsSync(p));
if (!CHROME) {
  throw new Error('找不到 Chrome/Chromium：请设置 CHROME_PATH 指向浏览器可执行文件');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'kof-3d.html');
const shots = path.join(root, 'shots');
fs.mkdirSync(shots, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};
const stages = (arr) => [...new Set(arr.map((t) => t.split(':')[0]))];

// 几何精修前的运行时基线（由 RigView.skeletonSignature()/geometryStats() 实测）。
// 骨架指纹逐字比对：任何一次改动碰到 JOINTS 层级、骨骼长度或末端局部坐标，
// 都会让 limbs() 坐标探针与全部动作断言失效，必须在这里立刻失败。
const RIG_BASELINE = {
  skeleton: 'pelvis>root:0.0000,0.9600,0.0000|torso>pelvis:0.0000,0.1200,0.0000|chest>torso:0.0000,0.4600,0.0000|head>chest:0.0000,0.2200,0.0000|hair>head:0.0000,0.1650,-0.1350|shoulderL>chest:-0.2150,0.0050,0.0000|elbowL>shoulderL:0.0000,-0.3200,0.0000|shoulderR>chest:0.2150,0.0050,0.0000|elbowR>shoulderR:0.0000,-0.3200,0.0000|hipL>pelvis:-0.1000,-0.0600,0.0000|kneeL>hipL:0.0000,-0.4300,0.0000|hipR>pelvis:0.1000,-0.0600,0.0000|kneeR>hipR:0.0000,-0.4300,0.0000|hairChain:-0.0200,-0.2000,-0.2000,-0.2000',
  meshes: 86, boxes: 31, triangles: 8528, materials: 9,
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--allow-file-access-from-files', '--disable-dev-shm-usage', '--window-size=1280,800',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
const pageErrors = [];
const consoleErrors = [];
const failedRequests = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('requestfailed', (r) => failedRequests.push(r.url()));

await page.goto(`file://${target}`, { waitUntil: 'load' });
await page.waitForFunction('window.__kof && window.__kof.ready === true', { timeout: 25000 });
await sleep(1200);

const snap = () => page.evaluate(() => window.__kof.snapshot());
const first = await snap();
const domText = await page.evaluate(() => document.body.innerText);

check('页面无 pageerror', pageErrors.length === 0, pageErrors.join(' | '));
check('页面无 console.error', consoleErrors.length === 0, consoleErrors.join(' | '));
check('无外部资源请求失败（离线零依赖）', failedRequests.length === 0, failedRequests.join(' | '));
check('WebGL 上下文正常', !first.glLost && first.canvas.w > 0 && first.canvas.h > 0, `${first.canvas.w}x${first.canvas.h}`);
check('默认渲染层为程序化角色', first.characterMode === 'procedural', `mode=${first.characterMode}`);
check('纯 3D 几何角色：零贴图材质网格', first.texturedMeshes === 0, `texturedMeshes=${first.texturedMeshes}`);
check('骨架指纹未变（层级 / 关节坐标 / 马尾链长度）',
  first.rig?.skeleton === RIG_BASELINE.skeleton,
  `signature=${first.rig ? first.rig.skeleton.length + ' 字符' : 'null'}`);
check('外形几何确实精修：三角面增加、方块件减少、网格规模可控',
  first.rig.triangles > RIG_BASELINE.triangles * 1.15 &&
  first.rig.boxes < RIG_BASELINE.boxes * 0.65 &&
  first.rig.meshes < RIG_BASELINE.meshes * 1.75,
  `tris ${RIG_BASELINE.triangles}→${first.rig.triangles}, boxes ${RIG_BASELINE.boxes}→${first.rig.boxes}, meshes ${RIG_BASELINE.meshes}→${first.rig.meshes}`);
const htmlSource = fs.readFileSync(target, 'utf8');
const noFaceData = await page.evaluate(() => window.__KOF_FACES__ === undefined);
const htmlBytes = fs.statSync(target).size;
check('产物不含 2D 贴图链路（无内联图片 / 无注入数据）',
  noFaceData && !htmlSource.includes('data:image/webp') && !htmlSource.includes('__KOF_FACES__'),
  `html=${(htmlBytes / 1024).toFixed(0)} KB, injected=${!noFaceData}`);
check('单文件仍控制在 1 MB 内（可离线双击打开）', htmlBytes < 1024 * 1024,
  `${(htmlBytes / 1024).toFixed(0)} KB`);
check('HUD 关键文案存在', ['RIN', 'FEI', 'ROUND 1', '99', '轻拳'].every((t) => domText.includes(t)));
check('逻辑帧已推进', first.frame > 30, `frame=${first.frame}, fps=${first.fps}`);
check('逻辑步/渲染帧双口径统计可用',
  first.fps > 0 && first.renderFps > 0,
  `logic=${first.fps}, render=${first.renderFps}`);
check('开局满血、回合 1、intro 阶段', first.p1.hp === 100 && first.p2.hp === 100 && first.round === 1 && first.phase === 'intro', `phase=${first.phase}`);
await page.screenshot({ path: path.join(shots, '01-boot.png') });

await page.click('#boot');
await sleep(300);
check('点击后启动遮罩消失', (await snap()).bootHidden);
await page.waitForFunction('window.__kof.snapshot().phase === "fight"', { timeout: 12000 });
const fightStart = await snap();
check('FIGHT 阶段可达', fightStart.phase === 'fight', `frame=${fightStart.frame}`);
// 静止对峙画面：冻结逻辑再拍，避免 waitForFunction 轮询期间 AI 已贴身命中、
// 把 hitspark 残影拍进「待机」参考图；02-fight 才是一轮连打后的真实对局帧。
await page.evaluate(() => window.__kof.setPose('idle', null, 0));
await sleep(140);
await page.screenshot({ path: path.join(shots, '05-idle.png') });
await page.evaluate(() => window.__kof.clearPose());

// 防御输入链路：把对手推远并清掉硬直，避免 AI 贴身干扰状态判定
const isolate = () => page.evaluate(() => {
  const m = window.__kof.match;
  m.phase = 'fight'; m.hitstop = 0; m.buffered.length = 0;
  const a = m.p1, b = m.p2;
  a.state = 'idle'; a.move = null; a.moveFrame = 0; a.stateFrame = 0;
  a.stunLeft = 0; a.landingStun = 0; a.airborne = false; a.y = 0; a.vy = 0; a.vx = 0;
  a.guarding = false; a.guardLevel = null; a.crouching = false;
  b.x = 3.0; b.state = 'idle'; b.move = null; b.vx = 0; b.stunLeft = 0;
});

await isolate();
await page.keyboard.down('KeyA'); // p1 面朝右，后方向 = A
await sleep(150);
const afterStandGuard = await snap();
await page.keyboard.up('KeyA');
check('按住后方向进入站防',
  afterStandGuard.p1.state === 'guard' && afterStandGuard.p1.guardLevel === 'stand',
  `guard=${afterStandGuard.p1.state}/${afterStandGuard.p1.guardLevel}`);

await isolate();
await page.keyboard.down('KeyA');
await page.keyboard.down('KeyS');
await sleep(150);
const afterGuard = await snap();
await page.keyboard.up('KeyS');
await page.keyboard.up('KeyA');
check('后 + 下进入蹲防',
  afterGuard.p1.state === 'guard' && afterGuard.p1.guardLevel === 'crouch',
  `guard=${afterGuard.p1.state}/${afterGuard.p1.guardLevel}`);

await isolate();
await page.keyboard.down('KeyS');
await sleep(150);
const afterCrouch = await snap();
await page.keyboard.up('KeyS');
check('单按下只蹲不自动防御',
  afterCrouch.p1.state === 'crouch' && afterCrouch.p1.guardLevel === null,
  `state=${afterCrouch.p1.state}, guard=${afterCrouch.p1.guardLevel}`);

// 防御高度 × 攻击属性矩阵：直接调结算函数，排除时序与 AI 干扰
const guardProbe = await page.evaluate(() => {
  const k = window.__kof;
  const m = k.match, p = m.p1, q = m.p2;
  const test = (level, moveId) => {
    p.state = 'guard'; p.guarding = true; p.guardLevel = level;
    p.airborne = false; p.hp = 100;
    p.stateFrame = 0; p.stunLeft = 0;
    const ev = p.receiveHit(k.moves[moveId], q, 0, 0);
    return { blocked: ev.blocked, guardBreak: ev.guardBreak, hp: p.hp };
  };
  const out = {
    standMid: test('stand', 'HP'),
    standLow: test('stand', 'SWEEP'),
    crouchLow: test('crouch', 'SWEEP'),
    crouchOverhead: test('crouch', 'JHK'),
    standOverhead: test('stand', 'JHK'),
    levels: {
      HP: k.moves.HP.level, SWEEP: k.moves.SWEEP.level,
      JLP: k.moves.JLP.level, JHK: k.moves.JHK.level,
    },
  };
  k.clearPose();
  p.hp = 100; q.hp = 100; p.meter = 0; q.meter = 0;
  return out;
});
check('站防挡中段重拳', guardProbe.standMid.blocked === true, JSON.stringify(guardProbe.standMid));
check('站防漏下段扫腿并标记 GUARD BREAK',
  guardProbe.standLow.blocked === false && guardProbe.standLow.guardBreak === true,
  JSON.stringify(guardProbe.standLow));
check('蹲防挡下段扫腿', guardProbe.crouchLow.blocked === true, JSON.stringify(guardProbe.crouchLow));
check('蹲防漏跳跃上段并标记 GUARD BREAK',
  guardProbe.crouchOverhead.blocked === false && guardProbe.crouchOverhead.guardBreak === true,
  JSON.stringify(guardProbe.crouchOverhead));
check('站防挡跳跃上段', guardProbe.standOverhead.blocked === true, JSON.stringify(guardProbe.standOverhead));
check('帧表标注中/下/上段属性',
  guardProbe.levels.HP === 'mid' && guardProbe.levels.SWEEP === 'low' &&
  guardProbe.levels.JLP === 'overhead' && guardProbe.levels.JHK === 'overhead',
  JSON.stringify(guardProbe.levels));

// 跳跃攻击：同一按键在地面 / 空中映射到不同招式，落地即时取消
const airProbe = await page.evaluate(() => {
  const k = window.__kof;
  const m = k.match, p = m.p1, q = m.p2;
  m.phase = 'fight'; m.hitstop = 0; m.buffered.length = 0; m.timerFrames = 5940;
  const input = (buttons) => ({ dir: 0, jump: false, down: false, guard: false, buttons });
  const reset = (air, y, vy) => {
    q.x = 3.0; q.state = 'idle'; q.move = null; q.vx = 0; q.stunLeft = 0; q.y = 0;
    p.x = -1.5; p.state = 'idle'; p.move = null; p.moveFrame = 0; p.stateFrame = 0;
    p.stunLeft = 0; p.landingStun = 0; p.guarding = false; p.guardLevel = null;
    p.crouching = false; p.airborne = air; p.y = y; p.vy = vy; p.vx = 0; p.hasHit = false;
  };
  reset(false, 0, 0);
  m.step(input(['LP']));
  const ground = p.move?.id ?? null;
  reset(true, 0.8, 0.02);
  m.step(input(['LP']));
  const airLight = p.move?.id ?? null;
  reset(true, 0.8, 0.02);
  m.step(input(['HK']));
  const airHeavy = p.move?.id ?? null;
  reset(true, 0.35, -0.02);
  m.step(input(['LP']));
  const beforeLand = p.move?.id ?? null;
  for (let i = 0; i < 12 && p.airborne; i++) m.step(input([]));
  const afterLand = {
    move: p.move?.id ?? null, hitbox: p.activeHitbox(),
    state: p.state, landingStun: p.landingStun, airborne: p.airborne,
  };
  m.step(input(['HP']));
  const duringStun = p.move?.id ?? null;
  k.clearPose();
  return { ground, airLight, airHeavy, beforeLand, afterLand, duringStun };
});
check('地面轻键仍走地面招式', airProbe.ground === 'LP', `ground=${airProbe.ground}`);
check('空中轻键映射为跳跃轻拳', airProbe.airLight === 'JLP', `air=${airProbe.airLight}`);
check('空中重键映射为跳跃重踢', airProbe.airHeavy === 'JHK', `air=${airProbe.airHeavy}`);
check('空中招式落地即刻取消、不残留判定',
  airProbe.beforeLand === 'JLP' && airProbe.afterLand.move === null &&
  airProbe.afterLand.hitbox === null && !airProbe.afterLand.airborne,
  JSON.stringify(airProbe.afterLand));
check('落地硬直期间无法起招',
  airProbe.afterLand.landingStun > 0 && airProbe.duringStun === null,
  `stun=${airProbe.afterLand.landingStun}, move=${airProbe.duringStun}`);

const airTags = await page.evaluate(() => ({
  JLP: window.__kof.sampleAttackTags('JLP'),
  JHK: window.__kof.sampleAttackTags('JHK'),
}));
check('跳跃攻击同样遵循四段关键帧',
  [airTags.JLP, airTags.JHK].every((arr) =>
    ['windup', 'strike', 'follow', 'recovery'].every((key) => stages(arr).includes(key))),
  `JLP=${stages(airTags.JLP).length}段, JHK=${stages(airTags.JHK).length}段`);

await page.keyboard.press('KeyW');
await sleep(90);
const afterJump = await snap();
check('跳跃状态可达', afterJump.p1.state === 'jump' || afterJump.p1.y > 0,
  `jump=${afterJump.p1.state}, y=${afterJump.p1.y.toFixed(2)}`);

// 确定性验证：先清掉滞空/硬直残留，再走真实键盘输入链路；最多重试 4 次避免被 AI 打断
let afterPunch = null;
for (let i = 0; i < 4; i++) {
  await page.evaluate(() => {
    const p = window.__kof.match.p1;
    p.state = 'idle'; p.move = null; p.moveFrame = 0; p.stateFrame = 0;
    p.stunLeft = 0; p.airborne = false; p.y = 0; p.vy = 0;
    p.guarding = false; p.crouching = false;
  });
  await page.keyboard.press('KeyJ');
  await sleep(45);
  afterPunch = await snap();
  if (afterPunch.p1.state === 'attack' && afterPunch.p1.move === 'LP') break;
}
check('轻拳按帧表触发', afterPunch.p1.state === 'attack' && afterPunch.p1.move === 'LP',
  `punch=${afterPunch.p1.state}/${afterPunch.p1.move}`);

// 真实对局：连续出招直到发生命中
for (let i = 0; i < 60; i++) {
  const code = i % 5 === 0 ? 'KeyK' : i % 4 === 0 ? 'KeyI' : i % 3 === 0 ? 'KeyL' : 'KeyJ';
  await page.keyboard.press(code);
  if (i === 8 || i === 20) {
    await page.keyboard.down('KeyD');
    await sleep(360);
    await page.keyboard.up('KeyD');
  }
  await sleep(95);
}
const afterFight = await snap();
await page.screenshot({ path: path.join(shots, '02-fight.png') });

check('发生至少一次命中结算', afterFight.hitCount > 0, `hitCount=${afterFight.hitCount}`);
check('命中造成血量变化', afterFight.p1.hp < 100 || afterFight.p2.hp < 100, `p1=${afterFight.p1.hp}, p2=${afterFight.p2.hp}`);
check('Hitstop 顿帧生效', afterFight.maxHitstop > 0, `maxHitstop=${afterFight.maxHitstop}`);
check('能量槽随攻击增长', afterFight.p1.meter > 0 || afterFight.p2.meter > 0, `p1=${afterFight.p1.meter}, p2=${afterFight.p2.meter}`);
check('HUD 血条与逻辑血量联动', afterFight.hp1Width !== '' && afterFight.timerText !== '', `hp1Width=${afterFight.hp1Width}, timer=${afterFight.timerText}`);
check('命中时确实生成 Hitspark', afterFight.sparksTotal > 0, `sparksTotal=${afterFight.sparksTotal}`);
check('特效对象可回收（无暴增）', afterFight.sparks < 40, `sparks=${afterFight.sparks}`);

// ── 打击演出：调试钩子确定性摆出命中帧，不依赖随机对局时序 ──────────────
const impactProbe = await page.evaluate(() => new Promise((resolve) => {
  window.__kof.showImpact(true);
  requestAnimationFrame(() => {
    const s = window.__kof.snapshot();
    resolve({ zoom: s.camera.zoom, fov: s.camera.fov, fx: s.fx, comboText: s.comboText });
  });
}));
const impactShot = path.join(shots, '07-impact.png');
await page.screenshot({ path: impactShot });
check('命中推镜：FOV 收窄且带推镜强度',
  impactProbe.zoom > 0.3 && impactProbe.fov < 34,
  `zoom=${impactProbe.zoom.toFixed(2)}, fov=${impactProbe.fov.toFixed(2)}`);
check('命中演出五类效果全部生成（火花/速度线/柔光/弧光/残影）',
  ['sparks', 'lines', 'glows', 'arcs', 'ghosts'].every((k) => impactProbe.fx.counts[k] > 0),
  JSON.stringify(impactProbe.fx.counts));
check('残影数量受控、特效对象可回收',
  impactProbe.fx.counts.ghosts <= 4 && impactProbe.fx.active < 40,
  `ghosts=${impactProbe.fx.counts.ghosts}, active=${impactProbe.fx.active}`);
check('连段数字由命中事件弹出',
  impactProbe.comboText.includes('3') && impactProbe.comboText.includes('HITS'),
  impactProbe.comboText);
check('命中演出截图已生成', fs.existsSync(impactShot) && fs.statSync(impactShot).size > 10000,
  `${(fs.existsSync(impactShot) ? fs.statSync(impactShot).size / 1024 : 0).toFixed(0)} KB`);
await sleep(420);
const recoil = await snap();
check('命中推镜逐帧回弹', recoil.camera.zoom < impactProbe.zoom * 0.6,
  `${impactProbe.zoom.toFixed(2)} → ${recoil.camera.zoom.toFixed(3)}`);
await page.evaluate(() => window.__kof.clearPose());

// 落地烟尘：以累计计数做增量判定，避开 headless 帧率波动
const dustBefore = (await snap()).fx.totals.dust;
await page.keyboard.press('KeyW');
await page.waitForFunction(
  (n) => window.__kof.snapshot().fx.totals.dust > n,
  { timeout: 6000 }, dustBefore,
).catch(() => {});
const dustAfter = (await snap()).fx.totals.dust;
check('跳跃落地生成贴地烟尘', dustAfter > dustBefore, `dust ${dustBefore} → ${dustAfter}`);

// Hitstop 只冻结逻辑还不够：视觉时间也要定格，否则呼吸与姿态平滑会削弱顿帧
const freeze = await page.evaluate(async () => {
  const k = window.__kof;
  const m = k.match;
  m.phase = 'fight';
  m.hitstop = 30;
  const t0 = k.snapshot().visualTime;
  await new Promise((r) => setTimeout(r, 150));
  const t1 = k.snapshot().visualTime;
  m.hitstop = 0;
  await new Promise((r) => setTimeout(r, 150));
  const t2 = k.snapshot().visualTime;
  return { t0, t1, t2 };
});
check('Hitstop 期间视觉时间定格、解冻后恢复',
  freeze.t1 === freeze.t0 && freeze.t2 > freeze.t1,
  `${freeze.t0} → ${freeze.t1} → ${freeze.t2}`);

// KO / 回合结束 / 重开：同步推进做确定性验证，不依赖 headless 的时序
const koResult = await page.evaluate(() => {
  const m = window.__kof.match;
  const EMPTY = { dir: 0, jump: false, down: false, guard: false, buttons: [] };
  m.hitstop = 0;
  m.buffered.length = 0;
  m.p2.hp = 1;
  let steps = 0;
  while (m.phase === 'fight' && steps < 120) {
    // 每帧强制归位，排除上一轮连打残留的硬直/滞空/防御与 AI 干扰；
    // 只在 p1 不在出招态时重新起招，避免重置 moveFrame 让招式永远进不了 active 窗口。
    m.hitstop = 0;
    for (const f of [m.p1, m.p2]) {
      f.x = f === m.p1 ? -0.35 : 0.35;
      f.y = 0; f.vx = 0; f.vy = 0;
      f.airborne = false; f.guarding = false; f.crouching = false;
    }
    if (m.p2.state === 'attack') {
      m.p2.state = 'idle'; m.p2.move = null; m.p2.moveFrame = 0;
    }
    if (m.p1.state !== 'attack') m.p1.startMove('HP');
    m.step(EMPTY);
    steps++;
  }
  return { phase: m.phase, p2hp: m.p2.hp, wins: m.p1.wins, steps };
});
check('KO 结束回合并记胜场',
  koResult.p2hp === 0 && koResult.wins >= 1 && ['roundOver', 'matchOver'].includes(koResult.phase),
  `phase=${koResult.phase}, wins=${koResult.wins}, steps=${koResult.steps}`);

// KO 特写由 onMatchEnd 同步触发，镜头插值要等渲染帧推进后才能读到
await sleep(380);
const koShot = await snap();
const koDom = await page.evaluate(() => ({
  flash: document.getElementById('screen-flash')?.className ?? '',
}));
check('KO 特写：慢推 + 胜者聚焦 + 暗角',
  koShot.camera.koActive && koShot.camera.koZoom > 0.25 &&
  koShot.camera.fov < 33.5 && koShot.koVignette,
  `koZoom=${koShot.camera.koZoom.toFixed(2)}, fov=${koShot.camera.fov.toFixed(2)}, vignette=${koShot.koVignette}`);
check('KO 终结强闪层与回合公告',
  koDom.flash.includes('ko') && koShot.announce.includes('K.O.'),
  `flash=${koDom.flash}, announce=${koShot.announce}`);

const restarted = await page.evaluate(() => {
  const m = window.__kof.match;
  m.restart();
  return { round: m.round, wins: m.p1.wins, hp1: m.p1.hp, hp2: m.p2.hp, phase: m.phase };
});
check('重开回到第 1 局、满血且胜场清零',
  restarted.round === 1 && restarted.wins === 0 && restarted.hp1 === 100 &&
  restarted.hp2 === 100 && restarted.phase === 'intro', JSON.stringify(restarted));

const resetShot = await snap();
check('重开后 KO 特写与暗角复位',
  !resetShot.camera.koActive && resetShot.camera.koZoom === 0 && !resetShot.koVignette,
  `koActive=${resetShot.camera.koActive}, koZoom=${resetShot.camera.koZoom}, vignette=${resetShot.koVignette}`);

// 窄视口溢出
await page.setViewport({ width: 390, height: 780, deviceScaleFactor: 1 });
await sleep(500);
const narrow = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
}));
check('390px 窄视口无横向溢出', narrow.scrollWidth <= narrow.clientWidth + 2, `${narrow.scrollWidth}/${narrow.clientWidth}`);
await page.screenshot({ path: path.join(shots, '03-mobile.png') });
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

// ── 可替换 VRM 资产槽：若构建产出了插槽演示版，独立开页验证 ──────────────
const vrmTarget = path.join(root, 'kof-3d-vrm.html');
let vrmSnapshot = null;
if (fs.existsSync(vrmTarget)) {
  const vp = await browser.newPage();
  await vp.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  const vErrors = [];
  const vConsole = [];
  const vFailed = [];
  vp.on('pageerror', (e) => vErrors.push(String(e)));
  vp.on('console', (m) => { if (m.type() === 'error') vConsole.push(m.text()); });
  vp.on('requestfailed', (r) => vFailed.push(r.url()));
  await vp.goto(`file://${vrmTarget}`, { waitUntil: 'load' });
  await vp.waitForFunction('window.__kof && window.__kof.ready === true', { timeout: 25000 });
  await vp.waitForFunction('window.__kof.snapshot().characterMode === "vrm"', { timeout: 30000 });
  vrmSnapshot = await vp.evaluate(() => window.__kof.snapshot());

  check('VRM 插槽：模型加载并热替换渲染层', vrmSnapshot.characterMode === 'vrm', `mode=${vrmSnapshot.characterMode}`);
  check('VRM 插槽：人形骨骼映射完整', vrmSnapshot.vrmBones >= 10, `bones=${vrmSnapshot.vrmBones}`);
  check('VRM 插槽：WebGL 正常', !vrmSnapshot.glLost && vrmSnapshot.canvas.w > 0, `${vrmSnapshot.canvas.w}x${vrmSnapshot.canvas.h}`);
  check('VRM 插槽：零 pageerror / console.error', vErrors.length === 0 && vConsole.length === 0,
    [...vErrors, ...vConsole].join(' | '));
  check('VRM 插槽：无外部资源请求（离线）', vFailed.length === 0, vFailed.join(' | '));

  await vp.click('#boot');
  await sleep(900);
  await vp.screenshot({ path: path.join(shots, '04-vrm.png') });
  await vp.close();
}

// ── 动作系统实证：四段招式、姿态连续性、跳跃分相、落地缓冲 ────────────────
const attackTags = await page.evaluate(() => ({
  HP: window.__kof.sampleAttackTags('HP'),
  LP: window.__kof.sampleAttackTags('LP'),
  HK: window.__kof.sampleAttackTags('HK'),
}));
check('招式四段关键帧齐全（蓄力/发力/跟随/收回）',
  ['windup', 'strike', 'follow', 'recovery'].every((k) => stages(attackTags.HP).includes(k)),
  `HP=${stages(attackTags.HP).join('→')}`);
check('轻拳与重踢同样遵循四段',
  [attackTags.LP, attackTags.HK].every((arr) =>
    ['windup', 'strike', 'follow', 'recovery'].every((k) => stages(arr).includes(k))),
  `LP=${stages(attackTags.LP).length}段, HK=${stages(attackTags.HK).length}段`);
check('发力姿态在 active 首帧即到位（动作不落后于判定）',
  attackTags.HP.slice(7, 10).every((t) => t.startsWith('strike')),
  `HP frame7-9=${attackTags.HP.slice(7, 10).join(',')}`);

// 骨骼末端坐标实测：主攻肢体必须朝对手（+X）伸展，而不是甩向背后
const reach = await page.evaluate(async () => {
  const wait = () => new Promise((r) => requestAnimationFrame(r));
  const read = () => window.__kof.limbs(0);
  // 姿态平滑是时间常数制的，固定等 2 帧不够：上一姿态（出拳/落地）没收敛时
  // idle 基准会偏高，导致前伸增量偶发假失败。轮询到收敛再采样。
  const settle = async () => {
    for (let i = 0; i < 24; i++) {
      await wait();
      const a = window.__kof.snapshot().anim[0];
      if (a.tag === 'idle' && a.maxDelta < 0.012) break;
    }
  };
  window.__kof.setPose('idle', null, 0); await settle();
  const idle = read();
  window.__kof.setPose('attack', 'HP', 7); await wait(); await wait();
  const hp = read();
  window.__kof.setPose('attack', 'HK', 9); await wait(); await wait();
  const hk = read();
  const x = window.__kof.match.p1.x;
  window.__kof.clearPose();
  return { idle, hp, hk, x };
});
const rel = (a) => a[0] - reach.x;
const fistGain = rel(reach.hp.fistR) - rel(reach.idle.fistR);
const footGain = rel(reach.hk.footR) - rel(reach.idle.footR);
check('重拳确实朝对手方向伸出（骨骼末端实测）', fistGain > 0.20,
  `拳套前伸=${fistGain.toFixed(2)} 世界单位`);
check('重踢确实朝对手方向踢出（骨骼末端实测）', footGain > 0.40,
  `脚前伸=${footGain.toFixed(2)} 世界单位`);

// 跳攻同样要验证伸展方向：上次踩过「肢体绕 X 轴朝镜头摆，屏幕投影几乎不变」的坑
const airReach = await page.evaluate(async () => {
  const wait = () => new Promise((r) => requestAnimationFrame(r));
  const k = window.__kof;
  k.setPose('idle', null, 0);
  for (let i = 0; i < 24; i++) {
    await wait();
    const a = k.snapshot().anim[0];
    if (a.tag === 'idle' && a.maxDelta < 0.012) break;
  }
  const idle = k.limbs(0);
  k.setPose('attack', 'JHK', 5, { airborne: true, y: 0.26 }); await wait(); await wait();
  const jhk = k.limbs(0);
  k.clearPose();
  return { idle, jhk };
});
const airFootGain = airReach.jhk.footR[0] - airReach.idle.footR[0];
check('跳跃重踢朝对手方向踢出（骨骼末端实测）', airFootGain > 0.40,
  `脚前伸=${airFootGain.toFixed(2)} 世界单位`);

await page.evaluate(() => window.__kof.setPose('idle', null, 0));
await sleep(420);
const idleDeltas = [];
for (let i = 0; i < 5; i++) {
  await sleep(80);
  idleDeltas.push((await snap()).anim[0].maxDelta);
}
check('待机姿态连续无跳变', Math.max(...idleDeltas) < 0.06,
  `maxDelta=${Math.max(...idleDeltas).toFixed(4)}`);

await page.evaluate(() => window.__kof.setPose('guard', null, 0));
await sleep(90);
const guardEarly = (await snap()).anim[0];
check('状态切换走姿态平滑而非瞬间跳变',
  guardEarly.blend < 1 && guardEarly.maxDelta < 0.5,
  `blend=${guardEarly.blend.toFixed(2)}, maxDelta=${guardEarly.maxDelta.toFixed(3)}`);

// 站防/蹲防不能只换标签不换姿态：比较真实渲染出的关节角
await page.evaluate(() => window.__kof.setPose('guard', null, 0, { guardLevel: 'stand' }));
await sleep(420);
const standJoints = (await snap()).anim[0].joints;
await page.evaluate(() => window.__kof.setPose('guard', null, 0, { guardLevel: 'crouch' }));
await sleep(420);
const crouchJoints = (await snap()).anim[0].joints;
const guardGap = Math.max(...standJoints.map((v, i) => Math.abs(v - crouchJoints[i])));
check('站防与蹲防姿态剪影明显不同', guardGap > 0.25,
  `maxJointGap=${guardGap.toFixed(3)}`);
await page.evaluate(() => window.__kof.clearPose());

await page.evaluate(() => { window.__kof.setPose('jump', null, 0); window.__kof.match.p1.vy = 0.20; });
await sleep(160);
const riseTag = (await snap()).anim[0].tag;
await page.evaluate(() => { window.__kof.match.p1.vy = -0.20; });
await sleep(160);
const fallTag = (await snap()).anim[0].tag;
check('跳跃按垂直速度分起跳 / 下落姿态',
  riseTag.startsWith('jump-rise') && fallTag.startsWith('jump-fall'),
  `${riseTag} → ${fallTag}`);

// 不依赖固定 sleep：headless 帧率在 29~60fps 间波动，landTimer 按 dt 衰减，
// 固定 90ms 后可能已经归零。改为「下一个渲染帧立刻读」+「稍后再读」验证触发与递减。
await page.evaluate(() => window.__kof.setPose('idle', null, 0));
const landingStart = await page.evaluate(() => new Promise((r) => {
  requestAnimationFrame(() => r(window.__kof.snapshot().anim[0].landing));
}));
await sleep(160);
const landingLater = (await snap()).anim[0].landing;
check('落地缓冲触发并逐帧衰减',
  landingStart > 0 && landingLater < landingStart,
  `${landingStart.toFixed(2)} → ${landingLater.toFixed(2)}`);

const frameTags = [];
for (const fr of [0, 4, 6, 9]) {
  await page.evaluate((f) => window.__kof.setPose('attack', 'LP', f), fr);
  await sleep(90);
  frameTags.push((await snap()).anim[0].tag);
}
check('动作标签随帧表推进（真实渲染帧链路）',
  ['windup', 'strike', 'follow', 'recovery'].every((k, i) => frameTags[i].startsWith(k)),
  frameTags.join(' → '));
await page.evaluate(() => window.__kof.clearPose());

// ── AI 难度与调试线框 ─────────────────────────────────────────────────────
const difficultyProbe = [];
for (const [code, label] of [['Digit1', 'EASY'], ['Digit2', 'NORMAL'], ['Digit3', 'HARD']]) {
  await page.keyboard.press(code);
  await sleep(70);
  difficultyProbe.push(await page.evaluate(() => ({
    level: window.__kof.snapshot().difficulty,
    label: document.getElementById('cpu-label')?.textContent ?? '',
  })));
  difficultyProbe[difficultyProbe.length - 1].expect = label;
}
check('1 / 2 / 3 切换三档难度并刷新 HUD',
  difficultyProbe.every((d) => d.label.includes(d.expect)),
  difficultyProbe.map((d) => `${d.level}:${d.label}`).join(' | '));
check('三档难度互不相同',
  new Set(difficultyProbe.map((d) => d.level)).size === 3,
  difficultyProbe.map((d) => d.level).join('→'));
await page.keyboard.press('Digit2');

const debugProbe = await page.evaluate(() => {
  const k = window.__kof;
  k.setDebug(true);
  const on = k.snapshot();
  k.setDebug(false);
  const off = k.snapshot();
  return { on: on.debug, boxes: on.debugBoxes, off: off.debug };
});
check('判定框调试线框开关可用',
  debugProbe.on === true && debugProbe.off === false && debugProbe.boxes === 6,
  JSON.stringify(debugProbe));

// ── 动作关键帧拼图：独立页面冻结逻辑逐格摆拍，供人工核对动作质量 ──────────
const poseDefs = [
  { slug: '1-idle', state: 'idle', frame: 0 },
  { slug: '2-lp-windup', state: 'attack', move: 'LP', frame: 2 },
  { slug: '3-hp-strike', state: 'attack', move: 'HP', frame: 7 },
  { slug: '4-hk-strike', state: 'attack', move: 'HK', frame: 9 },
  { slug: '5-guard-stand', state: 'guard', frame: 0, opts: { guardLevel: 'stand' } },
  { slug: '6-guard-crouch', state: 'guard', frame: 0, opts: { guardLevel: 'crouch' } },
  { slug: '7-jump-kick', state: 'attack', move: 'JHK', frame: 5, opts: { airborne: true, y: 0.26 } },
  { slug: '8-hitstun', state: 'hitstun', frame: 1 },
  { slug: '9-sweep', state: 'attack', move: 'SWEEP', frame: 8 },
];
const sheet = await browser.newPage();
await sheet.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
await sheet.goto(`file://${target}`, { waitUntil: 'load' });
await sheet.waitForFunction('window.__kof && window.__kof.ready === true', { timeout: 25000 });
await sheet.click('#boot');
await sleep(320);
// 摆拍用：隐藏 HUD 公告大字，避免 FIGHT / K.O. 压在角色身上
await sheet.evaluate(() => {
  for (const id of ['announce', 'winner']) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
});
const tiles = [];
for (const def of poseDefs) {
  await sheet.evaluate((d) => window.__kof.setPose(d.state, d.move ?? null, d.frame ?? 0, d.opts ?? {}), def);
  await sleep(340);
  const tile = path.join(shots, `pose-${def.slug}.png`);
  await sheet.screenshot({ path: tile, clip: { x: 150, y: 140, width: 980, height: 580 } });
  tiles.push(tile);
}
// 角色近景：独立页面用 deviceScaleFactor=2 直接输出 560x940，
// 等价于过去的「裁 280x470 → 放大 200%」，但不再依赖外部 ImageMagick。
const detailPath = path.join(shots, '08-detail.png');
const detailPage = await browser.newPage();
await detailPage.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
await detailPage.goto(`file://${target}`, { waitUntil: 'load' });
await detailPage.waitForFunction('window.__kof && window.__kof.ready === true', { timeout: 25000 });
await detailPage.click('#boot');
await sleep(320);
await detailPage.evaluate(() => window.__kof.setPose('idle', null, 0));
await sleep(340);
await detailPage.screenshot({ path: detailPath, clip: { x: 280, y: 150, width: 280, height: 470 } });
await detailPage.close();
check('角色近景图已生成（用于人工核对几何细节）',
  fs.existsSync(detailPath) && fs.statSync(detailPath).size > 10000,
  `${(fs.statSync(detailPath).size / 1024).toFixed(0)} KB`);
await sheet.close();

// 九格拼图同样改用浏览器 Canvas 合成（3x3 + 标签），零外部图像处理工具。
const sheetPath = path.join(shots, '06-poses.png');
try {
  const montagePage = await browser.newPage();
  await montagePage.goto('about:blank');
  const urls = tiles.map((t) => `data:image/png;base64,${fs.readFileSync(t).toString('base64')}`);
  const labels = poseDefs.map((d) => d.slug);
  const b64 = await montagePage.evaluate(async ({ urls, labels }) => {
    const W = 470, H = 278, PAD = 8, LABEL = 22, COLS = 3, ROWS = 3;
    const canvas = document.createElement('canvas');
    canvas.width = COLS * (W + PAD * 2);
    canvas.height = ROWS * (H + LABEL + PAD * 2);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '15px Helvetica, Arial, sans-serif';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < urls.length; i++) {
      const img = new Image();
      img.src = urls[i];
      await img.decode();
      const x = (i % COLS) * (W + PAD * 2) + PAD;
      const y = Math.floor(i / COLS) * (H + LABEL + PAD * 2) + PAD;
      ctx.drawImage(img, x, y, W, H);
      ctx.fillStyle = '#e8eefc';
      ctx.fillText(labels[i], x + 4, y + H + LABEL / 2);
    }
    return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
  }, { urls, labels });
  fs.writeFileSync(sheetPath, Buffer.from(b64, 'base64'));
  await montagePage.close();
  check('动作关键帧拼图已生成', fs.existsSync(sheetPath) && fs.statSync(sheetPath).size > 10000,
    `${tiles.length} 格 → ${(fs.statSync(sheetPath).size / 1024).toFixed(0)} KB`);
} catch (err) {
  check('动作关键帧拼图已生成', false, String(err.message).slice(0, 160));
}

check('全程无 pageerror / console.error / 失败请求',
  pageErrors.length === 0 && consoleErrors.length === 0 && failedRequests.length === 0,
  [...pageErrors, ...consoleErrors, ...failedRequests].join(' | '));

const report = {
  rigBaseline: RIG_BASELINE, rigProbe: first.rig, htmlBytes,
  first, fightStart, afterStandGuard, afterGuard, afterCrouch, guardProbe, airProbe,
  afterJump, afterPunch, afterFight, koResult, restarted, vrmSnapshot,
  attackTags, airTags, idleDeltas, frameTags, difficultyProbe, debugProbe,
  fistGain, footGain, airFootGain, guardGap,
  impactProbe, recoil, dustBefore, dustAfter, freeze, koShot, koDom, resetShot,
  pageErrors, consoleErrors, failedRequests, results,
};
fs.writeFileSync(path.join(shots, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('失败项：' + failed.map((r) => r.name).join('、'));
  process.exit(1);
}
