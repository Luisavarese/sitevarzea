import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import { Trophy, Mail, Lock, User as UserIcon, ArrowLeft, CheckCircle2, Users, CalendarDays, TrendingUp, Shield, ChevronRight, Star } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { cn } from '../lib/utils';

export function Login() {
  const { user, signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword, loading } = useAuth();
  const [isLogin, setIsLogin] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [siteLogo, setSiteLogo] = useState<string | null>(null);
  const [logoLoading, setLogoLoading] = useState(true);
  
  const authSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchLogo() {
      try {
        const docSnap = await getDoc(doc(db, 'settings', 'general'));
        if (docSnap.exists() && docSnap.data().logoUrl) {
          setSiteLogo(docSnap.data().logoUrl);
        }
      } catch (error) {
        console.error("Error fetching site logo:", error);
      } finally {
        setLogoLoading(false);
      }
    }
    fetchLogo();
  }, []);

  const scrollToAuth = (loginMode: boolean) => {
    setIsLogin(loginMode);
    setIsRecovering(false);
    setError('');
    setSuccessMsg('');
    authSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/team" />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    
    if (isRecovering) {
      if (!email) {
        setError('Por favor, informe seu e-mail.');
        return;
      }
      setIsSubmitting(true);
      try {
        await resetPassword(email);
        setSuccessMsg('Se o e-mail estiver cadastrado, você receberá um link de recuperação. Verifique também sua caixa de spam.');
        setTimeout(() => setIsRecovering(false), 5000);
      } catch (err: any) {
        console.error(err);
        if (err.code === 'auth/user-not-found') {
          setError('Usuário não encontrado.');
        } else {
          setError('Ocorreu um erro ao tentar enviar o e-mail de recuperação.');
        }
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    setIsSubmitting(true);

    try {
      if (isLogin) {
        await signInWithEmail(email, password);
      } else {
        if (!name.trim()) {
          throw new Error('Por favor, informe seu nome.');
        }
        await signUpWithEmail(email, password, name);
      }
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        setError('E-mail ou senha incorretos.');
      } else if (err.code === 'auth/email-already-in-use') {
        setError('Este e-mail já está em uso.');
      } else if (err.code === 'auth/weak-password') {
        setError('A senha deve ter pelo menos 6 caracteres.');
      } else if (err.message) {
        setError(err.message);
      } else {
        setError('Ocorreu um erro ao tentar autenticar.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setIsSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      console.error(err);
      const isCancelled = 
        err.code === 'auth/cancelled-popup-request' || 
        err.code === 'auth/popup-closed-by-user' ||
        (err.message && (
          err.message.includes('auth/cancelled-popup-request') || 
          err.message.includes('auth/popup-closed-by-user')
        ));
        
      if (!isCancelled) {
        setError(err.message || 'Ocorreu um erro ao tentar entrar com o Google.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 font-sans selection:bg-emerald-500/30">
      {/* Hero Section */}
      <section className="relative pt-24 pb-32 lg:pt-36 lg:pb-40 overflow-hidden">
        {/* Background Image & Overlay */}
        <div className="absolute inset-0 z-0">
          <img 
            src="https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=1920&q=80" 
            alt="Campo de futebol" 
            className="w-full h-full object-cover opacity-40 mix-blend-luminosity"
            fetchPriority="high"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/30 via-zinc-950/80 to-zinc-950"></div>
          {/* Stadium lighting effect */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[150%] h-[150%] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-500/30 via-transparent to-transparent pointer-events-none"></div>
        </div>

        <div className="container mx-auto px-4 relative z-10 text-center max-w-4xl">
          {logoLoading ? (
            <div className="h-40 md:h-56 w-40 md:w-56 mx-auto mb-10 animate-pulse bg-zinc-800/50 rounded-full"></div>
          ) : siteLogo ? (
            <img src={siteLogo} alt="VárzeaBrasil" className="h-40 md:h-56 mx-auto mb-10 drop-shadow-2xl hover:scale-105 transition-transform duration-300" />
          ) : (
            <div className="inline-flex items-center justify-center w-24 h-24 md:w-32 md:h-32 rounded-3xl bg-emerald-500 mb-10 shadow-xl shadow-emerald-500/30">
              <Trophy className="w-12 h-12 md:w-16 md:h-16 text-zinc-950" />
            </div>
          )}
          
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-extrabold tracking-tight mb-6 text-white drop-shadow-sm">
            Chega de sofrer para encontrar <br className="hidden md:block" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-emerald-600">adversários pro seu time</span>
          </h1>
          
          <p className="text-lg md:text-xl text-zinc-300 mb-10 font-medium max-w-3xl mx-auto leading-relaxed">
            Criamos o Várzea Brasil para acabar com a dor de cabeça na hora de marcar jogos. Encontre times disponíveis, feche partidas rapidamente e <span className="text-emerald-400 font-bold">nunca mais deixe seu quadro vazio no final de semana.</span>
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button 
              onClick={() => scrollToAuth(false)}
              className="w-full sm:w-auto px-8 py-4 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold rounded-full transition-all transform hover:scale-105 active:scale-95 shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 text-lg"
            >
              Cadastrar Time Grátis
              <ChevronRight className="w-5 h-5" />
            </button>
            <button 
              onClick={() => scrollToAuth(true)}
              className="w-full sm:w-auto px-8 py-4 bg-zinc-800 hover:bg-zinc-700 text-white font-bold rounded-full transition-all border border-zinc-700 hover:border-zinc-600 text-lg"
            >
              Já tenho conta
            </button>
          </div>
        </div>
      </section>

      {/* Profiles Section */}
      <section className="py-20 bg-zinc-900 relative">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Escolha o seu perfil</h2>
            <p className="text-zinc-400 text-lg">Feito sob medida para a sua realidade na várzea.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Visitante Card */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-8 flex flex-col hover:border-emerald-500/30 transition-colors group">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-bold flex items-center gap-3">
                  <span className="text-3xl">👤</span> Visitante
                </h3>
                <span className="bg-emerald-500/10 text-emerald-400 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                  Grátis
                </span>
              </div>
              
              <p className="text-zinc-400 mb-8 min-h-[48px]">
                Jogue sem pagar mensalidade e sem limite de convites.
              </p>
              
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                  <span className="text-zinc-300">Marque jogos rapidamente</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                  <span className="text-zinc-300">Encontre adversários</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                  <span className="text-zinc-300">Participe de campeonatos</span>
                </li>
              </ul>
              
              <button 
                onClick={() => scrollToAuth(false)}
                className="w-full py-4 bg-zinc-800 hover:bg-zinc-700 text-white font-bold rounded-xl transition-all group-hover:bg-zinc-700"
              >
                Cadastrar Time Visitante
              </button>
            </div>

            {/* Mandante Card */}
            <div className="bg-gradient-to-b from-emerald-900/20 to-zinc-950 border border-emerald-500/30 rounded-3xl p-8 flex flex-col relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/20 blur-3xl rounded-full"></div>
              
              <div className="flex items-center justify-between mb-6 relative z-10">
                <h3 className="text-2xl font-bold flex items-center gap-3 text-white">
                  <span className="text-3xl">🏟️</span> Mandante
                </h3>
                <span className="bg-emerald-500 text-zinc-950 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider shadow-lg shadow-emerald-500/20">
                  2 Meses Grátis
                </span>
              </div>
              
              <div className="mb-8 min-h-[48px] relative z-10">
                <p className="text-zinc-300">Organize jogos e ganhe visibilidade.</p>
                <p className="text-emerald-400 text-sm font-medium mt-1">Depois apenas R$ 25/mês</p>
              </div>
              
              <ul className="space-y-4 mb-8 flex-1 relative z-10">
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                  <span className="text-zinc-300">Crie jogos no seu campo</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                  <span className="text-zinc-300">Destaque no ranking geral</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                  <span className="text-zinc-300">Receba desafios de outros times</span>
                </li>
              </ul>
              
              <button 
                onClick={() => scrollToAuth(false)}
                className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold rounded-xl transition-all shadow-lg shadow-emerald-500/20 relative z-10"
              >
                Cadastrar Time Mandante
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-20 bg-zinc-950 relative overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img 
            src="https://images.unsplash.com/photo-1574629810360-7efbb1925846?auto=format&fit=crop&w=1920&q=80" 
            alt="Jogadores em ação" 
            className="w-full h-full object-cover opacity-30"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-zinc-950"></div>
        </div>
        <div className="container mx-auto px-4 max-w-6xl relative z-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto bg-zinc-900 rounded-2xl flex items-center justify-center mb-6 text-emerald-500">
                <CalendarDays className="w-8 h-8" />
              </div>
              <h4 className="text-lg font-bold text-white mb-2">Marcação Simplificada</h4>
              <p className="text-zinc-400 text-sm">Agende jogos em segundos, sem complicação.</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 mx-auto bg-zinc-900 rounded-2xl flex items-center justify-center mb-6 text-emerald-500">
                <TrendingUp className="w-8 h-8" />
              </div>
              <h4 className="text-lg font-bold text-white mb-2">Ranking de Times</h4>
              <p className="text-zinc-400 text-sm">Suba de nível e mostre quem manda na várzea.</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 mx-auto bg-zinc-900 rounded-2xl flex items-center justify-center mb-6 text-emerald-500">
                <Trophy className="w-8 h-8" />
              </div>
              <h4 className="text-lg font-bold text-white mb-2">Campeonatos e Ligas</h4>
              <p className="text-zinc-400 text-sm">Participe de torneios oficiais da plataforma.</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 mx-auto bg-zinc-900 rounded-2xl flex items-center justify-center mb-6 text-emerald-500">
                <Users className="w-8 h-8" />
              </div>
              <h4 className="text-lg font-bold text-white mb-2">Visibilidade</h4>
              <p className="text-zinc-400 text-sm">Seu time visto por milhares de jogadores.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section className="py-20 relative border-y border-emerald-900/50 bg-emerald-950">
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-950/90 via-emerald-900/70 to-emerald-950/90"></div>
        </div>
        <div className="container mx-auto px-4 text-center relative z-10">
          <div className="flex flex-col md:flex-row items-center justify-center gap-8 md:gap-16">
            <div>
              <p className="text-4xl font-black text-emerald-500 mb-2">+100</p>
              <p className="text-zinc-300 font-medium">Times cadastrados</p>
            </div>
            <div className="hidden md:block w-px h-16 bg-zinc-800"></div>
            <div>
              <p className="text-4xl font-black text-emerald-500 mb-2">24/7</p>
              <p className="text-zinc-300 font-medium">Jogos acontecendo todos os dias</p>
            </div>
            <div className="hidden md:block w-px h-16 bg-zinc-800"></div>
            <div>
              <div className="flex items-center justify-center gap-1 mb-2">
                {[1,2,3,4,5].map(i => <Star key={i} className="w-8 h-8 text-emerald-500 fill-emerald-500" />)}
              </div>
              <p className="text-zinc-300 font-medium">Aprovado pela várzea</p>
            </div>
          </div>
        </div>
      </section>

      {/* Auth Section */}
      <section ref={authSectionRef} className="py-24 bg-zinc-950 relative">
        <div className="container mx-auto px-4 flex justify-center">
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl relative z-10">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-white mb-2">
                {isRecovering ? 'Recuperar Senha' : isLogin ? 'Bem-vindo de volta' : 'Crie sua conta grátis'}
              </h2>
              <p className="text-zinc-400 text-sm">
                {isRecovering 
                  ? 'Informe seu e-mail para receber as instruções.' 
                  : isLogin 
                    ? 'Entre para gerenciar seu time.' 
                    : 'Junte-se à maior comunidade da várzea.'}
              </p>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl mb-6 text-sm flex items-start gap-3">
                <Shield className="w-5 h-5 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {successMsg && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-4 rounded-xl mb-6 text-sm flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                <span>{successMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              {isRecovering ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-1.5">E-mail</label>
                    <div className="relative">
                      <Mail className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full pl-11 pr-4 py-3 bg-zinc-950 border border-zinc-800 rounded-xl text-white placeholder:text-zinc-600 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                        placeholder="seu@email.com"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-bold py-3.5 px-4 rounded-xl transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? (
                      <div className="w-5 h-5 border-2 border-zinc-950/30 border-t-zinc-950 rounded-full animate-spin"></div>
                    ) : 'Enviar instruções'}
                  </button>
                  <button 
                    type="button" 
                    onClick={() => {
                      setIsRecovering(false);
                      setError('');
                      setSuccessMsg('');
                    }}
                    className="w-full text-zinc-400 hover:text-white text-sm font-medium transition-colors flex items-center justify-center gap-2 mt-4"
                  >
                    <ArrowLeft className="w-4 h-4" /> Voltar para o login
                  </button>
                </>
              ) : (
                <>
                  {!isLogin && (
                    <div>
                      <label className="block text-sm font-medium text-zinc-300 mb-1.5">Nome completo</label>
                      <div className="relative">
                        <UserIcon className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                        <input
                          type="text"
                          required
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="w-full pl-11 pr-4 py-3 bg-zinc-950 border border-zinc-800 rounded-xl text-white placeholder:text-zinc-600 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                          placeholder="Seu nome"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-1.5">E-mail</label>
                    <div className="relative">
                      <Mail className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full pl-11 pr-4 py-3 bg-zinc-950 border border-zinc-800 rounded-xl text-white placeholder:text-zinc-600 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                        placeholder="seu@email.com"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="block text-sm font-medium text-zinc-300">Senha</label>
                      {isLogin && (
                        <button 
                          type="button"
                          onClick={() => {
                            setIsRecovering(true);
                            setError('');
                            setSuccessMsg('');
                          }}
                          className="text-xs text-emerald-500 hover:text-emerald-400 font-medium"
                        >
                          Esqueceu a senha?
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <Lock className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                      <input
                        type="password"
                        required
                        minLength={6}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full pl-11 pr-4 py-3 bg-zinc-950 border border-zinc-800 rounded-xl text-white placeholder:text-zinc-600 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                        placeholder="••••••••"
                      />
                    </div>
                    {!isLogin && (
                      <p className="text-xs text-zinc-500 mt-2">Mínimo de 6 caracteres</p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-bold py-3.5 px-4 rounded-xl transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
                  >
                    {isSubmitting ? (
                      <div className="w-5 h-5 border-2 border-zinc-950/30 border-t-zinc-950 rounded-full animate-spin"></div>
                    ) : isLogin ? 'Entrar na plataforma' : 'Cadastre seu time'}
                  </button>
                </>
              )}
            </form>

            {!isRecovering && (
              <>
                <div className="flex items-center gap-4 my-6">
                  <div className="h-px bg-zinc-800 flex-1"></div>
                  <span className="text-zinc-500 text-sm font-medium">ou</span>
                  <div className="h-px bg-zinc-800 flex-1"></div>
                </div>

                <button
                  onClick={handleGoogleSignIn}
                  type="button"
                  disabled={isSubmitting}
                  className="w-full bg-white text-zinc-900 hover:bg-zinc-100 font-bold py-3.5 px-4 rounded-xl transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                  </svg>
                  Continuar com Google
                </button>

                <p className="text-sm text-zinc-400 text-center mt-8">
                  {isLogin ? 'Não tem uma conta?' : 'Já tem uma conta?'}{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setIsLogin(!isLogin);
                      setError('');
                    }}
                    className="text-emerald-500 hover:text-emerald-400 font-bold transition-colors"
                  >
                    {isLogin ? 'Comece grátis agora' : 'Fazer login'}
                  </button>
                </p>
              </>
            )}
          </div>
        </div>
      </section>
      
      {/* Footer */}
      <footer className="py-8 bg-zinc-950 border-t border-zinc-900 text-center text-zinc-500 text-sm">
        <p>© {new Date().getFullYear()} VárzeaBrasil. Todos os direitos reservados.</p>
      </footer>
    </div>
  );
}
