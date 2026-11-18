import { WEAPONS } from '../config.js'

export const RARITIES = Object.freeze([
  { name: 'Common', color: '#aabdc7', price: 90, rank: 1 },
  { name: 'Uncommon', color: '#8ad6a6', price: 160, rank: 2 },
  { name: 'Rare', color: '#7cc8f6', price: 240, rank: 3 },
  { name: 'Epic', color: '#ce9af3', price: 380, rank: 5 },
  { name: 'Legendary', color: '#ffcb7e', price: 560, rank: 8 },
  { name: 'Mythic', color: '#ffa1aa', price: 900, rank: 12 },
])

// A collection is a shared color direction, not a duplicate item. Each finish
// fits one weapon. Outfits uniquely recolor the materials of their base rig.
const colors = [
  ['dune', 'Dune Canvas', '#ad9371', '#624b3d'],
  ['jetty', 'Jetty Grey', '#7e8892', '#374958'],
  ['orchard', 'Orchard Fatigue', '#68794c', '#bcc395'],
  ['clay', 'Red Clay', '#a86e52', '#d4a47c'],
  ['glade', 'Rain Glade', '#385d4b', '#8dafa2'],
  ['sherbet', 'Sherbet Watch', '#ca8971', '#7d4950'],
  ['quarry', 'Quarry Ice', '#9bb9ca', '#4b6572'],
  ['skyrail', 'Skyrail Blue', '#416e90', '#9ad2e5'],
  ['deepsea', 'Deep Sea', '#155965', '#63cbb7'],
  ['hazard', 'Hazard Stripe', '#c5a13c', '#293d4d'],
  ['plum', 'Night Plum', '#705275', '#d7a1bd'],
  ['juniper', 'Juniper', '#4a6970', '#bacf8f'],
  ['ultraviolet', 'Ultraviolet', '#533b91', '#c594ff'],
  ['furnace', 'Furnace Bloom', '#902b43', '#fa8057'],
  ['lagoon', 'Electric Lagoon', '#24769d', '#47ebcf'],
  ['lichen', 'Ghost Lichen', '#a1ad7e', '#495c57'],
  ['solar', 'Solar Relay', '#cb7549', '#ffeaa2'],
  ['zircon', 'Zircon Signal', '#276b76', '#c1f6f0'],
  ['spectral', 'Spectral Opal', '#a5a4d8', '#fce2d0'],
  ['crimson', 'Crimson Gilt', '#7b273f', '#eebc79'],
  ['aurora', 'Aurora Flux', '#469a80', '#db8ff2'],
  ['eclipse', 'Eclipse Pulse', '#292c53', '#ff8268'],
  ['starlight', 'Starlight Ion', '#878aca', '#a7eeff'],
  ['rose', 'Rose Circuit', '#9a496e', '#ffb68c'],
]

const items = []
for (const [i, [theme, name, body, trim]] of colors.entries()) {
  const rarity = Math.floor(i / 4)
  const { price, rank } = RARITIES[rarity]
  const style = {
    body,
    trim,
    rarity,
    rank,
    effect: rarity >= 4 ? 'pulse' : 'none',
  }
  for (const weapon of Object.values(WEAPONS))
    items.push(
      Object.freeze({
        ...style,
        id: `${weapon.id}.${theme}`,
        kind: 'finish',
        weapon: weapon.id,
        name,
        price,
        target: weapon.name,
      }),
    )
  for (const model of ['warden', 'nomad'])
    items.push(
      Object.freeze({
        ...style,
        id: `${model}.${theme}`,
        kind: 'outfit',
        model,
        name,
        target: model === 'warden' ? 'Warden' : 'Nomad',
        price: Math.ceil(price * 1.25),
        dye: Object.freeze(
          model === 'warden'
            ? { Character_Main: body, Pants: trim, Grey: body }
            : { Enemy_Red: trim, DarkGrey: body, Grey: trim },
        ),
      }),
    )
}
export const CATALOG = Object.freeze(items)
const catalogIndex = new Map(items.map((item) => [item.id, item]))
export const cosmetic = (id) => catalogIndex.get(id)
