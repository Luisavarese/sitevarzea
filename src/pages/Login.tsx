import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import { Trophy, Mail, Lock, User as UserIcon, ArrowLeft } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

export function Login() {
  const { user, signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword, loading } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [isRecovering, setIsRecovering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [siteLogo, setSiteLogo] = useState<string | null>(null);

  useEffect(() => {
    async function fetchLogo() {
      try {
        const docSnap = await getDoc(doc(db, 'settings', 'general'));
        if (docSnap.exists() && docSnap.data().logoUrl) {
          setSiteLogo(docSnap.data().logoUrl);
        }
      } catch (error) {
        console.error("Error fetching site logo:", error);
      }
    }
    fetchLogo();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#002776]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#ffdf00]"></div>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/" />;
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
        
      if (isCancelled) {
        // Ignore
      } else {
        setError(err.message || 'Ocorreu um erro ao tentar entrar com o Google.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen relative flex flex-col items-center justify-center p-4 overflow-hidden">
      {/* Background Image */}
      <div 
        className="absolute inset-0 w-full h-full bg-cover bg-center z-0"
        style={{ 
          backgroundImage: 'url("https://images.unsplash.com/photo-1574629810360-7efbb1925846?auto=format&fit=crop&q=80")',
        }}
      >
        <div className="absolute inset-0 bg-black/60"></div>
      </div>

      <div className="w-full max-w-md bg-[#002776]/90 backdrop-blur-md border border-[#009c3b]/50 rounded-2xl p-8 shadow-2xl text-center relative z-10">
        {siteLogo ? (
          <div className="w-48 h-48 mx-auto mb-6 flex items-center justify-center">
            <img src={siteLogo} alt="Várzea Brasil Logo" className="w-full h-full object-contain drop-shadow-lg" />
          </div>
        ) : (
          <div className="w-32 h-32 bg-[#009c3b] rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
            <Trophy className="w-16 h-16 text-[#ffdf00]" />
          </div>
        )}
        
        <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Várzea Brasil</h1>
        <p className="text-blue-200 mb-6">
          O principal aplicativo para agendamento e gestão de times de futebol de várzea.
        </p>

        {error && (
          <div className="bg-red-500/10 border border-red-500/50 text-red-200 p-3 rounded-lg mb-6 text-sm">
            {error}
          </div>
        )}

        {successMsg && (
          <div className="bg-emerald-500/10 border border-emerald-500/50 text-emerald-200 p-3 rounded-lg mb-6 text-sm">
            {successMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 mb-6 text-left">
          {isRecovering ? (
            <>
              <div className="flex items-center gap-2 mb-4">
                <button 
                  type="button" 
                  onClick={() => {
                    setIsRecovering(false);
                    setError('');
                    setSuccessMsg('');
                  }}
                  className="text-blue-300 hover:text-white transition-colors"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-xl font-semibold text-white">Recuperar Senha</h2>
              </div>
              <p className="text-sm text-blue-200 mb-4">
                Informe seu e-mail para receber um link de recuperação de senha.
              </p>
              <div>
                <label className="block text-sm font-medium text-blue-200 mb-1">E-mail <span className="text-red-500">*</span></label>
                <div className="relative">
                  <Mail className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-blue-300" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-blue-300/50 focus:ring-2 focus:ring-[#ffdf00] focus:border-transparent outline-none transition-all"
                    placeholder="seu@email.com"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-[#009c3b] text-white hover:bg-[#007d2f] font-bold py-3 px-4 rounded-xl transition-all shadow-md disabled:opacity-50 mt-4"
              >
                {isSubmitting ? 'Enviando...' : 'Enviar e-mail de recuperação'}
              </button>
            </>
          ) : (
            <>
              {!isLogin && (
                <div>
                  <label className="block text-sm font-medium text-blue-200 mb-1">Nome <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <UserIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-blue-300" />
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-blue-300/50 focus:ring-2 focus:ring-[#ffdf00] focus:border-transparent outline-none transition-all"
                      placeholder="Seu nome completo"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-blue-200 mb-1">E-mail <span className="text-red-500">*</span></label>
                <div className="relative">
                  <Mail className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-blue-300" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-blue-300/50 focus:ring-2 focus:ring-[#ffdf00] focus:border-transparent outline-none transition-all"
                    placeholder="seu@email.com"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-sm font-medium text-blue-200">Senha <span className="text-red-500">*</span></label>
                  {isLogin && (
                    <button 
                      type="button"
                      onClick={() => {
                        setIsRecovering(true);
                        setError('');
                        setSuccessMsg('');
                      }}
                      className="text-xs text-[#ffdf00] hover:underline"
                    >
                      Esqueceu a senha?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-blue-300" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-blue-300/50 focus:ring-2 focus:ring-[#ffdf00] focus:border-transparent outline-none transition-all"
                    placeholder="••••••••"
                  />
                </div>
                {!isLogin && (
                  <p className="text-xs text-blue-300/70 mt-1 ml-1">Mínimo de 6 caracteres</p>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-[#009c3b] text-white hover:bg-[#007d2f] font-bold py-3 px-4 rounded-xl transition-all shadow-md disabled:opacity-50"
              >
                {isSubmitting ? 'Aguarde...' : (isLogin ? 'Entrar' : 'Criar Conta')}
              </button>
            </>
          )}
        </form>

        {!isRecovering && (
          <>
            <div className="flex items-center gap-4 mb-6">
              <div className="h-px bg-white/20 flex-1"></div>
              <span className="text-blue-200 text-sm">ou</span>
              <div className="h-px bg-white/20 flex-1"></div>
            </div>

            <button
              onClick={handleGoogleSignIn}
              type="button"
              disabled={isSubmitting}
              className="w-full bg-[#ffdf00] text-[#002776] hover:bg-[#e6c800] font-bold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-3 shadow-md mb-6 disabled:opacity-50"
            >
              <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
              Entrar com Google
            </button>

            <p className="text-sm text-blue-200">
              {isLogin ? 'Não tem uma conta?' : 'Já tem uma conta?'}{' '}
              <button
                type="button"
                onClick={() => {
                  setIsLogin(!isLogin);
                  setError('');
                }}
                className="text-[#ffdf00] hover:underline font-semibold"
              >
                {isLogin ? 'Criar agora' : 'Fazer login'}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
