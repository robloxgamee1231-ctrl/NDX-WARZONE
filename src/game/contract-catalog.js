// Shared objective definitions. The server owns progress, payouts and deadlines.
export const CONTRACTS = Object.freeze({
  recon: { name: 'Secure the Relay', goal: 8, cash: 1900, seconds: 102 },
  scavenge: { name: 'Supply Run', goal: 3, cash: 2400, seconds: 102 },
  bounty: { name: 'Marked Operator', goal: 1, cash: 3200, seconds: 120 },
  recovery: { name: 'Supply Recovery', goal: 2, cash: 2600, seconds: 95 },
})
export const fieldContract = (i) =>
  ['recon', 'scavenge', 'bounty', 'recovery'][i % 4]
export function contractObjective(c) {
  switch (c.task) {
    case 'bounty':
      return 'Eliminate marked enemy'
    case 'recovery':
      return c.progress ? 'Return cargo to terminal' : 'Open marked cache'
    case 'scavenge':
      return 'Open supply crates'
    default:
      return 'Secure relay perimeter'
  }
}
