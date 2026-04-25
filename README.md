# Moon2026

Moon Express trip report, paystub, settlement, and admin dashboard app.

## Run Locally

```bash
npm start
```

Open `http://localhost:3000`.

## Replit

Import this GitHub repo into Replit, then click **Run**. Replit will run `npm start` and serve the app from `server.js`.

The app includes local JSON storage for admin settings and reports through `/api/db`. Uploaded trip, paystub, settlement PDF, and receipt files are stored under `data/uploads` on the server. The `/api/send` endpoint saves email payloads to `data/outbox`; connect a real email provider before relying on live email delivery.

For hosted use, set a Replit Secret named `ADMIN_PASSWORD`. If it is not set, the server falls back to the local development password.

Google Maps mileage uses the current Google Routes API. For hosted use, set a Replit Secret named `GOOGLE_MAPS_API_KEY`; ZIP-to-ZIP route lookup will use that server-side key even if the Admin Settings key field is blank. In Google Cloud, enable **Routes API** for the key's project and keep billing active.
