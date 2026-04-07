import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { initializeApp, getApps, getApp, cert } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import fs from "fs";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Firebase Admin
let db: Firestore;
try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    
    let appOptions: any = { projectId: config.projectId };
    
    let hasCredentials = false;
    const serviceAccountPath = path.join(process.cwd(), "service-account.json");
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        appOptions.credential = cert(serviceAccount);
        hasCredentials = true;
        console.log("Firebase Admin initialized with Service Account credentials.");
      } catch (err) {
        console.error("Error parsing FIREBASE_SERVICE_ACCOUNT:", err);
      }
    } else if (fs.existsSync(serviceAccountPath)) {
      try {
        const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
        appOptions.credential = cert(serviceAccount);
        hasCredentials = true;
        console.log("Firebase Admin initialized with service-account.json file.");
      } catch (err) {
        console.error("Error parsing service-account.json:", err);
      }
    } else {
      console.warn("WARNING: FIREBASE_SERVICE_ACCOUNT not found in .env. Webhooks may fail to update Firestore due to lack of permissions.");
    }

    if (hasCredentials) {
      const app = getApps().length === 0 ? initializeApp(appOptions) : getApp();
      db = getFirestore(app, config.firestoreDatabaseId);
    }
  } else {
    // We don't initialize without credentials to avoid UNAUTHENTICATED errors
    console.warn("WARNING: firebase-applet-config.json not found.");
  }
} catch (e) {
  console.error("Failed to initialize Firebase Admin:", e);
}



import { toZonedTime, fromZonedTime } from 'date-fns-tz';

let isDbAuthenticated = true;

async function checkAndNotifyUnlockedMatches() {
  if (!db || !isDbAuthenticated) return;
  try {
    const matchesSnapshot = await db.collection('matches').where('status', '==', 'confirmed').get();
    const now = new Date();
    const timeZone = 'America/Sao_Paulo';

    for (const doc of matchesSnapshot.docs) {
      const match = doc.data();
      if (!match.date || match.resultNotificationSent) continue;

      const matchDateObj = new Date(match.date.includes('T') ? match.date : match.date + 'T12:00:00Z');
      if (isNaN(matchDateObj.getTime())) {
        continue;
      }

      // Parse match date in Sao Paulo timezone
      const matchDateZoned = toZonedTime(matchDateObj, timeZone);
      let endTimeZoned = toZonedTime(matchDateObj, timeZone);
      
      if (match.endTime) {
        const [hours, minutes] = match.endTime.split(':');
        endTimeZoned.setHours(parseInt(hours || '0'), parseInt(minutes || '0'), 0, 0);
        if (endTimeZoned < matchDateZoned) {
          endTimeZoned.setDate(endTimeZoned.getDate() + 1);
        }
      } else {
        endTimeZoned.setHours(endTimeZoned.getHours() + 2);
      }

      // Convert back to UTC timestamp
      const endTimeUTC = fromZonedTime(endTimeZoned, timeZone);

      // Calculate unlock time (1 hour after end time)
      const unlockTime = new Date(endTimeUTC.getTime() + 60 * 60 * 1000);

      // If unlockTime has passed
      if (now >= unlockTime) {
        // Only send message if it's within the last 24 hours (to avoid spamming old matches)
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
  } catch (error: any) {
    if (error.code === 16 || (error.message && error.message.includes('UNAUTHENTICATED'))) {
      console.error("Firebase Admin Error: The service account credentials are invalid or have been revoked. Background jobs are disabled.");
      console.error("To fix this, generate a new private key in the Firebase Console (Project Settings > Service Accounts) and set it in the FIREBASE_SERVICE_ACCOUNT environment variable.");
      isDbAuthenticated = false;
    } else {
      console.error("Error checking unlocked matches:", error);
    }
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Start the background job
  setInterval(checkAndNotifyUnlockedMatches, 5 * 60 * 1000); // Run every 5 minutes
  // Run once on startup after a short delay
  setTimeout(checkAndNotifyUnlockedMatches, 10000);

  app.use(cors());
  app.use(express.json());

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/send-sms", async (req, res) => {
    try {
      const { to, body } = req.body;
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const fromNumber = process.env.TWILIO_PHONE_NUMBER;

      if (!accountSid || !authToken || !fromNumber) {
        console.error("Twilio credentials missing in environment variables.");
        return res.status(500).json({ error: "Credenciais do Twilio não configuradas no servidor." });
      }

      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      
      const params = new URLSearchParams();
      params.append('To', to);
      params.append('From', fromNumber);
      params.append('Body', body);

      console.log(`Sending SMS to ${to} via Twilio...`);

      const response = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64')
        },
        body: params.toString()
      });

      const data = await response.json();
      
      if (!response.ok) {
        console.error("Twilio API Error Details:", data);
        return res.status(response.status).json({ 
          error: data.message || 'Falha ao enviar SMS pelo Twilio',
          details: data 
        });
      }

      console.log(`SMS sent successfully. SID: ${data.sid}`);
      res.json({ success: true, messageId: data.sid });
    } catch (error) {
      console.error("Error sending SMS:", error);
      res.status(500).json({ error: "Erro interno ao tentar enviar SMS." });
    }
  });

  app.post("/api/send-whatsapp", async (req, res) => {
    try {
      const { to, body } = req.body;
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER;

      if (!accountSid || !authToken || !fromNumber) {
        console.error("Twilio credentials missing in environment variables.");
        return res.status(500).json({ error: "Credenciais do Twilio não configuradas no servidor." });
      }

      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      
      const params = new URLSearchParams();
      params.append('To', to.startsWith('whatsapp:') ? to : `whatsapp:${to}`);
      params.append('From', fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`);
      params.append('Body', body);

      console.log(`Sending WhatsApp to ${to} via Twilio...`);

      const response = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64')
        },
        body: params.toString()
      });

      const data = await response.json();
      
      if (!response.ok) {
        console.error("Twilio API Error Details:", data);
        return res.status(response.status).json({ 
          error: data.message || 'Falha ao enviar WhatsApp pelo Twilio',
          details: data 
        });
      }

      console.log(`WhatsApp sent successfully. SID: ${data.sid}`);
      res.json({ success: true, messageId: data.sid });
    } catch (error) {
      console.error("Error sending WhatsApp:", error);
      res.status(500).json({ error: "Erro interno ao tentar enviar WhatsApp." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
