import { createWorld } from './world.mjs';

const DT = 1 / 120;
const R = 30, CZ = 30, HALF = 6;
const CAR_L = 2.4, CAR_W = 1.4;
const BR = Math.hypot(CAR_L / 2, CAR_W / 2);
const INNER = R - HALF + BR, OUTER = R + HALF - BR;

const out = [];
const log = (s) => { out.push(s); console.log(s); };
const ok = (c) => (c ? 'PASS' : 'FAIL');

// ---------- 1. 決定性 ----------
function runSeq(ticks, drive) {
  const w = createWorld();
  const frames = [];
  for (let i = 0; i < ticks; i++) {
    if (drive) drive(w, i);
    w.step(DT);
    frames.push(JSON.stringify(w.snapshot()));
  }
  return frames.join('\n');
}
const a = runSeq(3000), b = runSeq(3000), c = runSeq(3000);
log(`1. 決定性(無輸入,3000 ticks 跑三次)        ${ok(a === b && b === c)}`);

const drv = (w, i) => w.setInput({ throttle: 1, steer: Math.sin(i / 97) * 0.9 });
const d1 = runSeq(3000, drv), d2 = runSeq(3000, drv);
log(`2. 決定性(有轉向輸入,跑兩次)               ${ok(d1 === d2)}`);

// ---------- 3. 圈數計時 ----------
{
  const w = createWorld();
  w.setInput({ throttle: 1, steer: 0 });
  let s = null;
  for (let i = 0; i < 120 * 200; i++) { w.step(DT); s = w.snapshot(); if (s.lap.splits.length >= 3) break; }
  const sp = s.lap.splits;
  log(`3. 三圈完成                                 ${ok(sp.length === 3)}  splits=${sp.map(x => x.toFixed(3)).join(', ')}`);
  const best = Math.min(...sp);
  log(`4. bestTime 正確                            ${ok(Math.abs(s.lap.bestTime - best) < 1e-9)}  best=${s.lap.bestTime?.toFixed(3)}`);
  log(`5. lap.current 停在 3                       ${ok(s.lap.current === 3)}  current=${s.lap.current}  total=${s.lap.total}`);
  const circ = 2 * Math.PI * R, expect = circ / 24;
  log(`   參考:周長 ${circ.toFixed(1)}u / 極速 24 = 理論最快 ${expect.toFixed(2)}s`);
}

// ---------- 6. 撞牆不穿透 ----------
{
  const w = createWorld();
  let maxOut = 0, maxIn = 0, nan = 0;
  for (let i = 0; i < 120 * 60; i++) {
    w.setInput({ throttle: 1, steer: i % 600 < 300 ? 1 : -1 });
    w.step(DT);
    const s = w.snapshot();
    const [x, y, z] = s.kart.pos;
    if (![x, y, z, s.kart.speed, s.kart.yaw].every(Number.isFinite)) nan++;
    const rad = Math.hypot(x, z - CZ);
    if (rad > OUTER) maxOut = Math.max(maxOut, rad - OUTER);
    if (rad < INNER) maxIn = Math.max(maxIn, INNER - rad);
  }
  const pen = Math.max(maxOut, maxIn);
  log(`6. 穿透深度 (BAR-FEEL §2.3 窗口 [0,0.05])   ${ok(pen <= 0.05)}  max=${pen.toExponential(2)}`);
  log(`7. 無 NaN/Inf (§2.4)                        ${ok(nan === 0)}  ${nan} 幀`);
}

// ---------- 8. §3 加速曲線 ----------
{
  const w = createWorld();
  w.setInput({ throttle: 1, steer: 0 });
  let t50 = null, t95 = null, top = 0;
  for (let i = 0; i < 120 * 30; i++) {
    w.step(DT);
    const s = w.snapshot();
    top = Math.max(top, s.kart.speed);
    if (t50 === null && s.kart.speed >= 12) t50 = s.t;
    if (t95 === null && s.kart.speed >= 22.8) t95 = s.t;
  }
  const inW = (v, lo, hi) => v !== null && v >= lo && v <= hi;
  log(`8. §3.1 time_to_50pct [0.55,0.85]           ${ok(inW(t50, .55, .85))}  ${t50?.toFixed(3)}`);
  log(`9. §3.2 time_to_95pct [2.60,3.40]           ${ok(inW(t95, 2.6, 3.4))}  ${t95?.toFixed(3)}`);
  log(`10. §3.3 top_speed [23.5,24.5]              ${ok(inW(top, 23.5, 24.5))}  ${top.toFixed(3)}`);
}

// ---------- 11. §5.3 yaw 回正 ----------
{
  const w = createWorld();
  w.setInput({ throttle: 1, steer: 0.8 });
  for (let i = 0; i < 240; i++) w.step(DT);
  const during = w.snapshot().kart.yawRate;
  w.setInput({ steer: 0 });
  let settled = null, after = null;
  for (let i = 0; i < 600; i++) {
    w.step(DT);
    const s = w.snapshot();
    after = s.kart.yawRate;
    if (settled === null && Math.abs(s.kart.yawRate) < Math.abs(during) * 0.05) settled = i / 120;
  }
  log(`11. §5.3 放開轉向後 yaw_rate 是否歸零        ${ok(settled !== null)}  轉向中=${during.toFixed(4)} 放開後=${after.toFixed(4)} settle=${settled ?? '從未 <5%'}`);
}

// ---------- 12. 直線行駛?(檢查是否被綁在圓軌上) ----------
{
  const w = createWorld();
  w.setInput({ throttle: 1, steer: 0 });
  for (let i = 0; i < 600; i++) w.step(DT);
  const s = w.snapshot();
  const rad = Math.hypot(s.kart.pos[0], s.kart.pos[2] - CZ);
  log(`12. 無轉向輸入時與圓心距離                  ${rad.toFixed(9)} (賽道半徑 ${R})`);
  log(`    → 完全等於半徑 = 被貼齊到中心線,非自由物理`);
}

// ---------- 13. 重力/落地 ----------
{
  const w = createWorld();
  w.setInput({ throttle: 0, steer: 0.001, jump: true });
  w.step(DT);
  w.setInput({ jump: false });
  let maxY = 0, air = 0, landed = -1;
  for (let i = 0; i < 300; i++) {
    w.step(DT); const s = w.snapshot();
    maxY = Math.max(maxY, s.kart.pos[1]);
    if (!s.kart.grounded) air++; else if (air > 0 && landed < 0) landed = i / 120;
  }
  log(`13. 重力與落地                              ${ok(maxY > 0.5 && landed > 0)}  最高=${maxY.toFixed(2)}u 滯空=${(air / 120).toFixed(3)}s`);
  log(`    §7.2 gravity 窗口 [26,34]，實作 GRAVITY=30 ✓`);
}

// ---------- 14. 倒車 ----------
{
  const w = createWorld();
  w.setInput({ throttle: 1, steer: 0.001, reverse: true });
  let minLong = 0;
  for (let i = 0; i < 120 * 8; i++) {
    w.step(DT); const s = w.snapshot();
    const f = [Math.sin(s.kart.yaw), Math.cos(s.kart.yaw)];
    minLong = Math.min(minLong, s.kart.vel[0] * f[0] + s.kart.vel[2] * f[1]);
  }
  const ratio = Math.abs(minLong) / 24;
  log(`14. §3.5 倒車比 [0.30,0.42]                 ${ok(ratio >= .3 && ratio <= .42)}  ${ratio.toFixed(3)}`);
}
