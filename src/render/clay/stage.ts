/**
 * `BAR-VISUAL §3` 拍攝規範的實體。
 *
 * | 項目 | 規範 |
 * |---|---|
 * | 角度 | 四角度：front / 3-4 front-left / side / top |
 * | 解析度 | 每格 512×512，contact sheet 2048×3072 |
 * | 光照 | 柔和均勻漫射，依 §5.0。**禁止逐元件調光** |
 * | 背景 | `#8a8a8a` 中性灰，無漸層 |
 * | 後製 | 禁止。無 bloom、無 color grade、無 AO 強化 |
 *
 * 「所有元件圖必須在同一組條件下渲染，否則評分不可比」——所以構圖用
 * **自動框定**（依包圍球算距離），大件小件在畫面裡佔的比例才會一致。
 * 一個輪子跟一台車身若各自手調距離，critic 看到的差異會混入構圖噪音。
 *
 * 接地陰影用 `ShadowMaterial` 的透明承接面，不放實體地板——`§3` 要求
 * 背景是無漸層的純中性灰，擺一塊地板就會多出一條地平線。
 */
import {
  Box3,
  Color,
  Group,
  MathUtils,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Mesh,
  Scene,
  ShadowMaterial,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three';
import { STAGE_BACKGROUND, TERRAIN } from './palette.js';
import { applyClayRenderSettings, createClayLighting, enableClayShadows } from './lighting.js';

/** `§3`：每格 512×512。 */
export const VIEW_SIZE = 512;

/** `§3` 的四角度。名稱直接對應規範用語，不要另創命名。 */
export type ViewName = 'front' | 'three-quarter-front-left' | 'side' | 'top';

export const VIEW_ORDER: readonly ViewName[] = [
  'front',
  'three-quarter-front-left',
  'side',
  'top',
] as const;

/**
 * 相機方位。專案慣例是 forward = `(sin(yaw), cos(yaw))`，yaw=0 時車頭朝
 * `+Z`；車自身的左側因此是 `+X`（right = forward × up = Z × Y = −X）。
 * 所以「front-left」= 從 `+Z`（正面）偏向 `+X`（左側）。
 */
const VIEW_ANGLES: Record<ViewName, { azimuthDeg: number; elevationDeg: number }> = {
  front: { azimuthDeg: 0, elevationDeg: 12 },
  'three-quarter-front-left': { azimuthDeg: 42, elevationDeg: 22 },
  side: { azimuthDeg: 90, elevationDeg: 10 },
  top: { azimuthDeg: 0, elevationDeg: 89.5 },
};

/** 視野。`§0.5` 的 50–60° 是給遊戲內追尾相機的，元件照走窄一點更少透視變形。 */
const FOV_DEG = 34;

/** 包圍球外的留白倍率。四個角度共用，構圖才可比。 */
const FRAMING_MARGIN = 1.28;

/**
 * A/B 對比圖專用的構圖餘裕。**刻意比 `FRAMING_MARGIN` 緊。**
 *
 * R31 的三個 critic 各自指出同一件事:對比表的兩個半邊構圖完全不同——我們那半
 * 是 `#8a8a8a` 灰底上的**四視角合成**(每個角度只佔 256×256,也就是整格的
 * 四分之一),參考那半是**實拍微距照**,主體佔滿畫面。
 *
 * 後果有兩層:
 *
 * 1. **只看構圖就 100% 分得出哪邊是誰**,盲測根本不成立
 * 2. 更糟的是比較本身失去意義——`§5.0` 的決定性判準(指紋、壓棒痕、接縫)
 *    **只有在微距下才解析得出來**,而我們把四個物件塞進 1/8 畫面,
 *    等於要求它在解析不出表面工藝的尺度上證明表面工藝
 *
 * `§3` 明文「所有元件圖必須在同一組條件下渲染,否則評分不可比」,R31 的
 * 五個有內容的格子**沒有一格滿足**。
 *
 * 裁決(R31):**兩種圖拆開**。`§3` 的四視角規範圖留給我們自己審(元件從各角度
 * 成不成立),A/B 對比另外產一張單視角微距,構圖對齊參考半邊。
 */
export const AB_FRAMING_MARGIN = 1.02;

/**
 * A/B 對比圖用哪個角度。
 *
 * 三四分之一視角同時看得到正面與側面,是六張參考照裡最常見的取角;
 * 正面視角會讓側裙、接縫這類 `§5.1` 明文要求的東西完全看不到。
 */
export const AB_VIEW: ViewName = 'three-quarter-front-left';

/** 接地陰影的不透明度。`§5.0` 要「低對比」，這個值刻意壓得很淡。 */
const CONTACT_SHADOW_OPACITY = 0.26;

export interface ClayStage {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  /** 元件掛載點。換元件時清空這個 group，不要動場景其他部分。 */
  subject: Group;
  /**
   * 把相機擺到指定角度並重新框定構圖。
   *
   * `marginOverride` 用來產 A/B 對比圖——那張要貼滿畫面才跟實拍微距照
   * 可比（見 `AB_FRAMING_MARGIN`）。省略時用 `§3` 規範圖的餘裕。
   */
  setView(view: ViewName, marginOverride?: number): void;
  /** 算繪一張並回傳 PNG data URL（512×512）。 */
  capture(): string;
  dispose(): void;
}

/**
 * 建立 `§3` 規範的拍攝台。
 *
 * @param canvas 目標畫布。harness 會傳一個 512×512 的離屏畫布。
 */
export function createClayStage(canvas: HTMLCanvasElement): ClayStage {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    // toDataURL 需要保留 buffer，否則讀到空白。
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(VIEW_SIZE, VIEW_SIZE, false);
  applyClayRenderSettings(renderer);

  const scene = new Scene();
  // §3：中性灰，無漸層。不用 fog、不用漸層貼圖。
  scene.background = new Color(STAGE_BACKGROUND);
  scene.add(createClayLighting());

  const subject = new Group();
  subject.name = 'clay-subject';
  scene.add(subject);

  // 只承接陰影的透明面：給得到 §5.0 的接地陰影，又不會多出地平線。
  const shadowCatcher = new Mesh(
    new PlaneGeometry(60, 60),
    new ShadowMaterial({
      color: TERRAIN.contactShadow,
      opacity: CONTACT_SHADOW_OPACITY,
      transparent: true,
    }),
  );
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);

  const camera = new PerspectiveCamera(FOV_DEG, 1, 0.1, 200);

  const boundingBox = new Box3();
  const boundingSphere = new Sphere();
  const target = new Vector3();

  const setView = (view: ViewName, marginOverride?: number): void => {
    boundingBox.setFromObject(subject);
    if (boundingBox.isEmpty()) {
      camera.position.set(0, 1, 4);
      camera.lookAt(0, 0, 0);
      return;
    }
    boundingBox.getBoundingSphere(boundingSphere);
    // 陰影承接面貼齊元件底部，接地陰影才會真的「接地」。
    shadowCatcher.position.y = boundingBox.min.y;

    target.copy(boundingSphere.center);
    const distance =
      (boundingSphere.radius / Math.sin(MathUtils.degToRad(FOV_DEG) * 0.5))
      * (marginOverride ?? FRAMING_MARGIN);

    const { azimuthDeg, elevationDeg } = VIEW_ANGLES[view];
    const azimuth = MathUtils.degToRad(azimuthDeg);
    const elevation = MathUtils.degToRad(elevationDeg);
    const horizontal = Math.cos(elevation) * distance;
    camera.position.set(
      target.x + Math.sin(azimuth) * horizontal,
      target.y + Math.sin(elevation) * distance,
      target.z + Math.cos(azimuth) * horizontal,
    );
    // 頂視時 up 不能跟視線平行，否則 lookAt 退化。
    camera.up.set(0, view === 'top' ? 0 : 1, view === 'top' ? -1 : 0);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  };

  return {
    scene,
    camera,
    renderer,
    subject,
    setView,
    capture(): string {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    },
    dispose(): void {
      renderer.dispose();
    },
  };
}

/** 換上要拍的元件，並接上黏土陰影。 */
export function mountSubject(stage: ClayStage, object: Object3D): void {
  stage.subject.clear();
  enableClayShadows(object);
  stage.subject.add(object);
}
