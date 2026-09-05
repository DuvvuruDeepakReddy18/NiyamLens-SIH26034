import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { scoreWorkflowStudy } from '../src/lib/workflowStudy.mjs'
import { readBoundedFile } from './verify-cloud-export.mjs'

const [input, output] = process.argv.slice(2)
if (!input || !output || resolve(input) === resolve(output)) throw new Error('Usage: node tools/score-workflow-study.mjs INPUT.json NEW-OUTPUT.json')
const result = scoreWorkflowStudy(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedFile(input, 2_000_000))))
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' })
console.log(`Recorded ${result.trials} attempts; ${result.validPairs.length} quality-adjudicated pairs. Unreviewed/failed attempts were not counted as successful time savings.`)
