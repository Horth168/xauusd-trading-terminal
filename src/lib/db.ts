import { useEffect, useState } from 'react';
import { create } from 'zustand';
import {
  collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query, setDoc, writeBatch,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, db, firebaseEnabled, storage } from './firebase';

/**
 * Storage abstraction. When Firebase is configured and the user is signed in, records live in
 * Firestore under users/{uid}/{collection}. Otherwise they live in this browser's localStorage
 * ("local mode"), which the UI labels clearly.
 */
export type CollectionName =
  | 'trades' | 'cashflows' | 'strategies' | 'backtests' | 'indicators' | 'alerts' | 'drawings' | 'settings';

export interface BaseDoc {
  id: string;
  createdAt?: number;
  updatedAt?: number;
}

interface AuthState {
  user: User | null;
  ready: boolean;
}
export const useAuth = create<AuthState>(() => ({ user: null, ready: !firebaseEnabled }));
if (auth) onAuthStateChanged(auth, (user) => useAuth.setState({ user, ready: true }));

export const cloudActive = () => Boolean(firebaseEnabled && db && useAuth.getState().user);
const uid = () => useAuth.getState().user!.uid;

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 20);

// ---------------- local backend ----------------
const LKEY = (name: string) => `xau-local:${name}`;
const localListeners = new Map<string, Set<() => void>>();
function localRead<T>(name: string): T[] {
  try { return JSON.parse(localStorage.getItem(LKEY(name)) ?? '[]'); } catch { return []; }
}
function localWrite(name: string, items: unknown[]) {
  localStorage.setItem(LKEY(name), JSON.stringify(items));
  localListeners.get(name)?.forEach((l) => l());
}

/** Firestore rejects `undefined`; strip it recursively. */
function clean<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_k, x) => (x === undefined ? null : x)));
}

export async function saveDoc<T extends BaseDoc>(name: CollectionName, data: Omit<T, 'id'> & { id?: string }): Promise<T> {
  const now = Date.now();
  const item = { ...data, id: data.id ?? newId(), createdAt: (data as any).createdAt ?? now, updatedAt: now } as T;
  if (cloudActive()) {
    await setDoc(doc(db!, 'users', uid(), name, item.id), clean(item));
  } else {
    const items = localRead<T>(name);
    const i = items.findIndex((x) => x.id === item.id);
    if (i >= 0) items[i] = item; else items.push(item);
    localWrite(name, items);
  }
  return item;
}

export async function removeDoc(name: CollectionName, id: string) {
  if (cloudActive()) await deleteDoc(doc(db!, 'users', uid(), name, id));
  else localWrite(name, localRead<BaseDoc>(name).filter((x) => x.id !== id));
}

export async function getOne<T extends BaseDoc>(name: CollectionName, id: string): Promise<T | null> {
  if (cloudActive()) {
    const s = await getDoc(doc(db!, 'users', uid(), name, id));
    return s.exists() ? (s.data() as T) : null;
  }
  return localRead<T>(name).find((x) => x.id === id) ?? null;
}

export function subscribeCollection<T extends BaseDoc>(name: CollectionName, cb: (items: T[]) => void, onError?: (e: Error) => void): () => void {
  if (cloudActive()) {
    const q = query(collection(db!, 'users', uid(), name), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => cb(snap.docs.map((d) => d.data() as T)), (e) => onError?.(e));
  }
  const emit = () => cb(localRead<T>(name).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)));
  if (!localListeners.has(name)) localListeners.set(name, new Set());
  localListeners.get(name)!.add(emit);
  emit();
  return () => localListeners.get(name)?.delete(emit);
}

export function useCollection<T extends BaseDoc>(name: CollectionName) {
  const user = useAuth((s) => s.user);
  const [state, setState] = useState<{ items: T[]; loading: boolean; error: string | null }>({ items: [], loading: true, error: null });
  useEffect(() => {
    setState((s) => ({ ...s, loading: true }));
    return subscribeCollection<T>(name, (items) => setState({ items, loading: false, error: null }), (e) => setState({ items: [], loading: false, error: e.message }));
  }, [name, user?.uid]);
  return state;
}

/** Copies local-mode records into the signed-in cloud account (used once after first sign-in). */
export async function migrateLocalToCloud(): Promise<number> {
  if (!cloudActive()) throw new Error('Sign in first');
  const names: CollectionName[] = ['trades', 'cashflows', 'strategies', 'backtests', 'indicators', 'alerts', 'drawings', 'settings'];
  let count = 0;
  for (const name of names) {
    const items = localRead<BaseDoc>(name);
    for (let i = 0; i < items.length; i += 400) {
      const batch = writeBatch(db!);
      for (const it of items.slice(i, i + 400)) batch.set(doc(db!, 'users', uid(), name, it.id), clean(it));
      await batch.commit();
      count += Math.min(400, items.length - i);
    }
  }
  return count;
}

export function localCounts() {
  const names: CollectionName[] = ['trades', 'cashflows', 'strategies', 'backtests', 'indicators', 'alerts'];
  return Object.fromEntries(names.map((n) => [n, localRead(n).length]));
}

// ---------------- images ----------------
async function compressImage(file: Blob, maxDim: number, quality: number): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', quality));
}

const blobToDataUrl = (b: Blob) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(b); });

/**
 * Uploads a screenshot. Cloud: Firebase Storage at users/{uid}/screenshots/. If Storage is unavailable
 * (e.g. bucket not provisioned) or in local mode, stores a compressed inline image instead.
 */
export async function uploadImage(file: Blob): Promise<{ url: string; stored: 'storage' | 'inline' }> {
  if (cloudActive() && storage) {
    try {
      const blob = await compressImage(file, 1800, 0.85);
      const r = ref(storage, `users/${uid()}/screenshots/${newId()}.jpg`);
      await uploadBytes(r, blob, { contentType: 'image/jpeg' });
      return { url: await getDownloadURL(r), stored: 'storage' };
    } catch (e) {
      console.warn('Storage upload failed, falling back to inline image', e);
    }
  }
  const small = await compressImage(file, 1000, 0.7);
  return { url: await blobToDataUrl(small), stored: 'inline' };
}
