import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

const env = import.meta.env;

/** Public web config (identifiers, not secrets). Security comes from Auth + Firestore/Storage rules. */
export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: (env.VITE_FIREBASE_AUTH_DOMAIN as string) || 'vhv888-finance.firebaseapp.com',
  projectId: (env.VITE_FIREBASE_PROJECT_ID as string) || 'vhv888-finance',
  storageBucket: (env.VITE_FIREBASE_STORAGE_BUCKET as string) || 'vhv888-finance.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
  measurementId: (env.VITE_FIREBASE_MEASUREMENT_ID as string) || 'G-P6ZKTL1B9B',
};

export const firebaseEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.appId);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;

if (firebaseEnabled) {
  app = initializeApp(firebaseConfig as Required<typeof firebaseConfig>);
  auth = getAuth(app);
  // Offline persistence: journal records stay readable/editable offline and sync when back online.
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  storage = getStorage(app);
}

export { app, auth, db, storage };
