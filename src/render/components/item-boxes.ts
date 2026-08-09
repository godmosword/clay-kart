/**
 * `BAR-VISUAL §4` 元件 #9：`item-boxes`——道具箱本體與拾取特效。
 *
 * `§5.9` 逐條：
 *
 * | 條款 | 這裡怎麼做 |
 * |---|---|
 * | 六面壓合的黏土方塊，邊角圓潤、面上有壓痕 | `claySlab` + `applyHandPressedRelief` |
 * | 拾取時**捏開成幾塊**再消失，不是爆炸不是溶解 | 箱子從頭到尾就是四塊，平常對齊成一個立方體 |
 * | car-park 五色點綴輪流，不固定單一色 | `BOX_COLOURS` 依索引輪替，至少用滿 5 色 |
 * | 箱高 / 車高 落在 `0.5 ± 0.1` | `BOX_SIZE / CAR_HEIGHT = 0.65 / 1.3 = 0.5` |
 * | 浮空緩慢自轉，**60fps 不抽格** | `setTime()` 吃連續時間，不做任何量化 |
 * | 倒角半徑 ≥ `§6` 下限 | `claySlab` 預設走 `HAND_PRESSED_RATIO`（0.34），遠高於下限 |
 *
 * ## 為什麼箱子從一開始就是四塊
 *
 * 「捏開成幾塊」如果做成拾取當下把整塊換成碎塊，需要兩套幾何、兩次上傳，
 * 而且切換的那一幀容易看到跳動。改成**平常就是四塊、只是貼合在一起**，
 * 拾取動畫就只是把它們推開——沒有幾何切換，也自然讀成「本來就是捏合的」。
 *
 * 代價是 draw call：四塊而不是一塊。所以四塊各自是一個 `InstancedMesh`，
 * **總共四次 draw call，與箱子數量無關**。`BAR-PERF §5.3` 目前已經超標
 * （174/150，見 BACKLOG），這個元件不該再讓它更糟。
 */
import {
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Object3D,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { applyHandPressedRelief, claySlab } from '../clay/geometry.js';
import { createClayMaterial } from '../clay/material.js';
import { CAR_PARK } from '../clay/palette.js';

/**
 * 箱子的邊長。
 *
 * `§5.9` 要求「約半個車高」，量化條款是 `箱高 / 車高 = 0.5 ± 0.1`。
 * 整車原點在地面、車頂約 `1.3`（見 `renderer.ts` 的相機註解），
 * 所以 `0.65` 讓比值正好是 `0.50`。
 */
const BOX_SIZE = 0.65;

/** 對照用的車高。改動時要跟 `kart-body` 的實際輪廓對齊。 */
export const REFERENCE_CAR_HEIGHT = 1.3;

/** 浮空高度（箱子中心離地）。約一個箱高，讓車從底下看得到它浮著。 */
const HOVER_Y = 0.95;

/** 上下浮動的幅度與週期。緩慢——`§5.0` 的調性不要有急促的東西。 */
const BOB_AMPLITUDE = 0.07;
const BOB_PERIOD_S = 2.6;

/** 自轉速度（弧度／秒）。`§5.9` 明文「緩慢自轉」。 */
const SPIN_RATE = 0.7;

/**
 * `§5.9` 的五個點綴色，依箱子索引輪替。
 *
 * **條款要求「不固定單一色」且至少用滿 5 色**，所以只要場上箱子數 ≥ 5，
 * 機械檢查就會看到五種都出現。少於 5 個箱子時仍然是輪替的，
 * 但那時條款判不到——這是呼叫端要保證的事，不是這裡。
 */
const BOX_COLOURS = [
  CAR_PARK.accentPink,
  CAR_PARK.accentYellow,
  CAR_PARK.accentGreen,
  CAR_PARK.accentBlue,
  CAR_PARK.accentLavender,
] as const;

/**
 * 四塊的相對位置（單位為半個箱子）。
 *
 * 沿 X 與 Z 各切一刀，Y 不切——從賽車的視角（略高、看前方）
 * 水平切線比垂直切線更容易看到，捏開的時候散得比較清楚。
 */
const CHUNK_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [1, -1], [-1, 1], [1, 1],
];

/** 拾取動畫長度（秒）。短——`§5.0` 不要有拖沓的特效。 */
const POP_DURATION_S = 0.42;

/**
 * 靜止時四塊的貼合程度。`1` 是剛好對齊，`<1` 是互相嵌入。
 *
 * `0.88` 讓內縫被兩側的倒角吃掉，外觀是一整塊；外緣因此從 `0.325` 縮到
 * `0.3081`，箱高 `0.616`，`箱高/車高 = 0.474` 仍在 `§5.9` 的 `0.5 ± 0.1` 內。
 */
const REST_OVERLAP = 0.88;

/** 捏開時四塊往外推的距離，單位為箱子邊長。 */
const POP_SPREAD = 1.6;

export interface ItemBoxField {
  group: Group;
  /**
   * 每幀呼叫，傳入連續時間（秒）。
   *
   * **不要在呼叫端做量化。** `§5.9` 明文「自轉屬物件不是角色，60fps 不抽格」
   * ——角色表情走 `CHARACTERS.md §3` 的 12fps，箱子不走。
   */
  setTime(seconds: number): void;
  /**
   * 標記某個箱子被拾取。`atSeconds` 是拾取當下的時間，
   * 動畫從那裡開始算。傳同一個索引兩次不會重播。
   */
  pick(index: number, atSeconds: number): void;
  /** 箱子重生（冷卻結束）。 */
  respawn(index: number): void;
  /** 給機械檢查讀的比例，可以直接對 `§5.9` 的條款核。 */
  readonly proportions: {
    boxSize: number;
    boxHeightOverCarHeight: number;
    distinctColours: number;
    chunksPerBox: number;
  };
}

function chunkGeometry(): BufferGeometry {
  // 每塊是**四分之一根柱子**：X／Z 各切一刀，Y 不切（見 `CHUNK_OFFSETS`）。
  // 第一版這裡三軸都給 `BOX_SIZE / 2`，四塊拼起來是
  // `0.65 × 0.325 × 0.65` 的扁板不是方塊——註解寫對了，實作寫錯了。
  const half = BOX_SIZE / 2;
  // `bevelRatio` 用預設的 `HAND_PRESSED_RATIO`（0.34）——`§5.9` 要「邊角圓潤」，
  // 而 `§6` 的下限 0.015 只是防呆，不是目標。
  //
  // `segments: 8` 是承載壓痕的最低密度。R34 的教訓：我一度為了起伏設到 24，
  // 那是每塊 28,812 三角形——而這裡有 4 塊 × N 個箱子。8 是 3,468。
  // 倒角用 0.12 而不是預設的 `HAND_PRESSED_RATIO`（0.34）。
  // 0.34 對「四塊拼成一個方塊」太圓——第一版拍出來四塊讀成四顆分開的球，
  // 完全不像 `§5.9` 要的「捏出來的積木」。0.12 仍遠高於 `§6` 的下限 0.015。
  const geometry = claySlab(half, BOX_SIZE, half, { segments: 8, bevelRatio: 0.12 });
  // **波長必須對齊物件尺度。** R34 量出來的：波長遠大於物件時，噪音場在
  // 物件範圍內退化成常數，結果是整塊等比膨脹而不是起伏。
  // 這裡 `size = 0.325`，取 1/4 約 0.08。`applyHandPressedRelief` 現在有守衛
  // 會擋住退化的參數，所以這個數字若寫錯會直接丟例外，不會靜靜變成平面。
  return applyHandPressedRelief(geometry, { amplitude: 0.008, wavelength: 0.08 });
}

/**
 * 建立一組道具箱。
 *
 * @param positions 每個箱子的世界座標（Y 由這裡決定，傳入的 Y 會被忽略）
 */
export function createItemBoxes(
  positions: ReadonlyArray<readonly [number, number]>,
): ItemBoxField {
  const group = new Group();
  group.name = 'item-boxes';

  const count = positions.length;
  const geometry = chunkGeometry();

  // 一個 `InstancedMesh` 對應一個角落，所以四次 draw call 涵蓋所有箱子。
  // 顏色走 per-instance color，材質只要一份。
  // **不要設 `vertexColors: true`。** `InstancedMesh` 的逐 instance 顏色走
  // `instanceColor`，three.js 會自己開 `USE_INSTANCING_COLOR`；額外設
  // `vertexColors` 反而讓 shader 去找 geometry 上不存在的 `color` 屬性，
  // 算繪結果是全黑。第一版就是這樣，五個箱子拍出來是五坨黑塊。
  //
  // ⚠ 但這條路徑**確實繞過 `§6` 的顏色夾制**——`clampAwayFromPure()` 只作用
  // 在 `color` 參數上，`instanceColor` 是直接寫進 buffer 的。所以
  // `BOX_COLOURS` 只准用 `clay/palette.ts` 的 token，那些本來就照 §6 挑過。
  const material: Material = createClayMaterial({
    color: 0xffffff,
    textureScale: 4,
  });

  const meshes: InstancedMesh[] = CHUNK_OFFSETS.map(() => {
    const mesh = new InstancedMesh(geometry, material, Math.max(1, count));
    mesh.castShadow = true;
    mesh.name = 'item-box-chunk';
    group.add(mesh);
    return mesh;
  });

  // 每個箱子一個顏色，依索引輪替五色。
  const colour = new Color();
  for (let i = 0; i < count; i++) {
    colour.setHex(BOX_COLOURS[i % BOX_COLOURS.length]!);
    for (const mesh of meshes) mesh.setColorAt(i, colour);
  }
  for (const mesh of meshes) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  /** 每個箱子的拾取時間；`null` 代表在場上。 */
  const pickedAt: Array<number | null> = new Array(count).fill(null);

  const dummy = new Object3D();
  const matrix = new Matrix4();
  const hidden = new Matrix4().makeScale(0, 0, 0);
  const spinAxis = new Vector3(0.18, 1, 0.1).normalize();
  const spin = new Quaternion();

  const field: ItemBoxField = {
    group,

    setTime(seconds: number): void {
      for (let i = 0; i < count; i++) {
        const [px, pz] = positions[i]!;
        const picked = pickedAt[i] ?? null;
        // 每個箱子的浮動相位錯開，整排同步上下會很機械。
        const phase = (seconds / BOB_PERIOD_S + i * 0.37) * Math.PI * 2;
        const baseY = HOVER_Y + Math.sin(phase) * BOB_AMPLITUDE;
        spin.setFromAxisAngle(spinAxis, seconds * SPIN_RATE + i * 0.9);

        // 拾取進度 [0, 1]；超過 1 就是已經消失，等 respawn。
        const t = picked === null ? 0 : Math.min(1, (seconds - picked) / POP_DURATION_S);

        for (let c = 0; c < meshes.length; c++) {
          const mesh = meshes[c]!;
          if (picked !== null && t >= 1) {
            mesh.setMatrixAt(i, hidden);
            continue;
          }
          const [ox, oz] = CHUNK_OFFSETS[c]!;
          // 平常四塊貼合成一個立方體；拾取後沿各自的對角線推開並縮小。
          // **推開＋縮小＝「捏開成幾塊再消失」**，不是爆炸（沒有隨機方向、
          // 沒有加速度）也不是溶解（沒有透明度變化）。
          // 靜止時讓四塊**略為互相嵌入**（`REST_OVERLAP`），不是剛好對齊。
          // 剛好對齊時每條內縫都露出兩個倒角，箱子讀成禮物盒而不是一整塊；
          // 而 `§5.9` 要的是「捏出來的積木」——靜止是一塊，捏開才分家。
          const spread = (BOX_SIZE / 4) * REST_OVERLAP + t * BOX_SIZE * POP_SPREAD;
          const scale = 1 - t;
          dummy.position.set(px + ox * spread, baseY + t * 0.35, pz + oz * spread);
          dummy.quaternion.copy(spin);
          dummy.scale.setScalar(scale);
          dummy.updateMatrix();
          matrix.copy(dummy.matrix);
          mesh.setMatrixAt(i, matrix);
        }
      }
      for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
    },

    pick(index: number, atSeconds: number): void {
      if (index < 0 || index >= count) return;
      if (pickedAt[index] !== null) return;
      pickedAt[index] = atSeconds;
    },

    respawn(index: number): void {
      if (index < 0 || index >= count) return;
      pickedAt[index] = null;
    },

    proportions: {
      boxSize: BOX_SIZE,
      boxHeightOverCarHeight: (BOX_SIZE / 2 * (1 + REST_OVERLAP)) / REFERENCE_CAR_HEIGHT,
      distinctColours: Math.min(count, BOX_COLOURS.length),
      chunksPerBox: CHUNK_OFFSETS.length,
    },
  };

  // **建立當下就擺好初始姿態。**
  //
  // 少了這行，所有 instance 停在單位矩陣、全部疊在原點——而
  // `BAR-VISUAL §3` 的拍攝台只呼叫 `create()` 不呼叫 `setTime()`，
  // 所以元件圖會拍到一坨疊在一起的方塊。第一版就是這樣，
  // 五個箱子拍出來是一個。
  field.setTime(0);
  return field;
}
