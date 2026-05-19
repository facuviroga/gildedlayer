# Sculpture Portfolio

A lightweight, fully static gallery site that showcases digital sculptures you
can print and paint on commission. You never edit content by hand — you list
**creators** in one YAML file and a daily GitHub Action pulls fresh renders into
the gallery.

## How it works

```
data/creators.yaml      ← you edit this (your curated list of sculptors)
        │
        ▼
scripts/fetch.mjs       ← runs daily on GitHub Actions
        │
        ▼
data/models.json        ← auto-generated catalog
        │
        ▼
index.html  +  app.js   ← the site (vanilla JS, masonry grid, lightbox, filters)
        │
        ▼
GitHub Pages            ← public URL
```

## Setup (one-time, ~5 min)

1. Create a new repo on GitHub and push this folder to it.
2. In the repo: **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Actions → General → Workflow permissions → Read and write**
   (so the daily refresh can commit `data/models.json`).
4. Edit `data/creators.yaml` and add your real creators (see the comments at the
   top of that file for the schema).
5. Edit `index.html` and update the email + Instagram URL near the bottom.
6. Push. The deploy workflow publishes the site, and the refresh workflow runs
   daily (and can be triggered manually from the **Actions** tab).

## Local development

```bash
npm install
npm run fetch    # rebuild data/models.json from data/creators.yaml
npm run serve    # open http://localhost:8080
```

## Adding a creator

Open `data/creators.yaml` and add an entry like:

```yaml
- name: "My Favorite Sculptor"
  platform: myminifactory
  url: "https://www.myminifactory.com/users/their-handle"
  tags: [anime, busts]
  featured: ["specific-model-slug"]   # optional
```

Supported `platform` values: `myminifactory`, `gumroad`, `payhip`, `artstation`,
`tribes`, `generic` (OpenGraph fallback).

## A note on rights

This site republishes creators' marketing renders. Even if you've licensed a
sculpt, **using a creator's renders to advertise your commission service is a
gray area**. Best practice:

- Ask permission from each creator you feature.
- Keep the "Renders © original creators" credit in the footer.
- Always link back to the original (`source_url`) so traffic flows to them.

## File layout

```
index.html
assets/
  css/styles.css
  js/app.js
data/
  creators.yaml        ← edit this
  models.json          ← auto-generated, don't edit
scripts/
  fetch.mjs            ← scraper / API client
.github/workflows/
  refresh.yml          ← daily catalog refresh
  deploy.yml           ← Pages deploy on push to main
```
