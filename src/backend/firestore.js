// Picks Cloud Firestore when configured, otherwise the built-in document store.
import * as real from 'firebase/firestore';
import * as local from '../hosted/firestore';
import { isConfigured } from '../config';

const impl = isConfigured ? real : local;
export const {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  query, where, orderBy, limit, runTransaction, serverTimestamp, writeBatch,
  Timestamp, arrayUnion, increment, onSnapshot, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
} = impl;
