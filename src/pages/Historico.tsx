import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useSession } from '../lib/session'
import { loadSubjects } from '../lib/data'
import { daysAgo, fmtDay } from '../lib/dates'
import type { Checkin, CheckinItem, Photo, Review, Subject } from '../lib/types'
import ReviewCard from '../components/ReviewCard'
import Photos from '../components/Photos'

export default function Historico() {
  const { profile } = useSession()
  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [items, setItems] = useState<CheckinItem[]>([])
  const [reviews, setReviews] = useState<Review[]>([])
  const [photos, setPhotos] = useState<Photo[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      const { data: cks } = await supabase.from('checkins').select('*').gte('day', daysAgo(30)).order('day', { ascending: false })
      const ids = (cks ?? []).map((c) => c.id)
      const none = ['00000000-0000-0000-0000-000000000000']
      const { data: its } = await supabase.from('checkin_items').select('*').in('checkin_id', ids.length ? ids : none)
      const itemIds = (its ?? []).map((i) => i.id)
      const [{ data: rv }, { data: ph }, s] = await Promise.all([
        supabase.from('reviews').select('*').in('item_id', itemIds.length ? itemIds : none),
        supabase.from('photos').select('*').in('item_id', itemIds.length ? itemIds : none),
        loadSubjects(true),
      ])
      setCheckins((cks ?? []) as Checkin[]); setItems((its ?? []) as CheckinItem[])
      setReviews((rv ?? []) as Review[]); setPhotos((ph ?? []) as Photo[]); setSubjects(s)
    })()
  }, [])

  const name = (id: string) => subjects.find((s) => s.id === id)?.name ?? '?'
  return (
    <div className="stack">
      <h2>Últimos 30 dias</h2>
      {checkins.length === 0 && <p className="banner">Nada por aqui ainda.</p>}
      {checkins.map((c) => {
        const its = items.filter((i) => i.checkin_id === c.id)
        return (
          <div key={c.id} className="card stack">
            <button className="row between plain" onClick={() => setOpen(open === c.id ? null : c.id)}>
              <strong>{fmtDay(c.day)}</strong>
              <span className="small">{its.map((i) => name(i.subject_id)).join(', ')} · <span className={'status ' + c.status}>{c.status}</span></span>
            </button>
            {open === c.id && its.map((i) => {
              const rv = reviews.find((r) => r.item_id === i.id)
              return (
                <div key={i.id} className="sub stack">
                  <strong>{name(i.subject_id)}</strong>
                  {i.learned && <p className="small">{i.learned}</p>}
                  {i.pages && <p className="small muted">Folhas: {i.pages}</p>}
                  <Photos photos={photos.filter((p) => p.item_id === i.id)} />
                  {rv && <ReviewCard review={rv} forParent={profile?.role === 'parent'} />}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
