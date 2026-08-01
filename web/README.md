# Install without building anything

1. Put these four items in a GitHub repository: `index.html`,
   `manifest.webmanifest`, `sw.js`, `icons/`.
2. Repo **Settings > Pages**, source "Deploy from a branch", branch `main`,
   folder `/ (root)`. Wait a minute for the URL.
3. Open that URL in Chrome on your phone, menu > **Add to Home screen**.

It then behaves like an installed app: own icon, no browser chrome, opens
offline. Trip log, saved keys and cached terrain persist on the device.

A service worker needs HTTPS, which GitHub Pages provides. Opening the file
directly off the phone's storage will run the planner but will not install.
