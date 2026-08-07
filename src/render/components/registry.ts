/**
 * `BAR-VISUAL §4` 的 12 元件登記表。
 *
 * Render harness 只認這張表——沒登記的元件不會被拍，登記了但還沒實作的
 * 會**明確標記為未實作**而不是靜靜消失。這跟 R16 修 perf-probe 是同一個
 * 原則：「還沒做」跟「做了但沒過」必須在產物上分得出來，不能長得一樣。
 */
import type { Group } from 'three';
import { createDriverFace } from '../../characters/driver-face.js';
import { createKartBody } from './kart-body.js';
import { createKartWheel } from './kart-wheels.js';
import { createTrackBarrier } from './track-barriers.js';
import { createTrackSurface } from './track-surface.js';

/** 元件 id 直接沿用 `BAR-VISUAL §4` 的命名，不要另創。 */
export type ComponentId =
  | 'kart-body'
  | 'kart-wheels'
  | 'driver-face'
  | 'track-surface'
  | 'track-barriers'
  | 'foliage'
  | 'skybox-lighting'
  | 'drift-sparks'
  | 'item-boxes'
  | 'shadows-contact'
  | 'water-sea'
  | 'ui-hud';

export interface ComponentEntry {
  id: ComponentId;
  /** `BAR-VISUAL §4` 的範圍描述，原文照抄。 */
  scope: string;
  /** 未實作的元件這裡是 null——harness 會據此標記，不會假裝拍過。 */
  create: (() => Group) | null;
}

export const COMPONENTS: readonly ComponentEntry[] = [
  { id: 'kart-body', scope: '小紅賽車車身 mesh + 黏土材質', create: createKartBody },
  {
    id: 'kart-wheels',
    scope: '輪胎、輪框、形變',
    // 審查用單顆：一顆放大看得到胎面/輪框/壓痕，四顆排開反而每顆都太小。
    // 遊戲用的四顆組合是 `createKartWheelSet()`。
    create: createKartWheel,
  },
  {
    id: 'driver-face',
    scope: '大圓眼 + 笑口，12fps 抽格',
    create: () => createDriverFace().group,
  },
  { id: 'track-surface', scope: '賽道路面材質與接縫', create: createTrackSurface },
  { id: 'track-barriers', scope: '護欄、路緣石', create: createTrackBarrier },
  { id: 'foliage', scope: '樹木、草叢', create: null },
  { id: 'skybox-lighting', scope: '天空與全域柔和均勻光', create: null },
  { id: 'drift-sparks', scope: '漂移特效（黏土屑，非火花）', create: null },
  { id: 'item-boxes', scope: '道具箱與拾取特效', create: null },
  { id: 'shadows-contact', scope: '短柔接地陰影與 AO', create: null },
  { id: 'water-sea', scope: '海面/水面，對齊 map/sea.png', create: null },
  { id: 'ui-hud', scope: 'HUD 的黏土化處理（ck-plumb 範圍）', create: null },
] as const;

export function findComponent(id: string): ComponentEntry | undefined {
  return COMPONENTS.find((entry) => entry.id === id);
}
