import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
import {createReviewServer,BOOK_ID} from './server.mjs';
const server=createReviewServer({port:0}),origin=await server.listen(),results=[];
const output=new URL('../../../artifacts/ui-review/reader-sheet-scroll/',import.meta.url).pathname;
await mkdir(output,{recursive:true});
const frame=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const position=page=>page.evaluate(()=>({top:document.querySelector('book-content').scrollTop,page:document.querySelector('.progress-scrubber').value}));
async function touch(page,cdp,x,y,dy){
 if(cdp){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=5;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+dy*i/5}]});await page.waitForTimeout(20);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 else await page.evaluate(({x,y,dy})=>{const target=document.elementFromPoint(x,y);for(const [type,next]of [['touchstart',y],['touchmove',y+dy]]){const event=new Event(type,{bubbles:true,cancelable:true});Object.assign(event,{touches:[{clientX:x,clientY:next}]});target.dispatchEvent(event);if(type==='touchmove'&&!event.defaultPrevented)throw Error('outward touch was not contained');}},{x,y,dy});
 await frame(page);
}
try{for(const [engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch();
 try{for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:844},hasTouch:width<700,isMobile:width<700,serviceWorkers:'block'});
  try{
   await context.route('https://wuxf.top/**',route=>route.abort());
   await context.addInitScript(()=>{Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[{voiceURI:'review',name:'中文',lang:'zh-CN',default:true}],addEventListener(){},removeEventListener(){},cancel(){},pause(){},resume(){},speak(){}}});window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};});
   const page=await context.newPage(),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
   await page.goto(origin+'/#/shelf');await page.getByText('更换服务地址',{exact:true}).click();await page.locator('input[type=url]').fill(origin);await page.locator('input[autocomplete=username]').fill('review');await page.locator('input[type=password]').fill('password12');await page.locator('button[type=submit]').click();await page.locator('.shelf-screen').waitFor();
   await page.evaluate(async()=>{window.readerApp.sync.stop();await window.readerApp.updateSettings({mode:'scroll',autoCache:false});});await page.evaluate(id=>{location.hash='#/book/'+id;},BOOK_ID);await page.locator('book-content .book-flow p').first().waitFor();
   const cdp=engine==='chromium'&&width===390?await context.newCDPSession(page):null;
   for(const section of ['字体与间距','朗读']){
    if(await page.locator('.reader-screen').getAttribute('data-chrome')==='hidden'){const b=await page.locator('book-content').boundingBox();await page.mouse.click(b.x+b.width/2,b.y+b.height/2);}
    await page.getByRole('button',{name:section==='朗读'?'朗读':'设置',exact:true}).click();
    if(section!=='朗读')await page.getByRole('button',{name:section,exact:true}).click();
    const dialog=page.getByRole('dialog',{name:section,exact:true}),body=dialog.locator('.sheet-body');await dialog.waitFor();await frame(page);
    const behind=await position(page),maximum=await body.evaluate(b=>b.scrollHeight-b.clientHeight);
    for(const edge of ['top','bottom']){
     await body.evaluate((b,edge)=>{b.scrollTop=edge==='top'?0:b.scrollHeight;},edge);await frame(page);const b=await body.boundingBox(),x=b.x+b.width-8,y=b.y+b.height/2,dy=edge==='top'?90:-90;
     if(engine==='webkit'&&width<700)await page.evaluate(({x,y,dy})=>{const event=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-dy*8});document.elementFromPoint(x,y).dispatchEvent(event);if(!event.defaultPrevented)throw Error('outward wheel was not contained');},{x,y,dy});
     else{await page.mouse.move(x,y);await page.mouse.wheel(0,-dy*8);}
     await frame(page);assert.deepEqual(await position(page),behind,'wheel scrolls the book behind settings');
     await touch(page,cdp,x,y,dy);assert.deepEqual(await position(page),behind,'touch scrolls the book behind settings');
    }
    if(cdp&&maximum>50){await body.evaluate(b=>{b.scrollTop=0;});await frame(page);const b=await body.boundingBox();await touch(page,cdp,b.x+b.width-8,b.y+b.height/2,-70);assert((await body.evaluate(b=>b.scrollTop))>0,'long sheet body must still scroll');assert.deepEqual(await position(page),behind);}
    const slider=dialog.locator('input[type=range]').first();await slider.scrollIntoViewIfNeeded();const old=await slider.inputValue(),track=await slider.boundingBox(),y=track.y+track.height/2;
    if(cdp){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:track.x+track.width*.2,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:track.x+track.width*.7,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
    else{await page.mouse.move(track.x+track.width*.2,y);await page.mouse.down();await page.mouse.move(track.x+track.width*.7,y,{steps:5});await page.mouse.up();}
    assert.notEqual(await slider.inputValue(),old,'horizontal settings slider must remain usable');
    await page.screenshot({path:output+`${engine}-${width}-${section}.png`});
    if(cdp){const close=await dialog.getByRole('button',{name:'关闭',exact:true}).boundingBox(),x=close.x+close.width/2,y=close.y+close.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+1,y:y+2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
    else await dialog.getByRole('button',{name:'关闭',exact:true}).click();
    await dialog.waitFor({state:'detached'});results.push({engine,width,section,maximum,backgroundPreserved:true,nativeTouch:!!cdp});
   }
   assert.deepEqual(errors.filter(error=>error!=='ResizeObserver loop completed with undelivered notifications.'),[]);console.log(`PASS ${engine} ${width}: font/speech short sheets and both scroll edges remain isolated`);
  }finally{await context.close();}
 }}finally{await browser.close();}
}}finally{await server.close();await writeFile(output+'metrics.json',JSON.stringify(results,null,2));}
