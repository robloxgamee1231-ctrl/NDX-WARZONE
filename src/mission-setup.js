import { DIFFICULTIES, STANDARD_DIFFICULTY } from './game/difficulty.js'
import { mapsForMode } from './game/map-catalog.js'
import { icon } from './icons.js'
import { assetUrl } from './site.js'

export function missionSetup(mode, map, difficulty, online) {
  const maps = mapsForMode(mode)
  const training = mode.map === 'range'
  return `<div class="mission-kicker mono"><span>${icon('squad', 18)} ${mode.name.toUpperCase()}</span><b>${training ? 'LIVE-FIRE PRACTICE' : online ? 'PUBLIC MATCHMAKING' : 'LOCAL OPERATION'}</b></div>
  <div class="setup-heading"><div><small class="eyebrow">01 / SELECT BATTLEFIELD</small><h3>Choose your ground.</h3></div><span>${maps.length} ${maps.length === 1 ? 'LOCATION' : 'LOCATIONS'}</span></div>
  <div class="map-choices" role="group" aria-label="Battlefields">${maps.map((m) => `<button class="map-choice" type="button" data-battlefield="${m.id}" aria-pressed="${m.id === map.id}" aria-label="${m.name}"><img src="${assetUrl(`media/${m.art}.webp`)}" alt="" width="320" height="145" /><div class="map-choice-copy"><span class="mono">${m.sector}${m.id === 'floodline' || m.id === 'relay-works' ? ' / NEW' : ''}</span><strong>${m.name}</strong><small>${m.subtitle}</small><span class="map-choice-detail">${m.description}</span></div><i>${icon('check', 15)}</i></button>`).join('')}</div>
  ${
    training
      ? `<p class="setup-note">No hostile NPCs. Coach Vale is beside the starting lane and can open the drill board.</p>`
      : `<div class="setup-heading"><div><small class="eyebrow">02 / SET NPC DIFFICULTY</small><h3>${online ? 'Public field rules.' : 'Set the challenge.'}</h3></div>${icon('reticle', 19)}</div>
    ${
      online
        ? `<p class="setup-note">Public lobbies use <b>${DIFFICULTIES[STANDARD_DIFFICULTY].name}</b> for everyone. Turn off Public matchmaking or host a private room to choose difficulty.</p>`
        : `<div class="difficulty-choices" role="group" aria-label="NPC difficulty">${Object.entries(
            DIFFICULTIES,
          )
            .map(
              ([id, d], i) =>
                `<button class="difficulty-choice" type="button" aria-label="${d.name}" data-difficulty="${id}" aria-pressed="${id === difficulty}"><span class="challenge-bars" aria-hidden="true">${[0, 1, 2, 3].map((n) => `<i class="${n <= i ? 'lit' : ''}"></i>`).join('')}</span><strong>${d.name}</strong><small>${d.detail}</small></button>`,
            )
            .join('')}</div>`
    }`
  }
  <div class="panel-cta"><button class="btn secondary" type="button" data-action="close">Done ${icon('check', 15)}</button><button class="btn primary" type="button" data-action="deploy">${icon('play', 15)} ${training ? 'Enter range' : 'Deploy now'}</button></div>`
}
