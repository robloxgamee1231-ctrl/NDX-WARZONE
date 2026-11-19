import test from 'node:test'
import assert from 'node:assert/strict'
import { Match } from '../src/game/match.js'

const survival = () => new Match({ mode: 'bot-survival', bots: 2 })

test('survival sends hostile reinforcements without granting operators another life', () => {
  const match = survival()
  const operator = match.players.get('local'),
    bot = match.players.get('bot1')
  assert.notEqual(operator.team, bot.team)
  assert.equal(bot.team, match.players.get('bot2').team)
  match.eliminate(bot, operator)
  assert.equal(bot.respawnAt, 6)
  match.time = bot.respawnAt
  match.step(1 / 30)
  assert.equal(bot.alive, true)
  match.eliminate(operator, bot)
  match.step(1 / 30)
  assert.equal(operator.respawnAt, 0)
  assert.equal(match.result.team, bot.team)
})

test('survival awards extraction only after the full holdout', () => {
  const match = survival()
  match.time = match.mode.duration - 1
  match.checkEnd()
  assert.equal(match.result, null)
  match.time = match.mode.duration
  match.checkEnd()
  assert.equal(match.result.team, match.players.get('local').team)
})
