# Moondriver - Moon Express Inc. Driver Trip Sheet

## Overview
A digital, mobile-friendly web application for Moon Express Inc. truck drivers to log trips, expenses, and mileage. It's a single-page app (SPA) with no backend — all logic runs in the browser.

## Architecture
- **Type**: Static single-page application
- **Languages**: HTML5, CSS3, Vanilla JavaScript
- **Entry point**: `index.html` (contains all markup, styles, and logic)
- **Package manager**: npm
- **Dev server**: `serve` (npm package)

## Running the App
```bash
npm start
```
Serves on `http://0.0.0.0:5000`

## Key Features
- Driver trip logging (pickup/delivery cities, dates, mileage)
- Expense tracking
- Data persistence via `localStorage` (key: `moonexpress_tripsheet`)
- Export as PNG (using `html2canvas` CDN at scale 3×) or JSON
- Print-friendly layout
- Auto-fill next row pickup from previous delivery (cascade)

## External APIs
- **zippopotam.us**: Zip code → city/state lookup (free, no key)

## Deployment
- Configured as a **static** deployment with `publicDir: "."`
- No build step required

## Workflow
- **Start application**: `npm start` → port 5000 (webview)
