// Pinterest "Aesthetic" Downloader Scraper - Cheerio starter
// Notes:
// - Pinterest is heavily client-side. For robust extraction, use PlaywrightCrawler or official APIs.
// - This starter attempts to find pin links and image URLs from static HTML. It downloads images to KV store if configured.

import { Actor } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const {
  startUrls = ['https://www.pinterest.com/search/pins/?q=aesthetic'],
  maxRequestsPerCrawl = 200,
  maxPinsPerStartUrl = 500,
  downloadImages = true,
  imageKeyPrefix = 'pinterest_image_',
  pinLinkSelector = 'a[href*="/pin/"]',
  userAgent = 'pinterest-aesthetic-downloader (+https://example.com)'
} = input;

if (!Array.isArray(startUrls) || startUrls.length === 0) {
  Actor.log.fatal('startUrls must be a non-empty array of URLs');
  await Actor.exit({ exitCode: 1 });
}

const proxyConfiguration = await Actor.createProxyConfiguration();
const kvStore = downloadImages ? await Actor.openKeyValueStore() : null;

// helpers
function extractPinId(url) {
  try {
    const u = new URL(url, 'https://www.pinterest.com');
    // URL patterns: /pin/<id>/...
    const m = u.pathname.match(/\/pin\/(\d+)/);
    if (m) return m[1];
    // fallback: last path segment
    const parts = u.pathname.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : null;
  } catch {
    return null;
  }
}

function guessImageFromTile($tile) {
  // try data-src, srcset, src, background-image
  const img = $tile.find('img').first();
  if (img && img.length) {
    const src = img.attr('src') || img.attr('data-src') || img.attr('data-original') || img.attr('srcset');
    if (src) {
      // srcset may contain multiple candidates; pick first URL-like token
      if (src.includes(' ')) return src.split(' ')[0];
      return src;
    }
  }
  // background-image
  const style = $tile.attr('style') || '';
  const m = style.match(/background-image:\s*url\(['"]?([^'")]+)['"]?\)/i);
  if (m) return m[1];
  return null;
}

async function saveImageToKv(url, pinId, log) {
  if (!kvStore || !url) return null;
  try {
    log.info('Downloading image', { url });
    const headers = { 'User-Agent': userAgent, Accept: '*/*' };
    const res = await fetch(url, { headers });
    if (!res.ok) {
      log.warning('Image request failed', { url, status: res.status });
      return null;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    // determine extension
    let ext = 'bin';
    if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';
    else if (contentType.includes('png')) ext = 'png';
    else if (contentType.includes('webp')) ext = 'webp';
    else if (contentType.includes('gif')) ext = 'gif';
    const key = `${imageKeyPrefix}${pinId || Date.now()}.${ext}`;
    await kvStore.setValue(key, buffer, { contentType });
    return key;
  } catch (err) {
    log.warning('Failed to save image to KV', { url, error: err.message });
    return null;
  }
}

// main crawler
const crawler = new CheerioCrawler({
  proxyConfiguration,
  maxRequestsPerCrawl,
  requestHandlerTimeoutSecs: 120,
  async requestHandler({ request, $, log, enqueueLinks, response }) {
    log.info('Processing', { url: request.url });

    // keep per-start-url counters
    request.userData.collected = request.userData.collected || 0;
    const limit = Number(maxPinsPerStartUrl) || 500;

    // find pins using configured selector (common fallback)
    const anchors = $(pinLinkSelector);
    const pinUrls = new Set();

    anchors.each((i, a) => {
      try {
        const href = $(a).attr('href');
        if (!href) return;
        const abs = new URL(href, request.loadedUrl).href;
        // ensure pattern contains /pin/
        if (abs.includes('/pin/')) pinUrls.add(abs.split('?')[0]);
      } catch {}
    });

    // fallback: try to find <div> tiles with data-test attributes or images that link to pins
    if (pinUrls.size === 0) {
      $('a').each((i, a) => {
        const href = $(a).attr('href') || '';
        if (href.includes('/pin/')) {
          try {
            const abs = new URL(href, request.loadedUrl).href;
            pinUrls.add(abs.split('?')[0]);
          } catch {}
        }
      });
    }

    // Enqueue discovered pin pages for detailed extraction
    const toEnqueue = Array.from(pinUrls).slice(0, Math.max(0, limit - request.userData.collected));
    if (toEnqueue.length) {
      await enqueueLinks({ urls: toEnqueue.map((u) => ({ url: u, userData: { startUrl: request.userData.startUrl || request.url } })) });
      log.info('Enqueued pin pages', { count: toEnqueue.length });
    }

    // If current page looks like a pin page, attempt to extract metadata & image
    // Pinterest pin page often contains meta tags and JSON LD.
    const isPinPage = /\/pin\/\d+/.test(request.loadedUrl);
    if (isPinPage) {
      try {
        // attempt to extract JSON data embedded in the page
        let jsonData = null;
        $('script[type="application/ld+json"]').each((i, s) => {
          try {
            const txt = $(s).text();
            const j = JSON.parse(txt);
            if (j && (j['@type'] === 'ImageObject' || j['@type'])) {
              jsonData = j;
            }
          } catch {}
        });

        // meta tags fallback
        const title = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || $('title').text().trim();
        const imageUrl = $('meta[property="og:image"]').attr('content') || guessImageFromTile($, $('body')) || null;
        const author = $('meta[name="pinterestapp:creator_user"]').attr('content') || $('a[href*="/user/"]').first().text().trim() || null;
        const board = $('meta[name="pinterestapp:board"]').attr('content') || $('a[href*="/board/"]').first().text().trim() || null;
        const pinId = extractPinId(request.loadedUrl);

        // Try to extract tags or topics from page text or meta keywords
        const tags = [];
        $('meta[name="keywords"]').each((i, el) => {
          const k = $(el).attr('content') || '';
          if (k) tags.push(...k.split(',').map((s) => s.trim()).filter(Boolean));
        });

        // Try to guess saves count
        let saves = null;
        const savesText = $('meta[name="pinterestapp:save_count"]').attr('content') || $('button[aria-label*="save"]').text();
        if (savesText) {
          const m = String(savesText).replace(/[^\d,]/g, '').replace(/,/g, '');
          if (m) saves = parseInt(m, 10);
        }

        const now = new Date().toISOString();

        // Optionally download image
        let kvKey = null;
        if (downloadImages && imageUrl) {
          kvKey = await saveImageToKv(imageUrl, pinId || ('' + Date.now()), log);
        }

        const item = {
          pinId: pinId || null,
          title: title || (jsonData && jsonData.caption) || null,
          author: author || null,
          board: board || null,
          imageUrl: imageUrl || (jsonData && jsonData.contentUrl) || null,
          imageKvKey: kvKey,
          tags: tags.length ? tags : null,
          saves: saves || null,
          sourceUrl: request.loadedUrl,
          scrapedAt: now
        };

        await Dataset.pushData(item);
        request.userData.collected += 1;
        log.info('Saved pin', { pinId: item.pinId, title: item.title });
      } catch (err) {
        log.error('Failed to extract pin page', { url: request.url, error: err.message });
      }
    }

    // Continue crawling links for more discovery
    await enqueueLinks();
  },

  handleFailedRequestFunction: async ({ request, error, log }) => {
    log.error('Request failed', { url: request.url, error: error?.message ?? error });
  }
});

const startRequests = startUrls.map((u) => ({ url: u, userData: { startUrl: u } }));
await crawler.run(startRequests);

// graceful exit
await Actor.exit();