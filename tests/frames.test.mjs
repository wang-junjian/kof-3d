import test from 'node:test';
import assert from 'node:assert/strict';
import { frames, hitbox, input, characters } from './.build/logic.mjs';

const { MOVES, BUTTON_MOVE, AIR_BUTTON_MOVE, moveDuration, SUPER_COST, MAX_METER } = frames;
const { BASE_MOVES } = frames;
const { CHARACTERS } = characters;
const COMMAND_IDS = input.COMMANDS.map((c) => c.id);

/**
 * 批次 0 契约表驱动化：招式数量、指令族、取消图都是数据，不再写死 8 招。
 * 只对「两人共用的基础 8 招」保留冻结数值（镜像 / 伸展 / 判定框契约依赖它们），
 * 新增招式一律按 MoveDef 字段的通用不变量校验，加招时测试无需同步修改。
 */
test('招式帧表自洽：id 对齐、窗口为正、时长等于三段之和、基础 8 招冻结', () => {
  const ids = Object.keys(MOVES);
  assert.ok(ids.length >= 20, `招式表应已扩容（当前 ${ids.length}）`);
  assert.equal(BASE_MOVES.length, 8);
  assert.ok(BASE_MOVES.every((id) => MOVES[id]), '基础 8 招必须全部存在');
  for (const id of ids) {
    const m = MOVES[id];
    assert.equal(m.id, id, `${id} 的 id 字段不一致`);
    assert.ok(m.startup > 0 && m.active > 0 && m.recovery > 0, `${id} 帧窗口非正`);
    assert.equal(moveDuration(m), m.startup + m.active + m.recovery);
    assert.ok(m.damage > 0 && m.hitstun > 0 && m.blockstun > 0, `${id} 伤害/硬直非正`);
    assert.ok(m.hitbox.w > 0 && m.hitbox.h > 0, `${id} 判定框尺寸非正`);
    assert.ok(m.hitbox.x > 0, `${id} 判定框必须朝面向方向前伸`);
    assert.ok(['mid', 'low', 'overhead'].includes(m.level), `${id} 高度属性非法`);
    assert.ok(m.meterGain >= 0, `${id} 攒气不能为负`);
    assert.ok(m.cancelInto.every((t) => MOVES[t]), `${id} cancelInto 指向不存在的招式`);
    if (m.command) assert.ok(COMMAND_IDS.includes(m.command), `${id} 指令 id 未登记`);
    if (m.owner) assert.ok(['FEILING', 'YUEZHENG'].includes(m.owner), `${id} 角色归属非法`);
    if (m.cost !== undefined) {
      assert.ok(m.cost > 0 && m.cost <= MAX_METER, `${id} POW 消耗越界`);
      assert.equal(m.meterGain, 0, `${id} 消费招式不该回攒气`);
    }
  }
});

test('多段招式的每一段都落在 active 窗口内、帧号唯一且判定框有效', () => {
  const multi = Object.values(MOVES).filter((m) => m.hits);
  assert.ok(multi.length >= 3, `应有 3 个以上多 hit 招式（当前 ${multi.length}）`);
  for (const m of multi) {
    const hs = m.hits;
    assert.ok(hs.length >= 2, `${m.id} 标了 hits 却只有一段`);
    const seen = new Set();
    for (const h of hs) {
      assert.ok(h.frame >= m.startup && h.frame < m.startup + m.active,
        `${m.id} 第 ${h.frame} 帧落在 active 窗口 [${m.startup}, ${m.startup + m.active}) 之外`);
      assert.ok(!seen.has(h.frame), `${m.id} 第 ${h.frame} 帧重复结算`);
      seen.add(h.frame);
      assert.ok(h.damage > 0 && h.box.w > 0 && h.box.h > 0 && h.box.x > 0,
        `${m.id} 第 ${h.frame} 帧伤害/判定框非正`);
    }
    assert.deepEqual([...hs].map((h) => h.frame).sort((a, b) => a - b),
      hs.map((h) => h.frame), `${m.id} 多段帧号必须升序`);
  }
});

test('派生链：目标招式存在、归属一致、窗口落在整招时长内', () => {
  const branched = Object.values(MOVES).filter((m) => m.branchInto);
  assert.ok(branched.length >= 3, `应有 3 条以上派生链（当前 ${branched.length}）`);
  for (const m of branched) {
    const targets = Object.values(m.branchInto);
    assert.ok(targets.length > 0, `${m.id} 派生表为空`);
    for (const t of targets) {
      assert.ok(MOVES[t], `${m.id} 派生到不存在的 ${t}`);
      assert.equal(MOVES[t].owner, m.owner, `${m.id} → ${t} 跨角色派生`);
    }
    const [lo, hi] = m.branchWindow ?? [m.startup, moveDuration(m)];
    assert.ok(lo >= 0 && hi > lo && hi <= moveDuration(m), `${m.id} 派生窗口越界`);
  }
});

test('地面招式高度属性：中段 4 招 + 下段扫腿；跳攻 2 招为上段且仅滞空可用', () => {
  for (const id of ['LP', 'HP', 'LK', 'HK']) assert.equal(MOVES[id].level, 'mid');
  assert.equal(MOVES.SWEEP.level, 'low');
  assert.equal(MOVES.SWEEP.knockdown, true);
  for (const id of ['JLP', 'JHK']) {
    assert.equal(MOVES[id].level, 'overhead');
    assert.equal(MOVES[id].air, true);
    assert.equal(MOVES[id].knockdown, false);
  }
  for (const id of ['LP', 'HP', 'LK', 'HK', 'SWEEP']) assert.equal(MOVES[id].air, undefined);
});

test('下段判定框确实低于站立受伤盒中心、跳攻判定框高于下段', () => {
  assert.ok(MOVES.SWEEP.hitbox.y < frames.HURT_STAND.y);
  assert.ok(MOVES.JHK.hitbox.y > MOVES.SWEEP.hitbox.y);
  assert.ok(MOVES.LP.hitbox.y > MOVES.SWEEP.hitbox.y);
});

test('空中按键只映射到 JLP / JHK，地面按键一对一', () => {
  for (const b of ['LP', 'HP', 'LK', 'HK']) {
    assert.equal(BUTTON_MOVE[b], b);
    assert.ok(['JLP', 'JHK'].includes(AIR_BUTTON_MOVE[b]));
    assert.equal(MOVES[AIR_BUTTON_MOVE[b]].air, true);
  }
  assert.equal(AIR_BUTTON_MOVE.HP, 'JHK');
  assert.equal(AIR_BUTTON_MOVE.HK, 'JHK');
  assert.equal(AIR_BUTTON_MOVE.LP, 'JLP');
});

test('核心常量守住单局规则：99 秒、满血 100、场地与重力符号', () => {
  assert.equal(frames.MAX_HP, 100);
  assert.equal(frames.MAX_METER, 100);
  assert.equal(frames.ROUND_SECONDS, 99);
  assert.equal(frames.ROUND_SECONDS * 60, 5940);
  assert.ok(frames.ARENA_HALF > 0 && frames.WALK_SPEED > 0 && frames.BACK_SPEED > 0);
  assert.ok(frames.GRAVITY < 0 && frames.JUMP_VY > 0);
  assert.ok(frames.LANDING_STUN > 0);
  assert.ok(frames.PUSH_HALF * 2 > 0);
});

test('基础 8 招取消表冻结；角色专属取消图由 CharacterDef 提供且目标存在', () => {
  assert.deepEqual(MOVES.LP.cancelInto, ['HP', 'HK']);
  for (const id of ['HP', 'LK', 'HK', 'SWEEP', 'JLP', 'JHK', 'SUPER']) {
    assert.deepEqual(MOVES[id].cancelInto, []);
  }
  let edges = 0;
  for (const char of Object.values(CHARACTERS)) {
    for (const [from, to] of Object.entries(char.cancels)) {
      assert.ok(MOVES[from], `${char.name} 取消图起点 ${from} 不存在`);
      assert.ok(to.length > 0, `${char.name} ${from} 取消表为空`);
      edges += to.length;
      for (const t of to) {
        assert.ok(MOVES[t], `${char.name} ${from} → ${t} 目标不存在`);
        assert.ok(!MOVES[t].owner || MOVES[t].owner === char.id,
          `${char.name} 取消到对方专属招 ${t}`);
      }
    }
  }
  assert.ok(edges >= 8, `取消图应扩到 8 条以上（当前 ${edges}）`);
});

test('超必杀：半槽消费、不靠按键直连、每人各一招 236236', () => {
  assert.equal(SUPER_COST, 50);
  assert.equal(SUPER_COST * 2, MAX_METER);
  assert.equal(BUTTON_MOVE.SUPER, undefined);
  assert.equal(AIR_BUTTON_MOVE.SUPER, undefined);
  const s = MOVES.SUPER;
  assert.equal(s.id, 'SUPER');
  assert.equal(s.pose, 'super');
  assert.equal(s.meterGain, 0);
  assert.equal(s.knockdown, true);
  assert.equal(s.air, undefined);
  assert.ok(s.damage > MOVES.HP.damage * 2);
  assert.ok(s.hitbox.w > MOVES.HP.hitbox.w);
  assert.ok(s.startup > MOVES.LP.startup);

  const superPosed = Object.keys(MOVES).filter((id) => MOVES[id].pose === 'super');
  assert.equal(superPosed.length, 3, `基础 SUPER + 两人超杀，共 3 招（当前 ${superPosed.join(',')}）`);
  assert.ok(superPosed.every((id) => MOVES[id].cost === SUPER_COST), '超杀姿态必须都消费半槽');
  for (const char of Object.values(CHARACTERS)) {
    const m = MOVES[char.superMove];
    assert.equal(m.command, '236236', `${char.name} 超杀应挂 236236`);
    assert.equal(m.owner, char.id, `${char.name} 超杀必须专属`);
    assert.equal(m.cost, SUPER_COST);
    assert.equal(m.meterGain, 0);
    assert.ok(m.hits && m.hits.length >= 2, `${char.name} 超杀应为多 hit`);
  }
});

test('角色定义：中文名、指令表、动作风格与专属招式都互不重复', () => {
  const chars = Object.values(CHARACTERS);
  assert.equal(chars.length, 2);
  assert.ok(chars.every((c) => /^[\u4e00-\u9fa5]+$/.test(c.name)), '角色名必须是中文');
  assert.notEqual(chars[0].name, chars[1].name);
  assert.notEqual(chars[0].style, chars[1].style);
  assert.notEqual(chars[0].motion.reach, chars[1].motion.reach, '动作风格必须个性化');
  for (const char of chars) {
    assert.ok(COMMAND_IDS.every((id) => !char.commands[id] || MOVES[char.commands[id]]),
      `${char.name} 指令表指向不存在的招式`);
    for (const [cmd, id] of Object.entries(char.commands)) {
      assert.equal(MOVES[id].command, cmd, `${char.name} ${cmd} 与帧表指令标注不一致`);
      assert.ok(!MOVES[id].owner || MOVES[id].owner === char.id,
        `${char.name} 映射到对方专属招 ${id}`);
    }
    assert.ok(char.specials.length >= 2, `${char.name} 应有两个特殊技`);
    for (const sp of char.specials) {
      assert.ok(MOVES[sp.move], `${char.name} 特殊技 ${sp.move} 不存在`);
      assert.equal(MOVES[sp.move].owner, char.id);
    }
  }
  assert.notDeepEqual(chars[0].commands, chars[1].commands, '两人指令表必须不同');
  assert.notEqual(chars[0].superMove, chars[1].superMove);
  assert.equal(characters.characterFor(0).id, 'FEILING');
  assert.equal(characters.characterFor(1).id, 'YUEZHENG');
});

test('M3 攻防与资源常量就位', () => {
  assert.equal(frames.MAX_COST, 50);
  assert.equal(frames.MAX_DURATION, 480);
  assert.equal(frames.MAX_DAMAGE_SCALE, 1.5);
  assert.deepEqual(frames.MAX_BUTTONS, ['LP', 'HP']);
  assert.ok(frames.GUARD_CRUSH_LIMIT > 0);
  assert.ok(frames.EVADE_FRAMES > frames.EVADE_INVULN && frames.EVADE_INVULN > 0);
  assert.ok(frames.EVADE_SPEED > 0);
  const throwMoves = Object.values(MOVES).filter((m) => m.unblockable);
  assert.ok(throwMoves.length >= 1, '简化指令投：至少一招不可防');
  assert.ok(throwMoves.every((m) => m.closeRange > 0 && m.knockdown), '投技必须近身且击倒');
});

test('判定框工具导出齐全且可用（模块图完整性）', () => {
  assert.equal(typeof hitbox.worldBox, 'function');
  assert.equal(typeof hitbox.overlaps, 'function');
  assert.equal(typeof hitbox.separate, 'function');
});
