const BASE64_CHUNK = 0x8000
const bytesToBase64 = (bytes) => {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK))
  }
  return btoa(binary)
}
const base64ToBytes = (value) => {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

const deriveKey = async (passphrase, salt, iterations) => {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function encryptBundle(value, passphrase) {
  if (String(passphrase || '').length < 8) throw new Error('Use a passphrase of at least 8 characters.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt, 600000)
  const plaintext = new TextEncoder().encode(JSON.stringify(value))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return { format: 'niyamlens-secure-bundle-v2', kdf: 'PBKDF2-SHA256-600000', cipher: 'AES-256-GCM', salt: bytesToBase64(salt), iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(ciphertext)) }
}

export async function decryptBundle(bundle, passphrase) {
  const iterations = bundle?.format === 'niyamlens-secure-bundle-v2'
    ? 600000
    : bundle?.format === 'niyamlens-secure-bundle-v1' ? 180000 : 0
  if (!iterations) throw new Error('Unsupported evidence bundle format.')
  const salt = base64ToBytes(bundle.salt); const iv = base64ToBytes(bundle.iv)
  const key = await deriveKey(passphrase, salt, iterations)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, base64ToBytes(bundle.data))
  return JSON.parse(new TextDecoder().decode(plaintext))
}
