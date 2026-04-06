import { useState, useEffect } from 'react';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Trophy, MapPin, Map as MapIcon, Globe, Search, Calendar, Gift, Info } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { startOfWeek, format } from 'date-fns';

interface Team {
  id: string;
  name: string;
  state: string;
  city: string;
  zone?: string;
  logoUrl?: string;
  gameType?: string;
}

interface Match {
  id: string;
  date: string;
  homeTeamId: string;
  awayTeamId: string;
  status: string;
  resultStatus?: string;
  homeScore?: number;
  awayScore?: number;
  woTeamId?: string;
  isFestival?: boolean;
  quadros?: {
    id: string;
    name: string;
    homeScore?: number;
    awayScore?: number;
    status: string;
  }[];
}

interface RankingConfig {
  startDate: string;
  endDate: string;
  prizes: {
    nacional: string;
    estadual: string;
    municipal: string;
    zonaLeste: string;
    zonaOeste: string;
    zonaNorte: string;
    zonaSul: string;
    zonaCentro: string;
  };
}

interface TeamStats {
  team: Team;
  points: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
}

interface IBGEState {
  id: number;
  sigla: string;
  nome: string;
}

interface IBGECity {
  id: number;
  nome: string;
}

export default function Ranking() {
  const { activeTeamId, myTeams } = useAuth();
  const [activeTab, setActiveTab] = useState<'brasil' | 'estadual' | 'municipal'>('brasil');
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [rankingConfig, setRankingConfig] = useState<RankingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedState, setSelectedState] = useState<string>('');
  const [selectedCity, setSelectedCity] = useState<string>('');
  const [selectedZone, setSelectedZone] = useState<string>('');
  const [selectedGameType, setSelectedGameType] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  
  const [ibgeStates, setIbgeStates] = useState<IBGEState[]>([]);
  const [ibgeCities, setIbgeCities] = useState<IBGECity[]>([]);

  useEffect(() => {
    fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome')
      .then(res => res.json())
      .then(data => setIbgeStates(data))
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (selectedState) {
      fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${selectedState}/municipios?orderBy=nome`)
        .then(res => res.json())
        .then(data => setIbgeCities(data))
        .catch(console.error);
    } else {
      setIbgeCities([]);
    }
  }, [selectedState]);

  useEffect(() => {
    async function fetchData() {
      try {
        const [teamsSnap, matchesSnap, rankingSnap] = await Promise.all([
          getDocs(collection(db, 'teams')),
          getDocs(collection(db, 'matches')),
          getDoc(doc(db, 'settings', 'ranking'))
        ]);
        
        const teamsData = teamsSnap.docs
          .map(d => ({ id: d.id, ...d.data() } as Team & { deleted?: boolean }))
          .filter(t => !t.deleted);
        setTeams(teamsData);

        // Only include friendly matches (not festivals)
        const matchesData = matchesSnap.docs
          .map(d => ({ id: d.id, ...d.data() } as Match))
          .filter(m => !m.isFestival);
        
        setMatches(matchesData);

        if (rankingSnap.exists()) {
          const data = rankingSnap.data();
          setRankingConfig({
            startDate: data.startDate || '',
            endDate: data.endDate || '',
            prizes: {
              nacional: data.prizes?.nacional || '',
              estadual: data.prizes?.estadual || '',
              municipal: data.prizes?.municipal || '',
              zonaLeste: data.prizes?.zonaLeste || '',
              zonaOeste: data.prizes?.zonaOeste || '',
              zonaNorte: data.prizes?.zonaNorte || '',
              zonaSul: data.prizes?.zonaSul || '',
              zonaCentro: data.prizes?.zonaCentro || ''
            }
          });
        }

        if (activeTeamId) {
          const activeTeam = teamsData.find(t => t.id === activeTeamId);
          if (activeTeam) {
            if (activeTeam.gameType) setSelectedGameType(activeTeam.gameType);
            if (activeTeam.state) setSelectedState(activeTeam.state);
            if (activeTeam.city) setSelectedCity(activeTeam.city);
            if (activeTeam.zone) setSelectedZone(activeTeam.zone);
            
            if (activeTeam.city) {
              setActiveTab('municipal');
            } else if (activeTeam.state) {
              setActiveTab('estadual');
            }
          }
        }
      } catch (error) {
        console.error("Error fetching ranking data:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [activeTeamId]);

  const calculateStats = (): TeamStats[] => {
    const statsMap = new Map<string, TeamStats>();
    const teamWeeksPlayed = new Map<string, Set<string>>();

    // Initialize stats for all teams
    teams.forEach(team => {
      statsMap.set(team.id, {
        team,
        points: 0,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0
      });
      teamWeeksPlayed.set(team.id, new Set());
    });

    // Sort matches by date ascending
    const sortedMatches = [...matches].sort((a, b) => {
      const timeA = a.date && !isNaN(new Date(a.date + 'T12:00:00Z').getTime()) ? new Date(a.date + 'T12:00:00Z').getTime() : 0;
      const timeB = b.date && !isNaN(new Date(b.date + 'T12:00:00Z').getTime()) ? new Date(b.date + 'T12:00:00Z').getTime() : 0;
      return timeA - timeB;
    });

    // Calculate stats from matches
    sortedMatches.forEach(match => {
      if (match.status !== 'completed' || match.isFestival) return;

      if (!match.date) return; // Skip matches without date

      // Filter by ranking competition dates if configured
      if (rankingConfig?.startDate && match.date < rankingConfig.startDate) return;
      if (rankingConfig?.endDate && match.date > rankingConfig.endDate) return;

      const homeStats = statsMap.get(match.homeTeamId);
      const awayStats = statsMap.get(match.awayTeamId);

      if (!homeStats || !awayStats) return;

      const weekStart = startOfWeek(new Date(match.date + 'T12:00:00Z'), { weekStartsOn: 1 });
      const weekKey = format(weekStart, 'yyyy-MM-dd');
      
      const homePlayedThisWeek = teamWeeksPlayed.get(match.homeTeamId)!.has(weekKey);
      const awayPlayedThisWeek = teamWeeksPlayed.get(match.awayTeamId)!.has(weekKey);

      if (homePlayedThisWeek && awayPlayedThisWeek) return;

      if (!homePlayedThisWeek) teamWeeksPlayed.get(match.homeTeamId)!.add(weekKey);
      if (!awayPlayedThisWeek) teamWeeksPlayed.get(match.awayTeamId)!.add(weekKey);

      if (match.woTeamId) {
        if (match.resultStatus !== 'confirmed') return;
        
        if (!homePlayedThisWeek) homeStats.played += 1;
        if (!awayPlayedThisWeek) awayStats.played += 1;

        if (match.woTeamId === match.homeTeamId) {
          if (!homePlayedThisWeek) {
            homeStats.points -= 3;
            homeStats.losses += 1;
          }
          if (!awayPlayedThisWeek) {
            awayStats.points += 3;
            awayStats.wins += 1;
          }
        } else if (match.woTeamId === match.awayTeamId) {
          if (!awayPlayedThisWeek) {
            awayStats.points -= 3;
            awayStats.losses += 1;
          }
          if (!homePlayedThisWeek) {
            homeStats.points += 3;
            homeStats.wins += 1;
          }
        }
      } else if (match.quadros && match.quadros.length > 0) {
        match.quadros.forEach(q => {
          if (q.status !== 'confirmed') return;

          if (!homePlayedThisWeek) homeStats.played += 1;
          if (!awayPlayedThisWeek) awayStats.played += 1;

          const qHomeGoals = q.homeScore || 0;
          const qAwayGoals = q.awayScore || 0;

          if (!homePlayedThisWeek) {
            homeStats.goalsFor += qHomeGoals;
            homeStats.goalsAgainst += qAwayGoals;
          }
          if (!awayPlayedThisWeek) {
            awayStats.goalsFor += qAwayGoals;
            awayStats.goalsAgainst += qHomeGoals;
          }

          if (qHomeGoals > qAwayGoals) {
            if (!homePlayedThisWeek) {
              homeStats.points += 3;
              homeStats.wins += 1;
            }
            if (!awayPlayedThisWeek) {
              awayStats.losses += 1;
            }
          } else if (qAwayGoals > qHomeGoals) {
            if (!awayPlayedThisWeek) {
              awayStats.points += 3;
              awayStats.wins += 1;
            }
            if (!homePlayedThisWeek) {
              homeStats.losses += 1;
            }
          } else {
            if (!homePlayedThisWeek) {
              homeStats.points += 1;
              homeStats.draws += 1;
            }
            if (!awayPlayedThisWeek) {
              awayStats.points += 1;
              awayStats.draws += 1;
            }
          }
        });
        
        if (!homePlayedThisWeek) homeStats.goalDifference = homeStats.goalsFor - homeStats.goalsAgainst;
        if (!awayPlayedThisWeek) awayStats.goalDifference = awayStats.goalsFor - awayStats.goalsAgainst;
      } else {
        if (match.resultStatus !== 'confirmed') return;

        const homeScore = match.homeScore || 0;
        const awayScore = match.awayScore || 0;

        if (!homePlayedThisWeek) {
          homeStats.played += 1;
          homeStats.goalsFor += homeScore;
          homeStats.goalsAgainst += awayScore;
          homeStats.goalDifference = homeStats.goalsFor - homeStats.goalsAgainst;
        }

        if (!awayPlayedThisWeek) {
          awayStats.played += 1;
          awayStats.goalsFor += awayScore;
          awayStats.goalsAgainst += homeScore;
          awayStats.goalDifference = awayStats.goalsFor - awayStats.goalsAgainst;
        }

        if (homeScore > awayScore) {
          if (!homePlayedThisWeek) {
            homeStats.points += 3;
            homeStats.wins += 1;
          }
          if (!awayPlayedThisWeek) {
            awayStats.losses += 1;
          }
        } else if (awayScore > homeScore) {
          if (!awayPlayedThisWeek) {
            awayStats.points += 3;
            awayStats.wins += 1;
          }
          if (!homePlayedThisWeek) {
            homeStats.losses += 1;
          }
        } else {
          if (!homePlayedThisWeek) {
            homeStats.points += 1;
            homeStats.draws += 1;
          }
          if (!awayPlayedThisWeek) {
            awayStats.points += 1;
            awayStats.draws += 1;
          }
        }
      }
    });

    return Array.from(statsMap.values());
  };

  const getFilteredRanking = () => {
    let stats = calculateStats();

    if (activeTab === 'estadual' && selectedState) {
      stats = stats.filter(s => s.team.state === selectedState);
    } else if (activeTab === 'municipal') {
      if (selectedState) {
        stats = stats.filter(s => s.team.state === selectedState);
      }
      if (selectedCity) {
        stats = stats.filter(s => s.team.city === selectedCity);
      }
      if (selectedState === 'SP' && selectedCity === 'São Paulo' && selectedZone) {
        stats = stats.filter(s => s.team.zone === selectedZone);
      }
    }

    if (selectedGameType) {
      stats = stats.filter(s => s.team.gameType === selectedGameType);
    }

    // Sort by points, then goal difference, then goals for, then goals against
    stats.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
      if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
      return a.goalsAgainst - b.goalsAgainst;
    });

    // Assign original positions
    const statsWithPosition = stats.map((stat, index) => ({
      ...stat,
      originalPosition: index + 1
    }));

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      return statsWithPosition.filter(s => s.team.name.toLowerCase().includes(query));
    }

    return statsWithPosition;
  };

  const getCurrentLeaders = () => {
    let stats = calculateStats();
    
    if (selectedGameType) {
      stats = stats.filter(s => s.team.gameType === selectedGameType);
    }

    stats.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
      if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
      return a.goalsAgainst - b.goalsAgainst;
    });

    return {
      nacional: stats[0] || null,
      estadual: selectedState ? stats.find(s => s.team.state === selectedState) : null,
      municipal: selectedCity ? stats.find(s => s.team.city === selectedCity) : null,
      zonaLeste: stats.find(s => s.team.zone === 'Leste' && s.team.city === 'São Paulo' && s.team.state === 'SP'),
      zonaOeste: stats.find(s => s.team.zone === 'Oeste' && s.team.city === 'São Paulo' && s.team.state === 'SP'),
      zonaNorte: stats.find(s => s.team.zone === 'Norte' && s.team.city === 'São Paulo' && s.team.state === 'SP'),
      zonaSul: stats.find(s => s.team.zone === 'Sul' && s.team.city === 'São Paulo' && s.team.state === 'SP'),
      zonaCentro: stats.find(s => s.team.zone === 'Centro' && s.team.city === 'São Paulo' && s.team.state === 'SP'),
    };
  };

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div></div>;
  }

  const ranking = getFilteredRanking();
  const leaders = getCurrentLeaders();

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 flex items-center gap-3">
          <Trophy className="w-8 h-8 text-yellow-500" />
          Ranking
        </h1>
        <p className="text-zinc-500 mt-2">Acompanhe a classificação dos times no Brasil, no seu Estado e na sua Cidade.</p>
        <div className="mt-4 bg-blue-50 text-blue-700 p-3 rounded-lg text-sm flex items-start gap-2 border border-blue-100">
          <Info className="w-5 h-5 flex-shrink-0 mt-0.5 text-blue-500" />
          <p>
            <strong>Atenção:</strong> Para garantir uma competição justa, <strong>apenas 1 jogo por semana (de Segunda a Domingo)</strong> é contabilizado para a pontuação do Ranking. Se o seu time jogar mais de uma vez na mesma semana, apenas o primeiro jogo concluído e confirmado irá gerar pontos.
          </p>
        </div>
      </header>

      {rankingConfig && (rankingConfig.startDate || rankingConfig.endDate || Object.values(rankingConfig.prizes).some(p => p)) && (
        <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-2xl p-6 text-white shadow-md">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-2">
                <h2 className="text-2xl font-bold flex items-center gap-2">
                  <Trophy className="w-6 h-6 text-yellow-300" />
                  Competição Atual
                </h2>
                {(rankingConfig.startDate || rankingConfig.endDate) && (
                  <div className="flex items-center gap-2 text-emerald-100">
                    <Calendar className="w-4 h-4" />
                    <span>
                      {rankingConfig.startDate ? new Date(rankingConfig.startDate + 'T12:00:00Z').toLocaleDateString('pt-BR') : '...'} 
                      {' '}até{' '} 
                      {rankingConfig.endDate ? new Date(rankingConfig.endDate + 'T12:00:00Z').toLocaleDateString('pt-BR') : '...'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {rankingConfig.prizes.nacional && (
                <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm border border-white/20 flex flex-col justify-between">
                  <div>
                    <div className="text-emerald-100 text-xs font-medium mb-1 flex items-center gap-1">
                      <Globe className="w-3 h-3" /> Nacional
                    </div>
                    <div className="font-semibold text-sm mb-3">{rankingConfig.prizes.nacional}</div>
                  </div>
                  <div className="pt-3 border-t border-white/10">
                    <div className="text-[10px] uppercase tracking-wider text-emerald-200 mb-1">Líder Atual</div>
                    <div className="font-medium text-sm truncate">{leaders.nacional ? leaders.nacional.team.name : '-'}</div>
                  </div>
                </div>
              )}
              {rankingConfig.prizes.estadual && (
                <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm border border-white/20 flex flex-col justify-between">
                  <div>
                    <div className="text-emerald-100 text-xs font-medium mb-1 flex items-center gap-1">
                      <MapIcon className="w-3 h-3" /> Estadual {selectedState ? `(${selectedState})` : ''}
                    </div>
                    <div className="font-semibold text-sm mb-3">{rankingConfig.prizes.estadual}</div>
                  </div>
                  <div className="pt-3 border-t border-white/10">
                    <div className="text-[10px] uppercase tracking-wider text-emerald-200 mb-1">Líder Atual</div>
                    <div className="font-medium text-sm truncate">{leaders.estadual ? leaders.estadual.team.name : (selectedState ? '-' : 'Selecione um estado')}</div>
                  </div>
                </div>
              )}
              {rankingConfig.prizes.municipal && (
                <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm border border-white/20 flex flex-col justify-between">
                  <div>
                    <div className="text-emerald-100 text-xs font-medium mb-1 flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> Municipal {selectedCity ? `(${selectedCity})` : ''}
                    </div>
                    <div className="font-semibold text-sm mb-3">{rankingConfig.prizes.municipal}</div>
                  </div>
                  <div className="pt-3 border-t border-white/10">
                    <div className="text-[10px] uppercase tracking-wider text-emerald-200 mb-1">Líder Atual</div>
                    <div className="font-medium text-sm truncate">{leaders.municipal ? leaders.municipal.team.name : (selectedCity ? '-' : 'Selecione uma cidade')}</div>
                  </div>
                </div>
              )}
              {rankingConfig.prizes.zonaLeste && (
                <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm border border-white/20 flex flex-col justify-between">
                  <div>
                    <div className="text-emerald-100 text-xs font-medium mb-1 flex items-center gap-1">
                      <Gift className="w-3 h-3" /> Zona Leste (SP)
                    </div>
                    <div className="font-semibold text-sm mb-3">{rankingConfig.prizes.zonaLeste}</div>
                  </div>
                  <div className="pt-3 border-t border-white/10">
                    <div className="text-[10px] uppercase tracking-wider text-emerald-200 mb-1">Líder Atual</div>
                    <div className="font-medium text-sm truncate">{leaders.zonaLeste ? leaders.zonaLeste.team.name : '-'}</div>
                  </div>
                </div>
              )}
              {rankingConfig.prizes.zonaOeste && (
                <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm border border-white/20 flex flex-col justify-between">
                  <div>
                    <div className="text-emerald-100 text-xs font-medium mb-1 flex items-center gap-1">
                      <Gift className="w-3 h-3" /> Zona Oeste (SP)
                    </div>
                    <div className="font-semibold text-sm mb-3">{rankingConfig.prizes.zonaOeste}</div>
                  </div>
                  <div className="pt-3 border-t border-white/10">
                    <div className="text-[10px] uppercase tracking-wider text-emerald-200 mb-1">Líder Atual</div>
                    <div className="font-medium text-sm truncate">{leaders.zonaOeste ? leaders.zonaOeste.team.name : '-'}</div>
                  </div>
                </div>
              )}
              {rankingConfig.prizes.zonaNorte && (
                <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm border border-white/20 flex flex-col justify-between">
                  <div>
                    <div className="text-emerald-100 text-xs font-medium mb-1 flex items-center gap-1">
                      <Gift className="w-3 h-3" /> Zona Norte (SP)
                    </div>
                    <div className="font-semibold text-sm mb-3">{rankingConfig.prizes.zonaNorte}</div>
                  </div>
                  <div className="pt-3 border-t border-white/10">
                    <div className="text-[10px] uppercase tracking-wider text-emerald-200 mb-1">Líder Atual</div>
                    <div className="font-medium text-sm truncate">{leaders.zonaNorte ? leaders.zonaNorte.team.name : '-'}</div>
                  </div>
                </div>
              )}
              {rankingConfig.prizes.zonaSul && (
                <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm border border-white/20 flex flex-col justify-between">
                  <div>
                    <div className="text-emerald-100 text-xs font-medium mb-1 flex items-center gap-1">
                      <Gift className="w-3 h-3" /> Zona Sul (SP)
                    </div>
                    <div className="font-semibold text-sm mb-3">{rankingConfig.prizes.zonaSul}</div>
                  </div>
                  <div className="pt-3 border-t border-white/10">
                    <div className="text-[10px] uppercase tracking-wider text-emerald-200 mb-1">Líder Atual</div>
                    <div className="font-medium text-sm truncate">{leaders.zonaSul ? leaders.zonaSul.team.name : '-'}</div>
                  </div>
                </div>
              )}
              {rankingConfig.prizes.zonaCentro && (
                <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm border border-white/20 flex flex-col justify-between">
                  <div>
                    <div className="text-emerald-100 text-xs font-medium mb-1 flex items-center gap-1">
                      <Gift className="w-3 h-3" /> Centro (SP)
                    </div>
                    <div className="font-semibold text-sm mb-3">{rankingConfig.prizes.zonaCentro}</div>
                  </div>
                  <div className="pt-3 border-t border-white/10">
                    <div className="text-[10px] uppercase tracking-wider text-emerald-200 mb-1">Líder Atual</div>
                    <div className="font-medium text-sm truncate">{leaders.zonaCentro ? leaders.zonaCentro.team.name : '-'}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="flex border-b border-zinc-200">
          <button
            onClick={() => setActiveTab('brasil')}
            className={cn(
              "flex-1 py-4 text-sm font-medium flex items-center justify-center gap-2 transition-colors",
              activeTab === 'brasil' ? "border-b-2 border-emerald-500 text-emerald-600 bg-emerald-50/50" : "text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50"
            )}
          >
            <Globe className="w-4 h-4" /> Brasil
          </button>
          <button
            onClick={() => setActiveTab('estadual')}
            className={cn(
              "flex-1 py-4 text-sm font-medium flex items-center justify-center gap-2 transition-colors",
              activeTab === 'estadual' ? "border-b-2 border-emerald-500 text-emerald-600 bg-emerald-50/50" : "text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50"
            )}
          >
            <MapIcon className="w-4 h-4" /> Estadual
          </button>
          <button
            onClick={() => setActiveTab('municipal')}
            className={cn(
              "flex-1 py-4 text-sm font-medium flex items-center justify-center gap-2 transition-colors",
              activeTab === 'municipal' ? "border-b-2 border-emerald-500 text-emerald-600 bg-emerald-50/50" : "text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50"
            )}
          >
            <MapPin className="w-4 h-4" /> Municipal
          </button>
        </div>

        <div className="p-4 bg-zinc-50 border-b border-zinc-200 flex flex-col sm:flex-row gap-4 flex-wrap">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Buscar time..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>
          <div className="sm:w-48">
            <select
              value={selectedGameType}
              onChange={e => setSelectedGameType(e.target.value)}
              className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              <option value="">Todos os Tipos</option>
              <option value="Campo">Campo</option>
              <option value="FUT7">FUT7</option>
              <option value="Futsal">Futsal</option>
            </select>
          </div>
          {activeTab === 'estadual' && (
            <div className="sm:w-64">
              <select
                value={selectedState}
                onChange={e => setSelectedState(e.target.value)}
                className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                <option value="">Todos os Estados</option>
                {ibgeStates.map(state => (
                  <option key={state.sigla} value={state.sigla}>{state.nome}</option>
                ))}
              </select>
            </div>
          )}
          {activeTab === 'municipal' && (
            <div className="flex flex-col sm:flex-row gap-4 sm:w-auto flex-1">
              <div className="sm:w-64">
                <select
                  value={selectedState}
                  onChange={e => {
                    setSelectedState(e.target.value);
                    setSelectedCity('');
                    setSelectedZone('');
                  }}
                  className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  <option value="">Selecione o Estado</option>
                  {ibgeStates.map(state => (
                    <option key={state.sigla} value={state.sigla}>{state.nome}</option>
                  ))}
                </select>
              </div>
              <div className="sm:w-64">
                <select
                  value={selectedCity}
                  onChange={e => {
                    setSelectedCity(e.target.value);
                    setSelectedZone('');
                  }}
                  disabled={!selectedState}
                  className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none disabled:bg-zinc-100 disabled:text-zinc-400"
                >
                  <option value="">Todas as Cidades</option>
                  {ibgeCities.map(city => (
                    <option key={city.nome} value={city.nome}>{city.nome}</option>
                  ))}
                </select>
              </div>
              {selectedState === 'SP' && selectedCity === 'São Paulo' && (
                <div className="sm:w-64">
                  <select
                    value={selectedZone}
                    onChange={e => setSelectedZone(e.target.value)}
                    className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    <option value="">Todas as Zonas</option>
                    <option value="Leste">Leste</option>
                    <option value="Oeste">Oeste</option>
                    <option value="Norte">Norte</option>
                    <option value="Sul">Sul</option>
                    <option value="Centro">Centro</option>
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          {!selectedGameType ? (
            <div className="p-12 text-center flex flex-col items-center justify-center bg-white">
              <Trophy className="w-12 h-12 text-zinc-300 mb-4" />
              <h3 className="text-lg font-medium text-zinc-900 mb-2">Selecione o Tipo de Jogo</h3>
              <p className="text-zinc-500 max-w-md">
                Para visualizar o ranking, por favor selecione primeiro qual tipo de jogo você deseja ver (Campo, FUT7 ou Futsal) no filtro acima.
              </p>
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 text-zinc-500 border-b border-zinc-200">
                <tr>
                  <th className="p-4 font-medium w-16 text-center">Pos</th>
                  <th className="p-4 font-medium">Time</th>
                  <th className="p-4 font-medium text-center">Pts</th>
                  <th className="p-4 font-medium text-center hidden sm:table-cell">J</th>
                  <th className="p-4 font-medium text-center hidden sm:table-cell">V</th>
                  <th className="p-4 font-medium text-center hidden sm:table-cell">E</th>
                  <th className="p-4 font-medium text-center hidden sm:table-cell">D</th>
                  <th className="p-4 font-medium text-center hidden md:table-cell">GP</th>
                  <th className="p-4 font-medium text-center hidden md:table-cell">GC</th>
                  <th className="p-4 font-medium text-center hidden sm:table-cell">SG</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {ranking.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-zinc-500">
                      Nenhum time encontrado para este ranking.
                    </td>
                  </tr>
                ) : (
                  ranking.map((stat) => (
                    <tr key={stat.team.id} className="hover:bg-zinc-50 transition-colors">
                      <td className="p-4 text-center font-bold text-zinc-400">
                        {stat.originalPosition}º
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          {stat.team.logoUrl ? (
                            <img src={stat.team.logoUrl} alt={stat.team.name} className="w-8 h-8 rounded-full object-cover border border-zinc-200" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center border border-zinc-200">
                              <span className="text-xs font-bold text-zinc-400">{stat.team.name.substring(0, 2).toUpperCase()}</span>
                            </div>
                          )}
                          <div>
                            <div className="font-semibold text-zinc-900">{stat.team.name}</div>
                            <div className="text-xs text-zinc-500">
                              {stat.team.city} - {stat.team.state} {stat.team.zone ? `(Zona ${stat.team.zone})` : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-center font-bold text-emerald-600">{stat.points}</td>
                      <td className="p-4 text-center hidden sm:table-cell text-zinc-600">{stat.played}</td>
                      <td className="p-4 text-center hidden sm:table-cell text-zinc-600">{stat.wins}</td>
                      <td className="p-4 text-center hidden sm:table-cell text-zinc-600">{stat.draws}</td>
                      <td className="p-4 text-center hidden sm:table-cell text-zinc-600">{stat.losses}</td>
                      <td className="p-4 text-center hidden md:table-cell text-zinc-600">{stat.goalsFor}</td>
                      <td className="p-4 text-center hidden md:table-cell text-zinc-600">{stat.goalsAgainst}</td>
                      <td className="p-4 text-center hidden sm:table-cell font-medium text-zinc-700">{stat.goalDifference}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
