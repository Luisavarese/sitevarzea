import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { auth, db } from '../firebase';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  User,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail
} from 'firebase/auth';
import { doc, getDoc, setDoc, collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';

interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: 'admin' | 'manager' | 'field_manager';
  teamId?: string;
  createdAt: string;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  isAdmin: boolean;
  isFieldManager: boolean;
  loading: boolean;
  activeTeamId: string | null;
  myTeams: any[];
  setActiveTeamId: (teamId: string | null) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, name: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTeamId, setActiveTeamIdState] = useState<string | null>(null);
  const [myTeams, setMyTeams] = useState<any[]>([]);

  const isAdmin = user?.email === 'luis.silva.avarese@gmail.com' || profile?.role === 'admin';
  const isFieldManager = profile?.role === 'field_manager';

  useEffect(() => {
    let unsubscribeTeams: () => void;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      if (currentUser) {
        const userRef = doc(db, 'users', currentUser.uid);
        const userSnap = await getDoc(userRef);
        
        let currentProfile: UserProfile;
        if (userSnap.exists()) {
          currentProfile = userSnap.data() as UserProfile;
          
          // Auto-upgrade to admin if email matches
          if (currentUser.email === 'luis.silva.avarese@gmail.com' && currentProfile.role !== 'admin') {
            currentProfile.role = 'admin';
            await setDoc(userRef, { role: 'admin' }, { merge: true });
          }
          setProfile(currentProfile);
          setActiveTeamIdState(currentProfile.teamId || null);
        } else {
          // Create new user profile
          const newProfile: UserProfile = {
            uid: currentUser.uid,
            email: currentUser.email || '',
            displayName: currentUser.displayName || 'Usuário',
            photoURL: currentUser.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${currentUser.uid}`,
            role: currentUser.email === 'luis.silva.avarese@gmail.com' ? 'admin' : 'manager',
            createdAt: new Date().toISOString(),
          };
          
          await setDoc(userRef, newProfile);
          setProfile(newProfile);
          currentProfile = newProfile;
        }

        // Fetch teams managed by user
        const q = query(collection(db, 'teams'), where('managerId', '==', currentUser.uid));
        unsubscribeTeams = onSnapshot(q, (snap) => {
          const teams = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter((t: any) => !t.deleted);
          setMyTeams(teams);
          
          // If no active team is set but user has teams, set the first one
          if (!currentProfile.teamId && teams.length > 0) {
            setActiveTeamId(teams[0].id);
          } else if (currentProfile.teamId && !teams.some(t => t.id === currentProfile.teamId)) {
            // If active team is deleted, switch to another one or null
            setActiveTeamId(teams.length > 0 ? teams[0].id : null);
          }
        });

      } else {
        setProfile(null);
        setActiveTeamIdState(null);
        setMyTeams([]);
        if (unsubscribeTeams) unsubscribeTeams();
      }
      
      setLoading(false);
    });

    return () => {
      unsubscribe();
      if (unsubscribeTeams) unsubscribeTeams();
    };
  }, []);

  const setActiveTeamId = async (teamId: string | null) => {
    if (!user) return;
    setActiveTeamIdState(teamId);
    setProfile(prev => prev ? { ...prev, teamId } : null);
    await setDoc(doc(db, 'users', user.uid), { teamId }, { merge: true });
  };

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      const isCancelled = 
        error.code === 'auth/cancelled-popup-request' || 
        error.code === 'auth/popup-closed-by-user' ||
        (error.message && (
          error.message.includes('auth/cancelled-popup-request') || 
          error.message.includes('auth/popup-closed-by-user')
        ));
        
      if (isCancelled) {
        // Ignore these errors as they are expected user behaviors
        console.log('Google sign-in popup closed or cancelled by user.');
        return;
      }
      console.error('Error signing in with Google', error);
      throw error;
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      console.error('Error signing in with email', error);
      throw error;
    }
  };

  const signUpWithEmail = async (email: string, password: string, name: string) => {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(userCredential.user, {
        displayName: name,
        photoURL: `https://api.dicebear.com/7.x/avataaars/svg?seed=${userCredential.user.uid}`
      });
      
      // The onAuthStateChanged listener will handle creating the Firestore document
    } catch (error) {
      console.error('Error signing up with email', error);
      throw error;
    }
  };

  const resetPassword = async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (error) {
      console.error('Error sending password reset email', error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error signing out', error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{ user, profile, isAdmin, isFieldManager, loading, activeTeamId, myTeams, setActiveTeamId, signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
