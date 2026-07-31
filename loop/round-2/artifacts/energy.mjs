import { createWorld } from './world.mjs';
const DT=1/120, R=30, CZ=30, HALF=6, BR=Math.hypot(1.2,0.7);
const INNER=R-HALF+BR, OUTER=R+HALF-BR;
const onTrack=(s)=>{const r=Math.hypot(s.kart.pos[0],s.kart.pos[2]-CZ);return r>INNER+0.2&&r<OUTER-0.2;};

// 只比較「兩台都還沒碰牆」的區間
const a=createWorld(); a.setInput({throttle:1,steer:0});
const b=createWorld(); b.setInput({throttle:1,steer:1});
let excess=0, n=0, lastA=0,lastB=0;
for(let i=0;i<120*10;i++){
  a.step(DT); b.step(DT);
  const sa=a.snapshot(), sb=b.snapshot();
  if(!onTrack(sa)||!onTrack(sb)) break;
  lastA=sa.kart.speed; lastB=sb.kart.speed; n++;
  excess=Math.max(excess, sb.kart.speed-sa.kart.speed);
}
console.log(`同時在賽道內的幀數        ${n} (${(n*DT).toFixed(2)}s)`);
console.log(`直線速度 / 全轉速度        ${lastA.toFixed(4)} / ${lastB.toFixed(4)}`);
console.log(`全轉超出直線的最大值       ${excess.toExponential(2)}  ${excess<=1e-9?'PASS 無能量創造':'⚠'}`);

// 極速上限是否被突破
const c=createWorld(); c.setInput({throttle:1,steer:0.6});
let top=0; for(let i=0;i<120*20;i++){c.step(DT);top=Math.max(top,c.snapshot().kart.speed);}
console.log(`轉向下最高速度             ${top.toFixed(6)}  上限 24  ${top<=24+1e-9?'PASS 未突破':'⚠ 突破'}`);

// 側向滑移是否真的被保留（§4.10 的關鍵）
const d=createWorld(); d.setInput({throttle:1,steer:0});
for(let i=0;i<120*4;i++)d.step(DT);
const before=d.snapshot().kart.speed;
d.setInput({steer:1});
let minv=99; for(let i=0;i<120*2;i++){d.step(DT); if(onTrack(d.snapshot()))minv=Math.min(minv,d.snapshot().kart.speed);}
console.log(`急轉瞬間最低速 / 轉前速度  ${minv.toFixed(3)} / ${before.toFixed(3)} = ${(minv/before).toFixed(4)}`);
