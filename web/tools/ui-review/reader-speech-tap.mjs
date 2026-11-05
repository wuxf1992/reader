import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
import {createReviewServer,BOOK_ID} from './server.mjs';
const server=createReviewServer({port:0}),origin=await server.listen(),results=[];
const output=new URL('../../../artifacts/ui-review/reader-speech-tap/',import.meta.url).pathname;
await mkdir(output,{recursive:true});
try{
 for(const [engine,type]of Object.entries({chromium,webkit})){
  const browser=await type.launch();
  try{for(const width of [390,1280]){
   const context=await browser.newContext({viewport:{width,height:844},hasTouch:width<700,isMobile:width<700,serviceWorkers:'block'});
   try{
    await context.route('https://wuxf.top/**',route=>route.abort());
    await context.addInitScript(mobile=>{
     Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[{voiceURI:'test',name:'测试中文',lang:'zh-CN',default:true}],addEventListener(){},removeEventListener(){},cancel(){},pause(){},resume(){},speak(){}}});
     window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
     if(mobile){const match=window.matchMedia.bind(window);window.matchMedia=query=>query==='(display-mode: standalone)'?{matches:true,media:query,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}}:match(query);}
    },width<700);
    const page=await context.newPage(),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/#/shelf');await page.getByText('更换服务地址',{exact:true}).click();
    await page.locator('input[type=url]').fill(origin);await page.locator('input[autocomplete=username]').fill('review');await page.locator('input[type=password]').fill('password12');await page.locator('button[type=submit]').click();
    await page.locator('.shelf-screen').waitFor();await page.evaluate(async()=>{window.readerApp.sync.stop();await window.readerApp.updateSettings({mode:'paged',autoCache:false,ttsEngine:'system'});});
    await page.addStyleTag({content:':root{--safe-top:47px;--safe-bottom:34px;}'});
    await page.evaluate(id=>{location.hash='#/book/'+id;},BOOK_ID);
    await page.waitForFunction(()=>Number(document.querySelector('.progress-scrubber')?.max)>1);
    const tap=async fraction=>{const b=await page.locator('book-content').boundingBox();await page.mouse.click(b.x+b.width*fraction,b.y+b.height/2);};
    await tap(.5);await page.getByRole('button',{name:'朗读',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'朗读',exact:true});await dialog.getByRole('button',{name:'从当前位置朗读',exact:true}).click();
    await dialog.getByRole('button',{name:'暂停朗读',exact:true}).waitFor();
    const layout=await dialog.evaluate(d=>{const bar=d.querySelector('.tts-bar'),controls=bar.querySelector('.tts-controls').getBoundingClientRect(),progress=bar.querySelector('.tts-progress').getBoundingClientRect(),box=bar.getBoundingClientRect(),start=d.querySelector('.speech-start').getBoundingClientRect();return{controls:controls.toJSON(),progress:progress.toJSON(),bar:box.toJSON(),start:start.toJSON(),buttons:[...bar.querySelectorAll('button')].map(b=>b.getBoundingClientRect().toJSON()),scrollWidth:d.scrollWidth,clientWidth:d.clientWidth};});
    await page.screenshot({path:output+`${engine}-${width}.png`});
    assert(layout.progress.top>=layout.controls.bottom-1,`${engine} ${width}: speech progress overlaps transport controls ${JSON.stringify(layout)}`);
    assert(layout.start.top>=layout.bar.bottom-1,'speech bar must not cover the start button/settings');
    assert(layout.buttons.every(b=>b.x>=layout.bar.x-1&&b.right<=layout.bar.right+1&&b.width>=43),'all speech buttons must fit and remain tappable');
    assert(layout.scrollWidth<=layout.clientWidth+1,'speech settings overflow horizontally');
    await dialog.getByRole('button',{name:'暂停朗读',exact:true}).click();await dialog.getByRole('button',{name:'继续朗读',exact:true}).click();await dialog.getByRole('button',{name:'停止朗读',exact:true}).click();await dialog.locator('.tts-bar').waitFor({state:'detached'});
    await dialog.getByRole('button',{name:'关闭',exact:true}).click();await dialog.waitFor({state:'detached'});
    const scrub=page.locator('.progress-scrubber'),before=await scrub.inputValue();
    await tap(.9);await page.waitForFunction(()=>document.querySelector('.reader-screen')?.dataset.chrome==='hidden');
    await page.waitForTimeout(150);assert.equal(await scrub.inputValue(),before,'first side tap dismisses controls without turning');
    await tap(.9);await page.waitForFunction(value=>document.querySelector('.progress-scrubber')?.value!==value,before);
    assert.deepEqual(errors,[]);results.push({engine,width,simulatedPwa:width<700,layout,controlsDismissBeforePageTurn:true,pauseResumeStop:true});console.log(`PASS ${engine} ${width}: speech layout/playback controls and dismiss-before-turn`);
   }finally{await context.close();}
  }}finally{await browser.close();}
 }
}finally{await server.close();await writeFile(output+'metrics.json',JSON.stringify(results,null,2));}
