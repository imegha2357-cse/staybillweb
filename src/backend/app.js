// Picks the real Firebase SDK when configured, otherwise the built-in store.
import * as real from 'firebase/app';
import * as local from '../hosted/app';
import { isConfigured } from '../config';

const impl = isConfigured ? real : local;
export const { initializeApp, getApps, deleteApp } = impl;
