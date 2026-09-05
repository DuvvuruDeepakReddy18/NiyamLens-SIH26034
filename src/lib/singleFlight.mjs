// Serialize the whole refresh, not just the outbox transport. Keyed instances
// must be replaced when workspace identity changes.
export function singleFlight(task) {
  let active = null
  return (...args) => {
    if (!active) active = Promise.resolve().then(() => task(...args)).finally(() => { active = null })
    return active
  }
}
