// Experiment-only adapter: installed Tesseract.js Node getCore ignores corePath.
// Select its unmodified portable LSTM core to test floating-point best weights.
// Equivalent production-browser selection would need separate compatibility QA.
const { parentPort } = require('node:worker_threads')
const worker = require('tesseract.js/src/worker-script')
const gunzip = require('tesseract.js/src/worker-script/node/gunzip')
const cache = require('tesseract.js/src/worker-script/node/cache')
parentPort.on('message', packet => worker.dispatchHandlers(packet, obj => parentPort.postMessage(obj)))
worker.setAdapter({
  getCore: async (oem, options, res) => {
    res.progress({ status: 'loading portable tesseract core', progress: 0 })
    const core = require('tesseract.js-core/tesseract-core-lstm')
    res.progress({ status: 'loading portable tesseract core', progress: 1 })
    return core
  },
  gunzip,
  fetch: global.fetch,
  ...cache,
})
