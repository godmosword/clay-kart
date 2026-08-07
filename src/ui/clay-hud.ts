/**
 * ui-hud —— 黏土化圈數／計時／名次牌（BAR-VISUAL §5.12，機械驗收 §1.3）。
 *
 * 可機械判定：底板 `#f0e4cd`、數字 `#3a5f96`、告警 `#ff8c2b`；
 * 禁純白底、禁半透明（opacity=1、無 backdrop-filter）；
 * 底板短邊 / 畫面短邊 ≤ 1/8（R28：實作目標 ≤ 0.11，留約 12% 餘裕）。
 *
 * 「數字是壓上去的獨立黏土不是描邊字型」§1.3 明文判不到——這裡用實色字
 * + 短硬陰影逼近壓印感，不冒充可程式驗收。
 */
import type { SimSnapshot } from '@loader/bootstrap';
import { playerStanding } from '@ui/race-standing';

/** §5.12 / §1.3 寫死的色票。改這裡等於改驗收標準——不要「調好看一點」。 */
export const HUD_COLORS = {
  board: '#f0e4cd',
  number: '#3a5f96',
  alert: '#ff8c2b',
} as const;

/**
 * 底板相對畫面短邊的硬上限（機械驗收）。
 * §1.3 寫 ≤ 1/8；R28 要求先拉開餘裕再加列，實作鎖在 0.11。
 */
export const HUD_MAX_SHORT_RATIO = 0.11;

export interface ClayHud {
  update(snap: SimSnapshot): void;
  resize(): void;
  dispose(): void;
  /** 機械檢查用：底板與各文字節點。 */
  elements(): {
    root: HTMLElement;
    board: HTMLElement;
    values: HTMLElement[];
    labels: HTMLElement[];
    alert: HTMLElement;
  };
}

function formatTime(seconds: number): string {
  return seconds.toFixed(2) + 's';
}

/**
 * 隱藏 mount 上非本元件、非 canvas、非觸控墊的裸 div——
 * 用來蓋掉 `src/render/renderer.ts` 的 W1 monospace HUD（render 範圍，
 * Cursor 不能改那支檔，只能從自己這邊把它藏起來）。
 */
function hideForeignOverlays(mount: HTMLElement): void {
  for (const child of Array.from(mount.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.tagName === 'CANVAS') continue;
    const role = child.dataset.role;
    if (role === 'clay-hud' || role === 'touch-controls') continue;
    child.style.display = 'none';
    child.setAttribute('aria-hidden', 'true');
  }
}

export function createClayHud(mount: HTMLElement): ClayHud {
  if (getComputedStyle(mount).position === 'static') {
    mount.style.position = 'relative';
  }

  const root = document.createElement('div');
  root.dataset.role = 'clay-hud';
  root.style.cssText = [
    'position:absolute',
    'top:max(8px, env(safe-area-inset-top))',
    'left:max(8px, env(safe-area-inset-left))',
    'z-index:5',
    'pointer-events:none',
    'opacity:1',
  ].join(';');

  const board = document.createElement('div');
  board.dataset.role = 'clay-hud-board';
  board.style.cssText = [
    'background:' + HUD_COLORS.board,
    'opacity:1',
    'border-radius:10px',
    'padding:5px 9px',
    'box-sizing:border-box',
    // 實色邊 + 短硬陰影：厚牌感，不是玻璃／半透明
    'border:2px solid #d4c4a4',
    'box-shadow:2px 2px 0 #c4b494',
    'display:flex',
    'flex-direction:column',
    'gap:2px',
    'min-width:0',
  ].join(';');

  const mkRow = (labelText: string, alert = false) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:baseline;gap:6px;opacity:1;';

    const label = document.createElement('span');
    label.dataset.role = alert ? 'clay-hud-alert' : 'clay-hud-label';
    label.textContent = labelText;
    label.style.cssText = [
      'font:700 9px/1.15 "Avenir Next Rounded", "Nunito", "Segoe UI", sans-serif',
      'color:' + (alert ? HUD_COLORS.alert : HUD_COLORS.number),
      'opacity:1',
      'letter-spacing:0.04em',
      // 短硬陰影＝壓印，不用大模糊（那會像玻璃描邊）
      'text-shadow:1px 1px 0 #c4b494',
    ].join(';');

    const value = document.createElement('span');
    value.dataset.role = 'clay-hud-value';
    value.style.cssText = [
      'font:800 13px/1.1 "Avenir Next Rounded", "Nunito", "Segoe UI", sans-serif',
      'color:' + HUD_COLORS.number,
      'opacity:1',
      'text-shadow:1px 1px 0 #c4b494',
      'font-variant-numeric:tabular-nums',
    ].join(';');

    row.append(label, value);
    return { row, label, value };
  };

  // 順序：先縮小餘裕（字級／padding），再加名次列——見 R28 TASK 三。
  const lap = mkRow('LAP');
  const time = mkRow('TIME');
  const pos = mkRow('POS');
  const best = mkRow('BEST', true);

  board.append(lap.row, time.row, pos.row, best.row);
  root.appendChild(board);
  mount.appendChild(root);
  hideForeignOverlays(mount);

  const fitBoard = (): void => {
    const shortSide = Math.min(mount.clientWidth || 1, mount.clientHeight || 1);
    const maxShort = Math.floor(shortSide * HUD_MAX_SHORT_RATIO);
    board.style.maxHeight = Math.max(32, maxShort) + 'px';
    board.style.maxWidth = Math.min(Math.floor(shortSide * 0.5), 180) + 'px';
    // 內容若撐破，縮字——寧可小也不准超過目標比
    const boardShort = Math.min(board.offsetWidth, board.offsetHeight);
    if (boardShort > maxShort && maxShort > 0) {
      const scale = maxShort / boardShort;
      board.style.transform = `scale(${scale})`;
      board.style.transformOrigin = 'top left';
    } else {
      board.style.transform = '';
    }
  };

  // 首次 layout 後量尺寸
  requestAnimationFrame(fitBoard);

  return {
    update(snap: SimSnapshot): void {
      const lapState = snap.laps[snap.playerIndex];
      if (!lapState) return;
      lap.value.textContent = `${Math.min(lapState.current, lapState.total)}/${lapState.total}`;
      time.value.textContent = formatTime(lapState.currentTime);
      const standing = playerStanding(snap);
      pos.value.textContent = `${standing.place}/${standing.field}`;
      best.value.textContent =
        lapState.bestTime === null ? '--' : formatTime(lapState.bestTime);
    },
    resize(): void {
      fitBoard();
      hideForeignOverlays(mount);
    },
    dispose(): void {
      root.remove();
    },
    elements() {
      return {
        root,
        board,
        values: [lap.value, time.value, pos.value, best.value],
        labels: [lap.label, time.label, pos.label, best.label],
        alert: best.label,
      };
    },
  };
}
