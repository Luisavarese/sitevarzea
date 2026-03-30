import { Trophy, Flame, Shield, Target, Medal } from 'lucide-react';

export const BADGES = {
  INVENCIVEL: {
    id: 'invencivel',
    name: 'Invencível',
    description: '5 vitórias seguidas',
    icon: Medal,
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-100',
  },
  SEQUENCIA_INSANA: {
    id: 'sequencia_insana',
    name: 'Sequência Insana',
    description: '10 jogos sem perder',
    icon: Flame,
    color: 'text-orange-500',
    bgColor: 'bg-orange-100',
  },
  ARTILHEIRO: {
    id: 'artilheiro',
    name: 'Artilheiro',
    description: '10 gols marcados',
    icon: Target,
    color: 'text-blue-500',
    bgColor: 'bg-blue-100',
  },
  DEFESA_DE_FERRO: {
    id: 'defesa_de_ferro',
    name: 'Defesa de Ferro',
    description: '3 jogos sem sofrer gol',
    icon: Shield,
    color: 'text-zinc-500',
    bgColor: 'bg-zinc-100',
  },
  CAMPEAO: {
    id: 'campeao',
    name: 'Campeão',
    description: 'Vencer um campeonato',
    icon: Trophy,
    color: 'text-amber-500',
    bgColor: 'bg-amber-100',
  }
};

export function calculateBadges(matches: any[], teamId: string, teamBadgesFromDb: string[] = []) {
  const earnedBadges: string[] = [...teamBadgesFromDb];
  
  // Filter only completed matches
  const validMatches = matches.filter(m => m.status === 'completed');
  
  // Sort by date ascending
  validMatches.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let consecutiveWins = 0;
  let consecutiveUndefeated = 0;
  let totalGoals = 0;
  let consecutiveCleanSheets = 0;

  for (const match of validMatches) {
    const isHome = match.homeTeamId === teamId;

    if (match.quadros && match.quadros.length > 0) {
      match.quadros.forEach((q: any) => {
        if (q.status !== 'confirmed') return;
        
        const qMyGoals = isHome ? (q.homeScore || 0) : (q.awayScore || 0);
        const qOpponentGoals = isHome ? (q.awayScore || 0) : (q.homeScore || 0);
        
        totalGoals += qMyGoals;

        if (qMyGoals > qOpponentGoals) {
          consecutiveWins++;
          consecutiveUndefeated++;
        } else if (qMyGoals === qOpponentGoals) {
          consecutiveWins = 0;
          consecutiveUndefeated++;
        } else {
          consecutiveWins = 0;
          consecutiveUndefeated = 0;
        }

        if (qOpponentGoals === 0) {
          consecutiveCleanSheets++;
        } else {
          consecutiveCleanSheets = 0;
        }

        if (consecutiveWins >= 5 && !earnedBadges.includes(BADGES.INVENCIVEL.id)) {
          earnedBadges.push(BADGES.INVENCIVEL.id);
        }
        if (consecutiveUndefeated >= 10 && !earnedBadges.includes(BADGES.SEQUENCIA_INSANA.id)) {
          earnedBadges.push(BADGES.SEQUENCIA_INSANA.id);
        }
        if (totalGoals >= 10 && !earnedBadges.includes(BADGES.ARTILHEIRO.id)) {
          earnedBadges.push(BADGES.ARTILHEIRO.id);
        }
        if (consecutiveCleanSheets >= 3 && !earnedBadges.includes(BADGES.DEFESA_DE_FERRO.id)) {
          earnedBadges.push(BADGES.DEFESA_DE_FERRO.id);
        }
      });
    } else {
      if (match.resultStatus !== 'confirmed') continue;
      
      const myScore = isHome ? match.homeScore : match.awayScore;
      const opponentScore = isHome ? match.awayScore : match.homeScore;

      if (myScore !== undefined && opponentScore !== undefined) {
        totalGoals += myScore;

        if (myScore > opponentScore) {
          consecutiveWins++;
          consecutiveUndefeated++;
        } else if (myScore === opponentScore) {
          consecutiveWins = 0;
          consecutiveUndefeated++;
        } else {
          consecutiveWins = 0;
          consecutiveUndefeated = 0;
        }

        if (opponentScore === 0) {
          consecutiveCleanSheets++;
        } else {
          consecutiveCleanSheets = 0;
        }

        if (consecutiveWins >= 5 && !earnedBadges.includes(BADGES.INVENCIVEL.id)) {
          earnedBadges.push(BADGES.INVENCIVEL.id);
        }
        if (consecutiveUndefeated >= 10 && !earnedBadges.includes(BADGES.SEQUENCIA_INSANA.id)) {
          earnedBadges.push(BADGES.SEQUENCIA_INSANA.id);
        }
        if (totalGoals >= 10 && !earnedBadges.includes(BADGES.ARTILHEIRO.id)) {
          earnedBadges.push(BADGES.ARTILHEIRO.id);
        }
        if (consecutiveCleanSheets >= 3 && !earnedBadges.includes(BADGES.DEFESA_DE_FERRO.id)) {
          earnedBadges.push(BADGES.DEFESA_DE_FERRO.id);
        }
      }
    }
  }

  return earnedBadges;
}
