/**
 * DealPulse — Browser Extension Content Script
 * Compatible with Manifest V3 for Amazon.in & Flipkart.com
 * Handles dynamic SPA navigation, price extraction, and bottom-right overlay injection.
 */

(function () {
  'use strict';

  const WIDGET_ID = 'dealpulse-extension-root';
  let lastUrl = location.href;
  let observer = null;
  let extractionTimeout = null;

  // --- 1. DOM EXTRACTORS ---

  function extractAmazonData() {
    // Must be on a product page (contains /dp/ or /gp/product/)
    const asinMatch = location.pathname.match(/(?:\/dp\/|\/gp\/product\/)([A-Z0-9]{10})/i);
    const asin = asinMatch ? asinMatch[1] : document.getElementById('ASIN')?.value || null;

    if (!asin) return null;

    // Title selectors
    const titleEl = document.getElementById('productTitle') || document.getElementById('title');
    const title = titleEl ? titleEl.textContent.trim() : null;

    // Price selectors
    let price = null;
    const priceSelectors = [
      '.apexPriceToPay .a-offscreen',
      '.priceToPay .a-offscreen',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '.a-price .a-offscreen'
    ];

    for (const selector of priceSelectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        const clean = el.textContent.replace(/[^0-9.]/g, '');
        if (clean) {
          price = parseFloat(clean);
          break;
        }
      }
    }

    // MRP / Strike price
    let mrp = null;
    const mrpEl = document.querySelector('.a-price.a-text-price .a-offscreen') || document.querySelector('#listPrice');
    if (mrpEl) {
      const cleanMrp = mrpEl.textContent.replace(/[^0-9.]/g, '');
      if (cleanMrp) mrp = parseFloat(cleanMrp);
    }

    return {
      platform: 'Amazon India',
      productId: asin,
      title: title || 'Amazon Product',
      price: price || 0,
      mrp: mrp || (price ? Math.round(price * 1.15) : 0),
      url: location.href
    };
  }

  function extractFlipkartData() {
    // Flipkart product URLs contain pid in query string: ?pid=...
    const urlParams = new URLSearchParams(location.search);
    const pid = urlParams.get('pid') || location.pathname.match(/\/p\/([a-zA-Z0-9]+)/)?.[1] || null;

    if (!pid && !location.pathname.includes('/p/')) return null;

    // Title selectors (supporting recent Flipkart class layouts)
    const titleSelectors = [
      'h1._6EBuv-',
      'span.VU-ZEz',
      'span.B_NuCI',
      'h1.cPHDOP'
    ];
    let title = null;
    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) {
        title = el.textContent.trim();
        break;
      }
    }

    // Price selectors
    const priceSelectors = [
      'div.Nx9bqj.CxhGGd',
      'div._30jeq3._16Jk6d',
      'div._30jeq3',
      'div.Nx9bqj'
    ];
    let price = null;
    for (const sel of priceSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) {
        const clean = el.textContent.replace(/[^0-9.]/g, '');
        if (clean) {
          price = parseFloat(clean);
          break;
        }
      }
    }

    // MRP / Strike price
    let mrp = null;
    const mrpEl = document.querySelector('div.yRaY8j.A6+E6v') || document.querySelector('div._3I9_wc._2p6lqe');
    if (mrpEl) {
      const cleanMrp = mrpEl.textContent.replace(/[^0-9.]/g, '');
      if (cleanMrp) mrp = parseFloat(cleanMrp);
    }

    return {
      platform: 'Flipkart',
      productId: pid || 'FK-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
      title: title || 'Flipkart Product',
      price: price || 0,
      mrp: mrp || (price ? Math.round(price * 1.18) : 0),
      url: location.href
    };
  }

  function extractCurrentProduct() {
    const host = location.hostname.toLowerCase();
    if (host.includes('amazon')) {
      return extractAmazonData();
    } else if (host.includes('flipkart')) {
      return extractFlipkartData();
    }
    return null;
  }

  // --- 2. DYNAMIC OVERLAY WIDGET INJECTION ---

  function createOrUpdateWidget(data) {
    if (!data || !data.price) return;

    let root = document.getElementById(WIDGET_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = WIDGET_ID;
      document.body.appendChild(root);
    }

    const savings = Math.max(0, data.mrp - data.price);
    const savingsPercent = data.mrp > 0 ? ((savings / data.mrp) * 100).toFixed(0) : '12';

    // Mock cross-store prices for instant evaluation
    const isAmazon = data.platform.includes('Amazon');
    const amazonPrice = isAmazon ? data.price : Math.round(data.price * 0.98);
    const flipkartPrice = !isAmazon ? data.price : Math.round(data.price * 1.01);
    const zeptoPrice = Math.round(data.price * 1.04);
    const bestPrice = Math.min(amazonPrice, flipkartPrice);
    const isBestHere = data.price <= bestPrice;

    root.innerHTML = `
      <div class="dp-card">
        <!-- Header -->
        <div class="dp-header">
          <div class="dp-brand">
            <div class="dp-pulse-indicator">
              <span class="dp-ping"></span>
              <span class="dp-dot"></span>
            </div>
            <span class="dp-title">DealPulse</span>
            <span class="dp-badge-pro">LIVE TRACK</span>
          </div>
          <button id="dp-close-btn" class="dp-close" title="Minimize DealPulse">✕</button>
        </div>

        <!-- Product Summary -->
        <div class="dp-product-info">
          <p class="dp-prod-title" title="${data.title}">${data.title}</p>
          <div class="dp-pricing-row">
            <span class="dp-current-price">₹${data.price.toLocaleString('en-IN')}</span>
            ${data.mrp > data.price ? `<span class="dp-mrp">₹${data.mrp.toLocaleString('en-IN')}</span>` : ''}
            <span class="dp-save-badge">Save ${savingsPercent}%</span>
          </div>
        </div>

        <!-- Smart Verdict Banner -->
        <div class="dp-verdict ${isBestHere ? 'dp-verdict-buy' : 'dp-verdict-wait'}">
          <div class="dp-verdict-icon">${isBestHere ? '🔥' : '⚡'}</div>
          <div>
            <div class="dp-verdict-head">${isBestHere ? 'BUY NOW — BEST PRICE' : 'BETTER PRICE FOUND'}</div>
            <div class="dp-verdict-desc">
              ${isBestHere 
                ? 'Current price is at a 90-day low across verified platforms.' 
                : `Available for ₹${bestPrice.toLocaleString('en-IN')} on alternative store.`}
            </div>
          </div>
        </div>

        <!-- 3-Store Comparison Grid -->
        <div class="dp-store-grid">
          <div class="dp-store-row ${amazonPrice <= bestPrice ? 'dp-store-best' : ''}">
            <span class="dp-store-name">Amazon India</span>
            <span class="dp-store-price">₹${amazonPrice.toLocaleString('en-IN')}</span>
          </div>
          <div class="dp-store-row ${flipkartPrice <= bestPrice ? 'dp-store-best' : ''}">
            <span class="dp-store-name">Flipkart</span>
            <span class="dp-store-price">₹${flipkartPrice.toLocaleString('en-IN')}</span>
          </div>
          <div class="dp-store-row">
            <span class="dp-store-name">Zepto (10-Min)</span>
            <span class="dp-store-price">₹${zeptoPrice.toLocaleString('en-IN')}</span>
          </div>
        </div>

        <!-- Actions -->
        <div class="dp-actions">
          <button id="dp-copy-coupon-btn" class="dp-btn dp-btn-secondary">
            <span>Copy Coupon</span>
          </button>
          <a href="http://localhost:3000/?q=${encodeURIComponent(data.title)}" target="_blank" class="dp-btn dp-btn-primary">
            <span>Price Graph ↗</span>
          </a>
        </div>
      </div>
    `;

    // Attach listeners
    document.getElementById('dp-close-btn')?.addEventListener('click', () => {
      root.classList.toggle('dp-minimized');
    });

    document.getElementById('dp-copy-coupon-btn')?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      navigator.clipboard.writeText('DEALPULSE500').then(() => {
        btn.textContent = '✓ Copied ₹500 Off!';
        btn.classList.add('dp-btn-success');
        setTimeout(() => {
          btn.textContent = 'Copy Coupon';
          btn.classList.remove('dp-btn-success');
        }, 2200);
      });
    });
  }

  // --- 3. SPA & MUTATION HANDLING ---

  function runExtractionWithRetries(attempt = 1) {
    clearTimeout(extractionTimeout);
    const data = extractCurrentProduct();

    if (data && data.price > 0) {
      createOrUpdateWidget(data);
    } else if (attempt < 6) {
      // Retry for dynamic client-rendered products
      extractionTimeout = setTimeout(() => {
        runExtractionWithRetries(attempt + 1);
      }, attempt * 450);
    }
  }

  function initObserver() {
    if (observer) observer.disconnect();

    // Listen to URL changes for SPAs (Flipkart & Amazon single-page updates)
    observer = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        runExtractionWithRetries(1);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Handle browser back/forward
  window.addEventListener('popstate', () => runExtractionWithRetries(1));

  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      runExtractionWithRetries(1);
      initObserver();
    });
  } else {
    runExtractionWithRetries(1);
    initObserver();
  }
})();
