import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { HttpError } from './security.mjs'
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 25_000_000
export const MAX_IMAGE_AXIS = 10000
export const detectedMime = (bytes) => bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP' ? 'image/webp' : null
export async function validateImageBytes(content, mime) {
  if (!Buffer.isBuffer(content) || !content.length || content.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'Evidence must contain at most 15 MB of image bytes.')
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime) || detectedMime(content) !== mime) throw new HttpError(422, 'Evidence must be a JPEG, PNG or WebP image matching its declared type.')
  const decoder = sharp(content, { failOn: 'warning', limitInputPixels: MAX_IMAGE_PIXELS, animated: false }).timeout({ seconds: 5 })
  try {
    const metadata = await decoder.metadata()
    if (`image/${metadata.format}` !== mime || !Number.isSafeInteger(metadata.width) || !Number.isSafeInteger(metadata.height) || metadata.width < 1 || metadata.height < 1 || metadata.width > MAX_IMAGE_AXIS || metadata.height > MAX_IMAGE_AXIS || metadata.width * metadata.height > MAX_IMAGE_PIXELS || (metadata.pages || 1) !== 1) throw new HttpError(422, 'Evidence must be a single image within 10,000 pixels per side and 25 megapixels.')
    // Metadata alone does not validate compressed image data. Force every pixel
    // through the decoder; a valid header with truncated pixel data is rejected.
    const { info } = await decoder.raw().toBuffer({ resolveWithObject: true })
    if (info.width !== metadata.width || info.height !== metadata.height) throw new HttpError(422, 'Decoded evidence dimensions do not match its metadata.')
    return { width: metadata.width, height: metadata.height, mime }
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(422, 'Evidence is corrupt, unsupported, oversized, animated, or could not be decoded within five seconds.')
  } finally { decoder.destroy() }
}
export async function verifyStoredImage(context, descriptor) {
  if (typeof descriptor.path !== 'string' || !Number.isInteger(descriptor.bytes) || descriptor.bytes < 1 || descriptor.bytes > MAX_IMAGE_BYTES || !/^[a-f0-9]{64}$/.test(descriptor.sha256 || '')) throw new HttpError(422, 'The evidence registration is incomplete or invalid.')
  const { data, error } = await context.client.storage.from('evidence').download(descriptor.path)
  if (error && Number(error.status || error.statusCode) !== 404) throw new HttpError(503, 'Private evidence is temporarily unavailable. Retry without discarding local evidence.')
  if (error || !data) throw Object.assign(new HttpError(422, 'Upload is incomplete. Retry this panel.'), { code: 'UPLOAD_INCOMPLETE' })
  if (data.size !== descriptor.bytes || data.size > MAX_IMAGE_BYTES) throw new HttpError(422, 'Uploaded evidence failed size verification.')
  const content = Buffer.from(await data.arrayBuffer())
  if (content.length !== descriptor.bytes || createHash('sha256').update(content).digest('hex') !== descriptor.sha256) throw new HttpError(422, 'Uploaded evidence failed size or hash verification.')
  return validateImageBytes(content, descriptor.mime)
}
