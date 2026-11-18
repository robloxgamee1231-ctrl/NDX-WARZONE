import { AccountStore } from '../server/accounts/store.js'
import { token } from '../server/accounts/security.js'

// Explicit deployment-shell command. No default password or HTTP elevation.
const store = new AccountStore()
try {
  const password = token()
  const { recovery } = await store.register('NDX', password, { owner: true })
  console.log(
    `Created owner on this database. Save these values privately; they are shown once.\nUsername: NDX\nTemporary random password: ${password}\nRecovery code: ${recovery}`,
  )
} finally {
  store.close()
}
