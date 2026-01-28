# Pinterest "Aesthetic" Downloader Scraper

This Actor is a starter for downloading Pinterest "aesthetic" pins (images) and saving metadata. It uses CheerioCrawler for static HTML extraction. Pinterest is heavily client-side and often requires browser rendering; for reliable extraction use PlaywrightCrawler or official APIs.

Key features
- Discover pin links from provided start URLs (search, boards, profiles).
- Visit pin pages, extract image URL, title, author, board, saves, tags.
- Optionally download images to the default Key-Value store (KV) and store the KV key in Dataset.
- Limit number of pins per start URL and total requests per crawl.
- Use proxy configuration to reduce blocking for larger crawls.

Important notes
- Respect Pinterest Terms of Service and robots.txt. Do not attempt to bypass access controls, login barriers, or rate limits.
- For production-grade scraping:
  - Convert to PlaywrightCrawler to render JS and intercept network XHRs that return JSON payloads with richer data.
  - Add rate limiting, randomized delays, and proxy rotation.
  - Store API keys/credentials securely (do not commit them).
  - Consider using Pinterest's official APIs or partner programs where available.

How to run (from project root: pinterest-aesthetic-downloader-scraper)
1. Create the directory and add files (do NOT create storage/)
   - mkdir pinterest-aesthetic-downloader-scraper
   - cd pinterest-aesthetic-downloader-scraper
   - (create the files above in that folder)

2. Install dependencies:
   - npm install

3. Run the Actor locally:
   - apify run

4. Authenticate & push:
   - apify login
   - apify push

Recommended enhancements
- (A) Add PlaywrightCrawler fallback to render pages, wait for JSON payloads, and extract more reliable JSON data (recommended).
- (B) Add deduplication across runs in KV store (store seen pin IDs).
- (C) Add image post-processing (thumbnail generation) and output preview HTML or a small gallery in KV.
- (D) Add filtering by image aspect ratio, color palette, or other heuristics to select truly "aesthetic" pins.

Which enhancement would you like next? (A/B/C/D)