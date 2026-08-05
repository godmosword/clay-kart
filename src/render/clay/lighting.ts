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
 * 陰影貼圖邊長。
 *
 * **R20 實測選出來的，不是憑感覺挑的。** 第一版給 2048（配 16 取樣），理由是
 * 「夠大才能讓模糊看起來是柔而不是鋸齒被糊掉」——聽起來合理，但接進遊戲之後
 * 量下去才發現那組設定是整個管線最貴的一項，而且**買到的東西是零**：
 *
 * | 貼圖 / 取樣 | fps_p50 | 畫面差異 |
 * |---|---|---|
 * | 2048 / 16 | 約 0.8–1.2 | 基準 |
 * | 1024 / 8 | 3.19 | 看不出來 |
 * | **512 / 4** | **約 6.3** | 看不出來 |
 *
 * 並排截圖見 `loop/round-20/artifacts/shadow-sweep/`。原因不難理解：接地陰影
 * 只佔畫面很小一塊，而 `±9` 單位的陰影 frustum 除以 512 仍有約 3.5cm/texel，
 * 對一個刻意要「短、柔、低對比」的影子來說綽綽有餘。**貼圖解析度是拿來換
 * 銳利度的，而這裡的規格明文不要銳利。**
 *
 * 量測環境是容器內 SwiftShader 軟體算繪，絕對值不可跨機器比較；但同機器
 * 連跑三次 `fps_p50` 為 6.25 / 5.87 / 6.85（±8%），倍率差異遠大於雜訊。
 */
const SHADOW_MAP_SIZE = 512;

/**
 * 接地陰影的柔化半徑，單位是 texel。`§5.0` 要「短、柔、低對比」。
 *
 * 跟著 `SHADOW_MAP_SIZE` 一起降：半徑是 texel 數，貼圖縮到 1/4 時同樣的
 * 世界空間模糊量只需要約 1/4 的 texel。3 配 512 的實際柔度與 7 配 2048
 * 相當——並排看不出差別。
 *
 * 搭配 `VSMShadowMap` 使用：three r185 起 `PCFSoftShadowMap` 已棄用，而
 * `PCFShadowMap` 根本不理會 `shadow.radius`——選 VSM 是因為它是目前唯一
 * 真的會把這個半徑當模糊量的陰影型別，硬邊投影會直接違反鐵律。
 */
const SHADOW_BLUR_RADIUS = 3;

/**
 * VSM 的模糊取樣數。太低會看到分層，太高在低階裝置上不划算。
 *
 * 4 是實測下限：這個場景的陰影夠柔、夠小，分層看不出來。真的要再往下砍
 * 成本的話，下一步不是繼續調這裡，而是**整個不用即時投影**——見下方說明。
 */
const SHADOW_BLUR_SAMPLES = 4;

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
 *
 * ## 即時投影還值不值得，是元件 #10 要回答的問題
 *
 * R20 量到：關掉整個陰影 pass 是 `fps_p50 = 14.0`，開著（已調到 512/4）是
 * 約 6.3——即時投影仍然佔掉一半以上的幀時間。而 `§5.0` 對接地陰影的規格是
 * 「**短、柔、低對比，落在物件正下方略偏前**」，那描述的東西一張貼片就做得到，
 * 不需要即時投影。
 *
 * 真正會因此失去的是**自體遮蔽**（車底、輪拱、接縫的那圈暗），那是 `§5.0`
 * AO 條款的來源。所以這不是純粹的效能取捨，是「用貼片換掉自體遮蔽划不划算」——
 * 得看得到兩種做法的並排圖才能判斷，那是元件 #10 `shadows-contact`
 * 該做的事（`BAR-VISUAL §5.10`），不是在接線輪次順手決定的。
 */
export function enableClayShadows(object: Object3D): void {
  object.traverse((child) => {
    child.castShadow = true;
    child.receiveShadow = true;
  });
}
