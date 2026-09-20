import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight, Bell, ChevronRight, Compass, Heart, LayoutGrid, Lock, LogOut,
  MapPin, MessageCircle, MoreHorizontal, Search, Settings as SettingsIcon,
  ShieldCheck, Sparkles, Star, UserRound, Users, X, Zap, SlidersHorizontal,
} from 'lucide-react'
import {
  createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import {
  addDoc, collection, doc, getDoc, getDocFromCache, getDocs, getDocsFromCache, onSnapshot,
  orderBy, query, serverTimestamp, setDoc, where,
} from 'firebase/firestore'
import { auth, db, firebaseConfigured, firebaseConfigError } from './firebase'
import { uploadProfileImage } from './imagekit'

const navItems = [
  { id: 'discover', label: 'Discover', icon: Compass },
  { id: 'matches', label: 'Matches', icon: Heart },
  { id: 'messages', label: 'Messages', icon: MessageCircle },
]

function ageFromDate(value) {
  if (!value) return null
  const date = value?.toDate ? value.toDate() : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - date.getFullYear()
  const beforeBirthday = today.getMonth() < date.getMonth() || (today.getMonth() === date.getMonth() && today.getDate() < date.getDate())
  if (beforeBirthday) age -= 1
  return age > 0 ? age : null
}

function normalizeUser(snapshot) {
  const data = snapshot.data()
  return {
    uid: data.uid || snapshot.id,
    displayName: data.displayName || 'Vibe member',
    email: data.email || '',
    dateOfBirth: data.dateOfBirth || '',
    createdAt: data.createdAt || null,
    age: ageFromDate(data.dateOfBirth),
    city: data.city || 'Location not set',
    bio: data.bio || 'Still writing my next chapter.',
    interests: Array.isArray(data.interests) ? data.interests : [],
    profilePhoto: data.profilePhoto || '',
    isVerified: Boolean(data.isVerified),
    isProfileComplete: data.isProfileComplete === true || data.profileCompleted === true || data.profileSetupComplete === true,
    score: typeof data.vibeScore === 'number' ? data.vibeScore : null,
    distance: data.distance || '',
  }
}

function profileReady(profile) {
  return Boolean(profile?.isProfileComplete && profile.displayName && profile.profilePhoto && profile.city && profile.bio && profile.interests.length)
}

function interactionId(from, to) { return `${from}_${to}` }
function matchId(a, b) { return [a, b].sort().join('_') }
function withTimeout(promise, label, timeoutMs = 20000) {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs / 1000} seconds. Check Firebase permissions and network connectivity.`)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId))
}
function firebaseSaveMessage(error) {
  if (error?.code === 'permission-denied') return 'Firebase rejected the save. Check your Firestore rules for the authenticated user.'
  return error?.message || 'Unable to save your profile.'
}
function firebaseErrorDetails(error) {
  return `Firebase error${error?.code ? ` (${error.code})` : ''}: ${error?.message || String(error)}`
}
function firestoreReadMessage(error) {
  if (error?.code === 'unavailable' || /client is offline/i.test(error?.message || '')) {
    return 'Firestore is offline. Check your connection; cached data will be used when available.'
  }
  if (error?.code === 'permission-denied') return 'Firestore denied this read. Check your authenticated-user rules.'
  return error?.message || 'Unable to load Firestore data.'
}
async function getDocumentWithCacheFallback(reference) {
  try {
    return await getDoc(reference)
  } catch (error) {
    if (error?.code !== 'unavailable' && !/client is offline/i.test(error?.message || '')) throw error
    console.warn('[VibeMatch] Firestore document read is offline; trying cache.', { path: reference.path })
    return getDocFromCache(reference)
  }
}
async function getCollectionWithCacheFallback(reference) {
  try {
    return await getDocs(reference)
  } catch (error) {
    if (error?.code !== 'unavailable' && !/client is offline/i.test(error?.message || '')) throw error
    console.warn('[VibeMatch] Firestore collection read is offline; trying cache.')
    return getDocsFromCache(reference)
  }
}

function Logo() {
  return <div className="flex items-center gap-2 font-display text-lg font-bold tracking-tight text-white"><span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-violet to-pink shadow-neon"><Sparkles size={16} fill="currentColor" /></span>vibematch<span className="text-pink">.</span></div>
}

function Background() {
  return <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-ink"><div className="grid-bg absolute inset-0 opacity-40" /><div className="ambient-glow ambient-glow-one" /><div className="ambient-glow ambient-glow-two" /><div className="ambient-glow ambient-glow-three" /><div className="blob blob-one" /><div className="blob blob-two" /><div className="blob blob-three" /><div className="stars" />{Array.from({ length: 24 }).map((_, i) => <span key={i} className="particle" style={{ '--i': i }} />)}</div>
}

export default function App() {
  const [authUser, setAuthUser] = useState(undefined)
  const [currentUser, setCurrentUser] = useState(null)
  const [userLoading, setUserLoading] = useState(true)
  const [userError, setUserError] = useState('')
  const [view, setView] = useState('discover')
  const [authMode, setAuthMode] = useState(null)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    if (!auth) { setAuthUser(null); setUserLoading(false); return undefined }
    return onAuthStateChanged(auth, async (user) => {
      setAuthUser(user)
      if (!user || !db) { setCurrentUser(null); setUserLoading(false); return }
      try {
        setUserLoading(true)
        const snapshot = await getDocumentWithCacheFallback(doc(db, 'users', user.uid))
        if (!snapshot.exists()) {
          console.warn('[VibeMatch] Authenticated user has no Firestore profile yet; opening profile setup.', { uid: user.uid })
          setCurrentUser(normalizeUser({ id: user.uid, data: () => ({ uid: user.uid, displayName: user.displayName || '', email: user.email || '', isVerified: false, isProfileComplete: false, interests: [] }) }))
        } else setCurrentUser(normalizeUser(snapshot))
        setUserError('')
      } catch (error) {
        console.error('[VibeMatch] Profile read failed', error)
        setUserError(firestoreReadMessage(error))
      } finally { setUserLoading(false) }
    })
  }, [])

  if (authUser === undefined || userLoading) return <><Background /><LoadingScreen /></>
  if (!authUser) return <><Background />{authMode ? <Auth mode={authMode} setMode={setAuthMode} onBack={() => setAuthMode(null)} /> : <Landing onStart={() => setAuthMode('register')} onLogin={() => setAuthMode('login')} />}</>
  if (userError || !currentUser) return <><Background /><ErrorState message={userError || 'Your profile is not ready yet.'} onSignOut={() => signOut(auth)} /></>
  if (!profileReady(currentUser)) return <><Background /><ProfileSetup user={currentUser} required onSaved={(profile) => { setCurrentUser(profile); setView('discover') }} /></>
  return <><Background /><AppShell view={view} setView={(next) => { setView(next); setMobileOpen(false) }} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} currentUser={currentUser} onProfileUpdated={setCurrentUser} onSignOut={() => signOut(auth)} /></>
}

function LoadingScreen() { return <div className="flex min-h-screen items-center justify-center"><div className="text-center"><Logo /><div className="mx-auto mt-8 loading-orb" /><p className="mt-5 text-sm text-white/40">Tuning your orbit...</p></div></div> }
function ErrorState({ message, onSignOut }) { return <div className="flex min-h-screen items-center justify-center px-5"><div className="glass-card max-w-md p-8 text-center"><div className="empty-orb mx-auto"><ShieldCheck size={26} /></div><h1 className="mt-5 font-display text-2xl font-bold">One more step</h1><p className="mt-3 text-sm leading-6 text-white/50">{message}</p><button onClick={onSignOut} className="btn-ghost mt-6">Return to login</button></div></div> }

function Landing({ onStart, onLogin }) {
  return <div className="min-h-screen px-5"><header className="mx-auto flex max-w-7xl items-center justify-between py-7"><Logo /><div className="hidden items-center gap-8 text-sm text-white/55 md:flex"><a href="#how">How it works</a><a href="#features">Features</a><a href="#stories">Stories</a></div><button onClick={onLogin} className="btn-ghost">Log in <ArrowRight size={15} /></button></header><main className="mx-auto max-w-7xl"><section className="relative grid min-h-[650px] items-center gap-12 py-16 lg:grid-cols-[1.05fr_.95fr] lg:py-24"><div className="relative z-10 max-w-2xl"><div className="eyebrow"><span className="pulse-dot" /> A new way to connect</div><h1 className="hero-title mt-7">Find your<br /><span className="gradient-text">perfect vibe.</span></h1><p className="mt-7 max-w-lg text-lg leading-8 text-white/55">Less swiping. More feeling. VibeMatch uses the energy you share to introduce you to people who just get it.</p><div className="mt-10 flex flex-wrap gap-4"><button onClick={onStart} className="btn-primary">Start matching <ArrowRight size={17} /></button><a href="#how" className="btn-ghost">See how it works <ArrowRight size={15} /></a></div><div className="mt-12 flex items-center gap-4 text-sm text-white/45"><div className="flex -space-x-2"><span className="landing-avatar avatar-sm" /><span className="landing-avatar avatar-sm" /><span className="landing-avatar avatar-sm" /></div><span><b className="text-white">12k+</b> people finding their vibe</span></div></div><div className="hero-orbit"><div className="orbit-ring ring-one" /><div className="orbit-ring ring-two" /><LandingCard className="float-main" tone="violet" title="The right energy" /><LandingCard className="float-side" tone="pink" title="98% compatible" compact /><div className="score-pill"><div className="score-icon"><Zap size={16} fill="currentColor" /></div><div><span>Vibe score</span><strong>98%</strong></div></div></div></section><section id="features" className="border-t border-white/10 py-24"><div className="mx-auto max-w-3xl text-center"><div className="eyebrow justify-center">Made for real connection</div><h2 className="section-title mt-5">Your energy is <span className="gradient-text">one of a kind.</span></h2><p className="mt-5 text-white/50">A smarter, more human way to meet someone who matches your frequency.</p></div><div className="mt-14 grid gap-4 md:grid-cols-3"><Feature icon={Zap} title="Vibe-first matching" text="We look beyond a checklist to find the energy that actually clicks." /><Feature icon={Sparkles} title="Feel the chemistry" text="Share your taste, your pace, and the little things that make you, you." /><Feature icon={Users} title="Your people, naturally" text="Meaningful matches, without the endless scroll or awkward small talk." /></div></section><section id="how" className="grid items-center gap-14 py-24 lg:grid-cols-2"><div><div className="eyebrow">Three steps to a spark</div><h2 className="section-title mt-5">Good things happen<br /><span className="gradient-text">when you vibe.</span></h2><div className="mt-10 space-y-7"><Step n="01" title="Build your vibe" text="Tell us what lights you up. No boring questionnaires, promise." /><Step n="02" title="Meet your matches" text="We'll introduce you to people who feel like your kind of people." /><Step n="03" title="Make it real" text="Start a conversation with an icebreaker that actually says something." /></div></div><div className="quote-card"><div className="quote-mark">“</div><p>VibeMatch made dating feel exciting again. I stopped looking for a perfect profile and started looking for a perfect feeling.</p><div className="mt-7 flex items-center gap-3"><div className="landing-avatar avatar-md" /><div><b className="block text-sm">Ari & Jordan</b><span className="text-xs text-white/45">Matched 8 months ago</span></div></div></div></section><footer id="stories" className="flex flex-col gap-5 border-t border-white/10 py-10 text-sm text-white/40 md:flex-row md:items-center md:justify-between"><Logo /><span>© 2025 VibeMatch. Made for good energy.</span><div className="flex gap-5"><span>Privacy</span><span>Terms</span><span>Safety</span></div></footer></main></div>
}
function LandingCard({ className, tone, title, compact }) { return <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .8 }} className={`landing-card ${className} ${compact ? 'compact' : ''} ${tone}`}><div className="landing-card-image"><Sparkles size={compact ? 23 : 32} /></div><div className="profile-float-info"><div><b>{title}</b><span>{compact ? 'Meet your people' : 'Curated for your frequency'}</span></div><span className="mini-score">{compact ? '✦' : 'VIBE'}</span></div></motion.div> }
function Feature({ icon: Icon, title, text }) { return <div className="glass-card p-7"><div className="icon-box"><Icon size={20} /></div><h3 className="mt-5 text-lg font-semibold">{title}</h3><p className="mt-3 text-sm leading-6 text-white/45">{text}</p></div> }
function Step({ n, title, text }) { return <div className="flex gap-5"><span className="font-mono text-xs text-pink">{n}</span><div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-white/45">{text}</p></div></div> }

function Auth({ mode, setMode, onBack }) {
  const register = mode === 'register'
  const [form, setForm] = useState({ displayName: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    if (!firebaseConfigured || !auth || !db) { setError(firebaseConfigError); return }
    try {
      setBusy(true); setError('')
      if (register) {
        const credential = await createUserWithEmailAndPassword(auth, form.email, form.password)
        await setDoc(doc(db, 'users', credential.user.uid), { uid: credential.user.uid, displayName: form.displayName.trim(), email: form.email, isProfileComplete: false, isVerified: false, createdAt: serverTimestamp() })
      } else await signInWithEmailAndPassword(auth, form.email, form.password)
    } catch (err) {
      setError(err.code === 'auth/configuration-not-found'
        ? 'Email/password sign-in is not enabled for this Firebase project. Enable it in Firebase Console → Authentication → Sign-in method.'
        : err.message || 'Authentication failed.')
    } finally { setBusy(false) }
  }
  return <div className="flex min-h-screen items-center justify-center px-5 py-10"><div className="w-full max-w-[440px]"><button onClick={onBack} className="mb-10"><Logo /></button><div className="glass-card p-7 sm:p-10"><div className="eyebrow">{register ? 'Your next chapter' : 'Welcome back'}</div><h1 className="mt-4 font-display text-3xl font-bold">{register ? 'Let’s find your vibe.' : 'Good to see you again.'}</h1><p className="mt-3 text-sm text-white/45">{register ? 'Create your account to meet people who feel like home.' : 'Log in to pick up where you left off.'}</p><form onSubmit={submit} className="mt-8 space-y-4">{register && <input required className="input" placeholder="Your name" value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} />}<input required className="input" placeholder="Email address" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /><input required minLength={6} className="input" placeholder="Password" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />{error && <p className="text-xs leading-5 text-red-300">{error}</p>}<button disabled={busy} className="btn-primary mt-2 w-full justify-center disabled:opacity-50">{busy ? 'Connecting...' : register ? 'Create my account' : 'Log in'} <ArrowRight size={17} /></button></form><p className="mt-7 text-center text-sm text-white/40">{register ? 'Already have an account?' : 'New to VibeMatch?'} <button type="button" onClick={() => { setMode(register ? 'login' : 'register'); setError('') }} className="font-medium text-electric hover:text-white">{register ? 'Log in' : 'Create an account'}</button></p></div></div></div>
}

function AppShell({ view, setView, mobileOpen, setMobileOpen, currentUser, onProfileUpdated, onSignOut }) {
  return <div className="flex min-h-screen"><aside className={`sidebar ${mobileOpen ? 'open' : ''}`}><div className="sidebar-shine" /><div className="mb-12 flex items-center justify-between"><Logo /><button onClick={() => setMobileOpen(false)} className="md:hidden"><X size={20} /></button></div><div className="mb-4 px-3 text-[10px] font-semibold uppercase tracking-[.2em] text-white/25">Your space</div><nav className="space-y-2">{navItems.map(item => <NavItem key={item.id} item={item} active={view === item.id} onClick={() => setView(item.id)} />)}</nav><div className="mt-10 border-t border-white/10 pt-7"><div className="mb-4 px-3 text-[10px] font-semibold uppercase tracking-[.2em] text-white/25">Account</div><NavItem item={{ id: 'profile', label: 'My profile', icon: UserRound }} active={view === 'profile'} onClick={() => setView('profile')} /><NavItem item={{ id: 'settings', label: 'Settings', icon: SettingsIcon }} active={view === 'settings'} onClick={() => setView('settings')} /></div><div className="mt-auto hidden rounded-2xl border border-white/10 bg-white/[.04] p-4 md:block"><div className="flex items-center gap-3"><Avatar user={currentUser} /><div className="min-w-0"><b className="block truncate text-sm">{currentUser.displayName}</b><span className="text-xs text-white/40">Your vibe is live</span></div><span className="pulse-dot ml-auto" /></div></div></aside><main className="min-w-0 flex-1"><header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-white/10 bg-ink/75 px-5 backdrop-blur-xl md:px-10"><button onClick={() => setMobileOpen(true)} className="md:hidden"><LayoutGrid size={21} /></button><div className="hidden md:block"><span className="text-sm text-white/40">Your personalized orbit</span><h1 className="font-display text-xl font-semibold">{view === 'discover' ? 'Discover your next vibe' : view[0].toUpperCase() + view.slice(1)}</h1></div><div className="flex items-center gap-4"><button className="relative text-white/55 transition hover:scale-110 hover:text-white"><Bell size={19} /><span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-pink" /></button><div className="hidden h-7 w-px bg-white/10 sm:block" /><div className="flex items-center gap-2"><Avatar user={currentUser} /><span className="hidden max-w-24 truncate text-sm font-medium sm:block">{currentUser.displayName}</span><ChevronRight size={15} className="rotate-90 text-white/30" /></div></div></header><AnimatePresence mode="wait"><motion.div key={view} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: .25 }} className="p-5 md:p-10">{view === 'discover' && <Discover currentUser={currentUser} />}{view === 'matches' && <Matches currentUser={currentUser} />}{view === 'messages' && <Messages currentUser={currentUser} />}{view === 'profile' && <Profile user={currentUser} onProfileUpdated={onProfileUpdated} />}{view === 'settings' && <Settings onSignOut={onSignOut} />}</motion.div></AnimatePresence></main></div>
}

function NavItem({ item, active, onClick }) { const Icon = item.icon; return <button onClick={onClick} className={`nav-item ${active ? 'active' : ''}`}><Icon size={19} /><span>{item.label}</span></button> }
function Avatar({ user, className = 'avatar-sm' }) { return user.profilePhoto ? <img src={user.profilePhoto} className={className} alt="" /> : <div className={`${className} grid place-items-center bg-violet/30 text-xs font-bold`}>{user.displayName?.slice(0, 1).toUpperCase()}</div> }

function Discover({ currentUser }) {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [index, setIndex] = useState(0)
  const [feedback, setFeedback] = useState(null)
  const [preview, setPreview] = useState(null)

  useEffect(() => {
    let active = true
    async function loadProfiles() {
      if (!db) { setError(firebaseConfigError); setLoading(false); return }
      try {
        const [userSnapshot, passSnapshot] = await Promise.all([
          getCollectionWithCacheFallback(query(collection(db, 'users'), where('isProfileComplete', '==', true))),
          getCollectionWithCacheFallback(query(collection(db, 'passes'), where('fromUserId', '==', currentUser.uid))),
        ])
        const passed = new Set(passSnapshot.docs.map(item => item.data().toUserId))
        const loaded = await Promise.all(userSnapshot.docs.map(async (snapshot) => {
          const item = normalizeUser(snapshot)
          return item
        }))
        const eligible = loaded.filter(item => item.uid !== currentUser.uid && profileReady(item) && !passed.has(item.uid))
        if (active) { setProfiles(eligible); setError('') }
      } catch (err) { if (active) setError(firestoreReadMessage(err)) } finally { if (active) setLoading(false) }
    }
    loadProfiles()
    return () => { active = false }
  }, [currentUser.uid])

  const profile = profiles[index]
  const advance = async (kind) => {
    if (!profile || !db || feedback) return
    const dir = kind === 'pass' ? -1 : kind === 'superlike' ? 0 : 1
    setFeedback({ kind, dir })
    try { await recordInteraction(currentUser.uid, profile.uid, kind) } catch (err) { setError(err.message || 'Unable to save your choice.') }
    window.setTimeout(() => { setIndex(value => value + 1); setFeedback(null) }, 320)
  }
  if (loading) return <DiscoverSkeleton />
  if (error) return <PageState title="Discover is offline" message={error} icon={ShieldCheck} />
  if (!profile) return <PageState title="Your orbit is quiet" message="Complete your profile or check back soon for new people on your wavelength." icon={Compass} />
  return <div className="mx-auto max-w-6xl"><div className="mb-8 flex items-end justify-between"><div><div className="eyebrow"><span className="pulse-dot" /> Curated for your energy</div><h2 className="mt-2 font-display text-3xl font-bold md:text-4xl">The daily drop <span className="text-white/30">✦</span></h2><p className="mt-2 text-sm text-white/40">Real people, matched to your frequency.</p></div><button className="icon-button"><SlidersHorizontal size={18} /></button></div><div className="grid items-center gap-12 lg:grid-cols-[minmax(380px,590px)_1fr] lg:justify-center"><div className="relative mx-auto w-full max-w-[590px]"><div className="card-shadow" /><AnimatePresence mode="wait"><motion.div key={profile.uid} drag dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }} dragElastic={.85} onDragEnd={(_, info) => { if (Math.abs(info.offset.x) > 100) advance(info.offset.x > 0 ? 'like' : 'pass'); else if (info.offset.y < -100) advance('superlike') }} initial={{ opacity: 0, scale: .94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, x: feedback?.dir * 440, y: feedback?.kind === 'superlike' ? -320 : 0, rotate: feedback?.dir * 16 }} transition={{ type: 'spring', stiffness: 260, damping: 24 }} onClick={() => setPreview(profile)} className="discover-card immersive-card cursor-grab active:cursor-grabbing"><img src={profile.profilePhoto} alt={profile.displayName} /><div className="card-vignette" /><div className="absolute inset-x-0 bottom-0 p-6 pt-40 md:p-8 md:pt-48"><div className="mb-3 flex flex-wrap gap-2">{profile.interests.map(item => <span className="profile-badge" key={item}><Sparkles size={10} /> {item}</span>)}</div><div className="flex items-end justify-between"><div><VibeScore score={profile.score || 0} /><h3 className="mt-3 font-display text-4xl font-bold tracking-tight">{profile.displayName}{profile.age ? `, ${profile.age}` : ''}</h3><p className="mt-1 flex items-center gap-1.5 text-sm text-white/65"><MapPin size={14} /> {profile.city}</p></div><button onClick={e => { e.stopPropagation(); setPreview(profile) }} className="rounded-full border border-white/20 bg-white/15 p-3 transition hover:scale-110"><MoreHorizontal size={20} /></button></div></div>{feedback && <motion.div initial={{ opacity: 0, scale: .6, rotate: feedback.kind === 'pass' ? -15 : 15 }} animate={{ opacity: 1, scale: 1, rotate: feedback.kind === 'pass' ? -15 : 15 }} className={`feedback-stamp feedback-${feedback.kind === 'superlike' ? 'super' : feedback.kind}`}>{feedback.kind === 'superlike' ? 'SUPER LIKE' : feedback.kind.toUpperCase()}</motion.div>}</motion.div></AnimatePresence><div className="mt-7 flex items-center justify-center gap-4"><button onClick={() => advance('pass')} className="action-button pass" aria-label="Pass"><X size={22} /></button><button onClick={() => advance('superlike')} className="action-button super" aria-label="Super like"><Star size={20} fill="currentColor" /></button><button onClick={() => advance('like')} className="action-button like" aria-label="Like"><Heart size={23} fill="currentColor" /></button></div><p className="mt-4 text-center text-xs text-white/30">Drag right to like · left to pass · up to super like</p></div><div className="max-w-md"><div className="flex items-center gap-2 text-sm font-medium text-electric"><Sparkles size={15} /> Why you might click</div><p className="mt-4 text-lg leading-8 text-white/75">“{profile.bio}”</p><div className="mt-8 flex flex-wrap gap-2">{profile.interests.map(item => <span className="tag" key={item}>{item}</span>)}</div><div className="mt-9 border-t border-white/10 pt-6"><div className="mb-3 flex justify-between text-xs text-white/45"><span>Vibe compatibility</span><b className="text-white">{profile.score ? `${profile.score}%` : 'Calculating'}</b></div><div className="h-2 overflow-hidden rounded-full bg-white/10"><motion.div initial={{ width: 0 }} animate={{ width: `${profile.score || 0}%` }} className="h-full rounded-full bg-gradient-to-r from-violet to-pink" /></div></div><div className="mt-7 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[.035] p-4"><ShieldCheck className="text-electric" size={18} /><span className="text-xs leading-5 text-white/50">{profile.isVerified ? 'Verified profile with community-reviewed energy.' : 'Vibe-reviewed profile. Stay curious and kind.'}</span></div></div></div>{preview && <ProfileModal profile={preview} onClose={() => setPreview(null)} />}</div>
}

async function recordInteraction(fromUserId, toUserId, kind) {
  const type = kind === 'superlike' ? 'superlike' : kind
  const id = interactionId(fromUserId, toUserId)
  if (type === 'pass') {
    await setDoc(doc(db, 'passes', id), { fromUserId, toUserId, createdAt: serverTimestamp() }, { merge: true })
    return
  }
  await setDoc(doc(db, 'likes', id), { fromUserId, toUserId, type, createdAt: serverTimestamp() }, { merge: true })
  const reciprocal = await getDocumentWithCacheFallback(doc(db, 'likes', interactionId(toUserId, fromUserId)))
  if (reciprocal.exists()) {
    const userIds = [fromUserId, toUserId].sort()
    await setDoc(doc(db, 'matches', matchId(fromUserId, toUserId)), { userIds, createdAt: serverTimestamp(), lastMessage: '', lastMessageAt: serverTimestamp() }, { merge: true })
  }
}

function VibeScore({ score }) { return <div className="flex items-center gap-2"><div className="score-ring" style={{ '--score': `${score * 3.6}deg` }}><span>{score || '—'}</span></div><span className="text-xs font-medium uppercase tracking-[.16em] text-white/55">Vibe score</span></div> }
function ProfileModal({ profile, onClose }) { return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="modal-backdrop" onClick={onClose}><motion.div initial={{ y: 24, scale: .96 }} animate={{ y: 0, scale: 1 }} onClick={e => e.stopPropagation()} className="profile-modal"><button onClick={onClose} className="modal-close"><X size={18} /></button><img src={profile.profilePhoto} alt={profile.displayName} /><div className="p-6"><VibeScore score={profile.score || 0} /><h3 className="mt-4 font-display text-3xl font-bold">{profile.displayName}{profile.age ? `, ${profile.age}` : ''}</h3><p className="mt-1 flex items-center gap-1.5 text-sm text-white/50"><MapPin size={14} /> {profile.city}</p><p className="mt-5 text-sm leading-7 text-white/60">{profile.bio}</p><div className="mt-5 flex flex-wrap gap-2">{profile.interests.map(item => <span className="tag" key={item}>{item}</span>)}</div><button onClick={onClose} className="btn-primary mt-7 w-full justify-center">Keep discovering <ArrowRight size={16} /></button></div></motion.div></motion.div> }
function DiscoverSkeleton() { return <div className="mx-auto max-w-6xl"><div className="skeleton-line w-40" /><div className="mt-3 skeleton-line h-10 w-64" /><div className="mt-8 grid gap-12 lg:grid-cols-[minmax(380px,590px)_1fr]"><div className="skeleton-card" /><div className="hidden space-y-4 lg:block"><div className="skeleton-line w-32" /><div className="skeleton-line h-20 w-full" /></div></div></div> }
function PageState({ title, message, icon: Icon }) { return <div className="empty-state"><div className="empty-orb"><Icon size={26} /></div><h3 className="mt-5 font-display text-xl font-semibold">{title}</h3><p className="mt-2 max-w-xs text-center text-sm leading-6 text-white/40">{message}</p></div> }

function Matches({ currentUser }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    async function load() {
      if (!db) { setError(firebaseConfigError); setLoading(false); return }
      try {
        const snapshot = await getCollectionWithCacheFallback(query(collection(db, 'matches'), where('userIds', 'array-contains', currentUser.uid)))
        const loaded = await Promise.all(snapshot.docs.map(async item => {
          const otherUid = item.data().userIds.find(uid => uid !== currentUser.uid)
          const other = otherUid ? await getDocumentWithCacheFallback(doc(db, 'users', otherUid)) : null
          return other?.exists() ? normalizeUser(other) : null
        }))
        if (active) setItems(loaded.filter(Boolean))
      } catch (err) { if (active) setError(firestoreReadMessage(err)) } finally { if (active) setLoading(false) }
    }
    load()
    return () => { active = false }
  }, [currentUser.uid])
  if (loading) return <DiscoverSkeleton />
  if (error) return <PageState title="Matches are offline" message={error} icon={ShieldCheck} />
  if (!items.length) return <PageState title="Your matches are loading from Firebase" message="Mutual connections will appear here once the other person likes you back." icon={Heart} />
  return <div className="mx-auto max-w-5xl"><div className="eyebrow">People on your wavelength</div><h2 className="mt-2 font-display text-3xl font-bold">Your matches <span className="text-pink">✦</span></h2><div className="mt-8 grid gap-3">{items.map(item => <div className="glass-card flex items-center gap-4 p-4" key={item.uid}><Avatar user={item} className="avatar-md" /><div className="flex-1"><b>{item.displayName}{item.age ? `, ${item.age}` : ''}</b><p className="mt-1 text-sm text-white/45">{item.city}</p></div><span className="tag">Matched</span></div>)}</div></div>
}
function Messages({ currentUser }) {
  const [matches, setMatches] = useState([])
  const [selected, setSelected] = useState(null)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    async function loadMatches() {
      try {
        const snapshot = await getCollectionWithCacheFallback(query(collection(db, 'matches'), where('userIds', 'array-contains', currentUser.uid)))
        const loaded = await Promise.all(snapshot.docs.map(async item => {
          const otherUid = item.data().userIds.find(uid => uid !== currentUser.uid)
          const other = otherUid ? await getDocumentWithCacheFallback(doc(db, 'users', otherUid)) : null
          return other?.exists() ? { id: item.id, ...normalizeUser(other) } : null
        }))
        if (active) { setMatches(loaded.filter(Boolean)); setSelected(value => value || loaded.find(Boolean) || null) }
      } catch (err) { if (active) setError(firestoreReadMessage(err)) }
      finally { if (active) setLoading(false) }
    }
    if (db) loadMatches()
    else { setError(firebaseConfigError); setLoading(false) }
    return () => { active = false }
  }, [currentUser.uid])
  useEffect(() => {
    if (!selected || !db) { setMessages([]); return undefined }
    const messagesQuery = query(collection(db, 'matches', selected.id, 'messages'), orderBy('createdAt', 'asc'))
    return onSnapshot(messagesQuery, snapshot => {
      setMessages(snapshot.docs.map(item => ({ id: item.id, ...item.data() })))
      setError('')
    }, err => setError(firestoreReadMessage(err)))
  }, [selected])
  const send = async event => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || !selected || !db) return
    try {
      setDraft('')
      await addDoc(collection(db, 'matches', selected.id, 'messages'), { senderId: currentUser.uid, text, createdAt: serverTimestamp() })
      await setDoc(doc(db, 'matches', selected.id), { lastMessage: text, lastMessageAt: serverTimestamp() }, { merge: true })
    } catch (err) { setError(firestoreReadMessage(err)) }
  }
  if (loading) return <DiscoverSkeleton />
  if (error && !matches.length) return <PageState title="Messages are offline" message={error} icon={ShieldCheck} />
  if (!matches.length) return <PageState title="Your inbox is quiet" message="Conversations will appear here after you make a mutual connection." icon={MessageCircle} />
  return <div className="mx-auto max-w-5xl"><div className="eyebrow">Real-time connection</div><h2 className="mt-2 font-display text-3xl font-bold">Messages</h2><div className="mt-8 grid gap-4 md:grid-cols-[220px_1fr]"><div className="space-y-2">{matches.map(match => <button key={match.id} onClick={() => setSelected(match)} className={`glass-card flex w-full items-center gap-3 p-3 text-left ${selected?.id === match.id ? 'ring-1 ring-pink/60' : ''}`}><Avatar user={match} /><span className="truncate text-sm">{match.displayName}</span></button>)}</div><div className="glass-card flex min-h-[420px] flex-col p-4"><div className="border-b border-white/10 pb-4 font-semibold">{selected.displayName}</div><div className="flex-1 space-y-3 overflow-y-auto py-4">{messages.map(message => <div key={message.id} className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${message.senderId === currentUser.uid ? 'ml-auto bg-violet/40' : 'bg-white/10'}`}>{message.text}</div>)}</div><form onSubmit={send} className="flex gap-2 border-t border-white/10 pt-4"><input className="input flex-1" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Send a thoughtful note..." /><button className="btn-primary">Send</button></form>{error && <p className="mt-3 text-xs text-red-300">{error}</p>}</div></div></div>
}

function Profile({ user, onProfileUpdated }) {
  const [editing, setEditing] = useState(false)
  if (editing) return <ProfileSetup user={user} onSaved={(profile) => { setEditing(false); onProfileUpdated(profile) }} />
  return <div className="mx-auto max-w-4xl"><div className="mb-8 flex items-end justify-between"><div><div className="eyebrow">Your story, your energy</div><h2 className="mt-2 font-display text-3xl font-bold">My profile</h2></div><button onClick={() => setEditing(true)} className="btn-primary text-sm">Edit profile</button></div><div className="glass-card overflow-hidden"><div className="relative h-48 bg-gradient-to-r from-violet/50 via-pink/20 to-cyan/30">{user.profilePhoto && <div className="absolute inset-0 opacity-30" style={{ backgroundImage: `url(${user.profilePhoto})`, backgroundSize: 'cover', backgroundPosition: 'center', mixBlendMode: 'soft-light' }} />}</div><div className="relative -mt-16 px-6 pb-7"><Avatar user={user} className="h-28 w-28 rounded-3xl border-4 border-panel object-cover shadow-xl" /><div className="mt-5 flex flex-wrap items-start justify-between gap-4"><div><h3 className="font-display text-2xl font-bold">{user.displayName}{user.age ? `, ${user.age}` : ''}</h3><p className="mt-1 flex items-center gap-1.5 text-sm text-white/45"><MapPin size={14} /> {user.city}</p></div><div className="rounded-2xl border border-pink/30 bg-pink/10 px-4 py-3 text-center"><b className="block text-xl text-pink">{user.isVerified ? 'Verified' : 'Pending'}</b><span className="text-[10px] uppercase tracking-widest text-white/45">Profile state</span></div></div><p className="mt-7 max-w-2xl leading-7 text-white/60">{user.bio}</p><div className="mt-6 flex flex-wrap gap-2">{user.interests.map(item => <span className="tag" key={item}>{item}</span>)}</div></div></div></div>
}

function ProfileSetup({ user, required = false, onSaved }) {
  const [form, setForm] = useState({ displayName: user.displayName === 'Vibe member' ? '' : user.displayName, dateOfBirth: user.dateOfBirth || '', city: user.city === 'Location not set' ? '' : user.city, bio: user.bio === 'Still writing my next chapter.' ? '' : user.bio, interests: user.interests.join(', ') })
  const [photo, setPhoto] = useState(null)
  const [preview, setPreview] = useState(user.profilePhoto || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const save = async (event) => {
    event.preventDefault()
    const activeUser = auth?.currentUser
    if (!db || !activeUser) {
      const message = firebaseConfigError || 'Firebase Auth has not finished initializing. Please wait a moment and try again.'
      console.error('[VibeMatch] Profile save blocked before Firebase write:', { hasDb: Boolean(db), hasAuthUser: Boolean(activeUser), message })
      setError(message)
      return
    }
    const age = ageFromDate(form.dateOfBirth)
    if (!form.displayName.trim() || !form.dateOfBirth || !age || age < 13 || !form.city.trim() || !form.bio.trim() || !form.interests.trim()) {
      setError('Complete your name, date of birth, city, bio, and interests. VibeMatch is for community members age 13 and up.')
      return
    }
    try {
      setSaving(true); setError(''); setSaved(false)
      console.info('[VibeMatch] Starting profile save', { uid: activeUser.uid, hasPhoto: Boolean(photo) })
      let profilePhoto = user.profilePhoto || ''
      const payload = {
        uid: activeUser.uid,
        displayName: form.displayName.trim(),
        email: activeUser.email || user.email || '',
        dateOfBirth: form.dateOfBirth,
        city: form.city.trim(),
        bio: form.bio.trim(),
        interests: form.interests.split(',').map(item => item.trim()).filter(Boolean),
        profilePhoto: user.profilePhoto || '',
        isVerified: Boolean(user.isVerified),
        isProfileComplete: Boolean(user.profilePhoto),
        updatedAt: serverTimestamp(),
      }
      if (required) payload.createdAt = user.createdAt || serverTimestamp()
      console.info('[VibeMatch] Writing profile document', { path: `users/${activeUser.uid}` })
      await withTimeout(setDoc(doc(db, 'users', activeUser.uid), payload, { merge: true }), 'Firestore profile write')
      console.info('[VibeMatch] Firestore text profile save complete', { uid: activeUser.uid })
      if (photo) {
        try {
          console.info('[VibeMatch] Uploading profile photo to ImageKit', { size: photo.size, type: photo.type })
          profilePhoto = await withTimeout(uploadProfileImage(photo), 'ImageKit profile photo upload')
          await withTimeout(setDoc(doc(db, 'users', activeUser.uid), { profilePhoto, isProfileComplete: true, updatedAt: serverTimestamp() }, { merge: true }), 'Firestore photo URL update')
          console.info('[VibeMatch] Profile photo save complete', { uid: activeUser.uid })
        } catch (photoError) {
          console.error('[VibeMatch] Profile photo save failed after text profile was saved', { code: photoError?.code, message: photoError?.message, uid: activeUser.uid, error: photoError })
          throw new Error(`Text profile saved, but photo upload failed. ${firebaseErrorDetails(photoError)}`)
        }
      }
      console.info('[VibeMatch] Complete profile save', { uid: activeUser.uid })
      const complete = Boolean(profilePhoto)
      const savedProfile = {
        ...user,
        ...payload,
        age,
        interests: payload.interests,
        profilePhoto,
        isProfileComplete: complete,
        isVerified: Boolean(user.isVerified),
      }
      setSaved(true)
      if (complete) window.setTimeout(() => onSaved(savedProfile), 350)
      else setError('Text profile saved successfully. Add a profile photo to complete setup.')
    } catch (err) {
      console.error('[VibeMatch] Profile save failed', { code: err?.code, message: err?.message, uid: activeUser.uid, hasPhoto: Boolean(photo), error: err })
      const details = firebaseErrorDetails(err)
      console.error('[VibeMatch] Exact profile save error', details)
      setError(`${firebaseSaveMessage(err)}\n\n${details}`)
    } finally {
      setSaving(false)
    }
  }
  return <div className="flex min-h-screen items-center justify-center px-5 py-10"><motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-2xl"><div className="mb-8 flex items-center justify-between"><div><div className="eyebrow"><span className="pulse-dot" /> {required ? 'Welcome to VibeMatch' : 'Your story, your energy'}</div><h1 className="mt-3 font-display text-3xl font-bold">{required ? 'Build your vibe.' : 'Edit your profile.'}</h1><p className="mt-2 text-sm text-white/45">{required ? 'A few details help us make better community connections.' : 'Keep your profile fresh and authentically you.'}</p></div>{!required && <button onClick={onSaved} className="icon-button"><X size={18} /></button>}</div><form onSubmit={save} className="glass-card p-6 sm:p-8"><div className="grid gap-6 md:grid-cols-[180px_1fr]"><div><label className="photo-picker"><input type="file" accept="image/*" onChange={event => { const file = event.target.files?.[0]; if (file) { setPhoto(file); setPreview(URL.createObjectURL(file)) } }} />{preview ? <img src={preview} alt="Profile preview" /> : <div><Sparkles className="mx-auto" size={24} /><span>Add photo</span></div>}</label><p className="mt-3 text-center text-xs text-white/35">A clear photo helps people recognize your vibe.</p></div><div className="space-y-4"><div><label className="field-label">Display name</label><input required className="input" value={form.displayName} onChange={event => update('displayName', event.target.value)} placeholder="What should people call you?" /></div><div className="grid gap-4 sm:grid-cols-2"><div><label className="field-label">Date of birth</label><input required className="input" type="date" value={form.dateOfBirth} max={new Date().toISOString().slice(0, 10)} onChange={event => update('dateOfBirth', event.target.value)} /></div><div><label className="field-label">City</label><input required className="input" value={form.city} onChange={event => update('city', event.target.value)} placeholder="Where are you based?" /></div></div><div><label className="field-label">Bio</label><textarea required className="input min-h-28 resize-y" value={form.bio} onChange={event => update('bio', event.target.value)} placeholder="What makes your world interesting?" /></div><div><label className="field-label">Interests</label><input required className="input" value={form.interests} onChange={event => update('interests', event.target.value)} placeholder="Music, art, hiking (comma separated)" /></div></div></div>{error && <p className="mt-5 text-sm leading-6 text-red-300">{error}</p>}<div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6"><div><div className="mb-2 flex justify-between text-xs text-white/45"><span>Profile completion</span><b>{saved ? '100%' : 'Ready to save'}</b></div><div className="h-1.5 w-44 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full bg-gradient-to-r from-violet to-pink transition-all ${saved ? 'w-full' : 'w-1/2'}`} /></div></div><button disabled={saving} className="btn-primary disabled:opacity-50">{saving ? 'Saving...' : saved ? 'Saved' : required ? 'Enter my orbit' : 'Save changes'} <ArrowRight size={16} /></button></div></form></motion.div></div>
}
function Settings({ onSignOut }) { return <div className="mx-auto max-w-3xl"><div className="mb-8"><div className="eyebrow">Make it yours</div><h2 className="mt-2 font-display text-3xl font-bold">Settings</h2></div><div className="glass-card"><button onClick={onSignOut} className="flex w-full items-center gap-4 p-5 text-left text-red-300 hover:bg-white/[.04]"><div className="icon-box !bg-red-400/10 !text-red-300"><LogOut size={18} /></div><div><b className="block text-sm">Log out</b><span className="mt-1 block text-xs text-white/40">Sign out of this device</span></div><ChevronRight size={18} className="ml-auto text-white/25" /></button></div></div> }
