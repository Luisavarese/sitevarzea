import { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { Trophy, MapPin, Map as MapIcon, Globe, Search } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';

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
  homeTeamId: string;
  awayTeamId: string;
  status: string;
  resultStatus?: string;
  homeScore?: number;
  awayScore?: number;
  woTeamId?: string;
  isFestival?: boolean;
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
        const teamsSnap = await getDocs(collection(db, 'teams'));
        const teamsData = teamsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Team));
        setTeams(teamsData);

        const matchesSnap = await getDocs(collection(db, 'matches'));
        // Only include friendly matches (not festivals)
        const matchesData = matchesSnap.docs
          .map(d => ({ id: d.id, ...d.data() } as Match))
          .filter(m => !m.isFestival);
        
        setMatches(matchesData);

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
    });

    // Calculate stats from matches
    matches.forEach(match => {
      if (match.status !== 'completed') return;

      const homeStats = statsMap.get(match.homeTeamId);
      const awayStats = statsMap.get(match.awayTeamId);

      if (!homeStats || !awayStats) return;

      if (match.woTeamId) {
        if (match.resultStatus !== 'confirmed') return;
        
        homeStats.played += 1;
        awayStats.played += 1;

        if (match.woTeamId === match.homeTeamId) {
          homeStats.points -= 3;
          homeStats.losses += 1;
          awayStats.points += 3;
          awayStats.wins += 1;
        } else if (match.woTeamId === match.awayTeamId) {
          awayStats.points -= 3;
          awayStats.losses += 1;
          homeStats.points += 3;
          homeStats.wins += 1;
        }
      } else if (match.quadros && match.quadros.length > 0) {
        match.quadros.forEach(q => {
          if (q.status !== 'confirmed') return;

          homeStats.played += 1;
          awayStats.played += 1;

          const qHomeGoals = q.homeScore || 0;
          const qAwayGoals = q.awayScore || 0;

          homeStats.goalsFor += qHomeGoals;
          homeStats.goalsAgainst += qAwayGoals;
          awayStats.goalsFor += qAwayGoals;
          awayStats.goalsAgainst += qHomeGoals;

          if (qHomeGoals > qAwayGoals) {
            homeStats.points += 3;
            homeStats.wins += 1;
            awayStats.losses += 1;
          } else if (qAwayGoals > qHomeGoals) {
            awayStats.points += 3;
            awayStats.wins += 1;
            homeStats.losses += 1;
          } else {
            homeStats.points += 1;
            awayStats.points += 1;
            homeStats.draws += 1;
            awayStats.draws += 1;
          }
        });
        
        homeStats.goalDifference = homeStats.goalsFor - homeStats.goalsAgainst;
        awayStats.goalDifference = awayStats.goalsFor - awayStats.goalsAgainst;
      } else {
        if (match.resultStatus !== 'confirmed') return;

        const homeScore = match.homeScore || 0;
        const awayScore = match.awayScore || 0;

        homeStats.played += 1;
        awayStats.played += 1;

        homeStats.goalsFor += homeScore;
        homeStats.goalsAgainst += awayScore;
        homeStats.goalDifference = homeStats.goalsFor - homeStats.goalsAgainst;

        awayStats.goalsFor += awayScore;
        awayStats.goalsAgainst += homeScore;
        awayStats.goalDifference = awayStats.goalsFor - awayStats.goalsAgainst;

        if (homeScore > awayScore) {
          homeStats.points += 3;
          homeStats.wins += 1;
          awayStats.losses += 1;
        } else if (awayScore > homeScore) {
          awayStats.points += 3;
          awayStats.wins += 1;
          homeStats.losses += 1;
        } else {
          homeStats.points += 1;
          awayStats.points += 1;
          homeStats.draws += 1;
          awayStats.draws += 1;
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

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      stats = stats.filter(s => s.team.name.toLowerCase().includes(query));
    }

    if (selectedGameType) {
      stats = stats.filter(s => s.team.gameType === selectedGameType);
    }

    // Sort by points, then goal difference, then goals for, then goals against
    return stats.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
      if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
      return a.goalsAgainst - b.goalsAgainst;
    });
  };

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div></div>;
  }

  const ranking = getFilteredRanking();

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 flex items-center gap-3">
          <Trophy className="w-8 h-8 text-yellow-500" />
          Ranking
        </h1>
        <p className="text-zinc-500 mt-2">Acompanhe a classificação dos times no Brasil, no seu Estado e na sua Cidade.</p>
      </header>

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
                  ranking.map((stat, index) => (
                    <tr key={stat.team.id} className="hover:bg-zinc-50 transition-colors">
                      <td className="p-4 text-center font-bold text-zinc-400">
                        {index + 1}º
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
