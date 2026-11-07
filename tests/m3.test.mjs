import test from 'node:test';
import assert from 'node:assert/strict';
import { input, frames, characters, fighter, match, ai } from './.build/logic.mjs';

const { COMMANDS, toNotation, notationFrame, detectCommands, InputBuffer } = input;
const { MOVES, JUMP_VY, GUARD_CRUSH_LIMIT, EVADE_INVULN, EVADE_FRAMES,
  MAX_DAMAGE_SCALE, MAX_COST, SUPER_COST } = frames;
const { FEILING, YUEZHENG } = characters;
const { Fighter } = fighter;

const I = (o = {}) => ({ dir: 0, jump: false, down: false, guard: false, buttons: [], ...o });
const F = (o = {}) => ({ ...I(), ...o });
const cmdDef = (id) => COMMANDS.find((c) => c.id === id);
/** 按指令表生成手摇帧：最后一帧带攻击键，与 notationFrame 的宏完全一致。 */
const seq = (id, facing = 1) => cmdDef(id).seq.map((n, i) =>
  notationFrame(n, facing, i === cmdDef(id).seq.length - 1 ? ['HP'] : []));
const pair = () => {
  const a = new Fighter(0, FEILING, -0.35);
  const b = new Fighter(1, YUEZHENG, 0.35);
  a.foe = b;
  b.foe = a;
  return [a, b];
};

// ── 批次 1：通用指令匹配器 ─────────────────────────────────────────────────
test('COMMANDS 表驱动：5 类指令、按长度降序、窗口不短于序列', () => {
  assert.equal(COMMANDS.length, 5);
  assert.deepEqual(COMMANDS.map((c) => c.id),
    ['236236', '41236', '236', '214', '623']);
  assert.ok(COMMANDS.every((c) => c.window >= c.seq.length),
    '长指令必须给足输入窗口，否则永远摇不出来');
  assert.deepEqual(COMMANDS.map((c) => c.seq.length),
    [...COMMANDS.map((c) => c.seq.length)].sort((a, b) => b - a));
});

test('toNotation 输出相对 facing 的数字方位，镜像站位无需第二套指令', () => {
  assert.equal(toNotation(F({ dir: 1 }), 1), 6);
  assert.equal(toNotation(F({ dir: -1 }), 1), 4);
  assert.equal(toNotation(F({ down: true }), 1), 2);
  assert.equal(toNotation(F({ down: true, dir: 1 }), 1), 3);
  assert.equal(toNotation(F({ down: true, dir: -1 }), 1), 1);
  assert.equal(toNotation(F(), 1), 5);
  assert.equal(toNotation(F({ jump: true }), 1), 8);
  // facing = -1：物理方向整体翻转，数字方位保持不变
  assert.equal(toNotation(F({ dir: -1 }), -1), 6);
  assert.equal(toNotation(F({ dir: 1 }), -1), 4);
  assert.equal(toNotation(F({ down: true, dir: -1 }), -1), 3);
});

test('notationFrame 与 toNotation 互逆（手摇 / 宏 / AI 共用一套方位）', () => {
  for (const facing of [1, -1]) {
    for (const n of [1, 2, 3, 4, 5, 6, 8]) {
      assert.equal(toNotation(notationFrame(n, facing), facing), n,
        `facing=${facing} 方位 ${n} 无法回读`);
    }
  }
});

test('detectCommands：5 类指令全部可识别，长指令优先于短指令', () => {
  const fire = (id, facing = 1) => {
    const frames = seq(id, facing);
    const history = frames.slice(0, -1).map((f) => toNotation(f, facing));
    return { found: detectCommands(history, frames.at(-1), facing), facing };
  };
  for (const id of ['236', '214', '623', '41236', '236236']) {
    const direct = fire(id);
    assert.equal(direct.found[0], id, `${id} 必须排在最前（超杀优先）`);
    const mirrored = fire(id, -1);
    assert.equal(mirrored.found[0], id, `${id} 镜像站位失效`);
  }
  assert.ok(fire('236236').found.includes('236'), '236236 同时满足 236 是允许的宽松匹配');
  assert.deepEqual(detectCommands([], F({ buttons: ['HP'] }), 1), [], '没有历史不该出指令');
  assert.deepEqual(detectCommands([2, 3], F(), 1), [], '指令必须以攻击键收尾');
});

test('InputBuffer.queueCommand 表驱动：逐帧吐出序列、只有末帧带按键', () => {
  const target = { addEventListener() {}, removeEventListener() {} };
  for (const facing of [1, -1]) {
    for (const def of COMMANDS) {
      const buf = new InputBuffer(target);
      buf.queueCommand(def.id, facing);
      assert.equal(buf.macroPending, true);
      const frames = def.seq.map(() => buf.sample());
      assert.equal(buf.macroPending, false, `${def.id} 宏播完应清空`);
      assert.deepEqual(frames.map((f) => toNotation(f, facing)), [...def.seq]);
      assert.deepEqual(frames.slice(0, -1).map((f) => f.buttons.length),
        def.seq.slice(0, -1).map(() => 0));
      assert.deepEqual(frames.at(-1).buttons, ['HP']);
    }
  }
});

// ── 批次 2：角色指令表、多 hit、派生链、取消图 ─────────────────────────────
test('起招优先级：指令表 → 角色专属超杀 → 特殊技 → 普通按键', () => {
  const [f] = pair();
  f.meter = 100;
  f.update(F({ dir: 1, buttons: ['HP'], commands: ['236'] }));
  assert.equal(f.move?.id, 'FL_THOUSAND');
  assert.equal(f.meter, 100, '普通必杀不消费 POW');

  f.state = 'idle'; f.move = null; f.hasHit = false;
  f.update(F({ dir: 1, buttons: ['HP'], commands: ['236236'] }));
  assert.equal(f.move?.id, 'FL_SKY');
  assert.equal(f.meter, 100 - SUPER_COST);

  // 绯翎没有 41236，岳铮的指令投不能被对方玩家摇出来
  f.state = 'idle'; f.move = null; f.hasHit = false; f.meter = 100;
  f.update(F({ buttons: ['HP'], commands: ['41236'] }));
  assert.equal(f.move?.id, 'HP', '未登记指令应回退普通按键');

  // 方向 + 按键命中角色 specials 表
  f.state = 'idle'; f.move = null; f.hasHit = false;
  f.update(F({ dir: 1, buttons: ['HP'] }));
  assert.equal(f.move?.id, 'FL_THRUST');
});

test('近身指令投：距离不达标不起招，达标且不可防', () => {
  const [a, b] = pair();
  b.meter = 100;
  b.x = 3.0; a.x = 0;
  b.update(F({ buttons: ['HP'], commands: ['41236'] }));
  assert.notEqual(b.move?.id, 'YZ_THROW', '远距离不该抓到');

  b.state = 'idle'; b.move = null; b.hasHit = false;
  a.x = 0.4; b.x = 0;
  b.update(F({ buttons: ['HP'], commands: ['41236'] }));
  assert.equal(b.move?.id, 'YZ_THROW');
  assert.equal(MOVES.YZ_THROW.unblockable, true);

  a.guarding = true; a.guardLevel = 'stand'; a.state = 'guard';
  const ev = a.receiveHit(MOVES.YZ_THROW, b, 0, 0);
  assert.equal(ev.blocked, false, '投技必须破防');
  assert.equal(ev.guardBreak, true);
  assert.equal(a.hp, 100 - MOVES.YZ_THROW.damage);
});

test('多 hit：三段各自结算一次、重复帧不重算、段覆盖伤害/顿帧', () => {
  const [f] = pair();
  f.startMove('FL_THOUSAND');
  const m = MOVES.FL_THOUSAND;
  const seen = [];
  for (let frame = 0; frame < m.startup + m.active + 2; frame++) {
    f.moveFrame = frame;
    const hit = f.currentHit();
    if (hit) {
      seen.push({ frame, damage: hit.move.damage, hitstop: hit.move.hitstop,
        meterGain: hit.move.meterGain });
      f.markHit(hit.hitIndex);
    }
  }
  assert.deepEqual(seen.map((h) => h.frame), [8, 12, 16]);
  assert.deepEqual(seen.map((h) => h.damage), [4, 4, 5]);
  assert.deepEqual(seen.map((h) => h.hitstop), [3, 3, 5]);
  assert.ok(seen.every((h) => h.meterGain === m.meterGain / m.hits.length));
  f.moveFrame = 12;
  assert.equal(f.currentHit(), null, '已结算的段不能再命中');
});

test('派生链：窗口内追加输入切下一拍，链可继续延伸', () => {
  const [f] = pair();
  f.startMove('FL_THOUSAND');
  f.moveFrame = 7;
  f.update(F({ buttons: ['HP'] }));       // moveFrame → 8，进入 [8,30)
  assert.equal(f.move?.id, 'FL_FEATHER');
  f.moveFrame = 4;
  f.update(F({ buttons: ['HK'] }));       // → 5，进入 [5,20)
  assert.equal(f.move?.id, 'FL_SKYFALL');
  assert.equal(MOVES.FL_SKYFALL.branchInto, undefined, '末拍不该再派生');

  // 窗口外按追加键无效
  f.startMove('FL_THOUSAND');
  f.moveFrame = 29;
  f.update(F({ buttons: ['HP'] }));       // → 30，已越过 branchWindow 上界
  assert.equal(f.move?.id, 'FL_THOUSAND');
});

test('取消图：命中后指令取消优先于按键取消，且只认本角色的目标', () => {
  const [f] = pair();
  f.meter = 100;
  f.startMove('LP');
  f.moveFrame = 2;
  f.hasHit = true;
  f.update(F({ buttons: ['HP'], commands: ['236'] }));
  assert.equal(f.move?.id, 'FL_THOUSAND', 'LP → 236 指令必杀');

  f.startMove('HP');
  f.moveFrame = 6;
  f.hasHit = true;
  f.update(F({ buttons: ['HP'], commands: ['236236'] }));
  assert.equal(f.move?.id, 'FL_SKY', 'HP → 236236 超杀');
  assert.equal(f.meter, 100 - SUPER_COST);

  // 岳铮的取消图不能把绯翎送进对方专属招
  const other = new Fighter(0, YUEZHENG, 0);
  other.meter = 100;
  assert.ok(other.char.cancels.LP.includes('YZ_CRUSH'));
  assert.ok(!f.char.cancels.LP.includes('YZ_CRUSH'));
});

// ── 批次 3：MAX / 防御破坏 / 回避 / 跳跃分档 ──────────────────────────────
test('MAX 爆气：消耗半槽、伤害 1.5 倍、持续期内重复触发不再扣槽', () => {
  const [a, b] = pair();
  a.meter = 100;
  a.update(F({ buttons: ['LP', 'HP'], max: true }));
  assert.equal(a.isMax, true);
  assert.equal(a.meter, 100 - MAX_COST);
  assert.equal(a.damageScale, MAX_DAMAGE_SCALE);
  a.update(F({ buttons: ['LP', 'HP'], max: true }));
  assert.equal(a.meter, 100 - MAX_COST, 'MAX 期间不能二次扣槽');

  const ev = b.receiveHit(MOVES.HP, a, 0, 0);
  assert.equal(ev.blocked, false);
  assert.equal(b.hp, 100 - Math.round(MOVES.HP.damage * MAX_DAMAGE_SCALE));
});

test('防御破坏：连续格挡压力达上限后强制破防', () => {
  const [a, b] = pair();
  b.guarding = true; b.guardLevel = 'stand'; b.state = 'guard';
  b.guardStress = GUARD_CRUSH_LIMIT;
  const ev = b.receiveHit(MOVES.HP, a, 0, 0);
  assert.equal(ev.blocked, false);
  assert.equal(ev.guardBreak, true);
  assert.equal(b.guardStress, 0, '破防后压力清零');
});

test('紧急回避：后方向 + LP + HK 触发，前若干帧无敌', () => {
  const [f] = pair();
  f.facing = 1;
  f.update(F({ dir: -1, buttons: ['LP', 'HK'], evade: true }));
  assert.equal(f.evadeTimer, EVADE_FRAMES);
  assert.equal(f.invuln, EVADE_INVULN);
  assert.ok(f.vx < 0, '回避应朝身后位移');
});

test('跳跃分档：前跳更高更远，原地跳更短', () => {
  const long = new Fighter(0, FEILING, 0);
  long.facing = 1;
  long.update(F({ dir: 1, jump: true }));
  const short = new Fighter(0, FEILING, 0);
  short.facing = 1;
  short.update(F({ jump: true }));
  assert.ok(long.vy > short.vy, `vy ${long.vy} vs ${short.vy}`);
  assert.ok(Math.abs(long.vx) > Math.abs(short.vx));
  assert.ok(long.vy > JUMP_VY && short.vy < JUMP_VY);
});

// ── 真实对局集成：多 hit 在 Match 结算链路里逐段派发 ────────────────────────
test('Match 集成：千羽连三段各自派发 onHit，敌方只掉三段伤害之和', () => {
  let hits = 0;
  const cb = {
    onHit: () => { hits++; }, onRoundStart() {}, onRoundEnd() {}, onMatchEnd() {},
    onAnnounce() {}, onReset() {},
  };
  const m = new match.Match(new ai.AIController('easy'), cb);
  m.ai.decide = () => F();           // 排除 AI 干扰，只看玩家招式
  m.phase = 'fight';
  m.clearTransient();
  m.p1.x = -0.35; m.p2.x = 0.35;
  for (const f of [m.p1, m.p2]) {
    f.state = 'idle'; f.move = null; f.moveFrame = 0; f.hasHit = false;
    f.stunLeft = 0; f.y = 0; f.vy = 0; f.vx = 0;
    f.airborne = false; f.guarding = false; f.crouching = false;
  }
  m.p1.startMove('FL_THOUSAND');
  for (let i = 0; i < 160; i++) m.step(F());
  const total = MOVES.FL_THOUSAND.hits.reduce((n, h) => n + h.damage, 0);
  assert.equal(hits, 3, `应派发 3 次命中，实际 ${hits}`);
  assert.equal(m.p2.hp, 100 - total, `应只掉 ${total} 点血`);
});
