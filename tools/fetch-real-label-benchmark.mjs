import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const manifestPath = path.join(root, 'datasets', 'openfoodfacts-india', 'real-labels.manifest.json')
const outputRoot = path.join(root, 'datasets', 'openfoodfacts-india', 'real-labels')
const bucket = 'https://openfoodfacts-images.s3.eu-west-3.amazonaws.com/'
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const userAgent = 'NiyamLens-SIH26034/0.2.1 (https://github.com/DuvvuruDeepakReddy18/NiyamLens-SIH26034)'

const sourcePrefix = (code) => `data/${code.slice(0, 3)}/${code.slice(3, 6)}/${code.slice(6, 9)}/${code.slice(9)}/`

async function download(url, destination) {
  const response = await fetch(url, { headers: { 'User-Agent': userAgent } })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  await writeFile(destination, bytes)
  return bytes.length
}

let imageCount = 0
let totalBytes = 0
for (const product of manifest.products) {
  const productDirectory = path.join(outputRoot, product.code)
  await mkdir(productDirectory, { recursive: true })
  for (const image of product.images) {
    const prefix = sourcePrefix(product.code)
    const imageUrl = `${bucket}${prefix}${image.imageId}.jpg`
    const googleVisionUrl = `${bucket}${prefix}${image.imageId}.json.gz`
    const imagePath = path.join(productDirectory, `${image.imageId}.jpg`)
    const annotationPath = path.join(productDirectory, `${image.imageId}.google-vision.json.gz`)
    const [imageBytes, annotationBytes] = await Promise.all([
      download(imageUrl, imagePath),
      download(googleVisionUrl, annotationPath),
    ])
    image.sourceUrl = imageUrl
    image.googleVisionAnnotationUrl = googleVisionUrl
    image.localPath = `datasets/openfoodfacts-india/real-labels/${product.code}/${image.imageId}.jpg`
    image.googleVisionLocalPath = `datasets/openfoodfacts-india/real-labels/${product.code}/${image.imageId}.google-vision.json.gz`
    image.bytes = imageBytes
    image.googleVisionBytes = annotationBytes
    totalBytes += imageBytes + annotationBytes
    imageCount += 1
  }
}

await writeFile(path.join(outputRoot, 'downloaded-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify({ imageCount, totalBytes, outputRoot }, null, 2))
