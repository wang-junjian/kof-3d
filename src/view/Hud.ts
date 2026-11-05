import { MAX_HP, MAX_METER } from '../core/frames';
import type { Match } from '../core/match';
import type { Difficulty } from '../fighter/AI';

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'EASY', normal: 'NORMAL', hard: 'HARD',
};

const TEMPLATE = `
<div class="hud-top">
  <div class="side left">
    <div class="name"><span class="chip">P1</span> RIN <span class="dots" id="rounds1"></span></div>
    <div class="hpbar"><div class="hp-lag" id="hp-lag1"></div><div class="hp-fill p1" id="hp1"></div></div>
  </div>
  <div class="timer" id="timer">99</div>
  <div class="side right">
    <div class="name"><span class="dots" id="rounds2"></span> FEI <span class="chip cyan" id="cpu-label">CPU</span></div>
    <div class="hpbar flip"><div class="hp-lag" id="hp-lag2"></div><div class="hp-fill p2" id="hp2"></div></div>
  </div>
</div>
<div class="meter-row">
  <div class="meter"><span>POW</span><div class="meter-track"><div class="meter-fill p1" id="meter1"></div></div></div>
  <div class="round-label" id="round-label">ROUND 1</div>
  <div class="meter right"><div class="meter-track"><div class="meter-fill p2" id="meter2"></div></div><span>POW</span></div>
</div>
<div class="combo left" id="combo1"></div>
<div class="combo right" id="combo2"></div>
<div class="alert" id="alert"></div>
<div class="announce" id="announce"></div>
<div class="winner" id="winner"></div>
<div class="ko-vignette" id="ko-vignette"></div>
<div class="screen-flash" id="screen-flash"></div>
<div class="hud-bottom">A / D 移动 &nbsp;·&nbsp; W 跳跃 &nbsp;·&nbsp; 按住后方向 站防 &nbsp;·&nbsp; 后 + S 蹲防 &nbsp;·&nbsp; S 蹲下 &nbsp;·&nbsp; J 轻拳 &nbsp;·&nbsp; K 重拳 &nbsp;·&nbsp; L 轻踢 &nbsp;·&nbsp; I 重踢 &nbsp;·&nbsp; S + 踢 扫腿 &nbsp;·&nbsp; 空中攻击键 跳攻 &nbsp;·&nbsp; 1 / 2 / 3 难度</div>
`;

export class Hud {
  private readonly hp1: HTMLElement;
  private readonly hp2: HTMLElement;
  private readonly lag1: HTMLElement;
  private readonly lag2: HTMLElement;
  private readonly meter1: HTMLElement;
  private readonly meter2: HTMLElement;
  private readonly timerEl: HTMLElement;
  private readonly roundLabel: HTMLElement;
  private readonly rounds1: HTMLElement;
  private readonly rounds2: HTMLElement;
  private readonly combo1: HTMLElement;
  private readonly combo2: HTMLElement;
  private readonly announceEl: HTMLElement;
  private readonly winnerEl: HTMLElement;
  private readonly cpuLabel: HTMLElement;
  private readonly alertEl: HTMLElement;
  private readonly flashEl: HTMLElement;
  private readonly vignetteEl: HTMLElement;
  private winnerText = '';
  /** DOM 写入脏检查：60fps 下血条/计时/回合圆点绝大多数帧都没变，避免无谓的样式写与子树重建。 */
  private readonly domCache = new Map<string, string>();

  private changed(el: HTMLElement, channel: string, value: string): boolean {
    const key = `${el.id}:${channel}`;
    if (this.domCache.get(key) === value) return false;
    this.domCache.set(key, value);
    return true;
  }

  private setWidth(el: HTMLElement, value: string): void {
    if (this.changed(el, 'width', value)) el.style.width = value;
  }

  private setText(el: HTMLElement, value: string): void {
    if (this.changed(el, 'text', value)) el.textContent = value;
  }

  private setHtml(el: HTMLElement, value: string): void {
    if (this.changed(el, 'html', value)) el.innerHTML = value;
  }

  constructor(root: HTMLElement) {
    root.innerHTML = TEMPLATE;
    const q = (id: string): HTMLElement => {
      const el = root.querySelector<HTMLElement>(`#${id}`);
      if (!el) throw new Error(`HUD 缺少元素 #${id}`);
      return el;
    };
    this.hp1 = q('hp1');
    this.hp2 = q('hp2');
    this.lag1 = q('hp-lag1');
    this.lag2 = q('hp-lag2');
    this.meter1 = q('meter1');
    this.meter2 = q('meter2');
    this.timerEl = q('timer');
    this.roundLabel = q('round-label');
    this.rounds1 = q('rounds1');
    this.rounds2 = q('rounds2');
    this.combo1 = q('combo1');
    this.combo2 = q('combo2');
    this.announceEl = q('announce');
    this.winnerEl = q('winner');
    this.cpuLabel = q('cpu-label');
    this.alertEl = q('alert');
    this.flashEl = q('screen-flash');
    this.vignetteEl = q('ko-vignette');
  }

  setDifficulty(d: Difficulty): void {
    this.cpuLabel.textContent = `CPU · ${DIFFICULTY_LABEL[d]}`;
  }

  /** 连段数字由命中事件驱动弹出，不用每帧 update 覆盖，否则动画会被打断。 */
  combo(side: 0 | 1, n: number): void {
    if (n < 2) return;
    const el = side === 0 ? this.combo1 : this.combo2;
    this.setHtml(el, `<span class="combo-n">${n}</span><span class="combo-label">HITS · COMBO</span>`);
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  /** 'tap' 是重击命中的极轻白闪，'ko' 是终结一击的强闪。 */
  flash(level: 'tap' | 'ko' | null): void {
    if (!level) return;
    this.flashEl.className = 'screen-flash';
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add(level);
  }

  setKo(on: boolean): void {
    this.vignetteEl.classList.toggle('on', on);
  }

  /** 防御姿势选错时的一行提示，独立于回合公告，不干扰 FIGHT / K.O.。 */
  guardBreak(text: string): void {
    this.setText(this.alertEl, text);
    this.alertEl.classList.remove('show');
    void this.alertEl.offsetWidth;
    this.alertEl.classList.add('show');
  }

  announce(text: string): void {
    if (!text) {
      this.setText(this.announceEl, '');
      this.announceEl.classList.remove('show');
      return;
    }
    this.setText(this.announceEl, text);
    this.announceEl.classList.remove('show');
    void this.announceEl.offsetWidth;
    this.announceEl.classList.add('show');
  }

  showWinner(name: string): void {
    this.winnerText = `${name} WINS`;
    this.setText(this.winnerEl, this.winnerText);
    this.winnerEl.classList.add('show');
  }

  reset(): void {
    this.winnerText = '';
    this.domCache.clear();
    this.setText(this.winnerEl, '');
    this.winnerEl.classList.remove('show');
    this.setText(this.alertEl, '');
    this.alertEl.classList.remove('show');
    this.setHtml(this.combo1, '');
    this.setHtml(this.combo2, '');
    this.combo1.classList.remove('pop');
    this.combo2.classList.remove('pop');
    this.setKo(false);
    this.flashEl.className = 'screen-flash';
  }

  update(match: Match): void {
    const p1 = match.p1;
    const p2 = match.p2;
    const a = `${(p1.hp / MAX_HP) * 100}%`;
    const b = `${(p2.hp / MAX_HP) * 100}%`;
    this.setWidth(this.hp1, a);
    this.setWidth(this.hp2, b);
    this.setWidth(this.lag1, a);
    this.setWidth(this.lag2, b);
    this.setWidth(this.meter1, `${(p1.meter / MAX_METER) * 100}%`);
    this.setWidth(this.meter2, `${(p2.meter / MAX_METER) * 100}%`);
    this.setText(this.timerEl, String(match.timeLeft).padStart(2, '0'));
    this.setText(this.roundLabel, `ROUND ${match.round}`);
    this.setHtml(this.rounds1, '<i></i>'.repeat(p1.wins));
    this.setHtml(this.rounds2, '<i></i>'.repeat(p2.wins));
    // 连段数字由 combo() 弹出，这里只在连段结束时清空（同一 channel，避免缓存与 DOM 不同步）
    if (p1.combo < 2) this.setHtml(this.combo1, '');
    if (p2.combo < 2) this.setHtml(this.combo2, '');
    if (this.winnerText) this.setText(this.winnerEl, this.winnerText);
  }
}
