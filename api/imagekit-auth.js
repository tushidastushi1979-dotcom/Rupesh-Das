import crypto from 'node:crypto'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

function getFirebaseAdmin() {
  if (getApps().length) return getAuth()
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !privateKey) {
    throw new Error('Firebase Admin environment variables are not configured.')
  }
  return getAuth(initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  }))
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({ error: 'Method not allowed.' })
  }

  const authorization = request.headers.authorization || ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (!match) return response.status(401).json({ error: 'Missing Firebase authentication token.' })

  try {
    const decodedToken = await getFirebaseAdmin().verifyIdToken(match[1])
    if (!process.env.IMAGEKIT_PRIVATE_KEY || !process.env.IMAGEKIT_PUBLIC_KEY) {
      throw new Error('ImageKit server environment variables are not configured.')
    }

    const token = crypto.randomBytes(24).toString('hex')
    const expire = Math.floor(Date.now() / 1000) + 10 * 60
    const signature = crypto
      .createHmac('sha1', process.env.IMAGEKIT_PRIVATE_KEY)
      .update(`${token}${expire}`)
      .digest('hex')

    return response.status(200).json({
      token,
      signature,
      expire,
      publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
      folder: `/users/${decodedToken.uid}/profile`,
    })
  } catch (error) {
    if (error?.code?.startsWith('auth/')) {
      return response.status(401).json({ error: 'Invalid or expired Firebase authentication token.' })
    }
    console.error('[VibeMatch] ImageKit auth endpoint failed', error)
    return response.status(500).json({ error: 'Unable to create ImageKit upload credentials.' })
  }
}
