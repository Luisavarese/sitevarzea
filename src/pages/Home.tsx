import { useEffect, useState } from 'react';
import { collection, query, where, getDocs, orderBy, limit, getDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { Trophy, Calendar as CalendarIcon, MapPin, ExternalLink, ChevronLeft, ChevronRight, CreditCard, AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';

interface Banner {
  id: string;
  imageUrl: string;
  link: string;
  type: 'promo';
  active: boolean;
  order: number;
  mainText?: string;
}

interface Match {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName?: string;
  awayTeamName?: string;
  date: string;
  location: string;
  status: string;
  isFestival?: boolean;
}

const DEFAULT_BANNERS: Banner[] = [
  {
    id: 'default-1',
    imageUrl: 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?q=80&w=1920&auto=format&fit=crop',
    link: '#',
    type: 'promo',
    active: true,
    order: 1,
    mainText: 'Campeonato Regional 2026'
  },
  {
    id: 'default-2',
    imageUrl: 'https://images.unsplash.com/photo-1518605368461-1ee7e161756a?q=80&w=1920&auto=format&fit=crop',
    link: '#',
    type: 'promo',
    active: true,
    order: 2,
    mainText: 'Novos Uniformes com Desconto'
  },
  {
    id: 'default-3',
    imageUrl: 'https://images.unsplash.com/photo-1510566337590-2fc1f21d0faa?q=80&w=1920&auto=format&fit=crop',
    link: '#',
    type: 'promo',
    active: true,
    order: 3,
    mainText: 'Torneio de Férias'
  }
];

export function Home() {
  const { user, activeTeamId } = useAuth();
  const [banners, setBanners] = useState<Banner[]>([]);
  const [upcomingMatches, setUpcomingMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  const [myTeam, setMyTeam] = useState<any>(null);
  const [pendingResultsCount, setPendingResultsCount] = useState(0);
  const [contestedResultsCount, setContestedResultsCount] = useState(0);
  const [pendingInvitesCount, setPendingInvitesCount] = useState(0);
  const [hasAvailability, setHasAvailability] = useState<boolean>(true);

  useEffect(() => {
    async function fetchData() {
      try {
        let teamData: any = null;
        let allMatches: any[] = [];

        if (user && activeTeamId) {
          const teamDoc = await getDoc(doc(db, 'teams', activeTeamId));
          if (teamDoc.exists()) {
            teamData = { id: teamDoc.id, ...teamDoc.data() } as any;
            setMyTeam(teamData);

            // Fetch team matches to calculate badges
            const homeMatchesQ = query(collection(db, 'matches'), where('homeTeamId', '==', teamData.id));
            const awayMatchesQ = query(collection(db, 'matches'), where('awayTeamId', '==', teamData.id));
            
            // Check if team has any availability set
            const availQ = query(collection(db, 'availabilities'), where('teamId', '==', teamData.id), limit(1));
            
            const [homeSnap, awaySnap, availSnap] = await Promise.all([
              getDocs(homeMatchesQ), 
              getDocs(awayMatchesQ),
              getDocs(availQ)
            ]);
            
            setHasAvailability(!availSnap.empty);
            
            allMatches = [...homeSnap.docs, ...awaySnap.docs].map(d => ({ id: d.id, ...d.data() }));
            
            const pendingMatches = allMatches.filter(m => m.status === 'completed' && m.resultStatus === 'pending_confirmation' && m.resultSubmittedBy !== teamData.id);
            setPendingResultsCount(pendingMatches.length);
            
            const contestedMatches = allMatches.filter(m => m.status === 'completed' && m.resultStatus === 'contested');
            setContestedResultsCount(contestedMatches.length);
            
            const pendingInvites = allMatches.filter(m => m.status === 'pending' && m.scheduledById !== user.uid);
            setPendingInvitesCount(pendingInvites.length);
          } else {
            setMyTeam(null);
            setHasAvailability(true);
            setPendingResultsCount(0);
            setContestedResultsCount(0);
            setPendingInvitesCount(0);
          }
        } else {
          setMyTeam(null);
          setHasAvailability(true);
          setPendingResultsCount(0);
          setContestedResultsCount(0);
          setPendingInvitesCount(0);
        }

        // Fetch active banners
        const bannersQuery = query(
          collection(db, 'banners'),
          where('active', '==', true),
          orderBy('order', 'asc')
        );
        const bannersSnap = await getDocs(bannersQuery);
        const fetchedBanners = bannersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Banner));
        
        setBanners(fetchedBanners.length > 0 ? fetchedBanners : DEFAULT_BANNERS);

        // Fetch upcoming matches for the team
        let combinedMatches: Match[] = [];
        
        if (teamData) {
          const now = new Date().toISOString();
          
          // We already fetched allMatches for the team above
          const teamUpcomingMatches = allMatches.filter(m => 
            m.status === 'confirmed' && 
            m.date >= now
          );
          
          // Fetch teams to get names
          const teamsSnap = await getDocs(collection(db, 'teams'));
          const teamNames = new Map();
          teamsSnap.docs.forEach(d => teamNames.set(d.id, d.data().name));

          const matchesData = teamUpcomingMatches.map(data => {
            let isoDate = data.date;
            if (!isoDate || isNaN(new Date(isoDate).getTime())) {
              isoDate = new Date().toISOString(); // Fallback to avoid crashes
            }
            return {
              id: data.id,
              ...data,
              date: isoDate,
              homeTeamName: teamNames.get(data.homeTeamId) || 'Time Desconhecido',
              awayTeamName: teamNames.get(data.awayTeamId) || 'Time Desconhecido'
            } as Match;
          });

          // Fetch festival games for the team
          const todayStr = new Date().toISOString().split('T')[0];
          const festivalQuery = query(
            collection(db, 'festivalGames'),
            where('date', '>=', todayStr),
            orderBy('date', 'asc')
          );
          const festivalSnap = await getDocs(festivalQuery);
          const festivalData = festivalSnap.docs
            .map(doc => {
              const data = doc.data();
              // Only show if the team is participating
              if (data.homeTeamId !== teamData.id && data.awayTeamId !== teamData.id) return null;
              if (data.status === 'completed') return null;
              
              // Create a full ISO string for the date
              let isoDate = data.date || new Date().toISOString();
              try {
                if (data.date) {
                  const [year, month, day] = data.date.split('-');
                  const [hours, minutes] = (data.startTime || '00:00').split(':');
                  if (year && month && day) {
                    const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hours || '0'), parseInt(minutes || '0'));
                    if (!isNaN(d.getTime())) {
                      isoDate = d.toISOString();
                    }
                  }
                }
              } catch (e) {
                console.error("Invalid date/time", e);
              }

              return {
                id: doc.id,
                homeTeamId: data.homeTeamId || 'tbd',
                awayTeamId: data.awayTeamId || 'tbd',
                homeTeamName: data.homeTeamName || 'A definir',
                awayTeamName: data.awayTeamName || 'A definir',
                date: isoDate,
                location: 'Festival',
                status: data.status || 'confirmed',
                isFestival: true
              } as Match;
            })
            .filter(Boolean) as Match[];

          // Combine and sort
          combinedMatches = [...matchesData, ...festivalData]
            .sort((a, b) => {
              const timeA = a.date && !isNaN(new Date(a.date).getTime()) ? new Date(a.date).getTime() : 0;
              const timeB = b.date && !isNaN(new Date(b.date).getTime()) ? new Date(b.date).getTime() : 0;
              return timeA - timeB;
            })
            .slice(0, 5);
        }

        setUpcomingMatches(combinedMatches);
      } catch (error) {
        console.error("Error fetching home data:", error);
        setBanners(DEFAULT_BANNERS);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [user, activeTeamId]);

  const promos = banners.filter(b => b.type === 'promo');

  useEffect(() => {
    if (promos.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentBannerIndex((prev) => (prev + 1) % promos.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [promos.length]);

  const nextBanner = () => {
    setCurrentBannerIndex((prev) => (prev + 1) % promos.length);
  };

  const prevBanner = () => {
    setCurrentBannerIndex((prev) => (prev - 1 + promos.length) % promos.length);
  };

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div></div>;
  }

  // Generate alerts
  const alerts = [];
  if (!myTeam) {
    alerts.push({
      type: 'warning',
      message: 'Você ainda não tem um time cadastrado. Crie seu time para começar a jogar!',
      link: '/team'
    });
  } else {
    if (pendingResultsCount > 0) {
      alerts.push({
        type: 'warning',
        message: `Você tem ${pendingResultsCount} resultado(s) de jogo aguardando confirmação.`,
        link: '/calendar'
      });
    }
    
    if (contestedResultsCount > 0) {
      alerts.push({
        type: 'error',
        message: `Você tem ${contestedResultsCount} resultado(s) de jogo contestado(s). Acesse para alinhar o resultado.`,
        link: '/calendar'
      });
    }
    
    if (pendingInvitesCount > 0) {
      alerts.push({
        type: 'warning',
        message: `Você tem ${pendingInvitesCount} convite(s) de jogo pendente(s) de aceitação ou recusa.`,
        link: '/calendar'
      });
    }
    
    if (!hasAvailability) {
      alerts.push({
        type: 'info',
        message: 'Insira a disponibilidade do seu time para receber convites de jogos.',
        link: '/calendar'
      });
    } else if (upcomingMatches.length === 0) {
      alerts.push({
        type: 'info',
        message: 'Seu time não tem jogos marcados. Agende seu próximo jogo!',
        link: '/calendar'
      });
    }
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Início</h1>
          <p className="text-zinc-500">Bem-vindo ao Várzea Brasil.</p>
        </div>
      </header>

      {/* Alerts Section */}
      {alerts.length > 0 && (
        <div className="flex flex-col gap-3">
          {alerts.map((alert, i) => (
            <div key={i} className={`p-4 rounded-xl flex items-center gap-3 ${
              alert.type === 'warning' ? 'bg-amber-50 text-amber-800 border border-amber-200' : 
              alert.type === 'info' ? 'bg-blue-50 text-blue-800 border border-blue-200' :
              'bg-red-50 text-red-800 border border-red-200'
            }`}>
              {alert.type === 'info' ? (
                <Info className="w-5 h-5 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
              )}
              <span className="font-medium text-sm">{alert.message}</span>
              {alert.link && (
                <Link to={alert.link} className="ml-auto text-sm font-bold underline whitespace-nowrap">
                  Resolver
                </Link>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Promo Banners Carousel */}
      {promos.length > 0 && (
        <section className="relative w-full aspect-video rounded-2xl overflow-hidden shadow-lg group">
          {promos.map((promo, index) => (
            <a 
              key={promo.id} 
              href={promo.link} 
              target="_blank" 
              rel="noopener noreferrer"
              className={`absolute inset-0 transition-opacity duration-1000 ${index === currentBannerIndex ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}
            >
              <img src={promo.imageUrl} alt="Promo" className="w-full h-full object-cover" />
            </a>
          ))}
          
          {promos.length > 1 && (
            <>
              <button 
                onClick={prevBanner}
                className="absolute left-4 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-black/30 text-white hover:bg-black/50 backdrop-blur-sm transition-colors opacity-0 group-hover:opacity-100"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button 
                onClick={nextBanner}
                className="absolute right-4 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-black/30 text-white hover:bg-black/50 backdrop-blur-sm transition-colors opacity-0 group-hover:opacity-100"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
              
              <div className="absolute bottom-4 left-1/2 -translate-y-1/2 -translate-x-1/2 z-20 flex gap-2">
                {promos.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => setCurrentBannerIndex(idx)}
                    className={`w-2 h-2 rounded-full transition-all ${idx === currentBannerIndex ? 'bg-emerald-500 w-6' : 'bg-white/50 hover:bg-white/80'}`}
                  />
                ))}
              </div>
            </>
          )}
        </section>
      )}

      <div className="grid grid-cols-1 gap-8">
        {/* Upcoming Matches */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2 text-zinc-800">
              <CalendarIcon className="w-5 h-5 text-emerald-500" />
              Próximos Jogos
            </h2>
          </div>
          
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            {upcomingMatches.length === 0 ? (
              <div className="p-8 text-center text-zinc-500">
                Nenhum jogo confirmado para os próximos dias.
              </div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {upcomingMatches.map(match => (
                  <div key={match.id} className="p-4 hover:bg-zinc-50 transition-colors flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="bg-zinc-100 p-3 rounded-xl text-center min-w-[80px]">
                        <div className="text-xs font-semibold text-zinc-500 uppercase">
                          {match.date && !isNaN(new Date(match.date).getTime()) ? format(new Date(match.date), 'MMM', { locale: ptBR }) : '---'}
                        </div>
                        <div className="text-xl font-bold text-zinc-900">
                          {match.date && !isNaN(new Date(match.date).getTime()) ? format(new Date(match.date), 'dd') : '--'}
                        </div>
                      </div>
                      <div>
                        <div className="font-semibold text-zinc-900 flex items-center gap-2">
                          {match.homeTeamName} vs {match.awayTeamName}
                          {match.isFestival && (
                            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] uppercase font-bold rounded-full">
                              Festival
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-zinc-500 flex items-center gap-1 mt-1">
                          <MapPin className="w-3 h-3" />
                          {match.location} • {match.date && !isNaN(new Date(match.date).getTime()) ? format(new Date(match.date), 'HH:mm') : '--:--'}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
