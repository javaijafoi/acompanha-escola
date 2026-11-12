import { useEffect, useMemo, useState } from 'react'
import { supabase, BUCKET } from '../lib/supabase'
import { useSession } from '../lib/session'
import { loadChapters, loadSubjects, shrinkImage } from '../lib/data'
import { fmtDay, today } from '../lib/dates'
import type { Chapter, Checkin, CheckinItem, Photo, Review, Subject } from '../lib/types'
import ReviewCard from '../components/ReviewCard'
import Photos from '../components/Photos'

export default function Hoje() {
  const { profile } = useSession()
  const [checkin, setCheckin] = useState<Checkin | null>(null)
  const [items, setItems] = useState<CheckinItem[]>([])
  const [photos, setPhotos] = useState<Photo[]>([])
  const [reviews, setReviews] = useState<Review[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function reload() {
    const [s, c] = await Promise.all([loadSubjects(), loadChapters()])
    setSubjects(s); setChapters(c)
    const { data: ck } = await supabase.from('checkins').select('*').eq('child_id', profile!.id).eq('day', today()).maybeSingle()
    setCheckin(ck as Checkin | null)
    if (!ck) { setItems([]); setPhotos([]); setReviews([]); return }
    const { data: its } = await supabase.from('checkin_items').select('*').eq('checkin_id', ck.id).order('created_at')
    const ids = (its ?? []).map((i) => i.id)
    const [{ data: ph }, { data: rv }] = await Promise.all([
      supabase.from('photos').select('*').in('item_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']),
      supabase.from('reviews').select('*').in('item_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']),
    ])
    setItems((its ?? []) as CheckinItem[]); setPhotos((ph ?? []) as Photo[]); setReviews((rv ?? []) as Review[])
  }
  useEffect(() => { reload() }, [])

  // Atualiza sozinho enquanto espera a correção
  useEffect(() => {
    if (!checkin || (checkin.status !== 'entregue' && checkin.status !== 'corrigindo')) return
    const t = setInterval(reload, 60_000)
    return () => clearInterval(t)
  }, [checkin?.status])

  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name ?? '?'
  const chapterName = (id: string | null) => chapters.find((c) => c.id === id)?.title
  const editable = !checkin || checkin.status === 'rascunho'
  const missingPhotos = items.filter((i) => !photos.some((p) => p.item_id === i.id))
  const devolvidos = items.filter((i) => i.review_status === 'devolvido')

  async function ensureCheckin(): Promise<Checkin> {
    if (checkin) return checkin
    const { data, error } = await supabase.from('checkins')
      .insert({ family_id: profile!.family_id, child_id: profile!.id, day: today() }).select().single()
    if (error) throw error
    setCheckin(data as Checkin)
    return data as Checkin
  }

  async function uploadPhotos(ck: Checkin, itemId: string, files: FileList | File[]) {
    for (const f of Array.from(files)) {
      const blob = await shrinkImage(f)
      const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/heic' ? 'heic' : 'jpg'
      const path = `${profile!.family_id}/${ck.id}/${itemId}/${crypto.randomUUID()}.${ext}`
      const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg' })
      if (up.error) throw up.error
      const ins = await supabase.from('photos').insert({ family_id: profile!.family_id, item_id: itemId, storage_path: path })
      if (ins.error) throw ins.error
    }
  }

  async function deletePhoto(p: Photo) {
    if (!confirm('Apagar esta foto?')) return
    await supabase.storage.from(BUCKET).remove([p.storage_path])
    await supabase.from('photos').delete().eq('id', p.id)
    reload()
  }

  async function deleteItem(it: CheckinItem) {
    if (!confirm('Tirar esta matéria do dia?')) return
    const paths = photos.filter((p) => p.item_id === it.id).map((p) => p.storage_path)
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths)
    await supabase.from('checkin_items').delete().eq('id', it.id)
    reload()
  }

  async function addMorePhotos(it: CheckinItem, files: FileList | null) {
    if (!files?.length || !checkin) return
    setBusy(true); setErr(null)
    try { await uploadPhotos(checkin, it.id, files) } catch (e: any) { setErr(e.message) }
    setBusy(false); reload()
  }

  async function entregar() {
    if (!checkin) return
    if (!items.length) { setErr('Adicione pelo menos uma matéria.'); return }
    if (missingPhotos.length) { setErr('Falta foto em: ' + missingPhotos.map((i) => subjectName(i.subject_id)).join(', ')); return }
    if (!confirm('Entregar o dia? Depois disso não dá pra mexer até a correção sair.')) return
    setBusy(true)
    const { error } = await supabase.from('checkins').update({ status: 'entregue', submitted_at: new Date().toISOString() }).eq('id', checkin.id)
    if (error) setErr(error.message)
    setBusy(false); reload()
  }

  async function refazer() {
    if (!checkin) return
    setBusy(true)
    const { error } = await supabase.from('checkins').update({ status: 'rascunho' }).eq('id', checkin.id)
    if (!error) await supabase.from('checkin_items').update({ review_status: 'pendente' }).in('id', devolvidos.map((d) => d.id))
    if (error) setErr(error.message)
    setBusy(false); reload()
  }

  return (
    <div className="stack">
      <h2>Diário de hoje <span className="muted small">{fmtDay(today())}</span></h2>
      <StatusBanner checkin={checkin} devolvidos={devolvidos.length} />

      {items.map((it) => {
        const rv = reviews.find((r) => r.item_id === it.id)
        const its = photos.filter((p) => p.item_id === it.id)
        return (
          <div key={it.id} className="card stack">
            <div className="row between">
              <strong>{subjectName(it.subject_id)}</strong>
              {chapterName(it.chapter_id) && <span className="chip">{chapterName(it.chapter_id)}</span>}
            </div>
            {it.learned && <p><span className="muted small">Aprendi:</span> {it.learned}</p>}
            {it.pages && <p><span className="muted small">Folhas:</span> {it.pages}</p>}
            <Photos photos={its} onDelete={editable ? deletePhoto : undefined} />
            {editable && (
              <div className="row">
                <label className="button">+ fotos<input hidden type="file" accept="image/*" capture="environment" multiple onChange={(e) => addMorePhotos(it, e.target.files)} /></label>
                <button className="link danger" onClick={() => deleteItem(it)}>Tirar matéria</button>
              </div>
            )}
            {rv && !editable && <ReviewCard review={rv} />}
            {rv && editable && it.review_status === 'pendente' && rv.verdict === 'devolvido' && (
              <p className="note">Devolvido antes: {rv.message_to_child} Mande as fotos novas com os exercícios feitos.</p>
            )}
          </div>
        )
      })}

      {editable && (adding
        ? <AddItem subjects={subjects} chapters={chapters} familyId={profile!.family_id}
            onCancel={() => setAdding(false)}
            onSave={async (data, files) => {
              setBusy(true); setErr(null)
              try {
                const ck = await ensureCheckin()
                const { data: it, error } = await supabase.from('checkin_items')
                  .insert({ ...data, family_id: profile!.family_id, checkin_id: ck.id }).select().single()
                if (error) throw error
                await uploadPhotos(ck, it.id, files)
                setAdding(false)
              } catch (e: any) { setErr(e.message) }
              setBusy(false); reload()
            }} busy={busy} />
        : <button onClick={() => setAdding(true)}>+ Adicionar matéria de hoje</button>)}

      {err && <p className="note danger">{err}</p>}

      {editable && items.length > 0 && (
        <button className="primary big" disabled={busy} onClick={entregar}>Entregar o dia</button>
      )}
      {checkin?.status === 'corrigido' && devolvidos.length > 0 && (
        <button className="primary big" disabled={busy} onClick={refazer}>Refazer as folhas devolvidas</button>
      )}
    </div>
  )
}

function StatusBanner({ checkin, devolvidos }: { checkin: Checkin | null; devolvidos: number }) {
  if (!checkin) return <p className="banner">Conte o que você estudou hoje: matéria, o que aprendeu, quais folhas fez e fotos delas.</p>
  switch (checkin.status) {
    case 'rascunho': return <p className="banner">Quando terminar todas as matérias, toque em <b>Entregar o dia</b>.</p>
    case 'entregue': return <p className="banner info">Entregue às {new Date(checkin.submitted_at!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. A correção sai em até 1 hora.</p>
    case 'corrigindo': return <p className="banner info">Corrigindo agora…</p>
    case 'corrigido': return devolvidos
      ? <p className="banner warn">{devolvidos} matéria(s) voltaram: faça os exercícios e mande de novo.</p>
      : <p className="banner ok">Tudo corrigido! Veja as folhinhas de revisão abaixo.</p>
  }
}

interface ItemData { subject_id: string; chapter_id: string | null; learned: string; pages: string }

function AddItem({ subjects, chapters, familyId, onSave, onCancel, busy }: {
  subjects: Subject[]; chapters: Chapter[]; familyId: string; busy: boolean
  onSave: (d: ItemData, files: File[]) => void; onCancel: () => void
}) {
  const [subjectId, setSubjectId] = useState('')
  const [newSubject, setNewSubject] = useState('')
  const [chapterId, setChapterId] = useState('')
  const [newChapter, setNewChapter] = useState('')
  const [learned, setLearned] = useState('')
  const [pages, setPages] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [err, setErr] = useState<string | null>(null)
  const subjectChapters = useMemo(() => chapters.filter((c) => c.subject_id === subjectId && c.status === 'em_andamento'), [chapters, subjectId])

  async function save() {
    setErr(null)
    let sid = subjectId
    if (sid === 'nova') {
      if (!newSubject.trim()) return setErr('Escreva o nome da matéria.')
      const { data, error } = await supabase.from('subjects').upsert({ family_id: familyId, name: newSubject.trim(), active: true }, { onConflict: 'family_id,name' }).select().single()
      if (error) return setErr(error.message)
      sid = data.id
    }
    if (!sid) return setErr('Escolha a matéria.')
    let cid: string | null = chapterId || null
    if (chapterId === 'novo') {
      if (!newChapter.trim()) return setErr('Escreva o nome do capítulo.')
      const { data, error } = await supabase.from('chapters').upsert({ family_id: familyId, subject_id: sid, title: newChapter.trim() }, { onConflict: 'subject_id,title' }).select().single()
      if (error) return setErr(error.message)
      cid = data.id
    }
    if (!learned.trim()) return setErr('Conte em uma frase o que você aprendeu.')
    if (!files.length) return setErr('Tire foto das folhas que você fez.')
    onSave({ subject_id: sid, chapter_id: cid, learned: learned.trim(), pages: pages.trim() }, files)
  }

  return (
    <div className="card stack">
      <label>Matéria
        <select value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setChapterId('') }}>
          <option value="">Escolha…</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value="nova">+ Nova matéria</option>
        </select>
      </label>
      {subjectId === 'nova' && <input placeholder="Nome da matéria (ex.: Matemática)" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} />}
      {subjectId && (
        <label>Capítulo / módulo
          <select value={chapterId} onChange={(e) => setChapterId(e.target.value)}>
            <option value="">Não sei / não se aplica</option>
            {subjectChapters.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            <option value="novo">+ Novo capítulo</option>
          </select>
        </label>
      )}
      {chapterId === 'novo' && <input placeholder="Ex.: Módulo 7 – Equações do 1º grau" value={newChapter} onChange={(e) => setNewChapter(e.target.value)} />}
      <label>O que eu aprendi hoje<textarea rows={3} value={learned} onChange={(e) => setLearned(e.target.value)} /></label>
      <label>Quais folhas / páginas eu estudei<input placeholder="Ex.: págs. 34 a 37, exercícios 1 a 12" value={pages} onChange={(e) => setPages(e.target.value)} /></label>
      <label className="button">📷 Fotos das folhas ({files.length})
        <input hidden type="file" accept="image/*" capture="environment" multiple onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])} />
      </label>
      {err && <p className="note danger">{err}</p>}
      <div className="row">
        <button className="primary" disabled={busy} onClick={save}>{busy ? 'Enviando…' : 'Salvar matéria'}</button>
        <button className="link" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  )
}
