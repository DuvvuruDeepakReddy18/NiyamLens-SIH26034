export const OCR_LIMITS = Object.freeze({ initializeMs: 90000, passMs: 60000, totalMs: 300000 })
export const abortError = (message = 'OCR cancelled. Previous evidence was preserved.') => Object.assign(new Error(message), { name: 'AbortError' })
export function throwIfAborted(signal) { if (signal?.aborted) throw abortError() }

// Race external work against a real deadline. Late workers are disposed, never
// published to an unmounted inspection. Rejecting alone cannot stop WASM: the
// caller must terminate its worker in finally.
export function boundedOcr(promise, { signal, timeoutMs = OCR_LIMITS.passMs, label = 'OCR', onLateResolve } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); fn(value) }
    const cancel = () => finish(reject, abortError())
    const timer = setTimeout(() => finish(reject, new Error(`${label} timed out. Try a smaller crop or a clearer photo.`)), timeoutMs)
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
    Promise.resolve(promise).then((value) => {
      if (settled) { Promise.resolve().then(() => onLateResolve?.(value)).catch(() => {}); return }
      finish(resolve, value)
    }, (error) => finish(reject, error))
  })
}

export function ocrController(parentSignal, totalMs = OCR_LIMITS.totalMs) {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  parentSignal?.addEventListener('abort', cancel, { once: true })
  if (parentSignal?.aborted) cancel()
  const timer = setTimeout(cancel, totalMs)
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); parentSignal?.removeEventListener('abort', cancel) } }
}
