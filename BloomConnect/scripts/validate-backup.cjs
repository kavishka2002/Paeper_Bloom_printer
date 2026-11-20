const {DatabaseSync}=require('node:sqlite');
const {readFileSync,statSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {createHash}=require('node:crypto');
const {z}=require('zod/v4-mini');
const target=process.argv[2];
if(!target){console.error('Usage: node scripts/validate-backup.cjs <backup-folder>');process.exit(2)}
const folder=resolve(target);
let db;
try{
  db=new DatabaseSync(join(folder,'bloomconnect.sqlite'),{readOnly:true});
  db.exec('PRAGMA trusted_schema=OFF;');
  if(![1,2,3,4,5].includes(db.prepare('PRAGMA user_version').get().user_version))throw new Error('Unsupported database version.');
  if(!db.prepare('PRAGMA integrity_check').all().every(row=>row.integrity_check==='ok'))throw new Error('SQLite integrity check failed.');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Broken database references.');
  const requiredTables=['shops','settings','whatsapp_accounts','sessions_metadata','customers','conversations','messages','attachments','automation_rules','automation_executions','print_jobs','print_job_files','printers','print_queue','payments','receipts','activity_logs'];
  if(db.prepare('PRAGMA user_version').get().user_version>=3)requiredTables.push('print_calculations','print_order_config');
  if(db.prepare('PRAGMA user_version').get().user_version>=4)requiredTables.push('notification_outbox');
  if(db.prepare('PRAGMA user_version').get().user_version>=5)requiredTables.push('notification_attempts');
  const tables=new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row=>row.name));
  if(requiredTables.some(table=>!tables.has(table)))throw new Error('BloomConnect tables are missing.');
  const configuration=db.prepare("SELECT value FROM settings WHERE key='shop'").get();
  if(configuration)z.object({shop:z.string(),language:z.enum(['en','si']),printer:z.string(),mono:z.number(),colour:z.number(),photo:z.number()}).parse(JSON.parse(configuration.value));
  const files=db.prepare("SELECT DISTINCT path,hash,bytes FROM attachments WHERE status='Ready'").all();
  for(const file of files){
    if(!/^[a-f0-9]{64}\.(pdf|jpg|png|webp)$/.test(file.path)||file.path.split('.')[0]!==file.hash)throw new Error('Invalid document path.');
    const path=join(folder,'documents',file.path);
    const size=statSync(path).size;
    if(size!==file.bytes||size>32*1024*1024||createHash('sha256').update(readFileSync(path)).digest('hex')!==file.hash)throw new Error('Document size or checksum mismatch: '+file.path);
  }
  console.log('Backup validated. '+files.length+' unique document file(s).');
}catch(error){console.error(error.message);process.exitCode=1}finally{db?.close()}
