/**
 * 元件拍攝流程（瀏覽器端）。
 *
 * `BAR-VISUAL §3` 要四角度，但 `tools/visual/contact-sheet.mjs` 的版面
 * 每個元件只有一格 512×512（`CELL=512`、`2048 = 512×2×2`、`3072 = 512×6`，
 * 12 組每組左右兩格）。**兩邊規格都不改**，這裡兩種都產：
 *
 * - 四張獨立 512×512：`§3` 要求的細看用
 * - 一張 512×512 的 2×2 合成（每格 256×256）：**我們自己審用**
 * - 一張 512×512 的單視角微距：**A/B 對比用**（R31 新增）
 *
 * 前兩項是 R18 的裁決，理由記在 `loop/round-18/TASK.md`。
 *
 * 第三項是 R31 的裁決。在此之前 contact sheet 用的是 2×2 合成，而參考半邊
 * 是實拍微距照——**構圖差異大到只看版面就分得出哪邊是誰**，盲測從未成立；
 * 而且 `§5.0` 的決定性判準在 256×256 的格子裡解析不出來，比較本身也不成立。
 * 詳見 `stage.ts` 的 `AB_FRAMING_MARGIN`。
 *
 * 讀畫布用 `toDataURL` 而不是 CDP 截圖：截圖會受視窗尺寸、DPR、捲動位置
 * 影響，畫布直讀拿到的就是渲染器實際輸出的那 512×512。
 */
import type { Group } from 'three';
import {
  AB_FRAMING_MARGIN,
  AB_VIEW,
  VIEW_ORDER,
  VIEW_SIZE,
  createClayStage,
  mountSubject,
  type ViewName,
} from './stage.js';

/** 合成格裡每個角度佔的邊長：512 / 2。 */
const QUADRANT_SIZE = VIEW_SIZE / 2;

export interface ComponentCapture {
  id: string;
  /** 四角度各一張 PNG data URL。 */
  views: Record<ViewName, string>;
  /** contact sheet 用的 2×2 合成格，PNG data URL。 */
  sheetCell: string;
  /**
   * A/B 對比用的**單視角微距**，512×512，PNG data URL。
   *
   * 跟 `sheetCell` 的差別是這張只有一個角度、主體貼滿畫面。理由見
   * `stage.ts` 的 `AB_FRAMING_MARGIN`——`sheetCell` 把四個角度塞進一格，
   * 每個角度只有 256×256，而 `§5.0` 的判準（指紋、壓棒痕、接縫）在那個
   * 尺度上解析不出來，跟實拍微距照放在一起比是不可比的。
   */
  abCell: string;
}

function createCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('failed to decode captured view'));
    image.src = dataUrl;
  });
}

/**
 * 拍一個元件的全部角度。
 *
 * 每次呼叫都新建拍攝台再丟掉——元件之間不共用 WebGL context，避免上一個
 * 元件殘留的狀態影響下一個。`§3` 要求「所有元件圖必須在同一組條件下
 * 渲染」，乾淨重建比小心清理更容易保證這件事。
 */
export async function captureComponent(id: string, subject: Group): Promise<ComponentCapture> {
  const stage = createClayStage(createCanvas(VIEW_SIZE));
  try {
    mountSubject(stage, subject);

    const views = {} as Record<ViewName, string>;
    for (const view of VIEW_ORDER) {
      stage.setView(view);
      views[view] = stage.capture();
    }

    const sheet = createCanvas(VIEW_SIZE);
    const context = sheet.getContext('2d');
    if (!context) throw new Error('2d context unavailable for contact sheet cell');
    for (const [index, view] of VIEW_ORDER.entries()) {
      const image = await loadImage(views[view]);
      const column = index % 2;
      const row = Math.floor(index / 2);
      context.drawImage(
        image,
        column * QUADRANT_SIZE,
        row * QUADRANT_SIZE,
        QUADRANT_SIZE,
        QUADRANT_SIZE,
      );
    }

    // A/B 對比圖：單視角、貼滿畫面。**最後才拍**，因為它會改動相機構圖，
    // 放在四視角迴圈之前會污染 `views` 與 `sheetCell`。
    stage.setView(AB_VIEW, AB_FRAMING_MARGIN);
    const abCell = stage.capture();

    return { id, views, sheetCell: sheet.toDataURL('image/png'), abCell };
  } finally {
    stage.dispose();
  }
}
