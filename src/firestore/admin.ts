import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { AppConfig } from "../app/config.js";

export function createFirestore(config: AppConfig): Firestore {
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: config.firebaseProjectId,
        clientEmail: config.firebaseClientEmail,
        privateKey: config.firebasePrivateKey,
      }),
      projectId: config.firebaseProjectId,
    });
  }

  return getFirestore();
}
