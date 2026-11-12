import { useEffect, useMemo, useState } from 'react'
import { supabase, BUCKET } from '../lib/supabase'
import { useSession } from '../lib/session'
import { loadActiveTimetable, loadChapters, loadSubjects, shrinkImage, uploadToBucket } from '../lib/data'
import { fmtDay, today } from '../lib/dates'
import { Link } from 'react-router-dom'
import type { Book, Chapter, Checkin, CheckinItem, Photo, Review, Subject, Task } from '../lib/types'
import ReviewCard, { TodoList } from '../components/ReviewCard'
import Photos from '../components/Photos'

export default function Hoje() {
  const { profile } = useSession()
  const [checkin, setCheckin] = useState<Checkin | null>(null)
  const [items, setItems] = useState<CheckinItem[]>([])
  const [photos, setPhotos] = useState<Photo[]>([])
  const [reviews, setReviews] = useState<Review[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [books, setBooks] = useState<Book[]>([])
  const [grade, setGrade] = useState<Record<number, string[]>>({})
  const [tasks, setTasks] = useState<Task[]>([])
  const [toFix, setToFix] = useState<{ item: CheckinItem; day: string; review: Review | null; photos: Photo[] }[]>([])
  const [adding, setAdding] = useState<string | boolean>(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function reload() {
    const [s, c, g, { data: bk }, { data: tk }] = await Promise.all([
      loadSubjects(), loadChapters(), loadActiveTimetable(),
      supabase.from('books').select('*').eq('status', 'cadastrado').order('created_at'),
      supabase.from('tasks').select('*').eq('status', 'pendente').order('due_on'),
    ])
    setSubjects(s); setChapters(c); setGrade(g); setBooks((bk ?? []) as Book[]); setTasks((tk ?? []) as Task[])
    await loadToFix()
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

  // Matérias devolvidas (de qualquer dia) que ele ainda precisa completar e reenviar
  async function loadToFix() {
    const { data: its } = await supabase.from('checkin_items').select('*, checkins!inner(day, child_id)')
      .eq('review_status', 'devolvido').eq('checkins.child_id', profile!.id)
    const list = (its ?? []) as (CheckinItem & { checkins: { day: string } })[]
    const ids = list.map((i) => i.id)
    if (!ids.length) { setToFix([]); return }
    const [{ data: rv }, { data: ph }] = await Promise.all([
      supabase.from('reviews').select('*').in('item_id', ids),
      supabase.from('photos').select('*').in('item_id', ids).order('version').order('sort', { nullsFirst: false }),
    ])
    setToFix(list.sort((a, b) => a.checkins.day.localeCompare(b.checkins.day)).map((i) => ({
      item: i, day: i.checkins.day,
      review: ((rv ?? []) as Review[]).find((r) => r.item_id === i.id) ?? null,
      photos: ((ph ?? []) as Photo[]).filter((p) => p.item_id === i.id),
    })))
  }

  // Atualiza sozinho enquanto espera a correção
  useEffect(() => {
    if (!checkin || (checkin.status !== 'entregue' && checkin.status !== 'corrigindo')) return
    const t = setInterval(reload, 60_000)
    return () => clearInterval(t)
  }, [checkin?.status])

  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name ?? '?'
  const chapterName = (id: string | null) => chapters.find((c) => c.id === id)?.title
  const editable = !checkin || checkin.status === 'rascunho'
  const weekday = new Date(today() + 'T12:00:00Z').getUTCDay()
  const expected = grade[weekday] ?? []
  const isRequired = (sid: string) => subjects.find((s) => s.id === sid)?.required ?? false
  const missingSubjects = expected.filter((sid) => isRequired(sid) && !items.some((i) => i.subject_id === sid))
  const pageCount = (i: CheckinItem) => (i.page_from != null && i.page_to != null ? i.page_to - i.page_from + 1 : 1)
  const missingPhotos = items.filter((i) => !i.no_class_reason && photos.filter((p) => p.item_id === i.id).length < pageCount(i))
  const devolvidos = toFix.length

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
    if (missingSubjects.length) { setErr('Hoje tem na grade: ' + missingSubjects.map(subjectName).join(', ') + '. Lance cada uma (ou marque que não teve aula).'); return }
    if (missingPhotos.length) { setErr('Falta foto de página em: ' + missingPhotos.map((i) => `${subjectName(i.subject_id)} (${photos.filter((p) => p.item_id === i.id).length} de ${pageCount(i)})`).join(', ') + '. Toda página conta, mesmo em branco.'); return }
    if (!confirm('Entregar o dia? Depois disso não dá pra mexer até a correção sair.')) return
    setBusy(true)
    const { error } = await supabase.from('checkins').update({ status: 'entregue', submitted_at: new Date().toISOString() }).eq('id', checkin.id)
    if (error) setErr(error.message)
    setBusy(false); reload()
  }

  return (
    <div className="stack">
      <h2>Diário de hoje <span className="muted small">{fmtDay(today())}</span></h2>
      <StatusBanner checkin={checkin} devolvidos={devolvidos} />

      {toFix.map((f) => (
        <Completar key={f.item.id} entry={f} subjectName={subjectName(f.item.subject_id)} chapterName={chapterName(f.item.chapter_id)}
          familyId={profile!.family_id} onDone={reload} />
      ))}

      {tasks.length > 0 && (
        <div className="card stack">
          <h3>Pendências</h3>
          {tasks.map((t) => (
            <div key={t.id} className="sub">
              <b>{t.title}</b>{t.due_on && <span className={'small ' + (t.due_on < today() ? 'danger' : 'muted')}> · até {fmtDay(t.due_on)}</span>}
              {t.instructions && <p className="small">{t.instructions}</p>}
              {t.quiz_id && <Link to="/provinhas" className="small">Abrir revisão →</Link>}
            </div>
          ))}
        </div>
      )}

      {expected.length > 0 && (
        <div className="chips">
          <span className="small muted">Hoje tem:</span>
          {expected.map((sid) => (
            <button key={sid} className={'chip ' + (items.some((i) => i.subject_id === sid) ? 'done' : '')}
              disabled={!editable || items.some((i) => i.subject_id === sid)} onClick={() => setAdding(sid)}>
              {items.some((i) => i.subject_id === sid) ? '✓ ' : ''}{subjectName(sid)}{isRequired(sid) ? '' : ' (opcional)'}
            </button>
          ))}
        </div>
      )}

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
            {it.no_class_reason && <p className="note">Não teve conteúdo: {it.no_class_reason}</p>}
            {it.page_from != null && <p><span className="muted small">Páginas:</span> {it.page_from} a {it.page_to} · <span className={its.length < pageCount(it) ? 'danger' : 'muted'}>{its.length} de {pageCount(it)} fotos</span></p>}
            {it.pages && <p><span className="muted small">Obs.:</span> {it.pages}</p>}
            <Photos photos={its} onDelete={editable ? deletePhoto : undefined} />
            {editable && !it.no_class_reason && (
              <div className="row">
                <label className="button">+ fotos<input hidden type="file" accept="image/*" capture="environment" multiple onChange={(e) => addMorePhotos(it, e.target.files)} /></label>
                <button className="link danger" onClick={() => deleteItem(it)}>Tirar matéria</button>
              </div>
            )}
            {it.review_status === 'devolvido' && <p className="note warn">Falta completar: veja o pedido lá em cima.</p>}
            {it.review_status === 'pendente' && it.version > 1 && <p className="note">Versão {it.version} enviada. Esperando a correção.</p>}
            {rv && it.review_status === 'aceito' && <ReviewCard review={rv} />}
          </div>
        )
      })}

      {editable && (adding
        ? <AddItem subjects={subjects} chapters={chapters} books={books} familyId={profile!.family_id}
            initialSubject={typeof adding === 'string' ? adding : ''}
            onCancel={() => setAdding(false)}
            onSave={async (data, files) => {
              setBusy(true); setErr(null)
              try {
                const ck = await ensureCheckin()
                const { data: it, error } = await supabase.from('checkin_items')
                  .insert({ ...data, family_id: profile!.family_id, checkin_id: ck.id }).select().single()
                if (error) throw error
                if (files.length) await uploadPhotos(ck, it.id, files)
                setAdding(false)
              } catch (e: any) { setErr(e.message) }
              setBusy(false); reload()
            }} busy={busy} />
        : <button onClick={() => setAdding(true)}>+ Adicionar matéria de hoje</button>)}

      {err && <p className="note danger">{err}</p>}

      {editable && items.length > 0 && (
        <button className="primary big" disabled={busy} onClick={entregar}>Entregar o dia</button>
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
      ? <p className="banner warn">Quase lá! Complete o que está pedido acima e reenvie.</p>
      : <p className="banner ok">Tudo corrigido! Veja as folhinhas de revisão abaixo.</p>
  }
}

// Uma matéria devolvida: mostra exatamente o que falta e deixa mandar só essas fotos (nova versão)
function Completar({ entry, subjectName, chapterName, familyId, onDone }: {
  entry: { item: CheckinItem; day: string; review: Review | null; photos: Photo[] }
  subjectName: string; chapterName?: string; familyId: string; onDone: () => void
}) {
  const { item, day, review, photos } = entry
  const [files, setFiles] = useState<File[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function send() {
    if (!files.length) return setErr('Tire as fotos do que foi pedido antes de reenviar.')
    setBusy(true); setErr(null)
    try {
      const paths: string[] = []
      for (const f of files) paths.push(await uploadToBucket(familyId, `${item.checkin_id}/${item.id}`, f))
      const { error } = await supabase.rpc('resend_item', { p_item: item.id, p_paths: paths, p_note: note.trim() })
      if (error) throw error
      setFiles([]); setNote(''); onDone()
    } catch (e: any) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div className="card stack review devolvido">
      <div className="row between">
        <strong>Completar: {subjectName}</strong>
        <span className="small muted">{fmtDay(day)}{item.page_from != null ? ` · págs. ${item.page_from}–${item.page_to}` : ''}</span>
      </div>
      {chapterName && <span className="small muted">{chapterName}</span>}
      {review?.message_to_child && <p>{review.message_to_child}</p>}
      {review?.todo?.length ? <TodoList todo={review.todo} /> : <p className="small">Faça os exercícios que ficaram em branco e mande as fotos de novo.</p>}
      {review && review.exercises.length > 0 && (
        <details>
          <summary className="small">Ver a correção da versão {review.version}</summary>
          <ReviewCard review={review} />
        </details>
      )}
      <details>
        <summary className="small">Fotos que você já mandou ({photos.length})</summary>
        <Photos photos={photos} />
      </details>
      <label className="button">📷 Fotos do que foi pedido ({files.length})
        <input hidden type="file" accept="image/*" capture="environment" multiple onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])} />
      </label>
      {files.length > 0 && <button className="link small" onClick={() => setFiles([])}>Limpar fotos escolhidas</button>}
      <input placeholder="Recado (opcional), ex.: refiz a Q3" value={note} onChange={(e) => setNote(e.target.value)} />
      <p className="small muted">Mande só as páginas pedidas (ou as que você refez). Eu junto com as que já estão aqui.</p>
      {err && <p className="note danger">{err}</p>}
      <button className="primary" disabled={busy} onClick={send}>{busy ? 'Enviando…' : `Reenviar (versão ${item.version + 1})`}</button>
    </div>
  )
}

interface ItemData {
  subject_id: string; chapter_id: string | null; book_id: string | null; learned: string; pages: string
  page_from: number | null; page_to: number | null; no_class_reason: string | null
}

function AddItem({ subjects, chapters, books, familyId, initialSubject, onSave, onCancel, busy }: {
  subjects: Subject[]; chapters: Chapter[]; books: Book[]; familyId: string; initialSubject: string; busy: boolean
  onSave: (d: ItemData, files: File[]) => void; onCancel: () => void
}) {
  const [subjectId, setSubjectId] = useState(initialSubject)
  const [newSubject, setNewSubject] = useState('')
  const [noClass, setNoClass] = useState(false)
  const [reason, setReason] = useState('')
  const [chapterId, setChapterId] = useState('')
  const [newChapter, setNewChapter] = useState('')
  const [bookId, setBookId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [learned, setLearned] = useState('')
  const [pages, setPages] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [err, setErr] = useState<string | null>(null)
  const subjectChapters = useMemo(() => chapters.filter((c) => c.subject_id === subjectId && c.status === 'em_andamento')
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)), [chapters, subjectId])
  const chosen = chapters.find((c) => c.id === chapterId)
  const nPages = from && to && Number(to) >= Number(from) ? Number(to) - Number(from) + 1 : 0

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
    if (noClass) {
      if (!reason.trim()) return setErr('Conte o que aconteceu (ex.: professor faltou, teve prova, passeio).')
      return onSave({ subject_id: sid, chapter_id: null, book_id: null, learned: '', pages: '', page_from: null, page_to: null, no_class_reason: reason.trim() }, [])
    }
    let cid: string | null = chapterId || null
    if (chapterId === 'novo') {
      if (!newChapter.trim()) return setErr('Escreva o nome do capítulo.')
      const { data, error } = await supabase.from('chapters').upsert({ family_id: familyId, subject_id: sid, title: newChapter.trim() }, { onConflict: 'subject_id,title' }).select().single()
      if (error) return setErr(error.message)
      cid = data.id
    }
    if (!nPages) return setErr('Diga de qual página até qual página você estudou.')
    if (!learned.trim()) return setErr('Conte em uma frase o que você aprendeu.')
    if (files.length < nPages) return setErr(`São ${nPages} páginas: mande ${nPages} fotos (uma por página, mesmo as em branco). Você mandou ${files.length}.`)
    onSave({ subject_id: sid, chapter_id: cid, book_id: bookId || chosen?.book_id || null, learned: learned.trim(), pages: pages.trim(),
      page_from: Number(from), page_to: Number(to), no_class_reason: null }, files)
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
      <label className="option"><input type="checkbox" checked={noClass} onChange={(e) => setNoClass(e.target.checked)} /> <span>Hoje não teve conteúdo dessa matéria</span></label>
      {noClass ? (
        <label>O que aconteceu?<input placeholder="Ex.: professor faltou, teve prova, passeio" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      ) : (<>
        {subjectId && (
          <label>Capítulo / módulo
            <select value={chapterId} onChange={(e) => setChapterId(e.target.value)}>
              <option value="">Não sei</option>
              {subjectChapters.map((c) => <option key={c.id} value={c.id}>{c.title}{c.start_page ? ` (págs. ${c.start_page}–${c.end_page})` : ''}</option>)}
              <option value="novo">+ Novo capítulo</option>
            </select>
          </label>
        )}
        {chapterId === 'novo' && <input placeholder="Ex.: Módulo 7 – Equações do 1º grau" value={newChapter} onChange={(e) => setNewChapter(e.target.value)} />}
        {books.length > 0 && !chosen?.book_id && (
          <label>Livro
            <select value={bookId} onChange={(e) => setBookId(e.target.value)}>
              <option value="">Não sei</option>
              {books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
          </label>
        )}
        <div className="row">
          <label style={{ flex: 1 }}>Da página<input inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, ''))} /></label>
          <label style={{ flex: 1 }}>Até a página<input inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, ''))} /></label>
        </div>
        <label>O que eu aprendi hoje<textarea rows={3} value={learned} onChange={(e) => setLearned(e.target.value)} /></label>
        <label>Observação <span className="muted small">(opcional)</span><input placeholder="Ex.: o professor pediu só os ímpares" value={pages} onChange={(e) => setPages(e.target.value)} /></label>
        <label className="button">📷 Fotos das páginas ({files.length}{nPages ? ` de ${nPages}` : ''})
          <input hidden type="file" accept="image/*" capture="environment" multiple onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])} />
        </label>
        <p className="small muted">Uma foto por página, inclusive as em branco. Pode mandar fora de ordem que eu organizo.</p>
      </>)}
      {err && <p className="note danger">{err}</p>}
      <div className="row">
        <button className="primary" disabled={busy} onClick={save}>{busy ? 'Enviando…' : 'Salvar matéria'}</button>
        <button className="link" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  )
}
