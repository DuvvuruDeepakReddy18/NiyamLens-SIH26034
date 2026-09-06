// Explicit browser integration check, not part of the fast node unit suite.
// Start the local Vite test server first; no model inference or accuracy claim.
import assert from 'node:assert/strict'
import { launchTestBrowser } from '../tools/browser-runtime.mjs'
import { localPilotOrigin } from '../tools/run-browser-field-pilot.mjs'

const origin = localPilotOrigin(process.env.NIYAMLENS_BASE_URL || 'http://127.0.0.1:4195/')
const browser = await launchTestBrowser()
try {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  const page = await context.newPage()
  await page.goto(origin)
  const results = await page.evaluate(async () => {
    const { createPaddleRetryInput, PADDLE_RETRY_MODES } = await import('/src/lib/paddleRetryInput.mjs')
    const source = document.createElement('canvas')
    source.width = 12; source.height = 8
    const ctx = source.getContext('2d')
    const pixels = ctx.createImageData(12, 8)
    for (let y = 0; y < 8; y++) for (let x = 0; x < 12; x++) {
      const i = (y * 12 + x) * 4
      pixels.data.set([y * 12 + x, 0, 0, 255], i)
    }
    ctx.putImageData(pixels, 0, 0)
    const original = source.toDataURL('image/png')
    const item = { id: 'asymmetric-pixel-grid', originalUrl: original, analysisUrl: original, analysisWidth: 12, analysisHeight: 8 }
    const results = []
    for (const [mode, configuration] of Object.entries(PADDLE_RETRY_MODES)) {
      const frame = await createPaddleRetryInput(item, mode)
      const rotated = frame.input.getContext('2d').getImageData(0, 0, frame.width, frame.height).data
      const expectedWidth = configuration.rotation % 180 ? 8 : 12
      const expectedHeight = configuration.rotation % 180 ? 12 : 8
      let pixelMismatches = 0
      for (let y = 0; y < 8; y++) for (let x = 0; x < 12; x++) {
        const [rx, ry] = { 0: [x, y], 90: [7 - y, x], 180: [11 - x, 7 - y], 270: [y, 11 - x] }[configuration.rotation]
        const index = (ry * expectedWidth + rx) * 4
        for (let channel = 0; channel < 4; channel++) if (rotated[index + channel] !== (channel === 3 ? 255 : y * 12 + x)) pixelMismatches++
      }
      const png = new Image()
      await new Promise((resolve, reject) => { png.onload = resolve; png.onerror = reject; png.src = frame.previewUrl })
      const preview = document.createElement('canvas'); preview.width = png.naturalWidth; preview.height = png.naturalHeight
      preview.getContext('2d').drawImage(png, 0, 0)
      const decoded = preview.getContext('2d').getImageData(0, 0, preview.width, preview.height).data
      results.push({ mode, width: frame.width, height: frame.height, expectedWidth, expectedHeight, pixelMismatches, previewExact: decoded.length === rotated.length && decoded.every((value, index) => value === rotated[index]), originalUnchanged: item.originalUrl === original && source.toDataURL('image/png') === original, sourceBound: frame.sourceBinding.originalUrl === original && frame.sourceBinding.analysisUrl === original, source: frame.source })
    }
    return results
  })
  for (const result of results) {
    assert.equal(result.width, result.expectedWidth)
    assert.equal(result.height, result.expectedHeight)
    assert.equal(result.pixelMismatches, 0, `${result.mode}: wrong rotation or channel pixels`)
    assert.equal(result.previewExact, true)
    assert.equal(result.originalUnchanged, true)
    assert.equal(result.sourceBound, true)
  }
  console.log(JSON.stringify({ kind: 'actual-browser-canvas-orientation-pixel-check-not-recognition-accuracy', results }, null, 2))
} finally {
  await browser.close()
}
