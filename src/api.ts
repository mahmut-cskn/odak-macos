import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import type {Snapshot} from './domain';
declare global {interface Window {odakTestApi?:{invoke:<T>(cmd:string,args?:Record<string,unknown>)=>Promise<T>;listen:(event:string,handler:(payload:any)=>void)=>Promise<()=>void>}}}
const testApi=()=>import.meta.env.DEV?window.odakTestApi:undefined;
export const call=<T,>(cmd:string,args?:Record<string,unknown>)=>testApi()?.invoke<T>(cmd,args)??invoke<T>(cmd,args);
export const subscribe=(event:string,handler:(payload:any)=>void)=>testApi()?.listen(event,handler)??listen(event,event=>handler(event.payload));
export const load=()=>call<Snapshot>('snapshot');
export const action=(action:string,payload:unknown={})=>call<Snapshot>('command',{action,payload});
