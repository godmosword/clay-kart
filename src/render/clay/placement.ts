/**
 * 決定性擺放用的整數哈希。
 *
 * **為什麼不用 `Math.random()`**：元件審查圖（`BAR-VISUAL §3`）必須可以重複
 * 產生。`loop/round-21` 那次「與 R19 逐像素差異最大 11」的比對，靠的就是同一份
 * 程式碼跑兩次會得到同一張圖。任何一個 `Math.random()` 都會讓那種比對失效，
 * 也會讓 critic 的分數變化分不出是「改了什麼」還是「這次剛好」。
 *
 * 同一支哈希也讓「不等距」「不等長」這類 `§5.5` 明文要求的不規則性有來源——
 * 不規則不等於隨機，它只需要看起來沒有規律，不需要不可重現。
 *
 * @param i 序號（第幾個物件）
 * @param salt 用途區分，讓同一個 `i` 的不同屬性彼此獨立
 * @returns `[0, 1)`
 */
export function placementHash(i: number, salt: number): number {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
