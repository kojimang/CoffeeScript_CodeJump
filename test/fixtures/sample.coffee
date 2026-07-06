# サンプル: スキャナのユニットテスト用
_ = require 'underscore'
{readFile, writeFile} = require 'fs'
Helper = require './helper'

GREETING = "hello #{name}"

square = (x) -> x * x

add = (a, b) ->
  sum = a + b
  sum

class Animal
  constructor: (@name, age) ->
    @age = age

  speak: ->
    noise = "..."
    noise

  @create: (name) ->
    new Animal(name, 0)

class Dog extends Animal
  speak: ->
    "woof"

config =
  key: 'value'

for item in items
  process item

main = ->
  result = add 1, 2
  result

dog = new Dog()
dog.speak()
