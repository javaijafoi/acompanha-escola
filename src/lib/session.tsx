import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Family, Profile } from './types'

interface Ctx { session: Session | null; profile: Profile | null; family: Family | null; loading: boolean }
const SessionCtx = createContext<Ctx>({ session: null, profile: null, family: null, loading: true })

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [family, setFamily] = useState<Family | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    let alive = true
    async function load() {
      if (!session) { setProfile(null); setFamily(null); setLoading(false); return }
      setLoading(true)
      const { data: p } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      const { data: f } = p ? await supabase.from('families').select('*').eq('id', p.family_id).single() : { data: null }
      if (alive) { setProfile(p as Profile | null); setFamily(f as Family | null); setLoading(false) }
    }
    load()
    return () => { alive = false }
  }, [session?.user.id])

  return <SessionCtx.Provider value={{ session, profile, family, loading }}>{children}</SessionCtx.Provider>
}

export const useSession = () => useContext(SessionCtx)
