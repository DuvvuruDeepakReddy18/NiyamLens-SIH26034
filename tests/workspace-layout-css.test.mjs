import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const workspace = readFileSync(new URL('../src/workspace.css', import.meta.url), 'utf8')

test('workspace chrome shares one desktop rail width and clears it', () => {
  assert.match(styles, /--sidebar-width:\s*258px/)
  assert.match(styles, /\.sidebar\s*\{[^}]*width:\s*var\(--sidebar-width\)/s)
  assert.match(styles, /\.page-frame\s*\{[^}]*margin-left:\s*var\(--sidebar-width\)/s)
  assert.match(workspace, /\.workspace-strip\s*,\s*\.workspace-error\s*\{[^}]*margin-left\s*:\s*var\(\s*--sidebar-width\s*,\s*258px\s*\)/s)
})

test('workspace chrome returns to full width below the navigation breakpoint', () => {
  assert.match(workspace, /\.workspace-strip\{[^}]*z-index:20/s)
  assert.match(workspace, /@media\s*\(\s*max-width\s*:\s*820px\s*\)\s*\{\s*\.workspace-strip\s*,\s*\.workspace-error\s*\{[^}]*margin-left\s*:\s*0/s)
  assert.match(styles, /@media\s*\(max-width:\s*820px\)\s*\{[\s\S]*?\.page-frame\s*\{\s*margin-left:\s*0;/)
})
