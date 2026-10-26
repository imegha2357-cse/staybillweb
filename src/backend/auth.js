// Picks Firebase Auth when configured, otherwise the built-in username/password store.
import * as real from 'firebase/auth';
import * as local from '../hosted/auth';
import { isConfigured } from '../config';

const impl = isConfigured ? real : local;
export const isLocalBackend = !isConfigured;
export const {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, updateProfile, updatePassword,
} = impl;

/** The signed-in person changes their own password (re-checks the current one first). */
export async function changePassword(current, next) {
  if (!isConfigured) return local.changeOwnPassword(current, next);
  const u = real.getAuth().currentUser;
  if (!u) throw new Error('Please sign in again.');
  try {
    await real.reauthenticateWithCredential(u, real.EmailAuthProvider.credential(u.email, current));
  } catch {
    throw new Error('Your current password is not correct.');
  }
  await real.updatePassword(u, next);
}
