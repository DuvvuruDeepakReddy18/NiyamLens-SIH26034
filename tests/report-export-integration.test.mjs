import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Source integration contracts supplement the executable lifecycle and native
// DOCX tests. They are not presented as React rendering or real download tests.
const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
const component = await readFile(new URL('../src/ReportDownloads.jsx', import.meta.url), 'utf8')
const modal = app.slice(app.indexOf('function ReportModal('), app.indexOf('function ', app.indexOf('function ReportModal(') + 9))

test('actual evidence report uses the shared export component with per-case identity', () => {
  assert.match(app, /import ReportDownloads from '\.\/ReportDownloads\.jsx'/)
  assert.match(modal, /<ReportDownloads key=\{record\.id\} record=\{record\} \/>/)
  assert.doesNotMatch(modal, /createObjectURL|revokeObjectURL|anchor\.click|const downloadWord/)
})

test('actual export component preserves complete JSON and delegates DOCX to the native generator', () => {
  assert.match(component, /JSON\.stringify\(record, null, 2\)/)
  assert.match(component, /import\('\.\/lib\/reportDocument\.mjs'\)/)
  assert.match(component, /return buildInspectionDocx\(record\)/)
  assert.doesNotMatch(component, /text\/html|application\/msword|\.doc['"`]/)
  assert.match(component, /controller\.dispose\(\)/)
  assert.match(component, /\}, \[record\]\)/)
})

test('actual UI requires a separate save gesture and offers persistent fallback plus selected-copy verification', () => {
  assert.match(component, /onClick=\{save\}/)
  assert.match(component, /window\.showSaveFilePicker\.bind\(window\)/)
  assert.match(component, /<a href=\{artifact\.url\} download=\{artifact\.name\}/)
  assert.match(component, /noteDownloadRequested\(\)/)
  assert.match(component, /type="file" hidden accept=/)
  assert.match(component, /event\.target\.files\?\.\[0\]/)
  assert.match(component, /controllerRef\.current\?\.verify\(copy\)/)
  assert.match(component, /role=\{state\.phase === 'error' \? 'alert' : 'status'\}/)
  assert.doesNotMatch(component, /URL\.revokeObjectURL|document\.createElement\('a'\)|\.click\(\).*\.revokeObjectURL/)
})
