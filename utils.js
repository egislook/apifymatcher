const fetch       = require('node-fetch');


function utils(Apify){
  Apify = Apify || global.Apify;
  
  return {
    shot,
    clearText,
    clearNum,
    getSpreadsheet,
    getExchangeRate
  }
  
  async function shot(p, h){
    h = h || 'local';
    const name = `shot__${h}_${new Date().getTime()}.png`;
    await Apify.setValue(name, await p.screenshot({ fullPage: true }), { contentType: 'image/png' });
    console.log('[MATCHER] Screenshot', name);
  }
  
  function clearText(text){
    return typeof text === 'string' ? text.trim().replace(/\s{2,}/g, ' ').replace(/(\r\n|\n|\r|(  ))/gm, '') : text;
  }
  
  function clearNum(num){
    return typeof num === 'string' ? parseFloat(num.replace(/(?!-)[^0-9.]/g, '')) : num;
  }
  
  async function getSpreadsheet({ spreadsheetId, listId, limit, max, start }, filter){
    limit = limit || 0;
    
    // Generates url
    let url = [`https://spreadsheets.google.com/feeds/list/${spreadsheetId}/${listId}/public/values?alt=json`];
    start && url.push('start-index=' + start); max && url.push('max-results=' + max); url = url.join('&');
    // Fetches the json
    console.log('[MATCHER] Loading Spreadsheet', url);
    const result = await fetch(url).then(res => res.json());
    let entries = result.feed && result.feed.entry || [];
    
    if(limit)
      entries = entries.slice(0, limit);
      
    return entries.reduce( (arr, entry) => {
      
      let newEntry = Object.keys(entry).reduce((obj, key) => {
        const val = entry[key]['$t'];
        if(!val || !~key.indexOf('gsx$')) return obj;
        
        const newKey = key.replace('gsx$', '').replace(/[-]/g, '');
        
        return Object.assign(obj, { [newKey]: val });
      }, {});
      
      !filter && arr.push(newEntry);
      
      newEntry = filter(newEntry);
      newEntry && arr.push(newEntry);
      
      return arr;
    }, []);
  }
  
  async function getExchangeRate(currency = 'EUR', symbols = 'USD', fixerKey = '2aec20cdd5d953fe6e52adc2ebb6de54'){
    const url = `http://data.fixer.io/api/latest?access_key=${fixerKey}&base=${currency}&symbols=${symbols}`; console.log('[MATCHER] Loading Exchange Rate', url);
    return await fetch(url)
      .then( res => res.json() )
      .then( json => json.rates );
  }
}

module.exports = utils;