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
import {
  createSteerProbeSample,
  writeFollowCam,
  type SteerProbeSample,
} from '@ui/steer-screen-math';

export { TICK_HZ, TICK_DT, advance } from '@contract/sim';
export type { KartState, LapState, Renderer, SimSnapshot, SimWorld, WorldInput } from '@contract/sim';
export type { SteerProbeSample } from '@ui/steer-screen-math';

/**
 * 單一 rAF 回呼內最多追幾個 tick。
 *
 * 舊值 8（≈66.7ms）低於 R23 實測的 frame_time_p99≈139ms——再搭配
 * `accumulator = 0` 丟棄積欠，長幀會變成慢動作而不是掉格。
 * 提到能吃掉 ~150ms 長幀；真正的 spiral 防護改由 MAX_CATCH_UP_SECONDS 承擔
 * （分頁切回累積數秒時才丟時間，且必須記入 timeStats）。
 */
const MAX_TICKS_PER_FRAME = 24;

/**
 * 積欠模擬時間上限。超過部分丟棄並計入 `discardedSim`——這才是
 * 「寧可掉時間也不要 spiral」的唯一出口，而且不能靜靜發生。
 */
const MAX_CATCH_UP_SECONDS = 0.25;

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

/** 模擬時鐘 vs 牆鐘。欄位就地更新，不每幀 new。 */
export interface ClayTimeStats {
  /** 自啟動累計牆鐘秒數 */
  wallElapsed: number;
  /** 自啟動累計已推進的模擬秒數（= ticks * TICK_DT） */
  simElapsed: number;
  /** simElapsed / wallElapsed；健康值接近 1 */
  ratio: number;
  /** 因超過 MAX_CATCH_UP_SECONDS 而丟棄的模擬秒數累計 */
  discardedSim: number;
  /** 上一幀牆鐘 dt */
  lastFrameWall: number;
  /** 上一幀推進的 tick 數 */
  lastFrameTicks: number;
}

declare global {
  interface Window {
    /** 測試／除錯用：在 bootstrap 前設為 true，或 URL 帶 `?steerProbe=1`。 */
    __CLAY_ENABLE_STEER_PROBE__?: boolean;
    __CLAY_STEER_PROBE__?: ClaySteerProbe;
    /** 模擬／牆鐘比值與丟棄量——永遠掛上，供 perf／CDP 讀取。 */
    __CLAY_TIME_STATS__?: ClayTimeStats;
  }
}

const NO_OP_INPUT: InputSource = { poll: () => ({}) };

function isSteerProbeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.__CLAY_ENABLE_STEER_PROBE__ === true) return true;
  try {
    return new URLSearchParams(window.location.search).has('steerProbe');
  } catch {
    return false;
  }
}

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

  const timeStats: ClayTimeStats = {
    wallElapsed: 0,
    simElapsed: 0,
    ratio: 1,
    discardedSim: 0,
    lastFrameWall: 0,
    lastFrameTicks: 0,
  };
  window.__CLAY_TIME_STATS__ = timeStats;
  let lastDiscardLogWall = 0;

  // 正式 build 預設關閉：每幀 sampleFollowCam 曾造成 4 次配置（物件+3 陣列），
  // 在 §2.5 gc_pause 已成真量測之後這是第一個該拔的幀迴圈壓力源。
  // 回歸：`tools/visual/steer-screen.mjs` 走 `?steerProbe=1`。
  const steerProbeEnabled = isSteerProbeEnabled();
  const probeBuf = steerProbeEnabled ? createSteerProbeSample() : null;
  let probeReady = false;
  if (steerProbeEnabled && probeBuf) {
    window.__CLAY_STEER_PROBE__ = {
      // 回傳重用緩衝；CDP `returnByValue` 會在讀取當下結構化複製。
      latest: () => (probeReady ? probeBuf : null),
    };
  }

  // 綁在迴圈外：每幀 `() => inputSource.poll(i)` 會多一次閉包配置。
  // poll() 本身也必須重用緩衝（見 player-input.ts）。
  const pollInput = (tickIndex: number): WorldInput => inputSource.poll(tickIndex);

  const frame = () => {
    const now = performance.now() / 1000;
    const frameWall = now - last;
    last = now;

    timeStats.wallElapsed += frameWall;
    timeStats.lastFrameWall = frameWall;

    accumulator += frameWall;
    // Spiral 防護：只丟超過 catch-up 窗口的部分，且必須記帳／回報。
    if (accumulator > MAX_CATCH_UP_SECONDS) {
      const discarded = accumulator - MAX_CATCH_UP_SECONDS;
      timeStats.discardedSim += discarded;
      accumulator = MAX_CATCH_UP_SECONDS;
      // 節流：每秒最多打一次，避免 console 自己變成 GC 來源
      if (now - lastDiscardLogWall >= 1) {
        lastDiscardLogWall = now;
        console.warn(
          `[clay-kart] sim catch-up capped: discarded ${discarded.toFixed(3)}s this clamp, ` +
            `total discarded ${timeStats.discardedSim.toFixed(3)}s, ` +
            `sim/wall=${timeStats.ratio.toFixed(3)}`,
        );
      }
    }

    const pendingTicks = Math.min(Math.floor(accumulator / TICK_DT), MAX_TICKS_PER_FRAME);
    if (pendingTicks > 0) {
      advance(world, pendingTicks, pollInput);
      accumulator -= pendingTicks * TICK_DT;
      timeStats.simElapsed += pendingTicks * TICK_DT;
    }
    timeStats.lastFrameTicks = pendingTicks;
    // 剩餘積欠留到下一幀追——這才是「掉格／追 tick」而不是「掉時間」。
    // 舊碼 `if (accumulator >= TICK_DT) accumulator = 0` 會把長幀變成慢動作。

    timeStats.ratio =
      timeStats.wallElapsed > 0 ? timeStats.simElapsed / timeStats.wallElapsed : 1;

    const snap: SimSnapshot = world.snapshot();
    const alpha = accumulator / TICK_DT;
    renderer.draw(snap, alpha);

    // 其餘每幀配置：
    // - world.snapshot()：物理層契約，不在本檔可改範圍
    // - renderer.draw()：render 範圍
    // 本檔熱路徑在 probe 關閉時不再 new。
    if (probeBuf) {
      const kart = snap.karts[snap.playerIndex];
      if (kart) {
        writeFollowCam(probeBuf, kart.pos, kart.yaw, snap.t);
        probeReady = true;
      }
    }

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}
