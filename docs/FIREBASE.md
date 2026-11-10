# Firebase setup (project `v88-car-rental-contract`)

> This app shares the Firebase project with the V88 car-rental app. All trading data lives under
> `users/{uid}/…`. **Do not deploy `firestore.rules` / `storage.rules` as-is** — that would replace the
> car-rental app's rules. Merge the `match /users/{uid}/...` blocks into the existing rules instead.

The app uses **Authentication**, **Cloud Firestore** and **Cloud Storage**. Without the Firebase web config the app
runs in *local mode* (data in this browser only) — clearly shown in Settings.

## 1. Web app config → Vercel env vars

Firebase Console → ⚙ Project settings → *Your apps*. If there is no Web app, click **</> Add app** (no hosting needed).
Copy the `firebaseConfig` values into Vercel → Project → Settings → Environment Variables:

| Vercel variable | firebaseConfig key |
|---|---|
| `VITE_FIREBASE_API_KEY` | apiKey |
| `VITE_FIREBASE_AUTH_DOMAIN` | authDomain (`v88-car-rental-contract.firebaseapp.com`) |
| `VITE_FIREBASE_PROJECT_ID` | projectId (`v88-car-rental-contract`) |
| `VITE_FIREBASE_STORAGE_BUCKET` | storageBucket (`v88-car-rental-contract.firebasestorage.app`) |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | messagingSenderId |
| `VITE_FIREBASE_APP_ID` | appId |
| `VITE_FIREBASE_MEASUREMENT_ID` | measurementId (`G-6HK0TP432P`) |

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

Because the project is shared, add the trading app's blocks to the **existing** rules in the console
(Firestore → Rules, Storage → Rules) rather than running `firebase deploy`, which overwrites them.
Copy the `match /users/{uid}/...` blocks from `firestore.rules` and `storage.rules`, keep the car-rental
app's own `match` blocks, and do not copy the final "deny everything else" block if the car-rental rules
rely on their own defaults.

`firestore.rules`: only `request.auth.uid == uid` can read/write `users/{uid}/…`, only known collections, everything
else denied. `storage.rules`: owner-only, images < 10 MB.
