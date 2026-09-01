import process from 'node:process'
import { chromium } from 'playwright'

export function launchTestBrowser() {
  const executablePath = process.env.NIYAMLENS_BROWSER_PATH?.trim()
  return chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  })
}
