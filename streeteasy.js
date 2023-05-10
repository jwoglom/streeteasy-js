const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const request_client = require('request-promise-native');
const fs = require('fs');
const args = require('yargs').argv;

const streeteasyAreas = JSON.parse(fs.readFileSync('data/areas.json'));
const streeteasyUnitTypes = JSON.parse(fs.readFileSync('data/unitTypes.json'));
const streeteasySortBy = JSON.parse(fs.readFileSync('data/sortBy.json'));

puppeteer.use(StealthPlugin())
const options = {
  headless: args['nonheadless'] ? false : 'new',
  ignoreHTTPSErrors: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-sync",
    "--ignore-certificate-errors",
    "--lang=en-US,en;q=0.9",
    "--disable-gpu",
  ],
  defaultViewport: { width: 1366, height: 768 },
}


if (!!args['webui']) {
  var express = require("express");
  var app = express();

  puppeteer.launch(options).then(async browser => {
    console.log("Launched puppeteer")
    app.get("/request", async (req, res, next) => {    
      const error = checkArgs(req.query);
      if (error) {
        res.json({"error": error});
        return;
      }

      res.json(await launchFromArgs(browser, req.query, false));
    });
  });

  app.listen(3000, () => {
    console.log("Server running on port 3000");
  });
  
} else {
  
  const error = checkArgs(args);
  if (error) {
    console.error(error);
    process.exit(1);
  }

  process.stderr.write('Launching puppeteer\n')
  puppeteer.launch(options).then(async browser => {
    await launchFromArgs(browser, args, true);
    await browser.close()
  })
}

function checkArgs(args) {
  process.stderr.write('request args: '+JSON.stringify(args)+'\n');
  if ((!args.rent && !args.buy) || !args.locations) {
    return 'Required --rent/--buy and --locations';
  }
  return null;
}

async function launchFromArgs(browser, args, toStdout) {
  let rentOrBuy = '';
  if (args.rent) rentOrBuy = 'rent';
  if (args.buy) rentOrBuy = 'buy';
  const locations = args.locations;
  const unitTypes = args.unitTypes;
  const beds = args.beds;
  const minPrice = args.minPrice;
  const maxPrice = args.maxPrice;
  const noFee = args.noFee;
  const sortBy = args.sortBy;
  const pageNumber = args.page;
  return await launch(browser, rentOrBuy, locations, unitTypes, beds, minPrice, maxPrice, noFee, sortBy, pageNumber, toStdout);
}

function rand(x, y) {
  return x + Math.random() * (y-x);
}

function getAreaIds(locationsStr) {
  let ids = [];
  const locations = locationsStr.split(',');
  streeteasyAreas.forEach(item => {
    if (locations.includes(item['name']) || locations.includes('' + item.id)) {
      ids.push(item.id)
    }
  });
  return ids;
}

function getUnitTypeIds(unitTypesStr) {
  let ids = [];
  const unitTypes = unitTypesStr.split(',');
  streeteasyUnitTypes.forEach(item => {
    if (unitTypes.includes(item['name']) || unitTypes.includes('' + item.id)) {
      ids.push(item.id)
    }
  });
  return ids;
}

function getSortByParam(name) {
  let id = null;
  streeteasySortBy.forEach(item => {
    if (name == item['name'] || name == '' + item.id) {
      id = item.id;
    }
  });
  return id;
}

function getBedQuery(bedsStr) {
  if (bedsStr == 'studio') {
    return 'beds:0';
  } else if (['0', '1', '2', '3', '4'].includes(''+bedsStr)) {
    return 'beds:' + bedsStr;
  } else if (bedsStr.includes('-')) {
    return 'beds:' + bedsStr;
  } else if (bedsStr.startsWith('<') || bedsStr.startsWith('>')) {
    return 'beds' + bedsStr;
  } else if (bedsStr.endsWith('+')) {
    return 'beds>=' + bedsStr.substring(0, bedsStr.length - 1);
  }
  return null;
}

function processPrice(price) {
  if (price.endsWith('k')) {
    return parseInt(parseFloat(price.substring(0, price.length-1)) * 1000);
  } else if (price.endsWith('m')) {
    return parseInt(parseFloat(price.substring(0, price.length-1)) * 1000000);
  }
  return parseFloat(price);
}

function buildUrl(rentOrBuy, locationNames, unitTypes, beds, minPrice, maxPrice, noFee, sortBy, pageNumber) {
  let url = 'https://streeteasy.com/';
  let parts = [];

  if (rentOrBuy == 'rent') {
    url += 'for-rent/';
  } else if (rentOrBuy == 'buy') {
    url += 'for-sale/';
  } else return null;

  url += 'nyc/';
  if (minPrice && maxPrice) {
    parts.push('price:'+processPrice(minPrice)+'-'+processPrice(maxPrice));
  } else if (minPrice) {
    parts.push('price:'+processPrice(minPrice)+'-');
  } else if (maxPrice) {
    parts.push('price:-'+processPrice(maxPrice));
  }

  if (locationNames) {
    let areaIds = getAreaIds(locationNames);
    if (areaIds) {
      parts.push('area:' + areaIds.join(','));
    }
  }

  if (unitTypes) {
    let typeIds = getUnitTypeIds(unitTypes);
    if (typeIds) {
      parts.push('type:' + typeIds.join(','));
    }
  }

  if (beds) {
    let bedsQuery = getBedQuery(beds);
    if (bedsQuery) {
      parts.push(bedsQuery);
    }
  }

  if (noFee) {
    parts.push('no_fee:1');
  }

  url += parts.join('%7C'); // "|"

  let params = "";
  if (pageNumber) {
    params += "&page=" + pageNumber;
  }

  if (sortBy) {
    let sortByParam = getSortByParam(sortBy);
    if (sortByParam) {
      params += "&sort_by=" + sortByParam;
    }
  }

  if (params) {
    url += "?" + params.substring(1);
  }

  return url;
}

async function launch(browser, rentOrBuy, locationNames, unitTypes, beds, minPrice, maxPrice, noFee, sortBy, pageNumber, toStdout) {
  process.stderr.write('launch('+rentOrBuy+', locationNames='+locationNames+', unitTypes='+unitTypes+', beds='+beds+', minPrice='+minPrice+', maxPrice='+maxPrice+', noFee='+noFee+', sortBy='+sortBy+', pageNumber='+pageNumber+')\n');
  const url = buildUrl(rentOrBuy, locationNames, unitTypes, beds, minPrice, maxPrice, noFee, sortBy, pageNumber);
  process.stderr.write('url: ' + url + '\n');

  const page = await browser.newPage()
  await page.setDefaultNavigationTimeout(30000);

  await page.setRequestInterception(true);

  let allRequests = [];
  page.on('request', request => {
    request_client({
      uri: request.url(),
      resolveWithFullResponse: true,
    }).then(response => {
      let req = {
        'success': true,
        'request_url': request.url(),
        'request_headers': request.headers(),
        'request_post_data': request.postData(),
        'response_headers': response.headers,
        'response_size': response.headers['content-length'],
        'response_body': response.body,
      };
      allRequests.push(req);

      request.continue();
    }).catch(error => {
      let req = {
        'success': false,
        'request_url': request.url(),
        'request_headers': request.headers(),
        'request_post_data': request.postData(),
        'response_body': error.error,
        'status_code': error.statusCode,
      };

      allRequests.push(req);

      request.continue();
    });
  });

  process.stderr.write('Opening StreetEasy\n')
  await page.goto(url, { waitUntil: 'networkidle2' });
  process.stderr.write('Waiting for search results\n');

  await page.waitForFunction(_ => {
    return document.querySelectorAll('.listingCard').length > 0 || document.querySelectorAll('.no_results').length > 0 || document.querySelectorAll('#px-captcha').length > 0
  })

  let hasCaptcha = await page.evaluate(_ => {
    return document.querySelectorAll('#px-captcha').length > 0
  });

  if (hasCaptcha) {
    fs.writeFileSync('requests.json', JSON.stringify(allRequests));
    const errorObj = {"error": "Received CAPTCHA"};
    if (toStdout) {
      process.stdout.write(JSON.stringify(errorObj));
      return;
    } else {
      process.stderr.write('Error: Received CAPTCHA\n');
      return errorObj;
    }
  }

  process.stderr.write('Parsing search results\n');

  let res = await page.evaluate(_ => {
    let results = [];
    document.querySelectorAll('.listingCard')?.forEach((l, i) => {
      let a = l.querySelector('a');
      let beds = null, bath = null, sqft = null, featured = false, sponsored = false, verified = false;
      Array.from(l.querySelectorAll('.listingDetailDefinitions > .listingDetailDefinitionsItem') || [])?.forEach((item) => {
          const val = item.querySelector('.listingDetailDefinitionsText')?.innerText;
          if (item.querySelectorAll('.listingDetailDefinitionsIcon--bed').length > 0) {
              beds = val;
          } else if (item.querySelectorAll('.listingDetailDefinitionsIcon--bath').length > 0) {
              bath = val;
          } else if (item.querySelectorAll('.listingDetailDefinitionsIcon--measure').length > 0) {
              sqft = val?.split('\n')[0].trim();
          }
      });
      Array.from(l.querySelector('.listingCardTop .listingCardLabel') || [])?.forEach((item) => {
        if (item.getAttribute('data-featured-event-category')) {
          featured = item.getAttribute('data-featured-event-category');
        } else if (item.innerText.contains('Sponsored')) {
          sponsored = true;
        } else if (item.querySelectorAll('.listingCardLabel-checkIcon').length > 0) {
          verified = true;
        }
      });
      results.push({
          'index': i,
          'id': a.getAttribute('data-label-id')?.split('-')[0],
          'address': l.querySelector('address')?.innerText,
          'addressUrl': l.querySelector('address')?.querySelector('a')?.getAttribute('href'),
          'geo': a.getAttribute('data-map-points') || a.getAttribute('se:map:point'),
          'url': a.getAttribute('href'),
          'summary': l.querySelector('.listingCardBottom')?.querySelector('.listingCardLabel')?.innerText,
          'label': l.querySelector('#' + a.getAttribute('aria-labelledby'))?.innerText,
          'images': Array.from(l.querySelectorAll('img')).map(img => img.getAttribute('data-flickity-lazyload') || img.getAttribute('src')),
          'listingBy': l.querySelector('.listingCardBottom--finePrint')?.innerText,
          'beds': beds,
          'bath': bath,
          'sqft': sqft,
          'price': l.querySelector('.price')?.innerText,
          'featured': featured,
          'sponsored': sponsored,
          'verified': verified
      });
    });
    return JSON.stringify(results);
  });

  await page.close();

  if (toStdout) {
    process.stdout.write(res);
    fs.writeFileSync('output.json', res);

    fs.writeFileSync('requests.json', JSON.stringify(allRequests));
  } else {
    process.stderr.write('Done\n');
    return JSON.parse(res);
  }
}
