import test from 'node:test'
import assert from 'node:assert/strict'
import { isCaptureWarp } from '../src/game/input.js'

const anchor = { x: 470, y: 317 }
const captured = { clientX: anchor.x, clientY: anchor.y }
const origin = { clientX: 0, clientY: 0 }

test('capture-anchor replays are ignored at both reported fixed positions', () => {
  assert.ok(isCaptureWarp(anchor, captured, -470, -317))
  assert.ok(isCaptureWarp(anchor, origin, 470, 317))
  assert.ok(isCaptureWarp(anchor, { clientX: 469.5, clientY: 317 }, -469, -318))
})

test('normal aiming and long sweeps without a matching capture replay are preserved', () => {
  assert.equal(isCaptureWarp(anchor, captured, 21, 14), false)
  assert.equal(isCaptureWarp(anchor, captured, -470, 62), false)
  assert.equal(
    isCaptureWarp(anchor, { clientX: 469, clientY: 100 }, 470, 317),
    false,
  )
  assert.equal(isCaptureWarp(null, origin, 470, 317), false)
  assert.equal(isCaptureWarp({ x: 12, y: 21 }, origin, -12, -21), false)
})
