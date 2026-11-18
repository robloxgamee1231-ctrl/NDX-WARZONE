// Use Vite's base for files in public/, including under a Pages project path.
// Node imports (tests and the game server) do not have a Vite environment.
const base = import.meta.env?.BASE_URL ?? '/'
export const assetUrl = (path) => `${base}${path}`
export const LIVE_ROOMS = import.meta.env?.MODE !== 'pages'
