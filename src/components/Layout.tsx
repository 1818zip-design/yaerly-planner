import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav'

export default function Layout() {
  return (
    <div
      style={{
        minHeight: '100dvh',
        backgroundColor: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <main
        style={{
          flex: 1,
          overflowY: 'auto',
          paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))',
          maxWidth: '100vw',
          overflowX: 'hidden',
        }}
      >
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
