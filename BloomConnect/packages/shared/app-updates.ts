export type UpdateStatus={
 version:string;
 state:'unavailable'|'idle'|'checking'|'current'|'downloading'|'ready'|'installing'|'error';
 availableVersion?:string;
 percent?:number;
 message?:string;
};

export type AppUpdates={
 call:(action:'status'|'check'|'install')=>Promise<UpdateStatus>;
 subscribe:(listener:(status:UpdateStatus)=>void)=>()=>void;
};
