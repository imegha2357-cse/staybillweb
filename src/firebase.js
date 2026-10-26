import { initializeApp, getApps } from './backend/app';
import { getAuth } from './backend/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from './backend/firestore';
import { firebaseConfig, isConfigured } from './config';

export { firebaseConfig, isConfigured };

// With Firebase settings these are the real SDK objects; without them they are
// the built-in store's equivalents (see src/backend/*).
const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);
let cache;
if (isConfigured) {
  try {
    cache = persistentLocalCache({ tabManager: persistentMultipleTabManager() });
  } catch {
    cache = undefined;
  }
}
const db = initializeFirestore(app, cache ? { localCache: cache } : {});

export { app, auth, db };
