import { NavLink, useNavigate } from 'react-router-dom';
import { classNames } from '../../lib/utils';
import { api } from '../../lib/api';

const navigation = [
  { path: '/', label: 'Dashboard' },
  { path: '/deployments/new', label: 'Nova Instalação' },
  { path: '/deployments', label: 'Histórico' },
  { path: '/credentials', label: 'Credenciais' },
];

export function Header() {
  const navigate = useNavigate();

  const handleLogout = () => {
    api.logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className="header" role="banner">
      <div className="header-content">
        <NavLink to="/" className="header-brand" aria-label="Apollo Installer Admin - Início">
          <div className="header-logo" aria-hidden="true">A</div>
          <span className="header-title">Apollo Installer</span>
        </NavLink>
        <nav className="header-nav" aria-label="Navegação principal">
          {navigation.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                classNames('nav-link', isActive && 'active')
              }
              end={item.path === '/'}
            >
              {item.label}
            </NavLink>
          ))}
          <button
            type="button"
            className="nav-link"
            onClick={handleLogout}
            style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}
          >
            Sair
          </button>
        </nav>
      </div>
    </header>
  );
}