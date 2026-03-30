import { collection, addDoc, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

export interface NotificationPayload {
  userId: string;
  title: string;
  message: string;
  link?: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  userEmail?: string; // Optional: If provided, sends an email via Firebase Extension
  userPhone?: string; // Optional: If provided, sends an SMS via Firebase Twilio Extension
}

export async function sendNotification(payload: NotificationPayload) {
  if (!payload.userId) {
    console.warn("sendNotification called without userId, skipping.");
    return;
  }

  try {
    // 1. In-App Notification (Push-like)
    await addDoc(collection(db, 'notifications'), {
      userId: payload.userId,
      title: payload.title,
      message: payload.message,
      link: payload.link || null,
      type: payload.type || 'info',
      read: false,
      createdAt: new Date().toISOString()
    });

    // Fetch user data if email or phone is missing
    let emailToSend = payload.userEmail;
    let phoneToSend = payload.userPhone;
    
    if ((!emailToSend || !phoneToSend) && payload.userId) {
      const userSnap = await getDoc(doc(db, 'users', payload.userId));
      if (userSnap.exists()) {
        const userData = userSnap.data();
        if (!emailToSend && userData.email) {
          emailToSend = userData.email;
        }
        if (!phoneToSend && userData.phone) {
          phoneToSend = userData.phone;
        }
      }
    }

    // 2. Email Notification (Trigger Email Extension)
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (emailToSend && emailRegex.test(emailToSend)) {
      await addDoc(collection(db, 'mail'), {
        to: emailToSend,
        message: {
          subject: payload.title,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
              <h2 style="color: #059669; margin-bottom: 16px;">${payload.title}</h2>
              <p style="color: #374151; font-size: 16px; line-height: 1.5;">${payload.message}</p>
              ${payload.link ? `
                <div style="margin-top: 24px;">
                  <a href="${window.location.origin}${payload.link}" style="background-color: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                    Acessar Várzea Brasil
                  </a>
                </div>
              ` : ''}
              <p style="color: #9ca3af; font-size: 12px; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
                Esta é uma mensagem automática do Várzea Brasil. Por favor, não responda.
              </p>
            </div>
          `
        }
      });
    }

    // 3. WhatsApp Notification (Twilio Send Message Extension)
    if (phoneToSend) {
      // Format phone to E.164 format if it's a Brazilian number without country code
      let formattedPhone = phoneToSend.replace(/\D/g, '');
      if (formattedPhone.length === 10 || formattedPhone.length === 11) {
        formattedPhone = `+55${formattedPhone}`;
      } else if (!formattedPhone.startsWith('+')) {
        formattedPhone = `+${formattedPhone}`;
      }

      await addDoc(collection(db, 'messages'), {
        to: `whatsapp:${formattedPhone}`,
        body: `Várzea Brasil: ${payload.title} - ${payload.message}`
      });
    }
  } catch (error) {
    console.error("Error sending notification:", error);
  }
}
