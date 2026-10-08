// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReaderView } from '../src/ui/reader-view.ts';
import type { BookDoc } from '../src/formats/types.ts';

let resize: () => void;
const readers: ReaderView[] = [];
const rangeDescriptors = ['getClientRects','getBoundingClientRect'].map(name => [name,Object.getOwnPropertyDescriptor(Range.prototype,name)] as const);
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {} disconnect() {} unobserve() {}
  });
});
afterEach(() => {
  readers.splice(0).forEach(view => view.dispose());
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  for (const [name,descriptor] of rangeDescriptors) {
    if (descriptor) Object.defineProperty(Range.prototype,name,descriptor);
    else Reflect.deleteProperty(Range.prototype,name);
  }
});
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

/** Supply line geometry while letting ReaderView own all pagination and state changes. */
async function chapter(count = 70) {
  const container = document.createElement('div'); document.body.append(container);
  const doc: BookDoc = {
    format: 'txt', layout: 'reflowable', render: 'reflowable', direction: 'ltr',
    sections: [{id:'chapter',label:'Chapter',depth:0,plainText:true,
      html:Array.from({length:count},(_,i)=>`正文第 ${i} 段`).join('\n\n')}],
    toc:[],styles:[],resources:new Map(),orderedByBook:true,
  };
  const view = new ReaderView({container,doc}); readers.push(view);
  const host = view.elementHost;
  let height = 300;
  const spacing = () => 60 * (Number(container.style.getPropertyValue('--reader-font-scale')) || 1);
  const rect = (top: number, tall = 25) => new DOMRect(0,top,200,tall);
  const contentHeight = () => (count + 1) * spacing() + 30;
  Object.defineProperties(host, {
    clientHeight:{get:()=>height},clientWidth:{get:()=>390},
    scrollHeight:{get:()=>contentHeight() + (parseFloat(host.flow.style.paddingBottom)||0)},
  });
  Object.defineProperties(host.flow, {
    clientWidth:{get:()=>390},offsetHeight:{get:()=>host.scrollHeight},
  });
  vi.spyOn(host,'getBoundingClientRect').mockImplementation(()=>rect(0,height));
  vi.spyOn(host.flow,'getBoundingClientRect').mockImplementation(()=>rect(-host.scrollTop,host.scrollHeight));
  const rangeRect = (range: Range) => {
    const parent = range.startContainer.nodeType===Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer as Element;
    const paragraph = parent?.textContent?.match(/正文第 (\d+) 段/);
    const index = paragraph ? Number(paragraph[1]) + 1 : 0;
    return rect(20 + Math.max(0,index) * spacing() - host.scrollTop);
  };
  // jsdom does not provide these layout APIs.
  Object.defineProperty(Range.prototype,'getClientRects',{configurable:true,writable:true,value:function(this:Range){return [rangeRect(this)];}});
  Object.defineProperty(Range.prototype,'getBoundingClientRect',{configurable:true,writable:true,value:function(this:Range){return rangeRect(this);}});
  view.applySettings({mode:'paged',pageAnimation:'none'}); await view.open(0); await frame();
  return {view,host,setHeight:(next:number)=>{height=next;resize();}};
}

it('keeps the same text after repeated font-size round trips',async()=>{
  const {view}=await chapter();await view.seekPageInChapter(6);
  const before=view.position().pageInChapter;
  for(let i=0;i<4;i++){
    view.applySettings({fontScale:1.35});await frame();
    view.applySettings({fontScale:1});await frame();
  }
  expect(view.position().pageInChapter).toBe(before);
});
it('keeps the same text after repeated viewport round trips',async()=>{
  const {view,setHeight}=await chapter();await view.seekPageInChapter(6);
  const before=view.position().pageInChapter;
  for(let i=0;i<4;i++){setHeight(200);setHeight(300);}
  expect(view.position().pageInChapter).toBe(before);
});
it('restores the same page from a rounded locator in a long chapter',async()=>{
  const {view}=await chapter(1100);await view.seekPageInChapter(1);
  const before=view.position();await view.openLocator(before.locator);
  expect(view.position().pageInChapter).toBe(before.pageInChapter);
});
it('stops an in-flight animation when the user disables it',async()=>{
  const {view,host}=await chapter();view.applySettings({pageAnimation:'slide'});await frame();
  view.animatePage('next');expect(host.hasAttribute('data-animating')).toBe(true);
  view.applySettings({pageAnimation:'none'});
  expect(host.hasAttribute('data-animating')).toBe(false);
});

it('fades the outgoing page without adding another flow to the live scroller',async()=>{
  const {view,host}=await chapter();view.applySettings({pageAnimation:'fade'});await frame();
  await view.seekPageInChapter(3);const oldTop=host.scrollTop;
  view.preparePageAnimation();const snapshot=document.querySelector<HTMLElement>('.reader-page-fade');
  expect(snapshot?.getAttribute('aria-hidden')).toBe('true');
  expect(snapshot?.hasAttribute('inert')).toBe(true);
  expect(snapshot?.scrollTop).toBe(oldTop);
  expect(snapshot?.parentElement).toBe(host.parentElement);
  expect(host.shadow.querySelectorAll('.book-flow')).toHaveLength(1);
  await view.next();view.animatePage('next');
  expect(snapshot?.hasAttribute('data-fading')).toBe(true);
  view.animatePage('none');expect(snapshot?.isConnected).toBe(false);
});

it('waits for animation completion rather than cutting off a delayed start',async()=>{
  const {view,host}=await chapter();view.applySettings({pageAnimation:'fade'});await frame();
  let finish!:(animation:Animation)=>void;
  const finished=new Promise<Animation>(resolve=>{finish=resolve;});
  Object.defineProperty(host.flow,'getAnimations',{value:()=>[{finished}]});
  vi.useFakeTimers();
  try {
    view.preparePageAnimation();view.animatePage('next');
    vi.advanceTimersByTime(350);
    expect(document.querySelector('.reader-page-fade')).not.toBeNull();
    finish({} as Animation);await Promise.resolve();await Promise.resolve();
    expect(document.querySelector('.reader-page-fade')).toBeNull();
    expect(host.hasAttribute('data-animating')).toBe(false);
  }finally{vi.useRealTimers();}
});

it('does not let an older animation completion clear a newer fade',async()=>{
  const {view,host}=await chapter();view.applySettings({pageAnimation:'fade'});await frame();
  const finishes:Array<(animation:Animation)=>void>=[];
  Object.defineProperty(host.flow,'getAnimations',{value:()=>[{finished:new Promise<Animation>(resolve=>finishes.push(resolve))}]});
  view.preparePageAnimation();view.animatePage('next');
  const first=document.querySelector('.reader-page-fade');
  view.preparePageAnimation();view.animatePage('next');
  const current=document.querySelector('.reader-page-fade');
  expect(first?.isConnected).toBe(false);
  finishes[0]!({} as Animation);await Promise.resolve();await Promise.resolve();
  expect(current?.isConnected).toBe(true);
  finishes[1]!({} as Animation);await Promise.resolve();await Promise.resolve();
  expect(current?.isConnected).toBe(false);
});

it('skips page fades when the device requests reduced motion',async()=>{
  const {view,host}=await chapter();view.applySettings({pageAnimation:'fade'});await frame();
  vi.stubGlobal('matchMedia',()=>({matches:true}));
  view.preparePageAnimation();view.animatePage('next');
  expect(document.querySelector('.reader-page-fade')).toBeNull();
  expect(host.hasAttribute('data-animating')).toBe(false);
});
