import { useEffect, useState } from 'react'
import { signedUrls } from '../lib/data'
import type { Photo } from '../lib/types'

export default function Photos({ photos, onDelete }: { photos: Photo[]; onDelete?: (p: Photo) => void }) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const key = photos.map((p) => p.storage_path).join('|')
  useEffect(() => { signedUrls(photos.map((p) => p.storage_path)).then(setUrls) }, [key])
  if (!photos.length) return null
  return (
    <div className="thumbs">
      {photos.map((p) => (
        <div key={p.id} className="thumb">
          {urls[p.storage_path] ? <a href={urls[p.storage_path]} target="_blank" rel="noreferrer"><img src={urls[p.storage_path]} alt="folha" /></a> : <div className="ph" />}
          {p.version > 1 && <span className="ver">v{p.version}</span>}
          {onDelete && <button className="x" onClick={() => onDelete(p)} aria-label="Apagar foto">×</button>}
        </div>
      ))}
    </div>
  )
}
