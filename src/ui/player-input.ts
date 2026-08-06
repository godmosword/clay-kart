/**
 * 玩家輸入 —— 鍵盤與觸控共用同一份狀態，經 InputSource.poll() 取樣。
 *
 * 約束（loop/round-2/TASK-cursor.md）：
 * - 事件監聽器只更新狀態，絕不直接呼叫 world.setInput()
 * - poll() 無副作用，只讀當下狀態
 * - 放開必須明確送 0 / false（WorldInput 未提供欄位會保留前值）
 */
import type { InputSource, WorldInput } from '@loader/bootstrap';

type Action = 'throttle' | 'brake' | 'steerLeft' | 'steerRight' | 'reverse' | 'jump' | 'drift';

/**
 * 「畫面往左轉」對應的 `WorldInput.steer` 值。
 *
 * **這個 `+1` 看起來反了，但它是對的**，理由見 `@contract/sim` 的
 * `WorldInput.steer`：規範定義是 `steer > 0` 使 `yaw` 增加，而
 * `forward = (sin yaw, cos yaw)` 加上追尾相機沿 `+forward` 看出去時，
 * three.js 右手座標系讓 `+X` 落在**畫面左側**——所以 yaw 增加在畫面上是左轉。
 *
 * 契約明文把「哪個按鍵是右轉」劃給輸入層，這裡就是那個翻譯點，
 * 而且是**唯一**一個：模擬側與 AI 側都只認 yaw，不認畫面。
 *
 * R20 之前這裡寫反（`ArrowRight → +1`），效果是按 → 車子往畫面左邊轉。
 * 當時沒抓到是因為 W1 的驗證只確認「送鍵盤事件後 yaw 真的改變」，
 * 驗的是有沒有變，不是往哪邊變；而遊戲畫面直到 R20 才第一次被拍下來。
 *
 * 改這兩個常數的符號 = 改玩家的操作方向。要改之前先讀契約那段，
 * 確認你要改的是「按鍵對應」而不是「模擬語意」——後者不在這一層。
 */
const STEER_SCREEN_LEFT = 1;
const STEER_SCREEN_RIGHT = -1;

const KEY_TO_ACTION: Readonly<Record<string, Action>> = {
  ArrowUp: 'throttle',
  KeyW: 'throttle',
  ArrowDown: 'brake',
  KeyS: 'brake',
  ArrowLeft: 'steerLeft',
  KeyA: 'steerLeft',
  ArrowRight: 'steerRight',
  KeyD: 'steerRight',
  ShiftLeft: 'reverse',
  ShiftRight: 'reverse',
  KeyR: 'reverse',
  Space: 'jump',
  // Ctrl：可與 WASD／方向鍵同按，滿足 drift && |steer|>0 進入條件
  ControlLeft: 'drift',
  ControlRight: 'drift',
};

const TOUCH_BUTTONS: ReadonlyArray<{ action: Action; label: string; zone: 'left' | 'right' }> = [
  // 左區：轉向 + 漂移（漂移必須搭配轉向，放同側方便幼童拇指同按）
  { action: 'steerLeft', label: '←', zone: 'left' },
  { action: 'steerRight', label: '→', zone: 'left' },
  { action: 'drift', label: '漂', zone: 'left' },
  { action: 'jump', label: '跳', zone: 'right' },
  { action: 'reverse', label: '倒', zone: 'right' },
  { action: 'brake', label: '煞', zone: 'right' },
  { action: 'throttle', label: '油', zone: 'right' },
];

export interface PlayerInput extends InputSource {
  dispose(): void;
}

/**
 * 建立讀鍵盤／觸控的 InputSource，並把觸控墊掛到 mount 上。
 * mount 僅用於掛 DOM；取樣仍只經由 poll()。
 */
export function createPlayerInput(mount: HTMLElement): PlayerInput {
  const held = new Set<Action>();

  const press = (action: Action): void => {
    held.add(action);
  };
  const release = (action: Action): void => {
    held.delete(action);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const action = KEY_TO_ACTION[event.code];
    if (action === undefined) return;
    if (!event.repeat) press(action);
    event.preventDefault();
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    const action = KEY_TO_ACTION[event.code];
    if (action === undefined) return;
    release(action);
    event.preventDefault();
  };
  const onBlur = (): void => {
    held.clear();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  // 桌機（fine pointer + hover）不掛觸控鈕——會吃掉視覺審查截圖的畫面。
  // iPad：pointer:coarse / hover:none → 掛上。
  const overlay = shouldShowTouchControls() ? buildTouchOverlay(press, release) : null;
  if (overlay) {
    if (getComputedStyle(mount).position === 'static') {
      mount.style.position = 'relative';
    }
    mount.appendChild(overlay);
  }

  // advance() 每 tick 同步讀完就丟——重用同一份，避免 120Hz 每秒 120 次配置。
  const polled: {
    throttle: number;
    steer: number;
    brake: boolean;
    reverse: boolean;
    jump: boolean;
    drift: boolean;
  } = {
    throttle: 0,
    steer: 0,
    brake: false,
    reverse: false,
    jump: false,
    drift: false,
  };

  return {
    poll(_tickIndex: number): WorldInput {
      // 每次寫滿完整欄位，避免「停止傳送」被誤解成維持前值
      const steerLeft = held.has('steerLeft');
      const steerRight = held.has('steerRight');
      let steer = 0;
      if (steerLeft && !steerRight) steer = STEER_SCREEN_LEFT;
      else if (steerRight && !steerLeft) steer = STEER_SCREEN_RIGHT;

      polled.throttle = held.has('throttle') ? 1 : 0;
      polled.steer = steer;
      polled.brake = held.has('brake');
      polled.reverse = held.has('reverse');
      polled.jump = held.has('jump');
      polled.drift = held.has('drift');
      return polled;
    },
    dispose(): void {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      overlay?.remove();
      held.clear();
    },
  };
}

/** 主要目標是 iPad；桌機鍵盤已足夠，掛 overlay 只會污染截圖。 */
function shouldShowTouchControls(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return (
    window.matchMedia('(pointer: coarse)').matches ||
    window.matchMedia('(hover: none)').matches
  );
}

function buildTouchOverlay(
  press: (action: Action) => void,
  release: (action: Action) => void,
): HTMLElement {
  const root = document.createElement('div');
  root.dataset.role = 'touch-controls';
  root.style.cssText = [
    'position:absolute',
    'inset:0',
    'z-index:10',
    'pointer-events:none',
    'display:flex',
    'justify-content:space-between',
    'align-items:flex-end',
    'padding:max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left))',
    'gap:16px',
    'user-select:none',
    '-webkit-user-select:none',
    'touch-action:none',
  ].join(';');

  const left = document.createElement('div');
  const right = document.createElement('div');
  for (const el of [left, right]) {
    // 按鈕加大間距，避免 3–7 歲誤觸相鄰鍵
    el.style.cssText =
      'display:flex;gap:14px;pointer-events:none;flex-wrap:wrap;max-width:260px;';
  }

  for (const { action, label, zone } of TOUCH_BUTTONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.setAttribute('aria-label', action);
    btn.style.cssText = [
      'pointer-events:auto',
      'width:80px',
      'height:80px',
      'font-size:24px',
      'font-weight:700',
      'border:2px solid rgba(0,0,0,0.35)',
      'border-radius:12px',
      'background:rgba(255,255,255,0.55)',
      'color:#111',
      'touch-action:none',
      '-webkit-tap-highlight-color:transparent',
    ].join(';');

    // pointer 事件同時覆蓋滑鼠與觸控；用 pointerId 追蹤，避免多指錯亂
    const activePointers = new Set<number>();
    const down = (event: PointerEvent): void => {
      event.preventDefault();
      btn.setPointerCapture(event.pointerId);
      activePointers.add(event.pointerId);
      press(action);
      btn.style.background = 'rgba(255,255,255,0.85)';
    };
    const up = (event: PointerEvent): void => {
      if (!activePointers.delete(event.pointerId)) return;
      if (activePointers.size === 0) {
        release(action);
        btn.style.background = 'rgba(255,255,255,0.55)';
      }
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', up);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());

    (zone === 'left' ? left : right).appendChild(btn);
  }

  root.appendChild(left);
  root.appendChild(right);
  return root;
}
