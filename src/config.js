// Firebase web config from environment variables (.env.local or the host's env settings).
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** True when Firebase settings are present. Without them StayBill runs on its
 *  built-in store (claude.ai database when hosted there, otherwise this browser). */
export const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
