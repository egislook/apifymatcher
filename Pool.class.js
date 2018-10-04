const puppeteer   = global.puppeteer || require(require.resolve('puppeteer'));
const randomUA    = require('random-fake-useragent').getRandom;
const proxyChain  = require('proxy-chain');


const { randomNum, wait } = require('./utils.js')();

class Pool{
  constructor(config = {}){
    
    // configs
    this.debug = config.debug !== undefined ? config.debug : true;
    this.config = {
      delay:              config.delay            || 240000,
      maxConcurrency:     config.maxConcurrency   || 5,
      delayTabClose:      config.delayTabClose    || 120000,
      delayReport:        config.delayReport      || 30000,
      delayPage:          config.delayPage        || 1000,
      delayTabNoResponse: config.timeout          || 30000,
      requestMaxWeight:   config.requestMaxWeight || 50,
      
      // Apify configs
      useApifyProxy:        config.useApifyProxy        !== undefined ? config.useApifyProxy        : true,
      useApifyProxySession: config.useApifyProxySession !== undefined ? config.useApifyProxySession : true,
    };
    
    //proxy stuff
    // this.proxy          = this.getProxyUrl({ session: this.settings.puppeteer.session });
    
    // Page managing vars
    this.blockPulling   = false;
    this.requestWeight  = 0;
    this.pages          = [];
    this.JSDOMRequests  = 0;
    
    // Async vars
    this.proxy;
    this.browser;
    
  }
  
  // Getters
  get browserClosingTimeAt(){ return new Date().getTime() + (this.config.delay * 1.5) }
  get delayRequest(){ return this.config.delayPage * this.requestWeight }
  get randomUserAgent() { return randomUA() }
  get timeoutForBrowser() { return this.browser && (this.browser.closingTimeAt + ((this.config.delayTabNoResponse || 30000) * 2)) < new Date().getTime() || true }
  get puppeteerConfig(){ 
    const args = ['--no-sandbox', '--deterministic-fetch', '--unlimited-storage', '--disable-dev-shm-usage', '--disable-setuid-sandbox', '--disable-gpu'];
    // this.proxy && args.push(`--proxy-server=${this.proxy}`);
    
    return {
      headless: true,
      useChrome: false,
      userAgent: this.randomUserAgent,
      ignoreHTTPSErrors: true,
      args
    }
  }
  
  async pageListLength(){
    if(!this.browser) return 0;
    const pages = await this.browser.pages();
    return pages.length;
  }
  
  async closeAllPages(){
    const pages = await this.browser.pages();
    for(let i in pages){
      await this.remove(pages[i])
    }
    this.pages = [];
  }
  
  // Setters
  
  // Methods
  
  // Init Pool
  async run(){
    // this.browser = await this.start();
    this.blockPulling = 1;
    await this.start();
    // this.cycle();
    this.cycleInterval = setInterval(this.cycle.bind(this), this.config.delayReport);
    return this.browser;
  }
  
  async stop(){
    clearInterval(this.cycleInterval);
    await this.close();
    return;
  }
  
  async cycle() {
    if(this.browser && this.browser.closingTimeAt < new Date().getTime())
      this.blockPulling = 1;
    
    // const erroredRequestsLength = Object.keys(this.erroredRequests || {}).length;
    const pageListLength = await this.pageListLength();

    if((pageListLength === this.pages.length || this.timeoutForBrowser) && this.blockPulling) {
      console.log('[MATCHER] Closing Browser | ' + this.config.maxConcurrency, { forced: this.timeoutForBrowser });
      await this.start();
    }

    console.log(`
      Tabs ${this.pages.length} - ${pageListLength} - ${this.config.maxConcurrency} - JSDOM ${this.JSDOMRequests}
      Delay ${this.delayRequest}
      BlockedPolling(${this.blockPulling}) in ${this.browser.closingTimeAt - new Date().getTime()}ms
      `);

  }
  
  // Starts the browser
  async start() {
    //this.proxy = await this.getProxyUrl({ session: this.settings.puppeteer.session });
    //this.startJSDOM();
    await this.close();
    
    this.debug && console.log('[MATCHER] Launching Browser');
    // if(this.config.useApifyProxy)
    //   this.proxy = await this.getApifyProxyUrl(this.config.useApifyProxySession);
    
    this.browser = await puppeteer.launch(this.puppeteerConfig);
    await this.browser.userAgent(this.randomUserAgent);
    // const browser  = instance.createIncognitoBrowserContext ? await instance.createIncognitoBrowserContext() : instance;
    this.browser.closingTimeAt = this.browserClosingTimeAt;
    await this.closeAllPages();
    
    this.requestWeight  = this.requestWeight > this.requestMaxWeight ? this.requestMaxWeight : this.requestWeight;
    this.blockPulling   = 0;
    
    return this.browser;
  }
  
  // Closes the browser
  async close(){
    if(!this.browser)
      return;
    this.pages = [];
    await this.closeAllPages();
    await this.browser.close();
    return;
  }
  
  // Gets the page from pool or if pool is empty it creates new page.
  async pull() {
    while(this.blockPulling) {
      this.requestWeight++;
      this.debug && console.log('WAITING FOR UNBLOCKED PULLING');
      await wait(this.delayRequest);
    }

    if(this.pages.length)
      return this.pages.shift();

    return await this.add();
  }
  
  // Gives back the borrowed page. If browser or page timed out it removes the page.
  async push(page) {
    if(!page) return;
    
    if(this.blockPulling || await this.pageListLength() < this.config.maxConcurrency)
      return this.remove(page);

    if(new Date().getTime() > page.closingTimeAt) 
      return await this.remove(page);

    page.removeAllListeners('request');
    this.pages.push(page);
    this.debug && console.log(`[MATCHER] Tab Free - Now ${this.pages.length}`);
    return;
  }
  
  // Removes page from scope
  async remove(page) {
    if (!page) return;
    page.removeAllListeners('request');
    await page.goto('about:blank');
    await page.close();
    this.debug && console.log(`[MATCHER] Tab Close - Now ${await this.pageListLength()}`);
  }

  // Adds the page to scope. Adds timeouts and userAgent to its instant and returns it.
  async add(timeless) {
    const page = await this.browser.newPage();
    await page.setUserAgent(this.randomUserAgent);
    // page.on('console', (log) => console[log._type](log._text));
    page.closingTimeAt = new Date().getTime() + this.config.delayTabClose + randomNum(this.config.delayTabClose);
    page.browserClosingTimeAt = this.browser.closingTimeAt;
    this.debug && console.log(`[MATCHER] Tab Open  - Now ${await this.pageListLength()}`);
    return page; //pages.push(page);
  }
  
  async getApifyProxyUrl({ session }){
    const sessionName = session ? `,session-${randomNum(10, 5000)}` : '';
    let proxyUrl = `http://${process.env.APIFY_PROXY_USERNAME || 'auto'}${sessionName}:${process.env.APIFY_PROXY_PASSWORD}@proxy.apify.com:8000`;
    proxyUrl = await proxyChain.anonymizeProxy(proxyUrl);
    console.log(`[MATCHER] Proxy ${proxyUrl}${sessionName}`);
    return proxyUrl;
  }
  
}

module.exports = Pool;