# ファイル間ジャンプ用の被 require モジュール
formatName = (name) ->
  "Mr. #{name}"

class Helper
  @format: (name) -> formatName(name)

module.exports = Helper
