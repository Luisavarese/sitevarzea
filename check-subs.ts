import { initializeApp, getApps, getApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";
import path from "path";
import "dotenv/config";

async function checkSubscriptions() {
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    let appOptions: any = { projectId: config.projectId };
    
    const serviceAccountPath = path.join(process.cwd(), "service-account.json");
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      appOptions.credential = cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
    } else if (fs.existsSync(serviceAccountPath)) {
      appOptions.credential = cert(JSON.parse(fs.readFileSync(serviceAccountPath, "utf8")));
    }
    
    const app = getApps().length === 0 ? initializeApp(appOptions) : getApp();
    const db = getFirestore(app, config.firestoreDatabaseId);

    console.log("Checking teams for subscriptions...");
    const snapshot = await db.collection("teams").get();
    let found = false;
    
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.subscription) {
        console.log(`Team ID: ${doc.id} | Name: ${data.name}`);
        console.log(`Subscription:`, JSON.stringify(data.subscription, null, 2));
        console.log('---');
        found = true;
      }
    });
    
    if (!found) {
      console.log("No subscriptions found in the database.");
    }
  } catch (e) {
    console.error("Error checking subscriptions:", e);
  }
}

checkSubscriptions();
