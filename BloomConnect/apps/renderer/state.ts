import {create} from 'zustand';

type WorkspaceValues={
 view:string;
 photoStudio:boolean;
 photoDraft:string[];
 lightenPhotoDraft:boolean;
 search:string;
 dark:boolean;
 attachment:string;
 scannerAttachment:string;
 pdfPrintAttachment:string;
 pdfBatchDraft:string[];
 autoPdfPrint:boolean;
 job:string;
 customer:string;
 orderScope:'all'|'open';
};

export const useWorkspace=create<WorkspaceValues&{set:(values:Partial<WorkspaceValues>)=>void}>(set=>({
 view:'Dashboard',photoStudio:false,photoDraft:[],lightenPhotoDraft:false,search:'',
 dark:localStorage.getItem('theme')==='dark',attachment:'',scannerAttachment:'',
 pdfPrintAttachment:'',pdfBatchDraft:[],autoPdfPrint:localStorage.getItem('autoPdfPrint')!=='off',
 job:'',customer:'',orderScope:'all',set
}));
