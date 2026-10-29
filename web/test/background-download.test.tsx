// @vitest-environment jsdom
import {act} from 'react';
import {expect,it,vi} from 'vitest';
import {Blob as NodeBlob} from 'node:buffer';
import {render} from '../src/shared/ui/render-root.ts';
import {ReadingTools} from '../src/ui/reading-tools.tsx';
import {OfflineDownload} from '../src/core/offline-download.ts';
import {PublicationCache} from '../src/store/publications.ts';
import {OfflineStore} from '../src/store/offline.ts';
import {MemoryKv,MemoryBlobs} from './helpers/env.ts';
import type {ReaderApi} from '../src/api/client.ts';
import type {Manifest} from '../src/api/types.ts';

const manifest={book:{id:'book',title:'继续下载的小说',format:'chapters'},files:[],content:{kind:'text',total:3,revision:'one',groups:[{id:'all',seq:0,offset:0,count:3,title:'全部'}],items:[0,1,2].map(seq=>({id:String(seq),seq,title:'第'+(seq+1)+'章',href:'chapter:'+seq,resourceRef:'r:'+seq,kind:'chapter',mediaType:'text/plain'}))}} as unknown as Manifest;
const settle=()=>act(async()=>{await new Promise(done=>setTimeout(done,20));});
it('keeps downloading after the tools panel closes and reattaches to live progress',async()=>{
 const root=document.createElement('div');document.body.append(root);const kv=new MemoryKv(),cache=new PublicationCache(kv,new MemoryBlobs(),'scope');let release!:()=>void;
 const asset=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{release=()=>resolve(new NodeBlob(['第一章正文']));})).mockResolvedValue(new NodeBlob(['其他章节正文']));
 const api={asset} as unknown as ReaderApi,task=new OfflineDownload(api,cache,manifest,()=>{});
 const props={api,cache,manifest,downloads:{get:async()=>task},offline:new OfflineStore(kv),sync:{},selection:null,locator:'',returnLocator:'',currentChapter:1,overrides:{version:0,headingPrefix:'',corrections:[]},autoCache:false,autoCacheChapters:5,prefetchMessage:'',sections:async function*(){},navigate:async()=>{},saveOverrides:async()=>{},undoOverrides:async()=>{},previewHeadings:async()=>[],onNotes:()=>{},onClose:()=>{},onCacheSetting:()=>{},onClearCache:async()=>{},previewSpeech:async()=>'',stopPreview:()=>{}} as any;
 const button=(name:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===name)!;
 try{
  await act(async()=>render(<ReadingTools {...props}/>,root));await settle();
  await act(async()=>button('缓存').click());await act(async()=>button('下载 / 继续').click());
  await vi.waitFor(()=>expect(asset).toHaveBeenCalledTimes(1));
  act(()=>render(null,root));release();
  await vi.waitFor(async()=>expect(await cache.entries()).toHaveLength(3));
  expect(asset).toHaveBeenCalledTimes(3);
  await act(async()=>render(<ReadingTools {...props}/>,root));await settle();await act(async()=>button('缓存').click());
  expect(document.body.textContent).toContain('3/3');
 }finally{act(()=>render(null,root));root.remove();}
});
