# NDX COMBAT

An original, browser-first arcade FPS. Start a battle royale at **Vantage Ridge**, practice at Echo Range, or deploy with friends. An account is optional for play and required to earn an online career record.

## Play locally

Use Node.js 22.12 or later and a browser with WebGL 2.

```sh
npm ci
npm run dev
```

Open the URL Vite prints (normally `http://localhost:5173`). The launcher opens on **Battle Royale / Vantage Ridge**. Choose **Deploy now** for a local bot match, or use **Mission setup** to change the battlefield and NPC difficulty. **Multiplayer → Enable public matchmaking** switches the deploy button to live matchmaking. **Private Match** hosts and joins rooms independently of that setting.

### Playlists

| Mode            | Rules                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Team Deathmatch | Two teams. First to 25 eliminations, or the lead when time expires.                                                                                                  |
| Free For All    | Everyone for themselves. First to 15 eliminations, or the lead when time expires.                                                                                    |
| Gun Game        | Enemy eliminations advance a seven-weapon ladder. Finish on the Spectre-8; respawning does not reset your tier. Slot swapping is disabled.                           |
| Kill Confirmed  | Walk over an enemy signal tag to score, or a friendly tag to deny it. Eliminations alone do not score. Tags expire after 26 seconds; first team to 20 confirms wins. |
| Domination      | Capture and hold three relays. First to 180 points or the lead at time limit. Close contests can enter up to 42 seconds of overtime.                                 |
| Battle Royale   | Solo, Duos, Trios, or Quads at Vantage Ridge or Floodline. Drop, loot, race the gas, and be the last squad standing. Eligible squad buybacks are available.          |
| Resurgence      | Same two survival maps with early-circle redeployment and a surviving-squad requirement in team formats.                                                             |
| Bot Survival | Survive two minutes against a hostile NPC team. Eliminated NPCs return after six seconds; operators have one life. |
| Private Match   | Choose a mode, field, team size, NPC rules, and bot fill. Share the invitation link or five-character room code on the same host.                                    |
| Training Range  | Practice at Echo Range. Talk to Coach Vale for timed aiming, movement, and armor drills.                                                                             |

Arena playlists can use Neon District, the Switchyard, or Relay Works. Neon District has three main routes linking two courtyards, an elevated bridge with two stair approaches, and a night market. Floodline has seven districts, three bridges across a walkable spillway, and six lifts. Local games default to **Veteran**; **Recruit**, **Standard**, **Veteran**, and **Elite** are available in local and private matches. Public matches use Standard NPC rules.

### Field contracts

On Vantage Ridge and Floodline, interact with a contract terminal to start a timed objective. The HUD and map show the destination. Living squadmates share the cash payout.

| Contract | Objective | Deadline | Reward per living squadmate |
| --- | --- | --- | --- |
| Secure the Relay | Spend eight seconds inside the marked perimeter at ground level. | 102 s | $1,900 |
| Supply Run | Open three supply crates. The marker favors mission crates. | 102 s | $2,400 |
| Marked Operator | Your squad must eliminate the marked enemy. The last-known position refreshes every three seconds. | 120 s | $3,200 |
| Supply Recovery | Open the assigned cache, then carry its cargo back to the starting terminal. If someone else opens it first, the mission fails. | 95 s | $2,600 |

### Career and cosmetics

- **Operator profile** creates or signs into an account. Save the one-time recovery code somewhere private; there is no email-based reset. The account starts at rank 1 with 300 starting credits. Your login username and in-game callsign can be changed separately.
- Qualifying **completed public matches** earn career XP and credits. Local and private play do not. **Events** shows live XP bonuses and daily/weekly challenges; claim completed rewards there. **Leaderboards** shows the top ranked players. Live humans and NPCs are counted separately.
- All seven standard weapons, base finishes, operator skins, attachments, and tactical equipment are included. The Store offers **216 cosmetic variants**: 24 palettes across seven weapons and two operator rigs. They are material variants, not 216 unique meshes, and do not affect combat stats. Rank gates and earned credits apply to the Store. In-match loot and cash are separate.
- Open **Armory** for an interactive 3D model; drag or use the arrow keys to rotate it. Cosmetics Store and Operator Locker preview their items in 3D as well. The inspector attempts WebGPU on a secure context and falls back to WebGL 2. The playable FPS uses WebGL 2.
- A signed-in player can briefly lose connection without forfeiting the current seat: the client retries while the match is running and the server reserves the seat for up to 35 seconds. This does not restore rooms after a service restart.

### Controls

| Action                                      | Desktop                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Move / look                                 | **WASD** / mouse. Click the field to capture; drag or use arrows if capture is unavailable. |
| Fire / aim                                  | Left / right mouse button                                                                   |
| Sprint / tactical sprint                    | Hold **Shift** / double-tap **Shift** or press **X** while moving forward                   |
| Crouch / slide                              | **C** or **Ctrl**; crouch while sprinting to slide                                          |
| Jump / mantle                               | **Space**; hold it while moving into a ledge or ladder to climb                             |
| Jump from aircraft / open chute / cut chute | **Space** / **Space** / **C** at sufficient altitude                                        |
| Interact / reload                           | **E** / **R**. Use **E** at launch posts and with field staff.                              |
| Insert plates / deploy armor box            | Hold **G** or **4** / **Q**                                                                 |
| Primary / sidearm / tactical gear           | **1** / **2** / **V**                                                                       |
| Squad revive or self-revive                 | Hold **F** beside a downed teammate, or while downed with a kit                             |
| Squad waypoint / map                        | **Z** or middle mouse / **M**. Mark a point or danger on the map.                           |
| Scoreboard / pause                          | **Tab** / **Esc** or **P**                                                                  |
| Echo Range drills / armor test              | **B** / **T**                                                                               |

On touch, use the movement stick, swipe to look, and use the action buttons. Hold **Armor** to insert plates, and tap the tactical map to mark a location. Keyboard map users can focus the map, move the cursor with the arrows, and press Enter.

There are **100 health** and up to **150 armor**. Each full plate insertion takes 1.15 seconds and restores up to 50 armor; damage interrupts it without consuming the plate. Carry five reserves, or eight with an armor satchel. Quartermasters refill reserve ammunition and tactical charges, and medics can restore up to 42 health. Each successful field service is limited to once per operator per match.

**Performance**, **Balanced**, **High**, and **Ultra** change render scale, draw distance, and effect budgets. High and Ultra enable shadows. Resolution adapts to frame time. Performance is the touch default.

## Host the full site

```sh
npm ci
npm run build
NODE_ENV=production npm start
```

Terminate HTTPS at your reverse proxy and forward `/ws` upgrades along with the site and `/api/*` routes. `GET /health` checks the Node process. Configure `NDX_PUBLIC_ORIGIN` if the proxy rewrites `Host`. Serve a single instance per room pool: matches and reserved seats are in memory. Accounts, equipment, reports, live configuration, and career results are persisted in SQLite; put the database on a persistent volume and back it up using a SQLite-aware backup.

| Environment variable | Default                             | Effect                                                                          |
| -------------------- | ----------------------------------- | ------------------------------------------------------------------------------- |
| `PORT`               | `5173`                              | Production HTTP and WebSocket port                                              |
| `NDX_BIND_HOST`      | `0.0.0.0`                           | Bind address; set `127.0.0.1` when using a local reverse proxy on the same host |
| `NDX_DB_PATH`        | `.local/ndx-combat/accounts.sqlite` | Server-side account database file                                               |
| `NDX_PUBLIC_ORIGIN`  | Request host                        | Exact public origin, such as `https://combat.example.com`                       |
| `NDX_TRUST_PROXY`    | Off                                 | Set to `1` only when a trusted proxy supplies `X-Forwarded-For` for rate limits |
| `MATCH_CAPACITY`     | `100`                               | Maximum operators per room (2–100), including bots                              |
| `MAX_ROOMS`          | `12`                                | Maximum rooms per process                                                       |
| `ONLINE_BOTS`        | `39`                                | Bot-fill target for public BR/Resurgence with one human, subject to capacity    |

Sessions use HttpOnly cookies and same-origin writes. Use HTTPS for the production setting; the Arena HTTPS preview uses a partitioned cookie for its cross-site frame. The server runs authoritative matches at 30 Hz and publishes snapshots at roughly 10 Hz; clients predict local movement and interpolate other operators.

### Provision the owner

Run `npm run owner:create` **once** in the private deployment shell, with the same `NDX_DB_PATH` as the server. It creates the reserved `NDX` owner with a random password and prints the recovery code once. Keep those values private. There is no default production password or browser action that can turn a player into the owner.

The owner starts at rank 100 with every cosmetic and unlimited credits. **Owner console** manages players, grants, progression, reports, suspensions, announcements, XP events, online playlist availability, and Store listings. Changes are audited. Do not expose the optional loopback-only development bootstrap through a proxy; it requires password rotation before the database can be opened in a normal deployment.

### Static edition (GitHub Pages)

```sh
npm run build:pages
npm run test:pages
npx vite preview --mode pages
```

Publish `out/pages/` to a static host. The **Publish NDX Combat website** workflow deploys that edition from `main` to [the repository’s GitHub Pages site](https://robloxgamee1231-ctrl.github.io/NDX-WARZONE/). It runs at a project subpath, with local bot matches, training, armory, and browser-local records. It has **no accounts, career storefront, live rooms, or leaderboard**; use the Node service for those features.

## Art and map sources

Neon District is an editable [Blender scene](assets-source/maps/neon-district.blend) with packed original textures and spawn/relay locators. The client ships a Meshopt-compressed GLB under 1 MiB with a procedural collision-layout fallback. The launcher image is concept art, not an in-game screenshot. Rebuild the scene, collision metadata, and browser asset with Blender 4.2 and:

```sh
blender -b --python tools/build-neon-district.py
npm run assets:neon
```

For engine interchange use `out/ndx-assets/neon-district.glb`, the uncompressed export. Collision, spawns, and objective rules are NDX game data, not a portable engine scene. The shipped game runs on Three.js; the Godot Web experiment was not a gameplay port. See [asset credits](public/models/CREDITS.md) and [design notes](docs/gameplay-reference.md).

## Verify

```sh
npm test                 # gameplay, maps, compression, accounts, and rooms
npm run check:models     # GLB dependencies, animations, credits, and size limits
npm run test:capacity    # 100 WebSocket clients on one short simulation
npm run build
npm run test:production  # isolated production HTTP, assets, and live rooms
npm run build:pages
npm run test:pages       # check the project-relative static artifact
npm run format:check
```

With Chromium installed (`npx playwright-core install chromium` or `CHROMIUM_PATH=/path/to/chromium`), `npm run test:browser` covers desktop, touch emulation, and private-room play against a running server. `npm run test:combat` launches an isolated service from `dist/`, uses two signed-in browser sessions, completes a real public Gun Game round, and reopens the database to verify career progress. Set `NDX_PAGES_BROWSER=1` to include nested-URL Chromium QA in `test:pages`, `NDX_SOFTWARE=1` for software rendering, or `NDX_QA_SCREENSHOTS=out/browser` for screenshots.

The capacity test is not a test of 100 rendered browsers. Physical Android performance and sustained hosting capacity should be measured on the target devices and network.
