const { extractProductData } = require('./services/scraper/extractor.service');

const html = `
<html>
  <body>
    <h1 class="product-title">Test Product</h1>
    <div class="price">₹499</div>
    <div class="stock">In Stock</div>

    <div class="gallery">
      <img src="test.jpg" />
    </div>
  </body>
</html>
`;

async function test() {
  const result = await extractProductData(
    html,
    'https://testsite.com/product/test-product'
  );

  console.log(JSON.stringify(result, null, 2));

  process.exit(0);
}

test();