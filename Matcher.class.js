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
  }
  
  
  /** Main methods
   */
  // Initiates puppeteer and creates pool of pages
  async pagePool(puppeteerConfig){
    puppeteerConfig = puppeteerConfig || this.settings.puppeteer;
    let max = 10;
    const instance = await puppeteer.launch(await this.getPuppetterConfig(puppeteerConfig));
    const browser  = instance.createIncognitoBrowserContext ? await instance.createIncognitoBrowserContext() : instance;
    // this.cleanExit( async () => {
    //   console.log('[MATCHER] Exit');
    //   await browser.close();
    // });
    const pages = [ await add() ];
    
    async function pull(){
      return pages.length ? pages.pop() : await add();
    }
    
    setInterval(async function(){
      const pageList = await browser.pages();
      const erroredRequestsLength = Object.keys(this.erroredRequests).length;
      console.log(`[MATCHER] Free Tabs ${pages.length} / ${pageList.length}${erroredRequestsLength && ', ErroredRequests ' + erroredRequestsLength}`);
    }, 60000);
    
    async function push(page){
      if(!page) return;
      //await page.goto('about:blank');
      page.removeAllListeners('request');
      pages.push(page);
      this.debug && console.log(`[MATCHER] Free Tabs ${pages.length}`);
      return;
    }
    
    async function close(){
      return await browser.close();
    }
    
    async function remove(page){
      page && await page.close();
      const pageList = await browser.pages();
      console.log(`[MATCHER] Left Tabs ${pageList.length}`);
    }
    
    async function add(){
      const page = await browser.newPage();
      const pageList = await browser.pages();
      console.log(`[MATCHER] Open Tabs ${pageList.length}`);
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
    
    initial
      ? console.log('[MATCHER] Initial Left', this.initialRequestsAmount-- )
      : this.requestPendingCount() % 10 && console.log(`[MATCHER] Overall Left ${this.requestPendingCount()}`);
    
    try{
      this.debug && console.time(`[MATCHER] Opened ${url} in`);
    
      const pageMatchSettings = this.getPageMatchSettings(request) || {};
      const { err, msg, func } = pageMatchSettings;
      // These settings can be specified for every page or for pageMatcher
      const blockResources  = userData.blockResources !== undefined ? userData.blockResources : pageMatchSettings.blockResources;
      const noRedirects     = userData.noRedirects !== undefined    ? userData.noRedirects    : pageMatchSettings.noRedirects;
      const useFetch        = userData.useFetch !== undefined       ? userData.useFetch       : pageMatchSettings.useFetch;
      const clearCookies    = userData.clearCookies !== undefined   ? userData.clearCookies   : pageMatchSettings.clearCookies;
      
      if(err) 
        return await this.handleFailedRequest({ request }, err, msg);
      
      let result;
      switch(useFetch){
        
        // Use Fetcher for quick data
        case 'json':
        case 'text':
        case true:
          const json = await fetch(url).then(res => res[typeof useFetch === 'string' ? useFetch : 'json']());
          result = func ? await func({ page: { json }, request }) : json;
          
          this.debug && console.timeEnd(`[MATCHER] Opened ${url} in`);
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
          this.debug && console.log(`[MATCHER] Opening ${url}...`);
          await page.goto(url, { 
            waitUntil: 'networkidle2',
            timeout: this.settings.crawler.timout || 30000
          });
            
          this.debug && console.timeEnd(`[MATCHER] Opened ${url} in`);
          result = await func({ page, request });
          
          // No result
          if(!result)
            return await this.handleFailedRequest({ request, page }, 'result_empty', 'Empty page result returned', true);
            
          // Error inside result
          if(result.error)
            return await this.handleFailedRequest({ request, page }, 'result_error', result.error, true);
          
          // Reclaims request
          // if(result.reclaim && retryCount < this.settings.crawler.maxRequestRetries){
          //   await page.goto(url, { waitUntil: 'networkidle2' });
          //   this.debug && console.log(`[MATCHER] Reclaimed ${url}`);
          //   return;
          // }
          
          page = await this.Pool.push(page);
        break;
          
      }
      
      await this.pageMatcherResult(result, pageMatchSettings);
      
      // this.debug && console.log(result);
      // try{ } catch(err) { this.debug && console.log(err) }
      this.delayPage && await this.Apify.utils.sleep(this.delayPage);
      return;
      
    } catch(err) {
      
      await this.Pool.remove(page);
      console.log(`[MATCHER] Error ${url}`, err);
      console.log(`[MATCHER] Page Closed`, url);
      if(this.settings.matcher.delayError){
        console.log(`[MATCHER] after Error Delay ${this.settings.matcher.delayError} ms`);
        await this.Apify.utils.sleep(this.settings.matcher.delayError);
      }
      
      const retriesLeft = this.settings.crawler.maxRequestRetries - this.addErroredRequest(request, err);
      !(retriesLeft < 0) && console.log(`[MATCHER] Retries Left`, retriesLeft, url);
      if(retriesLeft < 0)
        return await this.handleFailedRequest({ request }, 'request_removed', err);
        
      initial && this.initialRequestsAmount++;
      
      switch(err.name){
        case 'ApifyError':
        case 'TimeoutError':
          throw(err);
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
    await this.Apify.setValue(status, { status, error: errorMessages && errorMessages.join(' ') || error, url });
    return;
  }
  
  
  /** Puppeteer "page" related methods
   */
  // Deals with different result types
  async pageMatcherResult(result, { template, skipUrls, limit, showSkip }){
    const { skip, urls } = result || {};
    
    // Add urls to queue
    if(!skipUrls && urls)
      await this.queueUrls(result.urls, this.requestQueue, limit);
    
    // Skip result
    if(skip)
      return showSkip && this.debug && console.log('[MATCHER] Skipping', result);
    
    // Generate template
    if(template)
      result = template(result);
    
    // Adds result to Apify Store
    return await this.Apify.pushData(result);
  }
  
  // Collects Matcher settings for matching (url or matcherLabel) page
  getPageMatchSettings({ userData, url }){
    const { matcherLabel } = userData;
    
    const pageMatch = this.pageMatcherData.find(
      matcher => matcherLabel 
        ? matcher.label === matcherLabel 
        : matcher.url === url || matcher.match instanceof Array ? matcher.match.filter( m => url.includes(m) ).length : url.includes(matcher.match)
    );
    
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
    
    console.log(`[MATCHER] Queuing ${urls.length}`);
    for(i in urls){
      
      urlObj    = typeof urls[i] === 'string' ? { url: urls[i] } : urls[i];
      url       = urlObj.url;
      userData  = urlObj.userData ? { ...urlObj.userData, initial } : { ...urlObj, initial };
      
      if(initial){
        delete userData.url;
        delete userData.urls;
      }
      
      await reqQueue.addRequest(new this.Apify.Request({ url, userData }));
      this.debug && console.log(`[MATCHER] Queued ${this.requestPendingCount()}`, url, { userDataSize: Object.keys(userData).length });
      userData.initial && this.initialRequestsAmount++;
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
    const count = rq.requestsCache.listDictionary.linkedList.length;
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
    args = args || ['--no-sandbox', '--deterministic-fetch'];
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