import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";

async function test() {
  try {
    const serviceAccount = JSON.parse(fs.readFileSync("service-account.json", "utf8"));
    const config = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf8"));
    
    const app = initializeApp({
      projectId: config.projectId,
      credential: cert(serviceAccount)
    });
    
    const db = getFirestore(app, config.firestoreDatabaseId);
    const snapshot = await db.collection("matches").limit(1).get();
    console.log("SUCCESS! Found " + snapshot.docs.length + " docs.");
  } catch (e) {
    console.error("ERROR:", e);
  }
}

test();
