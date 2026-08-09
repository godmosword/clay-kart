/**
 * 遊戲音訊。從 `SimSnapshot` 驅動，對應 `BAR-CONTENT §2.3`／`§2.4`。
 *
 * 音效全部合成，理由見 `context.ts` 的檔頭（簡述：上游素材是 6.6 分鐘的
 * podcast 旁白，不是音效；`CHARACTERS.md §7` 說「可 100% 複用」是錯的）。
 *
 * ## 為什麼掛在 renderer 而不是 bootstrap
 *
 * `src/loader/bootstrap.ts` 是 Cursor 的範圍。音訊要的是「每幀拿到最新的
 * `SimSnapshot`」，而 `renderer.ts`（Claude Code 範圍）本來就在做這件事。
 * 從那裡驅動可以不跨範圍，代價是 renderer 多知道一件事——
 * 這個取捨在 `ARCHITECTURE.md` 的分工下比較划算。
 */
import type { SimSnapshot } from '@contract/sim';
import { createClayAudioContext, type ClayAudioContext } from './context.js';
import { createEngineVoice, type EngineVoice } from './engine.js';
import { createClaySfx, type ClaySfx } from './sfx.js';

/**
 * 速度正規化的基準。跟 `src/physics/constants.ts` 的 `BASE_TOP_SPEED`
 * 對齊，但**刻意複製而不是 import**——`src/physics/` 是 Codex 的範圍，
 * 音訊不該成為它改常數時的隱形依賴方。差幾個百分比對聽感沒有影響。
 */
const AUDIO_REFERENCE_TOP_SPEED = 24;

/** `collisionImpulse` 正規化的除數。超過這個值的撞擊都算滿格。 */
const IMPULSE_FULL_SCALE = 12;

/** 低於這個衝量不出聲——貼牆滑行每幀的微小衝量會變成連續的爆音。 */
const IMPULSE_GATE = 0.4;

export interface ClayAudio {
  /** 每幀呼叫，傳入最新的 snapshot。 */
  update(snapshot: SimSnapshot): void;
  /** 給機械檢查讀的狀態（`BAR-CONTENT §2.3`／`§2.4`）。 */
  debugState(): { running: boolean; engineHz: number };
  /**
   * 直接設定引擎速度比例，繞過 snapshot。
   *
   * **只給 `tools/visual/check-audio.mjs` 用。** `§2.4` 要驗證頻率隨速度變化，
   * 而在 headless 裡把車開到兩個特定速度既慢又不穩定；直接推參數量到的
   * 是同一條映射曲線，而且是決定性的。
   */
  forceSpeedRatio(ratio: number): void;
  dispose(): void;
}

/**
 * 建立音訊系統。
 *
 * 回傳的物件在沒有 Web Audio 的環境下仍然可用——所有方法變成 no-op。
 * **沒有音效不該讓遊戲開不起來**，所以這裡不丟例外。
 */
export function createClayAudio(): ClayAudio {
  const audio: ClayAudioContext | null = createClayAudioContext();
  if (!audio) {
    return {
      update: () => {},
      debugState: () => ({ running: false, engineHz: 0 }),
      forceSpeedRatio: () => {},
      dispose: () => {},
    };
  }

  const engine: EngineVoice = createEngineVoice(audio.ctx, audio.master);
  const sfx: ClaySfx = createClaySfx(audio.ctx, audio.master);

  /** 上一幀的漂移階級，用來偵測「釋放」這個邊緣事件。 */
  let lastDriftTier = 0;
  let lastDriftState: string = 'none';

  /**
   * 測試用的速度比例覆寫。
   *
   * **必須是 latch 而不是單次設值**：`update()` 每幀都會用真實車速蓋掉它，
   * 所以檢查端「設定完再讀」永遠讀到怠速。第一版就是這樣寫的，
   * `check-audio.mjs` 因此回報 `delta 0Hz`——那個 FAIL 是測試方法的錯，
   * 不是實作的錯，但它證明了那支檢查真的會紅。
   */
  let forcedRatio: number | null = null;

  return {
    update(snapshot: SimSnapshot): void {
      const kart = snapshot.karts[snapshot.playerIndex];
      if (!kart) return;

      engine.setSpeedRatio(forcedRatio ?? kart.speed / AUDIO_REFERENCE_TOP_SPEED);

      // 撞擊。閘值擋掉貼牆滑行的連續微小衝量——R35 修好逃脫之後，
      // 貼牆時每幀都有小衝量，沒有閘會變成持續的爆音。
      if (kart.collisionImpulse > IMPULSE_GATE) {
        sfx.thud(Math.min(1, kart.collisionImpulse / IMPULSE_FULL_SCALE));
      }

      // 漂移摩擦：蓄力中才有，而且隨蓄力程度變大。
      sfx.setScrape(kart.driftState === 'charging' ? 0.35 + kart.driftCharge * 0.65 : 0);

      // mini-turbo 釋放是邊緣事件——從 charging 轉出去且當時有 tier。
      if (lastDriftState === 'charging' && kart.driftState !== 'charging' && lastDriftTier > 0) {
        sfx.boost(lastDriftTier);
      }
      lastDriftState = kart.driftState;
      lastDriftTier = kart.driftTier;
    },

    debugState: () => ({
      running: audio.isRunning(),
      engineHz: engine.currentHz(),
    }),

    forceSpeedRatio(ratio: number): void {
      forcedRatio = Number.isFinite(ratio) ? ratio : null;
      engine.setSpeedRatio(forcedRatio ?? 0);
    },

    dispose(): void {
      engine.dispose();
      sfx.dispose();
      audio.dispose();
    },
  };
}
