const glyphs = {
  play: '<path d="m9 5 11 7-11 7z"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-12h-7z"/>',
  crosshair:
    '<circle cx="12" cy="12" r="7"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/>',
  reticle: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6m-3-12v6m-3-3h6"/>',
  diamond: '<path d="m12 3 9 9-9 9-9-9z"/><path d="m12 9 3 3-3 3-3-3z"/>',
  radio:
    '<path d="M4 19h16M7 19l5-13 5 13M9 14h6M7 4a6 6 0 0 0 0 7m10-7a6 6 0 0 1 0 7"/>',
  squad:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-4M15 3a4 4 0 0 1 0 8"/><circle cx="9" cy="7" r="4"/>',
  person:
    '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  lock: '<rect x="4" y="10" width="16" height="12" rx="2"/><path d="M8 10V6a4 4 0 1 1 8 0v4m-4 5v2"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7h14M5 17h14"/>',
  keyboard:
    '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M8 16h8"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M21 14v-4l-3-.5-.7-1.5 1.6-2.5-2.8-2.8L13.5 4 12 3.5 11.5 1h-3l-.8 3-1.5.6L3.7 3l-2 3L3 8.5l-.5 1.8L1 11v3l2.5.7.7 1.6L3 18.7 5.5 21l2.6-1.4 1.6.6.5 2.3h3.5l.6-2.5 1.6-.6 2.5 1.4 2.2-2.6-1.6-2.3.6-1.5z" transform="translate(1 0) scale(.96)"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  pin: '<path d="M20 10c0 6-8 11-8 11s-8-5-8-11a8 8 0 1 1 16 0z"/><circle cx="12" cy="10" r="2.5"/>',
  network:
    '<rect x="8" y="2" width="8" height="5"/><rect x="2" y="17" width="8" height="5"/><rect x="14" y="17" width="8" height="5"/><path d="M12 7v5M6 17v-5h12v5"/>',
  monitor:
    '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 22h8m-4-5v5"/>',
  plate: '<path d="M7 3h10l4 5v12l-2 2H5l-2-2V8z"/><path d="M7 9h10m-10 4h6"/>',
  pack: '<path d="M5 8a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v12H5zM9 4V2h6v2M5 11h14m-9 3h4v3h-4z"/>',
  box: '<path d="m3 7 9-4 9 4v12l-9 3-9-3z"/><path d="m3 7 9 4 9-4m-9 4v11M8 5l8 4"/>',
  ammo: '<path d="m6 3 2 3v13H4V6zm6 0 2 3v13h-4V6zm6 0 2 3v13h-4V6zM3 22h18"/>',
  cash: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/>',
  parachute:
    '<path d="M2 10a10 8 0 0 1 20 0zM2 10l10 11 10-11M8 10l4 11 4-11M8 10c0-5 2-8 4-8s4 3 4 8"/>',
  trophy:
    '<path d="M8 3h8v7a4 4 0 1 1-8 0zm0 2H3v3a4 4 0 0 0 5 4m8-7h5v3a4 4 0 0 1-5 4m-4 2v5m-5 3h10m-8-3h6v3H9z"/>',
  skull:
    '<path d="M5 15a8 8 0 1 1 14 0l-2 2v4H7v-4z"/><circle cx="9" cy="11" r="1.3"/><circle cx="15" cy="11" r="1.3"/><path d="M10 18v3m4-3v3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  cart: '<path d="M2 3h3l3 12h11l3-9H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  exit: '<path d="M10 3H3v18h7m4-14 5 5-5 5m-7-5h12"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  rotate: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7"/>',
  phone:
    '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  aim: '<path d="M12 2v3m0 14v3M2 12h3m14 0h3"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/>',
  jump: '<path d="M5 19h14M12 15V4m-5 5 5-5 5 5"/>',
  weather:
    '<path d="M5 17a4 4 0 1 1 1-8 6 6 0 0 1 11-1 4.5 4.5 0 1 1 2 9zM6 21h11"/>',
  slide: '<path d="M4 17h16m-14-5h11l-5-5m5 5-5 4"/>',
}

export function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[name] || glyphs.diamond}</svg>`
}

export const logo = `<svg viewBox="0 0 44 44" fill="none" aria-hidden="true"><path d="M22 1.5 42.5 22 22 42.5 1.5 22 22 1.5Z" fill="#12242c" stroke="currentColor" stroke-width="1.25"/><path d="M11 26.5 20 10h4l-2.2 8 6.7-5.4h4.8L24 34h-4.2l2.2-10.3-6.7 2.8H11Z" fill="currentColor"/><path d="M4 22h3m30 0h3M22 4v3m0 30v3" stroke="currentColor" opacity=".55"/></svg>`

export function weaponArt(id, className = '') {
  if (id === 'spectre')
    return `<svg viewBox="0 0 312 100" fill="none" class="${className}" aria-hidden="true"><g fill="#344752" stroke="#94aeb7" stroke-width="1.4" stroke-linejoin="round"><path d="M70 22h141l11 5v21h-83l-18 16-11 29H77l8-41H68z"/><path d="M128 48h45l-5 23h-49m-39-50v-8h17l5 8m101 0v-8h12v9M87 59h31m-37 8h34m-36 9h33m-37 8h31M79 36h130"/></g></svg>`
  const silhouettes = {
    mistral:
      '<path d="M17 40h42l16-7h78l6 6h62v20h-69l-9 8h-12l5 25h-20l-14-28H73l-12-6H37L28 75H15z"/><path d="M224 44h36v10h-36zm37-4h28v17h-28zM88 29h118v7H88zm83 17h37m-38 7h39"/>',
    bulwark:
      '<path d="M11 40h49l12-9h90l13 6h64v27h-78l-12 11H75l-14-9H25L19 83H9z"/><path d="M238 43h48v12h-48zm42-3h28v18h-28zM100 71h71v25h-71zm14-41V16h55v15m-44-10h29v8h-29zm47 22h45m-45 10h45m28 8-9 23 12 2 10-24"/>',
    harrier:
      '<path d="M12 40h39l27-8h64l13 7h123v10H142v14l-19 4-22-3-7 12H80l-8-15-38 5-7 16H12z"/><path d="M153 53h73v14h-73zm72 0h29v8h-29zm58-15h22v14h-22zM105 65v14h24l9-13m25-11v9m12-9v9m12-9v9m12-9v9m12-9v9m61-35h7v7h-7"/>',
  }
  if (Object.hasOwn(silhouettes, id))
    return `<svg viewBox="0 0 312 100" fill="none" class="${className}" aria-hidden="true"><g fill="#344752" stroke="#94aeb7" stroke-width="1.3" stroke-linejoin="round">${silhouettes[id]}</g></svg>`
  const long = id === 'kestrel',
    short = id === 'viper'
  return `<svg viewBox="0 0 312 100" fill="none" class="${className}" aria-hidden="true">
    <defs><linearGradient id="rifle-${id}" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#596c77"/><stop offset="1" stop-color="#202c37"/></linearGradient></defs>
    <g stroke="#95aab5" stroke-width="1.05" stroke-linejoin="round" fill="url(#rifle-${id})">
      <path d="M18 42h44l13-6h53l10 5h${short ? 79 : 101}v${long ? 17 : 19}h-96l-12 10H75l-18-6H25L18 77h-8V38h8z"/>
      <path d="M${short ? 215 : 237} 45h${long ? 61 : short ? 34 : 45}v8h-${long ? 61 : short ? 34 : 45}z"/><path d="M${long ? 287 : short ? 239 : 270} 42h${long ? 19 : 21}v14h-${long ? 19 : 21}z"/>
      <path d="M116 61h30l${short ? '4' : '8'} 32h-23zM85 65h15l-2 8-6 13H78z"/><path d="M101 65v11h16l7-10m14-2h90" fill="none"/>
      <path d="M76 34h153v5H76zM${long ? 112 : 119} 34v-9h${long ? 76 : 29}v9"/><path d="M${long ? 104 : 118} 24h${long ? 92 : 31}v-9h-${long ? 92 : 31}z"/>
      <path d="M27 49h30l11-4m9 3h57m-57 8h20m51-8h68m-68 6h68m-85 19 6 14m5-16 5 15" fill="none" opacity=".45"/>
      <path d="M157 43v16m8-16v16m8-16v16m8-16v16m8-16v16m8-16v16m8-16v16" fill="none" opacity=".3"/>
      <path d="M103 52h25v7h-25z" fill="#263540"/><circle cx="108" cy="55" r="1.5" fill="#9bd8dd" stroke="none"/>
    </g></svg>`
}
