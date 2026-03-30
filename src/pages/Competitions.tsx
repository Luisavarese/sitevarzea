import { useState, useEffect } from 'react';
import { collection, query, getDocs, orderBy, where, doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Trophy, Calendar as CalendarIcon, Users, Clock, Check, X } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';

interface Competition {
  id: string;
  name: string;
  type: 'league' | 'cup' | 'festival';
  startDate: string;
  endDate: string;
  status: 'upcoming' | 'ongoing' | 'completed';
  entryFee?: string;
  prize?: string;
}

interface FestivalGame {
  id: string;
  competitionId: string;
  startTime: string;
  endTime: string;
  homeTeamId: string | null;
  homeTeamName: string | null;
  awayTeamId: string | null;
  awayTeamName: string | null;
}

export function Competitions() {
  const { user, activeTeamId } = useAuth();
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFestival, setSelectedFestival] = useState<Competition | null>(null);
  const [festivalGames, setFestivalGames] = useState<FestivalGame[]>([]);
  const [loadingGames, setLoadingGames] = useState(false);
  const [userTeamId, setUserTeamId] = useState<string | null>(null);
  const [userTeamName, setUserTeamName] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{title: string, type: 'success' | 'error'} | null>(null);

  const showToast = (title: string, type: 'success' | 'error') => {
    setToastMessage({ title, type });
    setTimeout(() => setToastMessage(null), 3000);
  };

  useEffect(() => {
    async function fetchCompetitions() {
      try {
        const q = query(collection(db, 'competitions'), orderBy('startDate', 'desc'));
        const snap = await getDocs(q);
        setCompetitions(snap.docs.map(d => {
          const data = d.data();
          let startDate = data.startDate;
          let endDate = data.endDate;
          if (!startDate || isNaN(new Date(startDate).getTime())) startDate = new Date().toISOString();
          if (!endDate || isNaN(new Date(endDate).getTime())) endDate = new Date().toISOString();
          return { id: d.id, ...data, startDate, endDate } as Competition;
        }));

        if (user && activeTeamId) {
          const teamDoc = await getDoc(doc(db, 'teams', activeTeamId));
          if (teamDoc.exists()) {
            setUserTeamId(teamDoc.id);
            setUserTeamName(teamDoc.data().name);
          }
        }
      } catch (error) {
        console.error("Error fetching competitions:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchCompetitions();
  }, [user, activeTeamId]);

  const handleOpenFestival = async (comp: Competition) => {
    if (comp.type !== 'festival') return;
    setSelectedFestival(comp);
    setLoadingGames(true);
    try {
      const q = query(collection(db, 'festivalGames'), where('competitionId', '==', comp.id));
      const snap = await getDocs(q);
      const games = snap.docs.map(d => ({ id: d.id, ...d.data() } as FestivalGame));
      // Sort games by start time
      games.sort((a, b) => a.startTime.localeCompare(b.startTime));
      setFestivalGames(games);
    } catch (error) {
      console.error("Error fetching festival games:", error);
      showToast("Erro ao carregar jogos do festival.", "error");
    } finally {
      setLoadingGames(false);
    }
  };

  const handleJoinGame = async (game: FestivalGame, side: 'home' | 'away') => {
    if (!userTeamId || !userTeamName) {
      showToast("Você precisa ter um time cadastrado para se inscrever.", "error");
      return;
    }

    // Check if team is already in this game
    if (game.homeTeamId === userTeamId || game.awayTeamId === userTeamId) {
      showToast("Seu time já está inscrito neste jogo.", "error");
      return;
    }

    try {
      const gameRef = doc(db, 'festivalGames', game.id);
      const updateData = side === 'home' 
        ? { homeTeamId: userTeamId, homeTeamName: userTeamName }
        : { awayTeamId: userTeamId, awayTeamName: userTeamName };
        
      await updateDoc(gameRef, updateData);
      
      // Update local state
      setFestivalGames(games => games.map(g => {
        if (g.id === game.id) {
          return { ...g, ...updateData };
        }
        return g;
      }));
      
      showToast("Inscrição realizada com sucesso!", "success");
    } catch (error) {
      console.error("Error joining game:", error);
      showToast("Erro ao realizar inscrição.", "error");
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div></div>;
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Competições</h1>
        <p className="text-zinc-500">Acompanhe as ligas, copas e festivais da região.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {competitions.length === 0 ? (
          <div className="col-span-full p-12 bg-zinc-50 border-2 border-dashed border-zinc-200 rounded-2xl text-center">
            <Trophy className="w-12 h-12 text-zinc-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-zinc-900 mb-2">Nenhuma competição ativa</h3>
            <p className="text-zinc-500">As competições criadas pelos administradores aparecerão aqui.</p>
          </div>
        ) : (
          competitions.map(comp => (
            <div 
              key={comp.id} 
              onClick={() => handleOpenFestival(comp)}
              className={cn(
                "bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden transition-shadow group",
                comp.type === 'festival' ? "cursor-pointer hover:shadow-md hover:border-emerald-200" : ""
              )}
            >
              <div className="h-32 bg-zinc-900 flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-emerald-500 to-transparent"></div>
                <Trophy className={cn("w-12 h-12 text-zinc-100 group-hover:scale-110 transition-transform", comp.type === 'league' ? 'text-blue-400' : comp.type === 'cup' ? 'text-amber-400' : 'text-emerald-400')} />
              </div>
              
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <span className={cn(
                    "text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-md",
                    comp.type === 'league' ? "bg-blue-50 text-blue-700" : 
                    comp.type === 'cup' ? "bg-amber-50 text-amber-700" : 
                    "bg-emerald-50 text-emerald-700"
                  )}>
                    {comp.type === 'league' ? 'Liga' : comp.type === 'cup' ? 'Copa' : 'Festival'}
                  </span>
                  <span className={cn(
                    "text-xs font-medium flex items-center gap-1",
                    comp.status === 'ongoing' ? "text-emerald-600" : 
                    comp.status === 'upcoming' ? "text-amber-600" : 
                    "text-zinc-500"
                  )}>
                    <span className={cn("w-2 h-2 rounded-full", comp.status === 'ongoing' ? "bg-emerald-500" : comp.status === 'upcoming' ? "bg-amber-500" : "bg-zinc-400")}></span>
                    {comp.status === 'ongoing' ? 'Em andamento' : comp.status === 'upcoming' ? 'Em breve' : 'Finalizado'}
                  </span>
                </div>
                
                <h3 className="text-xl font-bold text-zinc-900 mb-2">
                  {comp.name}
                  {comp.type === 'festival' && comp.entryFee && (
                    <span className="ml-2 text-sm font-normal text-zinc-500">
                      ({comp.entryFee})
                    </span>
                  )}
                </h3>
                
                <div className="space-y-2 mt-4 text-sm text-zinc-600">
                  <div className="flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4 text-zinc-400" />
                    {format(new Date(comp.startDate), 'dd/MM/yyyy')} - {format(new Date(comp.endDate), 'dd/MM/yyyy')}
                  </div>
                  {comp.type === 'festival' && comp.prize && (
                    <div className="flex items-center gap-2">
                      <Trophy className="w-4 h-4 text-amber-500" />
                      <span className="text-amber-700 font-medium">Prêmio: {comp.prize}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-zinc-400" />
                    {comp.type === 'festival' ? 'Ver horários e inscrever time' : 'Ver classificação e jogos'}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Festival Modal */}
      {selectedFestival && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-xl overflow-hidden">
            <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50">
              <div>
                <h2 className="text-2xl font-bold text-zinc-900">
                  {selectedFestival.name}
                  {selectedFestival.entryFee && (
                    <span className="ml-2 text-lg font-normal text-zinc-500">
                      ({selectedFestival.entryFee})
                    </span>
                  )}
                </h2>
                <div className="flex flex-col gap-1 mt-2">
                  <p className="text-sm text-zinc-500 flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4" />
                    {format(new Date(selectedFestival.startDate), 'dd/MM/yyyy')} - {format(new Date(selectedFestival.endDate), 'dd/MM/yyyy')}
                  </p>
                  {selectedFestival.prize && (
                    <p className="text-sm font-medium text-amber-600 flex items-center gap-2">
                      <Trophy className="w-4 h-4" />
                      Prêmio: {selectedFestival.prize}
                    </p>
                  )}
                </div>
              </div>
              <button 
                onClick={() => setSelectedFestival(null)}
                className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200 rounded-full transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              {loadingGames ? (
                <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div></div>
              ) : festivalGames.length === 0 ? (
                <div className="text-center py-12 text-zinc-500">
                  Nenhum jogo cadastrado para este festival ainda.
                </div>
              ) : (
                <div className="space-y-4">
                  <h3 className="font-semibold text-zinc-900 mb-4">Horários Disponíveis</h3>
                  {festivalGames.map((game, index) => (
                    <div key={game.id} className="bg-white border border-zinc-200 rounded-xl p-4 shadow-sm">
                      <div className="flex items-center gap-2 text-sm font-medium text-emerald-600 mb-3 bg-emerald-50 w-fit px-3 py-1 rounded-full">
                        <Clock className="w-4 h-4" />
                        {game.startTime} - {game.endTime}
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Home Team Slot */}
                        <div className="border border-zinc-200 rounded-lg p-4 flex flex-col items-center justify-center min-h-[100px] text-center bg-zinc-50 relative">
                          <span className="absolute top-2 left-2 text-[10px] font-bold uppercase text-zinc-400">Mandante</span>
                          {game.homeTeamId ? (
                            <div className="font-bold text-zinc-900">{game.homeTeamName}</div>
                          ) : (
                            <div className="space-y-2">
                              <div className="text-sm text-zinc-500">Vaga Disponível</div>
                              {userTeamId && selectedFestival.status !== 'completed' && (
                                <button 
                                  onClick={() => handleJoinGame(game, 'home')}
                                  className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium rounded-lg transition-colors"
                                >
                                  Inscrever meu time
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        
                        {/* Away Team Slot */}
                        <div className="border border-zinc-200 rounded-lg p-4 flex flex-col items-center justify-center min-h-[100px] text-center bg-zinc-50 relative">
                          <span className="absolute top-2 left-2 text-[10px] font-bold uppercase text-zinc-400">Visitante</span>
                          {game.awayTeamId ? (
                            <div className="font-bold text-zinc-900">{game.awayTeamName}</div>
                          ) : (
                            <div className="space-y-2">
                              <div className="text-sm text-zinc-500">Vaga Disponível</div>
                              {userTeamId && selectedFestival.status !== 'completed' && (
                                <button 
                                  onClick={() => handleJoinGame(game, 'away')}
                                  className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium rounded-lg transition-colors"
                                >
                                  Inscrever meu time
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMessage && (
        <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-5">
          <div className={cn(
            "px-4 py-3 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2",
            toastMessage.type === 'success' ? "bg-emerald-500 text-white" : "bg-red-500 text-white"
          )}>
            {toastMessage.type === 'success' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
            {toastMessage.title}
          </div>
        </div>
      )}
    </div>
  );
}
