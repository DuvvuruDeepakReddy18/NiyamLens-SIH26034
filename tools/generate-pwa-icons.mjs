import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'public', 'icon.svg')

for (const size of [192, 512]) {
  await sharp(source, { density: 384 })
    .resize(size, size)
    .flatten({ background: '#102a33' })
    .png({ compressionLevel: 9 })
    .toFile(path.join(root, 'public', `icon-${size}.png`))
}

await sharp(source, { density: 384 })
  .resize(410, 410)
  .extend({ top: 51, bottom: 51, left: 51, right: 51, background: '#102a33' })
  .flatten({ background: '#102a33' })
  .png({ compressionLevel: 9 })
  .toFile(path.join(root, 'public', 'icon-maskable-512.png'))

console.log('Generated 192 px, 512 px and maskable NiyamLens PWA icons.')

await sharp(path.join(root, 'public', 'sample-real-label.svg'), { density: 144 })
  .png({ compressionLevel: 9 })
  .toFile(path.join(root, 'public', 'sample-real-label.png'))

console.log('Generated the supported PNG browser-QA label fixture.')
