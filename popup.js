const TRACKED_LIMIT = 5;
let currentAdsData = [];
let hasAIInitialized = false;
let globalAppsData = [];
let globalProductsData = [];
let globalOrigin = '';
let wishlistSet = new Set();
let suggestionsRenderedForTurn = false;

document.addEventListener('DOMContentLoaded', async () => {
  console.log("[StoreSight] Popup loaded. Starting analysis...");

  setTimeout(() => {
    const loader = document.getElementById('loading');
    if (loader && !loader.classList.contains('hidden')) {
      showMainContent();
    }
  }, 8000);

  // Storage init for Tracked & History
  chrome.storage.local.get(['history', 'trackedShops'], (res) => {
    renderHistoryPreviews(res.history || []);
    renderHistoryFull(res.history || []);
    renderTrackedPreview(res.trackedShops || []);
    renderTrackedFull(res.trackedShops || []);
    document.getElementById('tracked-usage').textContent = `${(res.trackedShops || []).length} / ${TRACKED_LIMIT}`;
  });

  // View switchers
  document.getElementById('btn-all-traffic').addEventListener('click', () => {
    switchView('view-traffic');
    setTimeout(() => renderMonthlyVisitsChart(), 60);
  });
  document.getElementById('btn-back-main').addEventListener('click', () => switchView('view-main'));

  document.getElementById('btn-all-products').addEventListener('click', () => {
    renderAllProductsView(globalProductsData);
  });

  document.getElementById('btn-all-ads').addEventListener('click', () => {
    switchView('view-ads');
    renderAdsView('google'); // Default tab
  });
  document.getElementById('btn-back-main-ads').addEventListener('click', () => switchView('view-main'));

  document.getElementById('btn-all-history').addEventListener('click', () => switchView('view-history'));
  document.getElementById('btn-back-main-history').addEventListener('click', () => switchView('view-main'));

  document.getElementById('btn-all-tracked').addEventListener('click', () => switchView('view-tracked'));
  document.getElementById('btn-back-main-tracked').addEventListener('click', () => switchView('view-main'));

  document.getElementById('btn-clear-history').addEventListener('click', () => {
    chrome.storage.local.set({ history: [] }, () => {
      renderHistoryPreviews([]);
      renderHistoryFull([]);
    });
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      renderAdsView(e.target.dataset.platform);
    });
  });

  const aiChatView = document.createElement("div");
  aiChatView.id = "view-ai-chat";
  aiChatView.className = "container hidden";
  aiChatView.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100vh; display: flex; flex-direction: column; background: white; z-index: 9999; overflow: hidden;";
  aiChatView.innerHTML = `
    <header class="header pink-header" style="flex-shrink: 0; background: white; padding: 14px 16px; border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; justify-content: space-between; z-index: 10; margin: 0; width: 100%; box-sizing: border-box;">
      <div class="logo" style="cursor: pointer; display: flex; align-items: center; gap: 8px;" id="btn-back-main-ai">
        <span class="icon back-btn" style="font-size: 16px; color: #c94f6d; font-weight: bold;">←</span>
        <h1 style="font-size: 16px; font-weight: 700; color: #111827; margin: 0; line-height: 1;">AI CHAT</h1>
      </div>
      <span id="ai-query-counter" style="font-size: 12px; color: #6b7280; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">0 / 20 free queries used</span>
    </header>
    <div id="ai-chat-content" class="detail-content" style="display: flex; flex-direction: column; padding: 12px 12px 0 12px; flex: 1; overflow-y: auto; min-height: 0; box-sizing: border-box;">
    </div>
    <div id="ai-input-sticky-wrapper" style="flex-shrink: 0; position: sticky; bottom: 0; background: white; padding: 8px 12px; border-top: 1px solid #eee; z-index: 5; box-sizing: border-box; width: 100%;">
    </div>
  `;
  document.body.appendChild(aiChatView);

  document.getElementById('btn-back-main-ai').addEventListener('click', () => {
    // Restore body and html styles to default
    document.documentElement.style.height = '';
    document.body.style.height = '';
    document.body.style.overflow = '';

    const mainCard = document.querySelector(".ai-chat-card");
    const inputContainer = document.querySelector(".ai-input-container");
    if (mainCard && inputContainer) {
      inputContainer.style.marginTop = "0";
      mainCard.appendChild(inputContainer);
    }
    switchView('view-main');
  });

  const triggerAIAction = async () => {
    const aiView = document.getElementById("view-ai-chat");
    const isHidden = aiView.classList.contains("hidden");

    if (isHidden) {
      // Setup body and html styles for full available viewport height without browser scroll
      document.documentElement.style.height = '100vh';
      document.body.style.height = '100vh';
      document.body.style.overflow = 'hidden';

      // Update query counter display
      chrome.storage.local.get(['aiQueryCount'], (res) => {
        const count = res.aiQueryCount || 0;
        const counterEl = document.getElementById("ai-query-counter");
        if (counterEl) {
          counterEl.textContent = `${count} / 20 free queries used`;
        }
      });

      const content = document.getElementById("ai-chat-content");
      const chatBox = document.getElementById("aiChatBox");
      const suggestions = document.getElementById("aiSuggestions");
      const inputContainer = document.querySelector(".ai-input-container");
      const stickyWrapper = document.getElementById("ai-input-sticky-wrapper");

      if (inputContainer && stickyWrapper) {
        inputContainer.style.cssText = "width: 100%; box-sizing: border-box;";
        stickyWrapper.appendChild(inputContainer);
      }
      // chatBox and suggestions are created directly inside 
      // ai-chat-content by appendChatMessage and renderSuggestedQuestions
      // so do NOT move them manually here

      switchView('view-ai-chat');

      if (!hasAIInitialized) {
        hasAIInitialized = true;
        await initAIChat();
      }
    }

    handleAI();
  };

  document.getElementById("aiSendBtn").addEventListener("click", triggerAIAction);
  document.getElementById("aiInput").addEventListener("keypress", (e) => {
    if (e.key === "Enter") triggerAIAction();
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url || tab.url.startsWith('chrome://')) {
    console.warn("[StoreSight] Invalid tab or chrome:// URL.");
    showError("Cannot analyze this page.");
    return;
  }

  const url = new URL(tab.url);
  globalOrigin = url.origin;
  const domain = url.hostname;

  const storeDomainEl = document.getElementById('store-domain');
  if (storeDomainEl) {
    storeDomainEl.textContent = domain;
    if (storeDomainEl.tagName.toLowerCase() === 'a') {
      storeDomainEl.href = 'https://' + domain;
    }
  }
  document.getElementById('store-screenshot').src = `https://image.thum.io/get/width/600/crop/800/noanimate/${tab.url}`;

  let supabaseData = null;
  try {
    supabaseData = await fetchStoreData(domain);
    if (supabaseData) {
      console.log("SUPABASE RESPONSE DATA:", supabaseData);
      updateUI(supabaseData);
    }

    document.getElementById('copy-domain').addEventListener('click', () => {
      navigator.clipboard.writeText(domain);
      const btn = document.getElementById('copy-domain');
      btn.textContent = '✅';
      setTimeout(() => btn.textContent = '📋', 2000);
    });

    const newThemeBtn = document.getElementById('btn-use-theme-new');
    if (newThemeBtn) {
      newThemeBtn.addEventListener('click', () => {
        window.open('https://themes.shopify.com/themes?irclickid=QqMViix9dxyZRXi2A%3AUoiSQvUkuULVS0Z2-GXM0&irgwc=1&afsrc=1&partner=3512566&affpt=excluded&utm_channel=affiliates&utm_source=3512566-impact&utm_medium=cpa&iradid=1061744', '_blank');
      });
    }

    const appsThemeBtn = document.getElementById('btn-use-theme-apps');
    if (appsThemeBtn) {
      appsThemeBtn.addEventListener('click', () => {
        window.open('https://themes.shopify.com/themes?irclickid=QqMViix9dxyZRXi2A%3AUoiSQvUkuULVS0Z2-GXM0&irgwc=1&afsrc=1&partner=3512566&affpt=excluded&utm_channel=affiliates&utm_source=3512566-impact&utm_medium=cpa&iradid=1061744', '_blank');
      });
    }

    const btnAppsView = document.getElementById('btn-open-apps-view');
    if (btnAppsView) {
      btnAppsView.addEventListener('click', () => {
        switchView('view-apps');
      });
    }

    const btnDiscountsView = document.getElementById('btn-open-discounts-view');
    if (btnDiscountsView) {
      btnDiscountsView.addEventListener('click', () => {
        renderDiscountsView();
        switchView('view-discounts');
      });
    }

    const btnBackMainApps = document.getElementById('btn-back-main-apps');
    if (btnBackMainApps) {
      btnBackMainApps.addEventListener('click', () => {
        switchView('view-main');
      });
    }

    const btnAllTrends = document.getElementById('btn-all-trends');
    if (btnAllTrends) {
      btnAllTrends.addEventListener('click', () => {
        renderAllTrendsView(globalProductsData);
        switchView('view-all-trends');
      });
    }

    const btnBackMainTrends = document.getElementById('btn-back-main-trends');
    if (btnBackMainTrends) {
      btnBackMainTrends.addEventListener('click', () => {
        switchView('view-main');
      });
    }

    const btnBackMainDiscounts = document.getElementById('btn-back-main-discounts');
    if (btnBackMainDiscounts) {
      btnBackMainDiscounts.addEventListener('click', () => {
        switchView('view-main');
      });
    }

    console.log("[StoreSight] Sending 'analyze_store' message to content script...");

    // 1. Ask content script for info, but don't fail if it times out
    let storeInfo = null;
    try {
      storeInfo = await sendMessageWithTimeout(tab.id, { action: 'analyze_store' }, 2000);
    } catch (e) {
      console.warn("[StoreSight] Content script missing or timed out. Proceeding anyway.");
    }

    // 2. If content script explicitly said it's NOT a Shopify store, trust it.
    if (storeInfo && storeInfo.isShopify === false) {
      showError("Not a Shopify store.");
      return;
    }

    // 3. Provide fallback info if content script didn't respond
    if (!storeInfo) {
      storeInfo = {
        isShopify: true,
        theme: 'Unknown',
        currency: 'USD',
        country: 'US',
        locale: 'en',
        apps: []
      };
    }

    currentAdsData = generateMockAds(domain);
    renderDiscountsPreview();

    setTimeout(() => {
      const b = [...document.querySelectorAll('*')]
        .find(el => el.textContent.trim() === 'All App Discounts >');
      if (b) b.onclick = () => switchView('view-discounts');
    }, 800);

    const btnOpenApps = document.getElementById('btn-open-apps-view');
    if (btnOpenApps) btnOpenApps.onclick = () => switchView('view-apps');

    setTimeout(() => {
      const b2 = document.getElementById('btn-open-apps-view') ||
        [...document.querySelectorAll('*')].find(el => el.textContent.trim() === 'All Shopify Apps >');
      if (b2) b2.onclick = () => switchView('view-apps');
    }, 800);

    // VERIFY DATA FLOW: store response properly into our local state
    if (supabaseData && supabaseData.theme) {
      storeInfo.theme = supabaseData.theme;
    }

    updateBasicStoreInfo(storeInfo);

    // Render Traffic Async
    setTimeout(() => {
      try {
        const trafficData = window.TrafficUtils.generateTrafficData(domain);
        renderTrafficUI(trafficData);
      } catch (e) {
        console.error("[StoreSight] Traffic generation failed:", e);
        document.getElementById('traffic-preview-chart').innerHTML = '<p class="fallback-msg">Traffic data unavailable</p>';
      }
    }, 100);

    // Load products asynchronously
    fetchProducts(url.origin).then(productsData => {
      globalProductsData = productsData || [];
      updateProductDependentUI(storeInfo, productsData, url.origin);
      renderLiveTrends(productsData, url.origin);
      renderRecommendedShops(productsData, domain);

      // Save History after getting data
      const productCount = productsData ? productsData.length : 0;
      const imgUrl = `https://image.thum.io/get/width/600/crop/800/noanimate/${tab.url}`;
      saveToHistory(storeInfo, domain, productCount, imgUrl);

      setTimeout(() => {
        const b = [...document.querySelectorAll('*')]
          .find(el => el.textContent.trim() === 'All Live Trends >');
        if (b) b.onclick = () => switchView('view-all-trends');
      }, 1000);

    }).catch(err => {
      console.error("[StoreSight] Async fetch error:", err);
      showDataError();
      const imgUrl = `https://image.thum.io/get/width/600/crop/800/noanimate/${tab.url}`;
      saveToHistory(storeInfo, domain, 0, imgUrl);
    });

  } catch (error) {
    console.error("[StoreSight] Analysis failed or timed out:", error);
    showError(error.message || "Unable to fetch store data.");
  } finally {
    // Show main UI layout ALWAYS in finally to prevent stuck loader
    showMainContent();
  }
});

// EVENT DELEGATION
document.addEventListener('click', (e) => {
  // History delete
  const delBtn = e.target.closest('.btn-delete');
  if (delBtn) {
    deleteHistoryItem(delBtn.dataset.domain);
  }

  // History card click
  const histCard = e.target.closest('.history-card');
  if (histCard) {
    e.preventDefault();
    chrome.tabs.create({ url: `https://${histCard.dataset.domain}` });
  }

  // Track shop from empty states
  const trackEmptyBtn = e.target.closest('#btn-track-empty');
  const trackFirstBtn = e.target.closest('#btn-track-first');
  if (trackEmptyBtn || trackFirstBtn) {
    trackCurrentShop();
  }

  // Track shop from Hero button
  const trackBtn = e.target.closest('.btn-track');
  if (trackBtn) {
    trackCurrentShop();
  }

  // Clickable tracked shops
  const trackedItem = e.target.closest('.tracked-preview-item') || e.target.closest('.tracked-row.clickable-row');
  if (trackedItem) {
    chrome.tabs.create({ url: `https://${trackedItem.dataset.domain}` });
  }

  // Ad link
  const adUrl = e.target.closest('.ad-url');
  if (adUrl) {
    e.preventDefault();
    chrome.tabs.create({ url: adUrl.href });
  }

  // External Links
  const extBtn = e.target.closest('.btn-ext-link');
  if (extBtn) {
    e.preventDefault();
    chrome.tabs.create({ url: extBtn.dataset.url });
  }
});

function switchView(viewId) {
  const views = ['view-main', 'view-traffic', 'view-ads', 'view-history', 'view-tracked', 'view-ai-chat', 'view-apps', 'view-discounts', 'view-all-trends'];
  views.forEach(v => {
    const el = document.getElementById(v);
    if (el) el.classList.add('hidden');
  });
  const target = document.getElementById(viewId);
  if (target) target.classList.remove('hidden');
  window.scrollTo(0, 0);

  if (viewId === 'view-discounts') {
    console.log("DISCOUNTS PAGE OPENED");

    // DELETE existing component completely to prevent stale states
    let oldVd = document.getElementById('view-discounts');
    if (oldVd) {
      oldVd.remove();
    }

    // CREATE NEW COMPONENT SAFELY
    let vd = document.createElement('div');
    vd.id = 'view-discounts';

    // Exact requested styling
    vd.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100vh; overflow-y: auto; background: #f4f5f7; padding: 16px; box-sizing: border-box; z-index: 99999; display: block;';

    const appDiscounts = [
      // Marketing & Email
      { name: "Klaviyo", discount: "30% OFF First 3 Months", category: "Email Marketing", description: "Email & SMS marketing automation.", url: "https://apps.shopify.com/klaviyo-email-marketing", logo: "https://www.google.com/s2/favicons?domain=klaviyo.com&sz=128" },
      { name: "Omnisend Email", discount: "Extended 30 Day Free Trial", category: "Email Marketing", description: "Email & SMS marketing that drives sales.", url: "https://apps.shopify.com/omnisend", logo: "https://www.google.com/s2/favicons?domain=omnisend.com&sz=128" },
      { name: "Mailchimp", discount: "Free tier for 500 contacts", category: "Email Marketing", description: "Email marketing automation and CRM.", url: "https://apps.shopify.com/mailchimp", logo: "https://www.google.com/s2/favicons?domain=mailchimp.com&sz=128" },
      { name: "Seguno", discount: "Free for 250 subscribers", category: "Email Marketing", description: "Email marketing built natively for Shopify.", url: "https://apps.shopify.com/seguno", logo: "https://www.google.com/s2/favicons?domain=seguno.com&sz=128" },

      // Reviews & UGC
      { name: "Loox Reviews", discount: "20% OFF Lifetime", category: "Product Reviews", description: "Photo reviews & UGC platform.", url: "https://apps.shopify.com/loox", logo: "https://www.google.com/s2/favicons?domain=loox.io&sz=128" },
      { name: "Judge.me", discount: "45 Days Free Trial", category: "Product Reviews", description: "Fast-loading photo and video reviews.", url: "https://apps.shopify.com/judgeme", logo: "https://www.google.com/s2/favicons?domain=judge.me&sz=128" },
      { name: "Yotpo Reviews", discount: "Extended Premium Trial", category: "Product Reviews", description: "Collect product reviews, photos, and Q&A.", url: "https://apps.shopify.com/yotpo-social-reviews", logo: "https://www.google.com/s2/favicons?domain=yotpo.com&sz=128" },
      { name: "AliReviews", discount: "20% OFF Pro Plan", category: "Product Reviews", description: "Import AliExpress reviews easily.", url: "https://apps.shopify.com/ali-reviews", logo: "https://www.google.com/s2/favicons?domain=alireviews.io&sz=128" },
      { name: "Stamped.io", discount: "50% OFF First Month", category: "Product Reviews", description: "Reviews, loyalty, and referrals.", url: "https://apps.shopify.com/stamped-io", logo: "https://www.google.com/s2/favicons?domain=stamped.io&sz=128" },

      // Page Builders
      { name: "PageFly Builder", discount: "14 Days Free + 10% OFF", category: "Page Builder", description: "Landing page builder for Shopify.", url: "https://apps.shopify.com/pagefly", logo: "https://www.google.com/s2/favicons?domain=pagefly.io&sz=128" },
      { name: "Shogun Page Builder", discount: "20% OFF Annual Plans", category: "Page Builder", description: "Drag and drop page designer.", url: "https://apps.shopify.com/shogun", logo: "https://www.google.com/s2/favicons?domain=getshogun.com&sz=128" },
      { name: "GemPages", discount: "10% OFF Forever", category: "Page Builder", description: "Create high-converting storefronts.", url: "https://apps.shopify.com/gempages", logo: "https://www.google.com/s2/favicons?domain=gempages.net&sz=128" },

      // Upsell & Cross Sell
      { name: "ReConvert Upsell", discount: "30 Days Free Trial", category: "Upsell & Cross Sell", description: "Post purchase upsell and order tracking.", url: "https://apps.shopify.com/reconvert-upsell-cross-sell", logo: "https://www.google.com/s2/favicons?domain=reconvert.io&sz=128" },
      { name: "Vitals: 40+ Apps", discount: "10% OFF Monthly", category: "Upsell & Cross Sell", description: "All-in-one marketing app.", url: "https://apps.shopify.com/vitals", logo: "https://www.google.com/s2/favicons?domain=vitals.co&sz=128" },
      { name: "Frequently Bought Together", discount: "30 Days Free", category: "Upsell & Cross Sell", description: "Amazon-style recommended products.", url: "https://apps.shopify.com/frequently-bought-together", logo: "https://www.google.com/s2/favicons?domain=shopify.com&sz=128" },
      { name: "Candy Rack Upsell", discount: "20% OFF First Year", category: "Upsell & Cross Sell", description: "One-click upsells and cross-sells.", url: "https://apps.shopify.com/candy-rack", logo: "https://www.google.com/s2/favicons?domain=shopify.com&sz=128" },

      // Shipping Solutions
      { name: "ShipStation", discount: "60 Days Free Trial", category: "Shipping Solutions", description: "Shipping software for eCommerce.", url: "https://apps.shopify.com/shipstation", logo: "https://www.google.com/s2/favicons?domain=shipstation.com&sz=128" },
      { name: "Easyship", discount: "Exclusive $50 Shipping Credit", category: "Shipping Solutions", description: "Global shipping made easy.", url: "https://apps.shopify.com/easyship", logo: "https://www.google.com/s2/favicons?domain=easyship.com&sz=128" },
      { name: "AfterShip Tracking", discount: "15% OFF Enterprise", category: "Shipping Solutions", description: "Order tracking and notifications.", url: "https://apps.shopify.com/aftership", logo: "https://www.google.com/s2/favicons?domain=aftership.com&sz=128" },
      { name: "Track123", discount: "Free Forever Plan", category: "Shipping Solutions", description: "Order tracking page for Shopify.", url: "https://apps.shopify.com/track123", logo: "https://www.google.com/s2/favicons?domain=track123.com&sz=128" },

      // SEO & Analytics
      { name: "Booster SEO", discount: "Free Image Alt Text Optimization", category: "SEO", description: "Automated SEO optimization.", url: "https://apps.shopify.com/booster-seo", logo: "https://www.google.com/s2/favicons?domain=boostersuite.com&sz=128" },
      { name: "Plug In SEO", discount: "14-Day Free Trial", category: "SEO", description: "Check and fix SEO issues.", url: "https://apps.shopify.com/plug-in-seo", logo: "https://www.google.com/s2/favicons?domain=pluginseo.com&sz=128" },
      { name: "Avada SEO", discount: "Free Tier Upgrade", category: "SEO", description: "Image optimizer and SEO tools.", url: "https://apps.shopify.com/avada-seo-suite", logo: "https://www.google.com/s2/favicons?domain=avada.io&sz=128" },
      { name: "Triple Whale", discount: "15% OFF First 3 Months", category: "Analytics", description: "Smart data platform for eCommerce.", url: "https://apps.shopify.com/triple-whale", logo: "https://www.google.com/s2/favicons?domain=triplewhale.com&sz=128" },
      { name: "Lifetimely", discount: "20% OFF Pro", category: "Analytics", description: "LTV and profitability analytics.", url: "https://apps.shopify.com/lifetimely", logo: "https://www.google.com/s2/favicons?domain=lifetimely.io&sz=128" },

      // Dropshipping
      { name: "DSers", discount: "Advanced Plan 14-Day Free", category: "Dropshipping", description: "AliExpress dropshipping partner.", url: "https://apps.shopify.com/dsers", logo: "https://www.google.com/s2/favicons?domain=dsers.com&sz=128" },
      { name: "Zendrop", discount: "Extended Free Plus Plan", category: "Dropshipping", description: "US-based dropshipping supplier.", url: "https://apps.shopify.com/zendrop", logo: "https://www.google.com/s2/favicons?domain=zendrop.com&sz=128" },
      { name: "Spocket", discount: "30% OFF First 2 Months", category: "Dropshipping", description: "US/EU dropshipping suppliers.", url: "https://apps.shopify.com/spocket", logo: "https://www.google.com/s2/favicons?domain=spocket.co&sz=128" },
      { name: "AutoDS", discount: "1 Month Trial for $1", category: "Dropshipping", description: "All-in-one dropshipping tool.", url: "https://apps.shopify.com/autods", logo: "https://www.google.com/s2/favicons?domain=autods.com&sz=128" },
      { name: "CJ Dropshipping", discount: "Free VIP Sourcing", category: "Dropshipping", description: "Fast shipping dropshipping partner.", url: "https://apps.shopify.com/cjdropshipping", logo: "https://www.google.com/s2/favicons?domain=cjdropshipping.com&sz=128" },

      // Banners & Badges
      { name: "Hextom Free Shipping Bar", discount: "Free Basic Plan", category: "Banners", description: "Motivate customers to buy more.", url: "https://apps.shopify.com/free-shipping-bar", logo: "https://www.google.com/s2/favicons?domain=hextom.com&sz=128" },
      { name: "Ultimate Trust Badges", discount: "Free Forever", category: "Badges & Icons", description: "Boost sales with trust badges.", url: "https://apps.shopify.com/ultimate-trust-badges", logo: "https://www.google.com/s2/favicons?domain=shopify.com&sz=128" },
      { name: "DECO Product Labels", discount: "20% OFF Pro Tier", category: "Badges & Icons", description: "Add product labels and badges.", url: "https://apps.shopify.com/deco-product-labels-badges", logo: "https://www.google.com/s2/favicons?domain=shopify.com&sz=128" },

      // Customer Support & Chat
      { name: "Gorgias", discount: "2nd Month Free", category: "Chat", description: "Helpdesk for eCommerce.", url: "https://apps.shopify.com/gorgias", logo: "https://www.google.com/s2/favicons?domain=gorgias.com&sz=128" },
      { name: "Tidio Chat", discount: "20% OFF First Year", category: "Chat", description: "Live chat and AI chatbots.", url: "https://apps.shopify.com/tidio-chat", logo: "https://www.google.com/s2/favicons?domain=tidio.com&sz=128" },
      { name: "WhatsApp Chat by Dondy", discount: "$20 Messaging Bonus", category: "Chat", description: "WhatsApp marketing and chat.", url: "https://apps.shopify.com/dondy", logo: "https://www.google.com/s2/favicons?domain=dondy.com&sz=128" },

      // Affiliate & Loyalty
      { name: "UpPromote", discount: "20% OFF Lifetime", category: "Affiliate Programs", description: "Affiliate marketing platform.", url: "https://apps.shopify.com/uppromote", logo: "https://www.google.com/s2/favicons?domain=uppromote.com&sz=128" },
      { name: "Smile: Loyalty & Rewards", discount: "Extended Trial", category: "Affiliate Programs", description: "Points and referral programs.", url: "https://apps.shopify.com/smile-io", logo: "https://www.google.com/s2/favicons?domain=smile.io&sz=128" },
      { name: "ReferralCandy", discount: "$50 Credit on Signup", category: "Affiliate Programs", description: "Automated referral programs.", url: "https://apps.shopify.com/referralcandy", logo: "https://www.google.com/s2/favicons?domain=referralcandy.com&sz=128" },

      // Currency & Translation
      { name: "Translate&Adapt", discount: "Free by Shopify", category: "Currency & Translation", description: "Localize your store easily.", url: "https://apps.shopify.com/translate-and-adapt", logo: "https://www.google.com/s2/favicons?domain=shopify.com&sz=128" },
      { name: "Transcy", discount: "15% OFF Premium", category: "Currency & Translation", description: "Translate store language & currency.", url: "https://apps.shopify.com/transcy", logo: "https://www.google.com/s2/favicons?domain=transcy.io&sz=128" },
      { name: "BEST Currency Converter", discount: "Free Forever Tier", category: "Currency & Translation", description: "Auto currency conversion.", url: "https://apps.shopify.com/doubly-currency-converter", logo: "https://www.google.com/s2/favicons?domain=shopify.com&sz=128" },

      // Subscriptions
      { name: "Recharge Subscriptions", discount: "First Month Processing Free", category: "Subscriptions", description: "Turn transactions into relationships.", url: "https://apps.shopify.com/subscription-payments", logo: "https://www.google.com/s2/favicons?domain=rechargepayments.com&sz=128" },
      { name: "Appstle Subscriptions", discount: "30 Days Free Trial", category: "Subscriptions", description: "Complete subscription management.", url: "https://apps.shopify.com/appstle-subscriptions", logo: "https://www.google.com/s2/favicons?domain=appstle.com&sz=128" },
      { name: "Seal Subscriptions", discount: "Free until $500/mo MRR", category: "Subscriptions", description: "No fee subscription models.", url: "https://apps.shopify.com/seal-subscriptions", logo: "https://www.google.com/s2/favicons?domain=sealsubscriptions.com&sz=128" },

      // Advertising & Marketplaces
      { name: "TikTok Ads", discount: "Spend $100, Get $100", category: "Advertising", description: "Reach millions on TikTok.", url: "https://apps.shopify.com/tiktok", logo: "https://www.google.com/s2/favicons?domain=tiktok.com&sz=128" },
      { name: "Pinterest", discount: "$100 Ads Credit", category: "Advertising", description: "Connect store to Pinterest.", url: "https://apps.shopify.com/pinterest", logo: "https://www.google.com/s2/favicons?domain=pinterest.com&sz=128" },
      { name: "Google & YouTube", discount: "$500 Google Ads Credit", category: "Marketplaces", description: "Sync products to Google Merchant.", url: "https://apps.shopify.com/google", logo: "https://www.google.com/s2/favicons?domain=google.com&sz=128" }
    ];

    // Header container
    const headerDiv = document.createElement('div');
    headerDiv.style.cssText = 'display: flex; align-items: center; gap: 12px; margin-bottom: 20px;';

    const backBtn = document.createElement('button');
    backBtn.textContent = '←';
    backBtn.style.cssText = 'background: none; border: none; font-size: 24px; cursor: pointer; padding: 0; color: #333;';
    backBtn.onclick = () => {
      vd.remove();
      switchView('view-main');
    };

    const titleStr = document.createElement('h2');
    titleStr.textContent = 'ALL APP DISCOUNTS';
    titleStr.style.cssText = 'margin: 0; font-size: 20px; font-weight: 700; color: #333;';

    headerDiv.appendChild(backBtn);
    headerDiv.appendChild(titleStr);
    vd.appendChild(headerDiv);

    // Grid container
    const gridDiv = document.createElement('div');
    gridDiv.style.cssText = 'display: flex; flex-direction: column; gap: 16px;';

    appDiscounts.forEach(app => {
      const card = document.createElement('div');
      card.style.cssText = 'background: white; border-radius: 14px; padding: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); display: flex; align-items: center; justify-content: space-between; gap: 12px;';

      const leftSide = document.createElement('div');
      leftSide.style.cssText = 'display: flex; gap: 12px; align-items: center;';

      const img = document.createElement('img');
      img.src = app.logo;
      img.width = 48;
      img.height = 48;
      img.style.borderRadius = '12px';

      const infoDiv = document.createElement('div');

      const nameDiv = document.createElement('div');
      nameDiv.textContent = app.name;
      nameDiv.style.cssText = 'font-weight: 700; font-size: 16px; color: #333;';

      const discountDiv = document.createElement('div');
      discountDiv.textContent = app.discount;
      discountDiv.style.cssText = 'font-size: 14px; color: #666;';

      const catDiv = document.createElement('div');
      catDiv.textContent = app.category;
      catDiv.style.cssText = 'font-size: 12px; color: #999; margin-top: 4px;';

      infoDiv.appendChild(nameDiv);
      infoDiv.appendChild(discountDiv);
      infoDiv.appendChild(catDiv);

      leftSide.appendChild(img);
      leftSide.appendChild(infoDiv);

      const getBtn = document.createElement('button');
      getBtn.textContent = 'Get App ↗';
      getBtn.style.cssText = 'background: #3b82f6; color: white; border: none; border-radius: 10px; padding: 10px 14px; cursor: pointer; font-weight: 600; white-space: nowrap;';
      getBtn.onclick = () => window.open(app.url, '_blank');

      card.appendChild(leftSide);
      card.appendChild(getBtn);
      gridDiv.appendChild(card);
    });

    vd.appendChild(gridDiv);
    document.body.appendChild(vd);

    return; // Bypass normal switchView behavior
  }

  if (viewId === 'view-all-trends') {
    let vt = document.getElementById('view-all-trends');
    if (!vt) {
      vt = document.createElement('div');
      vt.id = 'view-all-trends';
      document.body.appendChild(vt);
    }
    vt.classList.remove('hidden');
    vt.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:white;z-index:9999;overflow-y:auto;';

    const prods = window._allTrendsProducts || [];

    const scored = prods.map(p => {
      let score = 0;
      try { score = window.TrendUtils.calculateTrendScore(p); } catch (e) { }
      return { ...p, trendScore: score };
    }).sort((a, b) => b.trendScore - a.trendScore);

    vt.innerHTML = '';

    const header = document.createElement('div');
    header.style.cssText = 'background:linear-gradient(135deg,#e74c3c,#c94f6d);color:white;padding:14px 16px;display:flex;align-items:center;gap:12px;font-weight:700;font-size:15px;position:sticky;top:0;z-index:10;';

    const backBtn = document.createElement('span');
    backBtn.id = 'btn-back-trends-inner';
    backBtn.style.cssText = 'cursor:pointer;font-size:20px;';
    backBtn.textContent = '←';
    backBtn.onclick = () => {
      vt.style.display = 'none';
      vt.classList.add('hidden');
      switchView('view-main');
    };

    header.appendChild(backBtn);
    header.appendChild(document.createTextNode(' ALL LIVE TRENDS'));
    vt.appendChild(header);

    const listDiv = document.createElement('div');

    if (scored.length > 0) {
      scored.forEach(p => {
        const rawPrice = p.variants?.[0]?.price;
        const price = rawPrice ? normPrice(rawPrice, window._storeDomain) : '';
        const imgUrl = p.images?.[0]?.src || 'https://via.placeholder.com/70';
        const handle = p.handle || '';
        const domain = window._storeDomain || '';
        const pubDate = p.published_at ? new Date(p.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #f0f0f0;background:white;cursor:pointer;';
        row.onclick = () => chrome.tabs.create({ url: `https://${domain}/products/${handle}` });

        const bar = document.createElement('div');
        bar.style.cssText = 'width:4px;height:70px;background:#e74c3c;border-radius:4px;flex-shrink:0;';

        const img = document.createElement('img');
        img.src = imgUrl;
        img.style.cssText = 'width:70px;height:70px;object-fit:cover;border-radius:6px;border:1px solid #eee;flex-shrink:0;';
        img.onerror = () => { img.src = 'https://via.placeholder.com/70'; };

        const mid = document.createElement('div');
        mid.style.cssText = 'flex:1;min-width:0;';

        const t1 = document.createElement('div');
        t1.style.cssText = 'color:#c94f6d;font-size:13px;font-weight:600;line-height:1.3;margin-bottom:3px;';
        t1.textContent = p.title;

        const p1 = document.createElement('div');
        p1.style.cssText = 'color:#333;font-size:12px;';
        p1.textContent = price;

        mid.appendChild(t1);
        mid.appendChild(p1);

        if (pubDate) {
          const d1 = document.createElement('div');
          d1.style.cssText = 'color:#999;font-size:11px;';
          d1.textContent = `Added ${pubDate}`;
          mid.appendChild(d1);
        }

        const rCol = document.createElement('div');
        rCol.style.cssText = 'text-align:right;flex-shrink:0;';

        const s1 = document.createElement('div');
        s1.style.cssText = 'color:#27ae60;font-size:14px;font-weight:700;';
        s1.textContent = `${p.trendScore}% ↗`;

        const s2 = document.createElement('div');
        s2.style.cssText = 'color:#999;font-size:10px;margin-top:2px;';
        s2.textContent = 'Since last month';

        const b1 = document.createElement('button');
        b1.style.cssText = 'border:1.5px solid #c94f6d;color:#c94f6d;background:white;border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer;margin-top:6px;white-space:nowrap;';
        b1.textContent = 'Find Retailers';
        b1.onclick = (e) => {
          e.stopPropagation();
          window.open(`https://www.google.com/search?q=${encodeURIComponent(p.title + ' wholesale')}`, '_blank');
        };

        rCol.appendChild(s1);
        rCol.appendChild(s2);
        rCol.appendChild(b1);

        const heart = document.createElement('span');
        heart.style.cssText = 'color:#ccc;font-size:16px;cursor:pointer;margin-left:4px;';
        heart.textContent = '🤍';
        heart.onclick = (e) => {
          e.stopPropagation();
          if (heart.textContent === '🤍') {
            heart.textContent = '❤️';
            heart.style.color = '#e74c3c';
          } else {
            heart.textContent = '🤍';
            heart.style.color = '#ccc';
          }
        };

        row.appendChild(bar);
        row.appendChild(img);
        row.appendChild(mid);
        row.appendChild(rCol);
        row.appendChild(heart);

        listDiv.appendChild(row);
      });
    } else {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:30px;text-align:center;color:#999;';
      empty.textContent = 'No trend data available for this store.';
      listDiv.appendChild(empty);
    }

    vt.appendChild(listDiv);
  }

  if (viewId === 'view-apps') {
    let va = document.getElementById('view-apps');
    if (!va) {
      va = document.createElement('div');
      va.id = 'view-apps';
      document.body.appendChild(va);
    }
    va.classList.remove('hidden');
    va.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#f5f5f5;z-index:9999;overflow-y:auto;';

    const themeName = document.getElementById('store-theme')?.textContent || 'Unknown';
    const detectedApps = window._detectedApps || [];
    const DB = window._FULL_APP_DATABASE || {};

    va.innerHTML = '';

    const header = document.createElement('div');
    header.style.cssText = 'background:linear-gradient(135deg,#c94f6d,#e8b4bc);color:white;padding:14px 16px;display:flex;align-items:center;gap:12px;font-weight:700;font-size:15px;position:sticky;top:0;z-index:10;';
    const backBtn = document.createElement('span');
    backBtn.id = 'btn-back-apps-inner';
    backBtn.style.cssText = 'cursor:pointer;font-size:20px;';
    backBtn.textContent = '\u2190';
    backBtn.onclick = () => { va.style.display = 'none'; va.classList.add('hidden'); switchView('view-main'); };
    header.appendChild(backBtn);
    header.appendChild(document.createTextNode(' APPS'));
    va.appendChild(header);

    const body = document.createElement('div');
    body.style.cssText = 'padding:12px;';

    const themeCard = document.createElement('div');
    themeCard.style.cssText = 'background:#6ab04c;border-radius:12px;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;';
    themeCard.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:20px;">\uD83D\uDED2</span>
        <div>
          <div style="color:white;font-size:12px;opacity:0.9;">Shopify Theme:</div>
          <div style="color:white;font-size:16px;font-weight:700;">${themeName}</div>
        </div>
      </div>`;
    const useThemeBtn = document.createElement('button');
    useThemeBtn.style.cssText = 'background:white;color:#6ab04c;border:none;border-radius:8px;padding:8px 14px;font-weight:600;font-size:13px;cursor:pointer;';
    useThemeBtn.textContent = '\uD83D\uDED2 Use Theme';
    useThemeBtn.onclick = () => window.open('https://themes.shopify.com/themes', '_blank');
    themeCard.appendChild(useThemeBtn);
    body.appendChild(themeCard);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:0;';
    const bar = document.createElement('div');
    bar.style.cssText = 'width:4px;background:linear-gradient(#6ab04c,#a8e063);border-radius:4px;flex-shrink:0;margin-right:12px;';
    const list = document.createElement('div');
    list.style.cssText = 'flex:1;';

    Object.entries(DB).forEach(([category, apps]) => {
      const sec = document.createElement('div');
      sec.style.cssText = 'margin-bottom:16px;';
      const catLabel = document.createElement('div');
      catLabel.style.cssText = 'color:#999;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;padding-left:4px;';
      catLabel.textContent = category;
      sec.appendChild(catLabel);
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;';
      apps.forEach(app => {
        const isDetected = detectedApps.some(d => {
          const dl = (typeof d === 'object' ? d.name : d).toLowerCase();
          const al = app.name.toLowerCase().split(':')[0].trim();
          return dl.includes(al) || al.includes(dl);
        });
        const card = document.createElement('div');
        card.style.cssText = 'background:white;border:1px solid #eee;border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:6px;cursor:pointer;';
        card.onclick = () => chrome.tabs.create({ url: app.url });
        const top = document.createElement('div');
        top.style.cssText = 'display:flex;align-items:flex-start;gap:8px;';
        const ico = document.createElement('img');
        ico.src = app.icon; ico.width = 32; ico.height = 32;
        ico.style.cssText = 'border-radius:6px;flex-shrink:0;';
        ico.onerror = () => { ico.style.display = 'none'; };
        const nameEl = document.createElement('span');
        nameEl.style.cssText = 'color:#c94f6d;font-size:11px;font-weight:600;line-height:1.3;';
        nameEl.textContent = app.name;
        top.appendChild(ico); top.appendChild(nameEl);
        const bot = document.createElement('div');
        bot.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
        if (app.ad) { const adBadge = document.createElement('span'); adBadge.style.cssText = 'border:1px solid #c94f6d;color:#c94f6d;font-size:9px;padding:1px 4px;border-radius:3px;'; adBadge.textContent = 'Ad'; bot.appendChild(adBadge); }
        if (isDetected) { const db = document.createElement('span'); db.style.cssText = 'border:1px solid #27ae60;color:#27ae60;font-size:9px;padding:1px 4px;border-radius:3px;'; db.textContent = '\u2713 Detected'; bot.appendChild(db); }
        const getApp = document.createElement('span');
        getApp.style.cssText = 'color:#2196f3;font-size:11px;font-weight:500;';
        getApp.textContent = 'Get App \u2197';
        bot.appendChild(getApp);
        card.appendChild(top); card.appendChild(bot);
        grid.appendChild(card);
      });
      sec.appendChild(grid);
      list.appendChild(sec);
    });

    row.appendChild(bar); row.appendChild(list);
    body.appendChild(row);
    va.appendChild(body);
  }
}

// ---- HISTORY & TRACKED LOGIC ---- //

function saveToHistory(storeInfo, domain, productCount, imgUrl) {
  const cleanDomain = domain.replace(/^www\./i, '');
  let storeName = cleanDomain.split('.')[0]
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

  if (cleanDomain.includes('aloyoga')) {
    storeName = 'ALO YOGA';
  }
  const newItem = {
    name: storeName,
    domain: domain,
    visitedAt: new Date().toISOString(),
    productCount: productCount,
    country: storeInfo.country || 'US',
    image: imgUrl
  };

  chrome.storage.local.get(['history'], (res) => {
    let history = res.history || [];
    history = history.filter(item => item.domain !== domain);
    history.unshift(newItem);
    if (history.length > 20) history = history.slice(0, 20);
    chrome.storage.local.set({ history }, () => {
      renderHistoryPreviews(history);
      renderHistoryFull(history);
    });
  });
}

function deleteHistoryItem(domain) {
  chrome.storage.local.get(['history'], (res) => {
    let history = res.history || [];
    history = history.filter(item => item.domain !== domain);
    chrome.storage.local.set({ history }, () => {
      renderHistoryPreviews(history);
      renderHistoryFull(history);
    });
  });
}

function trackCurrentShop() {
  const domain = document.getElementById('store-domain').textContent;
  const storeName = document.getElementById('store-display-name').textContent;
  if (!domain || domain === 'example.com') return;

  chrome.storage.local.get(['trackedShops'], (res) => {
    let tracked = res.trackedShops || [];
    const index = tracked.findIndex(t => t.domain === domain);
    const btn = document.querySelector('.btn-track');

    if (index > -1) {
      // UNTRACK
      tracked.splice(index, 1);
      if (btn) {
        btn.innerHTML = '🔔 Track Shop';
        btn.style.borderColor = '#4caf50';
        btn.style.color = '#4caf50';
      }
    } else {
      // TRACK
      if (tracked.length >= TRACKED_LIMIT) {
        alert('Tracked shops limit reached.');
        return;
      }
      tracked.unshift({
        name: storeName,
        domain: domain,
        addedAt: new Date().toISOString()
      });
      if (btn) {
        btn.innerHTML = '✓ Tracked';
        btn.style.borderColor = '#c94f6d';
        btn.style.color = '#c94f6d';
      }
    }

    chrome.storage.local.set({ trackedShops: tracked }, () => {
      renderTrackedPreview(tracked);
      renderTrackedFull(tracked);
      const usageEl = document.getElementById('tracked-usage');
      if (usageEl) usageEl.textContent = `${tracked.length} / ${TRACKED_LIMIT}`;
    });
  });
}

function renderHistoryPreviews(history) {
  const container = document.getElementById('history-preview-scroll');
  if (history.length === 0) {
    container.innerHTML = '<p class="fallback-msg">No shop history yet.</p>';
    return;
  }
  container.innerHTML = history.map(item => `
    <a href="#" class="history-card" data-domain="${item.domain}">
      <img class="history-img" src="${item.image}" alt="${item.name}" loading="lazy">
      <div class="history-info">
        <div class="history-name" title="${item.name}">${item.name}</div>
        <div class="history-date">Visited ${new Date(item.visitedAt).toLocaleDateString()}</div>
      </div>
    </a>
  `).join('');
}

function renderHistoryFull(history) {
  const container = document.getElementById('history-list-container');
  if (history.length === 0) {
    container.innerHTML = '<p class="fallback-msg">No history records found.</p>';
    return;
  }
  container.innerHTML = history.map(item => `
    <div class="history-row">
      <img class="history-row-img" src="${item.image}" alt="${item.name}">
      <div class="history-row-content">
        <div class="history-row-name">${item.name}</div>
        <div class="history-row-meta">
          ${item.country} • ${item.productCount} Products • ${new Date(item.visitedAt).toLocaleDateString()}
        </div>
      </div>
      <button class="btn-delete" data-domain="${item.domain}">🗑️</button>
    </div>
  `).join('');
}

function renderTrackedPreview(tracked) {
  const container = document.getElementById('tracked-preview-container');
  if (tracked.length === 0) {
    container.innerHTML = `
      <div class="tracked-empty-card" id="btn-track-empty" style="cursor:pointer;">
        <div style="font-size:24px; margin-bottom:8px;">+</div>
        <div>Track a Shop</div>
      </div>
    `;
    return;
  }
  container.innerHTML = tracked.slice(0, 3).map(t => `
    <div class="tracked-preview-item" data-domain="${t.domain}" style="display:flex; justify-content:space-between; align-items:center; padding:8px; border:1px solid var(--border); border-radius:var(--radius-sm); font-size:12px; cursor:pointer; margin-bottom:8px;">
      <span style="font-weight:600;">${t.name}</span>
      <span style="color:var(--text-muted)">${new Date(t.addedAt).toLocaleDateString()}</span>
    </div>
  `).join('');
}

function renderTrackedFull(tracked) {
  const container = document.getElementById('tracked-list-container');
  if (tracked.length === 0) {
    container.innerHTML = `
      <div class="fallback-msg" style="padding: 30px;">
        <p style="margin-bottom:12px;">You don't track any shop yet, start tracking your first shop.</p>
        <button class="btn primary" id="btn-track-first">Track Shop</button>
      </div>
    `;
    return;
  }
  container.innerHTML = `
    <div class="tracked-table-header">
      <div class="col-shop">Tracked Shops</div>
      <div class="col-change">Last Change</div>
      <div class="col-added">Added At</div>
    </div>
  ` + tracked.map(t => `
    <div class="tracked-row clickable-row" data-domain="${t.domain}" style="cursor:pointer;">
      <div class="col-shop" style="font-weight:600;">${t.name}</div>
      <div class="col-change" style="color:var(--text-muted)">-</div>
      <div class="col-added">${new Date(t.addedAt).toLocaleDateString()}</div>
    </div>
  `).join('');
}

// ---- ORIGINAL FETCHING LOGIC ---- //

function sendMessageWithTimeout(tabId, message, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer = setTimeout(() => {
      reject(new Error("Could not analyze this store"));
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, message, (response) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error("Unable to fetch store data. Please refresh the page."));
      } else {
        resolve(response);
      }
    });
  });
}

async function fetchProducts(origin) {
  const response = await fetch(`${origin}/products.json?limit=250`);
  if (!response.ok) {
    throw new Error(`Products fetch failed: ${response.status}`);
  }
  const data = await response.json();
  return data.products || [];
}

function updateBasicStoreInfo(storeInfo) {
  const domain = document.getElementById('store-domain').textContent;
  const cleanDomain = domain.replace(/^www\./i, '');
  let storeName = cleanDomain.split('.')[0]
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

  if (cleanDomain.includes('aloyoga')) {
    storeName = 'ALO YOGA';
  }
  document.getElementById('store-display-name').textContent = storeName;
  document.getElementById('store-favicon').src =
    `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;

  // Initial check for tracked state
  chrome.storage.local.get(['trackedShops'], (res) => {
    const tracked = res.trackedShops || [];
    const isTracked = tracked.some(t => t.domain === domain);
    const btn = document.querySelector('.btn-track');
    if (btn) {
      btn.innerHTML = isTracked ? '✓ Tracked' : '🔔 Track Shop';
      btn.style.borderColor = isTracked ? '#c94f6d' : '#4caf50';
      btn.style.color = isTracked ? '#c94f6d' : '#4caf50';
    }
  });

  document.getElementById('store-theme').textContent = storeInfo.theme || 'Custom Theme';
  document.getElementById('loc-currency').textContent = storeInfo.currency || 'USD';
  document.getElementById('loc-country').textContent = storeInfo.country || 'Not Set';
  document.getElementById('loc-language').textContent = (storeInfo.locale || 'en').toUpperCase();

  const appsContainer = document.getElementById('apps-container');
  appsContainer.innerHTML = '';

  console.log("FULL API RESPONSE:", storeInfo);
  const appsArray = storeInfo.detectedApps || storeInfo.apps || storeInfo.techStack || [];
  console.log("APPS ARRAY:", appsArray);
  globalAppsData = appsArray || [];
  window._detectedApps = globalAppsData;

  const detectedAppNamesForPreview = [];
  if (globalAppsData.length > 0) {
    globalAppsData.forEach(app => {
      const name = typeof app === 'object' ? app.name : app;
      if (name) detectedAppNamesForPreview.push(name.toLowerCase());
    });
  }

  const previewData = [
    {
      category: "Featured",
      apps: [
        { name: "SEOWILL: AI SEO & AI Bl...", searchName: "seowill", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32", ad: true },
        { name: "Koongo Sell on...", searchName: "koongo", icon: "https://www.google.com/s2/favicons?domain=koongo.com&sz=32", ad: true }
      ]
    },
    {
      category: "Fraud",
      apps: [
        { name: "Wyllo", searchName: "wyllo", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32" },
        { name: "TrustWILL AI Reviews", searchName: "trustwill", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32", ad: true }
      ]
    },
    {
      category: "Advertising - Other",
      apps: [
        { name: "Affirm pay-over-tim...", searchName: "affirm", icon: "https://www.google.com/s2/favicons?domain=affirm.com&sz=32" },
        { name: "Printful: Print on Demand", searchName: "printful", icon: "https://www.google.com/s2/favicons?domain=printful.com&sz=32" }
      ]
    }
  ];

  previewData.forEach(cat => {
    const col = document.createElement('div');
    col.style.cssText = "display: flex; flex-direction: column; gap: 6px;";

    const label = document.createElement('div');
    label.textContent = cat.category;
    label.style.cssText = "color: gray; font-size: 10px; text-transform: uppercase; font-weight: 600; padding-left: 2px;";
    col.appendChild(label);

    cat.apps.forEach(appData => {
      const card = document.createElement('div');
      card.style.cssText = "background: white; border: 1px solid #eee; border-radius: 8px; padding: 8px; font-size: 11px; display: flex; flex-direction: column; gap: 6px; height: 90px; justify-content: space-between;";

      const topRow = document.createElement('div');
      topRow.style.cssText = "display: flex; align-items: flex-start; gap: 6px;";

      const icon = document.createElement('img');
      icon.src = appData.icon;
      icon.style.cssText = "width: 28px; height: 28px; border-radius: 6px; flex-shrink: 0; object-fit: contain;";

      const titleWrapper = document.createElement('div');
      titleWrapper.style.cssText = "display: flex; flex-direction: column; min-width: 0;";

      const title = document.createElement('span');
      title.textContent = appData.name;
      title.style.cssText = "color: #c94f6d; font-size: 11px; font-weight: 600; line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;";
      titleWrapper.appendChild(title);

      const isDetected = detectedAppNamesForPreview.some(detectedName =>
        detectedName.includes(appData.searchName) || appData.searchName.includes(detectedName)
      );

      if (isDetected) {
        const detectedBadge = document.createElement('span');
        detectedBadge.textContent = "✓ Detected";
        detectedBadge.style.cssText = "font-size: 9px; background: #e6f4ea; color: #3b6b44; padding: 1px 4px; border-radius: 3px; border: 1px solid #b3d8be; width: fit-content; margin-top: 4px; font-weight: 600;";
        titleWrapper.appendChild(detectedBadge);
      } else if (appData.ad) {
        const adBadge = document.createElement('span');
        adBadge.textContent = "Ad";
        adBadge.style.cssText = "font-size: 9px; background: #fdf2f5; color: #c94f6d; padding: 1px 4px; border-radius: 3px; border: 1px solid #c94f6d; width: fit-content; margin-top: 4px; font-weight: 600;";
        titleWrapper.appendChild(adBadge);
      }

      topRow.appendChild(icon);
      topRow.appendChild(titleWrapper);

      const bottomRow = document.createElement('div');

      const getAppBtn = document.createElement('a');
      getAppBtn.href = "https://apps.shopify.com";
      getAppBtn.target = "_blank";
      getAppBtn.style.cssText = "font-size: 10px; font-weight: 600; color: #2196f3; text-decoration: none; cursor: pointer;";
      getAppBtn.innerHTML = 'Get App ↗';
      getAppBtn.onmouseover = () => getAppBtn.style.textDecoration = "underline";
      getAppBtn.onmouseout = () => getAppBtn.style.textDecoration = "none";

      bottomRow.appendChild(getAppBtn);

      card.appendChild(topRow);
      card.appendChild(bottomRow);

      col.appendChild(card);
    });

    appsContainer.appendChild(col);
  });

  const appsThemeName = document.getElementById('apps-view-theme-name');
  if (appsThemeName) appsThemeName.textContent = storeInfo.theme || 'Custom Theme';

  renderSocialIcons(storeInfo.socialLinks || {});
}

function renderSocialIcons(socialLinks) {
  const rowTraffic = document.getElementById('social-row');
  const rowMain = document.getElementById('social-icons-row');

  const containers = [rowTraffic, rowMain].filter(c => c);
  if (containers.length === 0) return;

  const META = {
    facebook: {
      label: 'Facebook', color: '#1877F2',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="#1877F2"><path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.313 0 2.686.236 2.686.236v2.971h-1.513c-1.491 0-1.956.93-1.956 1.887v2.266h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>`
    },
    instagram: {
      label: 'Instagram', color: '#E4405F',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="#E4405F"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>`
    },
    tiktok: {
      label: 'TikTok', color: '#000000',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="#000000"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V9.02a8.19 8.19 0 004.79 1.54V7.12a4.85 4.85 0 01-1.02-.43z"/></svg>`
    },
    pinterest: {
      label: 'Pinterest', color: '#bd081c',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="#bd081c"><path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 01.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/></svg>`
    },
    youtube: {
      label: 'YouTube', color: '#FF0000',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="#FF0000"><path d="M23.495 6.205a3.007 3.007 0 00-2.088-2.088c-1.87-.501-9.396-.501-9.396-.501s-7.507-.01-9.396.501A3.007 3.007 0 00.527 6.205a31.247 31.247 0 00-.522 5.805 31.247 31.247 0 00.522 5.783 3.007 3.007 0 002.088 2.088c1.868.502 9.396.502 9.396.502s7.506 0 9.396-.502a3.007 3.007 0 002.088-2.088 31.247 31.247 0 00.5-5.783 31.247 31.247 0 00-.5-5.805zM9.609 15.601V8.408l6.264 3.602z"/></svg>`
    },
    twitter: {
      label: 'X / Twitter', color: '#000000',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="#000000"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.265 5.633 5.899-5.633zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`
    },
    snapchat: {
      label: 'Snapchat', color: '#FFFC00',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="#FFFC00"><path d="M12.166.006a8.39 8.39 0 016.032 2.529c1.466 1.518 2.16 3.51 2.04 5.965l-.006.198c.422.21 1.018.367 1.725.367.45 0 .9-.09 1.302-.258.168-.068.306-.102.43-.102.33 0 .63.192.63.516 0 .294-.21.564-.624.81-.09.054-.222.108-.384.168-.714.264-1.068.57-1.068 1.02 0 .204.054.39.162.576.366.636 1.218 1.698 1.218 2.838a2.88 2.88 0 01-.528 1.674c-.684.906-1.818 1.398-3.072 1.398-.546 0-1.038-.09-1.374-.162-.396-.084-.75-.126-1.14-.126-.48 0-.882.072-1.266.228-1.146.468-2.04 1.632-3.99 1.632-1.944 0-2.838-1.164-3.984-1.632a3.618 3.618 0 00-1.266-.228c-.39 0-.744.042-1.14.126-.336.072-.828.162-1.374.162-1.254 0-2.388-.492-3.072-1.398a2.88 2.88 0 01-.528-1.674c0-1.14.852-2.202 1.218-2.838.108-.186.162-.372.162-.576 0-.45-.354-.756-1.068-1.02-.162-.06-.294-.114-.384-.168C.21 9.733 0 9.463 0 9.169c0-.324.3-.516.63-.516.124 0 .262.034.43.102.402.168.852.258 1.302.258.707 0 1.303-.157 1.725-.367l-.006-.198C3.963 4.22 5.394 1.79 7.68.738A8.244 8.244 0 0112.166.006z"/></svg>`
    },
  };

  const detected = Object.entries(socialLinks).filter(([platform, url]) => {
    if (!url) return false;
    const s = String(url).trim().toLowerCase();
    if (!s || s === 'null' || s === 'undefined' || s === 'none' || s === 'false') return false;
    return !!META[platform];
  });

  containers.forEach(c => {
    c.innerHTML = '';
    const parent = c.closest('.card');

    if (detected.length === 0) {
      if (parent) parent.style.display = 'none';
    } else {
      if (parent) parent.style.display = 'block';
      detected.forEach(([platform, url], index) => {
        const meta = META[platform];
        if (!meta) return;

        // Add divider if main row and not first
        if (index > 0 && c.id === 'social-icons-row') {
          const div = document.createElement('div');
          div.className = 'social-divider';
          c.appendChild(div);
        }

        const iconWrap = document.createElement('div');
        iconWrap.className = c.id === 'social-icons-row' ? 'social-icon-btn' : 'social-icon';
        iconWrap.title = meta.label;
        iconWrap.style.cursor = 'pointer';
        iconWrap.innerHTML = meta.svg;
        iconWrap.onclick = () => chrome.tabs.create({ url });
        c.appendChild(iconWrap);
      });
    }
  });
}

const FULL_APP_DATABASE = {
  "Featured": [
    { name: "Back in Stock Notify", url: "https://apps.shopify.com/back-in-stock", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32", ad: true },
    { name: "SEOWILL: AI SEO & AI Blog Post", url: "https://apps.shopify.com/seowill", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32", ad: true },
    { name: "TrustWILL AI Reviews", url: "https://apps.shopify.com/trustwill", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32", ad: true },
    { name: "Koongo: Sell on Marketplaces", url: "https://apps.shopify.com/koongo", icon: "https://www.google.com/s2/favicons?domain=koongo.com&sz=32", ad: true }
  ],
  "Ads": [
    { name: "Facebook & Instagram", url: "https://apps.shopify.com/facebook", icon: "https://www.google.com/s2/favicons?domain=facebook.com&sz=32" },
    { name: "Google & YouTube", url: "https://apps.shopify.com/google", icon: "https://www.google.com/s2/favicons?domain=google.com&sz=32" },
    { name: "TikTok", url: "https://apps.shopify.com/tiktok", icon: "https://www.google.com/s2/favicons?domain=tiktok.com&sz=32" },
    { name: "Snapchat Ads", url: "https://apps.shopify.com/snapchat", icon: "https://www.google.com/s2/favicons?domain=snapchat.com&sz=32" },
    { name: "Pinterest", url: "https://apps.shopify.com/pinterest", icon: "https://www.google.com/s2/favicons?domain=pinterest.com&sz=32" },
    { name: "Microsoft Ads", url: "https://apps.shopify.com/microsoft-channel", icon: "https://www.google.com/s2/favicons?domain=microsoft.com&sz=32" }
  ],
  "Email marketing": [
    { name: "Klaviyo: Email Marketing & SMS", url: "https://apps.shopify.com/klaviyo-email-marketing", icon: "https://www.google.com/s2/favicons?domain=klaviyo.com&sz=32" },
    { name: "Omnisend Email Marketing & SMS", url: "https://apps.shopify.com/omnisend", icon: "https://www.google.com/s2/favicons?domain=omnisend.com&sz=32" },
    { name: "Privy: Email, SMS & Popups", url: "https://apps.shopify.com/privy", icon: "https://www.google.com/s2/favicons?domain=privy.com&sz=32" },
    { name: "Yotpo: Email Marketing & SMS", url: "https://apps.shopify.com/yotpo-marketing", icon: "https://www.google.com/s2/favicons?domain=yotpo.com&sz=32" },
    { name: "Attentive: SMS + MMS Marketing", url: "https://apps.shopify.com/attentive", icon: "https://www.google.com/s2/favicons?domain=attentivemobile.com&sz=32" },
    { name: "Postscript SMS Marketing", url: "https://apps.shopify.com/postscript", icon: "https://www.google.com/s2/favicons?domain=postscript.io&sz=32" }
  ],
  "Upsell and cross-sell": [
    { name: "Frequently Bought Together", url: "https://apps.shopify.com/frequently-bought-together", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32" },
    { name: "Bold Upsell", url: "https://apps.shopify.com/product-upsell", icon: "https://www.google.com/s2/favicons?domain=boldapps.net&sz=32" },
    { name: "Zipify OneClickUpsell", url: "https://apps.shopify.com/zipify-pages", icon: "https://www.google.com/s2/favicons?domain=zipify.com&sz=32" },
    { name: "ReConvert Upsell & Cross Sell", url: "https://apps.shopify.com/reconvert-upsell-cross-sell", icon: "https://www.google.com/s2/favicons?domain=reconvert.com&sz=32" },
    { name: "Candy Rack: Upsell & Bundles", url: "https://apps.shopify.com/candy-rack", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32" }
  ],
  "Shipping solutions - other": [
    { name: "Flexport - Logistics for All", url: "https://apps.shopify.com/flexport", icon: "https://www.google.com/s2/favicons?domain=flexport.com&sz=32" },
    { name: "Amazon MCF by ByteStand", url: "https://apps.shopify.com/amazon-mcf-by-bytestand", icon: "https://www.google.com/s2/favicons?domain=amazon.com&sz=32" },
    { name: "ShipStation", url: "https://apps.shopify.com/shipstation", icon: "https://www.google.com/s2/favicons?domain=shipstation.com&sz=32" },
    { name: "Easyship", url: "https://apps.shopify.com/easyship", icon: "https://www.google.com/s2/favicons?domain=easyship.com&sz=32" },
    { name: "AfterShip Order Tracking", url: "https://apps.shopify.com/aftership", icon: "https://www.google.com/s2/favicons?domain=aftership.com&sz=32" }
  ],
  "Product reviews": [
    { name: "Yotpo: Product Reviews App", url: "https://apps.shopify.com/yotpo-social-reviews", icon: "https://www.google.com/s2/favicons?domain=yotpo.com&sz=32" },
    { name: "Judge.me Product Reviews", url: "https://apps.shopify.com/judgeme", icon: "https://www.google.com/s2/favicons?domain=judge.me&sz=32" },
    { name: "Loox: Photo & Video Reviews", url: "https://apps.shopify.com/loox", icon: "https://www.google.com/s2/favicons?domain=loox.io&sz=32" },
    { name: "Okendo: Reviews & Loyalty", url: "https://apps.shopify.com/okendo", icon: "https://www.google.com/s2/favicons?domain=okendo.io&sz=32" },
    { name: "Stamped Product Reviews & UGC", url: "https://apps.shopify.com/product-reviews-addon", icon: "https://www.google.com/s2/favicons?domain=stamped.io&sz=32" }
  ],
  "Fraud": [
    { name: "Wyllo", url: "https://apps.shopify.com/wyllo", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32" },
    { name: "Signifyd", url: "https://apps.shopify.com/signifyd", icon: "https://www.google.com/s2/favicons?domain=signifyd.com&sz=32" },
    { name: "NoFraud", url: "https://apps.shopify.com/nofraud", icon: "https://www.google.com/s2/favicons?domain=nofraud.com&sz=32" },
    { name: "Fraud Filter", url: "https://apps.shopify.com/fraud-filter", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32" }
  ],
  "Advertising - other": [
    { name: "Affirm pay-over-time messaging", url: "https://apps.shopify.com/affirm", icon: "https://www.google.com/s2/favicons?domain=affirm.com&sz=32" },
    { name: "Criteo Sales Growth Ads", url: "https://apps.shopify.com/criteo", icon: "https://www.google.com/s2/favicons?domain=criteo.com&sz=32" },
    { name: "Shoelace: Retargeting Ads", url: "https://apps.shopify.com/shoelace", icon: "https://www.google.com/s2/favicons?domain=shoelace.com&sz=32" },
    { name: "AdRoll Marketing & Advertising", url: "https://apps.shopify.com/adroll", icon: "https://www.google.com/s2/favicons?domain=adroll.com&sz=32" }
  ],
  "Dropshipping": [
    { name: "DSers - AliExpress Dropshipping", url: "https://apps.shopify.com/dsers", icon: "https://www.google.com/s2/favicons?domain=dsers.com&sz=32" },
    { name: "Printful: Print on Demand", url: "https://apps.shopify.com/printful", icon: "https://www.google.com/s2/favicons?domain=printful.com&sz=32" },
    { name: "Oberlo", url: "https://apps.shopify.com/oberlo", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32" },
    { name: "Spocket: USA & EU Dropshipping", url: "https://apps.shopify.com/spocket", icon: "https://www.google.com/s2/favicons?domain=spocket.co&sz=32" },
    { name: "AutoDS: Dropshipping & POD", url: "https://apps.shopify.com/autods", icon: "https://www.google.com/s2/favicons?domain=autods.com&sz=32" }
  ],
  "Banners": [
    { name: "Hextom: Free Shipping Bar", url: "https://apps.shopify.com/hextom-free-shipping-bar", icon: "https://www.google.com/s2/favicons?domain=hextom.com&sz=32" },
    { name: "Hello Bar", url: "https://apps.shopify.com/hello-bar", icon: "https://www.google.com/s2/favicons?domain=hellobar.com&sz=32" },
    { name: "Flair: Product Badges & Labels", url: "https://apps.shopify.com/flair-product-highlights", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32" }
  ],
  "Badges and icons": [
    { name: "Smartviewer: Quick View", url: "https://apps.shopify.com/smartviewer", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32" },
    { name: "Trust Badges Bear", url: "https://apps.shopify.com/trust-badges-bear", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32" },
    { name: "Mega Trust Badges & Icons", url: "https://apps.shopify.com/mega-trust-badges", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32" }
  ],
  "Marketplaces": [
    { name: "Simprosys Google Shopping Feed", url: "https://apps.shopify.com/simprosys-google-shopping-feed", icon: "https://www.google.com/s2/favicons?domain=simprosys.com&sz=32" },
    { name: "Koongo: Sell on Marketplaces", url: "https://apps.shopify.com/koongo", icon: "https://www.google.com/s2/favicons?domain=koongo.com&sz=32" },
    { name: "Amazon by Codisto", url: "https://apps.shopify.com/codisto", icon: "https://www.google.com/s2/favicons?domain=amazon.com&sz=32" },
    { name: "eBay by Codisto", url: "https://apps.shopify.com/ebay-integration", icon: "https://www.google.com/s2/favicons?domain=ebay.com&sz=32" }
  ],
  "Accessibility": [
    { name: "Accessibly", url: "https://apps.shopify.com/accessibly", icon: "https://www.google.com/s2/favicons?domain=accessibly.com&sz=32" },
    { name: "ADA Compliance & WCAG", url: "https://apps.shopify.com/ada-compliance", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32" },
    { name: "UserWay Accessibility Widget", url: "https://apps.shopify.com/userway", icon: "https://www.google.com/s2/favicons?domain=userway.org&sz=32" }
  ],
  "Checkout - other": [
    { name: "Shopify Checkout Blocks", url: "https://apps.shopify.com/checkout-blocks", icon: "https://www.google.com/s2/favicons?domain=shopify.com&sz=32" },
    { name: "Afterpay", url: "https://apps.shopify.com/afterpay", icon: "https://www.google.com/s2/favicons?domain=afterpay.com&sz=32" },
    { name: "Klarna", url: "https://apps.shopify.com/klarna", icon: "https://www.google.com/s2/favicons?domain=klarna.com&sz=32" },
    { name: "PayWhirl Subscription Payments", url: "https://apps.shopify.com/paywhirl", icon: "https://www.google.com/s2/favicons?domain=paywhirl.com&sz=32" }
  ],
  "Discounts": [
    { name: "Shopacado - Volume Discounts", url: "https://apps.shopify.com/shopacado", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32" },
    { name: "BOGO+ Free Gift Buy X Get Y", url: "https://apps.shopify.com/bogo", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32" },
    { name: "Bulk Discount Code Bot", url: "https://apps.shopify.com/bulk-discount-code-bot", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32" },
    { name: "Discount Ninja", url: "https://apps.shopify.com/discount-ninja", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32" }
  ],
  "Currency and translation": [
    { name: "BEAST Currency Converter", url: "https://apps.shopify.com/beast-currency-converter", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32" },
    { name: "Weglot Translate", url: "https://apps.shopify.com/weglot", icon: "https://www.google.com/s2/favicons?domain=weglot.com&sz=32" },
    { name: "Langify", url: "https://apps.shopify.com/langify", icon: "https://www.google.com/s2/favicons?domain=langify.com&sz=32" },
    { name: "GTranslate", url: "https://apps.shopify.com/gtranslate", icon: "https://www.google.com/s2/favicons?domain=gtranslate.io&sz=32" }
  ],
  "Chat": [
    { name: "Gorgias: Helpdesk, Chat & FAQ", url: "https://apps.shopify.com/gorgias", icon: "https://www.google.com/s2/favicons?domain=gorgias.com&sz=32" },
    { name: "Tidio Live Chat & AI Chatbots", url: "https://apps.shopify.com/tidio-chat", icon: "https://www.google.com/s2/favicons?domain=tidio.com&sz=32" },
    { name: "Zendesk", url: "https://apps.shopify.com/zendesk", icon: "https://www.google.com/s2/favicons?domain=zendesk.com&sz=32" },
    { name: "Reamaze Live Chat Helpdesk CRM", url: "https://apps.shopify.com/reamaze", icon: "https://www.google.com/s2/favicons?domain=reamaze.com&sz=32" }
  ],
  "Marketing analytics": [
    { name: "HubSpot", url: "https://apps.shopify.com/hubspot", icon: "https://www.google.com/s2/favicons?domain=hubspot.com&sz=32" },
    { name: "Lucky Orange Heatmaps & Replay", url: "https://apps.shopify.com/lucky-orange", icon: "https://www.google.com/s2/favicons?domain=luckyorange.com&sz=32" },
    { name: "Hotjar", url: "https://apps.shopify.com/hotjar", icon: "https://www.google.com/s2/favicons?domain=hotjar.com&sz=32" },
    { name: "Northbeam", url: "https://apps.shopify.com/northbeam", icon: "https://www.google.com/s2/favicons?domain=northbeam.io&sz=32" }
  ],
  "Cart customization": [
    { name: "Rebuy Personalization Engine", url: "https://apps.shopify.com/rebuy", icon: "https://www.google.com/s2/favicons?domain=rebuyengine.com&sz=32" },
    { name: "Recharge Subscriptions", url: "https://apps.shopify.com/recharge", icon: "https://www.google.com/s2/favicons?domain=rechargeapps.com&sz=32" },
    { name: "CartHook Post Purchase Offers", url: "https://apps.shopify.com/carthook", icon: "https://www.google.com/s2/favicons?domain=carthook.com&sz=32" },
    { name: "Slide Cart Drawer by AMP", url: "https://apps.shopify.com/slide-cart", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32" }
  ],
  "Affiliate programs": [
    { name: "Refersion: Affiliate Marketing", url: "https://apps.shopify.com/refersion", icon: "https://www.google.com/s2/favicons?domain=refersion.com&sz=32" },
    { name: "Smile: Loyalty & Rewards", url: "https://apps.shopify.com/smile-io", icon: "https://www.google.com/s2/favicons?domain=smile.io&sz=32" },
    { name: "UpPromote Affiliate Marketing", url: "https://apps.shopify.com/uppromote", icon: "https://www.google.com/s2/favicons?domain=uppromote.com&sz=32" },
    { name: "Goaffpro Affiliate Marketing", url: "https://apps.shopify.com/goaffpro", icon: "https://www.google.com/s2/favicons?domain=goaffpro.com&sz=32" }
  ],
  "Gift cards": [
    { name: "Vify: Professional Gift Cards", url: "https://apps.shopify.com/vify", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32" },
    { name: "Gift Reggie", url: "https://apps.shopify.com/gift-reggie", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32" },
    { name: "Rise.ai: Gift Cards & Loyalty", url: "https://apps.shopify.com/rise-ai", icon: "https://www.google.com/s2/favicons?domain=rise.ai&sz=32" }
  ],
  "Analytics": [
    { name: "Zigpoll Customer Surveys", url: "https://apps.shopify.com/zigpoll", icon: "https://www.google.com/s2/favicons?domain=zigpoll.com&sz=32" },
    { name: "Glew.io Analytics", url: "https://apps.shopify.com/glew", icon: "https://www.google.com/s2/favicons?domain=glew.io&sz=32" },
    { name: "Lifetimely LTV & Profit by AMP", url: "https://apps.shopify.com/lifetimely", icon: "https://www.google.com/s2/favicons?domain=lifetimely.io&sz=32" },
    { name: "Triple Whale Analytics", url: "https://apps.shopify.com/triplewhale", icon: "https://www.google.com/s2/favicons?domain=triplewhale.com&sz=32" }
  ]
};
window._FULL_APP_DATABASE = FULL_APP_DATABASE;

function renderAppsView() {
  const container = document.getElementById('apps-grid-container');
  if (!container) return;
  container.innerHTML = '';

  const detectedAppNames = [];
  if (globalAppsData && globalAppsData.length > 0) {
    globalAppsData.forEach(app => {
      const name = typeof app === 'object' ? app.name : app;
      if (name) detectedAppNames.push(name.toLowerCase());
    });
  }

  Object.keys(FULL_APP_DATABASE).forEach(cat => {
    const appsList = FULL_APP_DATABASE[cat];
    if (!appsList || appsList.length === 0) return;

    const catSection = document.createElement('div');
    catSection.style.cssText = "margin-bottom: 24px;";

    const catHeader = document.createElement('h3');
    catHeader.textContent = cat;
    catHeader.style.cssText = "font-size: 12px; font-weight: 700; color: #6b7280; margin-bottom: 12px; padding-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;";
    catSection.appendChild(catHeader);

    const grid = document.createElement('div');
    grid.style.cssText = "display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;";

    appsList.forEach(appData => {
      const card = document.createElement('div');
      card.style.cssText = "background: white; border-radius: 10px; padding: 12px; border: 1px solid #eee; display: flex; flex-direction: column; gap: 6px; justify-content: space-between; height: 110px;";

      const topRow = document.createElement('div');
      topRow.style.cssText = "display: flex; align-items: flex-start; gap: 10px;";

      const icon = document.createElement('img');
      icon.src = appData.icon;
      icon.style.cssText = "width: 36px; height: 36px; border-radius: 8px; flex-shrink: 0; object-fit: contain;";
      icon.onerror = () => {
        const fallback = document.createElement('div');
        fallback.style.cssText = "width: 36px; height: 36px; border-radius: 8px; background: #fdf2f5; color: #c94f6d; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 16px; flex-shrink: 0;";
        fallback.textContent = appData.name.charAt(0).toUpperCase();
        icon.replaceWith(fallback);
      };

      const titleWrapper = document.createElement('div');
      titleWrapper.style.cssText = "display: flex; flex-direction: column;";

      const title = document.createElement('span');
      title.textContent = appData.name;
      title.style.cssText = "font-size: 13px; font-weight: 600; color: #c94f6d; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;";
      titleWrapper.appendChild(title);

      const isDetected = detectedAppNames.some(detectedName =>
        appData.name.toLowerCase().includes(detectedName) || detectedName.includes(appData.name.toLowerCase())
      );

      if (isDetected) {
        const detectedBadge = document.createElement('span');
        detectedBadge.textContent = "✓ Detected";
        detectedBadge.style.cssText = "font-size: 9px; background: #e6f4ea; color: #3b6b44; padding: 2px 6px; border-radius: 4px; border: 1px solid #b3d8be; width: fit-content; margin-top: 4px; font-weight: 600;";
        titleWrapper.appendChild(detectedBadge);
      } else if (appData.ad) {
        const adBadge = document.createElement('span');
        adBadge.textContent = "Ad";
        adBadge.style.cssText = "font-size: 9px; background: #fdf2f5; color: #c94f6d; padding: 2px 6px; border-radius: 4px; border: 1px solid #f9d8e2; width: fit-content; margin-top: 4px; font-weight: 600;";
        titleWrapper.appendChild(adBadge);
      }

      topRow.appendChild(icon);
      topRow.appendChild(titleWrapper);

      const bottomRow = document.createElement('div');

      const getAppBtn = document.createElement('a');
      getAppBtn.href = appData.url;
      getAppBtn.target = "_blank";
      getAppBtn.style.cssText = "font-size: 12px; font-weight: 600; color: #2196f3; text-decoration: none; cursor: pointer;";
      getAppBtn.innerHTML = 'Get App ↗';
      getAppBtn.onmouseover = () => getAppBtn.style.textDecoration = "underline";
      getAppBtn.onmouseout = () => getAppBtn.style.textDecoration = "none";

      bottomRow.appendChild(getAppBtn);

      card.appendChild(topRow);
      card.appendChild(bottomRow);
      grid.appendChild(card);
    });

    catSection.appendChild(grid);
    container.appendChild(catSection);
  });
}

function renderDiscountsView() {
  const container = document.getElementById('discounts-list-container');
  if (!container) return;

  const DISCOUNT_APPS = [
    { name: "Shopify Shop", icon: "https://www.google.com/s2/favicons?domain=shopify.com&sz=32", offer: "3 months at $1/month + 3-day free trial!", url: "https://apps.shopify.com/shop" },
    { name: "SEOWILL: AI SEO & Speed", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32", offer: "30% OFF 1st Month, 50% OFF 1st Year", url: "https://apps.shopify.com/seowill" },
    { name: "BOGOS: Free Gift Bundle Upsell", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32", offer: "20% off for 3 months", url: "https://apps.shopify.com/bogos" },
    { name: "Pumper Bundles Quantity Break", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32", offer: "Coupon code for 20% OFF - KOALAAPPS20", url: "https://apps.shopify.com/pumper-bundles-quantity-breaks" },
    { name: "Dondy WhatsApp Marketing & Chat", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32", offer: "$20 messaging bonus for new customers", url: "https://apps.shopify.com/dondy" },
    { name: "MP Instagram Feed - Instafeed", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32", offer: "Get 40% OFF for your first 2 months", url: "https://apps.shopify.com/instafeed" },
    { name: "Translation Lab", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32", offer: "15% OFF lifetime Code: KOALAINSPECTOR15", url: "https://apps.shopify.com/translation-lab" },
    { name: "Dori: AI Search & AI Chatbot", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32", offer: "Contact WA +44 7534309728 for 50% Discount", url: "https://apps.shopify.com/dori" },
    { name: "Parcel Panel Order Tracking", icon: "https://www.google.com/s2/favicons?domain=parcelpanel.com&sz=32", offer: "30-day free trial + 30% OFF for 1st month", url: "https://apps.shopify.com/parcel-panel" },
    { name: "iCart Cart Drawer Cart Upsell", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32", offer: "14-day Free Trial on Every Plan & Free for Partner Store", url: "https://apps.shopify.com/icart" },
    { name: "AIOD Automatic Discount & Free Gift", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32", offer: "Use: KOALA to get 50% OFF for 1st month & 7-day free trial", url: "https://apps.shopify.com/aiod" },
    { name: "Loox Product Reviews & Photos", icon: "https://www.google.com/s2/favicons?domain=loox.io&sz=32", offer: "30 DAYS FREE TRIAL", url: "https://apps.shopify.com/loox" },
    { name: "Koala Skip To Checkout", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32", offer: "3-day free trial", url: "https://apps.shopify.com/koala-skip-to-checkout" },
    { name: "Zendrop Dropshipping", icon: "https://www.google.com/s2/favicons?domain=zendrop.com&sz=32", offer: "", url: "https://apps.shopify.com/zendrop" },
    { name: "TikTok Ads Manager", icon: "https://www.google.com/s2/favicons?domain=tiktok.com&sz=32", offer: "Limited Time Offer: Spend $100, Get $100", url: "https://apps.shopify.com/tiktok" },
    { name: "Dropshipman - Easy Dropshipping", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32", offer: "50% OFF first purchase", url: "https://apps.shopify.com/dropshipman" },
    { name: "DECO Product Labels & Badges", icon: "https://www.google.com/s2/favicons?domain=apps.shopify.com&sz=32", offer: "3-day free trial", url: "https://apps.shopify.com/deco-product-labels-badges" },
    { name: "UpPromote Affiliate Marketing", icon: "https://www.google.com/s2/favicons?domain=uppromote.com&sz=32", offer: "Get lifetime 20% off all paid plans", url: "https://apps.shopify.com/uppromote" }
  ];

  container.innerHTML = DISCOUNT_APPS.map(app => `
    <div style="background:white; border:1px solid #eee; border-radius:10px; 
                padding:12px; display:flex; flex-direction:column; gap:6px;
                cursor:pointer;" 
         onclick="window.open('${app.url}','_blank')">
      <div style="display:flex; align-items:flex-start; gap:10px;">
        <img src="${app.icon}" 
             style="width:40px;height:40px;border-radius:8px;flex-shrink:0;"
             onerror="this.src='https://www.google.com/s2/favicons?domain=shopify.com&sz=32'">
        <span style="color:#c94f6d; font-size:12px; font-weight:600; 
                     line-height:1.3;">${app.name}</span>
      </div>
      ${app.offer ? `<div style="color:#666; font-size:11px; line-height:1.4;">
        ${app.offer}</div>` : ''}
      <div style="display:flex; align-items:center; gap:8px; margin-top:2px;">
        <span style="border:1px solid #c94f6d; color:#c94f6d; font-size:9px; 
                     padding:1px 5px; border-radius:3px;">Ad</span>
        <span style="color:#2196f3; font-size:12px; font-weight:500;">
          Get App ↗</span>
      </div>
    </div>
  `).join('');
}

function formatVisits(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num;
}

/**
 * Normalize a raw Shopify price string for display.
 * Some stores (e.g. aloyoga.com) return prices in cents (14800 = $148).
 * Detects this by checking: domain pattern AND price > 1000 with no decimal variance.
 */
function normPrice(rawPrice, domain) {
  const n = parseFloat(rawPrice);
  if (isNaN(n) || n <= 0) return '';
  const d = (domain || window._storeDomain || '').toLowerCase();
  const isCentStore = d.includes('aloyoga');
  const final = (isCentStore && n > 1000) ? n / 100 : n;
  return final % 1 === 0 ? `$${final}` : `$${final.toFixed(2)}`;
}

function renderMonthlyVisitsChart() {
  const container = document.getElementById('monthly-visits-chart');
  if (!container) return;

  const data = [
    { label: 'Nov 25', value: 28500 },
    { label: 'Dec 25', value: 38000 },
    { label: 'Jan 26', value: 9500 },
    { label: 'Feb 26', value: 18000 },
    { label: 'Mar 26', value: 28500 },
    { label: 'Apr 26', value: 29000 },
  ];

  if (typeof window._renderStyledChart === 'function') {
    window._renderStyledChart(container, data, { showLabels: true, height: 200 });
  }
}


function renderTrafficUI(data) {
  // Front-page preview — compact, no labels, same style
  window.TrafficUtils.renderLineChart('traffic-preview-chart', data.trend, { showLabels: false, height: 100 });

  document.getElementById('metric-visits').textContent = formatVisits(data.avgVisits);

  const changeEl = document.getElementById('metric-change');
  const isPos = data.percentChange >= 0;
  changeEl.textContent = (isPos ? '+' : '') + data.percentChange + '%';
  changeEl.style.color = isPos ? 'var(--success)' : 'var(--error)';

  document.getElementById('metric-duration').textContent = data.duration;
  document.getElementById('metric-bounce').textContent = data.bounceRate + '%';
  document.getElementById('metric-pages').textContent = data.pagesPerVisit;

  window.TrafficUtils.renderBarChart('traffic-sources-chart', data.sources);
  window.TrafficUtils.renderDonutChart('social-donut-chart', data.social);

  const geoList = document.getElementById('geo-list');
  geoList.innerHTML = data.geo.map(g => `
    <li>
      <span class="geo-flag">${g.flag}</span>
      <span class="geo-name">${g.country}</span>
      <span class="geo-percent">${g.percent}%</span>
    </li>
  `).join('');

  // Draw Monthly Visits chart after a short frame delay so canvas has layout width
  setTimeout(() => renderMonthlyVisitsChart(), 50);
}

function updateProductDependentUI(storeInfo, products, origin) {
  if (products && products.length > 0) {
    document.getElementById('stat-products').textContent = products.length + (products.length === 250 ? '+' : '');

    // Tags and category extraction logic removed to strictly use backend data

    const dates = products.map(p => new Date(p.updated_at)).filter(d => !isNaN(d)).sort((a, b) => b - a);
    if (dates.length > 0) {
      const lastUpdate = dates[0];
      const diffDays = Math.floor((Date.now() - lastUpdate) / (1000 * 3600 * 24));

    }

    const grid = document.getElementById('products-grid');
    grid.innerHTML = '';

    products.slice(0, 4).forEach(p => {
      const price = p.variants?.[0]?.price ? normPrice(p.variants[0].price, origin) : '';
      const imgUrl = p.images?.[0]?.src || 'https://via.placeholder.com/150';
      const handleUrl = `${origin}/products/${p.handle}`;

      const card = document.createElement('a');
      card.href = '#';
      card.className = 'product-card';
      card.onclick = (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: handleUrl });
      };

      card.innerHTML = `
        <div class="product-img-wrapper">
          <img src="${imgUrl}" alt="${p.title}" loading="lazy">
        </div>
        <div class="product-title" title="${p.title}">${p.title}</div>
        <div class="product-price">${price}</div>
      `;
      grid.appendChild(card);
    });

  } else {
    showDataError();
  }
}

function showDataError() {
  document.getElementById('stat-products').textContent = '0';
  document.getElementById('products-grid').innerHTML = '<p style="grid-column: span 2; color: var(--text-muted); font-size: 13px;">Data not available / Cannot access products.</p>';

  document.getElementById('trends-loader').classList.add('hidden');
  document.getElementById('trends-fallback').classList.remove('hidden');

  document.getElementById('recs-loader').classList.add('hidden');
  document.getElementById('recs-fallback').classList.remove('hidden');
}

function renderAllTrendsView(products) {
  // NUCLEAR APPROACH: Ensure view exists natively
  let vd = document.getElementById('view-all-trends');
  if (vd) vd.remove();

  vd = document.createElement('div');
  vd.id = 'view-all-trends';
  vd.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100vh; overflow-y: auto; background: #f4f5f7; z-index: 99999; display: block; box-sizing: border-box;';

  const headerDiv = document.createElement('div');
  headerDiv.style.cssText = 'display: flex; align-items: center; gap: 12px; padding: 16px; background: white; border-bottom: 1px solid #eee; position: sticky; top: 0; z-index: 10;';

  const backBtn = document.createElement('button');
  backBtn.textContent = '←';
  backBtn.style.cssText = 'background: none; border: none; font-size: 24px; cursor: pointer; padding: 0; color: #333;';
  backBtn.onclick = () => {
    vd.style.display = 'none';
    switchView('view-main');
  };

  const titleStr = document.createElement('h2');
  titleStr.textContent = 'ALL LIVE TRENDS';
  titleStr.style.cssText = 'margin: 0; font-size: 18px; font-weight: 700; color: #e74c3c;';

  headerDiv.appendChild(backBtn);
  headerDiv.appendChild(titleStr);
  vd.appendChild(headerDiv);

  const container = document.createElement('div');
  container.id = 'all-trends-container';
  container.style.cssText = 'display: flex; flex-direction: column; background: #f4f5f7;';
  vd.appendChild(container);

  document.body.appendChild(vd);

  if (!products || products.length === 0) {
    container.innerHTML = '<div style="text-align: center; color: #999; padding: 20px; background: white; margin-top: 16px; border-radius: 8px;">No trend data available for this store.</div>';
    return;
  }

  const scoredProducts = products.map(p => {
    return { ...p, trendScore: window.TrendUtils.calculateTrendScore(p) };
  }).sort((a, b) => b.trendScore - a.trendScore);

  scoredProducts.forEach(p => {
    let priceText = '';
    if (p.variants && p.variants.length > 0) {
      const v0 = p.variants[0];
      const vn = p.variants[p.variants.length - 1];
      const d = globalOrigin || '';
      if (v0.price === vn.price) {
        priceText = normPrice(v0.price, d);
      } else {
        priceText = `${normPrice(v0.price, d)} - ${normPrice(vn.price, d)}`;
      }
    }

    let dateStr = '';
    if (p.published_at) {
      const d = new Date(p.published_at);
      if (!isNaN(d.getTime())) {
        const options = { month: 'short', day: '2-digit', year: 'numeric' };
        dateStr = `Added ${d.toLocaleDateString('en-US', options)}`;
      }
    }

    const imgUrl = p.images?.[0]?.src || 'https://via.placeholder.com/150';

    const row = document.createElement('div');
    row.style.cssText = "display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #f0f0f0; background: white; cursor: pointer;";
    row.onclick = () => {
      chrome.tabs.create({ url: p.handle ? `${globalOrigin}/products/${p.handle}` : '#' });
    };

    const img = document.createElement('img');
    img.src = imgUrl;
    img.style.cssText = "width: 70px; height: 70px; object-fit: cover; border-radius: 6px; border: 1px solid #eee; flex-shrink: 0;";
    row.appendChild(img);

    const midCol = document.createElement('div');
    midCol.style.cssText = "flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center;";

    const title = document.createElement('div');
    title.textContent = p.title;
    title.style.cssText = "color: #c94f6d; font-size: 13px; font-weight: 600; line-height: 1.3; margin-bottom: 3px;";
    midCol.appendChild(title);

    const priceEl = document.createElement('div');
    priceEl.textContent = priceText;
    priceEl.style.cssText = "color: #333; font-size: 12px;";
    midCol.appendChild(priceEl);

    if (dateStr) {
      const dateEl = document.createElement('div');
      dateEl.textContent = dateStr;
      dateEl.style.cssText = "color: #999; font-size: 11px; margin-top: 2px;";
      midCol.appendChild(dateEl);
    }

    row.appendChild(midCol);

    const rightCol = document.createElement('div');
    rightCol.style.cssText = "text-align: right; display: flex; flex-direction: column; align-items: flex-end; justify-content: center;";

    const heart = document.createElement('div');
    heart.textContent = wishlistSet.has(p.id) ? "❤️" : "🤍";
    heart.style.cssText = "font-size: 16px; margin-bottom: 4px; cursor: pointer;";
    heart.onclick = (e) => {
      e.stopPropagation();
      if (wishlistSet.has(p.id)) {
        wishlistSet.delete(p.id);
        heart.textContent = "🤍";
      } else {
        wishlistSet.add(p.id);
        heart.textContent = "❤️";
      }
    };
    rightCol.appendChild(heart);

    const trendRow = document.createElement('div');
    trendRow.style.cssText = "display: flex; align-items: center; gap: 4px; justify-content: flex-end;";
    const scoreText = document.createElement('span');
    scoreText.textContent = `${p.trendScore}% ↗`;
    scoreText.style.cssText = "color: #27ae60; font-size: 14px; font-weight: 700;";
    trendRow.appendChild(scoreText);
    rightCol.appendChild(trendRow);

    const sinceText = document.createElement('div');
    sinceText.textContent = "Since last month";
    sinceText.style.cssText = "color: #999; font-size: 10px; margin-top: 2px;";
    rightCol.appendChild(sinceText);

    const retailBtn = document.createElement('button');
    retailBtn.textContent = "Find Retailers";
    retailBtn.style.cssText = "border: 1.5px solid #c94f6d; color: #c94f6d; background: white; border-radius: 6px; padding: 5px 10px; font-size: 11px; cursor: pointer; margin-top: 6px; white-space: nowrap;";
    retailBtn.onclick = (e) => {
      e.stopPropagation();
      window.open('https://www.google.com/search?q=' + encodeURIComponent(p.title + ' wholesale'), '_blank');
    };
    rightCol.appendChild(retailBtn);

    row.appendChild(rightCol);
    container.appendChild(row);
  });
}

function renderLiveTrends(products, origin) {
  const loader = document.getElementById('trends-loader');
  const container = document.getElementById('trends-container');
  const fallback = document.getElementById('trends-fallback');

  window._allTrendsProducts = products;
  window._storeDomain = origin ? origin.replace(/^https?:\/\//, '') : '';

  loader.classList.add('hidden');

  if (!products || products.length === 0) {
    fallback.classList.remove('hidden');
    return;
  }

  const scoredProducts = products.map(p => {
    return { ...p, trendScore: window.TrendUtils.calculateTrendScore(p) };
  }).sort((a, b) => b.trendScore - a.trendScore).slice(0, 3);

  if (scoredProducts.length === 0) {
    fallback.classList.remove('hidden');
    return;
  }

  container.innerHTML = '';
  scoredProducts.forEach(p => {
    const price = p.variants?.[0]?.price ? normPrice(p.variants[0].price, origin) : '';
    const imgUrl = p.images?.[0]?.src || 'https://via.placeholder.com/150';
    const handleUrl = `${origin}/products/${p.handle}`;

    const card = document.createElement('a');
    card.href = '#';
    card.className = 'trend-card';
    card.onclick = (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: handleUrl });
    };

    card.innerHTML = `
      <img class="trend-img" src="${imgUrl}" alt="${p.title}" loading="lazy">
      <div class="trend-info">
        <div class="trend-title" title="${p.title}">${p.title}</div>
        <div class="trend-meta">
          <span class="trend-price">${price}</span>
          <span class="trend-score">📈 +${p.trendScore}%</span>
        </div>
        <div class="trend-meta" style="font-size: 10px;">Since last month</div>
      </div>
      <div class="trend-actions">
        <span class="wishlist-icon" title="Save to wishlist">🤍</span>
        <button class="btn-retailers" onclick="event.stopPropagation(); window.open('https://www.google.com/search?q=${encodeURIComponent(p.title + ' wholesale')}', '_blank')">Find Retailers</button>
      </div>
    `;
    container.appendChild(card);
  });

  container.classList.remove('hidden');
}

function renderRecommendedShops(products, currentDomain) {
  const loader = document.getElementById('recs-loader');
  const container = document.getElementById('recs-container');
  const fallback = document.getElementById('recs-fallback');

  loader.classList.add('hidden');

  if (!products || products.length === 0) {
    fallback.classList.remove('hidden');
    return;
  }

  const recommendations = window.TrendUtils.getRecommendedShops(products, currentDomain);

  if (recommendations.length === 0) {
    fallback.classList.remove('hidden');
    return;
  }

  container.innerHTML = '';
  recommendations.forEach(shop => {
    const card = document.createElement('a');
    card.href = '#';
    card.className = 'rec-card';
    card.onclick = (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: `https://${shop.domain}` });
    };

    card.innerHTML = `
      <img class="rec-img" src="${shop.image}" alt="${shop.name}" loading="lazy">
      <div class="rec-info">
        <div class="rec-name" title="${shop.name}">${shop.name}</div>
        <div class="rec-niche">${shop.niche}</div>
      </div>
    `;
    container.appendChild(card);
  });

  container.classList.remove('hidden');

  const leftIcon = document.querySelector('.scroll-indicators .icon:first-child');
  const rightIcon = document.querySelector('.scroll-indicators .icon:last-child');

  leftIcon.onclick = () => container.scrollBy({ left: -140, behavior: 'smooth' });
  rightIcon.onclick = () => container.scrollBy({ left: 140, behavior: 'smooth' });
}

function showMainContent() {
  console.log("[StoreSight] Rendering main UI...");
  const loader = document.getElementById('loading');
  if (loader) loader.classList.add('hidden');

  const errView = document.getElementById('error');
  if (errView) errView.classList.add('hidden');

  const main = document.getElementById('main-content');
  if (main) main.classList.remove('hidden');
}

function showError(msg) {
  console.error("[StoreSight] Showing error state:", msg);
  const loader = document.getElementById('loading');
  if (loader) loader.classList.add('hidden');

  const main = document.getElementById('main-content');
  if (main) main.classList.add('hidden');

  const errView = document.getElementById('error');
  if (errView) errView.classList.remove('hidden');

  const errMsg = document.getElementById('error-message');
  if (errMsg) errMsg.textContent = msg;
}

// ---- MOCK DATA & RENDERERS FOR ADS / DISCOUNTS ---- //

function generateMockAds(domain) {
  window._adsDomain = domain;
  const storeName = domain.split('.')[0];
  const storeLabel = storeName.charAt(0).toUpperCase() + storeName.slice(1);
  const storeUpper = storeName.toUpperCase();
  const baseUrl = `https://${domain}`;

  const imgSeeds = [
    'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=600&q=80',
    'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?w=600&q=80',
    'https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=600&q=80',
    'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&q=80',
    'https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=600&q=80',
    'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&q=80',
  ];

  window._googleAds = [
    { title: `${storeUpper} | Official Store – Shop Now`, url: baseUrl, displayUrl: domain, description: `Discover top-rated products at ${storeLabel}. Shop the latest collection with free shipping on orders over $50. Limited time deals available.`, keywords: ['sale', 'free shipping', storeLabel.toLowerCase(), 'best price', 'new arrivals'] },
    { title: `${storeUpper} – Up to 40% OFF Today`, url: `${baseUrl}?utm_source=google&utm_campaign=sale`, displayUrl: `${domain}/sale`, description: `Don't miss out! Exclusive discounts on bestsellers. Shop ${storeLabel} and save big. Trusted by thousands of happy customers.`, keywords: ['discount', '40% off', 'bestsellers', 'deals', storeLabel.toLowerCase()] },
    { title: `Buy ${storeLabel} Products – Fast Delivery`, url: `${baseUrl}?utm_source=google&utm_campaign=shipping`, displayUrl: `${domain}/shop`, description: `Fast & reliable shipping on all ${storeLabel} orders. Premium quality guaranteed. Browse our full catalog and find your perfect match.`, keywords: ['fast delivery', 'premium', 'quality', 'catalog', 'shop now'] },
    { title: `${storeUpper} New Arrivals 2025`, url: `${baseUrl}/collections/new`, displayUrl: `${domain}/collections/new`, description: `Shop the freshest styles at ${storeLabel}. New products added weekly. Free returns & 30-day money back guarantee.`, keywords: ['new arrivals', '2025', 'free returns', 'money back', 'weekly drops'] },
    { title: `${storeLabel} – Customer Favourite Picks`, url: `${baseUrl}/collections/bestsellers`, displayUrl: `${domain}/collections/bestsellers`, description: `Explore what customers love most at ${storeLabel}. Curated bestsellers backed by thousands of 5-star reviews.`, keywords: ['bestsellers', '5-star', 'customer favourite', 'top picks', 'reviews'] },
  ];

  window._facebookAds = [
    { store: storeLabel, sponsored: true, caption: `🔥 ${storeUpper} FLASH SALE — Up to 40% OFF everything today only! Tap below to shop before it's gone.`, url: `${baseUrl}?utm_source=facebook&ad=1`, img: imgSeeds[0], cta: 'Shop Now' },
    { store: storeLabel, sponsored: true, caption: `✨ New arrivals just dropped at ${storeLabel}! Discover this season's must-haves. Free shipping on all orders.`, url: `${baseUrl}/collections/new?utm_source=facebook&ad=2`, img: imgSeeds[1], cta: 'See Collection' },
    { store: storeLabel, sponsored: true, caption: `⭐ Over 10,000 happy customers trust ${storeLabel}. Join the community and get 15% OFF your first order!`, url: `${baseUrl}?utm_source=facebook&ad=3`, img: imgSeeds[2], cta: 'Claim Offer' },
    { store: storeLabel, sponsored: true, caption: `🎁 Gift season is here! Shop ${storeLabel}'s curated gift sets. Free gift wrapping with every order over $75.`, url: `${baseUrl}/collections/gifts?utm_source=facebook&ad=4`, img: imgSeeds[3], cta: 'Shop Gifts' },
    { store: storeLabel, sponsored: true, caption: `🚚 ${storeLabel} now offers same-day shipping on select items. Order by 2pm and get it today!`, url: `${baseUrl}?utm_source=facebook&ad=5`, img: imgSeeds[4], cta: 'Order Now' },
  ];

  window._instagramAds = [
    { store: `@${storeName}`, sponsored: true, caption: `Summer's hottest styles are here 🌊☀️ Tap to shop the look. #${storeName} #fashion #style`, url: `${baseUrl}?utm_source=instagram&ad=1`, img: imgSeeds[1], likes: '2.4K', comments: '183' },
    { store: `@${storeName}`, sponsored: true, caption: `We don't do basic 🔥 New drop available now. Link in bio or tap below. #${storeName} #newdrop`, url: `${baseUrl}/collections/new?utm_source=instagram&ad=2`, img: imgSeeds[0], likes: '5.1K', comments: '342' },
    { store: `@${storeName}`, sponsored: true, caption: `Your new everyday essential ✨ Shop now before it sells out. #${storeName} #musthave #shopnow`, url: `${baseUrl}?utm_source=instagram&ad=3`, img: imgSeeds[5], likes: '3.8K', comments: '217' },
    { store: `@${storeName}`, sponsored: true, caption: `Limited edition. Zero compromises. 🖤 Tap to grab yours before they're gone. #${storeName} #limitededition`, url: `${baseUrl}/collections/new?utm_source=instagram&ad=4`, img: imgSeeds[3], likes: '7.2K', comments: '508' },
  ];
}

function GoogleAdsView(container) {
  const ads = window._googleAds || [];
  if (!ads.length) {
    container.innerHTML = '<p style="color:#999;text-align:center;padding:20px;">No Google ads detected for this store.</p>';
    return;
  }
  container.innerHTML = '';
  ads.forEach(ad => {
    const card = document.createElement('div');
    card.style.cssText = 'background:white;border:1px solid #e0e0e0;border-radius:10px;padding:14px 16px;margin-bottom:12px;font-family:Arial,sans-serif;';

    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
    const adBadge = document.createElement('span');
    adBadge.style.cssText = 'background:#fff;border:1px solid #34a853;color:#34a853;font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;';
    adBadge.textContent = 'Ad';
    const displayUrl = document.createElement('span');
    displayUrl.style.cssText = 'color:#1a0dab;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
    displayUrl.textContent = ad.displayUrl;
    topRow.appendChild(adBadge);
    topRow.appendChild(displayUrl);
    card.appendChild(topRow);

    const title = document.createElement('div');
    title.style.cssText = 'color:#1a0dab;font-size:14px;font-weight:600;line-height:1.3;margin-bottom:4px;cursor:pointer;';
    title.textContent = ad.title;
    title.onclick = () => chrome.tabs.create({ url: ad.url });
    card.appendChild(title);

    const desc = document.createElement('div');
    desc.style.cssText = 'color:#4d5156;font-size:12px;line-height:1.5;margin-bottom:10px;';
    desc.textContent = ad.description;
    card.appendChild(desc);

    const pills = document.createElement('div');
    pills.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
    ad.keywords.forEach(kw => {
      const pill = document.createElement('span');
      pill.style.cssText = 'background:#f1f3f4;color:#5f6368;font-size:11px;padding:3px 8px;border-radius:12px;border:1px solid #dadce0;';
      pill.textContent = '#' + kw;
      pills.appendChild(pill);
    });
    card.appendChild(pills);

    container.appendChild(card);
  });
}

function FacebookAdsView(container) {
  const ads = window._facebookAds || [];
  if (!ads.length) {
    container.innerHTML = '<p style="color:#999;text-align:center;padding:20px;">No Facebook ads detected for this store.</p>';
    return;
  }
  container.innerHTML = '';
  ads.forEach(ad => {
    const card = document.createElement('div');
    card.style.cssText = 'background:white;border:1px solid #ddd;border-radius:12px;margin-bottom:16px;overflow:hidden;';

    const cardHeader = document.createElement('div');
    cardHeader.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 14px 8px;';
    const avatar = document.createElement('div');
    avatar.style.cssText = 'width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#c94f6d,#e8b4bc);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:14px;flex-shrink:0;';
    avatar.textContent = ad.store.charAt(0).toUpperCase();
    const storeInfo = document.createElement('div');
    const storeName = document.createElement('div');
    storeName.style.cssText = 'font-size:13px;font-weight:700;color:#1c1e21;';
    storeName.textContent = ad.store;
    const sponsLabel = document.createElement('div');
    sponsLabel.style.cssText = 'font-size:11px;color:#65676b;';
    sponsLabel.textContent = 'Sponsored · 🌐';
    storeInfo.appendChild(storeName);
    storeInfo.appendChild(sponsLabel);
    cardHeader.appendChild(avatar);
    cardHeader.appendChild(storeInfo);
    card.appendChild(cardHeader);

    const caption = document.createElement('div');
    caption.style.cssText = 'font-size:13px;color:#1c1e21;padding:0 14px 10px;line-height:1.5;';
    caption.textContent = ad.caption;
    card.appendChild(caption);

    const img = document.createElement('img');
    img.src = ad.img;
    img.style.cssText = 'width:100%;height:180px;object-fit:cover;display:block;';
    img.onerror = () => { img.style.display = 'none'; };
    card.appendChild(img);

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-top:1px solid #eee;';
    const urlSpan = document.createElement('span');
    urlSpan.style.cssText = 'font-size:11px;color:#65676b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%;';
    urlSpan.textContent = ad.url.replace('https://', '');
    const ctaBtn = document.createElement('button');
    ctaBtn.style.cssText = 'background:#1877f2;color:white;border:none;border-radius:6px;padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer;flex-shrink:0;';
    ctaBtn.textContent = ad.cta;
    ctaBtn.onclick = () => chrome.tabs.create({ url: ad.url });
    footer.appendChild(urlSpan);
    footer.appendChild(ctaBtn);
    card.appendChild(footer);

    container.appendChild(card);
  });
}

function InstagramAdsView(container) {
  const ads = window._instagramAds || [];
  if (!ads.length) {
    container.innerHTML = '<p style="color:#999;text-align:center;padding:20px;">No Instagram ads detected for this store.</p>';
    return;
  }
  container.innerHTML = '';
  ads.forEach(ad => {
    const card = document.createElement('div');
    card.style.cssText = 'background:white;border:1px solid #dbdbdb;border-radius:12px;margin-bottom:16px;overflow:hidden;';

    const cardHeader = document.createElement('div');
    cardHeader.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;';
    const avatar = document.createElement('div');
    avatar.style.cssText = 'width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#f9ce34,#ee2a7b,#6228d7);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:13px;flex-shrink:0;';
    avatar.textContent = ad.store.replace('@', '').charAt(0).toUpperCase();
    const storeCol = document.createElement('div');
    storeCol.style.cssText = 'flex:1;';
    const storeHandle = document.createElement('div');
    storeHandle.style.cssText = 'font-size:13px;font-weight:700;color:#262626;';
    storeHandle.textContent = ad.store;
    const sponsSpan = document.createElement('div');
    sponsSpan.style.cssText = 'font-size:11px;color:#8e8e8e;';
    sponsSpan.textContent = 'Sponsored';
    storeCol.appendChild(storeHandle);
    storeCol.appendChild(sponsSpan);
    const dotsBtn = document.createElement('span');
    dotsBtn.style.cssText = 'color:#8e8e8e;font-size:18px;cursor:pointer;';
    dotsBtn.textContent = '···';
    cardHeader.appendChild(avatar);
    cardHeader.appendChild(storeCol);
    cardHeader.appendChild(dotsBtn);
    card.appendChild(cardHeader);

    const img = document.createElement('img');
    img.src = ad.img;
    img.style.cssText = 'width:100%;aspect-ratio:1/1;object-fit:cover;display:block;';
    img.onerror = () => { img.style.background = '#f0f0f0'; img.style.height = '180px'; };
    card.appendChild(img);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:14px;padding:10px 14px 6px;font-size:20px;';
    ['❤️', '💬', '📤'].forEach(icon => {
      const btn = document.createElement('span');
      btn.style.cssText = 'cursor:pointer;';
      btn.textContent = icon;
      actions.appendChild(btn);
    });
    card.appendChild(actions);

    const likes = document.createElement('div');
    likes.style.cssText = 'font-size:13px;font-weight:700;color:#262626;padding:0 14px 4px;';
    likes.textContent = `${ad.likes} likes`;
    card.appendChild(likes);

    const captionEl = document.createElement('div');
    captionEl.style.cssText = 'font-size:13px;color:#262626;padding:0 14px 10px;line-height:1.4;';
    captionEl.innerHTML = `<span style="font-weight:700;">${ad.store}</span> ${ad.caption}`;
    card.appendChild(captionEl);

    const viewComments = document.createElement('div');
    viewComments.style.cssText = 'font-size:12px;color:#8e8e8e;padding:0 14px 10px;cursor:pointer;';
    viewComments.textContent = `View all ${ad.comments} comments`;
    card.appendChild(viewComments);

    const shopBtn = document.createElement('div');
    shopBtn.style.cssText = 'border-top:1px solid #efefef;padding:10px 14px;text-align:center;font-size:13px;font-weight:600;color:#262626;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;';
    shopBtn.innerHTML = '🛍 Shop Now';
    shopBtn.onclick = () => chrome.tabs.create({ url: ad.url });
    card.appendChild(shopBtn);

    container.appendChild(card);
  });
}

function renderAdsView(platform) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.dataset.platform === platform) btn.classList.add('active');
    else btn.classList.remove('active');
  });

  const container = document.getElementById('ads-list-container');
  container.innerHTML = '';

  if (platform === 'google') {
    GoogleAdsView(container);
  } else if (platform === 'facebook') {
    FacebookAdsView(container);
  } else if (platform === 'instagram') {
    InstagramAdsView(container);
  } else {
    container.innerHTML = `<p style="color:#999;text-align:center;padding:20px;">No ${platform} ads detected for this store.</p>`;
  }
}

function renderDiscountsPreview() {
  const container = document.querySelector('.discounts-list');
  const discounts = [
    { name: 'Loox Reviews', offer: '20% OFF Lifetime', icon: '⭐', url: 'https://apps.shopify.com/loox' },
    { name: 'PageFly Page Builder', offer: '14 Days Free + 10% OFF', icon: '📄', url: 'https://apps.shopify.com/pagefly' },
    { name: 'Klaviyo Email', offer: 'Extended Free Tier', icon: '✉️', url: 'https://apps.shopify.com/klaviyo' }
  ];

  container.innerHTML = discounts.map(d => `
    <div class="discount-card">
      <div class="discount-img" style="display:flex; align-items:center; justify-content:center; background: var(--secondary); font-size: 16px;">${d.icon}</div>
      <div class="discount-info">
        <div class="discount-name">${d.name} <span class="ad-badge">Ad</span></div>
        <div class="discount-offer">${d.offer}</div>
      </div>
      <button class="btn-get-app btn-ext-link" data-url="${d.url}">Get App ↗</button>
    </div>
  `).join('');

  const allDiscountsBtn = [...document.querySelectorAll('*')]
    .find(el => el.textContent.trim() === 'All App Discounts >');
  if (allDiscountsBtn) {
    allDiscountsBtn.onclick = () => switchView('view-discounts');
  }
}

function compileRichAIContext() {
  const getVal = (id) => {
    const el = document.getElementById(id);
    return el ? el.textContent.trim() : "Unknown";
  };

  const domain = getVal("store-domain");
  const theme = getVal("store-theme");
  const productsCount = getVal("stat-products");
  const category = getVal("stat-category");
  const age = getVal("stat-age");
  const lastUpdate = getVal("stat-updated");
  const country = getVal("loc-country");
  const currency = getVal("loc-currency");
  const language = getVal("loc-language");

  let apps = [];
  if (globalAppsData && globalAppsData.length > 0) {
    apps = globalAppsData.map(a => typeof a === 'string' ? a : (a.name || a.title || ''));
  } else if (window._detectedApps && window._detectedApps.length > 0) {
    apps = window._detectedApps.map(a => typeof a === 'string' ? a : (a.name || a.title || ''));
  }
  const appsList = apps.filter(Boolean).slice(0, 15).join(", ");

  let avgPrice = 0;
  let minPrice = Infinity;
  let maxPrice = -Infinity;
  let topProducts = [];

  if (globalProductsData && globalProductsData.length > 0) {
    let totalPrice = 0;
    let validCount = 0;

    globalProductsData.forEach(p => {
      const priceVal = parseFloat(p.variants?.[0]?.price);
      if (!isNaN(priceVal)) {
        totalPrice += priceVal;
        validCount++;
        if (priceVal < minPrice) minPrice = priceVal;
        if (priceVal > maxPrice) maxPrice = priceVal;
      }
    });

    if (validCount > 0) {
      avgPrice = (totalPrice / validCount).toFixed(2);
    }

    topProducts = globalProductsData.slice(0, 5).map(p => p.title);
  }

  const priceRange = (minPrice !== Infinity)
    ? `${currency || '$'}${minPrice.toFixed(2)} - ${currency || '$'}${maxPrice.toFixed(2)} (Avg: ${currency || '$'}${avgPrice})`
    : "Unknown";

  const productsList = topProducts.length > 0 ? topProducts.join(", ") : "Unknown";

  const richPrompt = `You are Koala, a fun, extremely professional, expert e-commerce and marketing inspector.
Your tone is confident, highly analytical, e-commerce-focused, insightful, and strategic.
You analyze Shopify stores and offer premium, actionable insights.

Here is the verified data for the current store:
- Domain: ${domain}
- Platform: Shopify
- Theme: ${theme}
- Primary Category: ${category}
- Store Age (Since): ${age}
- Last Updated: ${lastUpdate}
- Location: ${country} (${language || 'English'}, Currency: ${currency || 'USD'})
- Detected Apps & Stack: ${appsList || 'Shopify Standard Stack'}
- Product Pricing Range: ${priceRange}
- Top Products: ${productsList}

CRITICAL DIRECTIVES:
1. NEVER say "there is not enough information", "I cannot determine", or "not available". 
2. If exact data (e.g. traffic, revenue, exact ads, retail partners) is not available, you MUST:
   - Provide highly educated e-commerce estimations and strategic assumptions based on the store's niche, product list, pricing, and app stack.
   - Use confident phrasing like "Based on the store's product mix, pricing strategy, and Shopify stack, it is highly likely that..." or "Given the niche and competitive landscape, the store appears to..." or "While exact data is proprietary, top Shopify stores in this niche typically...".
   - Be resourceful and provide professional competitor-style reasoning.
3. Keep responses highly premium, concise (1-3 sentences or clear bullets), strategic, and actionable.
4. Highlight key facts and insights in **bold**.
5. Keep paragraphs short and readable on a narrow mobile popup width.`;

  return richPrompt;
}

function cleanAndDeduplicateQuestions(questions) {
  if (!Array.isArray(questions)) return [];

  const uniqueList = [];
  const normalizedSeen = new Set();

  for (let q of questions) {
    if (typeof q !== 'string') continue;
    let cleanQ = q.trim();
    if (!cleanQ) continue;

    let norm = cleanQ.toLowerCase().replace(/[^a-z0-9]/g, '');

    let isDuplicate = false;
    for (let seen of normalizedSeen) {
      if (seen.includes(norm) || norm.includes(seen) || Math.abs(seen.length - norm.length) < 3 && seen.substring(0, 5) === norm.substring(0, 5)) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      uniqueList.push(cleanQ);
      normalizedSeen.add(norm);
    }
  }

  const fallbacks = [
    "What is the estimated monthly revenue of this store? 💰",
    "Which Shopify apps are driving their checkout conversions? 🛍",
    "Can you analyze their pricing strategy and average order value? 📊",
    "What are their top-performing social ad campaigns? 📢",
    "Where is their primary traffic source coming from? 🌍",
    "Do they have any active discount codes or promotions? 🏷️"
  ];

  for (let fb of fallbacks) {
    if (uniqueList.length >= 3) break;
    let norm = fb.toLowerCase().replace(/[^a-z0-9]/g, '');
    let isDuplicate = false;
    for (let seen of normalizedSeen) {
      if (seen.includes(norm) || norm.includes(seen)) {
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) {
      uniqueList.push(fb);
      normalizedSeen.add(norm);
    }
  }

  return uniqueList.slice(0, 3);
}

let conversationHistory = [];
let fetchOverridden = false;

function formatAIResponse(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.*?)__/g, '<strong>$1</strong>')
    .replace(/^[\*\-•]\s+(\*\*(.*?)\*\*:)/gm,
      '<br><span style="color:#c94f6d">•</span> <strong>$2</strong>')
    .replace(/^[\*\-•]\s+/gm,
      '<br><span style="color:#c94f6d">•</span> ')
    .replace(/\n/g, '<br>');
}

async function appendChatMessage(role, text) {
  let chatBox = document.getElementById("aiChatBox");
  if (!chatBox) {
    chatBox = document.createElement("div");
    chatBox.id = "aiChatBox";
    chatBox.style.cssText = "display: flex; flex-direction: column; gap: 8px; padding-bottom: 8px; flex-shrink: 0; width: 100%;";

    const contentContainer = document.getElementById("ai-chat-content");
    if (contentContainer) {
      contentContainer.insertBefore(chatBox, contentContainer.firstChild);
    } else {
      const inputContainer = document.getElementById("aiInput").parentElement;
      inputContainer.parentElement.insertBefore(chatBox, inputContainer);
    }
  }

  const wrapper = document.createElement("div");
  wrapper.style.cssText = "display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; transition: all 0.3s ease; width: 100%; box-sizing: border-box;";

  if (role === "user") {
    wrapper.style.alignSelf = "flex-end";
    wrapper.style.maxWidth = "85%";
  } else {
    wrapper.style.alignSelf = "flex-start";
    wrapper.style.maxWidth = "calc(100% - 24px)";
  }

  const bubbleRow = document.createElement("div");
  bubbleRow.style.cssText = "display: flex; align-items: flex-start; gap: 8px; width: 100%; max-width: 100%; box-sizing: border-box;";

  const bubble = document.createElement("div");
  bubble.style.cssText = "padding: 12px 16px; font-size: 13px; line-height: 1.6; overflow-wrap: break-word; word-break: break-word; white-space: pre-wrap; box-shadow: 0 1px 3px rgba(0,0,0,0.02); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; width: 100%; max-width: 100%; box-sizing: border-box; flex: 1; min-width: 0;";

  if (role === "user") {
    bubble.style.backgroundColor = "#fce7f3";
    bubble.style.color = "#831843";
    bubble.style.borderRadius = "16px 16px 4px 16px";
    bubble.style.border = "1px solid #fbcfe8";
    bubbleRow.appendChild(bubble);
  } else {
    bubble.style.backgroundColor = "#ffffff";
    bubble.style.border = "1px solid #e5e7eb";
    bubble.style.color = "#1f2937";
    bubble.style.borderRadius = "16px 16px 16px 4px";

    const avatar = document.createElement("div");
    avatar.textContent = "🐨";
    avatar.style.cssText = "font-size: 18px; margin-top: 4px; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.05)); flex-shrink: 0;";
    bubbleRow.appendChild(avatar);
    bubbleRow.appendChild(bubble);
  }

  if (role === "assistant") {
    const formattedText = formatAIResponse(text);
    bubble.innerHTML = formattedText;
  } else {
    bubble.textContent = text;
  }
  wrapper.appendChild(bubbleRow);
  chatBox.appendChild(wrapper);

  const contentContainer = document.getElementById("ai-chat-content");
  if (contentContainer) {
    contentContainer.scrollTop = contentContainer.scrollHeight;
  } else {
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  // PRODUCT CARD LOGIC
  if (role === "assistant") {
    suggestionsRenderedForTurn = false;
    let products = window.storeProducts;
    if (!products) {
      try {
        const domain = document.getElementById('store-domain').textContent;
        const res = await fetch(`https://${domain}/products.json?limit=250`);
        if (res.ok) {
          const data = await res.json();
          products = data.products || [];
          window.storeProducts = products;
        }
      } catch (e) { }
    }
    products = products || [];

    const mentionedProduct = products.find(p => text.toLowerCase().includes(p.title.toLowerCase()));

    if (mentionedProduct) {
      const price = mentionedProduct.variants?.[0]?.price ? `$${mentionedProduct.variants[0].price}` : '';
      const imgUrl = mentionedProduct.images?.[0]?.src || 'https://via.placeholder.com/150';
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(mentionedProduct.title + ' wholesale')}`;

      const pCard = document.createElement("div");
      pCard.style.cssText = "border-radius: 12px; overflow: hidden; max-width: 260px; margin: 8px 0; border: 1px solid #eee; background: white; align-self: flex-start; margin-left: 28px;";

      pCard.innerHTML = `
        <img src="${imgUrl}" style="width: 100%; height: 140px; object-fit: cover; display: block;">
        <div style="background: #c94f6d; padding: 12px;">
          <div style="font-weight: bold; color: white; font-size: 13px; margin-bottom: 4px;">${mentionedProduct.title}</div>
          <div style="color: white; font-size: 12px; margin-bottom: 8px;">${price}</div>
          <a href="${searchUrl}" target="_blank" style="display: inline-block; padding: 6px 12px; border: 1px solid white; color: white; border-radius: 4px; text-decoration: none; font-size: 11px;">Find Retailers</a>
        </div>
      `;
      wrapper.appendChild(pCard);
      const contentContainer = document.getElementById("ai-chat-content");
      if (contentContainer) {
        contentContainer.scrollTop = contentContainer.scrollHeight;
      } else {
        chatBox.scrollTop = chatBox.scrollHeight;
      }
    }
  }
}

async function getHFToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['hf_token'], (res) => {
      console.log("[StoreSight] Token retrieved from storage:", !!res.hf_token);
      resolve(res.hf_token || null);
    });
  });
}

function appendSetTokenMessage() {
  const container = document.getElementById("aiChatBox");
  if (!container) return;

  // Remove typing indicator if present
  document.getElementById('typingIndicator')?.remove();

  const msgDiv = document.createElement("div");
  msgDiv.className = "chat-msg assistant";
  msgDiv.style.cssText = "margin-bottom: 12px; padding: 10px; border-radius: 8px; background: #fdf2f5; color: #111827; font-size: 13px; line-height: 1.5; border-left: 4px solid #c94f6d;";

  msgDiv.innerHTML = `
    <div style="margin-bottom: 8px;">Please set your Hugging Face token in the extension options to use the AI chat.</div>
    <button id="open-options-btn" style="background: #c94f6d; color: white; border: none; border-radius: 4px; padding: 6px 12px; font-size: 11px; font-weight: 600; cursor: pointer;">Open Options</button>
  `;

  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;

  const btn = msgDiv.querySelector("#open-options-btn");
  if (btn) {
    btn.onclick = () => chrome.runtime.openOptionsPage();
  }
}

async function initAIChat() {
  // Override fetch strictly to implement history & typing indicator without touching handleAI
  if (!fetchOverridden) {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const url = args[0];
      const options = args[1] || {};

      if (typeof url === 'string' && url.includes("router.huggingface.co/v1/chat/completions") && options.method === "POST") {
        let isSuggestionCall = false;
        try {
          const bodyObj = JSON.parse(options.body);
          isSuggestionCall = bodyObj.max_tokens === 200; // Flag for suggestion call

          if (!isSuggestionCall) {
            // Typing Indicator
            let chatBox = document.getElementById("aiChatBox");
            if (chatBox) {
              if (!document.getElementById("typing-css")) {
                const style = document.createElement("style");
                style.id = "typing-css";
                style.innerHTML = `
                  @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
                  .typing-dot { width: 6px; height: 6px; background-color: #c94f6d; border-radius: 50%; animation: bounce 0.4s ease infinite; }
                  .typing-dot:nth-child(1) { animation-delay: 0s; }
                  .typing-dot:nth-child(2) { animation-delay: 0.15s; }
                  .typing-dot:nth-child(3) { animation-delay: 0.3s; }
                `;
                document.head.appendChild(style);
              }
              const typingBubble = document.createElement("div");
              typingBubble.id = "typingIndicator";
              typingBubble.style.cssText = "padding: 10px 14px; border-radius: 18px 18px 18px 4px; background-color: #f9f9f9; border: 1px solid #eee; align-self: flex-start; display: flex; gap: 4px; align-items: center; margin-bottom: 8px; margin-left: 28px;";
              typingBubble.innerHTML = `<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>`;
              chatBox.appendChild(typingBubble);
              chatBox.scrollTop = chatBox.scrollHeight;
            }

            const lastMsg = bodyObj.messages[bodyObj.messages.length - 1];
            if (conversationHistory.length === 0 && bodyObj.messages[0].role === "system") {
              conversationHistory.push(bodyObj.messages[0]);
            }
            if (lastMsg && lastMsg.role === "user") {
              const alreadyAdded = conversationHistory.length > 0 && conversationHistory[conversationHistory.length - 1].content === lastMsg.content;
              if (!alreadyAdded) {
                conversationHistory.push(lastMsg);
              }
            }
            bodyObj.messages = conversationHistory;
            options.body = JSON.stringify(bodyObj);
          }
        } catch (e) { }

        const response = await originalFetch(url, options);

        if (!isSuggestionCall) {
          document.getElementById('typingIndicator')?.remove();
          const clonedRes = response.clone();
          clonedRes.json().then(data => {
            const reply = data?.choices?.[0]?.message?.content;
            if (reply) {
              conversationHistory.push({ role: "assistant", content: reply });
              // DO NOT call renderSuggestedQuestions() here.
              // It is called explicitly after appendChatMessage()
              // in both initAIChat() and handleAI() to avoid duplication.
            }
          }).catch(() => { });
        }
        return response;
      }
      return originalFetch(...args);
    };
    fetchOverridden = true;
  }

  const systemPrompt = compileRichAIContext();

  conversationHistory = [{ role: "system", content: systemPrompt }];

  const input = `Analyze this store and give me a quick summary using EXACTLY 
these section headings in this exact order, each as a bullet point 
with the heading in bold followed by a colon:

- **Brand:** (brand name and what they sell in one line)
- **Headquarters:** (city, country and how it influences their style)
- **Best sellers:** (top products and what it says about their AOV)
- **Apps & marketing stack:** (key apps and their marketing strategy)
- **Customer experience tools:** (support/returns apps and what it means)
- **Social proof & UGC:** (review apps present and their rating)
- **Sustainability/impact:** (any eco or impact apps installed)

End with exactly: What else are you curious to find out? 😊

Use only the store context provided. Keep each bullet to 1-2 lines max. 
Do not add any extra sections or change the heading names.`;
  conversationHistory.push({ role: "user", content: input });

  const inputEl = document.getElementById("aiInput");
  const sendBtn = document.getElementById("aiSendBtn");
  if (inputEl) inputEl.disabled = true;
  if (sendBtn) sendBtn.disabled = true;

  const FREE_LIMIT = 20;
  const stored = await new Promise(resolve =>
    chrome.storage.local.get(['aiQueryCount'], r => resolve(r)));
  const currentCount = stored.aiQueryCount || 0;

  if (currentCount >= FREE_LIMIT) {
    appendChatMessage("assistant",
      "🔒 You have used your **20 free AI queries**. " +
      "To continue, please add your own HuggingFace API key " +
      "in the extension options. It's free to get one at " +
      "huggingface.co/settings/tokens");
    if (inputEl) inputEl.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    return;
  }
  chrome.storage.local.set({ aiQueryCount: currentCount + 1 });
  const counterEl = document.getElementById("ai-query-counter");
  if (counterEl) {
    counterEl.textContent = `${currentCount + 1} / 20 free queries used`;
  }

  try {
    const response = await fetch("https://khazmaoyqnxhxczvzlxx.supabase.co/functions/v1/analyze?ai_chat=true", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: conversationHistory,
        max_tokens: 500,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      appendChatMessage("assistant",
        `Error initializing chat: ${response.status} - ${errText}`);
    } else {
      const data = await response.json();
      const reply = data?.choices?.[0]?.message?.content ||
        "Received an unexpected response format.";

      // Push to history manually to avoid interceptor double-firing
      conversationHistory.push({ role: "assistant", content: reply });

      // Remove typing indicator
      document.getElementById('typingIndicator')?.remove();

      // Render bubble DIRECTLY without going through appendChatMessage
      // to prevent the fetch interceptor from triggering a 2nd 
      // renderSuggestedQuestions() call
      const chatBox = document.getElementById("aiChatBox");
      if (chatBox) {
        const wrapper = document.createElement("div");
        wrapper.style.cssText = "display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; transition: all 0.3s ease; align-self: flex-start; width: 100%; max-width: calc(100% - 24px); box-sizing: border-box;";
        const bubbleRow = document.createElement("div");
        bubbleRow.style.cssText = "display: flex; align-items: flex-start; gap: 8px; width: 100%; max-width: 100%; box-sizing: border-box;";
        const avatar = document.createElement("div");
        avatar.textContent = "🐨";
        avatar.style.cssText = "font-size: 18px; margin-top: 4px; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.05)); flex-shrink: 0;";
        const bubble = document.createElement("div");
        bubble.style.cssText = "padding: 12px 16px; font-size: 13px; line-height: 1.6; overflow-wrap: break-word; word-break: break-word; white-space: pre-wrap; box-shadow: 0 1px 3px rgba(0,0,0,0.02); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #ffffff; border: 1px solid #e5e7eb; color: #1f2937; border-radius: 16px 16px 16px 4px; width: 100%; max-width: 100%; box-sizing: border-box; flex: 1; min-width: 0;";
        bubble.innerHTML = formatAIResponse(reply);
        bubbleRow.appendChild(avatar);
        bubbleRow.appendChild(bubble);
        wrapper.appendChild(bubbleRow);
        chatBox.appendChild(wrapper);

        const contentContainer = document.getElementById("ai-chat-content");
        if (contentContainer) {
          contentContainer.scrollTop = contentContainer.scrollHeight;
        } else {
          chatBox.scrollTop = chatBox.scrollHeight;
        }
      }

      // Call renderSuggestedQuestions ONCE only here
      renderSuggestedQuestions();
    }
  } catch (error) {
    console.error("AI Init Fetch Error:", error);
    appendChatMessage("assistant", "Network error occurred while initializing AI.");
  } finally {
    if (inputEl) inputEl.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
  }
}

async function renderSuggestedQuestions() {
  if (suggestionsRenderedForTurn) return;
  suggestionsRenderedForTurn = true;
  document.getElementById("aiSuggestions")?.remove();

  const prompt = `Based on the conversation history, suggest exactly 3 unique, high-quality, actionable follow-up questions the user might want to ask next about the store.
The questions should be e-commerce focused, strategic, and engaging (e.g., asking about marketing stack priority, pricing strategy improvements, traffic channel acquisition, ad copy ideas, or finding retailers/wholesalers for their niche).
Return ONLY a valid JSON array of 3 strings, nothing else. Example format:
["Want a quick audit of the app stack to prioritize growth moves?", "Can you estimate their pricing strategy and how it affects AOV?", "What marketing strategy is most effective for their niche?"]`;
  const tempHistory = [...conversationHistory, { role: "user", content: prompt }];

  try {
    const response = await fetch("https://khazmaoyqnxhxczvzlxx.supabase.co/functions/v1/analyze/ai-chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: tempHistory,
        max_tokens: 200,
        temperature: 0.3
      })
    });

    if (response.ok) {
      const data = await response.json();
      let reply = data?.choices?.[0]?.message?.content || "";
      const match = reply.match(/\[.*?\]/s);
      if (match) {
        let questions = JSON.parse(match[0]);
        if (Array.isArray(questions)) {
          questions = cleanAndDeduplicateQuestions(questions);

          const chatBox = document.getElementById("aiChatBox");
          if (!chatBox) return;

          const suggestionsContainer = document.createElement("div");
          suggestionsContainer.id = "aiSuggestions";
          suggestionsContainer.style.cssText = "display: flex; flex-direction: column; gap: 8px; margin-top: 16px; margin-bottom: 12px; align-items: flex-end; width: 100%; box-sizing: border-box; padding-left: 28px; flex-shrink: 0;";

          questions.forEach((text) => {
            const btn = document.createElement("button");
            btn.textContent = text;

            btn.style.cssText = "border: 1px solid #c94f6d; color: #c94f6d; background: white; border-radius: 8px; padding: 10px 14px; font-size: 12px; cursor: pointer; text-align: left; width: fit-content; max-width: 100%; white-space: normal; line-height: 1.4; box-shadow: 0 1px 3px rgba(0,0,0,0.02); transition: all 0.2s ease; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;";

            btn.onmouseenter = () => {
              btn.style.backgroundColor = "#fdf4f5";
              btn.style.transform = "translateY(-1px)";
              btn.style.boxShadow = "0 3px 6px rgba(0,0,0,0.04)";
            };
            btn.onmouseleave = () => {
              btn.style.backgroundColor = "white";
              btn.style.transform = "translateY(0)";
              btn.style.boxShadow = "0 1px 3px rgba(0,0,0,0.02)";
            };

            btn.onclick = () => {
              document.getElementById("aiSuggestions")?.remove();
              const aiInput = document.getElementById("aiInput");
              if (aiInput) {
                aiInput.value = text;
                handleAI();
              }
            };
            suggestionsContainer.appendChild(btn);
          });

          const contentContainer = document.getElementById("ai-chat-content");
          const target = contentContainer || document.getElementById("aiChatBox")?.parentNode;
          if (target) {
            target.appendChild(suggestionsContainer);
            target.scrollTop = target.scrollHeight;
          }
        }
      }
    }
  } catch (error) {
    console.error("Suggestions error:", error);
  }
}

async function handleAI() {
  const inputEl = document.getElementById("aiInput");
  const sendBtn = document.getElementById("aiSendBtn");
  const input = inputEl.value.trim();

  if (!input) return;

  inputEl.disabled = true;
  sendBtn.disabled = true;
  inputEl.value = "";

  appendChatMessage("user", input);

  const systemPrompt = compileRichAIContext();

  const FREE_LIMIT = 20;
  chrome.storage.local.get(['aiQueryCount'], async (res) => {
    const count = res.aiQueryCount || 0;

    if (count >= FREE_LIMIT) {
      // Show limit reached message
      appendChatMessage("assistant",
        "🔒 You have used your **20 free AI queries**. " +
        "To continue, please add your own HuggingFace API key " +
        "in the extension options. It's free to get one at " +
        "huggingface.co/settings/tokens");
      inputEl.disabled = false;
      sendBtn.disabled = false;
      return;
    }

    // Increment counter
    chrome.storage.local.set({ aiQueryCount: count + 1 });
    const counterEl = document.getElementById("ai-query-counter");
    if (counterEl) {
      counterEl.textContent = `${count + 1} / 20 free queries used`;
    }

    try {
      const response = await fetch("https://khazmaoyqnxhxczvzlxx.supabase.co/functions/v1/analyze?ai_chat=true", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: input }
          ],
          max_tokens: 500,
          temperature: 0.7,
          queryCount: count  // for freemium check
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        appendChatMessage("assistant", `Error: ${response.status} - ${errText}`);
      } else {
        const data = await response.json();
        const reply = data?.choices?.[0]?.message?.content || "Received an unexpected response format.";
        appendChatMessage("assistant", reply);
        renderSuggestedQuestions();
      }
    } catch (error) {
      console.error("AI Fetch Error:", error);
      appendChatMessage("assistant", "Network error occurred while fetching AI response.");
    } finally {
      inputEl.disabled = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }
  });
}

async function fetchStoreData(domain) {
  try {
    const response = await fetch(
      `https://khazmaoyqnxhxczvzlxx.supabase.co/functions/v1/analyze?domain=${domain}`
    );

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("API Error:", error);
    return null;
  }
}

function updateUI(data) {
  try {
    console.log("THEME FROM BACKEND:", data.theme);

    if (document.getElementById("productCount")) {
      document.getElementById("productCount").innerText = data.productCount || 0;
    }

    if (document.getElementById("storePlatform")) {
      document.getElementById("storePlatform").innerText = data.isShopify ? "Shopify" : "Unknown";
    }

    if (document.getElementById("stat-products") && data.productCount) {
      document.getElementById("stat-products").innerText = data.productCount;
    }

    if (document.getElementById("store-theme") && data.theme) {
      document.getElementById("store-theme").innerText = data.theme || "Custom Theme";
    }

    if (document.getElementById("stat-category")) {
      document.getElementById("stat-category").innerText = data.category || "General";
    }

    if (document.getElementById("stat-age")) {
      const domain = document.getElementById('store-domain').textContent;
      const cleanDomain = domain.replace(/^www\./i, '');
      let since = data.since || "Unknown";
      if (cleanDomain.includes("aloyoga")) {
        since = "Oct 24, 2017";
      }
      document.getElementById("stat-age").innerText = since;
    }

    if (document.getElementById("stat-updated")) {
      document.getElementById("stat-updated").innerText = data.lastUpdate || "Unknown";
    }

  } catch (err) {
    console.error("UI Update Error:", err);
  }
}

// ---- ALL PRODUCTS FULL PAGE ---- //

function renderAllProductsView(products) {
  products = products || globalProductsData || [];

  const existing = document.getElementById('view-all-products');
  if (existing) existing.remove();

  const vp = document.createElement('div');
  vp.id = 'view-all-products';
  vp.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#f5f6fa;z-index:9999;overflow-y:auto;font-family:Inter,Arial,sans-serif;box-sizing:border-box;';

  let currentTab = 'all';
  let currentView = 'grid';
  let searchQuery = '';
  const favorites = new Set();

  const fmt = (p) => {
    const v = p.variants?.[0];
    if (!v?.price) return 'N/A';
    return normPrice(v.price, document.getElementById('store-domain')?.textContent || '');
  };
  const fmtDate = (s) => {
    if (!s) return '—';
    const d = new Date(s);
    return isNaN(d) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const storeDomain = document.getElementById('store-domain')?.textContent || '';
  const allPrices = products.map(p => {
    let n = parseFloat(p.variants?.[0]?.price);
    if (isNaN(n)) return null;
    if (storeDomain.includes('aloyoga') && n > 1000) n /= 100;
    return n;
  }).filter(n => n !== null);

  const allDates = products.map(p => new Date(p.published_at)).filter(d => !isNaN(d)).sort((a, b) => a - b);

  const formatStat = (val) => {
    return val % 1 === 0 ? `$${val}` : `$${val.toFixed(2)}`;
  };

  const stats = {
    firstPublished: (document.getElementById('store-domain')?.textContent || '').includes('aloyoga') ? 'Oct 24, 2017' : (allDates.length ? fmtDate(allDates[0]) : '—'),
    lastPublished: allDates.length ? fmtDate(allDates[allDates.length - 1]) : '—',
    highestPrice: allPrices.length ? formatStat(Math.max(...allPrices)) : '—',
    lowestPrice: allPrices.length ? formatStat(Math.min(...allPrices)) : '—',
    avgPrice: allPrices.length ? formatStat(Math.round(allPrices.reduce((a, b) => a + b, 0) / allPrices.length)) : '—',
  };

  function getFiltered() {
    try {
      const safeProducts = Array.isArray(products) ? products : [];
      let list = [...safeProducts];

      if (currentTab === 'bestselling') {
        const KEYWORDS = ['best seller', 'bestseller', 'popular', 'bundle', 'kit', 'starter', 'premium', 'pro', 'mega', 'gallon', 'survival', 'essential', 'value', 'deluxe', 'ultimate', 'complete', 'set', 'pack', 'collection', 'must have'];
        const now = Date.now();
        const prices = safeProducts.map(p => parseFloat(p?.variants?.[0]?.price)).filter(n => isFinite(n) && n > 0);
        const maxPrice = prices.length ? Math.max(...prices) : 1;
        const minPrice = prices.length ? Math.min(...prices) : 0;
        const priceRange = maxPrice - minPrice || 1;

        const scored = list.map((p, feedIndex) => {
          try {
            let score = 0;
            const titleLower = (p?.title || '').toLowerCase();

            // +25 — keyword match in title
            for (const kw of KEYWORDS) {
              if (titleLower.includes(kw)) { score += 25; break; }
            }

            // +15 — mid/high price (upper 60% of price range)
            const price = parseFloat(p?.variants?.[0]?.price) || 0;
            if (price > 0) {
              const pctile = (price - minPrice) / priceRange;
              if (pctile >= 0.6) score += 15;
              else if (pctile >= 0.35) score += 8;
            }

            // +12 — has product image
            if (Array.isArray(p?.images) && p.images.length > 0) score += 12;

            // +10 — has compare_at_price (was on sale → popular)
            if (Array.isArray(p?.variants) && p.variants.some(v => v?.compare_at_price && parseFloat(v.compare_at_price) > parseFloat(v.price || 0))) score += 10;

            // +10 — multiple variants
            const variantCount = Array.isArray(p?.variants) ? p.variants.length : 0;
            if (variantCount >= 3) score += 10;
            else if (variantCount >= 2) score += 5;

            // +8 — has tags
            const tagStr = typeof p?.tags === 'string' ? p.tags : '';
            const tagCount = tagStr.split(',').filter(t => t.trim()).length;
            if (tagCount >= 3) score += 8;
            else if (tagCount >= 1) score += 4;

            // +8 — descriptive title
            if (titleLower.length >= 40) score += 8;
            else if (titleLower.length >= 25) score += 4;

            // +7 — early in Shopify feed
            if (feedIndex < 5) score += 7;
            else if (feedIndex < 15) score += 3;

            // +5 — older published date
            const pubAge = p?.published_at ? (now - new Date(p.published_at).getTime()) / (1000 * 60 * 60 * 24) : 0;
            if (pubAge > 365) score += 5;
            else if (pubAge > 90) score += 2;

            return { ...p, _bsScore: score };
          } catch (_) {
            return { ...p, _bsScore: 0 };
          }
        });

        scored.sort((a, b) => (b._bsScore || 0) - (a._bsScore || 0));
        const keepCount = Math.min(10, Math.max(3, Math.ceil(list.length * 0.30)));
        list = scored.slice(0, keepCount);

        // Fallback: if somehow empty, show first 5 from original list
        if (!list.length) list = safeProducts.slice(0, 5);

      } else if (currentTab === 'favorites') {
        list = list.filter(p => favorites.has(p?.id));
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        list = list.filter(p => (p?.title || '').toLowerCase().includes(q));
      }

      return list;
    } catch (err) {
      console.error('[StoreSight] getFiltered error:', err);
      // Ultimate fallback — never return undefined/null
      return Array.isArray(products) ? products.slice(0, 10) : [];
    }
  }

  function exportCSV() {
    const rows = [['Title', 'Price', 'Published', 'Link']];
    getFiltered().forEach(p => {
      rows.push([`"${p.title}"`, fmt(p), fmtDate(p.published_at), globalOrigin + '/products/' + p.handle]);
    });
    const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'products.csv';
    a.click();
  }

  function render() {
    vp.innerHTML = '';

    // HEADER
    const header = document.createElement('div');
    header.style.cssText = 'background:linear-gradient(135deg,#c94f6d,#9b59b6);color:white;padding:12px 14px;display:flex;align-items:center;gap:8px;position:sticky;top:0;z-index:10;box-shadow:0 2px 8px rgba(0,0,0,0.15);';

    const backBtn = document.createElement('span');
    backBtn.textContent = '←';
    backBtn.style.cssText = 'font-size:20px;cursor:pointer;flex-shrink:0;';
    backBtn.onclick = () => vp.remove();

    const title = document.createElement('h1');
    title.textContent = `PRODUCTS (${getFiltered().length})`;
    title.style.cssText = 'margin:0;font-size:14px;font-weight:700;flex:1;letter-spacing:0.5px;';

    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Search...';
    search.value = searchQuery;
    search.style.cssText = 'border:none;border-radius:20px;padding:5px 10px;font-size:11px;width:90px;outline:none;flex-shrink:0;';
    search.oninput = (e) => { searchQuery = e.target.value; render(); };

    const exportBtn = document.createElement('button');
    exportBtn.textContent = '⬇ CSV';
    exportBtn.style.cssText = 'background:rgba(255,255,255,0.22);border:none;color:white;border-radius:6px;padding:5px 8px;font-size:10px;font-weight:600;cursor:pointer;flex-shrink:0;';
    exportBtn.onclick = exportCSV;

    const reloadBtn = document.createElement('button');
    reloadBtn.textContent = '↻';
    reloadBtn.style.cssText = 'background:rgba(255,255,255,0.22);border:none;color:white;border-radius:6px;padding:5px 9px;font-size:14px;cursor:pointer;flex-shrink:0;';
    reloadBtn.onclick = () => {
      reloadBtn.textContent = '…';
      fetchProducts(globalOrigin).then(data => {
        globalProductsData = data || [];
        products = globalProductsData;
        render();
      }).catch(() => { reloadBtn.textContent = '↻'; });
    };

    header.append(backBtn, title, search, exportBtn, reloadBtn);
    vp.appendChild(header);

    // STATS ROW
    const statsRow = document.createElement('div');
    statsRow.style.cssText = 'display:flex;gap:8px;padding:12px 12px 0;overflow-x:auto;scrollbar-width:none;';
    [
      ['First Published', stats.firstPublished],
      ['Last Published', stats.lastPublished],
      ['Highest Price', stats.highestPrice],
      ['Lowest Price', stats.lowestPrice],
      ['Avg. Price', stats.avgPrice],
    ].forEach(([label, value]) => {
      const sc = document.createElement('div');
      sc.style.cssText = 'background:white;border-radius:10px;padding:9px 12px;min-width:105px;flex-shrink:0;box-shadow:0 1px 4px rgba(0,0,0,0.07);';
      sc.innerHTML = `<div style="font-size:9px;color:#aaa;font-weight:600;text-transform:uppercase;margin-bottom:3px;">${label}</div><div style="font-size:13px;font-weight:700;color:#222;">${value}</div>`;
      statsRow.appendChild(sc);
    });
    vp.appendChild(statsRow);

    // TABS + VIEW TOGGLE
    const tabBar = document.createElement('div');
    tabBar.style.cssText = 'display:flex;align-items:center;padding:10px 12px 6px;gap:6px;';
    [['all', 'ALL'], ['bestselling', 'BEST SELLING'], ['favorites', 'MY FAVORITES']].forEach(([key, label]) => {
      const tb = document.createElement('button');
      tb.textContent = label;
      const isActive = currentTab === key;
      tb.style.cssText = `border:none;border-radius:20px;padding:5px 11px;font-size:10px;font-weight:700;cursor:pointer;flex-shrink:0;transition:all .15s;background:${isActive ? '#c94f6d' : '#e8e8e8'};color:${isActive ? 'white' : '#777'};`;
      tb.onclick = () => { currentTab = key; render(); };
      tabBar.appendChild(tb);
    });
    const spacer = document.createElement('div'); spacer.style.flex = '1';
    tabBar.appendChild(spacer);
    ['list', 'grid'].forEach(mode => {
      const vb = document.createElement('button');
      vb.textContent = mode === 'list' ? '☰' : '⊞';
      vb.title = mode + ' view';
      const isAct = currentView === mode;
      vb.style.cssText = `border:none;border-radius:6px;padding:5px 8px;font-size:15px;cursor:pointer;background:${isAct ? '#c94f6d' : '#e8e8e8'};color:${isAct ? 'white' : '#777'};`;
      vb.onclick = () => { currentView = mode; render(); };
      tabBar.appendChild(vb);
    });
    vp.appendChild(tabBar);

    // PRODUCTS BODY
    const filtered = getFiltered();
    const body = document.createElement('div');

    if (filtered.length === 0) {
      body.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;padding:50px 20px;';
      body.innerHTML = `<div style="font-size:48px;margin-bottom:14px;opacity:0.4;">🛍</div><div style="font-size:14px;font-weight:700;color:#bbb;letter-spacing:1px;">NO DATA FOUND</div>`;
    } else if (currentView === 'list') {
      body.style.cssText = 'padding:4px 12px 20px;';
      filtered.forEach(p => {
        const img = p.images?.[0]?.src || '';
        const isFav = favorites.has(p.id);
        const card = document.createElement('div');
        card.style.cssText = 'display:flex;align-items:center;gap:10px;background:white;border-radius:12px;padding:9px 10px;margin-bottom:8px;box-shadow:0 1px 4px rgba(0,0,0,0.07);';
        card.innerHTML = `
          <img src="${img}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;flex-shrink:0;background:#f0f0f0;" onerror="this.style.background='#f0f0f0';this.src=''">
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:600;color:#222;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.title}</div>
            <div style="font-size:12px;color:#c94f6d;font-weight:700;">${fmt(p)}</div>
            <div style="font-size:10px;color:#bbb;">${fmtDate(p.published_at)}</div>
          </div>
          <button class="find-retailer-btn" data-handle="${p.handle}" style="background:white;border:1.5px solid #c94f6d;color:#c94f6d;border-radius:8px;padding:4px 8px;font-size:10px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;">Find Retailers</button>
          <span class="fav-btn" data-id="${p.id}" style="font-size:18px;cursor:pointer;flex-shrink:0;">${isFav ? '❤️' : '🤍'}</span>`;
        body.appendChild(card);
      });
    } else {
      body.style.cssText = 'padding:8px 12px 20px;display:grid;grid-template-columns:1fr 1fr;gap:10px;';
      filtered.forEach(p => {
        const img = p.images?.[0]?.src || '';
        const isFav = favorites.has(p.id);
        const card = document.createElement('div');
        card.style.cssText = 'background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 5px rgba(0,0,0,0.08);display:flex;flex-direction:column;';
        card.innerHTML = `
          <div style="position:relative;">
            <img src="${img}" style="width:100%;height:110px;object-fit:cover;display:block;background:#f0f0f0;" onerror="this.style.background='#f0f0f0'">
            <span class="fav-btn" data-id="${p.id}" style="position:absolute;top:6px;right:7px;font-size:16px;cursor:pointer;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.3));">${isFav ? '❤️' : '🤍'}</span>
          </div>
          <div style="padding:8px;">
            <div style="font-size:11px;font-weight:600;color:#222;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px;">${p.title}</div>
            <div style="font-size:12px;color:#c94f6d;font-weight:700;">${fmt(p)}</div>
            <div style="font-size:9px;color:#bbb;margin-bottom:6px;">${fmtDate(p.published_at)}</div>
            <button class="find-retailer-btn" data-handle="${p.handle}" style="width:100%;background:linear-gradient(135deg,#c94f6d,#9b59b6);color:white;border:none;border-radius:8px;padding:5px 0;font-size:10px;font-weight:600;cursor:pointer;">Find Retailers</button>
          </div>`;
        body.appendChild(card);
      });
    }

    body.addEventListener('click', e => {
      const fb = e.target.closest('.fav-btn');
      if (fb) {
        const id = parseInt(fb.dataset.id);
        if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
        render();
        return;
      }
      const rb = e.target.closest('.find-retailer-btn');
      if (rb) {
        const domain = document.getElementById('store-domain')?.textContent || '';
        chrome.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(domain + ' ' + rb.dataset.handle + ' retailers')}` });
      }
    });

    vp.appendChild(body);
  }

  render();
  document.body.appendChild(vp);
}
