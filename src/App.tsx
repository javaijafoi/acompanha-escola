import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useSession } from './lib/session'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Hoje from './pages/Hoje'
import Provinhas from './pages/Provinhas'
import Historico from './pages/Historico'
import Painel from './pages/Painel'
import Materias from './pages/Materias'
import Configurar from './pages/Configurar'

export default function App() {
  const { session, profile, loading } = useSession()
  if (loading) return <div className="center muted">Carregando…</div>
  if (!session) return <Login />
  if (!profile) return <div className="center">Perfil não encontrado. Saia e entre de novo.<br /><button onClick={() => supabase.auth.signOut()}>Sair</button></div>

  const child = profile.role === 'child'
  return (
    <div className="app">
      <header className="top">
        <strong>AcompanhaEscola</strong>
        <span className="muted small">{profile.name} · {child ? 'aluno' : 'responsável'}</span>
        <button className="link" onClick={() => supabase.auth.signOut()}>Sair</button>
      </header>
      <main>
        <Routes>
          {child ? (
            <>
              <Route path="/" element={<Hoje />} />
              <Route path="/provinhas" element={<Provinhas />} />
              <Route path="/historico" element={<Historico />} />
            </>
          ) : (
            <>
              <Route path="/" element={<Painel />} />
              <Route path="/historico" element={<Historico />} />
              <Route path="/provinhas" element={<Provinhas />} />
            </>
          )}
          <Route path="/materias" element={<Materias />} />
          <Route path="/configurar" element={<Configurar />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
      <nav className="tabs">
        <NavLink to="/" end>{child ? 'Hoje' : 'Painel'}</NavLink>
        <NavLink to="/provinhas">Provinhas</NavLink>
        <NavLink to="/historico">Histórico</NavLink>
        <NavLink to="/materias">Matérias</NavLink>
        <NavLink to="/configurar">Ajustes</NavLink>
      </nav>
    </div>
  )
}
