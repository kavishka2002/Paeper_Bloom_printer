import type {Message} from '../../packages/shared/contracts';

const systemKinds=new Set(['notification','notification_template','e2e_notification','gp2','protocol','revoked']);
export const visibleInboxMessage=(message:Message)=>!systemKinds.has(message.kind);
export const unreadInboxMessage=(message:Message)=>message.direction==='incoming'&&message.unread!==0&&visibleInboxMessage(message);
