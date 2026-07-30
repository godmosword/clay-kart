/**
 * 接線層：把物理與渲染組起來，並跑固定 tick 迴圈。
 *
 * W1 骨架。此處刻意只定義**介面契約**，不實作任何一邊：
 *   - Codex   在 src/physics/ 實作 SimWorld
 *   - Claude  在 src/render/  實作 Renderer
 *
 * 固定 tick + accumulator 是 BAR-FEEL §2 的決定性要求所在，
 * 渲染的 interpolation 不得回饋進模擬。
 */

/** BAR-FEEL §1.1 常數。改這裡等於改驗收標準 —— 只有 Lead 可以動。 */
export const TICK_HZ = 120;
export const TICK_DT = 1 / TICK_HZ;

/** 每幀最多追幾個 tick，避免分頁切回來時的死亡螺旋。 */
const MAX_TICKS_PER_FRAME = 8;

/** Codex 實作。純資料，不得 import three、不得碰 DOM。 */
export interface SimWorld {
  /** 推進固定一個 tick。dt 恆為 TICK_DT，不接受可變步長。 */
  step(dt: number): void;
  /** 給渲染讀的唯讀快照。 */
  snapshot(): SimSnapshot;
}

export interface SimSnapshot {
  tick: number;
  kart: { pos: [number, number, number]; yaw: number };
}

/** Claude Code 實作。 */
export interface Renderer {
  /** alpha 為 tick 之間的插值係數 [0,1)，僅供視覺平滑，不得寫回模擬。 */
  draw(snap: SimSnapshot, alpha: number): void;
  resize(w: number, h: number): void;
  dispose(): void;
}

export async function bootstrap(mount: HTMLElement): Promise<void> {
  const [{ createWorld }, { createRenderer }] = await Promise.all([
    import('@physics/world'),
    import('@render/renderer'),
  ]);

  const world: SimWorld = createWorld();
  const renderer: Renderer = createRenderer(mount);

  const onResize = () => renderer.resize(mount.clientWidth, mount.clientHeight);
  window.addEventListener('resize', onResize);
  onResize();

  let last = performance.now() / 1000;
  let accumulator = 0;

  const frame = () => {
    const now = performance.now() / 1000;
    accumulator += now - last;
    last = now;

    let ticks = 0;
    while (accumulator >= TICK_DT && ticks < MAX_TICKS_PER_FRAME) {
      world.step(TICK_DT);
      accumulator -= TICK_DT;
      ticks++;
    }
    // 追不上就丟棄積欠，寧可掉格也不要 spiral of death
    if (accumulator >= TICK_DT) accumulator = 0;

    renderer.draw(world.snapshot(), accumulator / TICK_DT);
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}
