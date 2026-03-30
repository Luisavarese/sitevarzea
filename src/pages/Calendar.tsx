import { useState, useEffect, FormEvent, ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { collection, query, getDocs, addDoc, where, doc, updateDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Calendar as CalendarIcon, Clock, MapPin, Plus, Check, X, Search, Edit2, Trash2, AlertCircle, MessageCircle, ChevronLeft, ChevronRight, Shield } from 'lucide-react';
import { format, parseISO, isAfter, addDays, startOfDay, addMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, subMonths } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { ptBR } from 'date-fns/locale';
import { cn } from '../lib/utils';
import { sendNotification } from '../lib/notifications';

interface Availability {
  id: string;
  teamId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  location: string;
  type: 'home' | 'away' | 'both';
  createdAt: string;
  teamName?: string;
  logoUrl?: string;
  estado?: string;
  cidade?: string;
  bairro?: string;
  nomeCampo?: string;
  cep?: string;
  endereco?: string;
  numero?: string;
  referencia?: string;
  lat?: number;
  lng?: number;
  gameType?: string;
  uniformColor?: string;
  teamLevel?: string;
  lastResults?: ('W' | 'D' | 'L')[];
  whatsapp?: string;
}

interface Match {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName?: string;
  awayTeamName?: string;
  date: string;
  endTime?: string;
  location: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  homeScore?: number;
  awayScore?: number;
  quadros?: { homeScore: number; awayScore: number; status?: 'pending_confirmation' | 'confirmed' | 'contested', contestReason?: string, submittedBy?: string, submittedAt?: string }[];
  homeTeamRating?: number;
  awayTeamRating?: number;
  courtRating?: number;
  homeTeamLogo?: string;
  awayTeamLogo?: string;
  resultSubmittedBy?: string;
  resultStatus?: 'pending_confirmation' | 'confirmed' | 'contested';
  contestReason?: string;
  resultSubmittedAt?: string;
  woTeamId?: string;
  scheduledById: string;
  isFestival?: boolean;
  opponentWhatsapp?: string;
  opponentManager?: string;
  notified3Days?: boolean;
  notified1Hour?: boolean;
  resultNotificationSent?: boolean;
}

interface TeamBlock {
  id: string;
  teamId: string;
  date: string;
  createdAt: string;
}

const DAYS_OF_WEEK = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const CountdownTimer = ({ submittedAt }: { submittedAt: string }) => {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const updateTimer = () => {
      if (!submittedAt) return;
      const now = new Date().getTime();
      const submittedTime = new Date(submittedAt).getTime();
      const deadline = submittedTime + 24 * 60 * 60 * 1000;
      const diff = deadline - now;

      if (diff <= 0) {
        setTimeLeft('00:00');
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setTimeLeft(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [submittedAt]);

  if (!timeLeft) return null;

  return (
    <div className="flex items-center gap-1 text-xs font-mono font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">
      <Clock className="w-3 h-3" />
      {timeLeft}
    </div>
  );
};

export function Calendar() {
  const navigate = useNavigate();
  const { user, activeTeamId } = useAuth();
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [myTeam, setMyTeam] = useState<any>(null);
  const [availabilities, setAvailabilities] = useState<Availability[]>([]);
  const [myMatches, setMyMatches] = useState<Match[]>([]);
  const [allMatches, setAllMatches] = useState<Match[]>([]);
  const [teamBlocks, setTeamBlocks] = useState<TeamBlock[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Calendar State
  const [currentMonth, setCurrentMonth] = useState<Date>(startOfMonth(new Date()));
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<Date | null>(new Date());
  
  // Forms
  const [isAddingAvail, setIsAddingAvail] = useState(false);
  const [editingAvailId, setEditingAvailId] = useState<string | null>(null);
  const initialAvailForm = {
    dayOfWeek: 0,
    startTime: '08:00',
    endTime: '10:00',
    location: '',
    type: 'home' as 'home' | 'away' | 'both',
    estado: '',
    cidade: '',
    bairro: '',
    nomeCampo: '',
    cep: '',
    endereco: '',
    numero: '',
    referencia: '',
    lat: undefined as number | undefined,
    lng: undefined as number | undefined
  };

  const [availForm, setAvailForm] = useState(initialAvailForm);
  const [newBlockDate, setNewBlockDate] = useState('');

  // Modals & Toasts
  const [confirmMatch, setConfirmMatch] = useState<{avail: Availability, availableDates: Date[]} | null>(null);
  const [selectedDateStr, setSelectedDateStr] = useState<string>('');
  const [confirmDeleteAvail, setConfirmDeleteAvail] = useState<string | null>(null);
  const [scoreModal, setScoreModal] = useState<{matchId: string} | null>(null);
  const [ratingModal, setRatingModal] = useState<{matchId: string} | null>(null);

  const isResultUnlocked = (match: Match) => {
    if (!match.date || isNaN(new Date(match.date).getTime())) return false;
    
    const timeZone = 'America/Sao_Paulo';
    const matchDateZoned = toZonedTime(new Date(match.date), timeZone);
    let endTimeZoned = toZonedTime(new Date(match.date), timeZone);
    
    if (match.endTime) {
      const [hours, minutes] = match.endTime.split(':');
      endTimeZoned.setHours(parseInt(hours || '0'), parseInt(minutes || '0'), 0, 0);
      
      // If end time is earlier than start time, it means it ends the next day
      if (endTimeZoned < matchDateZoned) {
        endTimeZoned = addDays(endTimeZoned, 1);
      }
    } else {
      // Default duration: 2 hours
      endTimeZoned.setHours(endTimeZoned.getHours() + 2);
    }
    
    const endTimeUTC = fromZonedTime(endTimeZoned, timeZone);
    
    // Unlock 1 hour after match ends
    const unlockTime = new Date(endTimeUTC.getTime() + 60 * 60 * 1000);
    return new Date() >= unlockTime;
  };
  const [contestModal, setContestModal] = useState<{matchId: string, quadroIndex?: number} | null>(null);
  const [contestReason, setContestReason] = useState('');
  const [contestHomeScore, setContestHomeScore] = useState('');
  const [contestAwayScore, setContestAwayScore] = useState('');
  const [quadros, setQuadros] = useState<{homeScore: string, awayScore: string}[]>([{homeScore: '', awayScore: ''}]);
  const [opponentRating, setOpponentRating] = useState<number>(0);
  const [courtRating, setCourtRating] = useState<number>(0);
  const [isWO, setIsWO] = useState(false);
  const [woTeamId, setWoTeamId] = useState('');
  const [toastMessage, setToastMessage] = useState<{title: string, type: 'success' | 'error'} | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);

  const showToast = (title: string, type: 'success' | 'error') => {
    setToastMessage({ title, type });
    setTimeout(() => setToastMessage(null), 3000);
  };

  const sortMatches = (matches: Match[]) => {
    const now = new Date().getTime();
    return [...matches].sort((a, b) => {
      const timeA = a.date && !isNaN(new Date(a.date).getTime()) ? new Date(a.date).getTime() : 0;
      const timeB = b.date && !isNaN(new Date(b.date).getTime()) ? new Date(b.date).getTime() : 0;
      const diffA = timeA - now;
      const diffB = timeB - now;
      
      if ((diffA >= 0 && diffB >= 0) || (diffA < 0 && diffB < 0)) {
        return Math.abs(diffA) - Math.abs(diffB);
      }
      return diffA >= 0 ? -1 : 1;
    });
  };

  useEffect(() => {
    async function fetchData() {
      if (!user) return;
      
      try {
        // Get my team
        if (activeTeamId) {
          const teamDoc = await getDoc(doc(db, 'teams', activeTeamId));
          
          if (teamDoc.exists()) {
            const teamId = teamDoc.id;
            setMyTeamId(teamId);
            setMyTeam({ id: teamId, ...teamDoc.data() });

          // Fetch all availabilities (for scheduling)
          const availQ = query(collection(db, 'availabilities'));
          const availSnap = await getDocs(availQ);
          
          // Fetch team names for availabilities
          const teamsSnap = await getDocs(collection(db, 'teams'));
          const teamsMap = new Map();
          teamsSnap.docs.forEach(d => teamsMap.set(d.id, d.data()));

          const myTeamData = teamDoc.data();
          const myGameType = myTeamData.gameType;

          // Fetch all matches
          const allMatchesQ = query(collection(db, 'matches'));
          const allMatchesSnap = await getDocs(allMatchesQ);
          const now = new Date();
          
          const allMatchesData = await Promise.all(allMatchesSnap.docs.map(async d => {
            const data = d.data();
            let isoDate = data.date;
            if (!isoDate || isNaN(new Date(isoDate).getTime())) {
              isoDate = new Date().toISOString(); // Fallback to avoid crashes
            }
            
            let status = data.status;
            let resultStatus = data.resultStatus;
            
            // Auto-cancel pending matches older than 3 days
            if (status === 'pending' && data.createdAt) {
              if (!data.createdAt || isNaN(new Date(data.createdAt).getTime())) return;
              const createdAtDate = new Date(data.createdAt);
              const diffTime = Math.abs(now.getTime() - createdAtDate.getTime());
              const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
              if (diffDays > 3) {
                status = 'cancelled';
                try {
                  await updateDoc(doc(db, 'matches', d.id), { status: 'cancelled' });
                } catch (e) {
                  console.error("Failed to auto-cancel match", e);
                }
              }
            }

            // Auto-confirm results after 24 hours is handled by checkAutoConfirmations
            
            const opponentId = data.homeTeamId === teamId ? data.awayTeamId : data.homeTeamId;
            const opponentTeam = teamsMap.get(opponentId);
            
            return { 
              id: d.id, 
              ...data,
              status,
              resultStatus,
              date: isoDate,
              homeTeamName: teamsMap.get(data.homeTeamId)?.name || 'Time Desconhecido',
              awayTeamName: teamsMap.get(data.awayTeamId)?.name || 'Time Desconhecido',
              homeTeamLogo: teamsMap.get(data.homeTeamId)?.logoUrl,
              awayTeamLogo: teamsMap.get(data.awayTeamId)?.logoUrl,
              opponentWhatsapp: opponentTeam?.whatsapp,
              opponentManager: opponentTeam?.managerName
            } as Match;
          }));

          const getLast5Results = (tId: string) => {
            const teamMatches = allMatchesData
              .filter(m => m.status === 'completed' && m.resultStatus === 'confirmed' && !m.isFestival && (m.homeTeamId === tId || m.awayTeamId === tId))
              .sort((a, b) => {
                const timeA = a.date && !isNaN(new Date(a.date).getTime()) ? new Date(a.date).getTime() : 0;
                const timeB = b.date && !isNaN(new Date(b.date).getTime()) ? new Date(b.date).getTime() : 0;
                return timeB - timeA;
              })
              .slice(0, 5);

            return teamMatches.map(m => {
              const isHome = m.homeTeamId === tId;
              const myScore = isHome ? m.homeScore : m.awayScore;
              const theirScore = isHome ? m.awayScore : m.homeScore;
              
              if (m.woTeamId) {
                return m.woTeamId === tId ? 'L' : 'W';
              }
              
              if (myScore! > theirScore!) return 'W';
              if (myScore! < theirScore!) return 'L';
              return 'D';
            }).reverse(); // Oldest to newest (left to right)
          };

          setAvailabilities(availSnap.docs.map(d => {
            const data = d.data();
            const oppTeam = teamsMap.get(data.teamId);
            return { 
              id: d.id, 
              ...data, 
              teamName: oppTeam?.name,
              logoUrl: oppTeam?.logoUrl,
              gameType: oppTeam?.gameType,
              uniformColor: oppTeam?.uniformColor,
              teamLevel: oppTeam?.teamLevel,
              lastResults: getLast5Results(data.teamId),
              whatsapp: oppTeam?.whatsapp
            } as Availability;
          }).filter(a => {
            // Always show own availabilities
            if (a.teamId === teamId) return true;
            // If my team has a game type, only show opponents with the same game type
            if (myGameType && a.gameType) {
              return a.gameType === myGameType;
            }
            return true; // Fallback for legacy data without gameType
          }));
          const festivalQuery = query(collection(db, 'festivalGames'));
          const festivalSnap = await getDocs(festivalQuery);
          const festivalData = festivalSnap.docs
            .map(doc => {
              const data = doc.data();
              // Only show if at least one team is signed up
              if (!data.homeTeamId && !data.awayTeamId) return null;
              
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
                homeTeamLogo: teamsMap.get(data.homeTeamId)?.logoUrl,
                awayTeamLogo: teamsMap.get(data.awayTeamId)?.logoUrl,
                date: isoDate,
                location: 'Festival',
                status: data.status || 'confirmed',
                homeScore: data.homeScore,
                awayScore: data.awayScore,
                woTeamId: data.woTeamId,
                scheduledById: 'admin',
                isFestival: true
              } as Match;
            })
            .filter(Boolean) as Match[];

          const combinedMatches = [...allMatchesData, ...festivalData];
          setAllMatches(combinedMatches);
          
          // Filter my matches
          const myMatchesData = combinedMatches.filter(m => m.homeTeamId === teamId || m.awayTeamId === teamId);
          
          // Check for notifications
          myMatchesData.forEach(async (m) => {
            if (m.status === 'confirmed') {
              if (!m.date || isNaN(new Date(m.date).getTime())) return false;
              const matchDate = new Date(m.date);
              const diffTime = matchDate.getTime() - now.getTime();
              const diffDays = diffTime / (1000 * 60 * 60 * 24);
              const diffHours = diffTime / (1000 * 60 * 60);

              // 3 days before notification
              if (diffDays > 0 && diffDays <= 3 && !m.notified3Days) {
                showToast(`Lembrete: Você tem um jogo contra ${m.homeTeamId === teamId ? m.awayTeamName : m.homeTeamName} em breve!`, "success");
                try {
                  const collectionName = m.isFestival ? 'festivalGames' : 'matches';
                  await updateDoc(doc(db, collectionName, m.id), { notified3Days: true });
                  m.notified3Days = true;
                } catch (e) {
                  console.error("Failed to update notified3Days", e);
                }
              }

              // 1 hour after notification
              if (diffHours < -1 && !m.notified1Hour) {
                showToast(`O jogo contra ${m.homeTeamId === teamId ? m.awayTeamName : m.homeTeamName} terminou. Por favor, informe o resultado!`, "success");
                try {
                  const collectionName = m.isFestival ? 'festivalGames' : 'matches';
                  await updateDoc(doc(db, collectionName, m.id), { notified1Hour: true });
                  m.notified1Hour = true;
                } catch (e) {
                  console.error("Failed to update notified1Hour", e);
                }
              }
            }
          });

          setMyMatches(sortMatches(myMatchesData));

          // Fetch team blocks
          const blocksQ = query(collection(db, 'teamBlocks'));
          const blocksSnap = await getDocs(blocksQ);
          setTeamBlocks(blocksSnap.docs.map(d => ({ id: d.id, ...d.data() } as TeamBlock)));
        } else {
          setMyTeamId(null);
          setMyTeam(null);
        }
      } else {
        setMyTeamId(null);
        setMyTeam(null);
      }
      } catch (error) {
        console.error("Error fetching calendar data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [user, activeTeamId]);

  useEffect(() => {
    const checkAutoConfirmations = async () => {
      if (!myTeamId || myMatches.length === 0) return;
      
      const now = new Date().getTime();
      let updatedMatches = false;
      const newMatches = [...myMatches];

      for (let i = 0; i < newMatches.length; i++) {
        const match = newMatches[i];
        if (match.status === 'completed' && match.resultStatus === 'pending_confirmation') {
          const collectionName = match.isFestival ? 'festivalGames' : 'matches';
          let matchUpdated = false;
          
          if (match.quadros && match.quadros.length > 0) {
            const newQuadros = match.quadros.map(q => {
              if (q.status === 'pending_confirmation') {
                const submittedAt = q.submittedAt ? new Date(q.submittedAt).getTime() : (match.resultSubmittedAt ? new Date(match.resultSubmittedAt).getTime() : 0);
                if (submittedAt > 0) {
                  const deadline = submittedAt + 24 * 60 * 60 * 1000;
                  if (now > deadline) {
                    matchUpdated = true;
                    return { ...q, status: 'confirmed' as const };
                  }
                }
              }
              return q;
            });
            
            if (matchUpdated) {
              const allProcessed = newQuadros.every(q => q.status === 'confirmed' || q.status === 'contested');
              const anyContested = newQuadros.some(q => q.status === 'contested');
              const newResultStatus = allProcessed ? (anyContested ? 'contested' : 'confirmed') : 'pending_confirmation';
              
              await updateDoc(doc(db, collectionName, match.id), {
                quadros: newQuadros,
                resultStatus: newResultStatus
              });
              
              newMatches[i] = { ...match, quadros: newQuadros, resultStatus: newResultStatus };
              updatedMatches = true;
            }
          } else if (match.resultSubmittedAt) {
            const submittedAt = new Date(match.resultSubmittedAt).getTime();
            const deadline = submittedAt + 24 * 60 * 60 * 1000;
            if (now > deadline) {
              await updateDoc(doc(db, collectionName, match.id), {
                resultStatus: 'confirmed'
              });
              newMatches[i] = { ...match, resultStatus: 'confirmed' };
              updatedMatches = true;
            }
          }
        }
      }
      
      if (updatedMatches) {
        setMyMatches(newMatches);
      }
    };
    
    checkAutoConfirmations();
    const interval = setInterval(checkAutoConfirmations, 60000);
    return () => clearInterval(interval);
  }, [myMatches, myTeamId]);

  const handleCepChange = async (e: ChangeEvent<HTMLInputElement>) => {
    let cep = e.target.value.replace(/\D/g, '');
    
    let formattedCep = cep;
    if (cep.length > 5) {
      formattedCep = `${cep.slice(0, 5)}-${cep.slice(5, 8)}`;
    }
    
    setAvailForm(prev => ({ ...prev, cep: formattedCep }));

    if (cep.length === 8) {
      try {
        const response = await fetch(`https://brasilapi.com.br/api/cep/v2/${cep}`);
        const data = await response.json();
        
        if (!data.errors && !data.message) {
          setAvailForm(prev => ({
            ...prev,
            estado: data.state || prev.estado,
            cidade: data.city || prev.cidade,
            bairro: data.neighborhood || prev.bairro,
            endereco: data.street || prev.endereco,
            lat: data.location?.coordinates?.latitude ? Number(data.location.coordinates.latitude) : prev.lat,
            lng: data.location?.coordinates?.longitude ? Number(data.location.coordinates.longitude) : prev.lng,
          }));
        } else {
          const viaCepResponse = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
          const viaCepData = await viaCepResponse.json();
          if (!viaCepData.erro) {
            setAvailForm(prev => ({
              ...prev,
              estado: viaCepData.uf || prev.estado,
              cidade: viaCepData.localidade || prev.cidade,
              bairro: viaCepData.bairro || prev.bairro,
              endereco: viaCepData.logradouro || prev.endereco,
            }));
          }
        }
      } catch (error) {
        console.error("Erro ao buscar CEP:", error);
      }
    }
  };

  const handleSaveAvailability = async (e: FormEvent) => {
    e.preventDefault();
    if (!myTeamId) return;

    const currentSub = myTeam?.subscription;
    const isActive = currentSub?.status === 'active' && new Date(currentSub.expiresAt) > new Date();

    if (!isActive) {
      setShowSubscriptionModal(true);
      return;
    }

    try {
      if (editingAvailId) {
        const availRef = doc(db, 'availabilities', editingAvailId);
        await updateDoc(availRef, {
          dayOfWeek: Number(availForm.dayOfWeek),
          startTime: availForm.startTime,
          endTime: availForm.endTime,
          location: availForm.location,
          type: availForm.type,
          estado: availForm.estado,
          cidade: availForm.cidade,
          bairro: availForm.bairro,
          nomeCampo: availForm.nomeCampo,
          cep: availForm.cep,
          endereco: availForm.endereco,
          numero: availForm.numero,
          referencia: availForm.referencia,
          lat: availForm.lat ?? null,
          lng: availForm.lng ?? null,
        });
        
        setAvailabilities(availabilities.map(a => 
          a.id === editingAvailId 
            ? { ...a, ...availForm, dayOfWeek: Number(availForm.dayOfWeek) } 
            : a
        ));
        setEditingAvailId(null);
        setIsAddingAvail(false);
        setAvailForm(initialAvailForm);
        showToast("Disponibilidade atualizada com sucesso!", "success");
      } else {
        const newAvail = {
          teamId: myTeamId,
          dayOfWeek: Number(availForm.dayOfWeek),
          startTime: availForm.startTime,
          endTime: availForm.endTime,
          location: availForm.location,
          type: availForm.type,
          estado: availForm.estado,
          cidade: availForm.cidade,
          bairro: availForm.bairro,
          nomeCampo: availForm.nomeCampo,
          cep: availForm.cep,
          endereco: availForm.endereco,
          numero: availForm.numero,
          referencia: availForm.referencia,
          lat: availForm.lat ?? null,
          lng: availForm.lng ?? null,
          createdAt: new Date().toISOString()
        };
        
        const docRef = await addDoc(collection(db, 'availabilities'), newAvail);
        setAvailabilities([...availabilities, { id: docRef.id, ...newAvail, teamName: 'Meu Time' }]);
        setIsAddingAvail(false);
        setAvailForm(initialAvailForm);
        showToast("Disponibilidade adicionada com sucesso!", "success");
      }
    } catch (error) {
      console.error("Error saving availability:", error);
      showToast("Erro ao salvar disponibilidade.", "error");
    }
  };

  const handleEditAvailability = (avail: Availability) => {
    const currentSub = myTeam?.subscription;
    const isActive = currentSub?.status === 'active' && new Date(currentSub.expiresAt) > new Date();
    if (!isActive) {
      setShowSubscriptionModal(true);
      return;
    }

    setAvailForm({
      dayOfWeek: avail.dayOfWeek,
      startTime: avail.startTime,
      endTime: avail.endTime,
      location: avail.location,
      type: currentSub.plan?.includes('visitante') ? 'away' : 'home',
      estado: avail.estado || '',
      cidade: avail.cidade || '',
      bairro: avail.bairro || '',
      nomeCampo: avail.nomeCampo || '',
      cep: avail.cep || '',
      endereco: avail.endereco || '',
      numero: avail.numero || '',
      referencia: avail.referencia || '',
      lat: avail.lat,
      lng: avail.lng
    });
    setEditingAvailId(avail.id);
    setIsAddingAvail(true);
  };

  const handleDeleteAvailability = (id: string) => {
    setConfirmDeleteAvail(id);
  };

  const confirmDeleteAvailabilityAction = async () => {
    if (!confirmDeleteAvail) return;
    try {
      await deleteDoc(doc(db, 'availabilities', confirmDeleteAvail));
      setAvailabilities(availabilities.filter(a => a.id !== confirmDeleteAvail));
      setConfirmDeleteAvail(null);
      showToast("Disponibilidade excluída com sucesso!", "success");
    } catch (error) {
      console.error("Error deleting availability:", error);
      showToast("Erro ao excluir disponibilidade.", "error");
    }
  };

  const handleAddTeamBlock = async (e: FormEvent) => {
    e.preventDefault();
    if (!myTeamId || !newBlockDate) return;

    const currentSub = myTeam?.subscription;
    const isActive = currentSub?.status === 'active' && new Date(currentSub.expiresAt) > new Date();

    if (!isActive) {
      setShowSubscriptionModal(true);
      return;
    }

    try {
      const newBlock = {
        teamId: myTeamId,
        date: newBlockDate,
        createdAt: new Date().toISOString()
      };
      
      const docRef = await addDoc(collection(db, 'teamBlocks'), newBlock);
      setTeamBlocks([...teamBlocks, { id: docRef.id, ...newBlock }]);
      setNewBlockDate('');
      showToast("Data bloqueada com sucesso!", "success");
    } catch (error) {
      console.error("Error adding team block:", error);
      showToast("Erro ao bloquear data.", "error");
    }
  };

  const handleDeleteTeamBlock = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'teamBlocks', id));
      setTeamBlocks(teamBlocks.filter(b => b.id !== id));
      showToast("Bloqueio removido com sucesso!", "success");
    } catch (error) {
      console.error("Error deleting team block:", error);
      showToast("Erro ao remover bloqueio.", "error");
    }
  };

  const handleScheduleMatchClick = (avail: Availability & { availableDates: Date[] }) => {
    if (!user) return;
    if (!myTeamId) {
      showToast("Você precisa criar um time primeiro.", "error");
      return;
    }
    if (avail.teamId === myTeamId) {
      showToast("Você não pode agendar um jogo contra seu próprio time.", "error");
      return;
    }

    const currentSub = myTeam?.subscription;
    const isActive = currentSub?.status === 'active' && new Date(currentSub.expiresAt) > new Date();

    if (!isActive) {
      setShowSubscriptionModal(true);
      return;
    }

    setConfirmMatch({ avail, availableDates: avail.availableDates });
    if (selectedCalendarDate && avail.availableDates.some(d => isSameDay(d, selectedCalendarDate))) {
      setSelectedDateStr(format(selectedCalendarDate, 'yyyy-MM-dd'));
    } else {
      // Find the first available date that hasn't been invited yet
      const uninvitedDate = avail.availableDates.find(d => {
        return !myMatches.some(m => {
          const isSameOpponent = m.homeTeamId === avail.teamId || m.awayTeamId === avail.teamId;
          if (!m.date || isNaN(new Date(m.date).getTime())) return false;
          const isSameMatchDate = format(new Date(m.date), 'yyyy-MM-dd') === format(d, 'yyyy-MM-dd');
          return isSameOpponent && isSameMatchDate && m.status !== 'cancelled';
        });
      });
      setSelectedDateStr(format(uninvitedDate || avail.availableDates[0], 'yyyy-MM-dd'));
    }
  };

  const formatLocation = (avail: Availability) => {
    const parts = [];
    if (avail.type !== 'away' && avail.nomeCampo) parts.push(avail.nomeCampo);
    if (avail.bairro) parts.push(avail.bairro);
    if (avail.cidade) parts.push(avail.cidade);
    
    if (parts.length > 0) return parts.join(', ');
    return avail.location || 'A definir';
  };

  const confirmScheduleMatch = async () => {
    if (!confirmMatch || !myTeamId || !user || !selectedDateStr) return;
    const { avail } = confirmMatch;

    const baseDate = confirmMatch.availableDates.find(d => format(d, 'yyyy-MM-dd') === selectedDateStr);
    if (!baseDate) return;

    const nextDate = new Date(baseDate);
    try {
      const [hours, minutes] = (avail.startTime || '00:00').split(':');
      nextDate.setHours(parseInt(hours || '0'), parseInt(minutes || '0'), 0, 0);
    } catch (e) {
      console.error("Invalid start time", e);
    }

    // Check if there's already a match with this team on this date
    const existingMatch = myMatches.find(m => {
      const isSameOpponent = m.homeTeamId === avail.teamId || m.awayTeamId === avail.teamId;
      if (!m.date || isNaN(new Date(m.date).getTime())) return false;
      const isSameMatchDate = format(new Date(m.date), 'yyyy-MM-dd') === format(nextDate, 'yyyy-MM-dd');
      return isSameOpponent && isSameMatchDate && m.status !== 'cancelled';
    });

    if (existingMatch) {
      showToast("Você já enviou um convite para este time neste dia.", "error");
      return;
    }

    try {
      const newMatch = {
        homeTeamId: avail.type === 'away' ? myTeamId : avail.teamId,
        awayTeamId: avail.type === 'away' ? avail.teamId : myTeamId,
        date: nextDate.toISOString(),
        endTime: avail.endTime || '00:00',
        location: formatLocation(avail),
        status: 'pending',
        scheduledById: user.uid,
        createdAt: new Date().toISOString()
      };

      const docRef = await addDoc(collection(db, 'matches'), newMatch);
      
      const localNewMatch = {
        ...newMatch,
        id: docRef.id,
        homeTeamName: avail.type === 'away' ? myTeam?.name : avail.teamName,
        awayTeamName: avail.type === 'away' ? avail.teamName : myTeam?.name,
        homeTeamLogo: avail.type === 'away' ? myTeam?.logoUrl : avail.logoUrl,
        awayTeamLogo: avail.type === 'away' ? avail.logoUrl : myTeam?.logoUrl,
      };

      setMyMatches(sortMatches([...myMatches, localNewMatch as Match]));
      setConfirmMatch(null);
      showToast("Solicitação de jogo enviada com sucesso!", "success");

      // Send notifications
      const matchDateStr = format(nextDate, "dd/MM/yyyy 'às' HH:mm");
      const message = `O time ${myTeam?.name || 'adversário'} te convidou para um jogo no dia ${matchDateStr}.`;
      
      await sendNotification({
        userId: avail.managerId!,
        title: 'Novo convite de jogo!',
        message: message,
        link: '/calendar',
        type: 'info',
        userPhone: avail.whatsapp
      });

      if (avail.whatsapp) {
        const phone = avail.whatsapp.replace(/\D/g, '');
        if (phone) {
          const appUrl = window.location.origin;
          const waMessage = `Olá! ${message} Acesse o site para aceitar ou recusar: ${appUrl}/calendar`;
          
          const waUrl = `https://api.whatsapp.com/send?phone=55${phone}&text=${encodeURIComponent(waMessage)}`;
          
          // Open WhatsApp in a new tab, fallback to same window if blocked
          const newWindow = window.open(waUrl, '_blank');
          if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
            window.location.href = waUrl;
          }
        }
      }
    } catch (error) {
      console.error("Error scheduling match:", error);
      showToast("Erro ao agendar jogo.", "error");
    }
  };

  const handleUpdateMatchStatus = async (matchId: string, newStatus: 'confirmed' | 'cancelled') => {
    if (newStatus === 'confirmed') {
      const currentSub = myTeam?.subscription;
      const isActive = currentSub?.status === 'active' && new Date(currentSub.expiresAt) > new Date();

      if (!isActive) {
        setShowSubscriptionModal(true);
        return;
      }
    }

    try {
      await updateDoc(doc(db, 'matches', matchId), { status: newStatus });
      
      let updatedMatches = myMatches.map(m => m.id === matchId ? { ...m, status: newStatus } : m);

      const match = myMatches.find(m => m.id === matchId);
      if (match) {
        const opponentTeamId = match.homeTeamId === myTeamId ? match.awayTeamId : match.homeTeamId;
        
        // Fetch opponent team to get managerId
        const opponentTeamSnap = await getDoc(doc(db, 'teams', opponentTeamId));
        if (opponentTeamSnap.exists()) {
          const opponentTeamData = opponentTeamSnap.data();
          const opponentManagerId = opponentTeamData.managerId;
          const matchDateStr = format(new Date(match.date), "dd/MM/yyyy 'às' HH:mm");
          
          await sendNotification({
            userId: opponentManagerId,
            title: newStatus === 'confirmed' ? 'Jogo Confirmado!' : 'Jogo Recusado/Cancelado',
            message: `O time ${myTeam?.name} ${newStatus === 'confirmed' ? 'aceitou' : 'recusou/cancelou'} o jogo do dia ${matchDateStr}.`,
            link: '/calendar',
            type: newStatus === 'confirmed' ? 'success' : 'error',
            userPhone: opponentTeamData.whatsapp
          });
        }
      }

      if (newStatus === 'confirmed') {
        const confirmedMatch = myMatches.find(m => m.id === matchId);
        if (confirmedMatch) {
          if (!confirmedMatch.date || isNaN(new Date(confirmedMatch.date).getTime())) {
            throw new Error("Data do jogo inválida");
          }
          const matchDateStr = format(new Date(confirmedMatch.date), 'yyyy-MM-dd');
          
          // Find other pending matches for the same date for both teams in the database
          const matchesRef = collection(db, 'matches');
          const q = query(matchesRef);
          const querySnapshot = await getDocs(q);
          
          const pendingMatchesToCancel = querySnapshot.docs.filter(doc => {
            const data = doc.data();
            if (doc.id === matchId || data.status !== 'pending') return false;
            
            if (!data.date || isNaN(new Date(data.date).getTime())) return false;
            const isSameDate = format(new Date(data.date), 'yyyy-MM-dd') === matchDateStr;
            const involvesHomeTeam = data.homeTeamId === confirmedMatch.homeTeamId || data.awayTeamId === confirmedMatch.homeTeamId;
            const involvesAwayTeam = data.homeTeamId === confirmedMatch.awayTeamId || data.awayTeamId === confirmedMatch.awayTeamId;
            
            return isSameDate && (involvesHomeTeam || involvesAwayTeam);
          });

          // Cancel them in DB and state
          for (const docSnap of pendingMatchesToCancel) {
            await updateDoc(doc(db, 'matches', docSnap.id), { status: 'cancelled' });
            updatedMatches = updatedMatches.map(m => m.id === docSnap.id ? { ...m, status: 'cancelled' } : m);
          }
        }
      }

      setMyMatches(sortMatches(updatedMatches));
      showToast(`Status do jogo atualizado para ${newStatus === 'confirmed' ? 'confirmado' : 'cancelado'}.`, "success");
    } catch (error) {
      console.error("Error updating match:", error);
      showToast("Erro ao atualizar status do jogo.", "error");
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div></div>;
  }

  if (!myTeamId) {
    return (
      <div className="bg-zinc-50 border-2 border-dashed border-zinc-200 rounded-2xl p-12 text-center">
        <h3 className="text-lg font-medium text-zinc-900 mb-2">Crie seu time primeiro</h3>
        <p className="text-zinc-500">Você precisa ter um time cadastrado para acessar o calendário.</p>
      </div>
    );
  }

  const myAvailabilities = availabilities.filter(a => a.teamId === myTeamId);
  
  const timeToMinutes = (time: string) => {
    const [h, m] = (time || '00:00').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  const isMatch = (myAvail: Availability, otherAvail: Availability) => {
    if (Number(myAvail.dayOfWeek) !== Number(otherAvail.dayOfWeek)) return false;

    const compatibleType = 
      (myAvail.type === 'both' || otherAvail.type === 'both') ||
      (myAvail.type === 'home' && otherAvail.type === 'away') ||
      (myAvail.type === 'away' && otherAvail.type === 'home');
    
    if (!compatibleType) return false;

    const myStart = timeToMinutes(myAvail.startTime);
    const myEnd = timeToMinutes(myAvail.endTime);
    const otherStart = timeToMinutes(otherAvail.startTime);
    const otherEnd = timeToMinutes(otherAvail.endTime);

    const maxStart = Math.max(myStart, otherStart);
    const minEnd = Math.min(myEnd, otherEnd);

    return maxStart < minEnd;
  };

  const calculateDistance = (lat1?: number, lon1?: number, lat2?: number, lon2?: number) => {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; // Distance in km
    return d.toFixed(1);
  };

  const otherAvailabilitiesWithMatch = availabilities
    .filter(a => a.teamId !== myTeamId)
    .filter(a => {
      if (!searchQuery.trim()) return true;
      return a.teamName?.toLowerCase().includes(searchQuery.toLowerCase());
    })
    .map(a => {
      const match = myAvailabilities.find(my => isMatch(my, a));
      if (!match) return null;

      const today = startOfDay(new Date());
      const endDate = addMonths(today, 6);
      const availableDates: Date[] = [];
      
      let currentDate = today;
      // Find first occurrence
      while (currentDate.getDay() !== Number(a.dayOfWeek)) {
        currentDate = addDays(currentDate, 1);
      }

      // Generate all occurrences in next 6 months
      while (currentDate <= endDate) {
        const dateStr = format(currentDate, 'yyyy-MM-dd');
        
        // Check blocks
        const isBlocked = teamBlocks.some(b => 
          (b.teamId === myTeamId || b.teamId === a.teamId) && b.date === dateStr
        );

        // Check matches
        const hasMatch = allMatches.some(m => {
          if (m.status !== 'pending' && m.status !== 'confirmed') return false;
          const isMyTeamInvolved = m.homeTeamId === myTeamId || m.awayTeamId === myTeamId;
          const isOpponentInvolved = m.homeTeamId === a.teamId || m.awayTeamId === a.teamId;
          if (!isMyTeamInvolved && !isOpponentInvolved) return false;
          
          if (!m.date || isNaN(new Date(m.date).getTime())) return false;
          const matchDateStr = format(new Date(m.date), 'yyyy-MM-dd');
          return matchDateStr === dateStr;
        });

        if (!isBlocked && !hasMatch) {
          availableDates.push(currentDate);
        }

        currentDate = addDays(currentDate, 7);
      }

      if (availableDates.length === 0) return null;

      return { ...a, matchedMyAvail: match, availableDates };
    })
    .filter(Boolean) as (Availability & { matchedMyAvail: Availability, availableDates: Date[] })[];

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);
  const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

  const filteredOpponents = (selectedCalendarDate 
    ? otherAvailabilitiesWithMatch.filter(a => a.availableDates.some(d => isSameDay(d, selectedCalendarDate)))
    : otherAvailabilitiesWithMatch).sort((a, b) => {
      // 1. Sort by distance
      const distA = calculateDistance(a.lat, a.lng, a.matchedMyAvail.lat, a.matchedMyAvail.lng);
      const distB = calculateDistance(b.lat, b.lng, b.matchedMyAvail.lat, b.matchedMyAvail.lng);
      
      const numDistA = distA ? parseFloat(distA) : Infinity;
      const numDistB = distB ? parseFloat(distB) : Infinity;

      if (numDistA !== numDistB) {
        return numDistA - numDistB;
      }

      // 2. Sort by platform usage (number of available dates)
      return b.availableDates.length - a.availableDates.length;
    });

  const handleContestSubmit = async () => {
    if (!contestModal || !contestReason.trim()) return;
    
    const match = myMatches.find(m => m.id === contestModal.matchId);
    if (!match) return;

    const collectionName = match.isFestival ? 'festivalGames' : 'matches';
    const opponentTeamId = match.homeTeamId === myTeamId ? match.awayTeamId : match.homeTeamId;
    const opponentTeamSnap = await getDoc(doc(db, 'teams', opponentTeamId));
    
    let whatsappLink = '';
    let opponentManagerId = '';
    if (myTeam?.whatsapp) {
      const phone = myTeam.whatsapp.replace(/\D/g, '');
      whatsappLink = `https://wa.me/55${phone}`;
    }

    if (opponentTeamSnap.exists()) {
      const opponentTeamData = opponentTeamSnap.data();
      opponentManagerId = opponentTeamData.managerId;
    }

    if (contestModal.quadroIndex !== undefined && match.quadros) {
      if (contestHomeScore === '' || contestAwayScore === '') {
        showToast("Preencha o placar correto para contestar", "error");
        return;
      }

      // Contesting a specific quadro
      const newQuadros = [...match.quadros];
      newQuadros[contestModal.quadroIndex] = { 
        ...newQuadros[contestModal.quadroIndex], 
        homeScore: parseInt(contestHomeScore),
        awayScore: parseInt(contestAwayScore),
        status: 'pending_confirmation', 
        contestReason,
        submittedBy: myTeamId,
        submittedAt: new Date().toISOString()
      };
      
      const allProcessed = newQuadros.every(q => q.status === 'confirmed');
      const newResultStatus = allProcessed ? 'confirmed' : 'pending_confirmation';
      
      let totalHomePoints = 0;
      let totalAwayPoints = 0;
      
      newQuadros.forEach(q => {
        const hs = q.homeScore;
        const as = q.awayScore;
        if (hs > as) totalHomePoints += 3;
        else if (as > hs) totalAwayPoints += 3;
        else { totalHomePoints += 1; totalAwayPoints += 1; }
      });

      await updateDoc(doc(db, collectionName, match.id), { 
        quadros: newQuadros,
        homeScore: totalHomePoints,
        awayScore: totalAwayPoints,
        resultStatus: newResultStatus,
        resultSubmittedBy: myTeamId,
        resultSubmittedAt: new Date().toISOString()
      });
      
      setMyMatches(myMatches.map(m => m.id === match.id ? { 
        ...m, 
        quadros: newQuadros, 
        homeScore: totalHomePoints,
        awayScore: totalAwayPoints,
        resultStatus: newResultStatus,
        resultSubmittedBy: myTeamId,
        resultSubmittedAt: new Date().toISOString()
      } : m));
      
      if (opponentManagerId) {
        await sendNotification({
          userId: opponentManagerId,
          title: `Resultado do ${contestModal.quadroIndex + 1}º Quadro Contestado`,
          message: `O time ${myTeam?.name} contestou o resultado do ${contestModal.quadroIndex + 1}º quadro e sugeriu um novo placar. Motivo: ${contestReason}.`,
          link: '/calendar',
          type: 'warning',
          userPhone: opponentTeamSnap.data()?.whatsapp
        });
      }
      showToast(`Resultado do ${contestModal.quadroIndex + 1}º quadro contestado!`, "success");
    } else {
      // Contesting the whole match
      await updateDoc(doc(db, collectionName, match.id), { 
        resultStatus: 'contested',
        contestReason
      });
      
      setMyMatches(myMatches.map(m => m.id === match.id ? { ...m, resultStatus: 'contested', contestReason } : m));
      
      if (opponentManagerId) {
        await sendNotification({
          userId: opponentManagerId,
          title: `Resultado do Jogo Contestado`,
          message: `O time ${myTeam?.name} contestou o resultado do jogo. Motivo: ${contestReason}. ${whatsappLink ? `Por favor, entre em contato pelo WhatsApp para alinhar o resultado correto: ${whatsappLink}` : 'Por favor, entre em contato com o responsável para alinhar o resultado correto.'}`,
          link: '/calendar',
          type: 'warning',
          userPhone: opponentTeamSnap.data()?.whatsapp
        });
      }
      showToast("Resultado contestado.", "success");
    }

    setContestModal(null);
    setContestReason('');
    setContestHomeScore('');
    setContestAwayScore('');
  };

  const handleQuadroAction = async (match: Match, quadroIndex: number, action: 'confirmed' | 'contested') => {
    if (action === 'contested') {
      setContestModal({ matchId: match.id, quadroIndex });
      return;
    }

    if (!match.quadros) return;
    
    const newQuadros = [...match.quadros];
    newQuadros[quadroIndex] = { ...newQuadros[quadroIndex], status: action };
    
    // Check if all quadros are processed
    const allProcessed = newQuadros.every(q => q.status === 'confirmed' || q.status === 'contested');
    const anyContested = newQuadros.some(q => q.status === 'contested');
    
    const newResultStatus = allProcessed ? (anyContested ? 'contested' : 'confirmed') : 'pending_confirmation';
    
    const collectionName = match.isFestival ? 'festivalGames' : 'matches';
    await updateDoc(doc(db, collectionName, match.id), { 
      quadros: newQuadros,
      resultStatus: newResultStatus
    });
    
    setMyMatches(myMatches.map(m => m.id === match.id ? { ...m, quadros: newQuadros, resultStatus: newResultStatus } : m));
    
    // Send notification
    const opponentTeamId = match.homeTeamId === myTeamId ? match.awayTeamId : match.homeTeamId;
    const opponentTeamSnap = await getDoc(doc(db, 'teams', opponentTeamId));
    if (opponentTeamSnap.exists()) {
      const opponentTeamData = opponentTeamSnap.data();
      const opponentManagerId = opponentTeamData.managerId;
      await sendNotification({
        userId: opponentManagerId,
        title: `Resultado do ${quadroIndex + 1}º Quadro ${action === 'confirmed' ? 'Confirmado' : 'Contestado'}`,
        message: `O time ${myTeam?.name} ${action === 'confirmed' ? 'confirmou' : 'contestou'} o resultado do ${quadroIndex + 1}º quadro.`,
        link: '/calendar',
        type: action === 'confirmed' ? 'success' : 'warning',
        userPhone: opponentTeamData.whatsapp
      });
    }
    
    showToast(`Resultado do ${quadroIndex + 1}º quadro ${action === 'confirmed' ? 'confirmado' : 'contestado'}!`, "success");
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Calendário</h1>
        <p className="text-zinc-500">Gerencie sua agenda e marque jogos com outros times.</p>
      </header>

      <div className="flex flex-col gap-8">
        {/* Minha Agenda & Calendário */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <section className="flex flex-col h-full space-y-4">
            <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2 text-zinc-800">
              <Clock className="w-5 h-5 text-emerald-500" />
              Minha Disponibilidade
            </h2>
            {!isAddingAvail && (
              <button 
                onClick={() => {
                  const currentSub = myTeam?.subscription;
                  const isActive = currentSub?.status === 'active' && new Date(currentSub.expiresAt) > new Date();
                  if (!isActive) {
                    setShowSubscriptionModal(true);
                    return;
                  }

                  setAvailForm({
                    ...initialAvailForm,
                    type: 'away'
                  });
                  setEditingAvailId(null);
                  setIsAddingAvail(true);
                }}
                className="text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1 text-sm"
              >
                <Plus className="w-4 h-4" /> Nova Agenda
              </button>
            )}
          </div>

          {isAddingAvail && (
            <form onSubmit={handleSaveAvailability} className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Dia da Semana</label>
                  <select value={availForm.dayOfWeek} onChange={e => setAvailForm({...availForm, dayOfWeek: Number(e.target.value)})} className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none">
                    {DAYS_OF_WEEK.map((day, idx) => <option key={idx} value={idx}>{day}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Mando</label>
                  <select 
                    value={availForm.type} 
                    onChange={e => setAvailForm({...availForm, type: e.target.value as any})} 
                    className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    <option value="away">Visitante (Vou jogar fora)</option>
                    <option value="home">Mandante (Tenho campo)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Início <span className="text-red-500">*</span></label>
                  <input required type="time" value={availForm.startTime} onChange={e => setAvailForm({...availForm, startTime: e.target.value})} className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Fim <span className="text-red-500">*</span></label>
                  <input required type="time" value={availForm.endTime} onChange={e => setAvailForm({...availForm, endTime: e.target.value})} className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
                {availForm.type !== 'away' && (
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-zinc-500 mb-1">Nome do Campo <span className="text-red-500">*</span></label>
                    <input required type="text" value={availForm.nomeCampo} onChange={e => setAvailForm({...availForm, nomeCampo: e.target.value})} className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Ex: Arena City" />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">CEP {availForm.type === 'away' ? 'da Sede' : 'do Campo'}</label>
                  <input type="text" value={availForm.cep} onChange={handleCepChange} maxLength={9} className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="00000-000" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Estado <span className="text-red-500">*</span></label>
                  <input required type="text" value={availForm.estado} onChange={e => setAvailForm({...availForm, estado: e.target.value})} className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="SP" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Cidade <span className="text-red-500">*</span></label>
                  <input required type="text" value={availForm.cidade} onChange={e => setAvailForm({...availForm, cidade: e.target.value})} className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="São Paulo" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Bairro <span className="text-red-500">*</span></label>
                  <input required type="text" value={availForm.bairro} onChange={e => setAvailForm({...availForm, bairro: e.target.value})} className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Centro" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Endereço <span className="text-red-500">*</span></label>
                  <input required type="text" value={availForm.endereco} onChange={e => setAvailForm({...availForm, endereco: e.target.value})} className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Rua Exemplo" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Número <span className="text-red-500">*</span></label>
                  <input required type="text" value={availForm.numero} onChange={e => setAvailForm({...availForm, numero: e.target.value})} className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="123" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Referência</label>
                  <input type="text" value={availForm.referencia} onChange={e => setAvailForm({...availForm, referencia: e.target.value})} className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Próximo ao mercado" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => {
                  setIsAddingAvail(false);
                  setEditingAvailId(null);
                  setAvailForm(initialAvailForm);
                }} className="px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 rounded-lg font-medium">Cancelar</button>
                <button type="submit" className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 text-sm rounded-lg font-medium">Salvar</button>
              </div>
            </form>
          )}

          {isAddingAvail && (
            <div className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm mt-4">
              <h3 className="text-sm font-bold text-zinc-800 mb-2 flex items-center gap-2">
                <X className="w-4 h-4 text-red-500" />
                Bloqueio de Agenda
              </h3>
              <p className="text-xs text-zinc-500 mb-4">Selecione uma data em que seu time não poderá jogar. Outros times não poderão marcar jogos com você nesta data.</p>
              <form onSubmit={handleAddTeamBlock} className="flex gap-2 mb-4">
                <input 
                  type="date" 
                  required
                  value={newBlockDate}
                  onChange={e => setNewBlockDate(e.target.value)}
                  min={format(new Date(), 'yyyy-MM-dd')}
                  className="flex-1 p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                />
                <button 
                  type="submit"
                  className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 text-sm rounded-lg font-medium transition-colors"
                >
                  Bloquear
                </button>
              </form>
              <div className="divide-y divide-zinc-100">
                {teamBlocks.filter(b => b.teamId === myTeamId).length === 0 ? (
                  <div className="py-2 text-center text-zinc-500 text-xs">Nenhuma data bloqueada.</div>
                ) : (
                  teamBlocks.filter(b => b.teamId === myTeamId).sort((a, b) => a.date.localeCompare(b.date)).map(block => (
                    <div key={block.id} className="py-2 flex items-center justify-between">
                      <div className="text-sm font-medium text-zinc-900">
                        {format(parseISO(block.date), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                      </div>
                      <button 
                        onClick={() => handleDeleteTeamBlock(block.id)}
                        className="p-1 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Remover bloqueio"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden divide-y divide-zinc-100 flex-1 flex flex-col">
            {myAvailabilities.length === 0 ? (
              <div className="p-6 text-center text-zinc-500 text-sm flex-1 flex items-center justify-center">Nenhuma disponibilidade cadastrada.</div>
            ) : (
              <div className="overflow-y-auto flex-1">
              {myAvailabilities.map(avail => (
                <div key={avail.id} className="p-4 flex items-center justify-between hover:bg-zinc-50 transition-colors">
                  <div>
                    <div className="font-semibold text-zinc-900">{DAYS_OF_WEEK[avail.dayOfWeek]}</div>
                    <div className="text-sm text-zinc-500 flex items-center gap-2 mt-1">
                      <Clock className="w-3 h-3" /> {avail.startTime} - {avail.endTime}
                      <span className="text-zinc-300">•</span>
                      <MapPin className="w-3 h-3" /> {formatLocation(avail)}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-xs font-medium px-2 py-1 rounded-md bg-zinc-100 text-zinc-600 uppercase">
                      {avail.type === 'home' ? 'Mandante' : avail.type === 'away' ? 'Visitante' : 'Ambos'}
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => handleEditAvailability(avail)}
                        className="p-1.5 text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="Editar disponibilidade"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDeleteAvailability(avail.id)}
                        className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Excluir disponibilidade"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              </div>
            )}
          </div>
          </section>

          <section className="flex flex-col h-full space-y-4">
            <h2 className="text-xl font-semibold flex items-center gap-2 text-zinc-800">
              <CalendarIcon className="w-5 h-5 text-emerald-500" />
              Calendário
            </h2>
            <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm w-full flex-1 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <button onClick={prevMonth} className="p-2 hover:bg-zinc-100 rounded-lg transition-colors"><ChevronLeft className="w-5 h-5 text-zinc-600" /></button>
                <h3 className="font-semibold text-zinc-800 capitalize">{format(currentMonth, 'MMMM yyyy', { locale: ptBR })}</h3>
                <button onClick={nextMonth} className="p-2 hover:bg-zinc-100 rounded-lg transition-colors"><ChevronRight className="w-5 h-5 text-zinc-600" /></button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center mb-2">
                {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => (
                  <div key={day} className="text-xs font-medium text-zinc-500">{day}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1 flex-1">
                {calendarDays.map((day, idx) => {
                  const isSelected = selectedCalendarDate && isSameDay(day, selectedCalendarDate);
                  const isCurrentMonth = isSameMonth(day, currentMonth);
                  const isToday = isSameDay(day, new Date());
                  const isMyAvailableDay = myAvailabilities.some(a => a.dayOfWeek === day.getDay());
                  const isBlocked = teamBlocks.some(b => b.teamId === myTeamId && b.date === format(day, 'yyyy-MM-dd'));
                  
                  const hasOpponents = otherAvailabilitiesWithMatch.some(a => a.availableDates.some(d => isSameDay(d, day)));

                  return (
                    <button
                      key={idx}
                      onClick={() => setSelectedCalendarDate(isSelected ? null : day)}
                      className={cn(
                        "aspect-square flex flex-col items-center justify-center rounded-lg text-sm transition-colors relative",
                        !isCurrentMonth && "opacity-40",
                        isSelected 
                          ? "bg-emerald-700 text-white font-bold shadow-md" 
                          : isBlocked
                            ? "bg-red-800 text-white font-bold hover:bg-red-900"
                            : isMyAvailableDay 
                              ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200" 
                              : "bg-red-50 text-red-800 hover:bg-red-100",
                        isToday && !isSelected && "ring-2 ring-emerald-600 ring-offset-1"
                      )}
                    >
                      <span>{format(day, 'd')}</span>
                      {hasOpponents && (
                        <div className={cn(
                          "w-1 h-1 rounded-full mt-0.5",
                          isSelected ? "bg-white" : "bg-emerald-600"
                        )} />
                      )}
                    </button>
                  );
                })}
              </div>
              {selectedCalendarDate && (
                <div className="mt-4 pt-4 border-t border-zinc-100 text-center">
                  <button 
                    onClick={() => setSelectedCalendarDate(null)}
                    className="text-sm text-emerald-600 hover:text-emerald-700 font-medium"
                  >
                    Limpar filtro de data
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Marcar Jogos */}
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h2 className="text-xl font-semibold flex items-center gap-2 text-zinc-800">
              <Search className="w-5 h-5 text-emerald-500" />
              Adversários Disponíveis {selectedCalendarDate && `em ${format(selectedCalendarDate, 'dd/MM/yyyy')}`}
            </h2>
            <div className="relative max-w-xs w-full">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                placeholder="Buscar time..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
          </div>
          
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden divide-y divide-zinc-100">
            {filteredOpponents.length === 0 ? (
              <div className="p-6 text-center text-zinc-500 text-sm">Nenhum time disponível no momento.</div>
            ) : (
              filteredOpponents.map(avail => {
                const distance = calculateDistance(avail.lat, avail.lng, avail.matchedMyAvail.lat, avail.matchedMyAvail.lng);
                
                let alreadyInvited = false;
                if (selectedCalendarDate) {
                  alreadyInvited = myMatches.some(m => {
                    const isSameOpponent = m.homeTeamId === avail.teamId || m.awayTeamId === avail.teamId;
                    if (!m.date || isNaN(new Date(m.date).getTime())) return false;
                    const isSameMatchDate = format(new Date(m.date), 'yyyy-MM-dd') === format(selectedCalendarDate, 'yyyy-MM-dd');
                    return isSameOpponent && isSameMatchDate && m.status !== 'cancelled';
                  });
                } else {
                  alreadyInvited = avail.availableDates.length > 0 && avail.availableDates.every(availDate => {
                    return myMatches.some(m => {
                      const isSameOpponent = m.homeTeamId === avail.teamId || m.awayTeamId === avail.teamId;
                      if (!m.date || isNaN(new Date(m.date).getTime())) return false;
                      const isSameMatchDate = format(new Date(m.date), 'yyyy-MM-dd') === format(availDate, 'yyyy-MM-dd');
                      return isSameOpponent && isSameMatchDate && m.status !== 'cancelled';
                    });
                  });
                }

                return (
                  <div key={avail.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-zinc-50 transition-colors">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="font-bold text-zinc-900">{avail.teamName}</div>
                        {avail.lastResults && avail.lastResults.length > 0 && (
                          <div className="flex items-center gap-1 ml-2" title="Últimos 5 jogos">
                            {avail.lastResults.map((res, i) => (
                              <div 
                                key={i} 
                                className={cn(
                                  "w-2.5 h-2.5 rounded-full",
                                  res === 'W' ? "bg-emerald-500" : res === 'D' ? "bg-amber-400" : "bg-red-500"
                                )}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="text-sm font-medium text-emerald-600 mt-1">{DAYS_OF_WEEK[avail.dayOfWeek]} • {avail.startTime}</div>
                      <div className="text-xs text-zinc-500 flex flex-wrap items-center gap-2 mt-1">
                        <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {formatLocation(avail)} ({avail.type === 'home' ? 'Mandante' : avail.type === 'away' ? 'Visitante' : 'Ambos'})</span>
                        <span className="flex items-center gap-1 bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-medium"><CalendarIcon className="w-3 h-3" /> {avail.availableDates.length} datas disponíveis</span>
                        {distance && (
                          <span className="px-2 py-0.5 bg-zinc-100 rounded-full text-zinc-600 font-medium">
                            ~{distance} km de distância
                          </span>
                        )}
                      </div>
                      {(avail.uniformColor || avail.teamLevel) && (
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          {avail.teamLevel && (
                            <span className="px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded-md text-[10px] font-medium border border-zinc-200">
                              {avail.teamLevel}
                            </span>
                          )}
                          {avail.uniformColor && (
                            <span className="px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded-md text-[10px] font-medium border border-zinc-200">
                              Uniforme: {avail.uniformColor}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <button 
                      onClick={() => handleScheduleMatchClick(avail)}
                      disabled={alreadyInvited}
                      className={cn(
                        "px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap",
                        alreadyInvited 
                          ? "bg-zinc-100 text-zinc-400 cursor-not-allowed" 
                          : "bg-zinc-900 hover:bg-zinc-800 text-white"
                      )}
                    >
                      {alreadyInvited ? 'Convite Enviado' : 'Convidar'}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </section>

      {/* Meus Jogos */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2 text-zinc-800">
          <CalendarIcon className="w-5 h-5 text-emerald-500" />
          Meus Jogos
        </h2>

        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          {myMatches.length === 0 ? (
            <div className="p-8 text-center text-zinc-500">Nenhum jogo agendado.</div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {myMatches.map(match => {
                const isHome = match.homeTeamId === myTeamId;
                const opponentId = isHome ? match.awayTeamId : match.homeTeamId;
                const isPending = match.status === 'pending';
                const iRequested = match.scheduledById === user?.uid;

                return (
                  <div key={match.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-zinc-50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "p-3 rounded-xl text-center min-w-[80px]",
                        isPending ? "bg-amber-50" : match.status === 'confirmed' ? "bg-emerald-50" : "bg-zinc-100"
                      )}>
                        <div className={cn("text-xs font-semibold uppercase", isPending ? "text-amber-600" : match.status === 'confirmed' ? "text-emerald-600" : "text-zinc-500")}>
                          {match.date && !isNaN(new Date(match.date).getTime()) ? format(new Date(match.date), 'MMM', { locale: ptBR }) : '---'}
                        </div>
                        <div className={cn("text-xl font-bold", isPending ? "text-amber-700" : match.status === 'confirmed' ? "text-emerald-700" : "text-zinc-900")}>
                          {match.date && !isNaN(new Date(match.date).getTime()) ? format(new Date(match.date), 'dd') : '--'}
                        </div>
                      </div>
                      <div>
                        <div className="font-semibold text-zinc-900 flex items-center gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            {match.homeTeamLogo ? (
                              <img src={match.homeTeamLogo} alt={match.homeTeamName} className="w-6 h-6 rounded-full object-cover border border-zinc-200" />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-zinc-100 flex items-center justify-center border border-zinc-200">
                                <Shield className="w-3 h-3 text-zinc-400" />
                              </div>
                            )}
                            <span>{match.homeTeamName}</span>
                          </div>
                          <span className="text-zinc-400 text-sm font-normal mx-1">vs</span>
                          <div className="flex items-center gap-2">
                            {match.awayTeamLogo ? (
                              <img src={match.awayTeamLogo} alt={match.awayTeamName} className="w-6 h-6 rounded-full object-cover border border-zinc-200" />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-zinc-100 flex items-center justify-center border border-zinc-200">
                                <Shield className="w-3 h-3 text-zinc-400" />
                              </div>
                            )}
                            <span>{match.awayTeamName}</span>
                          </div>
                          {match.isFestival && (
                            <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase font-bold tracking-wider">Festival</span>
                          )}
                          {isPending && <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full uppercase font-bold tracking-wider">Pendente</span>}
                          {match.status === 'confirmed' && !match.isFestival && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase font-bold tracking-wider">Confirmado</span>}
                        </div>
                        <div className="text-sm text-zinc-500 flex items-center gap-1 mt-1">
                          <Clock className="w-3 h-3" /> {match.date && !isNaN(new Date(match.date).getTime()) ? format(new Date(match.date), 'HH:mm') : '--:--'}
                          <span className="mx-1">•</span>
                          <MapPin className="w-3 h-3" /> {match.location}
                        </div>
                        {match.opponentWhatsapp && (
                          <a 
                            href={`https://wa.me/55${match.opponentWhatsapp.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1.5 rounded-md transition-colors w-fit"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            Falar com {match.opponentManager || 'Responsável'}
                          </a>
                        )}
                      </div>
                    </div>

                    {isPending && !iRequested && (
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => handleUpdateMatchStatus(match.id, 'confirmed')}
                          className="flex items-center gap-1 bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                        >
                          <Check className="w-4 h-4" /> Aceitar
                        </button>
                        <button 
                          onClick={() => handleUpdateMatchStatus(match.id, 'cancelled')}
                          className="flex items-center gap-1 bg-red-100 hover:bg-red-200 text-red-700 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                        >
                          <X className="w-4 h-4" /> Recusar
                        </button>
                      </div>
                    )}
                    {isPending && iRequested && (
                      <div className="text-sm text-zinc-400 italic">Aguardando resposta...</div>
                    )}
                    {(match.status === 'confirmed' || (match.status === 'completed' && match.resultStatus === 'contested')) && (
                      <button 
                        onClick={() => isResultUnlocked(match) ? setScoreModal({ matchId: match.id }) : undefined}
                        disabled={!isResultUnlocked(match)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          isResultUnlocked(match) 
                            ? 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700' 
                            : 'bg-zinc-50 text-zinc-400 cursor-not-allowed border border-zinc-200'
                        }`}
                        title={!isResultUnlocked(match) ? 'O resultado só pode ser inserido 1 hora após o término da partida.' : ''}
                      >
                        Informar Resultado
                      </button>
                    )}
                    {match.status === 'completed' && (
                      <div className="flex flex-col items-end gap-2 w-full md:w-auto mt-4 md:mt-0">
                        {match.quadros && match.quadros.length > 0 ? (
                          <div className="flex flex-col gap-2 w-full min-w-[200px]">
                            {match.quadros.map((q, i) => {
                              const quadroSubmittedBy = q.submittedBy || match.resultSubmittedBy;
                              const quadroSubmittedAt = q.submittedAt || match.resultSubmittedAt;
                              return (
                              <div key={i} className="flex flex-col gap-1 bg-zinc-50 p-2 rounded-lg border border-zinc-200">
                                <div className="flex items-center justify-between gap-4">
                                  <span className="text-xs font-semibold text-zinc-500 uppercase">{i+1}º Quadro</span>
                                  <div className="font-bold text-lg text-zinc-900">
                                    {q.homeScore} x {q.awayScore}
                                  </div>
                                </div>
                                
                                {q.status === 'pending_confirmation' && quadroSubmittedBy !== myTeamId && (
                                  <div className="flex flex-col gap-2 mt-1">
                                    {q.contestReason && (
                                      <span className="text-[10px] text-zinc-500 max-w-[200px] text-right break-words">
                                        Motivo da contestação: {q.contestReason}
                                      </span>
                                    )}
                                    <div className="flex gap-2">
                                      <button 
                                        onClick={() => handleQuadroAction(match, i, 'confirmed')}
                                        className="flex-1 text-xs bg-emerald-500 hover:bg-emerald-600 text-white px-2 py-1 rounded transition-colors"
                                      >
                                        Confirmar
                                      </button>
                                      <button 
                                        onClick={() => handleQuadroAction(match, i, 'contested')}
                                        className="flex-1 text-xs bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded transition-colors"
                                      >
                                        Contestar
                                      </button>
                                    </div>
                                    {quadroSubmittedAt && (
                                      <div className="flex justify-end">
                                        <CountdownTimer submittedAt={quadroSubmittedAt} />
                                      </div>
                                    )}
                                  </div>
                                )}
                                {q.status === 'pending_confirmation' && quadroSubmittedBy === myTeamId && (
                                  <div className="flex flex-col items-end gap-1">
                                    <span className="text-[10px] text-amber-600 font-medium text-right">Aguardando confirmação</span>
                                    {q.contestReason && (
                                      <span className="text-[10px] text-zinc-500 max-w-[200px] text-right break-words">
                                        Motivo da contestação: {q.contestReason}
                                      </span>
                                    )}
                                    {quadroSubmittedAt && (
                                      <CountdownTimer submittedAt={quadroSubmittedAt} />
                                    )}
                                  </div>
                                )}
                                {q.status === 'confirmed' && (
                                  <span className="text-[10px] text-emerald-600 font-medium text-right">Confirmado</span>
                                )}
                                {q.status === 'contested' && (
                                  <div className="flex flex-col items-end gap-1">
                                    <span className="text-[10px] text-red-600 font-medium text-right">Contestado</span>
                                    {q.contestReason && (
                                      <span className="text-[10px] text-zinc-500 max-w-[200px] text-right break-words">
                                        Motivo: {q.contestReason}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            )})}
                          </div>
                        ) : (
                          // Fallback for old matches without quadros
                          <div className="flex flex-col items-end gap-1">
                            <div className="font-bold text-xl text-zinc-900 bg-zinc-100 px-4 py-2 rounded-lg">
                              {match.homeScore} pts x {match.awayScore} pts
                            </div>
                            {match.resultStatus === 'pending_confirmation' && match.resultSubmittedBy === myTeamId && (
                              <div className="flex flex-col items-end gap-1">
                                <span className="text-xs text-amber-600 font-medium">Aguardando confirmação</span>
                                {match.resultSubmittedAt && (
                                  <CountdownTimer submittedAt={match.resultSubmittedAt} />
                                )}
                              </div>
                            )}
                            {match.resultStatus === 'pending_confirmation' && match.resultSubmittedBy !== myTeamId && (
                              <div className="flex flex-col gap-2 items-end">
                                <div className="flex gap-2">
                                  <button 
                                    onClick={async () => {
                                      const collectionName = match.isFestival ? 'festivalGames' : 'matches';
                                      await updateDoc(doc(db, collectionName, match.id), { resultStatus: 'confirmed' });
                                      setMyMatches(myMatches.map(m => m.id === match.id ? { ...m, resultStatus: 'confirmed' } : m));
                                      showToast("Resultado confirmado!", "success");
                                    }}
                                    className="text-xs bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1.5 rounded-md font-medium transition-colors"
                                  >
                                    Confirmar
                                  </button>
                                  <button 
                                    onClick={() => setContestModal({ matchId: match.id })}
                                    className="text-xs bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-md font-medium transition-colors"
                                  >
                                    Contestar
                                  </button>
                                </div>
                                {match.resultSubmittedAt && (
                                  <CountdownTimer submittedAt={match.resultSubmittedAt} />
                                )}
                              </div>
                            )}
                            {match.resultStatus === 'contested' && (
                              <div className="flex flex-col items-end gap-1">
                                <span className="text-xs text-red-600 font-medium">Resultado Contestado</span>
                                {match.contestReason && (
                                  <span className="text-[10px] text-zinc-500 max-w-[200px] text-right break-words">
                                    Motivo: {match.contestReason}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {match.status === 'completed' && (
                      <div className="mt-2 text-right">
                        {((myTeamId === match.homeTeamId && match.awayTeamRating === undefined) || 
                          (myTeamId === match.awayTeamId && match.homeTeamRating === undefined)) && (
                          <button 
                            onClick={() => setRatingModal({ matchId: match.id })}
                            className="text-xs bg-indigo-500 hover:bg-indigo-600 text-white px-3 py-1.5 rounded-md font-medium transition-colors"
                          >
                            Avaliar Jogo
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
      </div>

      {/* Modals */}
      {confirmDeleteAvail && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-xl font-bold text-zinc-900 mb-2">Excluir Disponibilidade</h3>
            <p className="text-zinc-600 mb-6">
              Tem certeza que deseja excluir esta disponibilidade? Esta ação não pode ser desfeita.
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setConfirmDeleteAvail(null)}
                className="px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={confirmDeleteAvailabilityAction}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmMatch && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
            <h3 className="text-xl font-bold text-zinc-900 mb-2">Confirmar Agendamento</h3>
            <p className="text-zinc-600 mb-6">
              Deseja solicitar um jogo contra <strong className="text-zinc-900">{confirmMatch.avail.teamName}</strong> no dia <strong>{selectedDateStr.split('-').reverse().join('/')}</strong> às <strong>{confirmMatch.avail.startTime}</strong>?
            </p>

            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setConfirmMatch(null)}
                className="px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
              >
                Não
              </button>
              <button 
                onClick={confirmScheduleMatch}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg transition-colors"
              >
                Sim
              </button>
            </div>
          </div>
        </div>
      )}

      {contestModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
            <h3 className="text-xl font-bold text-zinc-900 mb-4 text-center">Contestar Resultado</h3>
            <p className="text-sm text-zinc-500 mb-4 text-center">
              Por favor, informe o motivo da contestação. O time adversário será notificado para alinhar o resultado correto.
            </p>
            
            {contestModal.quadroIndex !== undefined && (
              <div className="flex items-center justify-center gap-4 mb-6">
                <div className="flex flex-col items-center gap-2">
                  <span className="text-sm font-semibold text-zinc-700">Mandante</span>
                  <input
                    type="number"
                    min="0"
                    value={contestHomeScore}
                    onChange={(e) => setContestHomeScore(e.target.value)}
                    className="w-16 h-12 text-center text-xl font-bold border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                    placeholder="0"
                  />
                </div>
                <span className="text-xl font-bold text-zinc-400">X</span>
                <div className="flex flex-col items-center gap-2">
                  <span className="text-sm font-semibold text-zinc-700">Visitante</span>
                  <input
                    type="number"
                    min="0"
                    value={contestAwayScore}
                    onChange={(e) => setContestAwayScore(e.target.value)}
                    className="w-16 h-12 text-center text-xl font-bold border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                    placeholder="0"
                  />
                </div>
              </div>
            )}

            <textarea
              value={contestReason}
              onChange={(e) => setContestReason(e.target.value)}
              placeholder="Ex: O placar do 2º quadro foi 3x1 para nós, não 2x1."
              className="w-full h-32 p-3 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-none mb-6"
              maxLength={500}
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setContestModal(null);
                  setContestReason('');
                  setContestHomeScore('');
                  setContestAwayScore('');
                }}
                className="flex-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 px-4 py-2 rounded-lg font-medium transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleContestSubmit}
                disabled={!contestReason.trim() || (contestModal.quadroIndex !== undefined && (contestHomeScore === '' || contestAwayScore === ''))}
                className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                Enviar Contestação
              </button>
            </div>
          </div>
        </div>
      )}

      {scoreModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl my-8">
            <h3 className="text-xl font-bold text-zinc-900 mb-6 text-center">Informar Resultado</h3>
            
            {(() => {
              const match = myMatches.find(m => m.id === scoreModal.matchId);
              if (!match) return null;
              
              return (
                <div className="space-y-6">
                  {/* Teams Header */}
                  <div className="flex items-center justify-between bg-zinc-50 p-4 rounded-xl">
                    <div className="flex flex-col items-center gap-2 w-1/3">
                      {match.homeTeamLogo ? (
                        <img src={match.homeTeamLogo} alt={match.homeTeamName} className="w-12 h-12 rounded-full object-cover border border-zinc-200" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-zinc-200 flex items-center justify-center border border-zinc-300">
                          <Shield className="w-6 h-6 text-zinc-400" />
                        </div>
                      )}
                      <span className="text-sm font-semibold text-center line-clamp-2">{match.homeTeamName}</span>
                      <span className="text-xs text-zinc-500">Mandante</span>
                    </div>
                    
                    <div className="text-lg font-bold text-zinc-400">VS</div>
                    
                    <div className="flex flex-col items-center gap-2 w-1/3">
                      {match.awayTeamLogo ? (
                        <img src={match.awayTeamLogo} alt={match.awayTeamName} className="w-12 h-12 rounded-full object-cover border border-zinc-200" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-zinc-200 flex items-center justify-center border border-zinc-300">
                          <Shield className="w-6 h-6 text-zinc-400" />
                        </div>
                      )}
                      <span className="text-sm font-semibold text-center line-clamp-2">{match.awayTeamName}</span>
                      <span className="text-xs text-zinc-500">Visitante</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      id="isWO" 
                      checked={isWO} 
                      onChange={(e) => setIsWO(e.target.checked)}
                      className="w-4 h-4 text-emerald-600 rounded border-zinc-300 focus:ring-emerald-500"
                    />
                    <label htmlFor="isWO" className="text-sm font-medium text-zinc-700">Foi W.O.?</label>
                  </div>

                  {isWO ? (
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 mb-1">Qual time não compareceu?</label>
                      <select 
                        value={woTeamId}
                        onChange={(e) => setWoTeamId(e.target.value)}
                        className="w-full p-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                      >
                        <option value="">Selecione o time</option>
                        <option value={match.homeTeamId}>{match.homeTeamName}</option>
                        <option value={match.awayTeamId}>{match.awayTeamName}</option>
                      </select>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-zinc-700">Quantidade de Quadros</label>
                        <select
                          value={quadros.length}
                          onChange={(e) => {
                            const count = parseInt(e.target.value);
                            const newQuadros = [...quadros];
                            if (count > newQuadros.length) {
                              for (let i = newQuadros.length; i < count; i++) {
                                newQuadros.push({ homeScore: '', awayScore: '' });
                              }
                            } else {
                              newQuadros.splice(count);
                            }
                            setQuadros(newQuadros);
                          }}
                          className="p-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-sm"
                        >
                          {[1, 2, 3, 4, 5].map(n => (
                            <option key={n} value={n}>{n} Quadro{n > 1 ? 's' : ''}</option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-3">
                        {quadros.map((quadro, index) => (
                          <div key={index} className="bg-zinc-50 p-3 rounded-lg border border-zinc-200">
                            <h4 className="text-xs font-semibold text-zinc-500 mb-2 uppercase tracking-wider">{index + 1}º Quadro</h4>
                            <div className="flex items-center justify-center gap-4">
                              <input 
                                type="number" 
                                min="0"
                                value={quadro.homeScore}
                                onChange={e => {
                                  const newQuadros = [...quadros];
                                  newQuadros[index].homeScore = e.target.value;
                                  setQuadros(newQuadros);
                                }}
                                className="w-16 p-2 text-center text-lg font-bold border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                                placeholder="0"
                              />
                              <span className="text-zinc-400 font-medium">X</span>
                              <input 
                                type="number" 
                                min="0"
                                value={quadro.awayScore}
                                onChange={e => {
                                  const newQuadros = [...quadros];
                                  newQuadros[index].awayScore = e.target.value;
                                  setQuadros(newQuadros);
                                }}
                                className="w-16 p-2 text-center text-lg font-bold border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                                placeholder="0"
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="space-y-4 pt-4 border-t border-zinc-200">
                        <div>
                          <label className="block text-sm font-medium text-zinc-700 mb-2">Avaliação do Adversário</label>
                          <div className="flex gap-2">
                            {[1, 2, 3, 4, 5].map(star => (
                              <button
                                key={star}
                                onClick={() => setOpponentRating(star)}
                                className={`p-1 transition-colors ${opponentRating >= star ? 'text-yellow-400' : 'text-zinc-300 hover:text-yellow-200'}`}
                              >
                                <svg className="w-8 h-8 fill-current" viewBox="0 0 24 24">
                                  <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                                </svg>
                              </button>
                            ))}
                          </div>
                        </div>

                        {match.homeTeamId !== myTeamId && (
                          <div>
                            <label className="block text-sm font-medium text-zinc-700 mb-2">Avaliação da Quadra/Campo</label>
                            <div className="flex gap-2">
                              {[1, 2, 3, 4, 5].map(star => (
                                <button
                                  key={star}
                                  onClick={() => setCourtRating(star)}
                                  className={`p-1 transition-colors ${courtRating >= star ? 'text-yellow-400' : 'text-zinc-300 hover:text-yellow-200'}`}
                                >
                                  <svg className="w-8 h-8 fill-current" viewBox="0 0 24 24">
                                    <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                                  </svg>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end gap-3 pt-4">
                    <button 
                      onClick={() => {
                        setScoreModal(null);
                        setQuadros([{homeScore: '', awayScore: ''}]);
                        setOpponentRating(0);
                        setCourtRating(0);
                        setIsWO(false);
                        setWoTeamId('');
                      }}
                      className="px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
                    >
                      Cancelar
                    </button>
                    <button 
                      onClick={async () => {
                        if (isWO && woTeamId) {
                          const homeScoreVal = woTeamId === match.homeTeamId ? 0 : 3;
                          const awayScoreVal = woTeamId === match.awayTeamId ? 0 : 3;

                          const collectionName = match.isFestival ? 'festivalGames' : 'matches';

                          await updateDoc(doc(db, collectionName, scoreModal.matchId), {
                            status: 'completed',
                            homeScore: homeScoreVal,
                            awayScore: awayScoreVal,
                            woTeamId: woTeamId,
                            resultStatus: 'pending_confirmation',
                            resultSubmittedBy: myTeamId,
                            resultSubmittedAt: new Date().toISOString()
                          });
                          
                          setMyMatches(myMatches.map(m => m.id === scoreModal.matchId ? { ...m, status: 'completed', homeScore: homeScoreVal, awayScore: awayScoreVal, woTeamId, resultStatus: 'pending_confirmation', resultSubmittedBy: myTeamId, resultSubmittedAt: new Date().toISOString() } : m));
                          
                          const opponentTeamId = match.homeTeamId === myTeamId ? match.awayTeamId : match.homeTeamId;
                          const opponentTeamSnap = await getDoc(doc(db, 'teams', opponentTeamId));
                          if (opponentTeamSnap.exists()) {
                            const opponentTeamData = opponentTeamSnap.data();
                            const opponentManagerId = opponentTeamData.managerId;
                            await sendNotification({
                              userId: opponentManagerId,
                              title: 'Resultado de Jogo',
                              message: `O time ${myTeam?.name} enviou o resultado do jogo (W.O.). Acesse para confirmar.`,
                              link: '/calendar',
                              type: 'info',
                              userPhone: opponentTeamData.whatsapp
                            });
                          }

                          setScoreModal(null);
                          setQuadros([{homeScore: '', awayScore: ''}]);
                          setOpponentRating(0);
                          setCourtRating(0);
                          setIsWO(false);
                          setWoTeamId('');
                          showToast("Resultado salvo com sucesso!", "success");
                        } else if (!isWO) {
                          // Validate quadros
                          const allFilled = quadros.every(q => q.homeScore !== '' && q.awayScore !== '');
                          if (!allFilled) {
                            showToast("Preencha todos os placares", "error");
                            return;
                          }

                          // Calculate aggregate score based on points (Win=3, Draw=1, Loss=0)
                          let totalHomePoints = 0;
                          let totalAwayPoints = 0;
                          
                          const parsedQuadros = quadros.map(q => {
                            const hs = parseInt(q.homeScore);
                            const as = parseInt(q.awayScore);
                            
                            if (hs > as) {
                              totalHomePoints += 3;
                            } else if (as > hs) {
                              totalAwayPoints += 3;
                            } else {
                              totalHomePoints += 1;
                              totalAwayPoints += 1;
                            }
                            
                            return { 
                              homeScore: hs, 
                              awayScore: as, 
                              status: 'pending_confirmation',
                              submittedBy: myTeamId,
                              submittedAt: new Date().toISOString()
                            };
                          });

                          const collectionName = match.isFestival ? 'festivalGames' : 'matches';
                          
                          const ratingData: any = {};
                          if (match.homeTeamId === myTeamId) {
                            ratingData.awayTeamRating = opponentRating;
                          } else {
                            ratingData.homeTeamRating = opponentRating;
                            ratingData.courtRating = courtRating;
                          }

                          await updateDoc(doc(db, collectionName, scoreModal.matchId), {
                            status: 'completed',
                            homeScore: totalHomePoints,
                            awayScore: totalAwayPoints,
                            quadros: parsedQuadros,
                            ...ratingData,
                            resultStatus: 'pending_confirmation',
                            resultSubmittedBy: myTeamId,
                            resultSubmittedAt: new Date().toISOString()
                          });
                          
                          setMyMatches(myMatches.map(m => m.id === scoreModal.matchId ? { 
                            ...m, 
                            status: 'completed', 
                            homeScore: totalHomePoints, 
                            awayScore: totalAwayPoints, 
                            quadros: parsedQuadros,
                            ...ratingData,
                            resultStatus: 'pending_confirmation', 
                            resultSubmittedBy: myTeamId, 
                            resultSubmittedAt: new Date().toISOString() 
                          } : m));
                          
                          const opponentTeamId = match.homeTeamId === myTeamId ? match.awayTeamId : match.homeTeamId;
                          const opponentTeamSnap = await getDoc(doc(db, 'teams', opponentTeamId));
                          if (opponentTeamSnap.exists()) {
                            const opponentTeamData = opponentTeamSnap.data();
                            const opponentManagerId = opponentTeamData.managerId;
                            await sendNotification({
                              userId: opponentManagerId,
                              title: 'Resultado de Jogo',
                              message: `O time ${myTeam?.name} enviou o resultado do jogo. Acesse para confirmar.`,
                              link: '/calendar',
                              type: 'info',
                              userPhone: opponentTeamData.whatsapp
                            });
                          }

                          setScoreModal(null);
                          setQuadros([{homeScore: '', awayScore: ''}]);
                          setOpponentRating(0);
                          setCourtRating(0);
                          setIsWO(false);
                          setWoTeamId('');
                          showToast("Resultado salvo com sucesso!", "success");
                        }
                      }}
                      className="px-4 py-2 text-sm font-medium text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg transition-colors"
                    >
                      Salvar
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Rating Modal */}
      {ratingModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-zinc-900 mb-6">Avaliar Jogo</h3>
            
            {(() => {
              const match = myMatches.find(m => m.id === ratingModal.matchId);
              if (!match) return null;
              
              return (
                <div className="space-y-6">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 mb-2">Avaliação do Adversário</label>
                      <div className="flex gap-2">
                        {[1, 2, 3, 4, 5].map(star => (
                          <button
                            key={star}
                            onClick={() => setOpponentRating(star)}
                            className={`p-1 transition-colors ${opponentRating >= star ? 'text-yellow-400' : 'text-zinc-300 hover:text-yellow-200'}`}
                          >
                            <svg className="w-8 h-8 fill-current" viewBox="0 0 24 24">
                              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                            </svg>
                          </button>
                        ))}
                      </div>
                    </div>

                    {match.homeTeamId !== myTeamId && (
                      <div>
                        <label className="block text-sm font-medium text-zinc-700 mb-2">Avaliação da Quadra/Campo</label>
                        <div className="flex gap-2">
                          {[1, 2, 3, 4, 5].map(star => (
                            <button
                              key={star}
                              onClick={() => setCourtRating(star)}
                              className={`p-1 transition-colors ${courtRating >= star ? 'text-yellow-400' : 'text-zinc-300 hover:text-yellow-200'}`}
                            >
                              <svg className="w-8 h-8 fill-current" viewBox="0 0 24 24">
                                <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                              </svg>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-3 pt-4">
                    <button 
                      onClick={() => {
                        setRatingModal(null);
                        setOpponentRating(0);
                        setCourtRating(0);
                      }}
                      className="px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
                    >
                      Cancelar
                    </button>
                    <button 
                      onClick={async () => {
                        const collectionName = match.isFestival ? 'festivalGames' : 'matches';
                        
                        const ratingData: any = {};
                        if (match.homeTeamId === myTeamId) {
                          ratingData.awayTeamRating = opponentRating;
                        } else {
                          ratingData.homeTeamRating = opponentRating;
                          ratingData.courtRating = courtRating;
                        }

                        await updateDoc(doc(db, collectionName, ratingModal.matchId), ratingData);
                        
                        setMyMatches(myMatches.map(m => m.id === ratingModal.matchId ? { 
                          ...m, 
                          ...ratingData
                        } : m));
                        
                        setRatingModal(null);
                        setOpponentRating(0);
                        setCourtRating(0);
                        showToast("Avaliação salva com sucesso!", "success");
                      }}
                      className="px-4 py-2 text-sm font-medium text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg transition-colors"
                    >
                      Salvar Avaliação
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Subscription Modal */}
      {showSubscriptionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
            <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center text-amber-600 mb-4 mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold text-center text-zinc-900 mb-2">Assinatura Necessária</h3>
            <p className="text-zinc-600 text-center mb-6">
              Para agendar jogos, você precisa ter uma assinatura ativa. Escolha o plano ideal para o seu time.
            </p>
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => {
                  setShowSubscriptionModal(false);
                  navigate('/subscription');
                }}
                className="w-full py-3 px-4 bg-[#009c3b] hover:bg-[#009c3b]/90 text-white font-bold rounded-xl transition-colors"
              >
                Ver Planos de Assinatura
              </button>
              <button 
                onClick={() => setShowSubscriptionModal(false)}
                className="w-full py-3 px-4 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-medium rounded-xl transition-colors"
              >
                Agora não
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
