import { useEffect, useState } from 'react';
import { onIdTokenChanged, signOut } from 'firebase/auth';
import { apiRequest } from './lib/api.ts';
import { auth } from './lib/firebase.ts';
import { AdminConsole } from './components/AdminConsole.tsx';
import { AnalyticsView } from './components/AnalyticsView.tsx';
import { CampusHeatmapView } from './components/CampusHeatmapView.tsx';
import { PhotoModal } from './components/PhotoModal.tsx';
import { StudentPortal } from './components/StudentPortal.tsx';
import type { AuthUser, CampusLocationName } from './shared/campus.ts';

type TabId = 'student' | 'heatmap' | 'analytics' | 'admin' | 'unauthorized';

export default function App() {
  // Keep auth token strictly in memory (never in localStorage)
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('student');
  const [heatmapScope, setHeatmapScope] = useState<'campus' | CampusLocationName>('campus');
  const [modalImageUrl, setModalImageUrl] = useState<string | null>(null);

  // Keep Firebase ID token synced in memory when signed in via Google
  useEffect(() => {
    const unsubscribe = onIdTokenChanged(auth, async (fbUser) => {
      if (!fbUser) return;
      try {
        const freshToken = await fbUser.getIdToken();
        const res = await apiRequest<{ user: AuthUser }>('/api/auth/session', {
          token: freshToken,
        });
        setToken(freshToken);
        setUser(res.user);
      } catch {
        // Ignore if user hasn't completed role-specific Firebase exchange yet
      }
    });
    return () => unsubscribe();
  }, []);

  const isAdm = user?.role === 'admin';
  const isStu = user?.role === 'student';

  function switchTab(tab: TabId) {
    const adminProtected = tab === 'heatmap' || tab === 'analytics' || tab === 'admin';
    if (isStu && adminProtected) {
      setActiveTab('unauthorized');
      return;
    }
    if (!isAdm && (tab === 'heatmap' || tab === 'analytics')) {
      setActiveTab('admin');
      return;
    }
    setActiveTab(tab);
  }

  function handleAuthenticated(newToken: string, authUser: AuthUser) {
    setToken(newToken);
    setUser(authUser);
    if (authUser.role === 'admin') {
      setActiveTab('heatmap');
    } else {
      setActiveTab('student');
    }
  }

  async function handleLogout() {
    setToken(null);
    setUser(null);
    setActiveTab('student');
    setHeatmapScope('campus');
    try {
      await signOut(auth);
    } catch {
      // Ignore Firebase sign-out errors if session was local
    }
  }

  function handleOpenLocationHeatmap(loc: CampusLocationName) {
    setHeatmapScope(loc);
    switchTab('heatmap');
  }

  const navItems: { id: TabId; label: string }[] = isAdm
    ? [
        { id: 'heatmap', label: 'Campus Heatmap' },
        { id: 'analytics', label: 'Analytics' },
        { id: 'admin', label: 'Admin Console' },
      ]
    : isStu
    ? [{ id: 'student', label: 'Student Portal' }]
    : [
        { id: 'student', label: 'Student Portal' },
        { id: 'admin', label: 'Admin Login' },
      ];

  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#0f172a]">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-6 px-6 py-3.5">
          <a
            href="#student"
            onClick={(e) => {
              e.preventDefault();
              switchTab(isAdm ? 'heatmap' : 'student');
            }}
            className="brand whitespace-nowrap text-lg font-bold text-slate-900 no-underline"
          >
            RGUKT Basar Heatmap
          </a>

          <nav className="flex flex-wrap items-center gap-6">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => switchTab(item.id)}
                className={`cursor-pointer whitespace-nowrap border-b-2 bg-transparent px-0.5 py-1.5 text-sm ${
                  activeTab === item.id
                    ? 'border-blue-700 font-semibold text-slate-900'
                    : 'border-transparent font-medium text-slate-500 hover:text-slate-800'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div>
            {user ? (
              <button
                type="button"
                onClick={handleLogout}
                className="cursor-pointer whitespace-nowrap rounded-lg bg-slate-900 px-4 py-2 text-[13px] font-semibold text-white hover:bg-slate-800"
              >
                Sign Out
              </button>
            ) : (
              <button
                type="button"
                onClick={() => switchTab(activeTab === 'admin' ? 'student' : 'admin')}
                className="cursor-pointer whitespace-nowrap rounded-lg bg-blue-700 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-800"
              >
                {activeTab === 'admin' ? 'Student Portal' : 'Admin Login'}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1360px] p-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Campus Heatmap of Problems — RGUKT Basar
            </h1>
            <p className="mt-0.5 text-[13px] text-slate-500">
              Rajiv Gandhi University of Knowledge Technologies, Basar, Nirmal, Telangana ·
              Role-Based Portal
            </p>
          </div>
          <div className="mono text-xs text-slate-500">
            {isAdm
              ? `Admin Session · ${user.email}`
              : isStu
              ? `Student: ${user.rollNumber || user.email}`
              : 'Guest'}
          </div>
        </div>

        {activeTab === 'unauthorized' && (
          <div className="mx-auto max-w-[520px] rounded-xl border border-slate-200 bg-white p-7 text-center">
            <h2 className="text-lg font-bold text-red-700">
              403 Unauthorized — Administrator Access Only
            </h2>
            <p className="mt-2 text-[13px] text-slate-600">
              The RGUKT Basar campus heatmap, analytics dashboard, and student contact directory
              are strictly restricted to authenticated administrators.
            </p>
            <button
              type="button"
              onClick={() => switchTab('student')}
              className="mt-4 cursor-pointer rounded-lg bg-blue-700 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-800"
            >
              Return to Student Portal
            </button>
          </div>
        )}

        {activeTab === 'student' && (
          <StudentPortal
            user={user}
            token={token}
            onAuthenticated={handleAuthenticated}
            onUserUpdated={setUser}
            onViewPhoto={setModalImageUrl}
          />
        )}

        {activeTab === 'heatmap' && isAdm && token && (
          <CampusHeatmapView
            token={token}
            initialLocationScope={heatmapScope}
            onViewPhoto={setModalImageUrl}
          />
        )}

        {activeTab === 'analytics' && isAdm && token && (
          <AnalyticsView
            token={token}
            onOpenLocationHeatmap={handleOpenLocationHeatmap}
          />
        )}

        {activeTab === 'admin' && (
          <AdminConsole
            user={user}
            token={token}
            onAuthenticated={handleAuthenticated}
            onOpenLocationHeatmap={handleOpenLocationHeatmap}
            onViewPhoto={setModalImageUrl}
          />
        )}
      </main>

      <PhotoModal
        imageUrl={modalImageUrl}
        token={token}
        onClose={() => setModalImageUrl(null)}
      />
    </div>
  );
}
