import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [mode, setMode] = useState<'entrar' | 'cadastrar'>('entrar')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [invite, setInvite] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    if (mode === 'entrar') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setMsg('Não deu pra entrar: ' + error.message)
    } else {
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { name, invite_code: invite.trim() || undefined }, emailRedirectTo: location.origin },
      })
      if (error) setMsg('Não deu pra cadastrar: ' + error.message)
      else if (!data.session) setMsg('Conta criada! Confirme pelo link que chegou no seu e-mail e depois entre.')
    }
    setBusy(false)
  }

  return (
    <div className="login">
      <h1>AcompanhaEscola</h1>
      <p className="muted">Diário de estudos, correção das folhas e provinhas de revisão.</p>
      <form onSubmit={submit} className="card stack">
        {mode === 'cadastrar' && (
          <label>Nome<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        )}
        <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
        <label>Senha<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete={mode === 'entrar' ? 'current-password' : 'new-password'} /></label>
        {mode === 'cadastrar' && (
          <label>Código da família <span className="muted small">(só o aluno preenche; o responsável deixa em branco)</span>
            <input value={invite} onChange={(e) => setInvite(e.target.value.toUpperCase())} placeholder="ex.: 3FA9C21B" />
          </label>
        )}
        <button className="primary" disabled={busy}>{mode === 'entrar' ? 'Entrar' : 'Criar conta'}</button>
        {msg && <p className="note">{msg}</p>}
      </form>
      <button className="link" onClick={() => setMode(mode === 'entrar' ? 'cadastrar' : 'entrar')}>
        {mode === 'entrar' ? 'Primeira vez? Criar conta' : 'Já tenho conta'}
      </button>
    </div>
  )
}
