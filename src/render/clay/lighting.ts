/**
 * 全域光照鑽機。**這是 `skybox-lighting`（元件 #7）的實體**，也是
 * 其餘 11 個元件的拍攝條件。
 *
 * `BAR-VISUAL §5.0` 燈光表（Art Bible §2 原文）：
 *
 * | 角色 | 設定 |
 * |---|---|
 * | 主光 | 柔和、大面積、略偏上方。**弱方向性**，不要硬主光 |
 * | 環境光/補光 | 高、均勻、暖白，讓暗部仍明亮通透 |
 * | AO | 縫隙、接地處淺淺一圈 |
 * | 接地陰影 | **短、柔、低對比**，落在物件正下方略偏前 |
 *
 * > **鐵律：全場維持同一套柔和均勻光、低對比。**
 * > 任何元件若突然出現硬方向主光或長投影 = 一眼出戲，退件。
 *
 * `§3` 拍攝規範另外明文「**禁止逐元件調光**」。所以這支函式回傳的東西
 * 刻意是**不可變的**：呼叫端拿到燈光群組但拿不到可以個別調參的把手。
 * 想改光只能改這個檔案，改了就是全場一起改——那正是鐵律要的效果。
 */
import {
  AmbientLight,
  DirectionalLight,
  Group,
  HemisphereLight,
  Object3D,
  VSMShadowMap,
  WebGLRenderer,
} from 'three';

/**
 * 主光強度。給出「略偏上方」的形體暗示。
 *
 * 第一版把這個值壓到 0.85、環境光拉到 2.05，結果是**整台車幾乎沒有明暗
 * 變化**——沒有形體感，看起來像塑膠玩具而不是黏土。黃金樣本其實有明顯
 * 但柔和的形體漸層：柔和 ≠ 平坦。所以主光拉高、環境光降下來，靠的是
 * 「大面積柔光 + 弱方向性」而不是「幾乎沒有方向性」。
 */
const KEY_INTENSITY = 1.75;

/**
 * 環境／補光。高、均勻、暖白，讓暗部仍明亮通透——但不能高到把主光的
 * 形體漸層洗掉。
 */
const HEMISPHERE_INTENSITY = 1.1;
const AMBIENT_INTENSITY = 0.22;

/** 天空暖白、地面反彈的暖沙色——對應黃金樣本的奶油調環境。 */
const SKY_COLOUR = 0xfff6e9;
const GROUND_BOUNCE_COLOUR = 0xe8d9c0;
const KEY_COLOUR = 0xfff3e2;

/**
 * 陰影貼圖邊長。夠大才能讓 `shadow.radius` 的模糊看起來是「柔」而不是
 * 「鋸齒被糊掉」。
 */
const SHADOW_MAP_SIZE = 2048;

/**
 * 接地陰影的柔化半徑。`§5.0` 要「短、柔、低對比」。
 *
 * 搭配 `VSMShadowMap` 使用：three r185 起 `PCFSoftShadowMap` 已棄用，而
 * `PCFShadowMap` 根本不理會 `shadow.radius`——選 VSM 是因為它是目前唯一
 * 真的會把這個半徑當模糊量的陰影型別，硬邊投影會直接違反鐵律。
 */
const SHADOW_BLUR_RADIUS = 7;

/** VSM 的模糊取樣數。太低會看到分層，太高在低階裝置上不划算。 */
const SHADOW_BLUR_SAMPLES = 16;

/**
 * 建立全域光照。回傳一個 `Group`，加進場景即可。
 *
 * 刻意不提供任何 per-element 調光參數——見檔頭說明。
 */
export function createClayLighting(): Group {
  const group = new Group();
  group.name = 'clay-global-lighting';

  // 高、均勻、暖白的環境光：黏土世界的亮度主力。
  const hemisphere = new HemisphereLight(SKY_COLOUR, GROUND_BOUNCE_COLOUR, HEMISPHERE_INTENSITY);
  hemisphere.position.set(0, 1, 0);
  group.add(hemisphere);

  // 再墊一層均勻補光，確保暗部「仍明亮通透」而不是死黑。
  group.add(new AmbientLight(SKY_COLOUR, AMBIENT_INTENSITY));

  // 弱方向性主光，略偏上方且略偏前——投影因此落在物件正下方略偏前。
  const key = new DirectionalLight(KEY_COLOUR, KEY_INTENSITY);
  key.position.set(2.6, 6.4, 4.2);
  key.castShadow = true;
  key.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  key.shadow.radius = SHADOW_BLUR_RADIUS;
  key.shadow.blurSamples = SHADOW_BLUR_SAMPLES;
  // 淺的 bias 避免自體陰影條紋，但不能大到讓接地陰影脫離物件。
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.022;
  const frustum = 9;
  key.shadow.camera.left = -frustum;
  key.shadow.camera.right = frustum;
  key.shadow.camera.top = frustum;
  key.shadow.camera.bottom = -frustum;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 26;
  group.add(key);
  group.add(key.target);

  return group;
}

/**
 * 套用渲染器層級的黏土觀感設定。
 *
 * `§3` 禁止後製（無 bloom、無 color grade、無 AO 強化），所以這裡只做
 * 陰影型別與曝光——都是「拍攝條件」不是「後製」。
 *
 * 特別不開 ACESFilmic tone mapping：那會把粉彩色壓向對比更強的電影感，
 * 跟「顏色是材質本身」與低對比的要求相反。
 */
export function applyClayRenderSettings(renderer: WebGLRenderer): void {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = VSMShadowMap;
  renderer.toneMappingExposure = 1;
}

/**
 * 讓一個物件參與黏土陰影：投射 + 接收。
 *
 * `§5.0` 的 AO 條款（「縫隙、接地處淺淺一圈」）在這裡是靠**幾何自體
 * 遮蔽**達成的，不是靠 SSAO 後處理——`§3` 禁止 AO 強化，指的是後製那種。
 */
export function enableClayShadows(object: Object3D): void {
  object.traverse((child) => {
    child.castShadow = true;
    child.receiveShadow = true;
  });
}
