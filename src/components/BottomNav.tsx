import { useLocation, useNavigate } from 'react-router-dom';

const navItems = [
  { path: '/', label: '首頁', icon: '⌂' },
  { path: '/goals', label: '目標', icon: '◎' },
  { path: '/tasks', label: '任務', icon: '✓' },
  { path: '/habits', label: '習慣', icon: '◆' },
  { path: '/mood', label: '日記+心情', icon: '✎' },
  { path: '/expenses', label: '記帳', icon: '¥' },
];

export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      background: '#ffffff', borderTop: '1px solid #e5e5e5',
      display: 'flex', justifyContent: 'space-around',
      padding: '8px 0', paddingBottom: 'calc(8px + env(safe-area-inset-bottom, 0px))',
      zIndex: 100,
    }}>
      {navItems.map((item) => {
        const isActive = location.pathname === item.path;
        return (
          <button key={item.path} onClick={() => navigate(item.path)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              background: 'none', border: 'none', cursor: 'pointer',
              color: isActive ? '#7c3aed' : '#999',
              fontSize: '10px', gap: '2px', padding: '4px 8px'
            }}>
            <span style={{ fontSize: '20px' }}>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
