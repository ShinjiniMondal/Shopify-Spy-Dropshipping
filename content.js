(() => {
  console.log("[StoreSight] content.js loaded and executing.");

  function detectShopify() {
    return new Promise((resolve) => {
      // Inject script to access window.Shopify
      const script = document.createElement('script');
      script.textContent = `
        (function() {
          try {
            const isShopify = !!window.Shopify || !!window.BOOMR?.themeName;
            const themeName = window.Shopify?.theme?.name || window.BOOMR?.themeName || 'Unknown';
            const currency = window.Shopify?.currency?.active || 'Unknown';
            const country = window.Shopify?.country || 'Unknown';
            const locale = window.Shopify?.locale || document.documentElement.lang || 'en';
            
            window.postMessage({
              type: 'SHOPIFY_DETECTED',
              data: { isShopify, themeName, currency, country, locale }
            }, '*');
          } catch(e) {
             window.postMessage({ type: 'SHOPIFY_DETECTED', data: { isShopify: false } }, '*');
          }
        })();
      `;
      
      const listener = (event) => {
        if (event.source === window && event.data.type === 'SHOPIFY_DETECTED') {
          window.removeEventListener('message', listener);
          resolve(event.data.data);
        }
      };
      
      // Fallback timeout in case injected script fails to postMessage
      setTimeout(() => {
        window.removeEventListener('message', listener);
        resolve({ isShopify: false });
      }, 1000);

      window.addEventListener('message', listener);
      document.head.appendChild(script);
      script.remove();
    });
  }

  function detectApps() {
    const scripts = Array.from(document.scripts);
    const urls = scripts.map(s => s.src).filter(Boolean);
    const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(l => l.href);
    
    const allUrls = [...urls, ...links];
    
    const appSignatures = {
      'Klaviyo': /klaviyo\.com/,
      'Loox': /loox\.io/,
      'Judge.me': /judge\.me/,
      'Yotpo': /yotpo\.com/,
      'Gorgias': /gorgias\.chat/,
      'Privy': /privy\.com/,
      'Smile.io': /smile\.io/,
      'Omnisend': /omnisend\.com/,
      'Bold Upsell': /boldapps\.net/,
      'Recharge': /rechargeapps\.com/,
      'PageFly': /pagefly/,
      'Shogun': /getshogun/,
      'Gempages': /gempages/,
      'Oberlo': /oberlo/,
      'DSers': /dsers/
    };

    const detectedApps = [];
    
    for (const [appName, regex] of Object.entries(appSignatures)) {
      if (allUrls.some(url => regex.test(url))) {
        detectedApps.push(appName);
      }
    }
    
    return detectedApps;
  }

  function detectSocialLinks() {
    const platforms = [
      { key: 'facebook',  patterns: [/facebook\.com\/(?!sharer|share|dialog|plugins|events|groups|pages\/category|legal|policies|help|privacy|terms|ads|business|watch|marketplace|gaming|video)([a-zA-Z0-9._%-]{2,})/i] },
      { key: 'instagram', patterns: [/instagram\.com\/([a-zA-Z0-9._]{2,})\/?/i] },
      { key: 'tiktok',   patterns: [/tiktok\.com\/@([a-zA-Z0-9._]{2,})\/?/i, /tiktok\.com\/([a-zA-Z0-9._]{2,})\/?/i] },
      { key: 'pinterest', patterns: [/pinterest\.com\/([a-zA-Z0-9._-]{2,})\/?/i] },
      { key: 'youtube',  patterns: [/youtube\.com\/(?:channel\/|c\/|user\/|@)([a-zA-Z0-9._-]{2,})\/?/i] },
      { key: 'twitter',  patterns: [/(?:twitter|x)\.com\/([a-zA-Z0-9_]{2,})\/?/i] },
      { key: 'snapchat', patterns: [/snapchat\.com\/add\/([a-zA-Z0-9._-]{2,})\/?/i] },
    ];

    // Excluded terms that are platform-level (not store accounts)
    const excluded = /^(www|shop|home|about|login|signup|help|support|search|explore|discover|trending|reels|stories|video|videos|live|hashtag|tags?|music|sounds?|effects?|upload|create|business|ads|advertising|developers?|policies|legal|privacy|terms|safety|guidelines|blog|news|press|careers?|jobs?|events?|places?|groups?|pages?|fundraisers?|gaming|marketplace|watch|creator|creators?|studio|analytics|dashboard)$/i;

    const hrefs = Array.from(document.querySelectorAll('a[href]'))
      .map(a => a.href)
      .filter(Boolean);

    // Also check meta og:url and other meta tags
    const metaUrls = Array.from(document.querySelectorAll('meta[content]'))
      .map(m => m.content)
      .filter(c => c && /^https?:/.test(c));

    const allUrls = [...hrefs, ...metaUrls];
    const found = {};

    for (const { key, patterns } of platforms) {
      if (found[key]) continue;
      for (const href of allUrls) {
        for (const pattern of patterns) {
          const m = href.match(pattern);
          if (m) {
            const handle = m[1];
            if (!excluded.test(handle) && handle.length >= 2) {
              found[key] = href.split('?')[0].replace(/\/$/, '');
              break;
            }
          }
        }
        if (found[key]) break;
      }
    }

    return found;
  }

  function fallbackDetection() {
    console.log("[StoreSight] Running fallback Shopify detection...");
    const hasShopifyCDN = Array.from(document.scripts).some(s => s.src && s.src.includes('cdn.shopify.com'));
    const hasShopifyLinks = Array.from(document.querySelectorAll('link')).some(l => l.href && l.href.includes('cdn.shopify.com'));
    const hasShopifyMeta = document.querySelector('meta[name="shopify-checkout-api-token"]') !== null;
    return hasShopifyCDN || hasShopifyLinks || hasShopifyMeta;
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("[StoreSight] Message received in content script:", request);
    
    if (request.action === 'analyze_store') {
      detectShopify().then(shopifyData => {
        console.log("[StoreSight] detectShopify result:", shopifyData);
        
        let isShopify = shopifyData.isShopify;
        if (!isShopify) {
          isShopify = fallbackDetection();
          console.log("[StoreSight] Fallback detection result:", isShopify);
        }
        
        if (!isShopify) {
           sendResponse({ isShopify: false, error: "Not a Shopify store." });
           return;
        }
        
        const apps = detectApps();
        const socialLinks = detectSocialLinks();
        console.log("[StoreSight] Detected apps:", apps);
        console.log("[StoreSight] Detected social links:", socialLinks);
        
        sendResponse({
          isShopify: true,
          theme: shopifyData.themeName || 'Unknown',
          currency: shopifyData.currency && shopifyData.currency !== 'Unknown' ? shopifyData.currency : null,
          country: shopifyData.country && shopifyData.country !== 'Unknown' ? shopifyData.country : null,
          locale: shopifyData.locale || 'en',
          apps: apps,
          socialLinks: socialLinks
        });
      }).catch(err => {
         console.error("[StoreSight] Error during detection:", err);
         sendResponse({ isShopify: false, error: "Error during detection." });
      });
      return true; // Keep message channel open for async response
    }
  });
})();
