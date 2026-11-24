type SocketModel={state?:unknown;on?:(...args:unknown[])=>unknown};
type ConnectionModel={ref?:unknown};
type UserModel={getMaybeMePnUser?:()=>unknown;getMaybeMeLidUser?:()=>unknown};

export function installWhatsAppAuthStateFallback(){
  const runtime=window as Window&{require?:(name:string)=>unknown};
  const socketModel=runtime.require?.('WAWebSocketModel') as {Socket?:SocketModel}|undefined;
  const hasAuthenticatedUser=()=>{
    try{
      const user=runtime.require?.('WAWebUserPrefsMeUser') as UserModel|undefined;
      return Boolean(user?.getMaybeMePnUser?.()||user?.getMaybeMeLidUser?.());
    }catch{return false}
  };
  const socketState=()=>{
    if(hasAuthenticatedUser())return 'CONNECTED';
    try{
      const connectionModel=runtime.require?.('WAWebConnModel') as {Conn?:ConnectionModel}|undefined;
      const ref=connectionModel?.Conn?.ref;
      return typeof ref==='string'&&ref?'UNPAIRED_IDLE':undefined;
    }catch{return undefined}
  };
  const createSocket=():SocketModel=>({
    get state(){return socketState()},
    on(){return this}
  });
  if(!socketModel){
    const originalRequire=runtime.require;
    if(!originalRequire)return false;
    const descriptor=Object.getOwnPropertyDescriptor(runtime,'require');
    if(descriptor&&!descriptor.configurable&&!descriptor.writable)return false;
    const fallback={Socket:createSocket()};
    const compatibleRequire=function(name:string){
      const module=originalRequire.call(runtime,name);
      return name==='WAWebSocketModel'&&!module?fallback:module;
    };
    Object.defineProperty(runtime,'require',{
      configurable:descriptor?.configurable??true,
      enumerable:descriptor?.enumerable??true,
      writable:true,
      value:compatibleRequire
    });
    return true;
  }
  const socket=socketModel.Socket;
  if(!socket){
    if(!Object.isExtensible(socketModel))return false;
    const descriptor=Object.getOwnPropertyDescriptor(socketModel,'Socket');
    if(descriptor&&!descriptor.configurable)return false;
    Object.defineProperty(socketModel,'Socket',{configurable:true,enumerable:true,writable:true,value:createSocket()});
    return true;
  }
  const stateDescriptor=Object.getOwnPropertyDescriptor(socket,'state');
  const state=socket.state;
  if(stateDescriptor?.configurable||!stateDescriptor&&Object.isExtensible(socket)){
    const originalGet=stateDescriptor?.get;
    const originalSet=stateDescriptor?.set;
    const writable=stateDescriptor?.writable??true;
    let originalValue=state;
    Object.defineProperty(socket,'state',{
      configurable:true,
      enumerable:stateDescriptor?.enumerable??true,
      get(){return socketState()??(originalGet?originalGet.call(socket):originalValue)},
      set(value){if(originalSet)originalSet.call(socket,value);else if(writable)originalValue=value}
    });
  }else if(socketState()!==undefined&&socketState()!==state)return false;
  if(typeof socket.on!=='function'){
    const onDescriptor=Object.getOwnPropertyDescriptor(socket,'on');
    if(onDescriptor&&!onDescriptor.configurable&&!onDescriptor.writable)return false;
    if(!onDescriptor&&!Object.isExtensible(socket))return false;
    Object.defineProperty(socket,'on',{configurable:true,writable:true,value(){return this}});
  }
  return true;
}

export function whatsappAuthStateFromPage(){
  const runtime=window as Window&{require?:(name:string)=>unknown};
  const socketModel=runtime.require?.('WAWebSocketModel') as {Socket?:SocketModel}|undefined;
  const connectionModel=runtime.require?.('WAWebConnModel') as {Conn?:ConnectionModel}|undefined;
  try{
    const user=runtime.require?.('WAWebUserPrefsMeUser') as UserModel|undefined;
    if(user?.getMaybeMePnUser?.()||user?.getMaybeMeLidUser?.())return {need:false,state:'CONNECTED'};
  }catch{}
  const ref=connectionModel?.Conn?.ref;
  if(typeof ref==='string'&&ref)return {need:true,state:'UNPAIRED_IDLE'};
  const state=socketModel?.Socket?.state;
  if(!state||state==='OPENING'||state==='UNLAUNCHED'||state==='PAIRING'){
    return false;
  }
  return {need:state==='UNPAIRED'||state==='UNPAIRED_IDLE',state};
}

export function whatsappAccountIsReadyFromPage(){
  const runtime=window as Window&{require?:(name:string)=>unknown};
  try{
    const user=runtime.require?.('WAWebUserPrefsMeUser') as UserModel|undefined;
    return Boolean(user?.getMaybeMePnUser?.()||user?.getMaybeMeLidUser?.());
  }catch{return false}
}
