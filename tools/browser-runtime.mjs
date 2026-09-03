import process from 'node:process'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

export function launchTestBrowser() {
  const configuredPath = process.env.NIYAMLENS_BROWSER_PATH?.trim()
  const systemCandidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      ]
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  const executablePath = configuredPath || systemCandidates.find((candidate) => existsSync(candidate))
  return chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  })
}
