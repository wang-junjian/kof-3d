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
check('桌面横屏不启用竖屏收缩（场地仍为 3.35、机位保持原值）',
  !first.framing.portrait && Math.abs(first.framing.arenaHalf - 3.35) < 1e-6 &&
  Math.abs(first.framing.cameraZ - 6.4) < 1e-6 &&
  first.framing.ndc.every((n) => Number.isFinite(n) && Math.abs(n) <= 0.96),
  `aspect=${first.framing.aspect.toFixed(2)}, arenaHalf=${first.framing.arenaHalf}, cameraZ=${first.framing.cameraZ}`);
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
check('viewport 锁缩放 + Web App 全屏声明已内联进单文件',
  /user-scalable=no/.test(htmlSource) && /maximum-scale=1/.test(htmlSource) &&
  /viewport-fit=cover/.test(htmlSource) &&
  /apple-mobile-web-app-capable/.test(htmlSource) &&
  /mobile-web-app-capable/.test(htmlSource) &&
  htmlSource.includes('添加到主屏幕'),
  `meta=${(htmlSource.match(/<meta name="(?:viewport|apple-mobile-web-app-capable|mobile-web-app-capable)"/g) ?? []).length}`);
check('HUD 关键文案存在（含 236 超必杀提示）',
  ['RIN', 'FEI', 'ROUND 1', '99', '轻拳', '236'].every((t) => domText.includes(t)));
check('逻辑帧已推进', first.frame > 30, `frame=${first.frame}, fps=${first.fps}`);
check('逻辑步/渲染帧双口径统计可用',
  first.fps > 0 && first.renderFps > 0,
  `logic=${first.fps}, render=${first.renderFps}`);
check('开局满血、回合 1、intro 阶段', first.p1.hp === 100 && first.p2.hp === 100 && first.round === 1 && first.phase === 'intro', `phase=${first.phase}`);
await page.screenshot({ path: path.join(shots, '01-boot.png') });

await page.click('#boot');
await sleep(300);
check('点击后启动遮罩消失', (await snap()).bootHidden);

const shellDesktop = await page.evaluate(() => {
  const btn = document.getElementById('fs-toggle');
  const r = btn?.getBoundingClientRect();
  return {
    probe: window.__kof.fullscreen.probe(),
    snap: window.__kof.snapshot().fullscreen,
    btn: r ? { w: r.width, h: r.height, x: r.x, y: r.y, right: r.right, bottom: r.bottom } : null,
    appH: document.getElementById('app').getBoundingClientRect().height,
    clientH: document.documentElement.clientHeight,
    stageTouch: getComputedStyle(document.getElementById('stage')).touchAction,
    appTouch: getComputedStyle(document.getElementById('app')).touchAction,
    bodyTouch: getComputedStyle(document.body).touchAction,
    overscroll: getComputedStyle(document.body).overscrollBehaviorY,
  };
});
check('全屏切换按钮常驻且落在视口内；桌面不自动进入全屏',
  !!shellDesktop.btn && shellDesktop.btn.w >= 32 && shellDesktop.btn.h >= 32 &&
  shellDesktop.btn.x >= 0 && shellDesktop.btn.y >= 0 &&
  shellDesktop.btn.right <= 1280 && shellDesktop.btn.bottom <= 800 &&
  shellDesktop.probe.autoRequested === false && shellDesktop.probe.attempts === 0 &&
  shellDesktop.snap.supported === shellDesktop.probe.supported,
  `btn=${JSON.stringify(shellDesktop.btn)}, auto=${shellDesktop.probe.autoRequested}, attempts=${shellDesktop.probe.attempts}`);
check('全局 touch-action / overscroll 锁住缩放与页面拖动',
  shellDesktop.stageTouch === 'none' && shellDesktop.appTouch === 'none' &&
  shellDesktop.bodyTouch === 'none' && shellDesktop.overscroll === 'none',
  `stage=${shellDesktop.stageTouch}, app=${shellDesktop.appTouch}, body=${shellDesktop.bodyTouch}, overscroll=${shellDesktop.overscroll}`);
check('100dvh 让画布跟随动态视口高度',
  Math.abs(shellDesktop.appH - shellDesktop.clientH) < 2,
  `app=${shellDesktop.appH}, client=${shellDesktop.clientH}`);

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

// KO 特写由 onMatchEnd 同步触发，但 koZoom 按渲染帧插值；headless 帧率有波动，
// 固定 sleep 会偶发读到「慢推刚起步」的值。与落地烟尘同源：等条件而非等墙钟。
await page.waitForFunction(
  () => window.__kof.snapshot().camera.koZoom > 0.32,
  { timeout: 6000 },
).catch(() => {});
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

// ── M2：236 超必杀的浏览器端闭环（同步喂帧，不依赖 headless 键盘时序） ──────
const superProbe = await page.evaluate(() => {
  const k = window.__kof;
  const m = k.match;
  const cost = k.config.superCost;
  const EMPTY = { dir: 0, jump: false, down: false, guard: false, buttons: [] };
  const F = (o) => ({ ...EMPTY, ...o });
  const qcf = (dir) => [
    F({ down: true }), F({ down: true }),
    F({ down: true, dir }), F({ down: true, dir }),
    F({ dir, buttons: ['HP'] }),
  ];
  // 每帧强制归位，排除 AI 干扰；inputHistory 清掉此前真实按键留下的方向序列。
  const ready = (meter) => {
    m.phase = 'fight';
    m.hitstop = 0;
    m.buffered.length = 0;
    m.inputHistory.length = 0;
    m.p1.meter = meter;
    for (const f of [m.p1, m.p2]) {
      f.state = 'idle'; f.move = null; f.moveFrame = 0; f.stunLeft = 0;
      f.hasHit = false; f.y = 0; f.vy = 0; f.vx = 0;
      f.airborne = false; f.guarding = false; f.crouching = false; f.guardLevel = null;
    }
  };
  const feed = (frames, mirrored = false) => {
    for (const f of frames) {
      m.hitstop = 0;
      m.p1.x = mirrored ? 0.35 : -0.35;
      m.p2.x = mirrored ? -0.35 : 0.35;
      if (m.p2.state === 'attack') {
        m.p2.state = 'idle'; m.p2.move = null; m.p2.moveFrame = 0;
      }
      m.step(f);
    }
    return { move: m.p1.move?.id ?? null, meter: m.p1.meter, facing: m.p1.facing };
  };

  ready(100);
  const right = feed(qcf(1));

  ready(100);
  const mirrored = feed(qcf(-1), true); // 换到右半场，facing = -1，必须摇 ↓↙←

  ready(100);
  const backward = feed(qcf(-1));       // 仍在左半场却向后摇

  ready(cost - 1);
  const poor = feed(qcf(1));            // POW 差 1 点

  ready(100);
  m.step(F({ down: true }));
  m.step(F({ down: true, dir: 1 }));
  for (let i = 0; i < k.config.qcfWindow + 3; i++) {
    m.hitstop = 0;
    m.p1.state = 'idle'; m.p1.move = null; m.p1.stunLeft = 0;
    m.p2.state = 'idle'; m.p2.move = null;
    m.step(EMPTY);
  }
  m.step(F({ dir: 1, buttons: ['HP'] }));
  const expired = { move: m.p1.move?.id ?? null, meter: m.p1.meter };

  return {
    cost, window: k.config.qcfWindow, frame: k.moves.SUPER,
    tags: k.sampleAttackTags('SUPER'),
    right, mirrored, backward, poor, expired,
  };
});

check('236 超必杀：帧表就位且四段动作齐全',
  superProbe.frame.id === 'SUPER' && superProbe.frame.damage > 20 &&
  superProbe.frame.meterGain === 0 &&
  ['windup', 'strike', 'follow', 'recovery'].every((s) => stages(superProbe.tags).includes(s)),
  `dmg=${superProbe.frame.damage}, 分段=${stages(superProbe.tags).join('→')}`);
check('236 超必杀：朝向对手摇杆扣半槽并起 SUPER',
  superProbe.right.facing === 1 && superProbe.right.move === 'SUPER' &&
  superProbe.right.meter === 100 - superProbe.cost,
  JSON.stringify(superProbe.right));
check('236 超必杀：镜像站位需反向摇杆（绝对方向与 facing 比对）',
  superProbe.mirrored.facing === -1 && superProbe.mirrored.move === 'SUPER' &&
  superProbe.mirrored.meter === 100 - superProbe.cost,
  JSON.stringify(superProbe.mirrored));
check('236 超必杀：背向摇杆 / POW 不足 / 窗口过期都回退普通招且不扣槽',
  superProbe.backward.move === 'HP' && superProbe.backward.meter === 100 &&
  superProbe.poor.move === 'HP' && superProbe.poor.meter === superProbe.cost - 1 &&
  superProbe.expired.move === 'HP' && superProbe.expired.meter === 100,
  `背向=${superProbe.backward.move}/${superProbe.backward.meter}, ` +
  `不足=${superProbe.poor.move}/${superProbe.poor.meter}, ` +
  `过期=${superProbe.expired.move}/${superProbe.expired.meter}`);
check('236 输入窗口与消耗同源（脚本不硬编码第二份数值）',
  superProbe.cost === 50 && superProbe.window === 20,
  `cost=${superProbe.cost}, window=${superProbe.window}`);

const superImpact = await page.evaluate(() => new Promise((resolve) => {
  window.__kof.showSuper();
  requestAnimationFrame(() => {
    const s = window.__kof.snapshot();
    const alert = document.getElementById('alert');
    resolve({
      move: s.p1.move, tag: s.anim[0].tag, fx: s.fx, zoom: s.camera.zoom,
      alert: alert?.textContent ?? '', alertClass: alert?.className ?? '',
      flash: document.getElementById('screen-flash')?.className ?? '',
    });
  });
}));
const superShot = path.join(shots, '09-super.png');
await page.screenshot({ path: superShot });
check('超必杀发力帧姿态到位（strike:SUPER）',
  superImpact.move === 'SUPER' && superImpact.tag.startsWith('strike:'),
  `${superImpact.move} / ${superImpact.tag}`);
check('超必杀专属演出：五类特效 + 酸绿提示 + 中闪 + 命中推镜',
  ['sparks', 'lines', 'glows', 'arcs', 'ghosts'].every((k) => superImpact.fx.counts[k] > 0) &&
  superImpact.alert.includes('SUPER FINISH') && superImpact.alertClass.includes('super') &&
  superImpact.flash.includes('super') && superImpact.zoom > 0.3,
  `fx=${JSON.stringify(superImpact.fx.counts)}, zoom=${superImpact.zoom.toFixed(2)}, ` +
  `alert=${superImpact.alertClass}, flash=${superImpact.flash}`);
check('超必杀演出截图已生成', fs.existsSync(superShot) && fs.statSync(superShot).size > 10000,
  `${(fs.existsSync(superShot) ? fs.statSync(superShot).size / 1024 : 0).toFixed(0)} KB`);
await page.evaluate(() => window.__kof.clearPose());

// ── 触屏虚拟键 / Gamepad：真实 DOM 事件 + 轮询设备模拟 ────────────────────
// 每个用例前把对局推回干净状态：p2 推远、清硬直、满槽，避免 AI 干扰判定。
const armInputTest = () => page.evaluate(() => {
  const m = window.__kof.match;
  m.phase = 'fight'; m.hitstop = 0; m.buffered.length = 0;
  const a = m.p1, b = m.p2;
  a.state = 'idle'; a.move = null; a.moveFrame = 0; a.stateFrame = 0;
  a.stunLeft = 0; a.landingStun = 0; a.airborne = false; a.y = 0; a.vy = 0; a.vx = 0;
  a.guarding = false; a.guardLevel = null; a.crouching = false;
  a.x = -1.5; a.meter = 100;
  b.x = 3.2; b.state = 'idle'; b.move = null; b.vx = 0; b.stunLeft = 0;
});

const touchUi = await page.evaluate(() => {
  const k = window.__kof;
  k.controls.setTouchVisible(true);
  const root = document.getElementById('touch-controls');
  const rects = [...root.querySelectorAll('.tc-key')].map((e) => {
    const r = e.getBoundingClientRect();
    return {
      role: e.dataset.role || e.dataset.macro || '?',
      x: Math.round(r.x), y: Math.round(r.y),
      w: Math.round(r.width), h: Math.round(r.height),
    };
  });
  return {
    roles: [...root.querySelectorAll('[data-role]')].map((e) => e.dataset.role),
    macros: root.querySelectorAll('[data-macro="qcf"]').length,
    rects, probe: k.controls.probe(),
    bodyHasTouch: document.body.classList.contains('touch-ui'),
    bottomHidden: getComputedStyle(document.querySelector('.hud-bottom')).display === 'none',
    viewport: { w: innerWidth, h: innerHeight },
  };
});
check('触屏虚拟键就位：四方向 + 四攻击 + 236 快捷键，桌面底栏让位',
  ['up', 'down', 'left', 'right', 'LP', 'HP', 'LK', 'HK'].every((r) => touchUi.roles.includes(r)) &&
  touchUi.roles.length === 8 && touchUi.macros === 1 && touchUi.probe.buttons === 8 &&
  touchUi.probe.visible && touchUi.bodyHasTouch && touchUi.bottomHidden,
  `roles=${touchUi.roles.join(',')}, macro=${touchUi.macros}, visible=${touchUi.probe.visible}`);
const stickRight = Math.max(...touchUi.rects
  .filter((r) => ['up', 'down', 'left', 'right'].includes(r.role)).map((r) => r.x + r.w));
const actionLeft = Math.min(...touchUi.rects
  .filter((r) => ['LP', 'HP', 'LK', 'HK', 'qcf'].includes(r.role)).map((r) => r.x));
check('虚拟键全部在视口内、左右分区不重叠、不遮挡上半屏血条',
  touchUi.rects.length === 9 &&
  touchUi.rects.every((r) => r.w >= 40 && r.h >= 40 && r.x >= 0 && r.y >= 0 &&
    r.x + r.w <= touchUi.viewport.w && r.y + r.h <= touchUi.viewport.h) &&
  stickRight < actionLeft && Math.min(...touchUi.rects.map((r) => r.y)) > touchUi.viewport.h * 0.5,
  `keys=${touchUi.rects.length}, 分隔=${stickRight}<${actionLeft}, 最高 y=${Math.min(...touchUi.rects.map((r) => r.y))}`);

const keyPoint = await page.evaluate((role) => {
  const el = document.querySelector(`#touch-controls [data-role="${role}"]`);
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, 'right');
await page.mouse.move(keyPoint.x, keyPoint.y);
await page.mouse.down();
const touchHeld = await page.evaluate(() => window.__kof.controls.probe().held);
await page.mouse.up();
const touchReleased = await page.evaluate(() => window.__kof.controls.probe().held);
check('触屏方向键按下 / 抬起经真实 pointer 事件汇入 InputBuffer',
  touchHeld.includes('right') && !touchReleased.includes('right'),
  `down=[${touchHeld.join(',')}], up=[${touchReleased.join(',')}]`);

await armInputTest();
const atkPoint = await page.evaluate(() => {
  const r = document.querySelector('#touch-controls [data-role="LP"]').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
// 启动观察器后再按键：LP 只有十几帧，固定 sleep 会碰上逻辑帧 catch-up 把招式跑完，
// 读到的 move 已经是 null。与 KO 镜头同样用条件等待，避免时间耦合。
const atkFired = page.waitForFunction(
  'window.__kof.snapshot().p1.move === "LP"', { timeout: 4000 },
).then(() => true).catch(() => false);
await page.mouse.move(atkPoint.x, atkPoint.y);
await page.mouse.down();
const atkHeld = await page.evaluate(() => window.__kof.controls.probe().held);
await page.mouse.up();
const atkSeen = await atkFired;
check('触屏攻击键端到端出招（输入层 → 帧表 → 角色状态）',
  atkHeld.includes('LP') && atkSeen,
  `held=[${atkHeld.join(',')}], 起招=${atkSeen}`);

await armInputTest();
const macroPoint = await page.evaluate(() => {
  const r = document.querySelector('#touch-controls [data-macro="qcf"]').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.click(macroPoint.x, macroPoint.y);
const macroFired = await page.waitForFunction(
  'window.__kof.snapshot().p1.move === "SUPER"', { timeout: 4000 },
).then(() => true).catch(() => false);
const macroSnap = await snap();
check('触屏一键 236 走同一判定链路：扣 50 POW 并起 SUPER',
  macroFired && macroSnap.p1.move === 'SUPER' && macroSnap.p1.meter === 50,
  `move=${macroSnap.p1.move}, meter=${macroSnap.p1.meter}`);
const touchShot = path.join(shots, '10-touch-ui.png');
await page.screenshot({ path: touchShot });
check('触屏 UI 截图已生成', fs.existsSync(touchShot) && fs.statSync(touchShot).size > 10000,
  `${(fs.statSync(touchShot).size / 1024).toFixed(0)} KB`);

// 手柄是轮询设备，没有 DOM 事件：直接替换 navigator.getGamepads 让 sync() 读到假手柄。
const padProbe = await page.evaluate(async () => {
  const k = window.__kof;
  const wait = () => new Promise((r) => requestAnimationFrame(r));
  const fake = {
    connected: true, axes: [0.9, 0.9],
    buttons: Array.from({ length: 16 }, () => ({ pressed: false })),
  };
  fake.buttons[0] = { pressed: true }; // A → LP
  navigator.getGamepads = () => [fake];
  for (let i = 0; i < 4; i++) await wait();
  const connected = {
    probe: k.controls.probe(),
    hint: document.getElementById('device-hint').textContent,
  };
  fake.axes = [0, 0];
  fake.buttons[0] = { pressed: false };
  navigator.getGamepads = () => [];
  for (let i = 0; i < 4; i++) await wait();
  const disconnected = {
    probe: k.controls.probe(),
    hint: document.getElementById('device-hint').textContent,
  };
  return { connected, disconnected };
});
check('Gamepad 左摇杆 + 十字键按「或」汇入，连接提示可读',
  padProbe.connected.probe.padConnected &&
  ['right', 'down', 'LP'].every((r) => padProbe.connected.probe.padRoles.includes(r)) &&
  ['right', 'down', 'LP'].every((r) => padProbe.connected.probe.held.includes(r)) &&
  padProbe.connected.hint.includes('手柄已连接'),
  `padRoles=[${padProbe.connected.probe.padRoles.join(',')}], held=[${padProbe.connected.probe.held.join(',')}]`);
check('手柄断开立即收回角色并清空提示（不残留方向）',
  !padProbe.disconnected.probe.padConnected &&
  padProbe.disconnected.probe.padRoles.length === 0 &&
  ['right', 'down', 'LP'].every((r) => !padProbe.disconnected.probe.held.includes(r)) &&
  padProbe.disconnected.hint === '',
  `padRoles=[${padProbe.disconnected.probe.padRoles.join(',')}], held=[${padProbe.disconnected.probe.held.join(',')}]`);

await armInputTest();
const padMacro = await page.evaluate(async () => {
  const k = window.__kof;
  const wait = () => new Promise((r) => requestAnimationFrame(r));
  const fake = {
    connected: true, axes: [0, 0],
    buttons: Array.from({ length: 16 }, () => ({ pressed: false })),
  };
  navigator.getGamepads = () => [fake];
  await wait();
  fake.buttons[5] = { pressed: true }; // RB → 一键 236
  for (let i = 0; i < 6; i++) await wait(); // 按住不放，验证边缘检测不重复排队
  const first = { move: k.snapshot().p1.move, meter: k.match.p1.meter };
  navigator.getGamepads = () => [];
  for (let i = 0; i < 3; i++) await wait();
  return { first, final: { move: k.snapshot().p1.move, meter: k.match.p1.meter } };
});
check('手柄 RB 一键 236：边缘触发，按住不重复扣槽',
  padMacro.first.move === 'SUPER' && padMacro.first.meter === 50 &&
  padMacro.final.meter === 50,
  `after=${JSON.stringify(padMacro.first)}, final=${JSON.stringify(padMacro.final)}`);
await page.evaluate(() => window.__kof.controls.setTouchVisible(null));

// 另开一个真实触屏横屏视口：验证设备自动判定，而不是靠自检强制开关。
const mobilePage = await browser.newPage();
await mobilePage.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
mobilePage.on('pageerror', (e) => pageErrors.push(`[mobile] ${e}`));
mobilePage.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[mobile] ${m.text()}`); });
mobilePage.on('requestfailed', (r) => failedRequests.push(`[mobile] ${r.url()}`));
// headless 没有真实窗口：把 Fullscreen API 打成记录桩，既能验证「首次交互
// 真的在用户手势里请求了全屏」，又不会让全屏扰动 emulation 视口与截图。
await mobilePage.evaluateOnNewDocument(() => {
  window.__fsCalls = 0;
  Element.prototype.requestFullscreen = function () {
    window.__fsCalls++;
    return Promise.resolve();
  };
});
await mobilePage.goto(`file://${target}`, { waitUntil: 'load' });
await mobilePage.waitForFunction('window.__kof && window.__kof.ready === true', { timeout: 25000 });
await sleep(700);
const mobileBoot = await mobilePage.evaluate(() => ({
  display: getComputedStyle(document.getElementById('touch-controls')).display,
  probe: window.__kof.controls.probe(),
  hint: document.querySelector('.boot-keys')?.innerText ?? '',
  kbHidden: [...document.querySelectorAll('.boot-keys .kb-hint')]
    .every((e) => getComputedStyle(e).display === 'none'),
}));
check('触屏开机页只留设备说明、虚拟键在遮罩期间不露面',
  mobileBoot.display === 'none' && !mobileBoot.probe.visible && mobileBoot.kbHidden &&
  mobileBoot.hint.includes('触屏') && !mobileBoot.hint.includes('A D 移动'),
  `display=${mobileBoot.display}, kbHidden=${mobileBoot.kbHidden}, hint=${mobileBoot.hint.slice(0, 28)}`);
await mobilePage.click('#boot');
await sleep(600);
const mobileShell = await mobilePage.evaluate(() => ({
  probe: window.__kof.fullscreen.probe(),
  fsCalls: window.__fsCalls,
  bootGo: document.getElementById('boot-go')?.textContent ?? '',
}));
check('触屏首次交互在用户手势里恰好请求一次自动全屏',
  mobileShell.probe.touchLike && mobileShell.probe.supported &&
  mobileShell.probe.autoRequested && mobileShell.probe.attempts === 1 &&
  mobileShell.fsCalls === 1 && mobileShell.probe.lastError === null &&
  mobileShell.bootGo.includes('自动全屏'),
  `touchLike=${mobileShell.probe.touchLike}, attempts=${mobileShell.probe.attempts}, calls=${mobileShell.fsCalls}, err=${mobileShell.probe.lastError}`);
const mobileProbe = await mobilePage.evaluate(() => ({
  probe: window.__kof.controls.probe(),
  maxTouchPoints: navigator.maxTouchPoints,
  coarse: matchMedia('(pointer: coarse)').matches,
  display: getComputedStyle(document.getElementById('touch-controls')).display,
  bootHint: document.querySelector('.boot-keys')?.innerText.includes('触屏') ?? false,
  canvas: { w: document.getElementById('stage').clientWidth, h: document.getElementById('stage').clientHeight },
}));
const mobileShot = path.join(shots, '11-mobile-landscape.png');
await mobilePage.screenshot({ path: mobileShot });
check('真实触屏横屏视口自动启用虚拟键（设备判定，无需强制）',
  mobileProbe.probe.touchDetected && mobileProbe.probe.visible &&
  mobileProbe.display === 'flex' && mobileProbe.bootHint &&
  mobileProbe.canvas.w > 0 && mobileProbe.canvas.h > 0,
  `maxTouchPoints=${mobileProbe.maxTouchPoints}, coarse=${mobileProbe.coarse}, canvas=${mobileProbe.canvas.w}x${mobileProbe.canvas.h}`);
check('移动端横屏截图已生成', fs.existsSync(mobileShot) && fs.statSync(mobileShot).size > 10000,
  `${(fs.statSync(mobileShot).size / 1024).toFixed(0)} KB`);

// 复现用户报的场景：快速连点同一个攻击键。浏览器不能把它当成双击放大，
// 两次 pointerdown 也都必须送进输入缓冲（不能被手势拦截吞掉）。
const tapPoint = await mobilePage.evaluate(() => {
  const r = document.querySelector('#touch-controls [data-role="LP"]').getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
});
await mobilePage.evaluate(() => {
  window.__tapCount = 0;
  window.addEventListener('pointerdown', () => { window.__tapCount++; });
});
await mobilePage.touchscreen.tap(tapPoint.x, tapPoint.y);
await mobilePage.touchscreen.tap(tapPoint.x, tapPoint.y);
const dblTap = await mobilePage.evaluate(() => {
  const fire = (type) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    document.dispatchEvent(e);
    return e.defaultPrevented;
  };
  const touchEvent = (type, count) => {
    try {
      const t = new Touch({ identifier: 1, target: document.getElementById('stage') });
      const e = new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: Array(count).fill(t), targetTouches: [t], changedTouches: [t],
      });
      document.dispatchEvent(e);
      return e.defaultPrevented;
    } catch {
      return 'unsupported'; // 浏览器不提供 Touch 构造器时退化为声明式检查
    }
  };
  return {
    taps: window.__tapCount,
    scale: window.visualViewport?.scale ?? 1,
    innerW: window.innerWidth,
    clientW: document.documentElement.clientWidth,
    keyTouch: getComputedStyle(document.querySelector('#touch-controls [data-role="LP"]')).touchAction,
    dbl: fire('dblclick'),
    gesture: fire('gesturestart'),
    multi: touchEvent('touchstart', 2),
    move: touchEvent('touchmove', 1),
    context: fire('contextmenu'),
  };
});
check('快速连点攻击键：不双击放大、两次输入都送达、捏合/拖动/长按被拦截',
  dblTap.taps === 2 && dblTap.scale === 1 && Math.abs(dblTap.innerW - dblTap.clientW) < 2 &&
  dblTap.keyTouch === 'none' && dblTap.dbl === true && dblTap.gesture === true &&
  dblTap.context === true && dblTap.move === true &&
  (dblTap.multi === true || dblTap.multi === 'unsupported'),
  `taps=${dblTap.taps}, scale=${dblTap.scale}, dbl=${dblTap.dbl}, gesture=${dblTap.gesture}, multi=${dblTap.multi}, move=${dblTap.move}`);
await mobilePage.close();

// ── 竖屏实机视口：复现用户报的「两人跑出窗口」，用真实投影验证修复 ─────────
const portraitPage = await browser.newPage();
await portraitPage.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
portraitPage.on('pageerror', (e) => pageErrors.push(`[portrait] ${e}`));
portraitPage.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[portrait] ${m.text()}`); });
portraitPage.on('requestfailed', (r) => failedRequests.push(`[portrait] ${r.url()}`));
// headless 没有真实窗口：全屏与方向锁打桩，避免自动锁横屏把竖屏视口改掉。
await portraitPage.evaluateOnNewDocument(() => {
  window.__fsCalls = 0;
  Element.prototype.requestFullscreen = function () {
    window.__fsCalls++;
    return Promise.resolve();
  };
  try {
    Object.defineProperty(screen, 'orientation', {
      configurable: true,
      value: {
        type: 'portrait-primary', angle: 0,
        lock: () => Promise.reject(new Error('orientation stub')),
        unlock: () => {},
      },
    });
  } catch { /* 实例属性只读时跳过：headless 本来也不提供 lock */ }
});
await portraitPage.goto(`file://${target}`, { waitUntil: 'load' });
await portraitPage.waitForFunction('window.__kof && window.__kof.ready === true', { timeout: 25000 });
await sleep(500);
const portraitBoot = await portraitPage.evaluate(() => ({
  innerW: window.innerWidth, innerH: window.innerHeight,
  framing: window.__kof.framing.probe(),
  p1: window.__kof.match.p1.x, p2: window.__kof.match.p2.x,
  hint: document.getElementById('portrait-hint')?.textContent ?? '',
  hintVisible: getComputedStyle(document.getElementById('portrait-hint')).display !== 'none',
}));
check('竖屏 390×844 自动收窄场地并把机位拉到刚好入画',
  portraitBoot.innerW === 390 && portraitBoot.innerH === 844 &&
  portraitBoot.framing.portrait && portraitBoot.framing.arenaHalf < 3.35 &&
  portraitBoot.framing.arenaHalf > 0.6 && portraitBoot.framing.cameraZ > 6.4 &&
  portraitBoot.framing.visibleHalf > portraitBoot.framing.arenaHalf + 0.5,
  `aspect=${portraitBoot.framing.aspect.toFixed(3)}, arenaHalf=${portraitBoot.framing.arenaHalf.toFixed(2)}, ` +
  `cameraZ=${portraitBoot.framing.cameraZ.toFixed(2)}, visibleHalf=${portraitBoot.framing.visibleHalf.toFixed(2)}`);
check('竖屏开局站位按新边界收拢，并提示竖屏已适配',
  Math.abs(portraitBoot.p1) <= portraitBoot.framing.arenaHalf + 1e-6 &&
  Math.abs(portraitBoot.p2) <= portraitBoot.framing.arenaHalf + 1e-6 &&
  portraitBoot.hint.includes('自动收窄') && portraitBoot.hintVisible,
  `p1=${portraitBoot.p1.toFixed(2)}, p2=${portraitBoot.p2.toFixed(2)}, half=${portraitBoot.framing.arenaHalf.toFixed(2)}`);

await portraitPage.click('#boot');
await sleep(900);
// NDC 是每帧由真实相机矩阵投影出来的（不是公式估算）：|值| <= 0.92 表示连肩膀都留有余量。
const inView = (pair) => pair.every((n) => Number.isFinite(n) && Math.abs(n) <= 0.92);
const fmt = (pair) => pair.map((n) => n.toFixed(3)).join(', ');
// setPose 冻结逻辑但渲染 / 相机更新照常跑：把两人摆到极端站位后等镜头跟随稳定，
// 再读实时 NDC —— 验证的是「玩家真的会看到什么」，而不是拿旧机位投影新坐标。
const framingCase = (x1, x2) => portraitPage.evaluate(async ({ x1, x2 }) => {
  const k = window.__kof;
  k.setPose('idle');
  k.match.p1.x = x1;
  k.match.p2.x = x2;
  await new Promise((r) => setTimeout(r, 700));
  const f = k.framing.probe();
  k.clearPose();
  return { ndc: f.ndc, z: f.z, lookX: f.lookX, visibleHalf: f.visibleHalf };
}, { x1, x2 });
const portraitHalf = await portraitPage.evaluate(() => window.__kof.framing.probe().arenaHalf);
const portraitExtreme = await framingCase(-portraitHalf, portraitHalf);
const portraitLeft = await framingCase(-portraitHalf, -portraitHalf + 0.6);
const portraitRight = await framingCase(portraitHalf - 0.6, portraitHalf);
const portraitProjection = await portraitPage.evaluate(() => window.__kof.framing.project(-1, 1));
check('竖屏极限站位：两人各在一端时真实投影都在画面内',
  inView(portraitExtreme.ndc) &&
  portraitProjection.length === 2 && portraitProjection.every((n) => Number.isFinite(n)),
  `ndc=[${fmt(portraitExtreme.ndc)}], z=${portraitExtreme.z.toFixed(2)}, ` +
  `lookX=${portraitExtreme.lookX.toFixed(2)}, project=[${fmt(portraitProjection)}]`);
check('竖屏同侧挤压：两人一起贴左 / 贴右边线也不出画',
  inView(portraitLeft.ndc) && inView(portraitRight.ndc),
  `left=[${fmt(portraitLeft.ndc)}] @lookX=${portraitLeft.lookX.toFixed(2)}, ` +
  `right=[${fmt(portraitRight.ndc)}] @lookX=${portraitRight.lookX.toFixed(2)}`);

const portraitWalk = await portraitPage.evaluate(async () => {
  const k = window.__kof;
  const f = k.framing.probe();
  const input = { dir: -1, jump: false, down: false, guard: false, buttons: [] };
  for (let i = 0; i < 240; i++) k.match.p1.update(input);
  const x = k.match.p1.x;
  // 不能拿上一场景遗留的机位去投影新坐标：等镜头跟随到贴边站位后再读实时 NDC。
  await new Promise((r) => setTimeout(r, 700));
  const live = k.framing.probe();
  return { x, arenaHalf: f.arenaHalf, ndc: live.ndc, lookX: live.lookX };
});
check('竖屏活动范围被限制在窗口内：一路后退也停在边界上且仍可见',
  Math.abs(portraitWalk.x + portraitWalk.arenaHalf) < 1e-6 && inView(portraitWalk.ndc),
  `p1=${portraitWalk.x.toFixed(3)}, -half=${(-portraitWalk.arenaHalf).toFixed(3)}, ` +
  `ndc=[${fmt(portraitWalk.ndc)}], lookX=${portraitWalk.lookX.toFixed(2)}`);
await sleep(600);
const portraitLive = await portraitPage.evaluate(() => window.__kof.framing.probe());
check('竖屏贴边对局中两人实时 NDC 仍在画面内（镜头跟随不滞后出画）',
  inView(portraitLive.ndc),
  `ndc=[${fmt(portraitLive.ndc)}], z=${portraitLive.z.toFixed(2)}, fov=${portraitLive.fov.toFixed(2)}`);
const portraitShot = path.join(shots, '12-mobile-portrait.png');
await portraitPage.screenshot({ path: portraitShot });
check('竖屏截图已生成', fs.existsSync(portraitShot) && fs.statSync(portraitShot).size > 10000,
  `${(fs.statSync(portraitShot).size / 1024).toFixed(0)} KB`);

// 旋转回横屏：边界必须恢复，且不能残留竖屏的窄场地状态。
await portraitPage.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await sleep(650);
const portraitRotate = await portraitPage.evaluate(() => ({
  innerW: window.innerWidth, innerH: window.innerHeight,
  framing: window.__kof.framing.probe(),
  p1: window.__kof.match.p1.x, p2: window.__kof.match.p2.x,
}));
check('旋转回横屏：场地恢复 3.35、站位在界内、两人仍入画',
  portraitRotate.innerW === 844 && !portraitRotate.framing.portrait &&
  Math.abs(portraitRotate.framing.arenaHalf - 3.35) < 1e-6 &&
  Math.abs(portraitRotate.p1) <= 3.35 + 1e-6 && Math.abs(portraitRotate.p2) <= 3.35 + 1e-6 &&
  inView(portraitRotate.framing.ndc),
  `aspect=${portraitRotate.framing.aspect.toFixed(2)}, half=${portraitRotate.framing.arenaHalf.toFixed(2)}, ` +
  `p1=${portraitRotate.p1.toFixed(2)}, ndc=[${fmt(portraitRotate.framing.ndc)}]`);
await portraitPage.close();

check('全程无 pageerror / console.error / 失败请求（含移动端与竖屏视口）',
  pageErrors.length === 0 && consoleErrors.length === 0 && failedRequests.length === 0,
  [...pageErrors, ...consoleErrors, ...failedRequests].join(' | '));

const report = {
  rigBaseline: RIG_BASELINE, rigProbe: first.rig, htmlBytes,
  first, fightStart, afterStandGuard, afterGuard, afterCrouch, guardProbe, airProbe,
  afterJump, afterPunch, afterFight, koResult, restarted, vrmSnapshot,
  attackTags, airTags, idleDeltas, frameTags, difficultyProbe, debugProbe,
  fistGain, footGain, airFootGain, guardGap,
  impactProbe, recoil, dustBefore, dustAfter, freeze, koShot, koDom, resetShot,
  superProbe, superImpact,
  touchUi, touchShot, padProbe, padMacro, mobileBoot, mobileProbe, mobileShot,
  shellDesktop, mobileShell, tapPoint, dblTap,
  portraitBoot, portraitHalf, portraitExtreme, portraitLeft, portraitRight,
  portraitProjection, portraitWalk, portraitLive, portraitRotate, portraitShot,
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
