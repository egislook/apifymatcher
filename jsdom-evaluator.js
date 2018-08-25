const jsdom       = require('jsdom');

process.on('uncaughtException', error => {
  process.send({ error });
});
process.on('disconnect', process.exit);

process.on('message', message => {
  getDom(message).then(({ url, result }) => {
    console.log('DONE', url);
    process.send({ url, result });
  });
});

const JSDOM           = jsdom.JSDOM;
const virtualConsole  = new jsdom.VirtualConsole();
const cookieJar       = new jsdom.CookieJar();

process.setMaxListeners(Infinity);


async function getDom({ disableJs, blockResources, url, wait, proxy, userAgent, func, userData, custom }){
  // console.log('processing', url);
  func = func && new Function('return ' + func)();
  // virtualConsole.sendTo(console, { omitJSDOMErrors: true });

  const options = {
    resources: blockResources !== true && jsdomResources({ disableJs, blockResources, url, userAgent, proxy }), //|| 'usable',
    runScripts: wait && 'dangerously' || undefined,
    pretendToBeVisual: true,
    beforeParse: jsdomBeforeParse || (() => {}),
    cookieJar,
    virtualConsole,
  }
  
  const evaluate = function(fn, args){ return fn(dom, args) }
  
  let dom = await JSDOM.fromURL(url, options)
  
  if(wait)
    dom = await jsdomWaitForXhr(dom, wait);
  
  const result = func 
    ? await func({ page: { dom, evaluate: evaluate.bind(dom) }, request: { userData, url }, custom }) 
    : dom && dom.window && dom.window.body.innerHTML;
  
  return { result, url };
}
  
function jsdomBeforeParse(window){
  window.xhr      = [];
  window.xhrLast  = new Date().getTime() + 2000;
  window.done     = false;
  (function(open) {
    window.XMLHttpRequest.prototype.open = function(method, url, async, user, pass){
        this.addEventListener('readystatechange', () => {
          if(window.done) return this.abort();
          window.xhrLast = new Date().getTime();
          if(this.readyState === 4)
            window.xhr.push({
              state: this.readyState, 
              status: this.status, 
              text: this.responseText, 
              type: this.getResponseHeader('content-type'),
              url:  this.responseURL,
            });
        }, false);
        open.call(this, method, url, async, user, pass);
    };
  })(window.XMLHttpRequest.prototype.open);
}

function jsdomWaitForXhr(dom, wait = 0){
  let type, tick = 30, times, start;
  if(typeof wait === 'number'){
    start = new Date().getTime();
  } else if(~wait.indexOf('domchanged')){
    type = 'domchanged';
    times = parseInt(wait.replace('domchanged', '')) || 1;
    wait = 2000;
  } else if(~wait.indexOf('networkidle')){
    type = 'networkidle';
    times = parseInt(wait.replace('networkidle', '')) || 0;
    wait = 1000;
  }
    
  return new Promise( resolve => {
    // console.log(dom.window.document.body.textContent.trim().substring(0, 200));
    if(!wait) return resolve(dom);
    
    dom.window.domLength = dom.window.document.body.textContent.trim().length;
    
    const interval = setInterval(() => {
      tick--; if(tick < 1) return done();
      
      switch(type){
        
        case 'domchanged':
          const length = dom.window.document.body.textContent.trim();
          if(dom.window.domLength === length ) return;
          dom.window.domLength = length;
          if(times > 1){ times--; return; }
        break;
        
        case 'networkidle':
          if(new Date().getTime() - dom.window.xhrLast < wait) return;
          if(times > 1){ times--; return; }
        break;
        
        default:
          if(new Date().getTime() < (start + wait)) return;
      }
        
      return done();
    }, wait / 4);
    
    function done(){
      clearInterval(interval);
      dom.window.done = true;
      try{ dom.window.stop() } catch(err){}
      return resolve(dom);
    }
  })
}

function jsdomResources({ url, blockResources, disableJs, userAgent, proxy }){
  
  class CustomResourceLoader extends jsdom.ResourceLoader {
    fetch(url, options){
      const { disableJs, blockResources, hostname } = this.fetchConfig;
      
      if((blockResources === 'style') && ~url.indexOf('.css'))
        return Promise.resolve(null);
      
      if((blockResources === 'script' || disableJs) && ~url.indexOf('.js'))
        return Promise.resolve(null);
        
      if((blockResources === 'external') && !~url.indexOf(hostname))
        return Promise.resolve(null);
      // console.log(url);
      // Override the contents of this script to do something unusual.
      // if (url === "https://example.com/some-specific-script.js") {
      //   return Buffer.from("window.someGlobal = 5;");
      // }
  
      return super.fetch(url, options);
    }
  }
  
  const resources = new CustomResourceLoader( { userAgent, proxy, strictSSL: false });
  resources.fetchConfig = { blockResources, disableJs, hostname: url.split('/')[2] };
  return resources;
}