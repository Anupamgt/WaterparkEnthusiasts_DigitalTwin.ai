# DigitalTwin.ai story dashboard

Static walkthrough of the DigitalTwin.ai plant-twin story: opening card, camera sensing, live twin, architecture, and setup.

## Local

Open `index.html` in a browser, or from this folder:

```bash
python -m http.server 8765
```

Then visit http://127.0.0.1:8765/

## Deploy on Vercel (manual)

This is a static site. No build step, no environment variables.

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import the GitHub repo `WaterparkEnthusiasts_DigitalTwin.ai`
3. Confirm:
   - **Framework Preset:** Other
   - **Build Command:** leave empty
   - **Output Directory:** leave empty (project root)
   - **Install Command:** leave empty
4. Click **Deploy**

`vercel.json` already sets `framework` to none so Vercel serves the HTML as-is.

If you use the Vercel CLI instead:

```bash
npx vercel
```

Promote to production with `npx vercel --prod` when you are ready.
