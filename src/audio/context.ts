/**
 * `AudioContext` 的生命週期與瀏覽器自動播放解鎖。
 *
 * ## 為什麼音效是合成的，不是播上游的音檔
 *
 * `CHARACTERS.md §7` 寫著「上游可 100% 複用，是最省事的一塊」，
 * `loop/PLAN.md` 寫著「音效在 W3，不是 W4」。**兩句話都在，而 36 輪一個
 * 音訊檔都沒有。**
 *
 * R36 實際去看了素材才發現那句話是錯的：
 * `podcast-website/public/stories/<ep>/audio.mp3` 是 **24 個 6.6 分鐘、6.1MB
 * 的中文旁白**——podcast 節目本身。裡面沒有引擎聲、沒有碰撞聲，
 * 沒有任何可以切成音效的短音。
 *
 * 這大概也是音效一直沒做的原因：有人打開看一眼，發現素材不能用，
 * 就跳過了，而**沒有任何檢查會因此變紅**（那正是 R36 新增
 * `BAR-CONTENT.md` 的理由）。
 *
 * 所以改成合成。這不是退而求其次，在這個專案裡它更對：
 *
 * - **零資產位元組**——`BAR-PERF §3.3 total_assets_mb` 的預算是 12MB，
 *   而光一集 podcast 就 6.1MB
 * - **音高天然對應速度**——`BAR-CONTENT §2.4` 要求引擎聲隨速度變化，
 *   取樣播放要做變速不失真反而麻煩
 * - **決定性**——同樣的 speed 一定得到同樣的頻率，可以機械驗證
 *
 * 上游的旁白之後仍可能用在主題曲或開場語音，但那需要人去挑片段，
 * 不是這一輪能做的事。
 */

/** 瀏覽器在使用者互動前不允許出聲，這些事件用來解鎖。 */
const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

export interface ClayAudioContext {
  readonly ctx: AudioContext;
  /** 所有音源都接這裡，方便一次靜音或調總音量。 */
  readonly master: GainNode;
  /** `ctx.state === 'running'`——機械檢查用得到。 */
  isRunning(): boolean;
  dispose(): void;
}

/**
 * 建立 audio context 並掛上解鎖。
 *
 * 回傳 `null` 代表這個環境沒有 Web Audio（例如某些 headless 設定）——
 * **呼叫端必須處理 null，不要假設一定有聲音**。靜默失敗比丟例外好，
 * 沒有音效不該讓遊戲開不起來。
 */
export function createClayAudioContext(): ClayAudioContext | null {
  const Ctor = typeof window !== 'undefined'
    ? (window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
    : undefined;
  if (!Ctor) return null;

  let ctx: AudioContext;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }

  const master = ctx.createGain();
  // `§5.0` 的黏土調性是「柔和、低對比」。音訊的對應做法是整體壓低，
  // 讓引擎聲是背景而不是主角——童書調不該吵。
  master.gain.value = 0.18;
  master.connect(ctx.destination);

  const unlock = (): void => {
    if (ctx.state === 'suspended') void ctx.resume();
    for (const type of UNLOCK_EVENTS) {
      window.removeEventListener(type, unlock);
    }
  };
  for (const type of UNLOCK_EVENTS) {
    window.addEventListener(type, unlock, { passive: true });
  }

  return {
    ctx,
    master,
    isRunning: () => ctx.state === 'running',
    dispose(): void {
      for (const type of UNLOCK_EVENTS) window.removeEventListener(type, unlock);
      master.disconnect();
      void ctx.close();
    },
  };
}
