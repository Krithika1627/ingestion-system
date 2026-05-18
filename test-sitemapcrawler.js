const { getSitemapUrls } = require('./services/scraper/sitemap.crawler');

async function test() {
  const urls = await getSitemapUrls('https://mamaearth.in');
  console.log(`Found ${urls.length} product URLs`);
  console.log(urls.slice(0, 5)); // print first 5
}

test();