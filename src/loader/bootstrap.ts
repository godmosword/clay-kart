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
  type AiOpponentConfig,
  type Renderer,
  type SimSnapshot,
  type SimWorld,
  type WorldInput,
} from '@contract/sim';
import { createClayHud } from '@ui/clay-hud';
import {
  createSteerProbeSample,
  writeFollowCam,
  type SteerProbeSample,
} from '@ui/steer-screen-math';

/**
 * 場上 AI 對手（契約建議上限 3 台，共 4 車）。
 * 難度落在 [0,1]；角色只影響識別／日後造型，物理側目前共用調校。
 * 數量與旋鈕形狀來自 `WorldOptions`／ghost-replay 既有用法——不改 FROZEN 檔。
 */
const DEFAULT_AI_OPPONENTS: readonly AiOpponentConfig[] = [
  { characterId: 'duoduo', difficulty: 0.45 },
  { characterId: 'dudu', difficulty: 0.6 },
  { characterId: 'anan', difficulty: 0.75 },
];

export { TICK_HZ, TICK_DT, advance } from '@contract/sim';
export type { KartState, LapState, Renderer, SimSnapshot, SimWorld, WorldInput } from '@contract/sim';
export type { SteerProbeSample } from '@ui/steer-screen-math';

/**
 * 單一 rAF 回呼內最多追幾個 tick。
 *
 * 舊值 8（≈66.7ms）低於 R23 實測的 frame_time_p99≈139ms——再搭配
 * `accumulator = 0` 丟棄積欠，長幀會變成慢動作而不是掉格。
 * 提到能吃掉 ~200ms 長幀（24 × TICK_DT）；真正的 spiral 防護改由
 * MAX_CATCH_UP_SECONDS 承擔（分頁切回累積數秒時才丟時間，且必須記入 timeStats）。
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

/**
 * R33：`?solo=1`（或 `?aiOpponents=0`）→ 空 AI，等同 `createWorld()` 單車。
 * 給 steer-screen 的「方向沒接反」斷言用；正式遊玩路徑不帶這些旗標。
 */
function resolveAiOpponents(): readonly AiOpponentConfig[] {
  if (typeof window === 'undefined') return DEFAULT_AI_OPPONENTS;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has('solo') || params.get('aiOpponents') === '0') {
      return [];
    }
  } catch {
    // ignore
  }
  return DEFAULT_AI_OPPONENTS;
}

export async function bootstrap(mount: HTMLElement, inputSource: InputSource = NO_OP_INPUT): Promise<void> {
  const [{ createWorld }, { createRenderer }] = await Promise.all([
    import('@physics/world'),
    import('@render/renderer'),
  ]);

  const aiOpponents = resolveAiOpponents();
  const world: SimWorld = createWorld(
    aiOpponents.length > 0 ? { aiOpponents } : {},
  );
  const renderer: Renderer = createRenderer(mount);
  // ui-hud（§5.12）在 Cursor 範圍；render 裡的 W1 monospace HUD 會被 clay-hud 藏掉。
  const hud = createClayHud(mount);

  const onResize = () => {
    renderer.resize(mount.clientWidth, mount.clientHeight);
    hud.resize();
  };
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
    // accumulator 在 catch-up 殘留時可超過一個 TICK_DT（最大約 6）；
    // alpha > 1 會讓 renderer 外插，長幀時車被畫超前再彈回——正好破壞這次修正。
    const alpha = Math.min(1, accumulator / TICK_DT);
    renderer.draw(snap, alpha);
    hud.update(snap);

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
