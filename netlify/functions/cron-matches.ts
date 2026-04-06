import { schedule } from "@netlify/functions";
import { getDb } from "./firebase-admin";
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

export const handler = schedule("*/5 * * * *", async (event) => {
  const db = getDb();
  if (!db) {
    console.error("Database not initialized");
    return { statusCode: 500 };
  }

  try {
    const matchesSnapshot = await db.collection('matches').where('status', '==', 'confirmed').get();
    const now = new Date();
    const timeZone = 'America/Sao_Paulo';

    for (const doc of matchesSnapshot.docs) {
      const match = doc.data();
      if (!match.date || match.resultNotificationSent) continue;

      const matchDateZoned = toZonedTime(new Date(match.date), timeZone);
      let endTimeZoned = toZonedTime(new Date(match.date), timeZone);
      
      if (match.endTime) {
        const [hours, minutes] = match.endTime.split(':');
        endTimeZoned.setHours(parseInt(hours || '0'), parseInt(minutes || '0'), 0, 0);
        if (endTimeZoned < matchDateZoned) {
          endTimeZoned.setDate(endTimeZoned.getDate() + 1);
        }
      } else {
        endTimeZoned.setHours(endTimeZoned.getHours() + 2);
      }

      const endTimeUTC = fromZonedTime(endTimeZoned, timeZone);
      const unlockTime = new Date(endTimeUTC.getTime() + 60 * 60 * 1000);

      if (now >= unlockTime) {
        if ((now.getTime() - unlockTime.getTime()) < 24 * 60 * 60 * 1000) {
          const homeTeamDoc = await db.collection('teams').doc(match.homeTeamId).get();
          const awayTeamDoc = await db.collection('teams').doc(match.awayTeamId).get();
          
          const homeTeam = homeTeamDoc.data();
          const awayTeam = awayTeamDoc.data();

          const messageBody = `Várzea Brasil: O resultado do jogo entre ${homeTeam?.name || 'Mandante'} e ${awayTeam?.name || 'Visitante'} já pode ser inserido! Acesse o aplicativo para informar o placar e avaliar o adversário.`;

          const sendWhatsApp = async (phoneStr: string) => {
            let phone = phoneStr.replace(/\D/g, '');
            if (phone.length === 10 || phone.length === 11) phone = `+55${phone}`;
            else if (!phone.startsWith('+')) phone = `+${phone}`;
            
            await db.collection('messages').add({
              to: `whatsapp:${phone}`,
              body: messageBody
            });
          };

          if (homeTeam?.whatsapp) await sendWhatsApp(homeTeam.whatsapp);
          if (awayTeam?.whatsapp) await sendWhatsApp(awayTeam.whatsapp);
          console.log(`Sent result notification for match ${doc.id}`);
        }

        await doc.ref.update({ resultNotificationSent: true });
      }
    }
    return { statusCode: 200 };
  } catch (error) {
    console.error("Error checking unlocked matches:", error);
    return { statusCode: 500 };
  }
});
