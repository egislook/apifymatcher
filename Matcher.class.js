const puppeteer   = global.puppeteer || require(require.resolve('puppeteer'));
const proxyChain  = require('proxy-chain');
const fetch       = require('node-fetch');
const utils       = require('./utils.js');

/** TODO
 * 
 * Test url request queue initiator
 * Full Apify basic crawler wrapper
 * Multiple Step support per pageMatch
 * Request Counter, Pool (Puppeteer) Reinitiator for more proxies
 * 
 */
 
// Filters & builds request queue
// const requestQueue = await Apify.openRequestQueue();
// // Collects all tests from pageMatcher
// const tests = pageMatcher.filter(page => page.test).map(page => page.test);

// // Test urls only or normal list of urls specified in matcher
// urls = tests.length 
//   ? tests 
//   : urls.concat(pageMatcher.filter(page => page.url).map(({ url, userData }) => ({ url, userData })));

// await Promise.race([
//   page.goto(url).catch(e => void e),
//   new Promise(x => setTimeout(x, 20 * 1000))
// ]);

/** 
  Page Matcher automatic Apify Basic Crawler launcher / wrapper
  Sets and launches using variables (config, urls, pageMatcher)
*/

class Matcher{
  constructor(Apify, settings, requestQueue, pageMatcherData){
    this.Apify        = Apify;
    this.settings     = settings;
    this.requestQueue = requestQueue;
    this.pageMatcherData  = pageMatcherData;
    this.utils            = utils(Apify);
    
    // Matcher Settings
    this.delayExit = settings.matcher.delayExit;
    this.delayPage = settings.matcher.delayPage;
    this.debug     = settings.matcher.debug;
    this.Pool;
    this.Crawler;
    
    // Collects errored pages to object at counts the retries
    this.erroredRequests = {};
    this.initialRequestsAmount = 0;
    this.urlDisplayLength = 100;
    this.requestAmount = 0;
    this.requestWeight = 0;
  }
  
  
  /** Main methods
   */
  // Initiates puppeteer and creates pool of pages
  async pagePool(puppeteerConfig){
    puppeteerConfig = puppeteerConfig || this.settings.puppeteer;
    
    const delayTabClose = this.settings.matcher.delayTabClose || 120000;
    const maxTabs       = this.settings.crawler.maxConcurrency; 
    const randomNum     = this.utils.randomNum;
    const randomUA      = this.Apify.utils.getRandomUserAgent;
    
    let blockPulling = false;
    
    let browser = await launchBrowser(await this.getPuppetterConfig(puppeteerConfig), this.settings.matcher.delayBrowserClose || 240000, randomUA());
    
    let pages = await browser.pages();
        pages.forEach( remove );
        pages = [ await add() ];
    
    setInterval(reportPool.bind(this), this.settings.matcher.delayReport || 30000);
    
    async function reportPool(){
      const pageList = await browser.pages();
      const erroredRequestsLength = Object.keys(this.erroredRequests || {}).length;
      
      if(browser.closingTimeAt < new Date().getTime())
        blockPulling = 1;
      
      const timeoutForBrowserClose = (browser.closingTimeAt + ((this.settings.crawler.timout || 30000) * 2) ) < new Date().getTime();
        
      if((pageList.length === pages.length || timeoutForBrowserClose) && blockPulling){
        console.log('[MATCHER] Closing Browser | ' + maxTabs, { forced: timeoutForBrowserClose });
        pageList.forEach( remove );
        await new Promise(r => setTimeout(r, 2000));
        browser = await close();
        browser = await launchBrowser(await this.getPuppetterConfig(puppeteerConfig), this.settings.matcher.delayBrowserClose || 240000, randomUA());
        pages = await browser.pages();
        pages.forEach( remove );
        pages = [ await add() ];
        blockPulling = 0;
        this.requestAmount = 0;
        this.requestWeight = 2;
      }
      
      console.log(`
      Tabs ${pages.length} - ${pageList.length} - ${maxTabs}
      Requests ${this.initialRequestsAmount} ~ ${this.requestPendingCount()}
      ErroredRequests ${erroredRequestsLength}
      BlockedPolling ${blockPulling} ${browser.closingTimeAt - new Date().getTime()} ms
      `);
      
    }
    
    
    async function launchBrowser(cfg, delay, userAgent){
      console.log('[MATCHER] Launching Browser');
      const browser = await puppeteer.launch(cfg);
      userAgent && browser.userAgent(userAgent);
      // const browser  = instance.createIncognitoBrowserContext ? await instance.createIncognitoBrowserContext() : instance;
      browser.closingTimeAt = new Date().getTime() + (delay * 1.5);
      return browser;
    }
    
    async function pull(timeless){
      while(blockPulling){
        console.log('WAITING FOR UNBLOCKED PULLING');
        await new Promise( r => setTimeout(r, 5000));
      }
      
      if(pages.length)
        return pages.shift();
      
      return await add(timeless);
    }
    
    async function push(page){
      if(!page) return;
      if(blockPulling || await browser.pages().length < maxTabs)
        return remove(page);
      
      if(new Date().getTime() > page.closingTimeAt) return await remove(page);
      
      page.removeAllListeners('request');
      pages.push(page);
      this.debug && console.log(`[MATCHER] Tab Free - Now ${pages.length}`);
      return;
    }
    
    async function close(){
      pages = []; 
      await browser.close();
      return;
    }
    
    async function remove(page){
      if(!page) return;
      await page.goto('about:blank');
      await page.close();
      const pageList = await browser.pages();
      console.log(`[MATCHER] Tab Close - Now ${pageList.length}`);
    }
    
    async function add(timeless){
      const page = await browser.newPage();
      await page.setUserAgent(randomUA());
      page.closingTimeAt = new Date().getTime() + delayTabClose + randomNum(delayTabClose);
      page.browserClosingTimeAt = browser.closingTimeAt;
      const pageList = await browser.pages();
      console.log(`[MATCHER] Tab Open  - Now ${pageList.length}`);
      return page; //pages.push(page);
    }
    
    this.Pool = ({ pull, push, close, add, browser, remove });
    return browser;
  }
  
  // Default Matchers handleRequestFunction for apify basic crawler
  async handleRequest({ request }){
    const { url, userData, retryCount } = request;
    const { initial } = userData || {};
    let page;
    
    initial && this.initialRequestsAmount--;
    this.requestAmount++;
    this.requestWeight++;
    
    // console.log(`[MATCHER] Request ${this.requestWeight} Delay ${delayRequest} ms`)
    // await new Promise(r => setTimeout(r, delayRequest ));
    
    try{
      this.debug && console.time(`[MATCHER] Opened ${this.utils.trunc(url, this.urlDisplayLength, true)} in`);
    
      const pageMatchSettings = this.getPageMatchSettings(request) || {};
      const { err, msg, func, status } = pageMatchSettings;
      // These settings can be specified for every page or for pageMatcher
      const blockResources  = userData.blockResources !== undefined ? userData.blockResources : pageMatchSettings.blockResources;
      const noRedirects     = userData.noRedirects !== undefined    ? userData.noRedirects    : pageMatchSettings.noRedirects;
      const useFetch        = userData.useFetch !== undefined       ? userData.useFetch       : pageMatchSettings.useFetch;
      const clearCookies    = userData.clearCookies !== undefined   ? userData.clearCookies   : pageMatchSettings.clearCookies;
      
      if(err)
        return await this.handleFailedRequest({ request }, err, msg);
      
      if(status)
        return console.log(`[MATCHER] ${status} ${msg} ${this.utils.trunc(url, this.urlDisplayLength, true)}`);
      
      let result;
      switch(useFetch){
        
        // Use Fetcher for quick data
        case 'json':
        case 'text':
        case true:
          const json = await fetch(url).then(res => res[typeof useFetch === 'string' ? useFetch : 'json']());
          result = func ? await func({ page: { json }, request }) : json;
          
          this.requestAmount--;
          this.requestWeight = this.requestWeight - 2 > 0 && this.requestWeight - 2 || 0;
          this.debug && console.timeEnd(`[MATCHER] Opened ${this.utils.trunc(url, this.urlDisplayLength, true)} in`);
        break;
        
        // Use Puppetter or more complex tasks
        default:
          page = await this.Pool.pull();
          
          // Block images and fonts & hide webdrive
          // blockResources && await this.utils.shot(page);
          await this.filterRequests(page, { blockResources, noRedirects });
          await this.Apify.utils.puppeteer.hideWebDriver(page);
          
          // Clean cookies
          if(clearCookies){
            const cookies = await page.cookies(url);
            await page.deleteCookie(...cookies);
          }
          
          // Go to page
          this.debug && console.log(`[MATCHER] Opening ${this.utils.trunc(url, this.urlDisplayLength, true)}`);
          await page.goto(url, { 
            waitUntil: 'networkidle2',
            timeout: this.settings.crawler.timout || 30000
          });
          
          // Check autobot
          if(await page.$eval('body', body => ["с вашего IP-адреса", 'CAPTCHA'].find( str => !!~body.textContent.indexOf(str)) ))
            throw('CaptchaError')
            
          this.debug && console.timeEnd(`[MATCHER] Opened ${this.utils.trunc(url, this.urlDisplayLength, true)} in`);
          result = await func({ page, request, matcher: { settings: pageMatchSettings, addResult: this.pageMatcherResult.bind(this) } });
          // Reclaims request
          this.requestAmount--;
          this.requestWeight = this.requestWeight - 2 > 0 && this.requestWeight - 2 || 0;
          
          if(result && result.reclaim)
            throw({ name: 'ReclaimError', message: 'Page needs to be reclaimed due request', skipRetries: result.skipRetries, reasion: result.reclaim });
          
          // No result
          if(!result)
            return await this.handleFailedRequest({ request, page }, 'result_empty', 'Empty page result returned', true);
          
          // Error inside result
          if(result.error)
            return await this.handleFailedRequest({ request, page }, 'result_error', result.error, true);
          
          page = await this.Pool.push(page);
        break;
          
      }
      
      const delayRequest = this.delayPage * this.requestWeight;
      // Clomplete the request
      await this.pageMatcherResult(result, pageMatchSettings);
      console.log('[MATCHER] Request Next in', delayRequest, 'ms', this.requestWeight);
      await this.Apify.utils.sleep(delayRequest);
      return;
      
    } catch(err) {
      this.requestAmount--;
      this.requestWeight++;
      
      await this.Pool.remove(page);
      console.log(`[MATCHER]`, err, this.utils.trunc(url, this.urlDisplayLength, true));
      
      if(err === 'CaptchaError')
        throw('TimeoutError');
        
      if(this.settings.matcher.delayError){
        console.log(`[MATCHER] after Error Delay ${this.settings.matcher.delayError} ms`);
        await this.Apify.utils.sleep(this.settings.matcher.delayError);
      }
      
      if(!err.skipRetries){
        const retriesLeft = this.settings.crawler.maxRequestRetries - this.addErroredRequest(request, err);
        !(retriesLeft < 0) && console.log(`[MATCHER] Retries Left`, retriesLeft, url);
        if(retriesLeft < 0)
          return await this.handleFailedRequest({ request }, 'request_removed', err);
          
        initial && this.initialRequestsAmount++;
      }
      
      switch(err.name){
        case 'ApifyError':
        case 'TimeoutError':
          throw(err);
        case 'ReclaimError':
          throw('TimeoutError');
        default:
          return await this.handleFailedRequest({ request }, err.name ? err.name : 'error_cought', err);
      }
        
      
    }
  }
  
  // Default Matchers isFinishedFunction for apify basic crawler
  async isFinished(){
    if(!this.delayExit){
      // await this.Pool.close();
      return true;
    }
    
    // Delay exit
    // Sometimes we want to load data in async way not to block initial crawler loading
    console.log(`[MATHCER] Exit Delay ${this.delayExit}ms`);
    await new Promise(res => setTimeout(res, this.delayExit));
    this.delayExit = 0;
    return;
  }
  
  // Default Matchers handleFailedRequestFunction for apify basic crawler
  async handleFailedRequest({ request: { url, errorMessages }, page }, status = 'request_timeout', error, takeShot){
    const host  = url.match(/^https?\:\/\/([^\/?#]+)(?:[\/?#]|$)/i)[1];
    status      = `${status}__${host}__${new Date().getTime()}`;
    //await shot(page, host);
    page && takeShot && this.debug && await this.utils.shot(page, status);
    await this.Apify.setValue(status, { status, error, url });
    return;
  }
  
  
  /** Puppeteer "page" related methods
   */
  // Deals with different result types
  async pageMatcherResult(result, { template, skipUrls, limit, showSkip }){
    const { skip, urls, status } = result || {};
    
    // Add urls to queue
    if(!skipUrls && urls)
      await this.queueUrls(result.urls, this.requestQueue, limit);
    
    // Skip result
    if(skip || status === 'done')
      return showSkip && this.debug && console.log('[MATCHER] Skipping', result);
    
    if(status)
      this.debug && console.log('[MATCHER] Result', status);
    
    // Generate template
    if(template)
      result = template(result);
    
    // Adds result to Apify Store
    return await this.Apify.pushData(result);
  }
  
  // Collects Matcher settings for matching (url or matcherLabel) page
  getPageMatchSettings({ userData, url }){
    const { matcherLabel } = userData;
    
    let pageMatch = this.pageMatcherData.find(
      matcher => matcherLabel 
        ? matcher.label === matcherLabel 
        : matcher.url === url || matcher.match instanceof Array ? matcher.match.filter( m => url.includes(m) ).length : url.includes(matcher.match)
    );
    
    if(!pageMatch){
      pageMatch = this.pageMatcherData.find( matcher => 
        matcher.ignoreMatch === url || 
        matcher.ignoreMatch instanceof Array ? matcher.ignoreMatch.filter( m => url.includes(m) ).length : url.includes(matcher.ignoreMatch)
      )
      if(pageMatch)
        return { status: 'ignore_match', msg: 'ignoreMatch is matching the url' }
    }
    
    if(!pageMatch || !pageMatch.func)
      return { err: 'missing_page_setting', msg: 'Missing PageMatcher setting for this page' };
    
    return pageMatch;
  }
  
  // Filters all incoming requests after the page gets initiated
  async filterRequests(page, filters){
    const { noRedirects, blockResources } = filters;
    
    await page.setRequestInterception(noRedirects || !!blockResources);
    if(!blockResources) return;
    
    page.on('request', allow);
    
    const scriptTypes = [ 'script', 'other' ];
    const styleTypes  = [ 'image', 'media', 'font', 'texttrack', 'beacon', 'imageset', 'object', 'csp_report', 'stylesheet' ];
    const styleExts   = ['.jpg', 'jpeg', '.png', '.gif', '.css'];
    const scriptExts  = [ '.js' ];
    
    let types, exts;
    
    switch(blockResources){
      case 'style':
        types = styleTypes;
        exts  = styleExts;
      break;
      case 'script':
        types = scriptTypes;
        exts  = scriptExts;
      break;
      default:
        types = [ ...styleTypes, ...scriptTypes ];
        exts  = [ ...styleExts, ...scriptExts ];
      break;
    }
      
    
    function allow(req){
      // const isRedirect = req.isNavigationRequest() && req.redirectChain().length;
      const isResource = types.includes(req.resourceType()) || exts.includes(req.url());
      
      !isResource // (noRedirects && !isRedirect) 
        ? req.continue() && this.debug && console.log('[MATCHER] Alowed', req.resourceType(), req.url())
        : req.abort()
    }
    
  }
  
  // Adds urls to requestQueue
  async queueUrls(urls, reqQueue, limit, initial){
    if(typeof urls === 'function')
      urls = await urls();
    if(!urls || !urls.length) return this.debug && console.log(`[MATCHER] Queueing empty URLS`);
    
    if(limit)
      urls = urls.slice(0, limit);
      
    reqQueue = reqQueue || this.requestQueue || global.requestQueue;
    let i, urlObj, url, userData;
    let batch = 1, perBatch = 100, delayAfterBatch = 5000;
    
    console.log(`[MATCHER] Queuing ${urls.length} + ${this.requestPendingCount()}`);
    for(i in urls){
      
      urlObj    = typeof urls[i] === 'string' ? { url: urls[i] } : urls[i];
      url       = urlObj.url;
      userData  = urlObj.userData ? { ...urlObj.userData, initial } : { ...urlObj, initial };
      
      delete userData.reclaim;
      
      if(initial){
        delete userData.url;
        delete userData.urls;
      }
      
      await reqQueue.addRequest(new this.Apify.Request({ url, userData }));
      this.debug && console.log(`[MATCHER] Queued ${this.requestPendingCount()}`, this.utils.trunc(url, this.urlDisplayLength, true), { userDataSize: Object.keys(userData).length });
      userData.initial && this.initialRequestsAmount++;
      
      if( (perBatch * batch) < i ){
        console.log(`[MATCHER] Queued ${perBatch * batch} / ${urls.length}`);
        await this.Apify.utils.sleep(delayAfterBatch);
        batch++;
      }
    }
  }
  
  /**
   * Request tracker functions
   */
  addErroredRequest(request, err){
    const { url } = request;
    
    if(this.erroredRequests[url]){
      this.erroredRequests[url].retries = this.erroredRequests[url].retries + 1;
      return this.erroredRequests[url].retries
    }
    
    this.erroredRequests[url] = {
      retries: 1,
      url,
      err,
    }
    
    return 1;
  }
  
  /** Helpers
   */
  requestPendingCount(rq, cr){
    rq = rq || this.requestQueue;
    cr = cr || this.Crawler;
    if(rq.pendingCount) return rq.pendingCount;
    const count = rq.requestsCache && rq.requestsCache.listDictionary.linkedList.length || 0;
    if(!cr) return count;
    return count - cr.handledRequestsCount;
  }
  
  async getProxyUrl(){
    let proxyUrl = `http://auto:${process.env.APIFY_PROXY_PASSWORD}@proxy.apify.com:8000`;
    proxyUrl = await proxyChain.anonymizeProxy(proxyUrl);
    console.log(`[MATCHER] Proxy ${proxyUrl}`);
    return proxyUrl;
  }
  
  async getPuppetterConfig({ useChrome, useApifyProxy, args }){
    args = args || ['--no-sandbox', '--deterministic-fetch', '--unlimited-storage', '--full-memory-crash-report', '--disable-dev-shm-usage'];
    useApifyProxy && args.push(`--proxy-server=${await this.getProxyUrl()}`);
    
    return {
      headless: true,
      useChrome: useChrome !== undefined ? useChrome : true,
      userAgent: this.Apify.utils.getRandomUserAgent(),
      ignoreHTTPSErrors: true,
      useApifyProxy: useApifyProxy,
      args
    }
  }
  
  cleanExit(cb){
    cb = cb || (() => {});
    process.on('cleanup', cb);
    process.on('exit', () => process.emit('cleanup') );
    process.on('SIGINT', () => { process.emit('cleanup') } );
    process.on('uncaughtException', (e) => { process.emit('cleanup') });
  }
}

module.exports = Matcher;