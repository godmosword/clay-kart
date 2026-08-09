/**
 * 結算畫面 —— BAR-CONTENT §2.1／§2.2。
 *
 * 這一輪不要求黏土風格（TASK-cursor R36）；沿用 clay-hud 色票即可。
 * 結束判定只讀 `SimSnapshot`：契約沒有 `lap.finished`，
 * physics 的 `#finished` 對外表現是 `splits.length >= total`。
 */
import type { SimSnapshot } from '@contract/sim';
import { HUD_COLORS } from '@ui/clay-hud';
import { fieldStanding, playerStanding } from '@ui/race-standing';

export interface RaceResult {
  update(snap: SimSnapshot): void;
  /** 是否已因玩家完賽而顯示。 */
  isVisible(): boolean;
  dispose(): void;
  elements(): {
    root: HTMLElement;
    restart: HTMLButtonElement;
  };
}

function formatTime(seconds: number): string {
  return seconds.toFixed(2) + 's';
}

function raceFinished(snap: SimSnapshot): boolean {
  const lap = snap.laps[snap.playerIndex];
  if (!lap) return false;
  return lap.splits.length >= lap.total;
}

function totalRaceTime(snap: SimSnapshot): number {
  const lap = snap.laps[snap.playerIndex];
  if (!lap) return 0;
  return lap.splits.reduce((sum, split) => sum + split, 0);
}

export function createRaceResult(
  mount: HTMLElement,
  options: { onRestart: () => void },
): RaceResult {
  if (getComputedStyle(mount).position === 'static') {
    mount.style.position = 'relative';
  }

  const root = document.createElement('div');
  root.dataset.role = 'race-result';
  root.hidden = true;
  root.setAttribute('aria-hidden', 'true');
  // 初始必須是 display:none——inline display:flex 會蓋掉 hidden 屬性，
  // 讓 check-ui-hud 把結算層誤判成外來 overlay。
  root.style.cssText = [
    'position:absolute',
    'inset:0',
    'z-index:20',
    'display:none',
    'align-items:center',
    'justify-content:center',
    'background:rgba(40, 32, 24, 0.55)',
    'pointer-events:auto',
  ].join(';');

  const panel = document.createElement('div');
  panel.dataset.role = 'race-result-panel';
  panel.style.cssText = [
    'background:' + HUD_COLORS.board,
    'color:' + HUD_COLORS.number,
    'border:2px solid #d4c4a4',
    'box-shadow:3px 3px 0 #c4b494',
    'border-radius:12px',
    'padding:16px 20px',
    'min-width:220px',
    'max-width:min(92vw, 320px)',
    'font:700 14px/1.35 "Avenir Next Rounded", "Nunito", "Segoe UI", sans-serif',
    'display:flex',
    'flex-direction:column',
    'gap:10px',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = 'FINISH';
  title.style.cssText = 'letter-spacing:0.08em;font-size:12px;opacity:0.85;';

  const place = document.createElement('div');
  place.dataset.role = 'race-result-place';
  place.style.cssText = 'font-size:28px;font-weight:800;';

  const totalTime = document.createElement('div');
  totalTime.dataset.role = 'race-result-total-time';

  const bestLap = document.createElement('div');
  bestLap.dataset.role = 'race-result-best-lap';

  const standings = document.createElement('ol');
  standings.dataset.role = 'race-result-standings';
  standings.style.cssText = [
    'list-style:none',
    'margin:0',
    'padding:0',
    'display:flex',
    'flex-direction:column',
    'gap:4px',
    'font-size:13px',
  ].join(';');

  const restart = document.createElement('button');
  restart.dataset.role = 'race-result-restart';
  restart.type = 'button';
  restart.textContent = '重新開始';
  restart.style.cssText = [
    'margin-top:4px',
    'appearance:none',
    'border:2px solid #d4c4a4',
    'background:' + HUD_COLORS.number,
    'color:' + HUD_COLORS.board,
    'border-radius:8px',
    'padding:8px 12px',
    'font:800 14px/1 "Avenir Next Rounded", "Nunito", "Segoe UI", sans-serif',
    'cursor:pointer',
  ].join(';');
  restart.addEventListener('click', (event) => {
    event.preventDefault();
    options.onRestart();
  });

  panel.append(title, place, totalTime, bestLap, standings, restart);
  root.appendChild(panel);
  mount.appendChild(root);

  let visible = false;

  const render = (snap: SimSnapshot): void => {
    const standing = playerStanding(snap);
    const lap = snap.laps[snap.playerIndex];
    place.textContent = `${standing.place}/${standing.field}`;
    totalTime.textContent = `TOTAL ${formatTime(totalRaceTime(snap))}`;
    bestLap.textContent =
      lap?.bestTime === null || lap?.bestTime === undefined
        ? 'BEST --'
        : `BEST ${formatTime(lap.bestTime)}`;

    standings.replaceChildren();
    for (const entry of fieldStanding(snap)) {
      const li = document.createElement('li');
      li.dataset.place = String(entry.place);
      li.dataset.character = entry.characterId;
      if (entry.isPlayer) li.dataset.player = 'true';
      li.textContent = `${entry.place}. ${entry.characterId}${entry.isPlayer ? ' (YOU)' : ''}`;
      if (entry.isPlayer) {
        li.style.color = HUD_COLORS.alert;
        li.style.fontWeight = '800';
      }
      standings.appendChild(li);
    }
  };

  return {
    update(snap: SimSnapshot): void {
      if (!raceFinished(snap)) {
        if (visible) {
          root.hidden = true;
          root.style.display = 'none';
          root.setAttribute('aria-hidden', 'true');
          visible = false;
        }
        return;
      }
      render(snap);
      if (!visible) {
        root.hidden = false;
        root.style.display = 'flex';
        root.setAttribute('aria-hidden', 'false');
        visible = true;
      }
    },
    isVisible(): boolean {
      return visible;
    },
    dispose(): void {
      root.remove();
    },
    elements() {
      return { root, restart };
    },
  };
}

/** 給 bootstrap／檢查共用：玩家是否已完賽（契約面代理）。 */
export function isPlayerRaceFinished(snap: SimSnapshot): boolean {
  return raceFinished(snap);
}
