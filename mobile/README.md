# Hisn mobile app (Android)

One Expo app for both sides of Hisn: the **owner** (Amel) and her **guardians** (Yassine, Sarra).

## Install

Download the `.apk` from the build page on expo.dev (Builds → latest `preview` build → Install), open it on the phone and allow "install unknown apps" when Android asks.

## Use it

- **First screen:** "Who is using this phone?" Swipe between Amel, Yassine and Sarra and tap one. No passwords.
- **Switch account** at any time with the avatar at the top right.
- **Demo mode** (default) works anywhere with no server. It runs the same simulated vault as the website:
  1. As Amel: Send → "Demo: paste a stranger's address" → 100 → Continue on your puck. The simulated puck signs after 3 seconds.
  2. Switch to Yassine: the alert shows the facts and a Stop button. Stop it.
  3. Back to Amel: the payment is Stopped and the money never left.
  - A large amount (for example 800) needs a guardian's approval: as Sarra, tick "I spoke to Amel" and Approve.
  - A waiting payment asks for a second confirmation after half the wait: Amel's **Puck** tab → Confirm again.
  - Settings → Restart the demo resets everything.
- **Live mode:** Settings → relayer address (the laptop's Wi-Fi address, for example `http://192.168.1.20:8787`), the relayer token, and optionally the device simulator (`http://192.168.1.20:8790`) to play the puck. A guardian needs a key the vault lists as a guardian: Settings → Create a new key (send the address to the owner) or paste an existing one. Keys stay in the phone's secure storage.

## Develop

```bash
npm install
npm run sync-core     # after changing shared/ or dashboard/src/data|lib
npx expo start        # Expo Go, or press w for the web preview
npx tsc --noEmit && npx expo lint
npm run build:apk     # EAS cloud build, preview profile (APK)
```

`src/core` is generated from `shared/` and `dashboard/`, so the app builds on its own. Do not edit it by hand.
`scripts/check-guardian-live.ts` checks guardian signing against a local relayer (`npm run local`, `npm run relayer:local` in the repo root).
