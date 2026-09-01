const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
  return value
}

const digest = async (value) => {
  const bytes = new TextEncoder().encode(JSON.stringify(stable(value)))
  const buffer = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function appendAuditEvent(chain = [], type, payload = {}, actor = 'local-officer') {
  const previousHash = chain.at(-1)?.hash || 'GENESIS'
  const event = { index: chain.length, type, actor, at: new Date().toISOString(), payload, previousHash }
  return [...chain, { ...event, hash: await digest(event) }]
}

export async function verifyAuditChain(chain = []) {
  for (let index = 0; index < chain.length; index += 1) {
    const event = chain[index]
    const { hash, ...unsigned } = event
    if (unsigned.index !== index) return false
    if (unsigned.previousHash !== (index ? chain[index - 1].hash : 'GENESIS')) return false
    if (await digest(unsigned) !== hash) return false
  }
  return true
}

