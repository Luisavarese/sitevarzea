import { Trophy, Flame, Shield, Target, Medal } from 'lucide-react';

export const BADGES = {
  RAIZ_DA_VARZEA: {
    id: 'raiz_da_varzea',
    name: 'Raiz da Várzea',
    description: 'Cadastro completo na Várzea Brasil',
    icon: Shield,
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-100',
  },
  BATISMO_DE_FOGO: {
    id: 'batismo_de_fogo',
    name: 'Batismo de Fogo',
    description: 'Primeiro jogo realizado',
    icon: Target,
    color: 'text-blue-500',
    bgColor: 'bg-blue-100',
  },
  PRIMEIRO_SANGUE: {
    id: 'primeiro_sangue',
    name: 'Primeiro Sangue',
    description: 'Primeira vitória conquistada',
    icon: Medal,
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-100',
  },
  TRATOR_DA_VARZEA: {
    id: 'trator_da_varzea',
    name: 'Trator da Várzea',
    description: '5 vitórias seguidas',
    icon: Flame,
    color: 'text-orange-500',
    bgColor: 'bg-orange-100',
  },
  MAQUINA_MORTIFERA: {
    id: 'maquina_mortifera',
    name: 'Máquina Mortífera',
    description: '10 vitórias seguidas',
    icon: Trophy,
    color: 'text-red-500',
    bgColor: 'bg-red-100',
  }
};

export function calculateBadges(matchesData: any[], team: any, teamBadgesFromDb: string[] = []) {
  const earnedBadges: string[] = [...teamBadgesFromDb];
  
  if (team && team.name && team.managerName && team.whatsapp && team.state && team.city && team.neighborhood && team.uniformColor && team.gameType && team.teamLevel) {
    if (!earnedBadges.includes(BADGES.RAIZ_DA_VARZEA.id)) {
      earnedBadges.push(BADGES.RAIZ_DA_VARZEA.id);
    }
  }

  const validMatches = matchesData.filter(m => m.status === 'completed');
  
  if (validMatches.length > 0 && !earnedBadges.includes(BADGES.BATISMO_DE_FOGO.id)) {
    earnedBadges.push(BADGES.BATISMO_DE_FOGO.id);
  }

  validMatches.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let consecutiveWins = 0;
  let hasWin = false;

  for (const match of validMatches) {
    const isHome = match.homeTeamId === team.id;

    if (match.woTeamId) {
       if (match.resultStatus !== 'confirmed') continue;
       if (match.woTeamId !== team.id) {
         consecutiveWins++;
         hasWin = true;
       } else {
         consecutiveWins = 0;
       }
    } else if (match.quadros && match.quadros.length > 0) {
      match.quadros.forEach((q: any) => {
        if (q.status !== 'confirmed') return;
        
        const qMyGoals = isHome ? (q.homeScore || 0) : (q.awayScore || 0);
        const qOpponentGoals = isHome ? (q.awayScore || 0) : (q.homeScore || 0);
        
        if (qMyGoals > qOpponentGoals) {
          consecutiveWins++;
          hasWin = true;
        } else if (qMyGoals === qOpponentGoals) {
          consecutiveWins = 0;
        } else {
          consecutiveWins = 0;
        }

        if (hasWin && !earnedBadges.includes(BADGES.PRIMEIRO_SANGUE.id)) {
          earnedBadges.push(BADGES.PRIMEIRO_SANGUE.id);
        }
        if (consecutiveWins >= 5 && !earnedBadges.includes(BADGES.TRATOR_DA_VARZEA.id)) {
          earnedBadges.push(BADGES.TRATOR_DA_VARZEA.id);
        }
        if (consecutiveWins >= 10 && !earnedBadges.includes(BADGES.MAQUINA_MORTIFERA.id)) {
          earnedBadges.push(BADGES.MAQUINA_MORTIFERA.id);
        }
      });
    } else {
      if (match.resultStatus !== 'confirmed') continue;
      
      const myScore = isHome ? match.homeScore : match.awayScore;
      const opponentScore = isHome ? match.awayScore : match.homeScore;

      if (myScore !== undefined && opponentScore !== undefined) {
        if (myScore > opponentScore) {
          consecutiveWins++;
          hasWin = true;
        } else if (myScore === opponentScore) {
          consecutiveWins = 0;
        } else {
          consecutiveWins = 0;
        }

        if (hasWin && !earnedBadges.includes(BADGES.PRIMEIRO_SANGUE.id)) {
          earnedBadges.push(BADGES.PRIMEIRO_SANGUE.id);
        }
        if (consecutiveWins >= 5 && !earnedBadges.includes(BADGES.TRATOR_DA_VARZEA.id)) {
          earnedBadges.push(BADGES.TRATOR_DA_VARZEA.id);
        }
        if (consecutiveWins >= 10 && !earnedBadges.includes(BADGES.MAQUINA_MORTIFERA.id)) {
          earnedBadges.push(BADGES.MAQUINA_MORTIFERA.id);
        }
      }
    }
  }

  return earnedBadges;
}
