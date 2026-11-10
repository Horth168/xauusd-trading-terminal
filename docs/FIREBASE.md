# Firebase setup (project `vhv888-finance`)

The app uses **Authentication**, **Cloud Firestore** and **Cloud Storage**. Without the Firebase web config the app
runs in *local mode* (data in this browser only) — clearly shown in Settings.

## 1. Web app config → Vercel env vars

Firebase Console → ⚙ Project settings → *Your apps*. If there is no Web app, click **</> Add app** (no hosting needed).
Copy the `firebaseConfig` values into Vercel → Project → Settings → Environment Variables:

| Vercel variable | firebaseConfig key |
|---|---|
| `VITE_FIREBASE_API_KEY` | apiKey |
| `VITE_FIREBASE_AUTH_DOMAIN` | authDomain (`vhv888-finance.firebaseapp.com`) |
| `VITE_FIREBASE_PROJECT_ID` | projectId (`vhv888-finance`) |
| `VITE_FIREBASE_STORAGE_BUCKET` | storageBucket (`vhv888-finance.firebasestorage.app`) |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | messagingSenderId |
| `VITE_FIREBASE_APP_ID` | appId |
| `VITE_FIREBASE_MEASUREMENT_ID` | measurementId (`G-P6ZKTL1B9B`) |

These are public identifiers (they ship in every Firebase web app). Security is enforced by Auth + rules below.
**Never** put a service-account JSON in the frontend or in `VITE_*` variables.

## 2. Authentication

Console → Build → Authentication → *Get started* → Sign-in method → enable **Google** and **Email/Password**.
Settings → *Authorized domains* → add your Vercel domain (e.g. `xauusd-trading-terminal.vercel.app`).

To keep the app private to you: after creating your own account, open Authentication → Settings →
*User actions* and untick **Enable create (sign-up)**. Even if someone signs up, rules only let each user see their own data.

## 3. Firestore

Console → Build → Firestore Database → *Create database* (production mode, region e.g. `asia-southeast1`).

Data layout — everything is private per user:

```
users/{uid}/trades/{id}        journal trades
users/{uid}/cashflows/{id}     deposits & withdrawals (USD/KHR)
users/{uid}/strategies/{id}    strategy library
users/{uid}/backtests/{id}     saved backtest results (stats, curve, ≤2000 trades)
users/{uid}/indicators/{id}    your XTS scripts
users/{uid}/alerts/{id}        alerts
users/{uid}/drawings/XAUUSD    chart drawings
users/{uid}/settings/main      layouts, templates, timezone (bridge token is NOT synced)
```

Queries are single-field (`orderBy createdAt`) so automatic indexes suffice; `firestore.indexes.json` exempts large
array fields from indexing. Offline persistence is enabled, so journal records open and edit offline and sync later.

## 4. Storage (screenshots)

Console → Build → Storage → *Get started*. Since Oct 2024 new default buckets (`*.firebasestorage.app`) require the
**Blaze (pay-as-you-go)** plan; the free usage tier still applies (5 GB stored). If Storage is not enabled, the app
automatically stores screenshots as compressed inline images in Firestore instead (≈100 KB each) — it keeps working.

## 5. Deploy the rules

```bash
npm i -g firebase-tools
firebase login --reauth
firebase deploy --only firestore:rules,firestore:indexes,storage --project vhv888-finance
```

`firestore.rules`: only `request.auth.uid == uid` can read/write `users/{uid}/…`, only known collections, everything
else denied. `storage.rules`: owner-only, images < 10 MB.
