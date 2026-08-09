/**
 * 引擎聲——頻率隨速度變化。對應 `BAR-CONTENT §2.4`。
 *
 * ## 為什麼是三角波加低通，不是鋸齒波
 *
 * 鋸齒波是真實引擎的標準做法（諧波豐富、有金屬感），但那跟
 * `BAR-VISUAL §5.0` 的黏土調性衝突——那份標準要的是「柔和、霧面、低對比」。
 * 一台捏出來的黏土車不該發出金屬引擎聲。
 *
 * 三角波的諧波以 1/n² 衰減（鋸齒是 1/n），聽起來圓潤許多；
 * 再過一道低通把高頻壓掉，得到的是接近「嗡」的溫暖聲底。
 * 這跟 `CHARACTERS.md §7` 說的「溫暖童書調」是同一個方向。
 */

/** 怠速頻率（Hz）。刻意低——高頻在長時間遊玩下很快變得煩躁。 */
const IDLE_HZ = 46;

/** 全速時的頻率。與 `IDLE_HZ` 的比值約 3.7 倍，大約兩個八度。 */
const TOP_HZ = 172;

/**
 * 速度到頻率的曲線指數。
 *
 * 線性映射在低速時聽起來沒反應——人耳對頻率是對數感知的，
 * 所以低速段要給比較大的變化率。`0.7` 是在「起步有推力感」與
 * 「高速不刺耳」之間取的。
 */
const PITCH_CURVE = 0.7;

/** 低通截止頻率，跟著音高走，讓高速時稍微亮一點但不刺。 */
const FILTER_BASE_HZ = 320;
const FILTER_SPEED_HZ = 900;

/** 音量：怠速也要有聲音，否則停車時像當機。 */
const IDLE_GAIN = 0.35;
const TOP_GAIN = 1.0;

/**
 * 參數平滑的時間常數（秒）。
 *
 * 直接設值會在每幀之間產生階梯狀的頻率跳動，聽起來是「咯咯咯」。
 * 用 `setTargetAtTime` 做指數逼近，`0.08` 夠快到跟得上油門，
 * 又慢到把 60fps 的量化抹平。
 */
const SMOOTHING_S = 0.08;

export interface EngineVoice {
  /** 傳入 `[0, 1]` 的速度比例。超出範圍會被夾住。 */
  setSpeedRatio(ratio: number): void;
  /** 目前的振盪器頻率，機械檢查用（`BAR-CONTENT §2.4`）。 */
  currentHz(): number;
  dispose(): void;
}

export function createEngineVoice(ctx: AudioContext, destination: AudioNode): EngineVoice {
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = IDLE_HZ;

  // 第二個振盪器差五度，讓聲音有厚度而不只是一個純音。
  // 黏土是有體積的東西，單一正弦聽起來太薄。
  const harmonic = ctx.createOscillator();
  harmonic.type = 'triangle';
  harmonic.frequency.value = IDLE_HZ * 1.5;
  const harmonicGain = ctx.createGain();
  harmonicGain.gain.value = 0.3;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = FILTER_BASE_HZ;
  // Q 保持在 1 以下——共振峰會讓聲音變得有金屬感，那正是要避免的。
  filter.Q.value = 0.7;

  const gain = ctx.createGain();
  gain.gain.value = IDLE_GAIN;

  osc.connect(filter);
  harmonic.connect(harmonicGain);
  harmonicGain.connect(filter);
  filter.connect(gain);
  gain.connect(destination);

  osc.start();
  harmonic.start();

  let hz = IDLE_HZ;

  return {
    setSpeedRatio(ratio: number): void {
      const r = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
      const curved = Math.pow(r, PITCH_CURVE);
      hz = IDLE_HZ + (TOP_HZ - IDLE_HZ) * curved;
      const now = ctx.currentTime;
      osc.frequency.setTargetAtTime(hz, now, SMOOTHING_S);
      harmonic.frequency.setTargetAtTime(hz * 1.5, now, SMOOTHING_S);
      filter.frequency.setTargetAtTime(
        FILTER_BASE_HZ + FILTER_SPEED_HZ * curved,
        now,
        SMOOTHING_S,
      );
      gain.gain.setTargetAtTime(
        IDLE_GAIN + (TOP_GAIN - IDLE_GAIN) * curved,
        now,
        SMOOTHING_S,
      );
    },
    currentHz: () => hz,
    dispose(): void {
      osc.stop();
      harmonic.stop();
      osc.disconnect();
      harmonic.disconnect();
      harmonicGain.disconnect();
      filter.disconnect();
      gain.disconnect();
    },
  };
}
