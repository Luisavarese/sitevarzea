import express from "express";
import serverless from "serverless-http";
import cors from "cors";
import crypto from "crypto";
import { MercadoPagoConfig, Preference, Payment } from "mercadopago";
import { getDb } from "./firebase-admin";

const app = express();
app.use(cors());
app.use(express.json());

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

app.post("/api/create-preference", async (req, res) => {
  try {
    const accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken) {
      return res.status(500).json({ error: "Mercado Pago Access Token not configured" });
    }

    const client = new MercadoPagoConfig({ accessToken, options: { timeout: 5000 } });
    const preference = new Preference(client);

    const { title, price, quantity, teamId, planType } = req.body;

    const appUrl = process.env.APP_URL || `https://varzeabrasil.netlify.app`;

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
        notification_url: `${process.env.APP_URL || `https://varzeabrasil.netlify.app`}/api/webhook`
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
    
    console.log("Webhook received! Body:", JSON.stringify(req.body, null, 2));
    console.log("Webhook headers:", JSON.stringify(req.headers, null, 2));
    console.log("Webhook query:", JSON.stringify(req.query, null, 2));

    if (req.body?.action === "test.created" || req.body?.type === "test") {
      return res.status(200).send("OK");
    }

    if (secret && req.body?.action !== "test.created" && req.body?.type !== "test") {
      if (req.body?.data?.id === "123456" || req.body?.user_id === 156340914) {
        console.log("Received test webhook from Mercado Pago dashboard");
      } else {
        const isValid = verifySignature(req, secret);
        if (!isValid) {
          console.warn("Invalid webhook signature");
          return res.status(403).send("Invalid signature");
        }
      }
    }

    const type = req.body?.type || req.query?.topic || req.query?.type;
    const dataId = req.body?.data?.id || req.query?.["data.id"] || req.query?.id;

    console.log(`Processing type: ${type}, dataId: ${dataId}`);

    if (type === "payment" && dataId && dataId !== "123456") {
      const accessToken = process.env.MP_ACCESS_TOKEN;
      if (!accessToken) {
        throw new Error("MP_ACCESS_TOKEN not configured");
      }

      const client = new MercadoPagoConfig({ accessToken, options: { timeout: 5000 } });
      const paymentClient = new Payment(client);
      
      const payment = await paymentClient.get({ id: dataId });
      
      const teamId = payment.external_reference;
      const status = payment.status;
      const planType = payment.additional_info?.items?.[0]?.id || "premium_mensal";

      const db = getDb();
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

export const handler = serverless(app);
