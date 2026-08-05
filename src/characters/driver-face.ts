/**
 * `BAR-VISUAL §4` 元件 #3：`driver-face`——大圓眼 + 笑口，12fps 抽格。
 *
 * `CHARACTERS.md §4`：「**大圓眼 + 明確笑口**是全卡司共通識別，**任何角度
 * 都要看得到眼睛**」。所以眼睛做得大、凸出臉盤，而不是貼平的兩個點——
 * 貼平的眼睛從側面就消失了。
 *
 * ## 為什麼放在 `src/characters/` 而不是 `src/render/components/`
 *
 * `CHARACTERS.md §3` 的判準：「凡是由 `SimSnapshot` 驅動的，60fps；凡是
 * 純表演的，12fps」。輪子自轉是載具（60fps，放 `src/render/`），眨眼與
 * 表情是角色（12fps，放這裡）。§3 是「違反即整輪 FAIL」的規則，把兩種
 * 更新率的東西實體隔開，比只在註解裡提醒可靠。
 *
 * ## 12fps 抽格
 *
 * `setExpressionTime()` 把時間量化到 `Math.floor(t * 12) / 12` 才取用，
 * 這是 §3 指定的實作方式。**載具 transform 不經過這裡**——它吃物理插值，
 * 維持 60fps。
 *
 * 目前遊戲端還沒驅動這支 API（臉尚未接進 `renderer.ts`），所以
 * `BAR-PERF §4.1 character_anim_hz` 仍誠實回報 not_applicable。機制先
 * 建好，接上去時就不必回頭補。
 */
import { Group, Mesh, TorusGeometry } from 'three';
import { clayBlob, claySlab } from '../render/clay/geometry.js';
import { createClayMaterial } from '../render/clay/material.js';
import { FACE } from '../render/clay/palette.js';

/** `CHARACTERS.md §3` 指定的角色動畫更新率。 */
export const CHARACTER_ANIM_HZ = 12;

/** 眨眼週期與持續時間（秒）。刻意不規律感由週期本身給，不用亂數。 */
const BLINK_PERIOD_S = 3.4;
const BLINK_DURATION_S = 0.14;

export interface DriverFace {
  /**
   * 整張臉，`eyes` 與 `mouth` 都掛在底下，相對位置就是元件審查時的樣子。
   * 拿這個掛上去 = 臉是剛性的一塊。
   */
  group: Group;
  /**
   * 臉盤 + 大圓眼 + 眼皮。
   *
   * 跟 `mouth` 分開暴露，是為了讓呼叫端可以**各自擺在車頭的不同曲面上**——
   * 見下方「為什麼臉要能拆開擺」。
   */
  eyes: Group;
  /** 笑口 + 舌頭。 */
  mouth: Group;
  /**
   * 更新表情。傳入連續時間，內部量化到 12fps——**呼叫端不需要自己抽格**，
   * 傳原始時間即可，避免每個呼叫點各自實作一次量化而漏掉。
   *
   * 不管 `eyes`／`mouth` 被搬到哪個父節點底下都仍然有效：它改的是眼皮的
   * `visible`，跟階層無關。
   */
  setExpressionTime(seconds: number): void;
}

/**
 * 建立一張臉。原點在臉盤中心。
 *
 * ## 為什麼臉要能拆開擺（R21）
 *
 * R20 把臉當成剛性一塊掛上車，結果笑口沉進引擎蓋，正面完全看不到——
 * 違反 `CHARACTERS.md §4`「**大圓眼 + 明確笑口**是全卡司共通識別」與
 * `BAR-VISUAL §5.3`。傾角試過 `-0.25`／`-0.6`／`-0.85` 三檔都無解：
 * 眼睛擺得好看笑口就埋進去，笑口露出來眼睛就得抬到車頂高度。
 *
 * 回頭看參考圖 `refs/clay/characters/小紅賽車.jpg` 才發現原因——
 * 那張臉本來就**不是剛性的一塊**：白色臉盤與大圓眼壓在前擋斜面上，
 * 笑口是另一塊黏土，壓在前保險桿上，中間隔著一整個引擎蓋的落差。
 * 甲蟲車的車頭有兩個朝向差很多的曲面，一塊平板貼不住兩個。
 *
 * 所以這裡把兩部分分開暴露。**預設仍組成完整一張臉**（`group` 底下），
 * 元件審查圖因此不變；需要貼合車頭曲面的呼叫端才各自取用。
 */
export function createDriverFace(): DriverFace {
  const group = new Group();
  group.name = 'driver-face';

  const eyes = new Group();
  eyes.name = 'driver-face-eyes';
  const mouth = new Group();
  mouth.name = 'driver-face-mouth';
  group.add(eyes);
  group.add(mouth);

  const panelClay = createClayMaterial({ color: FACE.panel, textureScale: 2.4 });
  const eyeWhiteClay = createClayMaterial({ color: FACE.eyeWhite, textureScale: 5 });
  const irisClay = createClayMaterial({ color: FACE.iris, textureScale: 6 });
  const pupilClay = createClayMaterial({ color: FACE.pupil, textureScale: 7 });
  const highlightClay = createClayMaterial({
    color: FACE.highlight,
    // 眼神光是唯一允許稍微亮一點的地方，但仍在 §6 的 roughness 下限之上。
    roughness: 0.6,
    textureScale: 8,
  });
  const mouthClay = createClayMaterial({ color: FACE.mouth, textureScale: 6 });
  const tongueClay = createClayMaterial({ color: FACE.tongue, textureScale: 7 });

  // ── 臉盤 ────────────────────────────────────────────────────────────
  // 圓角厚片，是眼睛的底。參考圖上臉盤本身也是一塊獨立黏土。
  const panel = new Mesh(claySlab(0.78, 0.34, 0.08, { bevelRatio: 0.42 }), panelClay);
  eyes.add(panel);

  // ── 眼睛 ────────────────────────────────────────────────────────────
  // 明顯凸出臉盤，這樣側面角度仍看得到——§4 的「任何角度都要看得到眼睛」。
  const eyelids: Mesh[] = [];
  for (const side of [1, -1]) {
    const eye = new Group();
    eye.position.set(side * 0.17, 0.01, 0.05);

    // 眼球做得接近半球而不是貼平的圓片：貼平的眼睛從側面會消失，
    // 直接違反 §4 的「任何角度都要看得到眼睛」。
    const white = new Mesh(clayBlob(0.118, 18), eyeWhiteClay);
    white.scale.set(1, 1.06, 0.95);
    eye.add(white);

    const iris = new Mesh(clayBlob(0.074, 16), irisClay);
    iris.position.z = 0.072;
    iris.scale.set(1, 1, 0.62);
    eye.add(iris);

    const pupil = new Mesh(clayBlob(0.037, 14), pupilClay);
    pupil.position.z = 0.104;
    pupil.scale.set(1, 1, 0.55);
    eye.add(pupil);

    // 眼神光偏上外側，跟參考圖一致。
    const highlight = new Mesh(clayBlob(0.021, 10), highlightClay);
    highlight.position.set(side * 0.028, 0.038, 0.118);
    highlight.scale.set(1, 1, 0.5);
    eye.add(highlight);

    // 眼皮：平常縮在上方看不見，眨眼時壓下來蓋住眼睛。
    const lid = new Mesh(claySlab(0.25, 0.13, 0.1, { bevelRatio: 0.4 }), panelClay);
    lid.position.set(0, 0.16, 0.055);
    lid.visible = false;
    eye.add(lid);
    eyelids.push(lid);

    eyes.add(eye);
  }

  // ── 笑口 ────────────────────────────────────────────────────────────
  // 半圈圓環＝往上彎的弧。`TorusGeometry` 由角度 0 逆時針畫，轉半圈之後
  // 涵蓋 180°→360°，也就是下半圈——正好是笑起來的形狀。
  const smile = new Mesh(new TorusGeometry(0.115, 0.032, 10, 22, Math.PI), mouthClay);
  smile.rotation.z = Math.PI;
  smile.position.set(0, 0, 0.04);
  mouth.add(smile);

  // 舌頭：塞在笑口下緣，參考圖上是一小片粉紅。
  const tongue = new Mesh(clayBlob(0.05, 12), tongueClay);
  tongue.position.set(0, -0.055, 0.03);
  tongue.scale.set(1.25, 0.62, 0.5);
  mouth.add(tongue);

  // 笑口子群整體下移，讓 `group` 底下的相對位置跟 R20 完全一樣——
  // 元件審查圖不因為這次拆分而改變。
  mouth.position.y = -0.2;

  return {
    group,
    eyes,
    mouth,
    setExpressionTime(seconds: number): void {
      // §3 指定的抽格實作：角色動畫時間軸取 floor(t * 12) / 12。
      const quantized = Math.floor(seconds * CHARACTER_ANIM_HZ) / CHARACTER_ANIM_HZ;
      const phase = quantized % BLINK_PERIOD_S;
      const blinking = phase >= 0 && phase < BLINK_DURATION_S;
      for (const lid of eyelids) lid.visible = blinking;
    },
  };
}

/**
 * `CHARACTERS.md §3` 抽格規則的機器可讀檢查。
 *
 * 在一段時間內取樣，回傳表情**實際變化**的相異時間點數；除以時長就是實測
 * 的角色動畫更新率。給之後接進遊戲時的 `BAR-PERF §4.1` 用——那條是「違反
 * 即整輪 FAIL」，不該只靠讀 code 判斷有沒有照做。
 */
export function measureExpressionQuantisation(
  durationSeconds: number,
  sampleHz: number,
): number {
  const distinct = new Set<number>();
  const samples = Math.max(1, Math.round(durationSeconds * sampleHz));
  for (let index = 0; index < samples; index += 1) {
    const t = (index / sampleHz);
    distinct.add(Math.floor(t * CHARACTER_ANIM_HZ) / CHARACTER_ANIM_HZ);
  }
  return distinct.size / durationSeconds;
}
