const fetch       = require('node-fetch');


function utils(Apify){
  Apify = Apify || global.Apify;
  
  return {
    shot,
    error,
    clearText,
    clearNum,
    trunc,
    randomNum,
    getSpreadsheet,
    getExchangeRate,
    queueUrls,
  }
  
  async function shot(p, h){
    h = h || 'local';
    const name = `${h}_${new Date().getTime()}.png`;
    await Apify.setValue(name, await p.screenshot({ fullPage: true }), { contentType: 'image/png' });
    console.log('[MATCHER] Screenshot', name);
  }
  
  async function error({ request: { url, errorMessages }, page }, status = 'request_timeout', error, takeShot){
    const host  = url.match(/^https?\:\/\/([^\/?#]+)(?:[\/?#]|$)/i)[1];
    status      = `${status}_${host}__${new Date().getTime()}`;
    //await shot(page, host);
    page && takeShot && await shot(page, status);
    await Apify.setValue(status, { status, error, url });
    return;
  }
  
  async function queueUrls(urls, reqQueue, limit){
  
    if(limit)
      urls = urls.slice(0, limit);
      
    reqQueue = reqQueue || global.requestQueue;
    let i, urlObj, url, userData;
    
    for(i in urls){
      urlObj    = typeof urls[i] === 'string' ? { url: urls[i] } : urls[i];
      url       = urlObj.url;
      userData  = urlObj.userData || { ...urlObj };
      await reqQueue.addRequest(new Apify.Request({ url, userData }));
      console.log(`[MATCHER] ${urls.length - i} Left. Add to Queue`, url, { userDataSize: Object.keys(userData).length });
    }
  }
  
  function clearText(text){
    return typeof text === 'string' ? text.trim().replace(/\s{2,}/g, ' ').replace(/(\r\n|\n|\r|(  ))/gm, '') : text;
  }
  
  function clearNum(num){
    return typeof num === 'string' ? parseFloat(num.replace(/(?!-)[^0-9.]/g, '')) : num;
  }
  
  function randomNum(start = 0, end = 1){
    return Math.floor(Math.random() * end) + start;
  }
  
  function trunc(str, length, isUrl, tail = ' ...'){
    if(!str instanceof String) return str;
    const newStr = isUrl ? encodeURI(str) : str;
    return length && newStr.length > length ? (newStr.substring(0, length) + tail) : newStr;
  }
  
  async function getSpreadsheet({ spreadsheetId, listId, max, start }, filterFn){
    // Generates url
    let url = [`https://spreadsheets.google.com/feeds/list/${spreadsheetId}/${listId}/public/values?alt=json`];
    start && url.push('start-index=' + start); max && url.push('max-results=' + max); url = url.join('&');
    // Fetches the json
    console.log('[MATCHER] Loading Spreadsheet', url);
    const result = await fetch(url).then(res => res.json());
    let entries = result.feed && result.feed.entry || [];
      
    return entries.reduce( (arr, entry) => {
      
      let newEntry = Object.keys(entry).reduce((obj, key) => {
        const val = entry[key]['$t'];
        if(!val || !~key.indexOf('gsx$')) return obj;
        
        const newKey = key.replace('gsx$', '').replace(/[-]/g, '');
        
        return Object.assign(obj, { [newKey]: val });
      }, {});
      
      !filterFn && arr.push(newEntry);
      
      newEntry = filterFn(newEntry);
      newEntry && arr.push(newEntry);
      
      return arr;
    }, []);
  }
  
  async function getExchangeRate(currency = 'EUR', symbols = 'USD', fixerKey = '2aec20cdd5d953fe6e52adc2ebb6de54'){
    const exchangeRates = {
      EUR: 1.15,
      RUB: 0.015,
      GBP: 1.28,
    }
    const url = `http://data.fixer.io/api/latest?access_key=${fixerKey}&base=${currency}&symbols=${symbols}`; console.log('[MATCHER] Loading Exchange Rate', url);
    return await fetch(url, { timeout: 5000 })
      .then( res => res.json() )
      .then( json => json.rates )
      .catch( err => {
        console.log(err);
        return { USD: exchangeRates[currency] }
      });
  }
}

module.exports = utils;