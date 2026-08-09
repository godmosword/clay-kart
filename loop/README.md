# loop/ — 三方共享協定目錄

此目錄在 `main` 上，三個 worktree 都讀得到。
**context 隔離靠檔案系統強制執行**（LOOP-OPS §0.3）—— 三個工具看不到彼此的對話，
所以任何跨工具的資訊都必須寫進這裡，否則就不存在。

---

## ⚠️ 寫在哪裡（最容易搞錯的一點）

每個 worktree 都有一份 `loop/` 和 `progress/` 的拷貝，但**它們是各分支獨立的檔案**。
在自己的 worktree 更新 `progress/physics.json`，`main` 上的儀表板永遠看不到，
三方協調狀態會各自漂移。

**規則：**

| 內容 | 寫在哪 | 分支 |
|---|---|---|
| 程式碼 | 自己的 worktree（`../ck-*`） | 自己的 feature 分支 |
| `loop/round-{N}/*`、`progress/*.json`、`BACKLOG.md`、`budget.json` | **`clay-kart/`** | **`main`** |

```bash
# 每輪結束，回 main 更新協調狀態
cd ../clay-kart
git pull --rebase          # ← 必做。三個工具都寫這裡，不 pull 一定衝突
# 編輯 progress/physics.json、loop/budget.json、loop/round-{N}/VERDICT.json
git add progress loop && git commit -m "R{N} {element}: 協調狀態"
git push
```

程式碼的 commit 留在自己分支，協調狀態的 commit 進 main。兩者不混。

### ⚠️ 光更新 progress.json 不代表程式碼進了 main（真實發生過兩次的錯）

`progress/*.json` 只是**狀態燈號**。builder 在自己分支 push 完程式碼，
**Lead 必須另外把那個分支 merge 進 `main`**，兩件事分開發生，缺一個都會出事。

只更新 progress.json、忘記 merge 程式碼的後果：`progress.json` 顯示
`"status": "done"`，但其他 worktree（含 Lead 自己拿去測試的那個）讀到的
還是舊程式碼——**驗證會通過，因為驗證的是錯的東西**。這件事在本專案
發生過兩次（R1 物理程式碼、R2 渲染程式碼），第二次是靠實測時發現畫面
缺了一塊才追出來，不是靠流程擋下來的。

**每輪收尾前，Lead 執行這個檢查，不要用記的：**

```bash
cd ../clay-kart
for b in feat/physics feat/visual feat/plumb; do
  git merge-base --is-ancestor "origin/$b" HEAD \
    && echo "  ✓ $b 已在 main 裡" \
    || echo "  ⚠ $b 還沒併進 main：$(git log origin/$b --not HEAD --oneline | wc -l) 個 commit 待併"
done
```

三個都要是 ✓，才算這輪真的收尾。不是三個 ✓ 就 `git merge origin/<branch> --no-edit`，
驗證 build，push，再繼續。

**這個檢查抓不到「連 commit 都沒做」的情況**（R17 發生過一次：
`ck-plumb` worktree 的變更完全是未追蹤的工作目錄異動，沒有任何
commit hash 可以拿去比對，`merge-base` 檢查會顯示「已在 main 裡」，
因為 origin 上根本沒有新 commit）。收工前一併對每個 worktree 跑：

```bash
for w in ../ck-visual ../ck-physics ../ck-plumb; do
  echo "== $w =="
  (cd "$w" && git status --short)
done
```

若某個 worktree 有輸出但這裡完全乾淨，先別急著結案——確認一下 builder
是不是忘了 commit，而不是這輪真的沒有異動。

**上面兩道都抓不到第三種情況：證據上了 main，程式碼沒上。** R22 與 R23
連兩輪發生——builder 把 `VERDICT-*.json` 與 telemetry 直接提交到 main，
而產生它們的程式碼還留在功能分支。結果是 main 上有一份全綠的判決，
**而 main 自己跑不出來**（R22 那次實測：main 重跑得到 42/46，17 個指標
對不上已提交的判決）。

前兩道抓不到它的原因很具體：`git status --short` 是乾淨的（程式碼確實
commit 了，只是在分支上），而 `merge-base` 顯示分支未併入——但那在
builder 還沒收尾的輪次裡是**正常狀態**，不構成警訊。

前三種變體看起來都是「缺東西」，會觸發追問；這一種看起來是「做完了而且
全綠」。所以它需要一道問不同問題的檢查：**這份 artifact 說它是用哪個
commit 產生的，那個 commit 在這裡嗎？**

```bash
python3 loop/schema/provenance.py
```

exit 0 才算收尾。它掃 `loop/round-*/artifacts/*.json` 的 `meta.build_sha`，
逐一確認是 `HEAD` 的祖先。沒有這個欄位的（早期輪次）會列出來但不算失敗
——列出來是刻意的，沉默的假陰性比吵雜的假陽性危險。

也可以拿去驗歷史上的某個 commit：`--rev 87b4fe4` 會如實指出當時
`loop/round-22/artifacts/` 的兩份 artifact 的 `build_sha` 不在歷史裡。

### 遠端衝突規則

`origin` = https://github.com/godmosword/clay-kart

三個工具都會寫 `main` 的協調檔案，衝突是必然的。規則：

| 檔案 | 衝突處理 |
|---|---|
| `progress/*.json` | 各工具只寫自己那份，衝突代表有人越界寫別人的，**revert 越界方** |
| `loop/budget.json` | 只改自己元件的 `spent`，衝突時取**兩邊各自的元件**手動合併，不要整檔覆蓋 |
| `loop/round-{N}/VERDICT.json` | 一輪只有一個 critic，不該衝突。若衝突代表同一輪跑了兩個 critic，**兩份都作廢重跑** |
| `BACKLOG.md` | append-only，衝突時兩邊都保留 |
| `PLAN.md` / `FROZEN.md` / `BAR-*.md` | 只有 Lead 寫。builder 這裡有改動 = 越界，revert |

**永遠 `git pull --rebase`，不要 merge。** 協調檔案的 merge commit 會讓
「哪一輪改了什麼」變得無法追溯，而那正是這套流程唯一的稽核線索。

---

## 檔案

| 檔案 | 誰寫 | 誰讀 |
|---|---|---|
| `PLAN.md` | **僅 Lead** | 全部 |
| `FROZEN.md` | **僅 Lead** | 全部（builder 每輪開頭必讀） |
| `BACKLOG.md` | 全部可 append | Lead |
| `budget.json` | builder 每輪更新 `spent` | 全部 |
| `schema/verdict.schema.json` | **僅 Lead** | critic |
| `round-{N}/TASK.md` | Lead | 該輪 builder |
| `round-{N}/VERDICT.json` | 該輪 critic | 下一輪 builder |
| `round-{N}/artifacts/` | builder | critic |

`BAR-FEEL.md` / `BAR-VISUAL.md` 在 repo 根目錄，**僅 Lead 可寫**。
Builder 修改驗收標準等同自己改考卷。

---

## 一輪的流程

```
Lead      → 寫 round-{N}/TASK.md（指定元件與範圍）
builder   → 讀 TASK.md + VERDICT.json(N-1) + FROZEN.md + BAR-*.md
          → 只修 largest_gap 一項
          → 產出 artifacts/，更新 budget.json，commit
critic    → 讀 artifacts/ + BAR-*.md（不讀 diff、不讀 commit message）
          → 寫 round-{N}/VERDICT.json
Lead      → PASS → 更新 FROZEN.md，開下一元件
          → FAIL → 開 round-{N+1}
          → 撞 cap → 寫 BACKLOG.md，強制換元件
```

## 硬性規則

1. **Critic 禁止在 VERDICT 中提供實作建議。** 只報告「現況 / 目標 / 落差」。
   給了建議，builder 就變成執行者而非設計者，會失去 Gauntlet Loop 的價值。
2. **Builder 只修 `largest_gap` 一項。** 不要順手改其他 FAIL 項。
3. **VERDICT.json 必須自我完備。** 假設讀者對本專案一無所知。
4. **`FROZEN.md` 列出的檔案任何人不得修改。**

## Builder 的邊界（R33 之後補上，因為四條全被踩過）

> 這一節寫給 Codex 與 Cursor。**每一條都對應一次真實發生過的事**，
> 不是預防性的規矩。踩到了不是災難，但要停下來回報，不要自己繞過。

### 一、分支：只 commit 到自己的分支，永遠不碰 `main`

| 工具 | 你的分支 | 你的 worktree |
|---|---|---|
| Codex | `feat/physics` | `../ck-physics` |
| Cursor | `feat/plumb` | `../ck-plumb` |
| Claude Code | `feat/visual` | `../ck-visual` |

**`main` 只有 Lead 能寫**，包括 `progress/*.json`。你要回報進度，
寫在你自己分支的 commit message 與回報文字裡，Lead 收尾時謄進 `main`。

*R33 實際發生*：Cursor 直接在 `main` 上提交了兩個 commit。

### 二、檔案：`loop/round-{N}/artifacts/` **是你該寫的**，`loop/` 其餘都不是

> **R33 補充**：Codex 把這條讀成「禁止寫 `loop/`」，於是把 artifact 留在
> `/tmp` 要 Lead 去搬——而「artifact 指向容器暫存路徑、倉庫內無法重建」
> 正是 R22 明文禁止的事。所以這條改成正面表述：
>
> **`loop/round-{N}/artifacts/` 是 builder 的交件位置，請直接寫進去並 commit。**
> 那是唯一你該寫的 `loop/` 子目錄，也是**必須**寫的——artifact 沒有進倉庫，
> 那一輪的判決就不可重建。

`loop/BACKLOG.md`、`loop/PLAN.md`、`loop/FROZEN.md`、`loop/budget.json`、
`BAR-*.md`、`REF-PAIRING.md` **全部是 Lead 的裁決紀錄**。內容再正確也不要動
——BACKLOG 記的是「誰在什麼時候基於什麼證據做了什麼判斷」，
被第三方改寫之後那條線就斷了。

要補充的事實（實測值、你發現的缺陷）**寫進回報**，Lead 會轉錄並標明來源。

*R33 實際發生*：Cursor 把實測數字寫進了 `loop/BACKLOG.md`。數字本身是對的。

### 三、Git ref：不要 `reset` 你的分支，尤其不要 reset 回 `origin/`

Lead 會把你的 worktree 同步到 `main`。**那個同步是刻意的**——它把其他工具
已經合併的東西帶給你。如果你 `git reset --hard origin/feat/xxx` 把它退回去，
你就在一棵舊樹上開工，而你的 commit 之後要重放才能用。

開工前如果覺得樹不對，**先問**，不要自己動 ref。

*R33 實際發生*：Cursor reset 回 `origin/feat/plumb`，在落後 20 個 commit 的樹上
完成整個任務。Lead 事後 `rebase --onto main` 重放才可用。

> **對應的 Lead 義務**（寫在這裡才對稱）：Lead 同步 worktree **必須**先確認
> 該 worktree 沒有未提交改動、也沒有領先 `main` 的 commit，並且用
> `git merge --ff-only` 而不是 `git reset --hard`。
> *R33 實際發生*：Lead 用 `reset --hard` 把 Cursor 的 commit 從分支上踩掉了，
> 靠 reflog 才救回來。

### 四、量到的數字跟原始碼裡寫的預期值衝突時，改註解不要改數字

你跑出來的實測值如果跟檔案裡的註解／常數說明對不上，**那個註解就是過期的**。
順手改掉並在回報裡講一句。不要留著讓下一個人重新踩。

*R33 實際發生*：`steer-screen.mjs` 的註解寫「solo 預期 ~5、multi ~0.8」，
Cursor 實測 solo 2.7、multi 3.9，兩者相反，註解沒動。而那句過期的話正是
Lead 五輪前下裁決的依據。

### 完成一輪的回報要包含

- commit sha（在**你自己的分支**上）
- 實測數字，不要只寫 PASS
- 你動過的檔案清單
- 任何你繞過或沒做到的事——**回報 blocked 永遠比自己想辦法繞過好**

## 驗證 VERDICT

```bash
npx ajv-cli validate -s loop/schema/verdict.schema.json -d loop/round-7/VERDICT.json
```

或用 Python：

```bash
python3 -c "
import json, sys
from jsonschema import validate
validate(json.load(open(sys.argv[1])), json.load(open('loop/schema/verdict.schema.json')))
print('VERDICT ok')
" loop/round-7/VERDICT.json
```

## Lead 每輪開場的固定動作（R36 新增）

```bash
node tools/lead/inbox.mjs
```

**不要再讓使用者當訊息中繼。** builder 把東西推上遠端就算交件，
Lead 自己去看，不需要有人把 commit sha 貼進對話。

R36 收尾時我 `git fetch` 才發現 Codex 早就把 `TASK-codex-4` 做完推上去了
（`9e418ac`／`7ea6893`），沒有人告訴我，那兩個 commit 已經躺在遠端一段時間。
**使用者要看的是遊戲，不是 commit sha。**

`inbox.mjs` 會印出：

- 每個 builder 分支領先 `main` 的 commit（sha、標題、多久前）
- **越界警告**：改到不屬於自己範圍的檔
- **動到 Lead 檔案的警告**：`BACKLOG.md`／`PLAN.md`／`BAR-*.md`
- **刪檔預告**：直接 merge 會讓幾個檔從 `main` 消失
  （`integrate.mjs` 會擋，這裡先讓你知道要用 `--commits`）

輸出為空就代表沒有待處理的交件。

> 這支只負責「看」。整合走 `integrate.mjs`，驗證要自己跑真的檢查——
> **收件匣顯示有交件不等於那個交件是對的。**
