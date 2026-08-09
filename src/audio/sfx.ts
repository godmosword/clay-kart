/**
 * 一次性音效：撞擊、漂移、mini-turbo 釋放。
 *
 * 全部合成，理由見 `context.ts` 的檔頭。共通原則跟 `BAR-VISUAL §5.0`
 * 一致——**柔和、短、低對比**。黏土撞到黏土是「噗」不是「鏗」。
 */

/** 撞擊聲的基礎頻率。低頻＋快速衰減＝軟質碰撞。 */
const THUD_HZ = 78;

/** 撞擊衰減時間（秒）。超過 0.2 就開始像鼓，那太有存在感了。 */
const THUD_DECAY_S = 0.16;

/** 漂移摩擦的低通截止。黏土在地上磨是悶的，不是砂紙。 */
const SCRAPE_FILTER_HZ = 720;

/** mini-turbo 釋放的上滑音起訖。 */
const BOOST_FROM_HZ = 220;
const BOOST_TO_HZ = 560;
const BOOST_DECAY_S = 0.34;

/** 一段短的粉紅噪音緩衝，漂移與撞擊共用。 */
function createNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 0.5);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // 簡易粉紅噪音（Voss-McCartney 的一階近似）。白噪音太亮、太像電視雜訊，
  // 而 `BAR-VISUAL §6` 禁止「程序化雜訊當表面細節」——聽覺上的對應是
  // 不要讓摩擦聲聽起來像靜電。
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.0990460;
    b1 = 0.96300 * b1 + white * 0.2965164;
    b2 = 0.57000 * b2 + white * 1.0526913;
    data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.16;
  }
  return buffer;
}

export interface ClaySfx {
  /** 撞擊。`strength` 為 `[0, 1]`，對應 `collisionImpulse` 正規化後的值。 */
  thud(strength: number): void;
  /** 漂移摩擦的持續音量，`[0, 1]`。0 等於停止。 */
  setScrape(level: number): void;
  /** mini-turbo 釋放。`tier` 為 1–3，決定上滑音的高度。 */
  boost(tier: number): void;
  dispose(): void;
}

export function createClaySfx(ctx: AudioContext, destination: AudioNode): ClaySfx {
  const noise = createNoiseBuffer(ctx);

  // 漂移摩擦是常駐音源，用 gain 開關而不是每次建新的——
  // 每幀 new 一個 BufferSource 會在 GC 上留下鋸齒（`BAR-PERF §2.5`）。
  const scrapeSource = ctx.createBufferSource();
  scrapeSource.buffer = noise;
  scrapeSource.loop = true;
  const scrapeFilter = ctx.createBiquadFilter();
  scrapeFilter.type = 'lowpass';
  scrapeFilter.frequency.value = SCRAPE_FILTER_HZ;
  const scrapeGain = ctx.createGain();
  scrapeGain.gain.value = 0;
  scrapeSource.connect(scrapeFilter);
  scrapeFilter.connect(scrapeGain);
  scrapeGain.connect(destination);
  scrapeSource.start();

  return {
    thud(strength: number): void {
      const s = Math.min(1, Math.max(0, Number.isFinite(strength) ? strength : 0));
      if (s <= 0.001) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(THUD_HZ * (1 + s * 0.4), now);
      // 撞擊的音高往下掉，是「軟東西吸收衝擊」的聽覺線索。
      osc.frequency.exponentialRampToValueAtTime(THUD_HZ * 0.6, now + THUD_DECAY_S);

      const body = ctx.createGain();
      body.gain.setValueAtTime(0.9 * s, now);
      body.gain.exponentialRampToValueAtTime(0.0001, now + THUD_DECAY_S);

      // 一點噪音層給「土」的質感，純正弦聽起來像電子音。
      const grit = ctx.createBufferSource();
      grit.buffer = noise;
      const gritFilter = ctx.createBiquadFilter();
      gritFilter.type = 'lowpass';
      gritFilter.frequency.value = 400;
      const gritGain = ctx.createGain();
      gritGain.gain.setValueAtTime(0.5 * s, now);
      gritGain.gain.exponentialRampToValueAtTime(0.0001, now + THUD_DECAY_S * 0.7);

      osc.connect(body);
      body.connect(destination);
      grit.connect(gritFilter);
      gritFilter.connect(gritGain);
      gritGain.connect(destination);

      osc.start(now);
      osc.stop(now + THUD_DECAY_S + 0.02);
      grit.start(now);
      grit.stop(now + THUD_DECAY_S + 0.02);
      const cleanup = (): void => {
        osc.disconnect();
        body.disconnect();
        grit.disconnect();
        gritFilter.disconnect();
        gritGain.disconnect();
      };
      osc.addEventListener('ended', cleanup, { once: true });
    },

    setScrape(level: number): void {
      const l = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0));
      scrapeGain.gain.setTargetAtTime(l * 0.5, ctx.currentTime, 0.05);
    },

    boost(tier: number): void {
      const t = Math.min(3, Math.max(1, Math.round(tier)));
      const now = ctx.currentTime;
      const peak = BOOST_TO_HZ * (0.72 + t * 0.14);

      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(BOOST_FROM_HZ, now);
      osc.frequency.exponentialRampToValueAtTime(peak, now + BOOST_DECAY_S * 0.6);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.5, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + BOOST_DECAY_S);

      osc.connect(gain);
      gain.connect(destination);
      osc.start(now);
      osc.stop(now + BOOST_DECAY_S + 0.02);
      osc.addEventListener('ended', () => {
        osc.disconnect();
        gain.disconnect();
      }, { once: true });
    },

    dispose(): void {
      scrapeSource.stop();
      scrapeSource.disconnect();
      scrapeFilter.disconnect();
      scrapeGain.disconnect();
    },
  };
}
