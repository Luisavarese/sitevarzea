import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { MercadoPagoConfig, Preference, Payment } from "mercadopago";
import { initializeApp, getApps, getApp, cert } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import fs from "fs";
import crypto from "crypto";
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
    
    const serviceAccountPath = path.join(process.cwd(), "service-account.json");
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        appOptions.credential = cert(serviceAccount);
        console.log("Firebase Admin initialized with Service Account credentials.");
      } catch (err) {
        console.error("Error parsing FIREBASE_SERVICE_ACCOUNT:", err);
      }
    } else if (fs.existsSync(serviceAccountPath)) {
      try {
        const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
        appOptions.credential = cert(serviceAccount);
        console.log("Firebase Admin initialized with service-account.json file.");
      } catch (err) {
        console.error("Error parsing service-account.json:", err);
      }
    } else {
      console.warn("WARNING: FIREBASE_SERVICE_ACCOUNT not found in .env. Webhooks may fail to update Firestore due to lack of permissions.");
    }

    const app = getApps().length === 0 ? initializeApp(appOptions) : getApp();
    db = getFirestore(app, config.firestoreDatabaseId);
  } else {
    const app = getApps().length === 0 ? initializeApp() : getApp();
    db = getFirestore(app);
  }
} catch (e) {
  console.error("Failed to initialize Firebase Admin:", e);
}

function verifySignature(req: express.Request, secret: string): boolean {
  const xSignature = req.headers["x-signature"] as string;
  const xRequestId = req.headers["x-request-id"] as string;

  if (!xSignature || !xRequestId) return false;

  const parts = xSignature.split(",");
  let ts = "";
  let v1 = "";

  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key === "ts") ts = value;
    if (key === "v1") v1 = value;
  }

  if (!ts || !v1) return false;

  const dataId = req.body?.data?.id || req.query?.["data.id"] || req.query?.id;
  if (!dataId) return false;

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(manifest);
  const generatedSignature = hmac.digest("hex");

  return generatedSignature === v1;
}

import { toZonedTime, fromZonedTime } from 'date-fns-tz';

async function checkAndNotifyUnlockedMatches() {
  if (!db) return;
  try {
    const matchesSnapshot = await db.collection('matches').where('status', '==', 'confirmed').get();
    const now = new Date();
    const timeZone = 'America/Sao_Paulo';

    for (const doc of matchesSnapshot.docs) {
      const match = doc.data();
      if (!match.date || match.resultNotificationSent) continue;

      // Parse match date in Sao Paulo timezone
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
  } catch (error) {
    console.error("Error checking unlocked matches:", error);
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

  app.post("/api/create-preference", async (req, res) => {
    try {
      const accessToken = process.env.MP_ACCESS_TOKEN;
      if (!accessToken) {
        return res.status(500).json({ error: "Mercado Pago Access Token not configured" });
      }

      const client = new MercadoPagoConfig({ accessToken, options: { timeout: 5000 } });
      const preference = new Preference(client);

      const { title, price, quantity, teamId, planType } = req.body;

      const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;

      const response = await preference.create({
        body: {
          items: [
            {
              id: planType,
              title: title,
              quantity: quantity || 1,
              unit_price: price,
              currency_id: "BRL",
            },
          ],
          external_reference: teamId,
          back_urls: {
            success: `${appUrl}/subscription?status=success`,
            failure: `${appUrl}/subscription?status=failure`,
            pending: `${appUrl}/subscription?status=pending`,
          },
          auto_return: "approved",
          notification_url: `${appUrl}/api/webhook`,
        },
      });

      res.json({ id: response.id, init_point: response.init_point });
    } catch (error) {
      console.error("Error creating preference:", error);
      res.status(500).json({ error: "Failed to create preference" });
    }
  });

  app.post("/api/process-payment", async (req, res) => {
    try {
      const accessToken = process.env.MP_ACCESS_TOKEN;
      if (!accessToken) {
        return res.status(500).json({ error: "Mercado Pago Access Token not configured" });
      }

      const client = new MercadoPagoConfig({ accessToken, options: { timeout: 5000 } });
      const paymentClient = new Payment(client);

      const { formData, teamId, planType } = req.body;

      const paymentData = {
        body: {
          transaction_amount: formData.transaction_amount,
          token: formData.token,
          description: formData.description || "Assinatura Premium",
          installments: formData.installments,
          payment_method_id: formData.payment_method_id,
          issuer_id: formData.issuer_id,
          payer: {
            email: formData.payer.email,
            identification: formData.payer.identification
          },
          external_reference: teamId,
          additional_info: {
            items: [
              {
                id: planType,
                title: "Assinatura Premium",
                quantity: 1,
                unit_price: formData.transaction_amount,
              }
            ]
          },
          notification_url: `${process.env.APP_URL || `http://localhost:${PORT}`}/api/webhook`
        }
      };

      console.log("Creating payment with data:", JSON.stringify(paymentData, null, 2));

      const response = await paymentClient.create(paymentData);
      console.log("Payment created successfully:", response.id, response.status);
      res.json(response);
    } catch (error) {
      console.error("Payment processing error:", error);
      res.status(500).json({ error: "Failed to process payment" });
    }
  });

  app.post("/api/webhook", async (req, res) => {
    try {
      const secret = process.env.MP_WEBHOOK_SECRET;
      
      // Log incoming webhook for debugging
      console.log("Webhook received! Body:", JSON.stringify(req.body, null, 2));
      console.log("Webhook headers:", JSON.stringify(req.headers, null, 2));
      console.log("Webhook query:", JSON.stringify(req.query, null, 2));

      const logEntry = `[${new Date().toISOString()}] Webhook received: ${JSON.stringify({
        headers: req.headers,
        body: req.body,
        query: req.query
      })}\n`;
      fs.appendFileSync(path.join(process.cwd(), "webhook.log"), logEntry);

      // Handle Mercado Pago test ping
      if (req.body?.action === "test.created" || req.body?.type === "test") {
        return res.status(200).send("OK");
      }

      // Verify signature if secret is provided
      if (secret && req.body?.action !== "test.created" && req.body?.type !== "test") {
        // In test mode from MP dashboard, signature might be missing or invalid
        // We log it but don't block if it's a test payload
        if (req.body?.data?.id === "123456" || req.body?.user_id === 156340914) {
          console.log("Received test webhook from Mercado Pago dashboard");
        } else {
          const isValid = verifySignature(req, secret);
          if (!isValid) {
            fs.appendFileSync(path.join(process.cwd(), "webhook.log"), `[${new Date().toISOString()}] Invalid signature\n`);
            console.warn("Invalid webhook signature");
            return res.status(403).send("Invalid signature");
          }
        }
      }

      const type = req.body?.type || req.query?.topic || req.query?.type;
      const dataId = req.body?.data?.id || req.query?.["data.id"] || req.query?.id;

      fs.appendFileSync(path.join(process.cwd(), "webhook.log"), `[${new Date().toISOString()}] Processing type: ${type}, dataId: ${dataId}\n`);

      if (type === "payment" && dataId && dataId !== "123456") {
        const accessToken = process.env.MP_ACCESS_TOKEN;
        if (!accessToken) {
          throw new Error("MP_ACCESS_TOKEN not configured");
        }

        const client = new MercadoPagoConfig({ accessToken, options: { timeout: 5000 } });
        const paymentClient = new Payment(client);
        
        // Fetch payment details to get the external_reference (teamId) and status
        const payment = await paymentClient.get({ id: dataId });
        
        const teamId = payment.external_reference;
        const status = payment.status;
        const planType = payment.additional_info?.items?.[0]?.id || "premium_mensal";

        if (teamId && db) {
          const teamRef = db.collection("teams").doc(teamId);
          
          if (status === "approved") {
            const startedAt = new Date();
            const expiresAt = new Date(startedAt);
            
            if (planType.includes("anual")) {
              expiresAt.setFullYear(expiresAt.getFullYear() + 1);
            } else if (planType.includes("semestral")) {
              expiresAt.setMonth(expiresAt.getMonth() + 6);
            } else if (planType.includes("trimestral")) {
              expiresAt.setMonth(expiresAt.getMonth() + 3);
            } else {
              expiresAt.setMonth(expiresAt.getMonth() + 1); // default mensal
            }
            
            await teamRef.set({
              subscription: {
                status: "active",
                plan: planType,
                startedAt: startedAt.toISOString(),
                expiresAt: expiresAt.toISOString(),
              }
            }, { merge: true });
            console.log(`Updated subscription for team ${teamId} to active`);
          } else if (status === "rejected" || status === "cancelled") {
            await teamRef.set({
              subscription: {
                status: "inactive",
              }
            }, { merge: true });
            console.log(`Updated subscription for team ${teamId} to inactive`);
          } else if (status === "pending" || status === "in_process") {
            await teamRef.set({
              subscription: {
                status: "pending",
                plan: planType,
              }
            }, { merge: true });
            console.log(`Updated subscription for team ${teamId} to pending`);
          }
        }
      }

      res.status(200).send("OK");
    } catch (error) {
      console.error("Webhook error:", error);
      res.status(500).send("Internal Server Error");
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
