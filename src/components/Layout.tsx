import { useState, useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Calendar, Home, LogOut, Shield, Trophy, Users, BarChart3, CreditCard, MapPin } from 'lucide-react';
import { cn } from '../lib/utils';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { NotificationBell } from './NotificationBell';

export function Layout() {
  const { profile, isAdmin, logout, activeTeamId, myTeams, setActiveTeamId } = useAuth();
  const location = useLocation();
  const [siteLogo, setSiteLogo] = useState<string | null>(null);

  useEffect(() => {
    async function fetchLogo() {
      try {
        const docSnap = await getDoc(doc(db, 'settings', 'general'));
        if (docSnap.exists() && docSnap.data().logoUrl) {
          setSiteLogo(docSnap.data().logoUrl);
        }
      } catch (error) {
        console.error("Error fetching site logo:", error);
      }
    }

    fetchLogo();

    const handleLogoUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      setSiteLogo(customEvent.detail);
    };

    window.addEventListener('siteLogoUpdated', handleLogoUpdate);
    return () => window.removeEventListener('siteLogoUpdated', handleLogoUpdate);
  }, []);

  const navItems = [
    { name: 'Início', href: '/', icon: Home },
    { name: 'Meu Time', href: '/team', icon: Users },
    { name: 'Calendário', href: '/calendar', icon: Calendar },
    { name: 'Ranking', href: '/ranking', icon: BarChart3 },
    { name: 'Assinatura', href: '/subscription', icon: CreditCard },
  ];

  if (isAdmin) {
    navItems.push({ name: 'Admin', href: '/admin', icon: Shield });
  }

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col md:flex-row">
      {/* Sidebar / Bottom Nav */}
      <nav className="bg-zinc-900 text-zinc-100 flex-shrink-0 md:w-64 md:flex-col flex md:min-h-screen fixed md:sticky bottom-0 w-full z-50">
        <div className="p-4 hidden md:flex items-center gap-3 border-b border-zinc-800">
          {siteLogo ? (
            <img src={siteLogo} alt="Várzea Brasil" className="w-16 h-16 object-contain" />
          ) : (
            <div className="w-16 h-16 bg-emerald-500 rounded-lg flex items-center justify-center font-bold text-white text-xl">
              VB
            </div>
          )}
          <span className="font-bold text-lg tracking-tight text-white">Várzea Brasil</span>
        </div>

        <div className="flex-1 flex md:flex-col overflow-x-auto md:overflow-visible p-2 md:p-4 gap-1 md:gap-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.href || (item.href !== '/' && location.pathname.startsWith(item.href));
            
            return (
              <Link
                key={item.name}
                to={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-3 md:px-4 md:py-3 rounded-xl transition-colors min-w-[80px] md:min-w-0 justify-center md:justify-start",
                  isActive 
                    ? "bg-emerald-500 text-amber-400 font-medium shadow-md" 
                    : "text-zinc-300 hover:text-white hover:bg-zinc-800"
                )}
              >
                <Icon className="w-5 h-5" />
                <span className="text-xs md:text-sm hidden md:block">{item.name}</span>
              </Link>
            );
          })}

          {/* Mobile Logout Button */}
          <button
            onClick={logout}
            className="md:hidden flex items-center gap-3 px-3 py-3 rounded-xl transition-colors min-w-[80px] justify-center text-zinc-300 hover:text-red-400 hover:bg-red-400/10"
            title="Sair"
          >
            <LogOut className="w-5 h-5" />
            <span className="text-xs hidden">Sair</span>
          </button>
        </div>

        <div className="hidden md:block p-4 border-t border-zinc-800">
          {myTeams.length > 0 && (
            <div className="mb-4">
              <label className="block text-xs font-medium text-zinc-400 mb-1">Time Ativo</label>
              <select
                value={activeTeamId || ''}
                onChange={(e) => setActiveTeamId(e.target.value)}
                className="w-full p-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                {myTeams.map(team => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center gap-3 mb-4">
            <img src={profile?.photoURL || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + profile?.uid} alt="Profile" className="w-10 h-10 rounded-full bg-zinc-800 border border-zinc-700" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate text-white">{profile?.displayName}</p>
              <p className="text-xs text-zinc-300 truncate">{profile?.role === 'admin' ? 'Administrador' : 'Gestor de Time'}</p>
            </div>
          </div>
          <button 
            onClick={logout}
            className="flex items-center gap-2 text-sm text-zinc-300 hover:text-red-400 transition-colors w-full px-2 py-2 rounded-lg hover:bg-red-400/10"
          >
            <LogOut className="w-4 h-4" />
            Sair
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 pb-20 md:pb-0 overflow-y-auto relative flex flex-col min-h-screen">
        {/* Mobile Header */}
        <div className="md:hidden bg-zinc-900 text-white p-4 sticky top-0 z-40 flex items-center justify-between border-b border-zinc-800">
          <div className="flex items-center gap-2">
            {siteLogo ? (
              <img src={siteLogo} alt="Logo" className="w-8 h-8 object-contain" />
            ) : (
              <div className="w-8 h-8 bg-emerald-500 rounded flex items-center justify-center font-bold text-xs">VB</div>
            )}
            {myTeams.length > 0 ? (
              <select
                value={activeTeamId || ''}
                onChange={(e) => setActiveTeamId(e.target.value)}
                className="bg-transparent text-sm font-medium focus:outline-none max-w-[150px] truncate"
              >
                {myTeams.map(team => (
                  <option key={team.id} value={team.id} className="text-black">{team.name}</option>
                ))}
              </select>
            ) : (
              <span className="font-bold text-sm">Várzea Brasil</span>
            )}
          </div>
          <NotificationBell />
        </div>

        <div className="hidden md:block absolute top-8 right-8 z-50">
          <NotificationBell />
        </div>
        <div className="max-w-5xl mx-auto w-full p-4 md:p-8 pt-4 md:pt-8 flex-1">
          <Outlet />
        </div>

        {/* WhatsApp Support Button */}
        <a
          href="https://wa.me/5511953672297"
          target="_blank"
          rel="noopener noreferrer"
          className="fixed bottom-24 md:bottom-8 right-4 md:right-8 z-50 bg-[#25D366] text-white p-3 md:p-4 rounded-full shadow-lg hover:bg-[#128C7E] transition-all flex items-center justify-center hover:scale-110 duration-200 group"
          aria-label="Suporte via WhatsApp"
        >
          <span className="absolute right-full mr-4 bg-zinc-900 text-white text-xs px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            Suporte
          </span>
          <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="0" fill="currentColor" className="w-6 h-6 md:w-7 md:h-7">
            <path d="M17.498 14.382c-.301-.15-1.767-.867-2.04-.966-.273-.101-.473-.15-.673.15-.197.295-.771.964-.944 1.162-.175.195-.349.21-.646.06-.301-.15-1.265-.464-2.403-1.485-.888-.795-1.484-1.77-1.66-2.07-.174-.3-.019-.465.13-.615.136-.135.301-.345.451-.523.146-.181.194-.301.297-.496.098-.21.046-.39-.03-.54-.075-.15-.671-1.62-.922-2.206-.24-.579-.492-.501-.671-.51l-.573-.006c-.198 0-.52.074-.792.375-.271.298-1.045 1.02-1.045 2.475s1.07 2.865 1.219 3.075c.149.21 2.095 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
          </svg>
        </a>
      </main>
    </div>
  );
}
