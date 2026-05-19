// utils.js

function calculateTrendScore(product) {
  let score = 0;
  
  // Recency weight (Newer products demand higher initial attention)
  if (product.published_at || product.created_at) {
    const date = new Date(product.published_at || product.created_at);
    const daysAgo = (Date.now() - date.getTime()) / (1000 * 3600 * 24);
    if (daysAgo < 7) score += 40;
    else if (daysAgo < 30) score += 25;
    else if (daysAgo < 90) score += 10;
  }
  
  // Tags boost (Recognize algorithmic keywords)
  const tags = Array.isArray(product.tags) ? product.tags : 
               (typeof product.tags === 'string' ? product.tags.split(',') : []);
               
  const hotTags = ['best', 'sale', 'hot', 'trending', 'new', 'popular'];
  tags.forEach(t => {
    if (hotTags.includes(t.toLowerCase().trim())) {
      score += 15;
    }
  });
  
  // Price consistency & variants (More variants generally imply more stock depth/complexity)
  if (product.variants && product.variants.length > 2) {
    score += 10;
  }
  
  // Simulate engagement/velocity score via bounded random variance for realism
  score += Math.floor(Math.random() * 20);
  
  // Normalize and cap at 99
  return Math.min(score, 99);
}

const STATIC_SHOPS = [
  { name: "Gymshark", domain: "gymshark.com", niche: "fitness", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://gymshark.com" },
  { name: "Kylie Cosmetics", domain: "kyliecosmetics.com", niche: "beauty", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://kyliecosmetics.com" },
  { name: "Fashion Nova", domain: "fashionnova.com", niche: "apparel", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://fashionnova.com" },
  { name: "Allbirds", domain: "allbirds.com", niche: "shoes", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://allbirds.com" },
  { name: "ColourPop", domain: "colourpop.com", niche: "beauty", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://colourpop.com" },
  { name: "Pura Vida", domain: "puravidabracelets.com", niche: "jewelry", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://puravidabracelets.com" },
  { name: "Chubbies", domain: "chubbiesshorts.com", niche: "apparel", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://chubbiesshorts.com" },
  { name: "Manscaped", domain: "manscaped.com", niche: "grooming", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://manscaped.com" },
  { name: "Lululemon", domain: "lululemon.com", niche: "fitness", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://lululemon.com" },
  { name: "Alo Yoga", domain: "aloyoga.com", niche: "fitness", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://aloyoga.com" },
  { name: "Sephora", domain: "sephora.com", niche: "beauty", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://sephora.com" },
  { name: "Nike", domain: "nike.com", niche: "fitness", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://nike.com" },
  { name: "Adidas", domain: "adidas.com", niche: "fitness", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://adidas.com" },
  { name: "Zara", domain: "zara.com", niche: "apparel", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://zara.com" },
  { name: "H&M", domain: "hm.com", niche: "apparel", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://hm.com" },
  { name: "ASOS", domain: "asos.com", niche: "apparel", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://asos.com" },
  { name: "Tiffany & Co.", domain: "tiffany.com", niche: "jewelry", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://tiffany.com" },
  { name: "Pandora", domain: "pandora.net", niche: "jewelry", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://pandora.net" },
  { name: "Warby Parker", domain: "warbyparker.com", niche: "general", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://warbyparker.com" },
  { name: "Glossier", domain: "glossier.com", niche: "beauty", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://glossier.com" },
  { name: "Harry's", domain: "harrys.com", niche: "grooming", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://harrys.com" },
  { name: "Stitch Fix", domain: "stitchfix.com", niche: "apparel", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://stitchfix.com" },
  { name: "Bombas", domain: "bombas.com", niche: "apparel", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://bombas.com" },
  { name: "MVMT", domain: "mvmt.com", niche: "jewelry", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://mvmt.com" },
  { name: "Daniel Wellington", domain: "danielwellington.com", niche: "jewelry", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://danielwellington.com" },
  { name: "Steve Madden", domain: "stevemadden.com", niche: "shoes", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://stevemadden.com" },
  { name: "Vans", domain: "vans.com", niche: "shoes", image: "https://image.thum.io/get/width/300/crop/400/noanimate/https://vans.com" }
];

function getRecommendedShops(productsData, currentDomain) {
  // Extract and compile all tags to determine primary niche
  const allTags = productsData.flatMap(p => {
    if (Array.isArray(p.tags)) return p.tags;
    if (typeof p.tags === 'string') return p.tags.split(',').map(t => t.trim().toLowerCase());
    return [];
  }).filter(t => t);
  
  const tagCounts = allTags.reduce((acc, tag) => {
    acc[tag] = (acc[tag] || 0) + 1;
    return acc;
  }, {});
  
  const sortedTags = Object.keys(tagCounts).sort((a,b) => tagCounts[b] - tagCounts[a]);
  const topTags = sortedTags.slice(0, 15).join(' ');
  
  // Categorization
  let detectedNiche = 'general';
  if (/(makeup|cosmetics|skin|beauty|hair)/.test(topTags)) detectedNiche = 'beauty';
  else if (/(shirt|clothing|dress|pants|apparel|wear|hoodie)/.test(topTags)) detectedNiche = 'apparel';
  else if (/(shoe|sneaker|boot)/.test(topTags)) detectedNiche = 'shoes';
  else if (/(workout|fitness|gym|active)/.test(topTags)) detectedNiche = 'fitness';
  else if (/(ring|necklace|bracelet|jewelry)/.test(topTags)) detectedNiche = 'jewelry';
  
  // Filter curated database
  let matches = STATIC_SHOPS.filter(s => s.niche === detectedNiche && s.domain !== currentDomain);
  
  // Fallback to random popular stores if niche has poor matches
  if (matches.length < 3) {
    const others = STATIC_SHOPS.filter(s => s.domain !== currentDomain && !matches.includes(s));
    // Shuffle slightly for variance
    matches = [...matches, ...others.sort(() => 0.5 - Math.random())];
  }
  
  return matches.slice(0, 20);
}

// Export for popup.js
window.TrendUtils = {
  calculateTrendScore,
  getRecommendedShops
};
