# 手動動作確認用: main.coffee から require されるモジュール
# （ファイル間ジャンプ / import 解決の確認に使う）

formatGreeting = (name) ->
  "Hello, #{name}!"

class Greeter
  constructor: (@name, @age) ->

  greet: ->
    formatGreeting(@name)

  describe: ->
    "#{@name} is #{@age} years old"

  @createDefault: ->
    new Greeter('World', 0)

module.exports = { Greeter, formatGreeting }
