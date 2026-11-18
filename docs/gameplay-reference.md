# Gameplay reference notes

NDX is a separate browser game. These references influenced interface and pacing decisions; none of their footage, images, map layouts, or game files are shipped.

## Material reviewed

- **Call of Duty: Warzone — Battle Royale**, [official Call of Duty trailer](https://www.youtube.com/watch?v=XSKre3y6UEI). Reviewed the published transcript and description, not video playback. Gas and squad survival are the through line; redeployment is subordinate to the battle-royale end condition.
- **Verdansk Map Flythrough**, [published trailer description](https://www.youtube.com/watch?v=RUuMHyyOAYg), and the [published Verdansk tac-map image](https://windowscentral.com/gaming/everything-we-know-about-the-return-of-verdansk-to-call-of-duty-warzone). The image makes named districts legible at map scale and keeps the road system visible underneath. NDX retained its original terrain and site names, then added map-callout placement and keyboard navigation.
- **Combat Master — Welcome to Combat Zone!**, [Alfa Bravo’s release post](https://steamcommunity.com/games/2281730/announcements/detail/3872597312424521021). Reviewed the official release text and the published airborne gameplay still: freefall hands frame the view, marked landmarks are visible from above, and speed/ground indicators remain readable. NDX added airborne altitude, vertical speed, waypoint distance, and a selectable drop point. The post also describes aerial traversal pads and in-match loadout drops. NDX implements original lift locations and reinforcement drops with its own positions, timing, and claim rules.
- **Combat Master**, [official store listing](https://store.steampowered.com/app/2281730/Combat_Master/). Used the published focus on fast movement and Gunsmith as a design reference for the timed movement circuit and attachment tradeoffs. No direct footage playback was available in this session.

## NDX-specific decisions

| Goal                                           | Implementation                                                                                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep fast movement learnable                   | Momentum Circuit isolates sprint turns, concrete steps, and mantles; free practice remains unchanged.                                                            |
| Make armor feedback testable                   | Armor Under Pressure times the same authoritative damage and plate logic used in matches.                                                                        |
| Make squad movement actionable                 | A map click or keyboard-driven position posts a team-only waypoint. Gas, launch posts, supply drops, and relays have independent icons.                          |
| Add an objective mode without slowing movement | Domination uses three simultaneous relays. Progress freezes on a contest, holding earns score, and tight final contests can extend the clock.                    |
| Limit startup cost                             | Per-session lazy loading, near-player animation budgets by quality, instanced prop geometry, revalidatable production textures/models, and procedural fallbacks. |

Model and texture provenance is separate: [asset credits](../public/models/CREDITS.md).

## Field Command expansion

- **Floodline** follows the idea of distinct drop districts connected by traversable routes, but uses NDX-authored terrain, a winding dry spillway, three crossings, its own district names, and a different flight path. The launcher image is original concept art, not a screenshot of the playable geometry.
- **Relay Works** is an original three-relay arena. Ground routes run through the turbine hall and around the yards; a raised route gives players another angle without counting toward capture on the ground below.
- The **Mistral-3**, **Bulwark-47**, and **Harrier-12** are original stylized game props, not copied weapon art. Finishes and operator dyes use local material variants. Combat NPC rules and noncombatant service NPCs are implemented in NDX's own simulation.

## NDX Combat / After Hours

| Goal                            | Decision                                                                                                                                                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Learn the arena in a few rounds | Neon District offers a visible center crossing, a raised route with stairs at both ends, and flanks through two distinct courtyards. Aster and Ember signage distinguishes opposite sides.                                                                  |
| Reward different play styles    | Gun Game changes weapons after each elimination and keeps the tier on respawn. Kill Confirmed rewards moving to a tag, not just registering a kill. Domination relays reward presence and deny points while contested.                                      |
| Keep the entry path simple      | Local play has no sign-in requirement. The same core movement and game rules run locally and on the server. Private games let players learn objectives without affecting ranks.                                                                             |
| Separate look from combat power | The seven standard weapons and gameplay attachments are available immediately. Store unlocks are finish and outfit variants only; the server verifies ownership for live rooms.                                                                             |
| Make browser graphics resilient | Meshopt keeps the Neon District payload under 1 MiB. The game and bots share deterministic collision/spawn data, so a model-load failure does not break traversal. WebGPU experimentation is confined to the Armory/Store inspector, with WebGL 2 recovery. |

### Scene interchange

The `.blend` source contains separate editable pieces, packed textures, and named locators. The exporter combines only render geometry by sector for browser delivery. Use the raw GLB in `out/ndx-assets/` when trying the scene in another editor rather than requiring that editor to decode the browser's Meshopt extension. A custom Godot Web runtime was booted as an experiment, but that build did not include the glTF import classes. No Godot asset import or engine migration is claimed.
