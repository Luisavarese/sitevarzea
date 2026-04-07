import { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { 
  MapPin, Calendar as CalendarIcon, DollarSign, Clock, Users, 
  Plus, Edit2, Trash2, Check, X, TrendingUp, MessageSquare, Star, Bell
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, isSameDay, parseISO, addWeeks } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '../lib/utils';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';

interface Field {
  id: string;
  name: string;
  type: 'Fut7' | 'Futsal' | 'Society' | 'Campo';
  address: string;
  city: string;
  state: string;
  neighborhood: string;
  photos: string[];
  description: string;
  capacity: number;
  pricePerHour: number;
  operatingHours: {
    open: string;
    close: string;
  };
  managerId: string;
  createdAt: string;
}

interface Reservation {
  id: string;
  fieldId: string;
  teamName: string;
  teamId?: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  duration: number; // in hours
  value: number;
  status: 'pending' | 'confirmed' | 'cancelled' | 'paid';
  managerId: string;
  createdAt: string;
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

export function MyField() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'fields' | 'reservations' | 'financial'>('dashboard');
  
  const [fields, setFields] = useState<Field[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [isFieldModalOpen, setIsFieldModalOpen] = useState(false);
  const [isReservationModalOpen, setIsReservationModalOpen] = useState(false);
  const [editingField, setEditingField] = useState<Field | null>(null);
  const [editingReservation, setEditingReservation] = useState<Reservation | null>(null);
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');

  const [ibgeStates, setIbgeStates] = useState<IBGEState[]>([]);
  const [ibgeCities, setIbgeCities] = useState<IBGECity[]>([]);
  const [promoForm, setPromoForm] = useState({
    fieldId: '',
    date: '',
    time: '',
    discount: 20,
    state: '',
    city: '',
    zone: '',
    targetAudience: 'both' // 'home' (mandantes), 'away' (visitantes), 'both' (ambos)
  });
  const [isSendingPromo, setIsSendingPromo] = useState(false);

  useEffect(() => {
    if (!user) return;

    const qFields = query(collection(db, 'fields'), where('managerId', '==', user.uid));
    const unsubscribeFields = onSnapshot(qFields, (snap) => {
      const fieldsData = snap.docs.map(d => ({ id: d.id, ...d.data() } as Field));
      setFields(fieldsData);
    });

    const qReservations = query(collection(db, 'reservations'), where('managerId', '==', user.uid));
    const unsubscribeReservations = onSnapshot(qReservations, (snap) => {
      const resData = snap.docs.map(d => ({ id: d.id, ...d.data() } as Reservation));
      setReservations(resData);
      setLoading(false);
    });

    return () => {
      unsubscribeFields();
      unsubscribeReservations();
    };
  }, [user]);

  useEffect(() => {
    fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome')
      .then(res => res.json())
      .then(data => setIbgeStates(data))
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (promoForm.state) {
      fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${promoForm.state}/municipios?orderBy=nome`)
        .then(res => res.json())
        .then(data => setIbgeCities(data))
        .catch(console.error);
    } else {
      setIbgeCities([]);
    }
  }, [promoForm.state]);

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div></div>;
  }

  const handleSendPromotion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoForm.fieldId || !promoForm.date || !promoForm.time || !promoForm.state || !promoForm.city) {
      alert('Preencha todos os campos obrigatórios.');
      return;
    }
    if (promoForm.state === 'SP' && promoForm.city === 'São Paulo' && !promoForm.zone) {
      alert('Selecione a região (zona) para São Paulo.');
      return;
    }

    setIsSendingPromo(true);
    try {
      // 1. Find teams in the selected state and city (and zone if applicable)
      let teamsQuery = query(
        collection(db, 'teams'),
        where('state', '==', promoForm.state),
        where('city', '==', promoForm.city)
      );
      
      if (promoForm.zone) {
        teamsQuery = query(
          collection(db, 'teams'),
          where('state', '==', promoForm.state),
          where('city', '==', promoForm.city),
          where('zone', '==', promoForm.zone)
        );
      }

      const teamsSnapshot = await getDocs(teamsQuery);
      const teams = teamsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      if (teams.length === 0) {
        alert('Nenhum time encontrado nesta região.');
        setIsSendingPromo(false);
        return;
      }

      // 2. Filter by target audience (mandantes, visitantes, ambos)
      const field = fields.find(f => f.id === promoForm.fieldId);
      if (!field) throw new Error('Campo não encontrado');

      let targetTeams = teams;
      
      if (promoForm.targetAudience !== 'both') {
        // Fetch availabilities for these teams to know if they are home or away
        const teamIds = teams.map(t => t.id);
        const availabilities: any[] = [];
        
        if (teamIds.length > 0) {
          for (let i = 0; i < teamIds.length; i += 30) {
            const chunk = teamIds.slice(i, i + 30);
            const availQ = query(collection(db, 'availabilities'), where('teamId', 'in', chunk));
            const availSnap = await getDocs(availQ);
            availSnap.forEach(doc => availabilities.push(doc.data()));
          }
        }
        
        // Filter teams that have at least one availability matching the target audience
        targetTeams = teams.filter(team => {
          const teamAvails = availabilities.filter(a => a.teamId === team.id);
          if (teamAvails.length === 0) return true; // If no availabilities, assume they are open to anything
          
          return teamAvails.some(a => 
            a.type === 'both' || a.type === promoForm.targetAudience
          );
        });
      }
      
      if (targetTeams.length === 0) {
        alert('Nenhum time encontrado com este perfil na região.');
        setIsSendingPromo(false);
        return;
      }
      
      // 3. Create notifications (mail and messages)
      const batch = [];
      const managerIds = [...new Set(targetTeams.map(t => t.managerId).filter(Boolean))];
      
      // Fetch manager emails
      const managerEmails: Record<string, string> = {};
      if (managerIds.length > 0) {
        // Firestore 'in' query supports up to 30 items. We'll chunk it if needed, but for now let's assume < 30 or we just fetch them.
        // To be safe, we can fetch them individually or chunk.
        for (let i = 0; i < managerIds.length; i += 30) {
          const chunk = managerIds.slice(i, i + 30);
          const usersQ = query(collection(db, 'users'), where('uid', 'in', chunk));
          const usersSnap = await getDocs(usersQ);
          usersSnap.forEach(doc => {
            managerEmails[doc.data().uid] = doc.data().email;
          });
        }
      }
      
      for (const team of targetTeams) {
        if (!team.managerId) continue;
        
        const messageBody = `Promoção! ${field.name} tem um horário vago dia ${format(new Date(promoForm.date + 'T12:00:00Z'), 'dd/MM/yyyy')} às ${promoForm.time} com ${promoForm.discount}% de desconto! Reserve agora pelo app.`;
        
        // WhatsApp/SMS notification
        if (team.whatsapp) {
          batch.push(addDoc(collection(db, 'messages'), {
            to: team.whatsapp,
            body: messageBody,
            createdAt: new Date().toISOString()
          }));
        }
        
        // Email notification
        const managerEmail = managerEmails[team.managerId];
        if (managerEmail) {
          batch.push(addDoc(collection(db, 'mail'), {
            to: managerEmail,
            message: {
              subject: `Promoção no ${field.name}!`,
              html: `<p>Olá,</p><p>${messageBody}</p>`
            },
            createdAt: new Date().toISOString()
          }));
        }
        
        // In-app notification
        batch.push(addDoc(collection(db, 'notifications'), {
          userId: team.managerId,
          title: 'Promoção de Horário Vago!',
          message: messageBody,
          type: 'info',
          createdAt: new Date().toISOString(),
          read: false,
          link: `/fields/${field.id}`
        }));
      }

      await Promise.all(batch);
      alert(`Promoção enviada com sucesso para ${targetTeams.length} times!`);
      
      setPromoForm({
        ...promoForm,
        date: '',
        time: '',
        discount: 20,
        zone: ''
      });
    } catch (error) {
      console.error('Error sending promotion:', error);
      alert('Erro ao enviar promoção. Tente novamente.');
    } finally {
      setIsSendingPromo(false);
    }
  };

  const renderDashboard = () => {
    const today = new Date();
    const todayStr = format(today, 'yyyy-MM-dd');
    
    const todayReservations = reservations.filter(r => r.date === todayStr && r.status !== 'cancelled');
    const todayRevenue = todayReservations.reduce((acc, r) => acc + r.value, 0);
    
    const monthReservations = reservations.filter(r => {
      const rDate = new Date(r.date + 'T12:00:00Z');
      return rDate >= startOfMonth(today) && rDate <= endOfMonth(today) && r.status !== 'cancelled';
    });
    const monthRevenue = monthReservations.reduce((acc, r) => acc + r.value, 0);

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">
                <DollarSign className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-zinc-500 font-medium">Faturamento Hoje</p>
                <h3 className="text-2xl font-bold text-zinc-900">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(todayRevenue)}
                </h3>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center">
                <TrendingUp className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-zinc-500 font-medium">Faturamento Mês</p>
                <h3 className="text-2xl font-bold text-zinc-900">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(monthRevenue)}
                </h3>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-xl flex items-center justify-center">
                <CalendarIcon className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-zinc-500 font-medium">Jogos Hoje</p>
                <h3 className="text-2xl font-bold text-zinc-900">{todayReservations.length}</h3>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-orange-100 text-orange-600 rounded-xl flex items-center justify-center">
                <MapPin className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-zinc-500 font-medium">Campos Ativos</p>
                <h3 className="text-2xl font-bold text-zinc-900">{fields.length}</h3>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
            <h3 className="text-lg font-bold text-zinc-900 mb-4">Próximos Jogos</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-200">
                  <tr>
                    <th className="px-4 py-3 font-medium">Data/Hora</th>
                    <th className="px-4 py-3 font-medium">Quadra</th>
                    <th className="px-4 py-3 font-medium">Time/Cliente</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {reservations
                    .filter(r => new Date(`${r.date}T${r.startTime}`) >= new Date())
                    .sort((a, b) => new Date(`${a.date}T${a.startTime}`).getTime() - new Date(`${b.date}T${b.startTime}`).getTime())
                    .slice(0, 5)
                    .map(res => {
                      const field = fields.find(f => f.id === res.fieldId);
                      return (
                        <tr key={res.id} className="hover:bg-zinc-50">
                          <td className="px-4 py-3 font-medium text-zinc-900">
                            {format(parseISO(res.date), 'dd/MM/yyyy')} às {res.startTime}
                          </td>
                          <td className="px-4 py-3 text-zinc-600">{field?.name || 'Campo Removido'}</td>
                          <td className="px-4 py-3 text-zinc-900">{res.teamName}</td>
                          <td className="px-4 py-3">
                            <span className={cn(
                              "px-2 py-1 text-xs font-medium rounded-full",
                              res.status === 'confirmed' ? "bg-blue-100 text-blue-700" :
                              res.status === 'paid' ? "bg-emerald-100 text-emerald-700" :
                              res.status === 'pending' ? "bg-amber-100 text-amber-700" :
                              "bg-red-100 text-red-700"
                            )}>
                              {res.status === 'confirmed' ? 'Confirmado' :
                               res.status === 'paid' ? 'Pago' :
                               res.status === 'pending' ? 'Pendente' : 'Cancelado'}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-medium text-emerald-600">
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(res.value)}
                          </td>
                        </tr>
                      );
                    })}
                  {reservations.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                        Nenhuma reserva encontrada.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
            <h3 className="text-lg font-bold text-zinc-900 mb-4 flex items-center gap-2">
              <Users className="w-5 h-5 text-emerald-600" />
              Clientes Frequentes
            </h3>
            <div className="space-y-4">
              {/* Mocked top clients based on reservations */}
              {Object.entries(
                reservations.reduce((acc, res) => {
                  if (res.status !== 'cancelled') {
                    acc[res.teamName] = (acc[res.teamName] || 0) + 1;
                  }
                  return acc;
                }, {} as Record<string, number>)
              )
                .sort(([, a], [, b]) => b - a)
                .slice(0, 5)
                .map(([teamName, count], index) => (
                  <div key={teamName} className="flex items-center justify-between border-b border-zinc-100 pb-3 last:border-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-600 font-bold text-xs">
                        {index + 1}
                      </div>
                      <div>
                        <p className="font-medium text-zinc-900 text-sm">{teamName}</p>
                        <p className="text-xs text-zinc-500">{count} reservas</p>
                      </div>
                    </div>
                    <button className="text-emerald-600 hover:text-emerald-700 text-xs font-medium">
                      Ver Histórico
                    </button>
                  </div>
                ))}
              {reservations.length === 0 && (
                <p className="text-sm text-zinc-500 text-center py-4">Nenhum histórico ainda.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderFields = () => {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold text-zinc-800">Meus Campos</h2>
          <button 
            onClick={() => { setEditingField(null); setIsFieldModalOpen(true); }}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Novo Campo
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {fields.map(field => (
            <div key={field.id} className="bg-white rounded-2xl border border-zinc-200 overflow-hidden shadow-sm">
              <div className="h-48 bg-zinc-200 relative">
                {field.photos && field.photos.length > 0 ? (
                  <img src={field.photos[0]} alt={field.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-400">
                    <MapPin className="w-12 h-12" />
                  </div>
                )}
                <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full text-sm font-bold text-emerald-600">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(field.pricePerHour)}/h
                </div>
              </div>
              <div className="p-5">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-lg font-bold text-zinc-900">{field.name}</h3>
                  <span className="bg-zinc-100 text-zinc-600 px-2 py-1 rounded text-xs font-medium">{field.type}</span>
                </div>
                <p className="text-sm text-zinc-500 mb-4 line-clamp-2">{field.description}</p>
                
                <div className="space-y-2 mb-6">
                  <div className="flex items-center gap-2 text-sm text-zinc-600">
                    <MapPin className="w-4 h-4" />
                    {field.city} - {field.neighborhood}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-zinc-600">
                    <Users className="w-4 h-4" />
                    Capacidade: {field.capacity} pessoas
                  </div>
                  <div className="flex items-center gap-2 text-sm text-zinc-600">
                    <Clock className="w-4 h-4" />
                    {field.operatingHours.open} às {field.operatingHours.close}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button 
                    onClick={() => { setEditingField(field); setIsFieldModalOpen(true); }}
                    className="flex-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 py-2 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
                  >
                    <Edit2 className="w-4 h-4" />
                    Editar
                  </button>
                  <button 
                    onClick={async () => {
                      if (window.confirm('Tem certeza que deseja excluir este campo?')) {
                        await deleteDoc(doc(db, 'fields', field.id));
                      }
                    }}
                    className="bg-red-50 hover:bg-red-100 text-red-600 p-2 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {fields.length === 0 && (
            <div className="col-span-full text-center py-12 bg-white rounded-2xl border border-zinc-200 border-dashed">
              <MapPin className="w-12 h-12 text-zinc-300 mx-auto mb-3" />
              <h3 className="text-lg font-medium text-zinc-900 mb-1">Nenhum campo cadastrado</h3>
              <p className="text-zinc-500 mb-4">Comece cadastrando seu primeiro campo ou quadra.</p>
              <button 
                onClick={() => { setEditingField(null); setIsFieldModalOpen(true); }}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium inline-flex items-center gap-2 transition-colors"
              >
                <Plus className="w-5 h-5" />
                Novo Campo
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const handleEventDrop = async (info: any) => {
    const { event } = info;
    const resId = event.id;
    const newStart = event.start;
    const newEnd = event.end;

    if (!newStart || !newEnd) return;

    const newDate = format(newStart, 'yyyy-MM-dd');
    const newStartTime = format(newStart, 'HH:mm');
    const newEndTime = format(newEnd, 'HH:mm');

    try {
      await updateDoc(doc(db, 'reservations', resId), {
        date: newDate,
        startTime: newStartTime,
        endTime: newEndTime
      });
    } catch (error) {
      console.error("Error updating reservation:", error);
      info.revert();
      alert("Erro ao atualizar reserva.");
    }
  };

  const renderReservations = () => {
    const events = reservations.map(res => {
      const field = fields.find(f => f.id === res.fieldId);
      return {
        id: res.id,
        title: `${res.teamName} (${field?.name || 'Campo Removido'})`,
        start: `${res.date}T${res.startTime}:00`,
        end: `${res.date}T${res.endTime}:00`,
        backgroundColor: res.status === 'confirmed' ? '#3b82f6' :
                         res.status === 'paid' ? '#10b981' :
                         res.status === 'pending' ? '#f59e0b' : '#ef4444',
        borderColor: 'transparent',
        extendedProps: { ...res }
      };
    });

    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h2 className="text-xl font-bold text-zinc-800">Agenda e Reservas</h2>
          <div className="flex items-center gap-2">
            <div className="bg-white border border-zinc-200 rounded-lg p-1 flex">
              <button
                onClick={() => setViewMode('calendar')}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  viewMode === 'calendar' ? "bg-zinc-100 text-zinc-900" : "text-zinc-500 hover:text-zinc-700"
                )}
              >
                Calendário
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  viewMode === 'list' ? "bg-zinc-100 text-zinc-900" : "text-zinc-500 hover:text-zinc-700"
                )}
              >
                Lista
              </button>
            </div>
            <button 
              onClick={() => { setEditingReservation(null); setIsReservationModalOpen(true); }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors"
            >
              <Plus className="w-5 h-5" />
              Nova Reserva
            </button>
          </div>
        </div>

        {viewMode === 'calendar' ? (
          <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <style>{`
              .fc .fc-toolbar-title { font-size: 1.25rem; font-weight: 700; color: #18181b; }
              .fc .fc-button-primary { background-color: #10b981; border-color: #10b981; }
              .fc .fc-button-primary:hover { background-color: #059669; border-color: #059669; }
              .fc .fc-button-primary:not(:disabled):active, .fc .fc-button-primary:not(:disabled).fc-button-active { background-color: #047857; border-color: #047857; }
              .fc-theme-standard td, .fc-theme-standard th { border-color: #e4e4e7; }
              .fc .fc-timegrid-slot-label-cushion { font-size: 0.875rem; color: #71717a; }
              .fc .fc-col-header-cell-cushion { color: #3f3f46; font-weight: 600; padding: 8px; }
            `}</style>
            <FullCalendar
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
              initialView="timeGridWeek"
              headerToolbar={{
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,timeGridDay'
              }}
              locale="pt-br"
              events={events}
              editable={true}
              droppable={true}
              eventDrop={handleEventDrop}
              eventResize={handleEventDrop}
              slotMinTime="06:00:00"
              slotMaxTime="24:00:00"
              allDaySlot={false}
              height="auto"
              eventClick={(info) => {
                const res = info.event.extendedProps as Reservation;
                if (window.confirm(`Deseja editar ou excluir a reserva de ${res.teamName}?\n\nClique em OK para editar, ou Cancelar para ver a opção de excluir.`)) {
                  setEditingReservation(res);
                  setIsReservationModalOpen(true);
                } else {
                  if (window.confirm('Tem certeza que deseja EXCLUIR esta reserva?')) {
                    deleteDoc(doc(db, 'reservations', res.id)).catch(error => {
                      console.error("Error deleting reservation:", error);
                      alert("Erro ao excluir reserva.");
                    });
                  }
                }
              }}
            />
          </div>
        ) : (
          <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-200">
                  <tr>
                    <th className="px-4 py-3 font-medium">Data/Hora</th>
                    <th className="px-4 py-3 font-medium">Quadra</th>
                    <th className="px-4 py-3 font-medium">Time/Cliente</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {reservations
                    .sort((a, b) => new Date(`${b.date}T${b.startTime}`).getTime() - new Date(`${a.date}T${a.startTime}`).getTime())
                    .map(res => {
                      const field = fields.find(f => f.id === res.fieldId);
                      return (
                        <tr key={res.id} className="hover:bg-zinc-50">
                          <td className="px-4 py-3 font-medium text-zinc-900">
                            {format(parseISO(res.date), 'dd/MM/yyyy')} <br/>
                            <span className="text-zinc-500 font-normal">{res.startTime} - {res.endTime}</span>
                          </td>
                          <td className="px-4 py-3 text-zinc-600">{field?.name || 'Campo Removido'}</td>
                          <td className="px-4 py-3 text-zinc-900 font-medium">{res.teamName}</td>
                          <td className="px-4 py-3">
                            <select 
                              value={res.status}
                              onChange={async (e) => {
                                await updateDoc(doc(db, 'reservations', res.id), { status: e.target.value });
                              }}
                              className={cn(
                                "text-xs font-medium rounded-full px-2 py-1 border-0 cursor-pointer outline-none",
                                res.status === 'confirmed' ? "bg-blue-100 text-blue-700" :
                                res.status === 'paid' ? "bg-emerald-100 text-emerald-700" :
                                res.status === 'pending' ? "bg-amber-100 text-amber-700" :
                                "bg-red-100 text-red-700"
                              )}
                            >
                              <option value="pending">Pendente</option>
                              <option value="confirmed">Confirmado</option>
                              <option value="paid">Pago</option>
                              <option value="cancelled">Cancelado</option>
                            </select>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button 
                              onClick={() => {
                                setEditingReservation(res);
                                setIsReservationModalOpen(true);
                              }}
                              className="text-blue-500 hover:bg-blue-50 p-1.5 rounded-lg transition-colors mr-2"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={async () => {
                                if (window.confirm('Tem certeza que deseja excluir esta reserva?')) {
                                  await deleteDoc(doc(db, 'reservations', res.id));
                                }
                              }}
                              className="text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  {reservations.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                        Nenhuma reserva encontrada.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderFinancial = () => {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold text-zinc-800">Promoções</h2>
        </div>

        <div className="grid grid-cols-1 max-w-2xl mx-auto gap-6">
          {/* Promotions & Marketing */}
          <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
            <h3 className="text-lg font-bold text-zinc-900 mb-4 flex items-center gap-2">
              <Bell className="w-5 h-5 text-blue-600" />
              Promoções Automáticas
            </h3>
            <p className="text-sm text-zinc-600 mb-6">
              Notifique times da plataforma sobre horários vagos com desconto.
            </p>

            <form className="space-y-4" onSubmit={handleSendPromotion}>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Selecione o Campo <span className="text-red-500">*</span></label>
                <select 
                  required
                  value={promoForm.fieldId}
                  onChange={e => {
                    const selectedFieldId = e.target.value;
                    const selectedField = fields.find(f => f.id === selectedFieldId);
                    setPromoForm({
                      ...promoForm, 
                      fieldId: selectedFieldId,
                      state: selectedField?.state || '',
                      city: selectedField?.city || '',
                      zone: ''
                    });
                  }}
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white"
                >
                  <option value="">Selecione...</option>
                  {fields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Estado <span className="text-red-500">*</span></label>
                  <select 
                    required
                    value={promoForm.state}
                    onChange={e => setPromoForm({...promoForm, state: e.target.value, city: '', zone: ''})}
                    className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white"
                  >
                    <option value="">Selecione...</option>
                    {ibgeStates.map(state => (
                      <option key={state.id} value={state.sigla}>{state.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Cidade <span className="text-red-500">*</span></label>
                  <select 
                    required
                    value={promoForm.city}
                    onChange={e => setPromoForm({...promoForm, city: e.target.value, zone: ''})}
                    className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white"
                    disabled={!promoForm.state}
                  >
                    <option value="">Selecione...</option>
                    {ibgeCities.map(city => (
                      <option key={city.id} value={city.nome}>{city.nome}</option>
                    ))}
                  </select>
                </div>
              </div>

              {promoForm.state === 'SP' && promoForm.city === 'São Paulo' && (
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Região (Zona) <span className="text-red-500">*</span></label>
                  <select 
                    required
                    value={promoForm.zone}
                    onChange={e => setPromoForm({...promoForm, zone: e.target.value})}
                    className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white"
                  >
                    <option value="">Selecione a região...</option>
                    <option value="Norte">Zona Norte</option>
                    <option value="Sul">Zona Sul</option>
                    <option value="Leste">Zona Leste</option>
                    <option value="Oeste">Zona Oeste</option>
                    <option value="Centro">Centro</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Público Alvo <span className="text-red-500">*</span></label>
                <select 
                  required
                  value={promoForm.targetAudience}
                  onChange={e => setPromoForm({...promoForm, targetAudience: e.target.value})}
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white"
                >
                  <option value="both">Ambos (Mandantes e Visitantes)</option>
                  <option value="home">Apenas Mandantes</option>
                  <option value="away">Apenas Visitantes</option>
                </select>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Data <span className="text-red-500">*</span></label>
                  <input 
                    type="date" 
                    required
                    value={promoForm.date}
                    onChange={e => setPromoForm({...promoForm, date: e.target.value})}
                    className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Horário <span className="text-red-500">*</span></label>
                  <input 
                    type="time" 
                    required
                    value={promoForm.time}
                    onChange={e => setPromoForm({...promoForm, time: e.target.value})}
                    className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" 
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Desconto (%) <span className="text-red-500">*</span></label>
                <input 
                  type="number" 
                  required
                  value={promoForm.discount}
                  onChange={e => setPromoForm({...promoForm, discount: Number(e.target.value)})}
                  min={5} 
                  max={100} 
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" 
                />
              </div>

              <button 
                type="submit" 
                disabled={isSendingPromo}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                {isSendingPromo ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Enviando...
                  </>
                ) : (
                  'Disparar Promoção'
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-zinc-900 tracking-tight">Meu Campo</h1>
          <p className="text-zinc-500 mt-1">Gerencie seus campos, reservas e faturamento.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto hide-scrollbar gap-2 mb-8 bg-white p-1.5 rounded-xl border border-zinc-200">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-all whitespace-nowrap",
            activeTab === 'dashboard' 
              ? "bg-emerald-50 text-emerald-700 shadow-sm" 
              : "text-zinc-600 hover:bg-zinc-50"
          )}
        >
          <TrendingUp className="w-4 h-4" />
          Painel
        </button>
        <button
          onClick={() => setActiveTab('fields')}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-all whitespace-nowrap",
            activeTab === 'fields' 
              ? "bg-emerald-50 text-emerald-700 shadow-sm" 
              : "text-zinc-600 hover:bg-zinc-50"
          )}
        >
          <MapPin className="w-4 h-4" />
          Quadras e Campos
        </button>
        <button
          onClick={() => setActiveTab('reservations')}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-all whitespace-nowrap",
            activeTab === 'reservations' 
              ? "bg-emerald-50 text-emerald-700 shadow-sm" 
              : "text-zinc-600 hover:bg-zinc-50"
          )}
        >
          <CalendarIcon className="w-4 h-4" />
          Agenda e Reservas
        </button>
        <button
          onClick={() => setActiveTab('financial')}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-all whitespace-nowrap",
            activeTab === 'financial' 
              ? "bg-emerald-50 text-emerald-700 shadow-sm" 
              : "text-zinc-600 hover:bg-zinc-50"
          )}
        >
          <DollarSign className="w-4 h-4" />
          Promoções
        </button>
      </div>

      {/* Content */}
      {activeTab === 'dashboard' && renderDashboard()}
      {activeTab === 'fields' && renderFields()}
      {activeTab === 'reservations' && renderReservations()}
      {activeTab === 'financial' && renderFinancial()}

      {/* Field Modal */}
      {isFieldModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-zinc-900">{editingField ? 'Editar Campo' : 'Novo Campo'}</h3>
              <button onClick={() => setIsFieldModalOpen(false)} className="text-zinc-400 hover:text-zinc-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!user) return;
              const formData = new FormData(e.currentTarget);
              const fieldData = {
                name: formData.get('name') as string,
                type: formData.get('type') as any,
                address: formData.get('address') as string,
                city: formData.get('city') as string,
                state: formData.get('state') as string,
                neighborhood: formData.get('neighborhood') as string,
                description: formData.get('description') as string,
                capacity: Number(formData.get('capacity')),
                pricePerHour: Number(formData.get('pricePerHour')),
                operatingHours: {
                  open: formData.get('openTime') as string,
                  close: formData.get('closeTime') as string,
                },
                managerId: user.uid,
                createdAt: editingField ? editingField.createdAt : new Date().toISOString(),
                photos: editingField?.photos || []
              };

              try {
                if (editingField) {
                  await updateDoc(doc(db, 'fields', editingField.id), fieldData);
                } else {
                  await addDoc(collection(db, 'fields'), fieldData);
                }
                setIsFieldModalOpen(false);
              } catch (error) {
                console.error("Error saving field:", error);
                alert("Erro ao salvar campo.");
              }
            }} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Nome da Quadra/Campo</label>
                  <input type="text" name="name" defaultValue={editingField?.name} required className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Tipo</label>
                  <select name="type" defaultValue={editingField?.type || 'Fut7'} className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none">
                    <option value="Fut7">Fut7</option>
                    <option value="Futsal">Futsal</option>
                    <option value="Society">Society</option>
                    <option value="Campo">Campo (11)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Endereço Completo</label>
                <input type="text" name="address" defaultValue={editingField?.address} required className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Estado (Sigla)</label>
                  <input type="text" name="state" defaultValue={editingField?.state} required maxLength={2} className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none uppercase" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Cidade</label>
                  <input type="text" name="city" defaultValue={editingField?.city} required className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Bairro</label>
                  <input type="text" name="neighborhood" defaultValue={editingField?.neighborhood} required className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Descrição</label>
                <textarea name="description" defaultValue={editingField?.description} rows={3} className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"></textarea>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Capacidade (Jogadores)</label>
                  <input type="number" name="capacity" defaultValue={editingField?.capacity || 14} required className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Preço por Hora (R$)</label>
                  <input type="number" name="pricePerHour" defaultValue={editingField?.pricePerHour || 150} required className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Horário de Abertura</label>
                  <input type="time" name="openTime" defaultValue={editingField?.operatingHours.open || '08:00'} required className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Horário de Fechamento</label>
                  <input type="time" name="closeTime" defaultValue={editingField?.operatingHours.close || '23:00'} required className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => setIsFieldModalOpen(false)} className="px-4 py-2 text-zinc-600 hover:bg-zinc-100 rounded-lg font-medium transition-colors">
                  Cancelar
                </button>
                <button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg font-medium transition-colors">
                  Salvar Campo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reservation Modal */}
      {isReservationModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-zinc-900">{editingReservation ? 'Editar Reserva' : 'Nova Reserva Manual'}</h3>
              <button onClick={() => { setIsReservationModalOpen(false); setEditingReservation(null); }} className="text-zinc-400 hover:text-zinc-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!user) return;
              const formData = new FormData(e.currentTarget);
              const fieldId = formData.get('fieldId') as string;
              const field = fields.find(f => f.id === fieldId);
              if (!field) return;

              const duration = Number(formData.get('duration'));
              const type = formData.get('type') as string;
              const startDateStr = formData.get('date') as string;
              const startTime = formData.get('startTime') as string;
              const endTime = formData.get('endTime') as string;
              const teamName = formData.get('teamName') as string;
              
              const valuePerSession = field.pricePerHour * duration;
              const numSessions = type === 'mensal' && !editingReservation ? 4 : 1;

              try {
                if (editingReservation) {
                  await updateDoc(doc(db, 'reservations', editingReservation.id), {
                    fieldId,
                    teamName,
                    type,
                    date: startDateStr,
                    startTime,
                    endTime,
                    duration,
                    value: valuePerSession
                  });
                } else {
                  const batch = [];
                  for (let i = 0; i < numSessions; i++) {
                    const sessionDate = type === 'mensal' 
                      ? format(addWeeks(parseISO(startDateStr), i), 'yyyy-MM-dd')
                      : startDateStr;

                    const resData = {
                      fieldId,
                      teamName,
                      type,
                      date: sessionDate,
                      startTime,
                      endTime,
                      duration,
                      value: valuePerSession,
                      status: 'confirmed',
                      managerId: user.uid,
                      createdAt: new Date().toISOString()
                    };
                    batch.push(addDoc(collection(db, 'reservations'), resData));
                  }
                  
                  await Promise.all(batch);
                }
                setIsReservationModalOpen(false);
                setEditingReservation(null);
              } catch (error) {
                console.error("Error saving reservation:", error);
                alert("Erro ao salvar reserva.");
              }
            }} className="space-y-4">
              
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Quadra/Campo</label>
                <select name="fieldId" defaultValue={editingReservation?.fieldId} required className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none">
                  <option value="">Selecione um campo...</option>
                  {fields.map(f => (
                    <option key={f.id} value={f.id}>{f.name} - {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(f.pricePerHour)}/h</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Nome do Cliente/Time</label>
                <input type="text" name="teamName" defaultValue={editingReservation?.teamName} required className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Tipo de Reserva</label>
                <select name="type" defaultValue={editingReservation?.type || 'avulsa'} required className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none">
                  <option value="avulsa">Avulsa (Por Hora)</option>
                  <option value="mensal">Mensal</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Data</label>
                  <input type="date" name="date" defaultValue={editingReservation?.date} required className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Duração (horas)</label>
                  <input type="number" name="duration" defaultValue={editingReservation?.duration || 1} min={1} step={0.5} required className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Hora Início</label>
                  <input type="time" name="startTime" defaultValue={editingReservation?.startTime} required className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Hora Fim</label>
                  <input type="time" name="endTime" defaultValue={editingReservation?.endTime} required className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => { setIsReservationModalOpen(false); setEditingReservation(null); }} className="px-4 py-2 text-zinc-600 hover:bg-zinc-100 rounded-lg font-medium transition-colors">
                  Cancelar
                </button>
                <button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg font-medium transition-colors">
                  {editingReservation ? 'Salvar Alterações' : 'Confirmar Reserva'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
