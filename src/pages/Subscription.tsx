import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { doc, onSnapshot, updateDoc, collection, query, where, getDocs, deleteField, getDoc } from 'firebase/firestore';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { Check, CreditCard, AlertCircle, Trophy, Star, Zap, Shield, TrendingUp, ArrowLeft, Copy, MapPin } from 'lucide-react';
import { format, addMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '../lib/utils';
import { initMercadoPago, Payment } from '@mercadopago/sdk-react';

// Initialize Mercado Pago
const mpPublicKey = import.meta.env.VITE_MP_PUBLIC_KEY;
if (mpPublicKey) {
  initMercadoPago(mpPublicKey, { locale: 'pt-BR' });
}

const isPromoActive = new Date() <= new Date('2026-06-30T23:59:59-03:00');

const plansData = {
  premium: {
    title: "Premium",
    subtitle: "Acesso total a todos os recursos da Várzea Brasil",
    icon: <Trophy className="w-6 h-6 text-[#009c3b]" />,
    benefits: [
      "Buscar e criar jogos",
      "Participar de partidas como visitante ou mandante",
      "Ranking avançado",
      "Perfil completo do time",
      "Participação em campeonatos",
      "Selo de time ativo e maior visibilidade",
      "Promoção de partidas"
    ],
    cycles: [
      {
        id: 'premium_mensal',
        name: 'Mensal',
        period: 'Mensal',
        price: isPromoActive ? 12.50 : 25.00,
        pricePerMonth: isPromoActive ? 12.50 : 25.00,
        discount: isPromoActive ? 50 : 0,
        savings: isPromoActive ? 12.50 : 0,
        popular: false,
        badge: isPromoActive ? '50% OFF até 30/06' : undefined
      },
      {
        id: 'premium_trimestral',
        name: 'Trimestral',
        period: 'Trimestral',
        price: isPromoActive ? 35.00 : 70.00,
        pricePerMonth: isPromoActive ? 11.66 : 23.33,
        discount: isPromoActive ? 53.33 : 6.66,
        savings: isPromoActive ? 40.00 : 5.00,
        popular: false,
        badge: isPromoActive ? '50% OFF até 30/06' : undefined
      },
      {
        id: 'premium_semestral',
        name: 'Semestral',
        period: 'Semestral',
        price: 135.00,
        pricePerMonth: 22.50,
        discount: 10.00,
        savings: 15.00,
        popular: false
      },
      {
        id: 'premium_anual',
        name: 'Anual',
        period: 'Anual',
        price: 250.00,
        pricePerMonth: 20.83,
        discount: 16.68,
        savings: 50.00,
        popular: true,
        badge: 'MAIS VENDIDO'
      }
    ]
  }
};

export function Subscription() {
  const { user, profile, activeTeamId } = useAuth();
  const [team, setTeam] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [selectedCycle, setSelectedCycle] = useState('premium_anual');
  const [searchParams, setSearchParams] = useSearchParams();
  const [paymentStatusMsg, setPaymentStatusMsg] = useState<{type: 'success' | 'error' | 'info', text: string} | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [paymentResult, setPaymentResult] = useState<any>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const currentSub = team?.subscription;
    const isActive = currentSub?.status === 'active' && new Date(currentSub.expiresAt) > new Date();

    if (isActive && paymentResult) {
      if (paymentResult.status === 'pending') {
        setPaymentResult((prev: any) => ({ ...prev, status: 'approved' }));
      }
      
      const timer = setTimeout(() => {
        navigate('/');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [team, paymentResult, navigate]);

  useEffect(() => {
    // Check URL parameters for payment status redirect from Mercado Pago
    const status = searchParams.get('status');
    if (status === 'success') {
      setPaymentStatusMsg({ type: 'success', text: 'Pagamento aprovado com sucesso! Sua assinatura já está ativa.' });
      searchParams.delete('status');
      setSearchParams(searchParams);
    } else if (status === 'pending') {
      setPaymentStatusMsg({ type: 'info', text: 'Seu pagamento está pendente. Assim que for confirmado, sua assinatura será ativada.' });
      searchParams.delete('status');
      setSearchParams(searchParams);
    } else if (status === 'failure') {
      setPaymentStatusMsg({ type: 'error', text: 'Houve um problema com seu pagamento. Por favor, tente novamente.' });
      searchParams.delete('status');
      setSearchParams(searchParams);
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!user || !activeTeamId) {
      setLoading(false);
      return;
    }
    
    // Listen to real-time updates so the UI updates automatically when webhook confirms payment
    const unsubscribe = onSnapshot(doc(db, 'teams', activeTeamId), (docSnap) => {
      if (docSnap.exists()) {
        setTeam({ id: docSnap.id, ...docSnap.data() });
      }
      setLoading(false);
    }, (error) => {
      console.error("Error fetching team:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, activeTeamId]);

  const handleSubscribe = async () => {
    if (!team || !user) return;
    
    // If upgrading from visitante_free and hasn't used trial yet
    const profileDoc = await getDoc(doc(db, 'users', user.uid));
    const hasUsedTrial = profileDoc.exists() ? profileDoc.data().hasUsedTrial : false;

    if (team.subscription?.plan === 'visitante_free' && !hasUsedTrial) {
      setProcessing(true);
      try {
        const now = new Date();
        const expiresAt = addMonths(now, 2);
        await updateDoc(doc(db, 'teams', team.id), {
          subscription: {
            status: 'active',
            plan: 'mandante_trial',
            startedAt: now.toISOString(),
            expiresAt: expiresAt.toISOString()
          }
        });
        await updateDoc(doc(db, 'users', user.uid), {
          hasUsedTrial: true
        });
        setPaymentStatusMsg({ type: 'success', text: 'Você ativou seus 2 meses de isenção como Mandante!' });
      } catch (error) {
        console.error("Error upgrading to trial:", error);
        setPaymentStatusMsg({ type: 'error', text: 'Erro ao ativar isenção.' });
      } finally {
        setProcessing(false);
      }
      return;
    }
    
    const cycle = plansData.premium.cycles.find(c => c.id === selectedCycle);
    if (!cycle) return;

    setShowCheckout(true);
  };

  const clearAllSubscriptions = async () => {
    if (!window.confirm("Tem certeza que deseja excluir a assinatura de TODOS os times?")) return;
    
    setProcessing(true);
    try {
      const teamsSnapshot = await getDocs(collection(db, 'teams'));
      let successCount = 0;
      let failCount = 0;
      let lastError = "";

      for (const docSnap of teamsSnapshot.docs) {
        try {
          await updateDoc(docSnap.ref, { subscription: null });
          successCount++;
        } catch (err: any) {
          failCount++;
          lastError = err.message || "Erro desconhecido";
          console.error(`Erro ao atualizar time ${docSnap.id}:`, err);
        }
      }

      if (failCount > 0) {
        alert(`Aviso: ${successCount} times limpos, mas ${failCount} falharam. Último erro: ${lastError}`);
      } else {
        alert(`Sucesso! ${successCount} assinaturas foram excluídas.`);
      }
    } catch (error: any) {
      console.error("Erro ao buscar times:", error);
      alert(`Erro ao buscar times: ${error.message || 'Erro desconhecido'}`);
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#009c3b]"></div></div>;
  }

  if (!team) {
    return (
      <div className="bg-zinc-50 border-2 border-dashed border-zinc-200 rounded-2xl p-12 text-center">
        <h3 className="text-lg font-medium text-zinc-900 mb-2">Crie seu time primeiro</h3>
        <p className="text-zinc-500">Você precisa ter um time cadastrado para assinar um plano.</p>
      </div>
    );
  }

  const currentSub = team.subscription;
  const isActive = currentSub?.status === 'active' && new Date(currentSub.expiresAt) > new Date();

  const formatPlanName = (planId: string) => {
    if (!planId) return '';
    const parts = planId.split('_');
    return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  };

  if (showCheckout) {
    const cycle = plansData.premium.cycles.find(c => c.id === selectedCycle);
    if (!cycle) return null;

    return (
      <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-500 pb-12">
        <button 
          onClick={() => {
            setShowCheckout(false);
            setPaymentResult(null);
          }}
          className="flex items-center gap-2 text-zinc-600 hover:text-zinc-900 font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar para os planos
        </button>

        <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-6 md:p-8">
          <div className="flex items-center justify-between mb-8 pb-6 border-b border-zinc-100">
            <div>
              <h2 className="text-2xl font-bold text-zinc-900">Finalizar Assinatura</h2>
              <p className="text-zinc-500 mt-1">Plano {cycle.name} - Várzea Brasil Premium</p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-extrabold text-zinc-900">
                R$ {cycle.price.toFixed(2).replace('.', ',')}
              </div>
              <div className="text-sm text-zinc-500">Total a pagar</div>
            </div>
          </div>

          {paymentResult?.status === 'pending' && paymentResult?.payment_method_id === 'pix' ? (
            <div className="text-center space-y-6 py-8">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8" />
              </div>
              <h3 className="text-2xl font-bold text-zinc-900">Pedido gerado com sucesso!</h3>
              <p className="text-zinc-600 max-w-md mx-auto">
                Escaneie o QR Code abaixo com o aplicativo do seu banco ou copie o código Pix Copia e Cola para finalizar o pagamento.
              </p>
              
              {paymentResult.point_of_interaction?.transaction_data?.qr_code_base64 && (
                <div className="flex justify-center my-8">
                  <img 
                    src={`data:image/jpeg;base64,${paymentResult.point_of_interaction.transaction_data.qr_code_base64}`} 
                    alt="QR Code Pix" 
                    className="w-64 h-64 border-4 border-zinc-100 rounded-xl shadow-sm"
                  />
                </div>
              )}

              {paymentResult.point_of_interaction?.transaction_data?.qr_code && (
                <div className="max-w-md mx-auto">
                  <p className="text-sm font-medium text-zinc-700 mb-2 text-left">Pix Copia e Cola:</p>
                  <div className="flex items-center gap-2">
                    <input 
                      type="text" 
                      readOnly 
                      value={paymentResult.point_of_interaction.transaction_data.qr_code}
                      className="flex-1 bg-zinc-50 border border-zinc-200 rounded-lg px-4 py-3 text-sm text-zinc-600 focus:outline-none"
                    />
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(paymentResult.point_of_interaction.transaction_data.qr_code);
                        alert("Código copiado!");
                      }}
                      className="p-3 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 transition-colors"
                      title="Copiar código"
                    >
                      <Copy className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-8 p-4 bg-blue-50 text-blue-800 rounded-lg text-sm">
                Assim que o pagamento for confirmado, sua assinatura será ativada automaticamente. Você já pode voltar para a tela inicial.
              </div>
            </div>
          ) : paymentResult?.status === 'approved' ? (
            <div className="text-center space-y-4 py-12">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8" />
              </div>
              <h3 className="text-2xl font-bold text-zinc-900">Pagamento Aprovado!</h3>
              <p className="text-zinc-600">Sua assinatura Premium já está ativa.</p>
              <p className="text-sm text-zinc-500 mt-2 animate-pulse">Redirecionando para a página inicial...</p>
              <button 
                onClick={() => {
                  navigate('/');
                }}
                className="mt-6 px-6 py-3 bg-[#009c3b] text-white rounded-xl font-medium hover:bg-[#008231] transition-colors"
              >
                Acessar Recursos Premium
              </button>
            </div>
          ) : (
            <>
              {paymentResult?.status === 'rejected' && (
                <div className="mb-6 p-4 bg-red-50 text-red-700 border border-red-200 rounded-xl flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <p className="text-sm font-medium">Pagamento recusado. Por favor, verifique os dados ou tente outro método de pagamento.</p>
                </div>
              )}
              <Payment
                initialization={{ amount: cycle.price }}
              customization={{
                paymentMethods: {
                  ticket: "all",
                  bankTransfer: "all",
                  creditCard: "all",
                  debitCard: "all",
                  mercadoPago: "all",
                },
              }}
              onSubmit={async (param) => {
                try {
                  const res = await fetch('/api/process-payment', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                      formData: param.formData, 
                      teamId: team.id, 
                      planType: cycle.id 
                    })
                  });
                  const data = await res.json();
                  setPaymentResult(data);
                  
                  if (data.status === 'approved') {
                    // Update UI immediately or let webhook handle it
                  }
                } catch (error) {
                  console.error("Payment error:", error);
                  alert("Erro ao processar pagamento. Tente novamente.");
                }
              }}
              onError={(error) => {
                console.error("Mercado Pago Error:", error);
              }}
            />
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-6xl mx-auto pb-12">
      {paymentStatusMsg && (
        <div className={cn(
          "p-4 rounded-xl border flex items-center gap-3 mb-8",
          paymentStatusMsg.type === 'success' ? "bg-emerald-50 border-emerald-200 text-emerald-800" :
          paymentStatusMsg.type === 'error' ? "bg-red-50 border-red-200 text-red-800" :
          "bg-blue-50 border-blue-200 text-blue-800"
        )}>
          {paymentStatusMsg.type === 'success' && <Check className="w-5 h-5 text-emerald-600" />}
          {paymentStatusMsg.type === 'error' && <AlertCircle className="w-5 h-5 text-red-600" />}
          {paymentStatusMsg.type === 'info' && <AlertCircle className="w-5 h-5 text-blue-600" />}
          <span className="font-medium">{paymentStatusMsg.text}</span>
        </div>
      )}

      <header className="mb-12 text-center space-y-4">
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-zinc-900">
          Escolha seu plano e leve seu time para o <span className="text-[#009c3b]">próximo nível</span>
        </h1>
        <p className="text-xl text-zinc-600 max-w-2xl mx-auto font-medium">
          Mais visibilidade, mais jogos, mais competitividade na várzea
        </p>
        
        <div className="flex flex-wrap justify-center gap-4 mt-6 pt-4">
          <div className="flex items-center gap-2 bg-zinc-100 px-4 py-2 rounded-full text-sm font-semibold text-zinc-800">
            <TrendingUp className="w-4 h-4 text-[#009c3b]" />
            Aumente suas chances de jogar
          </div>
          <div className="flex items-center gap-2 bg-zinc-100 px-4 py-2 rounded-full text-sm font-semibold text-zinc-800">
            <Star className="w-4 h-4 text-[#009c3b]" />
            Mais visibilidade para seu time
          </div>
          <div className="flex items-center gap-2 bg-[#009c3b]/10 px-4 py-2 rounded-full text-sm font-bold text-[#009c3b]">
            <Zap className="w-4 h-4" />
            Economize até 33%
          </div>
        </div>
        
        {user?.email === 'luis.silva.avarese@gmail.com' && (
          <div className="mt-8 pt-8 border-t border-zinc-200">
            <button
              onClick={clearAllSubscriptions}
              disabled={processing}
              className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50"
            >
              [Admin] Excluir TODAS as assinaturas (Testes)
            </button>
          </div>
        )}
      </header>

      {isActive && (
        <div className={cn(
          "border rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4 mb-8",
          currentSub.plan === 'visitante_free' ? "bg-blue-50 border-blue-200" :
          currentSub.plan === 'mandante_trial' ? "bg-amber-50 border-amber-200" :
          "bg-[#009c3b]/10 border-[#009c3b]/20"
        )}>
          <div className="flex items-center gap-4">
            <div className={cn(
              "w-12 h-12 rounded-full flex items-center justify-center",
              currentSub.plan === 'visitante_free' ? "bg-blue-100 text-blue-600" :
              currentSub.plan === 'mandante_trial' ? "bg-amber-100 text-amber-600" :
              "bg-[#009c3b]/20 text-[#009c3b]"
            )}>
              {currentSub.plan === 'visitante_free' ? <MapPin className="w-6 h-6" /> :
               currentSub.plan === 'mandante_trial' ? <Shield className="w-6 h-6" /> :
               <Check className="w-6 h-6" />}
            </div>
            <div>
              <h3 className={cn(
                "text-lg font-bold",
                currentSub.plan === 'visitante_free' ? "text-blue-900" :
                currentSub.plan === 'mandante_trial' ? "text-amber-900" :
                "text-zinc-900"
              )}>
                {currentSub.plan === 'visitante_free' ? 'Time Visitante' :
                 currentSub.plan === 'mandante_trial' ? 'Isenção de Mandante' :
                 'Assinatura Ativa'}
              </h3>
              <p className={cn(
                "text-sm",
                currentSub.plan === 'visitante_free' ? "text-blue-700" :
                currentSub.plan === 'mandante_trial' ? "text-amber-700" :
                "text-zinc-600"
              )}>
                {currentSub.plan === 'visitante_free' ? 'Times visitantes não pagam mensalidade.' :
                 currentSub.plan === 'mandante_trial' ? `Válido até ${currentSub.expiresAt && !isNaN(new Date(currentSub.expiresAt).getTime()) ? format(new Date(currentSub.expiresAt), "dd 'de' MMMM 'de' yyyy", { locale: ptBR }) : 'Data Inválida'}. Assine um plano para continuar após esse período.` :
                 `Plano ${formatPlanName(currentSub.plan)}. Válido até ${currentSub.expiresAt && !isNaN(new Date(currentSub.expiresAt).getTime()) ? format(new Date(currentSub.expiresAt), "dd 'de' MMMM 'de' yyyy", { locale: ptBR }) : 'Data Inválida'}.`}
              </p>
            </div>
          </div>
          <div className={cn(
            "text-sm font-bold bg-white px-4 py-2 rounded-lg shadow-sm border",
            currentSub.plan === 'visitante_free' ? "text-blue-600 border-blue-100" :
            currentSub.plan === 'mandante_trial' ? "text-amber-600 border-amber-100" :
            "text-[#009c3b] border-[#009c3b]/10"
          )}>
            {currentSub.plan === 'visitante_free' ? 'Acesso Gratuito' :
             currentSub.plan === 'mandante_trial' ? 'Período de Teste' :
             'Recursos Premium Liberados'}
          </div>
        </div>
      )}

      {!isActive && currentSub && (
        <div className="bg-red-50 border border-red-100 rounded-2xl p-6 flex items-center gap-4 mb-8">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-red-600">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-red-900">Assinatura Expirada ou Inativa</h3>
            <p className="text-sm text-red-700">
              Renove sua assinatura para continuar com os benefícios premium.
            </p>
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto">
        {/* Card Premium */}
        <div className={cn(
          "bg-white rounded-3xl border-2 p-6 md:p-8 shadow-sm relative overflow-hidden transition-all flex flex-col h-full",
          currentSub?.plan?.startsWith('premium') && isActive ? "border-[#009c3b] shadow-md" : "border-zinc-200 hover:border-zinc-300"
        )}>
          {currentSub?.plan?.startsWith('premium') && isActive && (
            <div className="absolute top-0 right-0 bg-[#009c3b] text-white text-xs font-bold px-4 py-1.5 rounded-bl-xl">
              SEU PLANO ATUAL
            </div>
          )}
          
          <div className="flex items-center gap-3 mb-2">
            {plansData.premium.icon}
            <h3 className="text-2xl font-black text-zinc-900 uppercase tracking-tight">{plansData.premium.title}</h3>
          </div>
          <p className="text-zinc-500 font-medium mb-6">{plansData.premium.subtitle}</p>
          
          <div className="space-y-3 mb-8 flex-grow">
            {plansData.premium.cycles.map((cycle) => (
              <label 
                key={cycle.id}
                className={cn(
                  "flex items-center justify-between p-4 rounded-xl border-2 cursor-pointer transition-all relative",
                  selectedCycle === cycle.id 
                    ? cycle.popular ? "border-[#009c3b] bg-[#009c3b]/10 shadow-md shadow-[#009c3b]/20 scale-[1.02] z-10" : "border-zinc-900 bg-zinc-50" 
                    : cycle.popular ? "border-[#009c3b]/50 bg-[#009c3b]/5 hover:border-[#009c3b]" : "border-zinc-200 hover:border-zinc-300 bg-white"
                )}
                onClick={() => setSelectedCycle(cycle.id)}
              >
                {cycle.badge && (
                  <div className={cn(
                    "absolute -top-3 left-4 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
                    cycle.popular ? "bg-[#009c3b]" : "bg-amber-500"
                  )}>
                    {cycle.badge}
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0",
                    selectedCycle === cycle.id ? (cycle.popular ? "border-[#009c3b]" : "border-zinc-900") : "border-zinc-300"
                  )}>
                    {selectedCycle === cycle.id && (
                      <div className={cn("w-2.5 h-2.5 rounded-full", cycle.popular ? "bg-[#009c3b]" : "bg-zinc-900")} />
                    )}
                  </div>
                  <div>
                    <div className="font-bold text-zinc-900 flex items-center gap-2 flex-wrap">
                      {cycle.name}
                      {cycle.discount > 0 && (
                        <span className="text-[10px] bg-green-100 text-green-800 px-1.5 py-0.5 rounded font-bold whitespace-nowrap">
                          -{cycle.discount}%
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-500 font-medium flex items-center gap-1">
                      {cycle.period}
                      {cycle.discount > 0 && (
                        <span className="text-[#009c3b] font-bold">
                          (Economize R$ {cycle.savings.toFixed(2).replace('.', ',')})
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-black text-zinc-900">R$ {cycle.pricePerMonth.toFixed(2).replace('.', ',')}<span className="text-xs font-medium text-zinc-500">/mês</span></div>
                  {cycle.period !== 'Mensal' && (
                    <div className="text-[10px] text-zinc-500 font-medium">Total: R$ {cycle.price.toFixed(2).replace('.', ',')}</div>
                  )}
                </div>
              </label>
            ))}
          </div>

          <div className="mb-8 bg-zinc-50 p-5 rounded-2xl">
            <h4 className="text-sm font-bold text-zinc-900 mb-4 uppercase tracking-wider">Benefícios incluídos:</h4>
            <ul className="space-y-3">
              {plansData.premium.benefits.map((benefit, idx) => (
                <li key={idx} className="flex items-start gap-3 text-sm font-medium text-zinc-700">
                  <Check className="w-5 h-5 text-[#009c3b] shrink-0" />
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
          </div>

          <button
            onClick={handleSubscribe}
            disabled={processing || (currentSub?.plan?.startsWith('premium') && isActive)}
            className={cn(
              "w-full py-4 px-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all text-lg",
              currentSub?.plan?.startsWith('premium') && isActive
                ? "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                : selectedCycle === 'premium_anual'
                  ? "bg-[#009c3b] hover:bg-[#008a34] text-white shadow-lg shadow-green-500/20"
                  : "bg-zinc-900 hover:bg-zinc-800 text-white"
            )}
          >
            {processing ? (
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
            ) : currentSub?.plan?.startsWith('premium') && isActive ? (
              'Assinatura Ativa'
            ) : (
              <>
                <CreditCard className="w-5 h-5" />
                {currentSub?.plan === 'visitante_free' && !(profile as any)?.hasUsedTrial 
                  ? 'Mudar para Mandante (2 Meses Grátis)' 
                  : selectedCycle === 'premium_anual' ? 'Começar agora' : 'Assinar plano'}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Log da Assinatura */}
      {currentSub && (
        <div className="mt-12 bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm">
          <h3 className="text-lg font-bold text-zinc-900 mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-[#009c3b]" />
            Log da Assinatura
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 text-sm">
            <div className="space-y-1">
              <p className="text-zinc-500 font-medium">Data da assinatura</p>
              <p className="font-semibold text-zinc-900">
                {currentSub.startedAt && !isNaN(new Date(currentSub.startedAt).getTime()) ? format(new Date(currentSub.startedAt), "dd/MM/yyyy HH:mm") : 'N/A'}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-zinc-500 font-medium">Plano escolhido</p>
              <p className="font-semibold text-zinc-900">
                {formatPlanName(currentSub.plan)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-zinc-500 font-medium">Início da assinatura</p>
              <p className="font-semibold text-zinc-900">
                {currentSub.startedAt && currentSub.status === 'active' && !isNaN(new Date(currentSub.startedAt).getTime()) ? format(new Date(currentSub.startedAt), "dd/MM/yyyy") : 'Aguardando'}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-zinc-500 font-medium">Fim da assinatura</p>
              <p className="font-semibold text-zinc-900">
                {currentSub.expiresAt && currentSub.status === 'active' && !isNaN(new Date(currentSub.expiresAt).getTime()) ? format(new Date(currentSub.expiresAt), "dd/MM/yyyy") : 'Aguardando'}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-zinc-500 font-medium">Status</p>
              <p className={cn(
                "font-bold",
                currentSub.status === 'active' ? "text-[#009c3b]" : 
                currentSub.status === 'pending' ? "text-yellow-600" : "text-red-600"
              )}>
                {currentSub.status === 'active' ? 'Ativo' : 
                 currentSub.status === 'pending' ? 'Pendente' : 'Inativo'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
