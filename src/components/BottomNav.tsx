import { useLocation, useNavigate } from 'react-router-dom';

const navItems = [
  { path: '/', label: '首頁', icon: '⌂' },
  { path: '/goals', label: '目標', icon: '◎' },
  { path: '/tasks', label: '任務', icon: '✓' },
  { path: '/habits', label: '習慣', icon: '◆' },
  { path: '/mood', label: '日記', icon: '✎' },
  { path: '/expenses', label: '記帳', icon: '¥' },
  { path: '/summary', label: '總覽', icon: '▦' },
];

export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
      background: 'rgba(242,242,247,0.72)',
      borderTop: '0.5px solid rgba(60,60,67,0.12)',
      display: 'flex', justifyContent: 'space-around',
      padding: '6px 0 2px',
      paddingBottom: 'calc(6px + env(safe-area-inset-bottom, 0px))',
      zIndex: 100,
    }}>
      {navItems.map((item) => {
        const isActive = location.pathname === item.path;
        return (
          <button key={item.path} onClick={() => navigate(item.path)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              background: 'none', border: 'none', cursor: 'pointer',
              color: isActive ? '#8B9EC7' : '#AEAEB2',
              fontSize: '10px', gap: '1px', padding: '4px 6px',
              fontWeight: isActive ? '600' : '400',
            }}>
            <span style={{ fontSize: '20px' }}>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
