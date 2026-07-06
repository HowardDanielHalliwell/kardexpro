import { Outlet, NavLink } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/', label: 'Inicio', icon: '🏠', end: true },
  { to: '/grupos', label: 'Grupos', icon: '👥' },
  { to: '/registro', label: 'Registro', icon: '📋' },
  { to: '/materias', label: 'Materias', icon: '📚' },
  { to: '/ajustes', label: 'Ajustes', icon: '⚙️' },
]

export default function Layout() {
  return (
    <>
      <header className="app-header">
        <div className="brand">
          Kardex<span>Pro</span>
        </div>
        <div className="subtitle">
          Genius Cooper™
          <br />
          Colegio Mano Amiga Chalco
        </div>
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      <nav className="bottom-nav" aria-label="Navegación principal">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => (isActive ? 'active' : '')}
          >
            <span className="icon" aria-hidden="true">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </>
  )
}
