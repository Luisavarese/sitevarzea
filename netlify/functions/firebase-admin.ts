import { initializeApp, getApps, getApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export function getDb() {
  try {
    if (getApps().length === 0) {
      if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
        console.warn("FIREBASE_SERVICE_ACCOUNT is not set in environment variables");
        return null;
      }
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      initializeApp({
        credential: cert(serviceAccount),
      });
    }
    return getFirestore();
  } catch (e) {
    console.error("Failed to initialize Firebase Admin:", e);
    return null;
  }
}
