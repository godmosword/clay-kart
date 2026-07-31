/**
 * 進入點。W1 骨架 —— 只負責接線，不含遊戲邏輯。
 *
 * 這支檔案屬於 Cursor 的寫入範圍（plumbing）。
 * 物理由 Codex 實作於 src/physics/，渲染由 Claude Code 實作於 src/render/。
 * 兩者在此處以介面接起來，見 src/loader/bootstrap.ts。
 */
import { bootstrap } from '@loader/bootstrap';
import { createPlayerInput } from '@ui/player-input';

const mount = document.getElementById('app');
if (!mount) throw new Error('找不到 #app 掛載點');

const input = createPlayerInput(mount);

bootstrap(mount, input).catch((err: unknown) => {
  console.error('[clay-kart] bootstrap 失敗', err);
  mount.textContent = '啟動失敗，見 console。';
  input.dispose();
});
