/**
 * 接線層：把物理與渲染組起來，並跑固定 tick 迴圈。
 *
 * 這支檔案屬 Cursor 的寫入範圍——只做接線與執行迴圈，不做設計決策。
 * 型別契約在 src/contract/sim.ts（Lead 專屬），此處 re-export 以維持
 * 既有 import 路徑（@loader/bootstrap）不變，Codex／Claude Code 不需要
 * 改任何 import。
 */
import {
  advance,
  TICK_DT,
  type Renderer,
  type SimSnapshot,
  type SimWorld,
  type WorldInput,
} from '@contract/sim';
import { sampleFollowCam, type SteerProbeSample } from '@ui/steer-screen-math';

export { TICK_HZ, TICK_DT, advance } from '@contract/sim';
export type { KartState, LapState, Renderer, SimSnapshot, SimWorld, WorldInput } from '@contract/sim';
export type { SteerProbeSample } from '@ui/steer-screen-math';

/** 每幀最多追幾個 tick，避免分頁切回來時的死亡螺旋。純屬瀏覽器迴圈的節流參數。 */
const MAX_TICKS_PER_FRAME = 8;

/**
 * 輸入來源。每個 tick 呼叫一次 poll()，回傳值直接餵給 world.setInput()。
 *
 * 這是鍵盤／觸控輸入的接線點——見 loop/round-2/TASK-cursor.md。
 * bootstrap() 本身不讀任何輸入裝置，預設 no-op（保留 World 內建的
 * 預設行為），真正的輸入來源由呼叫端傳入。
 */
export interface InputSource {
  poll(tickIndex: number): WorldInput;
}

/** CDP 轉向回歸讀取的 probe。只暴露取樣，不暴露 setInput／改模擬的路徑。 */
export interface ClaySteerProbe {
  latest(): SteerProbeSample | null;
}

declare global {
  interface Window {
    __CLAY_STEER_PROBE__?: ClaySteerProbe;
  }
}

const NO_OP_INPUT: InputSource = { poll: () => ({}) };

export async function bootstrap(mount: HTMLElement, inputSource: InputSource = NO_OP_INPUT): Promise<void> {
  const [{ createWorld }, { createRenderer }] = await Promise.all([
    import('@physics/world'),
    import('@render/renderer'),
  ]);

  const world: SimWorld = createWorld();
  const renderer: Renderer = createRenderer(mount);

  const onResize = () => renderer.resize(mount.clientWidth, mount.clientHeight);
  window.addEventListener('resize', onResize);
  onResize();

  let last = performance.now() / 1000;
  let accumulator = 0;
  let latestProbe: SteerProbeSample | null = null;

  // 給 tools/visual/steer-screen.mjs：驗「按 → 車往畫面右」而不只是 yaw 有變。
  window.__CLAY_STEER_PROBE__ = {
    latest: () => latestProbe,
  };

  const frame = () => {
    const now = performance.now() / 1000;
    accumulator += now - last;
    last = now;

    const pendingTicks = Math.min(Math.floor(accumulator / TICK_DT), MAX_TICKS_PER_FRAME);
    if (pendingTicks > 0) {
      advance(world, pendingTicks, (i) => inputSource.poll(i));
      accumulator -= pendingTicks * TICK_DT;
    }
    // 追不上就丟棄積欠，寧可掉格也不要 spiral of death
    if (accumulator >= TICK_DT) accumulator = 0;

    const snap: SimSnapshot = world.snapshot();
    const alpha = accumulator / TICK_DT;
    renderer.draw(snap, alpha);

    const kart = snap.karts[snap.playerIndex];
    if (kart) {
      // probe 用未插值快照：回歸比的是持鍵前後位移符號，不需要亞幀精度。
      latestProbe = sampleFollowCam(kart.pos, kart.yaw, snap.t);
    }

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}
