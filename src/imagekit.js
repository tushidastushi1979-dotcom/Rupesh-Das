import { auth } from './firebase'

const uploadEndpoint = 'https://upload.imagekit.io/api/v1/files/upload'
const maxImageSize = 5 * 1024 * 1024

export async function uploadProfileImage(file) {
  if (!auth?.currentUser) throw new Error('You must be signed in to upload a profile photo.')
  if (!file?.type?.startsWith('image/')) throw new Error('Profile photos must be image files.')
  if (file.size > maxImageSize) throw new Error('Profile photos must be 5 MB or smaller.')

  const idToken = await auth.currentUser.getIdToken()
  const credentialsResponse = await fetch('/api/imagekit-auth', {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
  })
  const credentials = await credentialsResponse.json().catch(() => ({}))
  if (!credentialsResponse.ok) throw new Error(credentials.error || 'Unable to authenticate the ImageKit upload.')

  const formData = new FormData()
  formData.append('file', file)
  formData.append('fileName', `${Date.now()}-${file.name}`)
  formData.append('publicKey', credentials.publicKey)
  formData.append('signature', credentials.signature)
  formData.append('expire', String(credentials.expire))
  formData.append('token', credentials.token)
  if (!credentials.folder) throw new Error('ImageKit did not provide a server-controlled upload folder.')
  formData.append('folder', credentials.folder)

  const uploadResponse = await fetch(uploadEndpoint, { method: 'POST', body: formData })
  const result = await uploadResponse.json().catch(() => ({}))
  if (!uploadResponse.ok || !result.url) {
    throw new Error(result.message || 'ImageKit rejected the profile photo upload.')
  }
  return result.url
}
