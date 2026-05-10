# 🚀 Deployen in 4 stappen — Nuyttens Family Food Store

Totale tijd: ongeveer 20 minuten. Alles gratis.

---

## Wat je nodig hebt

- GitHub account → github.com (gratis)
- Supabase account → supabase.com (gratis)
- Vercel account → vercel.com (gratis, log in met je GitHub account)

---

## Stap 1 — Database aanmaken in Supabase

1. Ga naar supabase.com → "Start your project" → maak een account
2. Klik "New project" → geef het een naam bv. "family-food-store" → kies een regio dicht bij jou (Frankfurt) → kies een wachtwoord (bewaar dit)
3. Wacht 1-2 minuten tot het project klaar is
4. Ga naar **SQL Editor** (linkermenu)
5. Plak de volledige inhoud van het bestand `supabase_schema.sql` erin
6. Klik **Run** → je ziet "Success"

**Jouw keys kopiëren:**
- Ga naar **Settings → API**
- Kopieer **Project URL** → dit is jouw `SUPABASE_URL`
- Kopieer **anon / public key** → dit is jouw `SUPABASE_ANON_KEY`

---

## Stap 2 — Code uploaden naar GitHub

1. Ga naar github.com → klik "+" rechts bovenaan → "New repository"
2. Naam: `family-food-store` → Private → klik "Create repository"
3. Klik op "uploading an existing file"
4. Sleep de volledige map `freezer-app` naar het uploadvenster (of upload de bestanden één voor één)
5. Klik "Commit changes"

---

## Stap 3 — Deployen via Vercel

1. Ga naar vercel.com → log in met je GitHub account
2. Klik "Add New Project"
3. Kies je repository `family-food-store`
4. Bij **Environment Variables** voeg je toe:
   - `REACT_APP_SUPABASE_URL` → plak je Project URL van Supabase
   - `REACT_APP_SUPABASE_ANON_KEY` → plak je anon key van Supabase
5. Klik **Deploy** → wacht 2-3 minuten
6. Vercel geeft je een URL zoals: `https://family-food-store-xyz.vercel.app`

✅ De app is nu live en iedereen die de URL heeft kan hem gebruiken!

---

## Stap 4 — Op iPhone zetten als app

**Op elke iPhone die de app wil gebruiken:**

1. Open Safari op de iPhone
2. Ga naar jouw Vercel URL
3. Tik op het **Deel-icoon** (vierkantje met pijltje omhoog, onderaan)
4. Scroll naar beneden → tik **"Zet op beginscherm"**
5. Geef het een naam bv. "FoodStore" → tik **Voeg toe**

De app staat nu op het beginscherm als een echt appje — geen browser-balk, geen adresbalk, gewoon de app op volledig scherm.

**Doe dit op elk toestel van het gezin** met dezelfde URL → iedereen werkt met dezelfde data in real-time.

---

## Problemen?

- **"Cannot read properties of undefined"** → Supabase keys zijn niet correct ingevuld in Vercel
- **Lege app na deploy** → SQL schema is niet uitgevoerd in Supabase
- **App werkt niet op iPhone** → gebruik Safari, niet Chrome, voor "Zet op beginscherm"

---

## Jouw URL delen

Stuur gewoon de Vercel URL door via WhatsApp aan je gezin.
Iedereen zet hem op het beginscherm en klaar.
