import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { SQLiteSyncDialect,sqliteTable,text,integer } from 'drizzle-orm/sqlite-core';
import { eq,type SQLWrapper } from 'drizzle-orm';
import type {SQLInputValue} from 'node:sqlite';
const settings=sqliteTable('settings',{key:text().primaryKey(),value:text().notNull()});
const activity=sqliteTable('activity_logs',{id:integer().primaryKey({autoIncrement:true}),kind:text().notNull(),detail:text().notNull(),created:text().notNull()});
export function openDatabase(path:string){
  const db=new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  if(!Number(db.prepare('PRAGMA user_version').get()?.user_version)){
    db.exec(`BEGIN;
      CREATE TABLE shops(id INTEGER PRIMARY KEY CHECK(id=1),name TEXT NOT NULL);
      CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE whatsapp_accounts(id TEXT PRIMARY KEY,phone TEXT NOT NULL DEFAULT '');
      CREATE TABLE sessions_metadata(account_id TEXT PRIMARY KEY REFERENCES whatsapp_accounts(id), verified_at TEXT);
      CREATE TABLE customers(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',tag TEXT NOT NULL DEFAULT '',created TEXT NOT NULL,last TEXT NOT NULL);
      CREATE UNIQUE INDEX unique_customer_phone ON customers(phone) WHERE phone != '';
      CREATE INDEX customers_name ON customers(name);
      CREATE TABLE conversations(account_id TEXT NOT NULL REFERENCES whatsapp_accounts(id),customer_id TEXT NOT NULL REFERENCES customers(id),PRIMARY KEY(account_id,customer_id));
      CREATE TABLE messages(id TEXT PRIMARY KEY,account_id TEXT REFERENCES whatsapp_accounts(id),customer_id TEXT NOT NULL REFERENCES customers(id),body TEXT NOT NULL,kind TEXT NOT NULL,direction TEXT NOT NULL,status TEXT NOT NULL,created TEXT NOT NULL,unread INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX messages_customer ON messages(customer_id,created);
      CREATE TABLE attachments(id TEXT PRIMARY KEY,customer_id TEXT REFERENCES customers(id),message_id TEXT UNIQUE REFERENCES messages(id),name TEXT NOT NULL,mime TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,created TEXT NOT NULL,bytes INTEGER NOT NULL DEFAULT 0,hash TEXT,path TEXT,remote TEXT);
      CREATE INDEX attachment_customer ON attachments(customer_id,created);
      CREATE INDEX attachment_hash ON attachments(hash);
      CREATE TABLE automation_rules(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE automation_executions(rule_id TEXT NOT NULL REFERENCES automation_rules(id),event_id TEXT NOT NULL,status TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(rule_id,event_id));
      CREATE TABLE print_jobs(id TEXT PRIMARY KEY,customer_id TEXT REFERENCES customers(id),status TEXT NOT NULL,copies INTEGER NOT NULL,paper TEXT NOT NULL,colour INTEGER NOT NULL,total INTEGER NOT NULL CHECK(total>=0),created TEXT NOT NULL);
      CREATE INDEX jobs_created ON print_jobs(created);
      CREATE TABLE print_job_files(job_id TEXT NOT NULL REFERENCES print_jobs(id),attachment_id TEXT NOT NULL REFERENCES attachments(id),PRIMARY KEY(job_id,attachment_id));
      CREATE TABLE printers(name TEXT PRIMARY KEY,display_name TEXT NOT NULL);
      CREATE TABLE print_queue(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES print_jobs(id),printer TEXT NOT NULL,status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',created TEXT NOT NULL);
      CREATE TABLE payments(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES print_jobs(id),amount INTEGER NOT NULL CHECK(amount>0),method TEXT NOT NULL,created TEXT NOT NULL);
      CREATE INDEX payments_job ON payments(job_id);
      CREATE TABLE receipts(id TEXT PRIMARY KEY REFERENCES payments(id),created TEXT NOT NULL);
      CREATE TABLE activity_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,detail TEXT NOT NULL,created TEXT NOT NULL);
      PRAGMA user_version=1; COMMIT;`);
  }
  if(Number(db.prepare('PRAGMA user_version').get()?.user_version)===1){
    db.exec('BEGIN; ALTER TABLE print_queue ADD COLUMN settings TEXT; PRAGMA user_version=2; COMMIT;');
  }
  if(Number(db.prepare('PRAGMA user_version').get()?.user_version)===2){
    db.exec(`BEGIN;
      CREATE TABLE print_calculations(
        job_id TEXT NOT NULL REFERENCES print_jobs(id),
        attachment_id TEXT NOT NULL REFERENCES attachments(id),
        input TEXT NOT NULL,result TEXT NOT NULL,created TEXT NOT NULL,
        PRIMARY KEY(job_id,attachment_id)
      );
      CREATE TABLE print_order_config(job_id TEXT PRIMARY KEY REFERENCES print_jobs(id),settings TEXT NOT NULL);
      PRAGMA user_version=3; COMMIT;`);
  }
  if(Number(db.prepare('PRAGMA user_version').get()?.user_version)===3){
    db.exec(`BEGIN;
      CREATE TABLE notification_outbox(id TEXT PRIMARY KEY,rule_id TEXT NOT NULL,customer_id TEXT NOT NULL,account_id TEXT NOT NULL,event_key TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,due INTEGER NOT NULL,error TEXT NOT NULL DEFAULT '',created TEXT NOT NULL);
      CREATE INDEX notification_due ON notification_outbox(status,due);
      PRAGMA user_version=4; COMMIT;`);
  }
  if(Number(db.prepare('PRAGMA user_version').get()?.user_version)===4){
    db.exec(`BEGIN;
      ALTER TABLE notification_outbox ADD COLUMN message_id TEXT;
      CREATE TABLE notification_attempts(id INTEGER PRIMARY KEY AUTOINCREMENT,notification_id TEXT NOT NULL REFERENCES notification_outbox(id),attempted TEXT NOT NULL,result TEXT NOT NULL,error TEXT NOT NULL DEFAULT '');
      PRAGMA user_version=5; COMMIT;`);
  }
  const orm=drizzle(async()=>{throw new Error('Use the synchronous SQLite executor.')});
  const dialect=new SQLiteSyncDialect();
  const query=(statement:SQLWrapper)=>dialect.sqlToQuery(statement.getSQL());
  const execute=(statement:SQLWrapper)=>{
    const compiled=query(statement);
    db.prepare(compiled.sql).run(...compiled.params as SQLInputValue[]);
  };
  return {db,
    setting<T>(key:string){const compiled=query(orm.select({value:settings.value}).from(settings).where(eq(settings.key,key)));const row=db.prepare(compiled.sql).get(...compiled.params as SQLInputValue[]);return row?JSON.parse(String(row.value)) as T:null},
    save(key:string,value:unknown){const data=JSON.stringify(value);execute(orm.insert(settings).values({key,value:data}).onConflictDoUpdate({target:settings.key,set:{value:data}}))},
    audit(kind:string,detail:string){execute(orm.insert(activity).values({kind,detail,created:new Date().toISOString()}))},
    atomic<T>(fn:()=>T):T{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value}catch(error){db.exec('ROLLBACK');throw error}}
  };
}
