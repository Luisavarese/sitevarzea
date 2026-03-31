import { useState, useEffect, FormEvent, ChangeEvent } from 'react';
import { collection, query, getDocs, addDoc, updateDoc, deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Shield, Plus, Image as ImageIcon, Trash2, Edit2, Trophy, Check, X, Users, Activity, Calendar as CalendarIcon, Upload, DollarSign, Search as SearchIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { format, addMonths, isSameMonth, startOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const planPrices: Record<string, { price: number, months: number }> = {
  'premium_mensal': { price: 1.05, months: 1 },
  'premium_trimestral': { price: 1.06, months: 3 },
  'premium_semestral': { price: 1.07, months: 6 },
  'premium_anual': { price: 1.08, months: 12 },
  'visitante_mensal': { price: 15.00, months: 1 },
  'visitante_trimestral': { price: 39.90, months: 3 },
  'visitante_semestral': { price: 69.90, months: 6 },
  'visitante_anual': { price: 119.90, months: 12 },
  'mandante_mensal': { price: 30.00, months: 1 },
  'mandante_trimestral': { price: 79.90, months: 3 },
  'mandante_semestral': { price: 139.90, months: 6 },
  'mandante_anual': { price: 239.90, months: 12 },
};

interface Banner {
  id: string;
  imageUrl: string;
  link: string;
  type: 'promo';
  active: boolean;
  order: number;
}

interface Competition {
  id: string;
  name: string;
  type: 'league' | 'cup' | 'festival';
  startDate: string;
  endDate: string;
  status: 'upcoming' | 'ongoing' | 'completed';
  festivalGames?: { startTime: string; endTime: string }[];
  entryFee?: string;
  prize?: string;
}

interface Team {
  id: string;
  name: string;
  managerName: string;
  whatsapp: string;
  city: string;
  state: string;
  gameType: string;
  subscription?: {
    status: string;
    expiresAt: string;
    cycleId?: string;
    plan?: string;
  };
}

interface Match {
  id: string;
  date: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName?: string;
  awayTeamName?: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  cancelReason?: string;
  collectionName?: string;
  rankingStatus?: 'contabilizado' | 'descartado' | 'mandante' | 'visitante';
}

export function AdminPanel() {
  const { user } = useAuth();
  const [banners, setBanners] = useState<Banner[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);

  // Metrics & Logo
  const [metrics, setMetrics] = useState({
    totalTeams: 0,
    activeTeams: 0,
    activeHomeTeams: 0,
    activeAwayTeams: 0,
    inactiveTeams: 0,
    totalMatches: 0,
    matchesToday: 0
  });
  const [siteLogo, setSiteLogo] = useState<string | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  // Teams & Matches Data
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [allMatches, setAllMatches] = useState<Match[]>([]);
  
  // Modals for Teams
  const [teamsModalTitle, setTeamsModalTitle] = useState('');
  const [teamsModalList, setTeamsModalList] = useState<Team[] | null>(null);

  // Match Management
  const [matchToCancel, setMatchToCancel] = useState<Match | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelingMatch, setIsCancelingMatch] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [matchSearch, setMatchSearch] = useState('');
  const matchesPerPage = 10;

  // Financial Control
  const [annualFeeHome, setAnnualFeeHome] = useState(120); // Default R$ 120
  const [annualFeeAway, setAnnualFeeAway] = useState(120); // Default R$ 120
  const [financialHistory, setFinancialHistory] = useState<{ month: string, count: number, revenue: number }[]>([]);

  // Forms
  const [isAddingBanner, setIsAddingBanner] = useState(false);
  const [bannerForm, setBannerForm] = useState({ imageUrl: '', link: '', type: 'promo' as 'promo', active: true, order: 0 });

  const [isAddingComp, setIsAddingComp] = useState(false);
  const [compForm, setCompForm] = useState<{
    name: string;
    type: 'league' | 'cup' | 'festival';
    startDate: string;
    endDate: string;
    status: 'upcoming' | 'ongoing' | 'completed';
    festivalGames: { startTime: string; endTime: string }[];
    entryFee: string;
    prize: string;
  }>({ 
    name: '', 
    type: 'league', 
    startDate: '', 
    endDate: '', 
    status: 'upcoming',
    festivalGames: [],
    entryFee: '',
    prize: ''
  });

  const [rankingConfig, setRankingConfig] = useState({
    startDate: '',
    endDate: '',
    prizes: {
      nacional: '',
      estadual: '',
      municipal: '',
      zonaLeste: '',
      zonaOeste: '',
      zonaNorte: '',
      zonaSul: '',
      zonaCentro: ''
    }
  });
  const [isSavingRanking, setIsSavingRanking] = useState(false);

  // Modals & Toasts
  const [confirmDeleteBanner, setConfirmDeleteBanner] = useState<string | null>(null);
  const [confirmDeleteComp, setConfirmDeleteComp] = useState<string | null>(null);
  const [confirmDeleteHistory, setConfirmDeleteHistory] = useState(false);
  const [confirmDeleteAllTeams, setConfirmDeleteAllTeams] = useState(false);
  const [confirmDeleteRanking, setConfirmDeleteRanking] = useState(false);
  const [isDeletingHistory, setIsDeletingHistory] = useState(false);
  const [isDeletingAllTeams, setIsDeletingAllTeams] = useState(false);
  const [toastMessage, setToastMessage] = useState<{title: string, type: 'success' | 'error'} | null>(null);

  const showToast = (title: string, type: 'success' | 'error') => {
    setToastMessage({ title, type });
    setTimeout(() => setToastMessage(null), 3000);
  };

  useEffect(() => {
    async function fetchData() {
      try {
        const [bannersSnap, compsSnap, teamsSnap, matchesSnap, festivalSnap, settingsSnap, rankingSnap] = await Promise.all([
          getDocs(collection(db, 'banners')),
          getDocs(collection(db, 'competitions')),
          getDocs(collection(db, 'teams')),
          getDocs(collection(db, 'matches')),
          getDocs(collection(db, 'festivalGames')),
          getDoc(doc(db, 'settings', 'general')),
          getDoc(doc(db, 'settings', 'ranking'))
        ]);
        
        setBanners(bannersSnap.docs.map(d => ({ id: d.id, ...d.data() } as Banner)));
        setCompetitions(compsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Competition)));

        if (settingsSnap.exists()) {
          setSiteLogo(settingsSnap.data().logoUrl || null);
          if (settingsSnap.data().annualFeeHome) setAnnualFeeHome(settingsSnap.data().annualFeeHome);
          if (settingsSnap.data().annualFeeAway) setAnnualFeeAway(settingsSnap.data().annualFeeAway);
        }

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

        const teams = teamsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Team));
        const regularMatches = matchesSnap.docs.map(d => ({ id: d.id, collectionName: 'matches', ...d.data() } as Match));
        const festivalMatches = festivalSnap.docs.map(d => ({ id: d.id, collectionName: 'festivalGames', ...d.data() } as Match));
        
        let combinedMatches = [...regularMatches, ...festivalMatches].map(match => {
          const homeTeam = teams.find(t => t.id === match.homeTeamId);
          const awayTeam = teams.find(t => t.id === match.awayTeamId);
          return {
            ...match,
            homeTeamName: homeTeam?.name || match.homeTeamName || 'Time Excluído',
            awayTeamName: awayTeam?.name || match.awayTeamName || 'Time Excluído'
          };
        });

        // Calculate ranking status
        const teamWeeksPlayed = new Map<string, Set<string>>();
        const sortedForRanking = [...combinedMatches].sort((a, b) => {
          const timeA = a.date && !isNaN(new Date(a.date).getTime()) ? new Date(a.date).getTime() : 0;
          const timeB = b.date && !isNaN(new Date(b.date).getTime()) ? new Date(b.date).getTime() : 0;
          return timeA - timeB; // Ascending for chronological processing
        });

        sortedForRanking.forEach(match => {
          if (match.status !== 'completed' || match.collectionName === 'festivalGames' || (match as any).isFestival) {
            match.rankingStatus = 'descartado';
            return;
          }

          if (!match.date) {
            match.rankingStatus = 'descartado';
            return;
          }

          // Filter by ranking competition dates if configured
          if (rankingSnap.exists()) {
            const rData = rankingSnap.data();
            if (rData.startDate && match.date < rData.startDate) {
              match.rankingStatus = 'descartado';
              return;
            }
            if (rData.endDate && match.date > rData.endDate) {
              match.rankingStatus = 'descartado';
              return;
            }
          }

          const weekStart = startOfWeek(new Date(match.date + 'T12:00:00Z'), { weekStartsOn: 1 });
          const weekKey = format(weekStart, 'yyyy-MM-dd');
          
          if (!teamWeeksPlayed.has(match.homeTeamId)) teamWeeksPlayed.set(match.homeTeamId, new Set());
          if (!teamWeeksPlayed.has(match.awayTeamId)) teamWeeksPlayed.set(match.awayTeamId, new Set());

          const homePlayedThisWeek = teamWeeksPlayed.get(match.homeTeamId)!.has(weekKey);
          const awayPlayedThisWeek = teamWeeksPlayed.get(match.awayTeamId)!.has(weekKey);

          if (homePlayedThisWeek && awayPlayedThisWeek) {
            match.rankingStatus = 'descartado';
          } else if (!homePlayedThisWeek && !awayPlayedThisWeek) {
            match.rankingStatus = 'contabilizado';
            teamWeeksPlayed.get(match.homeTeamId)!.add(weekKey);
            teamWeeksPlayed.get(match.awayTeamId)!.add(weekKey);
          } else if (!homePlayedThisWeek) {
            match.rankingStatus = 'mandante';
            teamWeeksPlayed.get(match.homeTeamId)!.add(weekKey);
          } else {
            match.rankingStatus = 'visitante';
            teamWeeksPlayed.get(match.awayTeamId)!.add(weekKey);
          }
        });

        // Sort back to descending for display
        combinedMatches = sortedForRanking.sort((a, b) => {
          const timeA = a.date && !isNaN(new Date(a.date).getTime()) ? new Date(a.date).getTime() : 0;
          const timeB = b.date && !isNaN(new Date(b.date).getTime()) ? new Date(b.date).getTime() : 0;
          return timeB - timeA;
        });

        setAllTeams(teams);
        setAllMatches(combinedMatches);

        const now = new Date();
        const activeTeamsList = teams.filter(t => {
          const sub = t.subscription;
          if (!sub || sub.status !== 'active' || !sub.expiresAt) return false;
          const expiresDate = new Date(sub.expiresAt);
          return !isNaN(expiresDate.getTime()) && expiresDate > now;
        });
        
        const activeHomeTeams = activeTeamsList.filter(t => t.subscription?.plan?.includes('mandante') || t.subscription?.plan?.includes('premium')).length;
        const activeAwayTeams = activeTeamsList.filter(t => t.subscription?.plan?.includes('visitante')).length;

        const todayStr = now.toISOString().split('T')[0];
        const matchesToday = combinedMatches.filter(m => m.date && m.date.startsWith(todayStr)).length;

        const history = [];
        for (let i = 5; i >= 0; i--) {
          const targetMonth = addMonths(now, -i);
          let count = 0;
          let revenue = 0;
          
          teams.forEach(team => {
            const sub = team.subscription as any;
            if (sub && sub.status === 'active' && sub.plan && sub.expiresAt) {
              const planInfo = planPrices[sub.plan];
              if (planInfo) {
                const expiresDate = new Date(sub.expiresAt);
                const startedDate = sub.startedAt ? new Date(sub.startedAt) : addMonths(expiresDate, -planInfo.months);
                
                if (!isNaN(expiresDate.getTime()) && !isNaN(startedDate.getTime())) {
                  let currentPaymentDate = startedDate;
                  while (currentPaymentDate < expiresDate) {
                    if (isSameMonth(currentPaymentDate, targetMonth)) {
                      count++;
                      revenue += planInfo.price;
                    }
                    currentPaymentDate = addMonths(currentPaymentDate, planInfo.months);
                  }
                }
              }
            }
          });
          
          history.push({
            month: format(targetMonth, 'MMM/yy', { locale: ptBR }),
            count,
            revenue
          });
        }
        setFinancialHistory(history);

        setMetrics({
          totalTeams: teams.length,
          activeTeams: activeTeamsList.length,
          activeHomeTeams,
          activeAwayTeams,
          inactiveTeams: teams.length - activeTeamsList.length,
          totalMatches: combinedMatches.length,
          matchesToday
        });

      } catch (error) {
        console.error("Error fetching admin data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1200;
        const MAX_HEIGHT = 600;
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
        
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        setBannerForm(prev => ({ ...prev, imageUrl: dataUrl }));
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleAddBanner = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const newBanner = {
        ...bannerForm,
        createdAt: new Date().toISOString()
      };
      const docRef = await addDoc(collection(db, 'banners'), newBanner);
      setBanners([...banners, { id: docRef.id, ...newBanner }]);
      setIsAddingBanner(false);
      setBannerForm({ imageUrl: '', link: '', type: 'promo', active: true, order: 0 });
      showToast("Banner adicionado com sucesso!", "success");
    } catch (error) {
      console.error("Error adding banner:", error);
      showToast("Erro ao adicionar banner.", "error");
    }
  };

  const handleDeleteBannerClick = (id: string) => {
    setConfirmDeleteBanner(id);
  };

  const confirmDeleteBannerAction = async () => {
    if (!confirmDeleteBanner) return;
    try {
      await deleteDoc(doc(db, 'banners', confirmDeleteBanner));
      setBanners(banners.filter(b => b.id !== confirmDeleteBanner));
      setConfirmDeleteBanner(null);
      showToast("Banner removido com sucesso!", "success");
    } catch (error) {
      console.error("Error deleting banner:", error);
      showToast("Erro ao remover banner.", "error");
    }
  };

  const handleAddComp = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    try {
      const newComp: any = {
        name: compForm.name,
        type: compForm.type,
        startDate: compForm.startDate,
        endDate: compForm.endDate,
        status: compForm.status,
        adminId: user.uid,
        createdAt: new Date().toISOString()
      };

      if (compForm.type === 'festival') {
        newComp.entryFee = compForm.entryFee;
        newComp.prize = compForm.prize;
      }

      const docRef = await addDoc(collection(db, 'competitions'), newComp);

      if (compForm.type === 'festival') {
        // Create festival games
        for (const game of compForm.festivalGames) {
          await addDoc(collection(db, 'festivalGames'), {
            competitionId: docRef.id,
            date: compForm.startDate,
            startTime: game.startTime,
            endTime: game.endTime,
            homeTeamId: null,
            homeTeamName: null,
            awayTeamId: null,
            awayTeamName: null,
            createdAt: new Date().toISOString()
          });
        }
      }

      setCompetitions([...competitions, { id: docRef.id, ...newComp }]);
      setIsAddingComp(false);
      setCompForm({ name: '', type: 'league', startDate: '', endDate: '', status: 'upcoming', festivalGames: [], entryFee: '', prize: '' });
      showToast("Competição adicionada com sucesso!", "success");
    } catch (error) {
      console.error("Error adding competition:", error);
      showToast("Erro ao adicionar competição.", "error");
    }
  };

  const addFestivalGame = () => {
    setCompForm(prev => ({
      ...prev,
      festivalGames: [...prev.festivalGames, { startTime: '', endTime: '' }]
    }));
  };

  const updateFestivalGame = (index: number, field: 'startTime' | 'endTime', value: string) => {
    setCompForm(prev => {
      const newGames = [...prev.festivalGames];
      newGames[index] = { ...newGames[index], [field]: value };
      return { ...prev, festivalGames: newGames };
    });
  };

  const removeFestivalGame = (index: number) => {
    setCompForm(prev => ({
      ...prev,
      festivalGames: prev.festivalGames.filter((_, i) => i !== index)
    }));
  };

  const handleDeleteCompClick = (id: string) => {
    setConfirmDeleteComp(id);
  };

  const confirmDeleteCompAction = async () => {
    if (!confirmDeleteComp) return;
    try {
      await deleteDoc(doc(db, 'competitions', confirmDeleteComp));
      setCompetitions(competitions.filter(c => c.id !== confirmDeleteComp));
      setConfirmDeleteComp(null);
      showToast("Competição removida com sucesso!", "success");
    } catch (error) {
      console.error("Error deleting competition:", error);
      showToast("Erro ao remover competição.", "error");
    }
  };

  const handleLogoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingLogo(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        const MAX_SIZE = 200;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_SIZE) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        
        const dataUrl = canvas.toDataURL('image/png', 0.9);
        
        try {
          await setDoc(doc(db, 'settings', 'general'), { logoUrl: dataUrl }, { merge: true });
          setSiteLogo(dataUrl);
          showToast("Logo atualizada com sucesso!", "success");
          
          // Dispatch event to update Layout
          window.dispatchEvent(new CustomEvent('siteLogoUpdated', { detail: dataUrl }));
        } catch (error) {
          console.error("Error updating logo:", error);
          showToast("Erro ao atualizar logo.", "error");
        } finally {
          setIsUploadingLogo(false);
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleDeleteHistory = async () => {
    setIsDeletingHistory(true);
    try {
      const collectionsToDelete = ['matches', 'festivalGames', 'notifications', 'messages'];
      
      for (const colName of collectionsToDelete) {
        const snap = await getDocs(collection(db, colName));
        for (const docSnap of snap.docs) {
          await deleteDoc(doc(db, colName, docSnap.id));
        }
      }

      showToast("Histórico de jogos apagado com sucesso.", "success");
      setConfirmDeleteHistory(false);
      
      setMetrics(prev => ({ ...prev, totalMatches: 0, matchesToday: 0 }));
    } catch (error) {
      console.error("Error deleting history:", error);
      showToast("Erro ao apagar histórico.", "error");
    } finally {
      setIsDeletingHistory(false);
    }
  };

  const handleDeleteAllTeams = async () => {
    setIsDeletingAllTeams(true);
    try {
      const snap = await getDocs(collection(db, 'teams'));
      for (const docSnap of snap.docs) {
        await deleteDoc(doc(db, 'teams', docSnap.id));
      }

      showToast("Todos os times foram apagados com sucesso.", "success");
      setConfirmDeleteAllTeams(false);
      
      setAllTeams([]);
      setMetrics(prev => ({ 
        ...prev, 
        totalTeams: 0, 
        activeTeams: 0, 
        activeHomeTeams: 0, 
        activeAwayTeams: 0, 
        inactiveTeams: 0 
      }));
    } catch (error) {
      console.error("Error deleting all teams:", error);
      showToast("Erro ao apagar times.", "error");
    } finally {
      setIsDeletingAllTeams(false);
    }
  };

  const openTeamsModal = (title: string, filterFn: (t: Team) => boolean) => {
    setTeamsModalTitle(title);
    setTeamsModalList(allTeams.filter(filterFn));
  };

  const handleCancelMatch = async () => {
    if (!matchToCancel || !cancelReason.trim()) return;
    setIsCancelingMatch(true);
    try {
      const collectionName = matchToCancel.collectionName || 'matches';
      await updateDoc(doc(db, collectionName, matchToCancel.id), {
        status: 'cancelled',
        cancelReason
      });
      showToast("Jogo cancelado com sucesso.", "success");
      setAllMatches(prev => prev.map(m => m.id === matchToCancel.id ? { ...m, status: 'cancelled', cancelReason } : m));
      setMatchToCancel(null);
      setCancelReason('');
    } catch (error) {
      console.error("Error canceling match:", error);
      showToast("Erro ao cancelar jogo.", "error");
    } finally {
      setIsCancelingMatch(false);
    }
  };

  const handleSaveFinancialConfig = async () => {
    try {
      await setDoc(doc(db, 'settings', 'general'), { annualFeeHome, annualFeeAway }, { merge: true });
      showToast("Configuração financeira salva!", "success");
    } catch (error) {
      console.error("Error saving financial config:", error);
      showToast("Erro ao salvar configuração.", "error");
    }
  };

  const handleSaveRankingConfig = async (e: FormEvent) => {
    e.preventDefault();
    setIsSavingRanking(true);
    try {
      await setDoc(doc(db, 'settings', 'ranking'), rankingConfig);
      showToast("Configuração do ranking salva com sucesso!", "success");
    } catch (error) {
      console.error("Error saving ranking config:", error);
      showToast("Erro ao salvar configuração do ranking.", "error");
    } finally {
      setIsSavingRanking(false);
    }
  };

  const handleDeleteRankingConfig = () => {
    setConfirmDeleteRanking(true);
  };

  const confirmDeleteRankingAction = async () => {
    setIsSavingRanking(true);
    try {
      await deleteDoc(doc(db, 'settings', 'ranking'));
      setRankingConfig({
        startDate: '',
        endDate: '',
        prizes: {
          nacional: '',
          estadual: '',
          municipal: '',
          zonaLeste: '',
          zonaOeste: '',
          zonaNorte: '',
          zonaSul: '',
          zonaCentro: ''
        }
      });
      showToast("Ranking excluído com sucesso!", "success");
    } catch (error) {
      console.error("Error deleting ranking config:", error);
      showToast("Erro ao excluir configuração do ranking.", "error");
    } finally {
      setIsSavingRanking(false);
      setConfirmDeleteRanking(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div></div>;
  }

  // Pagination logic
  const filteredMatches = allMatches.filter(match => {
    const searchLower = matchSearch.toLowerCase();
    const homeTeamMatch = match.homeTeamName?.toLowerCase().includes(searchLower);
    const awayTeamMatch = match.awayTeamName?.toLowerCase().includes(searchLower);
    const dateMatch = match.date?.includes(searchLower);
    
    // Format date for search (e.g., DD/MM/YYYY)
    let formattedDateMatch = false;
    if (match.date) {
      try {
        const dateObj = new Date(match.date + 'T12:00:00Z');
        const formatted = format(dateObj, "dd/MM/yyyy", { locale: ptBR });
        formattedDateMatch = formatted.includes(searchLower);
      } catch (e) {
        // ignore
      }
    }

    const statusMatch = match.status?.toLowerCase().includes(searchLower);
    const rankingMatch = match.rankingStatus?.toLowerCase().includes(searchLower);
    return homeTeamMatch || awayTeamMatch || dateMatch || formattedDateMatch || statusMatch || rankingMatch;
  });

  const indexOfLastMatch = currentPage * matchesPerPage;
  const indexOfFirstMatch = indexOfLastMatch - matchesPerPage;
  const currentMatches = filteredMatches.slice(indexOfFirstMatch, indexOfLastMatch);
  const totalPages = Math.ceil(filteredMatches.length / matchesPerPage);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'Data Inválida';
    try {
      // Check if it's already an ISO string with time
      const dateObj = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00`);
      if (isNaN(dateObj.getTime())) return 'Data Inválida';
      return format(dateObj, "dd/MM/yyyy", { locale: ptBR });
    } catch {
      return 'Data Inválida';
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 flex items-center gap-3">
          <Shield className="w-8 h-8 text-emerald-500" />
          Painel de Administração
        </h1>
        <p className="text-zinc-500">Gerencie configurações, banners, competições e veja os indicadores.</p>
      </header>

      {/* Indicadores Operacionais */}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div 
          onClick={() => openTeamsModal('Todos os Times', () => true)}
          className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm flex flex-col justify-between cursor-pointer hover:border-emerald-500 transition-colors"
        >
          <div className="flex items-center gap-2 text-zinc-500 mb-2">
            <Users className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Times Cadastrados</span>
          </div>
          <div className="text-3xl font-bold text-zinc-900">{metrics.totalTeams}</div>
        </div>
        
        <div 
          onClick={() => openTeamsModal('Times Ativos (Mandantes)', t => {
            if (!t.subscription || t.subscription.status !== 'active' || !t.subscription.expiresAt) return false;
            if (!t.subscription.plan?.includes('mandante') && !t.subscription.plan?.includes('premium')) return false;
            const expiresDate = new Date(t.subscription.expiresAt);
            return !isNaN(expiresDate.getTime()) && expiresDate > new Date();
          })}
          className="bg-white p-4 rounded-xl border border-emerald-200 shadow-sm flex flex-col justify-between relative overflow-hidden cursor-pointer hover:border-emerald-500 transition-colors"
        >
          <div className="absolute top-0 right-0 w-16 h-16 bg-emerald-50 rounded-bl-full -z-10"></div>
          <div className="flex items-center gap-2 text-emerald-600 mb-2">
            <Check className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Mandantes Ativos</span>
          </div>
          <div className="text-3xl font-bold text-emerald-600">{metrics.activeHomeTeams}</div>
        </div>

        <div 
          onClick={() => openTeamsModal('Times Ativos (Visitantes)', t => {
            if (!t.subscription || t.subscription.status !== 'active' || !t.subscription.expiresAt) return false;
            if (!t.subscription.plan?.includes('visitante')) return false;
            const expiresDate = new Date(t.subscription.expiresAt);
            return !isNaN(expiresDate.getTime()) && expiresDate > new Date();
          })}
          className="bg-white p-4 rounded-xl border border-emerald-200 shadow-sm flex flex-col justify-between relative overflow-hidden cursor-pointer hover:border-emerald-500 transition-colors"
        >
          <div className="absolute top-0 right-0 w-16 h-16 bg-emerald-50 rounded-bl-full -z-10"></div>
          <div className="flex items-center gap-2 text-emerald-600 mb-2">
            <Check className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Visitantes Ativos</span>
          </div>
          <div className="text-3xl font-bold text-emerald-600">{metrics.activeAwayTeams}</div>
        </div>

        <div 
          onClick={() => openTeamsModal('Times Inativos', t => {
            if (!t.subscription || t.subscription.status !== 'active' || !t.subscription.expiresAt) return true;
            const expiresDate = new Date(t.subscription.expiresAt);
            return isNaN(expiresDate.getTime()) || expiresDate <= new Date();
          })}
          className="bg-white p-4 rounded-xl border border-red-200 shadow-sm flex flex-col justify-between relative overflow-hidden cursor-pointer hover:border-red-500 transition-colors"
        >
          <div className="absolute top-0 right-0 w-16 h-16 bg-red-50 rounded-bl-full -z-10"></div>
          <div className="flex items-center gap-2 text-red-500 mb-2">
            <X className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Times Inativos</span>
          </div>
          <div className="text-3xl font-bold text-red-500">{metrics.inactiveTeams}</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center gap-2 text-zinc-500 mb-2">
            <CalendarIcon className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Jogos Hoje</span>
          </div>
          <div className="text-3xl font-bold text-zinc-900">{metrics.matchesToday}</div>
          <div className="text-xs text-zinc-400 mt-1">Total: {metrics.totalMatches} jogos</div>
        </div>
      </section>

      {/* Controle Financeiro */}
      <section className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
        <h2 className="text-xl font-semibold flex items-center gap-2 text-zinc-800 mb-6">
          <DollarSign className="w-5 h-5 text-emerald-500" />
          Controle Financeiro (Projeção 12 Meses)
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-200">
            <div className="text-sm font-medium text-zinc-500 mb-1">Taxa Anual (Mandante)</div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-400 font-medium">R$</span>
              <input 
                type="number" 
                value={annualFeeHome} 
                onChange={e => setAnnualFeeHome(Number(e.target.value))}
                className="w-full bg-transparent text-2xl font-bold text-zinc-900 outline-none"
              />
            </div>
          </div>
          <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-200">
            <div className="text-sm font-medium text-zinc-500 mb-1">Taxa Anual (Visitante)</div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-400 font-medium">R$</span>
              <input 
                type="number" 
                value={annualFeeAway} 
                onChange={e => setAnnualFeeAway(Number(e.target.value))}
                className="w-full bg-transparent text-2xl font-bold text-zinc-900 outline-none"
              />
            </div>
          </div>
          <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-200 flex flex-col justify-center">
            <div className="text-sm font-medium text-emerald-700 mb-1">Receita Anual Projetada (ARR)</div>
            <div className="text-3xl font-bold text-emerald-600">
              R$ {((metrics.activeHomeTeams * annualFeeHome) + (metrics.activeAwayTeams * annualFeeAway)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        <div className="mb-6">
          <h3 className="text-lg font-medium text-zinc-800 mb-4">Histórico de Assinaturas (Últimos 6 Meses)</h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <ComposedChart data={financialHistory} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#71717a' }} />
                <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#71717a' }} tickFormatter={(value) => `R$ ${value}`} />
                <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#71717a' }} />
                <Tooltip 
                  formatter={(value: number, name: string) => {
                    if (name === 'revenue') return [new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value), 'Receita'];
                    return [value, 'Assinaturas'];
                  }}
                  cursor={{ fill: '#f4f4f5' }}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
                />
                <Legend formatter={(value) => value === 'revenue' ? 'Receita' : 'Assinaturas'} />
                <Bar yAxisId="left" dataKey="revenue" name="revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="count" name="count" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="flex justify-end">
          <button 
            onClick={handleSaveFinancialConfig}
            className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            Salvar Valores
          </button>
        </div>
      </section>

      {/* Gerenciamento de Jogos */}
      <section className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <h2 className="text-xl font-semibold flex items-center gap-2 text-zinc-800">
            <CalendarIcon className="w-5 h-5 text-emerald-500" />
            Gerenciamento de Jogos
          </h2>
          <div className="relative w-full sm:w-72">
            <input
              type="text"
              placeholder="Buscar por time, data, status..."
              value={matchSearch}
              onChange={(e) => {
                setMatchSearch(e.target.value);
                setCurrentPage(1); // Reset page on search
              }}
              className="w-full pl-10 pr-4 py-2 border border-zinc-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
            />
            <SearchIcon className="w-5 h-5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="px-4 py-3 font-medium">Data</th>
                <th className="px-4 py-3 font-medium">Mandante</th>
                <th className="px-4 py-3 font-medium">Visitante</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Ranking</th>
                <th className="px-4 py-3 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {currentMatches.map(match => (
                <tr key={match.id} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-4 py-3 text-zinc-900">
                    {formatDate(match.date)}
                  </td>
                  <td className="px-4 py-3 font-medium text-zinc-900">{match.homeTeamName}</td>
                  <td className="px-4 py-3 font-medium text-zinc-900">{match.awayTeamName}</td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      "px-2 py-1 text-xs font-medium rounded-full",
                      match.status === 'completed' ? "bg-emerald-100 text-emerald-700" :
                      match.status === 'confirmed' ? "bg-blue-100 text-blue-700" :
                      match.status === 'cancelled' ? "bg-red-100 text-red-700" :
                      "bg-yellow-100 text-yellow-700"
                    )}>
                      {match.status === 'completed' ? 'Realizado' : 
                       match.status === 'confirmed' ? 'Confirmado' : 
                       match.status === 'cancelled' ? 'Cancelado' : 'Pendente'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {match.status === 'completed' && match.collectionName !== 'festivalGames' ? (
                      <span className={cn(
                        "px-2 py-1 text-xs font-medium rounded-full",
                        match.rankingStatus === 'contabilizado' ? "bg-emerald-100 text-emerald-700" :
                        match.rankingStatus === 'descartado' ? "bg-red-100 text-red-700" :
                        "bg-blue-100 text-blue-700"
                      )}>
                        {match.rankingStatus === 'contabilizado' ? 'Contabilizado' :
                         match.rankingStatus === 'descartado' ? 'Descartado' :
                         match.rankingStatus === 'mandante' ? 'Apenas Mandante' :
                         match.rankingStatus === 'visitante' ? 'Apenas Visitante' : '-'}
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {match.status !== 'cancelled' && (
                      <button 
                        onClick={() => setMatchToCancel(match)}
                        className="text-red-500 hover:text-red-700 font-medium text-xs transition-colors"
                      >
                        Cancelar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {allMatches.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">Nenhum jogo encontrado.</td>
                </tr>
              )}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between px-4 py-3 bg-white border-t border-zinc-200 sm:px-6">
              <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-zinc-700">
                    Mostrando <span className="font-medium">{indexOfFirstMatch + 1}</span> a <span className="font-medium">{Math.min(indexOfLastMatch, filteredMatches.length)}</span> de <span className="font-medium">{filteredMatches.length}</span> resultados
                  </p>
                </div>
                <div>
                  <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                      disabled={currentPage === 1}
                      className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-zinc-300 bg-white text-sm font-medium text-zinc-500 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="sr-only">Anterior</span>
                      <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </button>
                    {Array.from({ length: totalPages }).map((_, idx) => (
                      <button
                        key={idx}
                        onClick={() => setCurrentPage(idx + 1)}
                        className={cn(
                          "relative inline-flex items-center px-4 py-2 border text-sm font-medium",
                          currentPage === idx + 1
                            ? "z-10 bg-emerald-50 border-emerald-500 text-emerald-600"
                            : "bg-white border-zinc-300 text-zinc-500 hover:bg-zinc-50"
                        )}
                      >
                        {idx + 1}
                      </button>
                    ))}
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                      disabled={currentPage === totalPages}
                      className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-zinc-300 bg-white text-sm font-medium text-zinc-500 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="sr-only">Próximo</span>
                      <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </nav>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Configurações do Ranking */}
      <section className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
        <h2 className="text-xl font-semibold flex items-center gap-2 text-zinc-800 mb-6">
          <Trophy className="w-5 h-5 text-yellow-500" />
          Configuração da Competição do Ranking
        </h2>
        
        <form onSubmit={handleSaveRankingConfig} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Data de Início</label>
              <input 
                type="date" 
                required
                value={rankingConfig.startDate}
                onChange={e => setRankingConfig(prev => ({ ...prev, startDate: e.target.value }))}
                className="w-full p-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Data de Fim</label>
              <input 
                type="date" 
                required
                value={rankingConfig.endDate}
                onChange={e => setRankingConfig(prev => ({ ...prev, endDate: e.target.value }))}
                className="w-full p-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-zinc-800 mb-3 border-b border-zinc-100 pb-2">Prêmios por Categoria</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">Nacional</label>
                <input 
                  type="text" 
                  placeholder="Ex: Troféu + R$ 10.000"
                  value={rankingConfig.prizes.nacional}
                  onChange={e => setRankingConfig(prev => ({ ...prev, prizes: { ...prev.prizes, nacional: e.target.value } }))}
                  className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">Estadual</label>
                <input 
                  type="text" 
                  placeholder="Ex: Troféu + R$ 5.000"
                  value={rankingConfig.prizes.estadual}
                  onChange={e => setRankingConfig(prev => ({ ...prev, prizes: { ...prev.prizes, estadual: e.target.value } }))}
                  className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">Municipal</label>
                <input 
                  type="text" 
                  placeholder="Ex: Troféu + R$ 2.000"
                  value={rankingConfig.prizes.municipal}
                  onChange={e => setRankingConfig(prev => ({ ...prev, prizes: { ...prev.prizes, municipal: e.target.value } }))}
                  className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">Zona Leste (SP)</label>
                <input 
                  type="text" 
                  placeholder="Ex: Troféu + R$ 1.000"
                  value={rankingConfig.prizes.zonaLeste}
                  onChange={e => setRankingConfig(prev => ({ ...prev, prizes: { ...prev.prizes, zonaLeste: e.target.value } }))}
                  className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">Zona Oeste (SP)</label>
                <input 
                  type="text" 
                  placeholder="Ex: Troféu + R$ 1.000"
                  value={rankingConfig.prizes.zonaOeste}
                  onChange={e => setRankingConfig(prev => ({ ...prev, prizes: { ...prev.prizes, zonaOeste: e.target.value } }))}
                  className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">Zona Norte (SP)</label>
                <input 
                  type="text" 
                  placeholder="Ex: Troféu + R$ 1.000"
                  value={rankingConfig.prizes.zonaNorte}
                  onChange={e => setRankingConfig(prev => ({ ...prev, prizes: { ...prev.prizes, zonaNorte: e.target.value } }))}
                  className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">Zona Sul (SP)</label>
                <input 
                  type="text" 
                  placeholder="Ex: Troféu + R$ 1.000"
                  value={rankingConfig.prizes.zonaSul}
                  onChange={e => setRankingConfig(prev => ({ ...prev, prizes: { ...prev.prizes, zonaSul: e.target.value } }))}
                  className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">Centro (SP)</label>
                <input 
                  type="text" 
                  placeholder="Ex: Troféu + R$ 1.000"
                  value={rankingConfig.prizes.zonaCentro}
                  onChange={e => setRankingConfig(prev => ({ ...prev, prizes: { ...prev.prizes, zonaCentro: e.target.value } }))}
                  className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-between pt-4 border-t border-zinc-100">
            <button 
              type="button"
              onClick={handleDeleteRankingConfig}
              disabled={isSavingRanking}
              className="px-4 py-2 text-red-600 font-medium rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              Excluir Competição de Ranking
            </button>
            <button 
              type="submit"
              disabled={isSavingRanking}
              className="px-6 py-2 bg-emerald-500 text-white font-medium rounded-lg hover:bg-emerald-600 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isSavingRanking ? (
                <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div> Salvando...</>
              ) : (
                'Salvar Configuração do Ranking'
              )}
            </button>
          </div>
        </form>
      </section>

      {/* Configurações Gerais */}
      <section className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
        <h2 className="text-xl font-semibold flex items-center gap-2 text-zinc-800 mb-6">
          <ImageIcon className="w-5 h-5 text-emerald-500" />
          Configurações do Site
        </h2>
        
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
          <div className="w-24 h-24 rounded-2xl bg-zinc-100 border-2 border-dashed border-zinc-300 flex items-center justify-center overflow-hidden flex-shrink-0">
            {siteLogo ? (
              <img src={siteLogo} alt="Logo do Site" className="w-full h-full object-contain p-2" />
            ) : (
              <Shield className="w-8 h-8 text-zinc-400" />
            )}
          </div>
          
          <div className="flex-1">
            <h3 className="text-sm font-medium text-zinc-900 mb-1">Logo do Site</h3>
            <p className="text-xs text-zinc-500 mb-4">
              Esta imagem aparecerá no menu lateral e em outras áreas principais do site. Recomendamos uma imagem com fundo transparente (PNG).
            </p>
            
            <label className="relative inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white text-sm font-medium rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer">
              {isUploadingLogo ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              {isUploadingLogo ? 'Enviando...' : 'Alterar Logo'}
              <input 
                type="file" 
                accept="image/png, image/jpeg, image/webp" 
                className="hidden" 
                onChange={handleLogoUpload}
                disabled={isUploadingLogo}
              />
            </label>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Banners */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2 text-zinc-800">
              <ImageIcon className="w-5 h-5 text-emerald-500" />
              Banners
            </h2>
            {!isAddingBanner && (
              <button 
                onClick={() => setIsAddingBanner(true)}
                className="text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1 text-sm"
              >
                <Plus className="w-4 h-4" /> Novo Banner
              </button>
            )}
          </div>

          {isAddingBanner && (
            <form onSubmit={handleAddBanner} className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm space-y-4">
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Imagem do Banner <span className="text-red-500">*</span></label>
                  <input 
                    required 
                    type="file" 
                    accept="image/jpeg, image/png, image/webp"
                    onChange={handleImageUpload} 
                    className="block w-full text-sm text-zinc-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100" 
                  />
                  <p className="text-[10px] text-zinc-400 mt-1">
                    Formato recomendado: JPG, PNG ou WEBP. Proporção 16:9 (ex: 1920x1080px).
                  </p>
                  {bannerForm.imageUrl && (
                    <div className="mt-2">
                      <img src={bannerForm.imageUrl} alt="Preview" className="h-24 object-cover rounded-lg border border-zinc-200" />
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Link de Destino</label>
                  <input type="url" value={bannerForm.link} onChange={e => setBannerForm({...bannerForm, link: e.target.value})} className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-500 mb-1">Tipo</label>
                    <select value={bannerForm.type} onChange={e => setBannerForm({...bannerForm, type: e.target.value as any})} className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none">
                      <option value="promo">Promoção (Banner Principal)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-500 mb-1">Ordem</label>
                    <input type="number" value={bannerForm.order} onChange={e => setBannerForm({...bannerForm, order: Number(e.target.value)})} className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setIsAddingBanner(false)} className="px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 rounded-lg font-medium">Cancelar</button>
                <button type="submit" className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 text-sm rounded-lg font-medium">Salvar</button>
              </div>
            </form>
          )}

          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden divide-y divide-zinc-100">
            {banners.length === 0 ? (
              <div className="p-6 text-center text-zinc-500 text-sm">Nenhum banner cadastrado.</div>
            ) : (
              banners.map(banner => (
                <div key={banner.id} className="p-4 flex items-center justify-between hover:bg-zinc-50 transition-colors">
                  <div className="flex items-center gap-4">
                    <img src={banner.imageUrl} alt="Banner" className="w-16 h-16 object-cover rounded-lg border border-zinc-200" />
                    <div>
                      <div className="font-medium text-zinc-900 capitalize">{banner.type}</div>
                      <div className="text-xs text-zinc-500 truncate max-w-[200px]">{banner.link || 'Sem link'}</div>
                    </div>
                  </div>
                  <button onClick={() => handleDeleteBannerClick(banner.id)} className="text-zinc-400 hover:text-red-500 p-2 rounded transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Competitions */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2 text-zinc-800">
              <Trophy className="w-5 h-5 text-emerald-500" />
              Competições
            </h2>
            {!isAddingComp && (
              <button 
                onClick={() => setIsAddingComp(true)}
                className="text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1 text-sm"
              >
                <Plus className="w-4 h-4" /> Nova Competição
              </button>
            )}
          </div>

          {isAddingComp && (
            <form onSubmit={handleAddComp} className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm space-y-4">
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Nome da Competição <span className="text-red-500">*</span></label>
                  <input required type="text" value={compForm.name} onChange={e => setCompForm({...compForm, name: e.target.value})} className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-500 mb-1">Tipo</label>
                    <select value={compForm.type} onChange={e => setCompForm({...compForm, type: e.target.value as any})} className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none">
                      <option value="league">Liga</option>
                      <option value="cup">Copa</option>
                      <option value="festival">Festival</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-500 mb-1">Status</label>
                    <select value={compForm.status} onChange={e => setCompForm({...compForm, status: e.target.value as any})} className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none">
                      <option value="upcoming">Em breve</option>
                      <option value="ongoing">Em andamento</option>
                      <option value="completed">Finalizado</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-500 mb-1">Data Início <span className="text-red-500">*</span></label>
                    <input required type="date" value={compForm.startDate} onChange={e => setCompForm({...compForm, startDate: e.target.value})} className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-500 mb-1">Data Fim <span className="text-red-500">*</span></label>
                    <input required type="date" value={compForm.endDate} onChange={e => setCompForm({...compForm, endDate: e.target.value})} className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
                  </div>
                </div>

                {compForm.type === 'festival' && (
                  <div className="space-y-3 mt-4 border-t border-zinc-100 pt-4">
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <label className="block text-xs font-medium text-zinc-500 mb-1">Valor da Inscrição</label>
                        <input 
                          type="text" 
                          placeholder="Ex: R$ 150,00"
                          value={compForm.entryFee} 
                          onChange={e => setCompForm({...compForm, entryFee: e.target.value})} 
                          className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-zinc-500 mb-1">Prêmio</label>
                        <input 
                          type="text" 
                          placeholder="Ex: Troféu + R$ 500,00"
                          value={compForm.prize} 
                          onChange={e => setCompForm({...compForm, prize: e.target.value})} 
                          className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" 
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <label className="block text-sm font-medium text-zinc-700">Horários dos Jogos <span className="text-red-500">*</span></label>
                      <button 
                        type="button" 
                        onClick={addFestivalGame}
                        className="text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1 text-xs"
                      >
                        <Plus className="w-3 h-3" /> Adicionar Jogo
                      </button>
                    </div>
                    
                    {compForm.festivalGames.length === 0 ? (
                      <div className="text-xs text-zinc-500 text-center py-2 bg-zinc-50 rounded-lg border border-dashed border-zinc-200">
                        Nenhum jogo adicionado. Clique em "Adicionar Jogo" para definir os horários.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {compForm.festivalGames.map((game, index) => (
                          <div key={index} className="flex items-center gap-3 bg-zinc-50 p-2 rounded-lg border border-zinc-200">
                            <span className="text-xs font-medium text-zinc-500 w-12">Jogo {index + 1}</span>
                            <div className="flex-1 grid grid-cols-2 gap-2">
                              <div>
                                <input 
                                  type="time" 
                                  required
                                  value={game.startTime} 
                                  onChange={e => updateFestivalGame(index, 'startTime', e.target.value)} 
                                  className="w-full p-1.5 text-xs border border-zinc-300 rounded focus:ring-2 focus:ring-emerald-500 outline-none" 
                                />
                              </div>
                              <div>
                                <input 
                                  type="time" 
                                  required
                                  value={game.endTime} 
                                  onChange={e => updateFestivalGame(index, 'endTime', e.target.value)} 
                                  className="w-full p-1.5 text-xs border border-zinc-300 rounded focus:ring-2 focus:ring-emerald-500 outline-none" 
                                />
                              </div>
                            </div>
                            <button 
                              type="button" 
                              onClick={() => removeFestivalGame(index)}
                              className="text-zinc-400 hover:text-red-500 p-1 rounded transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setIsAddingComp(false)} className="px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 rounded-lg font-medium">Cancelar</button>
                <button type="submit" className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 text-sm rounded-lg font-medium">Salvar</button>
              </div>
            </form>
          )}

          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden divide-y divide-zinc-100">
            {competitions.length === 0 ? (
              <div className="p-6 text-center text-zinc-500 text-sm">Nenhuma competição cadastrada.</div>
            ) : (
              competitions.map(comp => (
                <div key={comp.id} className="p-4 flex items-center justify-between hover:bg-zinc-50 transition-colors">
                  <div>
                    <div className="font-bold text-zinc-900">{comp.name}</div>
                    <div className="text-xs text-zinc-500 capitalize mt-1">{comp.type} • {comp.status}</div>
                  </div>
                  <button onClick={() => handleDeleteCompClick(comp.id)} className="text-zinc-400 hover:text-red-500 p-2 rounded transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Danger Zone */}
      <section className="bg-red-50 p-6 rounded-2xl border border-red-200 shadow-sm mt-8">
        <h2 className="text-xl font-semibold flex items-center gap-2 text-red-800 mb-4">
          <Trash2 className="w-5 h-5" />
          Zona de Perigo
        </h2>
        
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-red-200">
            <div>
              <h3 className="font-medium text-red-900">Apagar Histórico de Jogos</h3>
              <p className="text-sm text-red-700 mt-1">
                Esta ação irá apagar permanentemente todos os jogos, festivais e resultados cadastrados no sistema. As pontuações de todos os times serão zeradas. Esta ação não pode ser desfeita.
              </p>
            </div>
            <button 
              onClick={() => setConfirmDeleteHistory(true)}
              className="flex-shrink-0 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
            >
              Apagar Histórico
            </button>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-medium text-red-900">Apagar Todos os Times</h3>
              <p className="text-sm text-red-700 mt-1">
                Esta ação irá apagar permanentemente <strong>TODOS</strong> os times cadastrados no sistema. Esta ação não pode ser desfeita.
              </p>
            </div>
            <button 
              onClick={() => setConfirmDeleteAllTeams(true)}
              className="flex-shrink-0 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
            >
              Apagar Times
            </button>
          </div>
        </div>
      </section>

      {/* Modals */}
      {confirmDeleteBanner && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-xl font-bold text-zinc-900 mb-2">Remover Banner</h3>
            <p className="text-zinc-600 mb-6">
              Tem certeza que deseja remover este banner?
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setConfirmDeleteBanner(null)}
                className="px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={confirmDeleteBannerAction}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
              >
                Remover
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteComp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-xl font-bold text-zinc-900 mb-2">Remover Competição</h3>
            <p className="text-zinc-600 mb-6">
              Tem certeza que deseja remover esta competição?
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setConfirmDeleteComp(null)}
                className="px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={confirmDeleteCompAction}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
              >
                Remover
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteRanking && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-xl font-bold text-zinc-900 mb-2">Excluir Competição de Ranking</h3>
            <p className="text-zinc-600 mb-6">
              Tem certeza que deseja excluir a competição do ranking atual? Esta ação apagará as configurações de datas e prêmios.
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setConfirmDeleteRanking(false)}
                disabled={isSavingRanking}
                className="px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button 
                onClick={confirmDeleteRankingAction}
                disabled={isSavingRanking}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors disabled:opacity-50"
              >
                {isSavingRanking ? (
                  <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div> Excluindo...</>
                ) : (
                  'Excluir'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteHistory && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
            <h3 className="text-xl font-bold text-red-600 mb-2">Apagar Histórico de Jogos</h3>
            <p className="text-zinc-600 mb-6">
              Tem certeza que deseja apagar <strong>TODOS</strong> os jogos e festivais do sistema? As estatísticas de todos os times serão recalculadas (zeradas). Esta ação é irreversível.
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setConfirmDeleteHistory(false)}
                disabled={isDeletingHistory}
                className="px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button 
                onClick={handleDeleteHistory}
                disabled={isDeletingHistory}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {isDeletingHistory ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Apagando...
                  </>
                ) : (
                  'Sim, apagar tudo'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Teams List Modal */}
      {teamsModalList && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[80vh] flex flex-col shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-zinc-900">{teamsModalTitle}</h3>
              <button 
                onClick={() => setTeamsModalList(null)}
                className="text-zinc-400 hover:text-zinc-600 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 pr-2">
              {teamsModalList.length === 0 ? (
                <p className="text-zinc-500 text-center py-8">Nenhum time encontrado.</p>
              ) : (
                <ul className="space-y-3">
                  {teamsModalList.map(team => (
                    <li key={team.id} className="p-4 bg-zinc-50 rounded-xl border border-zinc-200 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-zinc-200 flex items-center justify-center overflow-hidden flex-shrink-0">
                          {team.logo ? (
                            <img src={team.logo} alt={team.name} className="w-full h-full object-cover" />
                          ) : (
                            <Shield className="w-6 h-6 text-zinc-400" />
                          )}
                        </div>
                        <div>
                          <h4 className="font-bold text-zinc-900">{team.name}</h4>
                          <div className="text-sm text-zinc-500 flex items-center gap-2">
                            <span>{team.managerName}</span>
                            {team.managerPhone && (
                              <>
                                <span>•</span>
                                <a href={`https://wa.me/${team.managerPhone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline">
                                  {team.managerPhone}
                                </a>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={cn(
                          "px-2 py-1 text-xs font-medium rounded-full",
                          team.subscription?.status === 'active' && team.subscription.expiresAt && !isNaN(new Date(team.subscription.expiresAt).getTime()) && new Date(team.subscription.expiresAt) > new Date()
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-red-100 text-red-700"
                        )}>
                          {team.subscription?.status === 'active' && team.subscription.expiresAt && !isNaN(new Date(team.subscription.expiresAt).getTime()) && new Date(team.subscription.expiresAt) > new Date() ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cancel Match Modal */}
      {matchToCancel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
            <h3 className="text-xl font-bold text-zinc-900 mb-2">Cancelar Jogo</h3>
            <p className="text-zinc-600 mb-4">
              Você está prestes a cancelar o jogo entre <strong>{matchToCancel.homeTeamName || 'Time A'}</strong> e <strong>{matchToCancel.awayTeamName || 'Time B'}</strong>.
            </p>
            <div className="mb-6">
              <label className="block text-sm font-medium text-zinc-700 mb-1">Motivo do Cancelamento</label>
              <textarea
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                className="w-full p-3 border border-zinc-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none resize-none"
                rows={3}
                placeholder="Ex: Chuva forte, time não compareceu..."
              />
            </div>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => {
                  setMatchToCancel(null);
                  setCancelReason('');
                }}
                disabled={isCancelingMatch}
                className="px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors disabled:opacity-50"
              >
                Voltar
              </button>
              <button 
                onClick={handleCancelMatch}
                disabled={isCancelingMatch || !cancelReason.trim()}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {isCancelingMatch ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Cancelando...
                  </>
                ) : (
                  'Confirmar Cancelamento'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {confirmDeleteAllTeams && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
            <h3 className="text-xl font-bold text-red-600 mb-2">Apagar Todos os Times</h3>
            <p className="text-zinc-600 mb-6">
              Tem certeza que deseja apagar <strong>TODOS</strong> os times do sistema? Esta ação é irreversível e removerá permanentemente todos os dados dos times.
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setConfirmDeleteAllTeams(false)}
                disabled={isDeletingAllTeams}
                className="px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button 
                onClick={handleDeleteAllTeams}
                disabled={isDeletingAllTeams}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {isDeletingAllTeams ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Apagando...
                  </>
                ) : (
                  'Sim, apagar tudo'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

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
