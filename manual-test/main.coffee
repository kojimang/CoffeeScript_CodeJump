# =============================================================================
# 手動動作確認用ファイル
#
# 使い方:
#   1. `npm run watch` を実行しておく
#   2. VSCode で「ファイル > フォルダーを開く」からリポジトリ内の
#      manual-test フォルダーを開き、F5 (Run Extension) する
#      （このフォルダーごと開かないと Ctrl+T のワークスペース内検索が
#      test/fixtures だけを対象にしてしまうので注意）
#   3. 下記の項目にカーソルを合わせて挙動を確認する
#
# 確認項目:
#   - Go to Definition   : F12 / Cmd+クリック
#   - Peek Definition     : Alt+F12
#   - Hover               : 定義済みシンボルにカーソルを乗せてツールチップ表示
#   - Find All References : Shift+F12
#   - 出現箇所ハイライト   : 同名識別子にカーソルを置くと自動で光る
#   - アウトライン         : Ctrl+Shift+O、またはエディタ右上のアウトラインパネル
#   - Ctrl+T              : ワークスペース全体からシンボルをあいまい検索
# =============================================================================

{ Greeter, formatGreeting } = require './greeter'

# --- 1. クラスの継承 ---------------------------------------------------------
# "Greeter" の上で F12 → greeter.coffee の `class Greeter` へジャンプするか確認
class NamedGreeter extends Greeter
  shout: ->
    formatGreeting(@name).toUpperCase()

# --- 2. 関数代入 -------------------------------------------------------------
square = (x) -> x * x

# --- 3. 変数の複数出現（ハイライト確認用） -----------------------------------
count = 0
count = count + 1

# --- 4. for ループ変数 --------------------------------------------------------
items = [1, 2, 3]
for item in items
  square(item)

# --- 5. インスタンス化・メソッド参照 -----------------------------------------
greeter = new NamedGreeter('Ada', 36)
greeter.greet()      # "greet" 上で F12 → greeter.coffee の `greet: ->` へジャンプ
greeter.shout()      # "shout" 上で F12 → 同ファイル内の `shout: ->` へジャンプ
greeter.describe()   # "describe" 上で F12 → greeter.coffee の `describe: ->` へジャンプ

# --- 6. 静的メソッド ----------------------------------------------------------
defaultGreeter = Greeter.createDefault()

# --- 7. @ プロパティ定義・参照 -------------------------------------------------
class Counter
  constructor: ->
    @value = 0

  increment: ->
    @value = @value + 1
    @value

counter = new Counter()
counter.increment()

console.log square(count), greeter.greet(), defaultGreeter.greet()
