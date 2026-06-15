# Personal Collection Registry

A private collection tracker for music albums, games, figures, and books.
Built with Sanity.io (CMS) + Astro (frontend), deployed on Vercel.

## Architecture

```
sanity/          ← Content model + Studio (your private data lives here)
astro/           ← Frontend site (open source, no data)
```

## Setup

### 1. Sanity (your private data)

```bash
cd sanity
npm install
npx sanity init   # Creates a new project under YOUR Sanity account
npm run dev       # Start Studio locally on localhost:3333
npx sanity deploy # Deploy Studio to sanity.io/studio/your-project-name
```

### 2. Astro (frontend)

```bash
cd astro
npm install
cp .env.example .env
# Fill in your Sanity project ID and token in .env
npm run dev       # localhost:4321
```

### 3. Environment variables

Copy `astro/.env.example` to `astro/.env` and fill in:

```
SANITY_PROJECT_ID=your_project_id   # From sanity.io/manage
SANITY_DATASET=production
SANITY_TOKEN=your_read_token        # From sanity.io/manage → API → Tokens
```

**Never commit `.env` to Git.**

### 4. Deploy to Vercel

- Connect your GitHub repo to Vercel
- Add the three env variables above in Vercel project settings
- Deploy

## Google Photos

In Sanity Studio, each item has a `photoUrl` field.
Paste the shareable link from Google Photos directly into this field.
No API setup needed.

To get a Google Photos link: open photo → Share → Create link → Copy link.

## Data privacy

- Your Sanity project is private to your account
- The GitHub repo contains only code (schemas, pages) — no personal data
- API token is stored in `.env` locally and in Vercel env vars — never in Git
- Anyone can clone the repo and run it with their own Sanity project
