export const STANDARD_DIFFICULTY = 'standard'
export const LOCAL_DIFFICULTY = 'veteran'

const profile = (name, detail, values) =>
  Object.freeze({ name, detail, ...values })

export const DIFFICULTIES = Object.freeze({
  recruit: profile(
    'Recruit',
    'A longer reaction window and lighter incoming bot damage. Learn the routes.',
    {
      scan: [0.52, 0.4],
      reaction: [0.53, 0.48],
      sight: 0.78,
      aim: 1.63,
      turn: 0.128,
      accuracyGate: 0.27,
      duty: 0.43,
      damage: 0.64,
      side: 0.42,
      memory: 1.8,
      hear: 24,
      lead: 0,
      tactics: false,
    },
  ),
  standard: profile(
    'Standard',
    'Balanced patrols, rotating squads, and readable target tracking.',
    {
      scan: [0.29, 0.43],
      reaction: [0.23, 0.41],
      sight: 1,
      aim: 1,
      turn: 0.16,
      accuracyGate: 0.19,
      duty: 0.56,
      damage: 0.84,
      side: 0.72,
      memory: 3.4,
      hear: 35,
      lead: 0.015,
      tactics: false,
    },
  ),
  veteran: profile(
    'Veteran',
    'Quicker reactions, cautious cover use, and more aggressive movement.',
    {
      scan: [0.2, 0.27],
      reaction: [0.16, 0.26],
      sight: 1.12,
      aim: 0.76,
      turn: 0.19,
      accuracyGate: 0.15,
      duty: 0.65,
      damage: 0.92,
      side: 0.82,
      memory: 4.8,
      hear: 43,
      lead: 0.035,
      tactics: true,
    },
  ),
  elite: profile(
    'Elite',
    'Fast patrol decisions and tight aim. Smoke and hard cover still stop their sight.',
    {
      scan: [0.125, 0.21],
      reaction: [0.11, 0.17],
      sight: 1.22,
      aim: 0.49,
      turn: 0.218,
      accuracyGate: 0.12,
      duty: 0.74,
      damage: 0.99,
      side: 0.91,
      memory: 6.3,
      hear: 50,
      lead: 0.054,
      tactics: true,
    },
  ),
})

export function normalizeDifficulty(id, fallback = STANDARD_DIFFICULTY) {
  return typeof id === 'string' && Object.hasOwn(DIFFICULTIES, id)
    ? id
    : fallback
}
