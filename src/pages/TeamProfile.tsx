import { useState, useEffect, ChangeEvent, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { collection, doc, getDoc, getDocs, query, setDoc, where, addDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Users, Plus, Edit2, Shield, AlertCircle, Trash2, Upload, Check, X, DollarSign, ChevronLeft, ChevronRight, Award, CalendarIcon, MapPin, MessageCircle } from 'lucide-react';
import { format, addMonths, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '../lib/utils';
import { BADGES, calculateBadges } from '../lib/badges';

interface IBGEState {
  id: number;
  sigla: string;
  nome: string;
}

interface IBGECity {
  id: number;
  nome: string;
}

interface Team {
  id: string;
  name: string;
  logoUrl: string;
  bannerUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  managerId: string;
  managerName: string;
  whatsapp: string;
  state: string;
  city: string;
  zone?: string;
  neighborhood: string;
  uniformColor: string;
  gameType: string;
  teamLevel: string;
  stats: {
    wins: number;
    draws: number;
    losses: number;
    goalsFor: number;
    goalsAgainst: number;
    points: number;
  };
  createdAt: string;
}

interface Player {
  id: string;
  teamId: string;
  name: string;
  position: string;
  number: number;
  stats: {
    goals: number;
    yellowCards: number;
    redCards: number;
  };
  monthlyFees?: Record<string, boolean>;
  createdAt: string;
}

export function TeamProfile() {
  const navigate = useNavigate();
  const { user, profile, activeTeamId, setActiveTeamId } = useAuth();
  const [team, setTeam] = useState<Team | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditingTeam, setIsEditingTeam] = useState(false);
  const [isAddingPlayer, setIsAddingPlayer] = useState(false);
  const [activeTab, setActiveTab] = useState<'elenco' | 'financeiro'>('elenco');
  const [financialMonth, setFinancialMonth] = useState<Date>(new Date());
  const [myBadges, setMyBadges] = useState<string[]>([]);
  const [upcomingMatches, setUpcomingMatches] = useState<any[]>([]);

  // Form states
  const [teamForm, setTeamForm] = useState({ name: '', managerName: '', whatsapp: '', state: '', city: '', zone: '', neighborhood: '', logoUrl: '', bannerUrl: '', primaryColor: '#10b981', secondaryColor: '#ffffff', uniformColor: '', gameType: '', teamLevel: '' });
  const [playerForm, setPlayerForm] = useState({ name: '', position: 'Atacante', number: 10 });
  
  const [ibgeStates, setIbgeStates] = useState<IBGEState[]>([]);
  const [ibgeCities, setIbgeCities] = useState<IBGECity[]>([]);

  // Modals & Toasts
  const [confirmDeletePlayer, setConfirmDeletePlayer] = useState<string | null>(null);
  const [confirmDeleteTeam, setConfirmDeleteTeam] = useState<boolean>(false);
  const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);
  const [newlyCreatedTeamId, setNewlyCreatedTeamId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{title: string, type: 'success' | 'error'} | null>(null);

  const showToast = (title: string, type: 'success' | 'error') => {
    setToastMessage({ title, type });
    setTimeout(() => setToastMessage(null), 3000);
  };

  useEffect(() => {
    fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome')
      .then(res => res.json())
      .then(data => setIbgeStates(data))
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (teamForm.state) {
      fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${teamForm.state}/municipios?orderBy=nome`)
        .then(res => res.json())
        .then(data => setIbgeCities(data))
        .catch(console.error);
    } else {
      setIbgeCities([]);
    }
  }, [teamForm.state]);

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>, field: 'logoUrl' | 'bannerUrl') => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = field === 'bannerUrl' ? 1200 : 256;
        const MAX_HEIGHT = field === 'bannerUrl' ? 600 : 256;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/webp', 0.8);
        setTeamForm(prev => ({ ...prev, [field]: dataUrl }));
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    async function loadTeamData() {
      if (!user) return;
      
      try {
        if (activeTeamId) {
          const teamRef = doc(db, 'teams', activeTeamId);
          const teamSnap = await getDoc(teamRef);
          
          if (teamSnap.exists()) {
            const teamData = { id: teamSnap.id, ...teamSnap.data() } as Team;
          
          // Fetch matches to calculate stats dynamically
          const matchesQ = query(collection(db, 'matches'));
          const matchesSnap = await getDocs(matchesQ);
          
          const festivalQ = query(collection(db, 'festivalGames'));
          const festivalSnap = await getDocs(festivalQ);
          
          let wins = 0, draws = 0, losses = 0, goalsFor = 0, goalsAgainst = 0, points = 0;
          
          const allMatches = [...matchesSnap.docs, ...festivalSnap.docs];
          
          allMatches.forEach(d => {
            const match = d.data();
            if (match.status !== 'completed') return;
            
            if (match.homeTeamId === teamData.id || match.awayTeamId === teamData.id) {
              const isHome = match.homeTeamId === teamData.id;
              
              if (match.woTeamId) {
                if (match.resultStatus !== 'confirmed') return;
                if (match.woTeamId === teamData.id) {
                  points -= 3;
                  losses += 1;
                } else {
                  points += 3;
                  wins += 1;
                }
              } else if (match.quadros && match.quadros.length > 0) {
                match.quadros.forEach((q: any) => {
                  if (q.status !== 'confirmed') return;
                  
                  const qMyGoals = isHome ? (q.homeScore || 0) : (q.awayScore || 0);
                  const qTheirGoals = isHome ? (q.awayScore || 0) : (q.homeScore || 0);
                  
                  goalsFor += qMyGoals;
                  goalsAgainst += qTheirGoals;
                  
                  if (qMyGoals > qTheirGoals) {
                    wins += 1;
                    points += 3;
                  } else if (qMyGoals < qTheirGoals) {
                    losses += 1;
                  } else {
                    draws += 1;
                    points += 1;
                  }
                });
              } else {
                if (match.resultStatus !== 'confirmed') return;
                
                const myScore = isHome ? match.homeScore : match.awayScore;
                const theirScore = isHome ? match.awayScore : match.homeScore;
                
                goalsFor += myScore || 0;
                goalsAgainst += theirScore || 0;
                
                if (myScore > theirScore) {
                  wins += 1;
                  points += 3;
                } else if (myScore < theirScore) {
                  losses += 1;
                } else {
                  draws += 1;
                  points += 1;
                }
              }
            }
          });
          
          teamData.stats = { wins, draws, losses, goalsFor, goalsAgainst, points };
          
          const allMatchesData = allMatches.map(d => ({ id: d.id, ...d.data() }));
          const earnedBadges = calculateBadges(allMatchesData, teamData, []);
          setMyBadges(earnedBadges);

          // Calculate upcoming matches
          const now = new Date().toISOString();
          const upcoming = allMatches
            .map(d => ({ id: d.id, ...d.data() } as any))
            .filter(m => (m.homeTeamId === teamData.id || m.awayTeamId === teamData.id) && m.status === 'confirmed' && m.date >= now)
            .sort((a, b) => {
              const timeA = a.date && !isNaN(new Date(a.date).getTime()) ? new Date(a.date).getTime() : 0;
              const timeB = b.date && !isNaN(new Date(b.date).getTime()) ? new Date(b.date).getTime() : 0;
              return timeA - timeB;
            })
            .slice(0, 5);
            
          // Fetch team names for upcoming matches
          const teamsSnap = await getDocs(collection(db, 'teams'));
          const teamNames = new Map();
          teamsSnap.docs.forEach(d => teamNames.set(d.id, d.data().name));
          
          const formattedUpcoming = upcoming.map(m => {
            let isoDate = m.date;
            if (!isoDate || isNaN(new Date(isoDate).getTime())) {
              isoDate = new Date().toISOString();
            }
            if (m.isFestival) {
              // Festival date parsing
              try {
                if (m.date) {
                  const [year, month, day] = m.date.split('-');
                  const [hours, minutes] = (m.startTime || '00:00').split(':');
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
            }
            return {
              ...m,
              date: isoDate,
              homeTeamName: m.homeTeamName || teamNames.get(m.homeTeamId) || 'Time Desconhecido',
              awayTeamName: m.awayTeamName || teamNames.get(m.awayTeamId) || 'Time Desconhecido'
            };
          });
          
          setUpcomingMatches(formattedUpcoming);

          setTeam(teamData);
          setTeamForm({
            name: teamData.name,
            managerName: teamData.managerName || '',
            whatsapp: teamData.whatsapp || '',
            state: teamData.state || '',
            city: teamData.city || '',
            zone: teamData.zone || '',
            neighborhood: teamData.neighborhood || '',
            logoUrl: teamData.logoUrl || '',
            bannerUrl: teamData.bannerUrl || '',
            primaryColor: teamData.primaryColor || '#10b981',
            secondaryColor: teamData.secondaryColor || '#ffffff',
            uniformColor: teamData.uniformColor || '',
            gameType: teamData.gameType || '',
            teamLevel: teamData.teamLevel || ''
          });

          // Load players
          const playersQ = query(collection(db, 'players'), where('teamId', '==', teamData.id));
          const playersSnap = await getDocs(playersQ);
          setPlayers(playersSnap.docs.map(d => ({ id: d.id, ...d.data() } as Player)));
        } else {
          setTeam(null);
        }
      } else {
        setTeam(null);
      }
      } catch (error) {
        console.error("Error loading team data:", error);
      } finally {
        setLoading(false);
      }
    }

    loadTeamData();
  }, [user, activeTeamId]);

  const handleSaveTeam = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || isSaving) return;

    // Manual validation for better mobile UX (especially iOS Safari)
    if (!teamForm.name.trim()) return showToast("Preencha o Nome do Time", "error");
    if (!teamForm.managerName.trim()) return showToast("Preencha o Nome do Responsável", "error");
    if (!teamForm.whatsapp.trim()) return showToast("Preencha o WhatsApp", "error");
    if (!teamForm.state) return showToast("Selecione o Estado", "error");
    if (!teamForm.city) return showToast("Selecione a Cidade", "error");
    if (teamForm.state === 'SP' && teamForm.city === 'São Paulo' && !teamForm.zone) {
      return showToast("Selecione a Zona", "error");
    }
    if (!teamForm.neighborhood.trim()) return showToast("Preencha o Bairro", "error");
    if (!teamForm.uniformColor.trim()) return showToast("Preencha a Cor do Uniforme", "error");
    if (!teamForm.gameType) return showToast("Selecione o Tipo de Jogo", "error");
    if (!teamForm.teamLevel) return showToast("Selecione o Nível do Time", "error");

    setIsSaving(true);
    try {
      if (team) {
        // Update existing team
        const teamRef = doc(db, 'teams', team.id);
        await updateDoc(teamRef, {
          name: teamForm.name,
          managerName: teamForm.managerName,
          whatsapp: teamForm.whatsapp,
          state: teamForm.state,
          city: teamForm.city,
          zone: teamForm.zone,
          neighborhood: teamForm.neighborhood,
          logoUrl: teamForm.logoUrl,
          bannerUrl: teamForm.bannerUrl,
          primaryColor: teamForm.primaryColor,
          secondaryColor: teamForm.secondaryColor,
          uniformColor: teamForm.uniformColor,
          gameType: teamForm.gameType,
          teamLevel: teamForm.teamLevel
        });
        setTeam({ ...team, ...teamForm });
      } else {
        // Create new team
        const newTeamRef = doc(collection(db, 'teams'));
        const newTeamData = {
          name: teamForm.name,
          managerName: teamForm.managerName,
          whatsapp: teamForm.whatsapp,
          state: teamForm.state,
          city: teamForm.city,
          zone: teamForm.zone,
          neighborhood: teamForm.neighborhood,
          logoUrl: teamForm.logoUrl,
          bannerUrl: teamForm.bannerUrl,
          primaryColor: teamForm.primaryColor,
          secondaryColor: teamForm.secondaryColor,
          uniformColor: teamForm.uniformColor,
          gameType: teamForm.gameType,
          teamLevel: teamForm.teamLevel,
          managerId: user.uid,
          stats: { wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0 },
          createdAt: new Date().toISOString()
        };
        
        console.log("Creating team:", newTeamData);
        await setDoc(newTeamRef, newTeamData);
        console.log("Team created successfully");
        
        setTeam({ id: newTeamRef.id, ...newTeamData });
        
        // Update user profile with teamId
        console.log("Updating user profile with teamId:", newTeamRef.id);
        await setActiveTeamId(newTeamRef.id);
        console.log("User profile updated successfully");
        
        setNewlyCreatedTeamId(newTeamRef.id);
        setShowAvailabilityModal(true);
      }
      
      if (team) {
        showToast("Time salvo com sucesso!", "success");
      }
      
      setIsEditingTeam(false);
    } catch (error) {
      console.error("Error saving team:", error);
      showToast("Erro ao salvar o time. Verifique as permissões. Detalhes no console.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteTeam = () => {
    setConfirmDeleteTeam(true);
  };

  const confirmDeleteTeamAction = async () => {
    if (!team || !user) return;
    
    try {
      await updateDoc(doc(db, 'teams', team.id), { deleted: true });
      showToast("Time excluído com sucesso!", "success");
      
      // Check if user has other teams
      const userTeamsSnap = await getDocs(query(collection(db, 'teams'), where('managerId', '==', user.uid)));
      const activeTeams = userTeamsSnap.docs.filter(d => !d.data().deleted);
      
      if (activeTeams.length > 0) {
        await setActiveTeamId(activeTeams[0].id);
      } else {
        await setActiveTeamId(null);
      }
      setIsEditingTeam(false);
      setConfirmDeleteTeam(false);
    } catch (error) {
      console.error("Error deleting team:", error);
      showToast("Erro ao excluir o time.", "error");
    }
  };

  const handleAddPlayer = async (e: FormEvent) => {
    e.preventDefault();
    if (!team) return;

    try {
      const newPlayer = {
        teamId: team.id,
        name: playerForm.name,
        position: playerForm.position,
        number: Number(playerForm.number),
        stats: { goals: 0, yellowCards: 0, redCards: 0 },
        createdAt: new Date().toISOString()
      };
      
      console.log("Adding player:", newPlayer);
      const docRef = await addDoc(collection(db, 'players'), newPlayer);
      console.log("Player added successfully with ID:", docRef.id);
      
      setPlayers([...players, { id: docRef.id, ...newPlayer }]);
      setIsAddingPlayer(false);
      setPlayerForm({ name: '', position: 'Atacante', number: 10 });
      showToast("Jogador adicionado com sucesso!", "success");
    } catch (error) {
      console.error("Error adding player:", error);
      showToast("Erro ao adicionar jogador. Detalhes no console.", "error");
    }
  };

  const handleDeletePlayerClick = (playerId: string) => {
    setConfirmDeletePlayer(playerId);
  };

  const confirmDeletePlayerAction = async () => {
    if (!confirmDeletePlayer) return;
    try {
      await deleteDoc(doc(db, 'players', confirmDeletePlayer));
      setPlayers(players.filter(p => p.id !== confirmDeletePlayer));
      setConfirmDeletePlayer(null);
      showToast("Jogador removido com sucesso!", "success");
    } catch (error) {
      console.error("Error deleting player:", error);
      showToast("Erro ao remover jogador.", "error");
    }
  };

  const togglePayment = async (playerId: string, monthKey: string, isPaid: boolean) => {
    try {
      const playerRef = doc(db, 'players', playerId);
      await updateDoc(playerRef, {
        [`monthlyFees.${monthKey}`]: isPaid
      });
      setPlayers(players.map(p => {
        if (p.id === playerId) {
          return {
            ...p,
            monthlyFees: {
              ...(p.monthlyFees || {}),
              [monthKey]: isPaid
            }
          };
        }
        return p;
      }));
      showToast(isPaid ? "Pagamento registrado!" : "Pagamento removido!", "success");
    } catch (error) {
      console.error("Error updating payment:", error);
      showToast("Erro ao atualizar pagamento.", "error");
    }
  };

  const handleAvailabilitySelection = async (type: 'home' | 'away') => {
    if (!newlyCreatedTeamId) return;

    try {
      if (type === 'away') {
        showToast("Time criado como Visitante com sucesso!", "success");
      } else {
        showToast("Time criado como Mandante com sucesso!", "success");
      }

      setShowAvailabilityModal(false);
      setNewlyCreatedTeamId(null);
      navigate('/calendar', { state: { openAddAvailability: true } });
    } catch (error) {
      console.error("Error setting availability:", error);
      showToast("Erro ao definir disponibilidade.", "error");
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div></div>;
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Meu Time</h1>
          <p className="text-zinc-500">Gerencie o perfil e elenco do seu time.</p>
        </div>
        <div className="flex gap-2">
          <a 
            href={team ? "https://chat.whatsapp.com/IvYGzIMr6Vl738aSNDDQK1" : undefined}
            target={team ? "_blank" : undefined}
            rel={team ? "noopener noreferrer" : undefined}
            className={cn(
              "px-4 py-2 rounded-xl font-medium flex items-center gap-2 transition-colors",
              team 
                ? "bg-[#25D366] hover:bg-[#20bd5a] text-white" 
                : "bg-zinc-200 text-zinc-400 cursor-not-allowed"
            )}
            title={!team ? "Cadastre um time para acessar o grupo oficial" : "Entrar no grupo oficial"}
            onClick={(e) => {
              if (!team) e.preventDefault();
            }}
          >
            <MessageCircle className="w-4 h-4" /> Grupo Oficial
          </a>
          {team && !isEditingTeam && (
            <button 
              onClick={() => {
                setTeam(null);
                setTeamForm({
                  name: '',
                  managerName: '',
                  whatsapp: '',
                  state: '',
                  city: '',
                  zone: '',
                  neighborhood: '',
                  logoUrl: '',
                  bannerUrl: '',
                  primaryColor: '#10b981',
                  secondaryColor: '#059669',
                  uniformColor: '#ffffff',
                  gameType: '',
                  teamLevel: ''
                });
                setIsEditingTeam(true);
              }}
              className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-xl font-medium flex items-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" /> Novo Time
            </button>
          )}
          {!team && !isEditingTeam && (
            <button 
              onClick={() => setIsEditingTeam(true)}
              className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl font-medium flex items-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" /> Criar Time
            </button>
          )}
        </div>
      </header>

      {/* Team Profile Section */}
      {isEditingTeam ? (
        <form onSubmit={handleSaveTeam} className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm space-y-4">
          <h2 className="text-xl font-semibold mb-4">{team ? 'Editar Time' : 'Criar Novo Time'}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Nome do Time <span className="text-red-500">*</span></label>
              <input type="text" value={teamForm.name} onChange={e => setTeamForm({...teamForm, name: e.target.value})} className="w-full p-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Ex: Várzea FC" />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Nome do Responsável <span className="text-red-500">*</span></label>
              <input type="text" value={teamForm.managerName} onChange={e => setTeamForm({...teamForm, managerName: e.target.value})} className="w-full p-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Nome completo" />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">WhatsApp <span className="text-red-500">*</span></label>
              <input type="tel" value={teamForm.whatsapp} onChange={e => setTeamForm({...teamForm, whatsapp: e.target.value})} className="w-full p-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="(11) 99999-9999" />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Estado <span className="text-red-500">*</span></label>
              <select 
                value={teamForm.state} 
                onChange={e => setTeamForm({...teamForm, state: e.target.value, city: ''})} 
                className="w-full p-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white"
              >
                <option value="">Selecione um estado</option>
                {ibgeStates.map(state => (
                  <option key={state.id} value={state.sigla}>{state.nome}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Cidade <span className="text-red-500">*</span></label>
              <select 
                value={teamForm.city} 
                onChange={e => setTeamForm({...teamForm, city: e.target.value, zone: ''})} 
                disabled={!teamForm.state}
                className="w-full p-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white disabled:bg-zinc-100 disabled:text-zinc-400"
              >
                <option value="">Selecione uma cidade</option>
                {ibgeCities.map(city => (
                  <option key={city.id} value={city.nome}>{city.nome}</option>
                ))}
              </select>
            </div>
            {teamForm.state === 'SP' && teamForm.city === 'São Paulo' && (
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Zona <span className="text-red-500">*</span></label>
                <select 
                  value={teamForm.zone} 
                  onChange={e => setTeamForm({...teamForm, zone: e.target.value})} 
                  className="w-full p-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white"
                >
                  <option value="">Selecione a zona</option>
                  <option value="Leste">Leste</option>
                  <option value="Oeste">Oeste</option>
                  <option value="Norte">Norte</option>
                  <option value="Sul">Sul</option>
                  <option value="Centro">Centro</option>
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Bairro <span className="text-red-500">*</span></label>
              <input type="text" value={teamForm.neighborhood} onChange={e => setTeamForm({...teamForm, neighborhood: e.target.value})} className="w-full p-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Uniforme (Cor) <span className="text-red-500">*</span></label>
              <input type="text" value={teamForm.uniformColor} onChange={e => setTeamForm({...teamForm, uniformColor: e.target.value})} className="w-full p-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Ex: Azul e Branco" />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Tipo de Jogo <span className="text-red-500">*</span></label>
              <select value={teamForm.gameType} onChange={e => setTeamForm({...teamForm, gameType: e.target.value})} className="w-full p-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white">
                <option value="">Selecione</option>
                <option value="Campo">Campo</option>
                <option value="FUT7">FUT7</option>
                <option value="Futsal">Futsal</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Nível do Time <span className="text-red-500">*</span></label>
              <select value={teamForm.teamLevel} onChange={e => setTeamForm({...teamForm, teamLevel: e.target.value})} className="w-full p-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white">
                <option value="">Selecione</option>
                <option value="🟢 Bronze (Iniciante)">🟢 Bronze (Iniciante)</option>
                <option value="🔵 Prata (Amador)">🔵 Prata (Amador)</option>
                <option value="🟡 Ouro (Competitivo)">🟡 Ouro (Competitivo)</option>
                <option value="🔴 Platina (Semi-pro)">🔴 Platina (Semi-pro)</option>
                <option value="⚫ Lendário (Elite)">⚫ Lendário (Elite)</option>
              </select>
            </div>

            <div className="md:col-span-2 space-y-3 mt-2 border-t border-zinc-100 pt-4">
              <label className="block text-sm font-medium text-zinc-700">Cores do Time</label>
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-3">
                  <div className="flex flex-col">
                    <span className="text-xs text-zinc-500 mb-1">Primária</span>
                    <div className="flex items-center gap-2">
                      <input 
                        type="color" 
                        value={teamForm.primaryColor} 
                        onChange={e => setTeamForm({...teamForm, primaryColor: e.target.value})} 
                        className="w-10 h-10 p-1 border border-zinc-300 rounded-lg cursor-pointer" 
                      />
                      <span className="text-sm text-zinc-500 uppercase">{teamForm.primaryColor}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex flex-col">
                    <span className="text-xs text-zinc-500 mb-1">Secundária</span>
                    <div className="flex items-center gap-2">
                      <input 
                        type="color" 
                        value={teamForm.secondaryColor} 
                        onChange={e => setTeamForm({...teamForm, secondaryColor: e.target.value})} 
                        className="w-10 h-10 p-1 border border-zinc-300 rounded-lg cursor-pointer" 
                      />
                      <span className="text-sm text-zinc-500 uppercase">{teamForm.secondaryColor}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="md:col-span-2 space-y-3 mt-2 border-t border-zinc-100 pt-4">
              <label className="block text-sm font-medium text-zinc-700">Escudo do Time</label>
              <div className="flex items-center gap-4">
                <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e, 'logoUrl')} className="block w-full text-sm text-zinc-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100" />
                {teamForm.logoUrl && (
                  <img src={teamForm.logoUrl} alt="Preview" className="w-10 h-10 object-cover rounded-full border border-zinc-200" />
                )}
              </div>
            </div>
          </div>
          <div className="flex justify-between items-center pt-4">
            {team ? (
              <button type="button" onClick={handleDeleteTeam} className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg font-medium transition-colors">
                Excluir Time
              </button>
            ) : <div></div>}
            <div className="flex gap-2">
              {team && (
                <button type="button" onClick={() => setIsEditingTeam(false)} disabled={isSaving} className="px-4 py-2 text-zinc-600 hover:bg-zinc-100 rounded-lg font-medium disabled:opacity-50">
                  Cancelar
                </button>
              )}
              <button type="submit" disabled={isSaving} className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg font-medium disabled:opacity-50 flex items-center gap-2">
                {isSaving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Salvando...
                  </>
                ) : (
                  'Salvar'
                )}
              </button>
            </div>
          </div>
        </form>
      ) : team ? (
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden relative pt-12">
          <button onClick={() => setIsEditingTeam(true)} className="absolute top-4 right-4 text-zinc-400 hover:text-emerald-500 p-2 rounded-lg hover:bg-zinc-100 transition-colors z-10">
            <Edit2 className="w-5 h-5" />
          </button>
          
          <div className="px-6 pb-6 relative">
            <div className="flex flex-col md:flex-row items-center md:items-start gap-6 mb-6">
              <div 
                className="w-32 h-32 md:w-40 md:h-40 bg-zinc-100 rounded-full flex items-center justify-center overflow-hidden border-4 shadow-lg flex-shrink-0"
                style={{ 
                  borderColor: team.primaryColor || '#ffffff',
                  backgroundColor: team.secondaryColor || '#f4f4f5'
                }}
              >
                {team.logoUrl ? (
                  <img src={team.logoUrl} alt={team.name} className="w-full h-full object-cover" />
                ) : (
                  <Shield className="w-16 h-16 text-zinc-400" />
                )}
              </div>
              
              <div className="flex-1 text-center md:text-left pb-2">
                <h2 className="text-3xl font-bold text-zinc-900" style={{ color: team.primaryColor || '#18181b' }}>{team.name}</h2>
                <p className="text-zinc-500 flex items-center justify-center md:justify-start gap-1 mt-1 font-medium">
                  {team.city} - {team.state} {team.zone ? `(Zona ${team.zone})` : ''} • {team.neighborhood}
                </p>
                {team.managerName && team.whatsapp && (
                  <p className="text-zinc-500 flex items-center justify-center md:justify-start gap-1 mt-1 font-medium text-sm">
                    Responsável: {team.managerName} • WhatsApp: {team.whatsapp}
                  </p>
                )}
                {(team.gameType || team.teamLevel || team.uniformColor) && (
                  <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 mt-2">
                    {team.gameType && (
                      <span className="px-2.5 py-1 bg-zinc-100 text-zinc-600 rounded-md text-xs font-medium border border-zinc-200">
                        {team.gameType}
                      </span>
                    )}
                    {team.teamLevel && (
                      <span className="px-2.5 py-1 bg-zinc-100 text-zinc-600 rounded-md text-xs font-medium border border-zinc-200">
                        {team.teamLevel}
                      </span>
                    )}
                    {team.uniformColor && (
                      <span className="px-2.5 py-1 bg-zinc-100 text-zinc-600 rounded-md text-xs font-medium border border-zinc-200">
                        Uniforme: {team.uniformColor}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            
            <div className="grid grid-cols-3 md:grid-cols-6 gap-4 border-t border-zinc-100 pt-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-zinc-900">{team.stats.points}</div>
                <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Pontos</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-emerald-600">{team.stats.wins}</div>
                <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Vitórias</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-zinc-600">{team.stats.draws}</div>
                <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Empates</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">{team.stats.losses}</div>
                <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Derrotas</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-zinc-900">{team.stats.goalsFor}</div>
                <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Gols Pró</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-zinc-900">{team.stats.goalsAgainst}</div>
                <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Gols Sofridos</div>
              </div>
            </div>

            {/* Badges Section in Team Profile */}
            <div className="mt-8 border-t border-zinc-100 pt-6">
              <h3 className="text-sm font-bold text-zinc-900 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Award className="w-4 h-4 text-emerald-500" />
                Conquistas do Time
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                {Object.values(BADGES).map(badge => {
                  const isEarned = myBadges.includes(badge.id);
                  const Icon = badge.icon;
                  return (
                    <div key={badge.id} className={cn("flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all", isEarned ? `${badge.bgColor} border-white/20` : "bg-zinc-50 border-zinc-200 grayscale opacity-50")}>
                      <Icon className={cn("w-8 h-8 mb-2", isEarned ? badge.color : "text-zinc-400")} />
                      <span className={cn("text-xs font-bold leading-tight", isEarned ? "text-zinc-900" : "text-zinc-500")}>{badge.name}</span>
                      <span className="text-[10px] mt-1 leading-tight text-zinc-500">{badge.description}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Upcoming Matches Section */}
            {upcomingMatches.length > 0 && (
              <div className="mt-8 border-t border-zinc-100 pt-6">
                <h3 className="text-sm font-bold text-zinc-900 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <CalendarIcon className="w-4 h-4 text-emerald-500" />
                  Próximos Jogos
                </h3>
                <div className="space-y-3">
                  {upcomingMatches.map(match => (
                    <div key={match.id} className="bg-white border border-zinc-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-zinc-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <Shield className="w-6 h-6 text-zinc-400" />
                        </div>
                        <div>
                          <div className="font-bold text-zinc-900">
                            {match.homeTeamName} <span className="text-zinc-400 font-normal mx-2">vs</span> {match.awayTeamName}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500">
                            <span className="flex items-center gap-1">
                              <CalendarIcon className="w-3 h-3" />
                              {match.date && !isNaN(new Date(match.date).getTime())
                                ? format(new Date(match.date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
                                : 'Data Inválida'}
                            </span>
                            {match.location && (
                              <span className="flex items-center gap-1">
                                <MapPin className="w-3 h-3" />
                                {match.location}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {match.isFestival ? (
                          <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">Festival</span>
                        ) : (
                          <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">Amistoso</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-zinc-50 border-2 border-dashed border-zinc-200 rounded-2xl p-12 text-center">
          <Shield className="w-12 h-12 text-zinc-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-zinc-900 mb-2">Você ainda não tem um time</h3>
          <p className="text-zinc-500 mb-6 max-w-md mx-auto">Crie o perfil do seu time para começar a agendar jogos, adicionar jogadores e participar de competições.</p>
        </div>
      )}

      {/* Tabs */}
      {team && !isEditingTeam && (
        <div className="flex border-b border-zinc-200 mb-6">
          <button
            onClick={() => setActiveTab('elenco')}
            className={cn("px-4 py-3 text-sm font-medium border-b-2 transition-colors", activeTab === 'elenco' ? "border-emerald-500 text-emerald-600" : "border-transparent text-zinc-500 hover:text-zinc-700")}
          >
            <div className="flex items-center gap-2"><Users className="w-4 h-4"/> Elenco</div>
          </button>
          <button
            onClick={() => setActiveTab('financeiro')}
            className={cn("px-4 py-3 text-sm font-medium border-b-2 transition-colors", activeTab === 'financeiro' ? "border-emerald-500 text-emerald-600" : "border-transparent text-zinc-500 hover:text-zinc-700")}
          >
            <div className="flex items-center gap-2"><DollarSign className="w-4 h-4"/> Financeiro</div>
          </button>
        </div>
      )}

      {/* Players Section */}
      {team && activeTab === 'elenco' && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2 text-zinc-800">
              <Users className="w-5 h-5 text-emerald-500" />
              Elenco
            </h2>
            {!isAddingPlayer && (
              <button 
                onClick={() => setIsAddingPlayer(true)}
                className="text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1 text-sm"
              >
                <Plus className="w-4 h-4" /> Adicionar Jogador
              </button>
            )}
          </div>

          {isAddingPlayer && (
            <form onSubmit={handleAddPlayer} className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs font-medium text-zinc-500 mb-1">Nome <span className="text-red-500">*</span></label>
                <input required type="text" value={playerForm.name} onChange={e => setPlayerForm({...playerForm, name: e.target.value})} className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Nome do jogador" />
              </div>
              <div className="w-32">
                <label className="block text-xs font-medium text-zinc-500 mb-1">Posição</label>
                <select value={playerForm.position} onChange={e => setPlayerForm({...playerForm, position: e.target.value})} className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none">
                  <option>Goleiro</option>
                  <option>Zagueiro</option>
                  <option>Lateral</option>
                  <option>Volante</option>
                  <option>Meia</option>
                  <option>Atacante</option>
                </select>
              </div>
              <div className="w-20">
                <label className="block text-xs font-medium text-zinc-500 mb-1">Número <span className="text-red-500">*</span></label>
                <input required type="number" min="1" max="99" value={playerForm.number} onChange={e => setPlayerForm({...playerForm, number: parseInt(e.target.value)})} className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setIsAddingPlayer(false)} className="px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 rounded-lg font-medium">
                  Cancelar
                </button>
                <button type="submit" className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 text-sm rounded-lg font-medium">
                  Salvar
                </button>
              </div>
            </form>
          )}

          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            {players.length === 0 ? (
              <div className="p-8 text-center text-zinc-500 flex flex-col items-center">
                <AlertCircle className="w-8 h-8 text-zinc-300 mb-2" />
                Nenhum jogador cadastrado no elenco.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-50 text-zinc-500 font-medium border-b border-zinc-200">
                    <tr>
                      <th className="p-4 w-16 text-center">Nº</th>
                      <th className="p-4">Nome</th>
                      <th className="p-4">Posição</th>
                      <th className="p-4 text-center">Gols</th>
                      <th className="p-4 text-center">CA</th>
                      <th className="p-4 text-center">CV</th>
                      <th className="p-4 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {players.sort((a, b) => a.number - b.number).map(player => (
                      <tr key={player.id} className="hover:bg-zinc-50/50 transition-colors">
                        <td className="p-4 text-center font-mono font-medium text-zinc-400">{player.number}</td>
                        <td className="p-4 font-medium text-zinc-900">{player.name}</td>
                        <td className="p-4 text-zinc-500">{player.position}</td>
                        <td className="p-4 text-center font-medium">{player.stats.goals}</td>
                        <td className="p-4 text-center text-yellow-600 font-medium">{player.stats.yellowCards}</td>
                        <td className="p-4 text-center text-red-600 font-medium">{player.stats.redCards}</td>
                        <td className="p-4 text-right">
                          <button onClick={() => handleDeletePlayerClick(player.id)} className="text-zinc-400 hover:text-red-500 p-1 rounded transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Financeiro Section */}
      {team && activeTab === 'financeiro' && (
        <section className="space-y-4 animate-in fade-in duration-300">
          <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm">
            <button onClick={() => setFinancialMonth(subMonths(financialMonth, 1))} className="p-2 hover:bg-zinc-100 rounded-lg transition-colors">
              <ChevronLeft className="w-5 h-5 text-zinc-600" />
            </button>
            <h3 className="text-lg font-bold text-zinc-900 capitalize">
              {format(financialMonth, 'MMMM yyyy', { locale: ptBR })}
            </h3>
            <button onClick={() => setFinancialMonth(addMonths(financialMonth, 1))} className="p-2 hover:bg-zinc-100 rounded-lg transition-colors">
              <ChevronRight className="w-5 h-5 text-zinc-600" />
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
                  <tr>
                    <th className="p-4 font-medium">Jogador</th>
                    <th className="p-4 font-medium text-center">Status</th>
                    <th className="p-4 font-medium text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {players.map(player => {
                    const monthKey = format(financialMonth, 'yyyy-MM');
                    const isPaid = player.monthlyFees?.[monthKey] || false;
                    return (
                      <tr key={player.id} className="hover:bg-zinc-50 transition-colors">
                        <td className="p-4 font-medium text-zinc-900">{player.name}</td>
                        <td className="p-4 text-center">
                          <span className={cn("px-3 py-1 rounded-full text-xs font-medium", isPaid ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
                            {isPaid ? 'Pago' : 'Pendente'}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <button
                            onClick={() => togglePayment(player.id, monthKey, !isPaid)}
                            className={cn("px-4 py-2 rounded-lg text-xs font-medium transition-colors", isPaid ? "bg-zinc-100 text-zinc-600 hover:bg-zinc-200" : "bg-emerald-500 text-white hover:bg-emerald-600")}
                          >
                            {isPaid ? 'Desfazer' : 'Marcar como Pago'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {players.length === 0 && (
                    <tr>
                      <td colSpan={3} className="p-8 text-center text-zinc-500">
                        Nenhum jogador cadastrado no elenco.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Modals */}
      {confirmDeleteTeam && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-xl font-bold text-zinc-900 mb-2">Excluir Time</h3>
            <p className="text-zinc-600 mb-6">
              Tem certeza que deseja excluir este time? Esta ação não pode ser desfeita e o time não aparecerá mais nas buscas.
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setConfirmDeleteTeam(false)}
                className="px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={confirmDeleteTeamAction}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeletePlayer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-xl font-bold text-zinc-900 mb-2">Remover Jogador</h3>
            <p className="text-zinc-600 mb-6">
              Tem certeza que deseja remover este jogador do elenco?
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setConfirmDeletePlayer(null)}
                className="px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={confirmDeletePlayerAction}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
              >
                Remover
              </button>
            </div>
          </div>
        </div>
      )}

      {showAvailabilityModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
            <h3 className="text-xl font-bold text-zinc-900 mb-2">Disponibilidade do Time</h3>
            <p className="text-zinc-600 mb-6">
              Como seu time irá jogar? Selecione abaixo para configurar sua disponibilidade inicial.
            </p>
            
            <div className="space-y-4">
              <button
                onClick={() => handleAvailabilitySelection('away')}
                className="w-full p-4 border-2 border-zinc-200 rounded-xl hover:border-emerald-500 hover:bg-emerald-50 transition-all text-left group"
              >
                <div className="flex items-center gap-3 mb-1">
                  <MapPin className="w-5 h-5 text-zinc-400 group-hover:text-emerald-500" />
                  <h4 className="font-bold text-zinc-900 group-hover:text-emerald-700">Visitante</h4>
                </div>
                <p className="text-sm text-zinc-500 pl-8">
                  Jogo fora de casa.
                </p>
              </button>

              <button
                onClick={() => handleAvailabilitySelection('home')}
                className="w-full p-4 border-2 border-zinc-200 rounded-xl hover:border-emerald-500 hover:bg-emerald-50 transition-all text-left group"
              >
                <div className="flex items-center gap-3 mb-1">
                  <Shield className="w-5 h-5 text-zinc-400 group-hover:text-emerald-500" />
                  <h4 className="font-bold text-zinc-900 group-hover:text-emerald-700">Mandante</h4>
                </div>
                <p className="text-sm text-zinc-500 pl-8">
                  Tenho campo para jogar.
                </p>
              </button>
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
