# NDX WARZONE — Field Command

NDX is an original, playable 3D first-person browser game. Deploy instantly with bots, join public matchmaking, or host a live private room. No account or external game service is required.

## Start playing

Use Node.js 22.12 or newer and a browser with WebGL 2.

```sh
npm ci
npm run dev
```

Open the URL Vite prints (normally `http://localhost:5173`). For production, run `npm run build` and then `npm start`. Host the client and its same-origin `/ws` endpoint together; forward WebSocket upgrades and use HTTPS if deploying behind a reverse proxy. `GET /health` checks the production process.

## Field Command (0.3.0)

- **Choose your battlefield.** Open **Mission setup** after selecting a playlist. **Floodline** adds seven floodworks districts, three bridges over a walkable spillway, six lift locations, and its own aircraft route to Battle Royale and Resurgence. **Relay Works** adds a turbine hall, a raised catwalk with two stair approaches, and north/south flanks to the arena playlists. Ridge, Switchyard, and Echo Range remain available.
- **Set the NPC challenge.** Local games default to **Veteran**. Pick **Recruit**, **Standard**, **Veteran**, or **Elite**; private hosts can set the same rules when creating a room. Public matchmaking uses Standard and groups players by battlefield. Six combat roles use different weapons and preferred ranges, can investigate gunfire, and route around cover. Even Elite bots lose sight through solid obstructions and smoke.
- **Talk to field staff.** Press **E** when the prompt appears, or tap the prompt on a touch device. **Coach Vale** opens Range Drills at Echo Range. Quartermasters refill reserve ammunition and tactical charges, and field medics restore up to 42 health. Each successful ammo or aid service is limited to once per operator per match; staff aren't combatants or eliminations.
- **Everything is available on the first deployment.** The **Mistral-3** fires three-round bursts, the **Bulwark-47** carries a 60-round box by default, and the **Harrier-12** fires eight pellets per shell. The Loadout menu includes six selectable primaries, the always-equipped Spectre-8 sidearm, six weapon finishes, six operator skins, and all attachments and tactical gear. XP tracks your service record but does not gate equipment. In-match loot, cash, and station prices are separate from account progression.
- **Original and licensed art.** The two new locations and their key art are original. The model pack includes 14 locally hosted GLBs: two animated operator rigs, seven first-person weapons, and five field props. Three weapons are original geometry and can be rebuilt with `npm run assets:weapons`; existing licensed art is credited in [Asset credits](public/models/CREDITS.md). No Call of Duty or Combat Master maps, skins, or game files are included. [Gameplay references](docs/gameplay-reference.md)

## Playlists

| Mode | How it plays |
| --- | --- |
| Battle Royale | Solo, Duos, Trios, or Quads at Vantage Ridge or Floodline. Jump from the aircraft, loot buildings, collect cash, race the gas, and be the last squad standing. Eligible squad buybacks are available. |
| Resurgence | Either survival battlefield with early-circle return rules and a surviving-squad requirement in team formats. |
| Team Deathmatch | Two teams at the Switchyard or Relay Works; first to 25 eliminations or the lead at time limit. |
| Free For All | Every operator for themselves in either arena; first to 15 eliminations or the lead at time limit. |
| Garrison | Two teams capture three relays at the Switchyard or Relay Works. First to 180 points, with overtime for tight contests. |
| Private Match | Choose the mode, battlefield, team format, NPC difficulty, room size, and optional bot fill. Friends join using the invitation link or five-character room code on the same host. |
| Training Range | Practice at Echo Range, run timed drills, or try loadouts and armor without hostile bots. |

Public play is opt-in in **Settings → Public matchmaking**. Private matches do not require opting in.

## Controls

| Action | Desktop |
| --- | --- |
| Move / look | **WASD** / mouse (click the field to capture; drag or use arrows if unavailable) |
| Fire / aim | Left / right mouse button |
| Sprint / tactical sprint | Hold **Shift** / double-tap **Shift** or press **X** while moving forward |
| Crouch / slide | **C** or **Ctrl**; crouch while sprinting to slide |
| Jump / slide jump / mantle | **Space**; hold it while moving into a ledge or ladder to climb |
| Jump from aircraft / open chute / cut chute | **Space** / **Space** / **C** at sufficient altitude |
| Interact / reload | **E** / **R** (also use **E** at launch posts and with field staff) |
| Insert plates / deploy armor box | Hold **G** or **4** / **Q** |
| Primary / sidearm / tactical gear | **1** / **2** / **V** |
| Squad revive or self-revive | Hold **F** beside a downed teammate, or while downed with a kit |
| Squad waypoint / map | **Z** or middle mouse; **M** opens the map for point and danger marks |
| Scoreboard / pause | **Tab** / **Esc** or **P** |
| Echo Range drills / armor test | **B** / **T** |

On touch devices, use the movement stick, swipe to look, and use the action buttons. Hold **Armor** to insert plates. Use **Swap**, **Gear**, and **Mark** for the expanded controls; **Revive** appears when applicable. Use a tap on the tactical map to post a waypoint. Keyboard map users can focus the map, move the cursor with arrows, and press Enter.

### Armor rules

Health and armor are separate. Three slots hold up to **150 armor**; a complete insertion restores up to **50** and spends one reserve. Carry five reserves or eight with an **armor satchel**. Loot individual plates or collect them from crates and Buy Stations. Deploy an armor box with **Q**; each nearby squad member can interact once to refill. Taking damage cancels an in-progress insertion without consuming the plate. Release and hold again to resume. Armor break plays a distinct sound and screen effect. Gas bypasses armor unless absorbed by an equipped, non-depleted gas filter.

## Graphics and hosting

**Performance**, **Balanced**, and **High** adjust render distance, resolution, and animation/effect budgets. High adds dynamic shadows. Adaptive resolution limits render cost; Performance is the touch default. Settings also include weather, FOV, look sensitivity, audio, and reduced camera motion.

The Node server advances matches at 30 Hz and sends snapshots at roughly 10 Hz. Clients predict local movement and interpolate nearby opponents. Rooms and match state are in memory. Personal service records are stored in the browser, not a hosted account.

| Environment variable | Default | Effect |
| --- | --- | --- |
| `PORT` | `5173` | Production HTTP and WebSocket port |
| `MATCH_CAPACITY` | `100` | Maximum operators per room (2–100) |
| `MAX_ROOMS` | `12` | Maximum active and waiting rooms per process |
| `ONLINE_BOTS` | `39` | Bot-fill target for public BR/Resurgence with one human, subject to capacity |

## Verify

```sh
npm test                 # gameplay, bots, traversal, art, profiles, and WebSocket integration
npm run check:models     # local GLB dependencies, clips, budgets, and credits
npm run test:capacity    # short 100-client WebSocket smoke test
npm run build            # production bundle
npm run test:production  # launch an isolated server; verify HTTP caching, assets, and live rooms
npm run format:check     # consistent source formatting
npm run lines            # reproducible source count, including tests and tools
```

For desktop, touch, and two-tab room browser QA, start the game and run `CHROMIUM_PATH=/path/to/chromium npm run test:browser`. A Chromium binary installed using `npx playwright-core install chromium` also works without `CHROMIUM_PATH`. Set `NDX_BROWSER_URL` for a different server, `NDX_SOFTWARE=1` for software WebGL, or `NDX_QA_SCREENSHOTS=out/browser` to save screenshots.

The source count excludes dependency code, generated builds, model and image binaries, and documentation. It includes the maintained application, styles, server, tests, and verification tools. The local 100-client check is not a test of 100 rendered player browsers or a production-scale load trial. Physical Android frame rates and sustained hosting capacity should be measured on the intended hardware and network.
