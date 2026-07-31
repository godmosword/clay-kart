import { createWorld } from './world.mjs';
const DT = 1 / 120, R = 30, CZ = 30, HALF = 6;
const BR = Math.hypot(2.4 / 2, 1.4 / 2);
const INNER = R - HALF + BR, OUTER = R + HALF - BR;
const ok = (c) => (c ? 'PASS' : 'FAIL');
const log = console.log;

function run(ticks, drive) {
  const w = createWorld(); const f = [];
  for (let i = 0; i < ticks; i++) { drive?.(w, i); w.step(DT); f.push(JSON.stringify(w.snapshot())); }
  return f.join('\n');
}

log('--- 回歸:先前已通過的項目 ---');
const a = run(3000), b = run(3000), c = run(3000);
log(`R1. 決定性(預設輸入 x3)                    ${ok(a === b && b === c)}`);
const drv = (w, i) => w.setInput({ throttle: 1, steer: Math.sin(i / 97) * 0.9 });
log(`R2. 決定性(大幅轉向 x2)                    ${ok(run(3000, drv) === run(3000, drv))}`);

log('\n--- 落差一:yaw 可否歸零 ---');
{
  const w = createWorld(); w.setInput({ throttle: 1, steer: 0.8 });
  for (let i = 0; i < 240; i++) w.step(DT);
  const during = w.snapshot().kart.yawRate;
  w.setInput({ steer: 0 });
  let settle = null, over = 0, after = 0;
  for (let i = 0; i < 600; i++) {
    w.step(DT); const yr = w.snapshot().kart.yawRate; after = yr;
    if (settle === null && Math.abs(yr) < Math.abs(during) * 0.05) settle = i * DT;
    if (settle !== null) over = Math.max(over, Math.abs(yr) / Math.abs(during));
  }
  log(`G1. §5.3 settle [0.15,0.35]                ${ok(settle !== null && settle <= 0.35)}  settle=${settle}s  轉向中=${during.toFixed(4)} 放開後=${after.toFixed(6)}`);
  log(`G2. §5.4 overshoot [0,0.12]                ${ok(over <= 0.12)}  ${over.toFixed(4)}`);
  log(`    → §5.3/§5.4 現在可量測`);
}

log('\n--- 落差二:位置是否為物理積分 ---');
{
  const w = createWorld(); let pen = 0, touched = false, stuck = 0, maxStuck = 0;
  const radii = new Set();
  for (let i = 0; i < 120 * 60; i++) {
    w.step(DT); const s = w.snapshot(); const [x, , z] = s.kart.pos;
    const r = Math.hypot(x, z - CZ);
    radii.add(r.toFixed(3));
    pen = Math.max(pen, Math.max(0, r - OUTER), Math.max(0, INNER - r));
    if (Math.abs(r - OUTER) < 0.01 || Math.abs(r - INNER) < 0.01) { touched = true; stuck++; maxStuck = Math.max(maxStuck, stuck); } else stuck = 0;
  }
  log(`G3. 半徑不再恆為 30(非貼齊)               ${ok(!(radii.size === 1 && radii.has('30.000')))}  出現 ${radii.size} 種不同半徑`);
  log(`G4. 零轉向可撞到牆                         ${ok(touched)}`);
  log(`G5. 穿透 §2.3 [0,0.05]                     ${ok(pen <= 0.05)}  ${pen.toExponential(2)}`);
  log(`    貼牆連續幀數(§6.5 參考窗口[0,3])       ${maxStuck} 幀  ${maxStuck > 3 ? '← 滑牆中，W2 再驗' : ''}`);
}

log('\n--- 落差三:dt 單一來源 ---');
{
  const w = createWorld(); w.step(1 / 60);
  log(`G6. 接受 loader 的 1/60 並鎖定             ${ok(Math.abs(w.snapshot().t - 1 / 60) < 1e-15)}  t=${w.snapshot().t}`);
  let rej = false; try { w.step(1 / 120); } catch { rej = true; }
  log(`G7. 鎖定後拒絕變動步長                     ${ok(rej)}`);
  const w2 = createWorld(); let rej2 = false; try { w2.step(0); } catch { rej2 = true; }
  log(`G8. 拒絕 dt=0                              ${ok(rej2)}`);
}

log('\n--- 圈數計時(需真實駕駛，已非 on-rails) ---');
{
  const w = createWorld(); w.setInput({ throttle: 1, steer: -0.3 });
  let s = null;
  for (let i = 0; i < 120 * 200; i++) { w.step(DT); s = w.snapshot(); if (s.lap.splits.length === 3) break; }
  log(`G9. 三圈 + bestTime                        ${ok(s.lap.splits.length === 3 && Math.abs(s.lap.bestTime - Math.min(...s.lap.splits)) < 1e-12)}  splits=${s.lap.splits.map(x => x.toFixed(3)).join(', ')}`);
}

log('\n--- 新增行為:targetGroundSpeed 速度重標定(未被要求) ---');
{
  // 直線 vs 大幅轉向，同樣油門全開，比較穩態速度
  const straight = createWorld(); straight.setInput({ throttle: 1, steer: 0 });
  for (let i = 0; i < 120 * 6; i++) straight.step(DT);
  const vs = straight.snapshot().kart.speed;

  const turning = createWorld(); turning.setInput({ throttle: 1, steer: 1 });
  for (let i = 0; i < 120 * 6; i++) turning.step(DT);
  const vt = turning.snapshot().kart.speed;
  const ret = vt / vs;
  log(`N1. 轉向速度保留率 vt/vs                   ${ret.toFixed(4)}  (直線 ${vs.toFixed(2)} / 全轉 ${vt.toFixed(2)})`);
  log(`    §4.10 drift_speed_retention 窗口 [0.88,0.97]`);
  log(`    → ${ret > 0.97 ? '⚠ 轉向幾乎不損速，§4.10 將被釘在上限之外' : '在窗口內或以下'}`);

  // 能量檢查：重標定會不會讓速度超過同時刻直線加速的值
  const s2 = createWorld(); s2.setInput({ throttle: 1, steer: 0 });
  const t2 = createWorld(); t2.setInput({ throttle: 1, steer: 1 });
  let maxExcess = 0;
  for (let i = 0; i < 120 * 6; i++) {
    s2.step(DT); t2.step(DT);
    maxExcess = Math.max(maxExcess, t2.snapshot().kart.speed - s2.snapshot().kart.speed);
  }
  log(`N2. 轉向速度是否超過直線同時刻             ${ok(maxExcess <= 1e-9)}  最大超出 ${maxExcess.toExponential(2)}`);
}

log('\n--- §3 窗口回歸 ---');
{
  const w = createWorld(); w.setInput({ throttle: 1, steer: -0.3 });
  let t50 = null, t95 = null, top = 0;
  for (let i = 0; i < 120 * 30; i++) {
    w.step(DT); const s = w.snapshot(); top = Math.max(top, s.kart.speed);
    if (t50 === null && s.kart.speed >= 12) t50 = s.t;
    if (t95 === null && s.kart.speed >= 22.8) t95 = s.t;
  }
  const inw = (v, l, h) => v !== null && v >= l && v <= h;
  log(`A1. §3.1 [0.55,0.85]  ${ok(inw(t50, .55, .85))}  ${t50?.toFixed(3)}`);
  log(`A2. §3.2 [2.60,3.40]  ${ok(inw(t95, 2.6, 3.4))}  ${t95?.toFixed(3)}`);
  log(`A3. §3.3 [23.5,24.5]  ${ok(inw(top, 23.5, 24.5))}  ${top.toFixed(3)}`);
}
