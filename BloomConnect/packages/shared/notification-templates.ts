export const notificationTemplates = [
  {event:'price-confirmed',name:'Price confirmed',en:'The price for job {job_id} is confirmed. Total: Rs. {total_amount}',si:'{job_id} අංකය සහිත ඇණවුමේ මිල තහවුරු කර ඇත. මුළු මුදල: රු. {total_amount}'},
  {event:'files-received',name:'Files received',en:'We received your documents / photographs and are preparing your order.',si:'ඔබ එවූ ලේඛන / ඡායාරූප අප වෙත ලැබී ඇත. ඔබගේ ඇණවුම සකස් කරමින් පවතී.'},
  {event:'order-created',name:'Order created',en:'Your order is registered. Job Number: {job_id}',si:'ඔබගේ ඇණවුම ලියාපදිංචි කර ඇත. Job Number: {job_id}'},
  {event:'printing-started',name:'Printing started',en:'Printing has started for your order. Job Number: {job_id}',si:'ඔබගේ ඇණවුම මුද්‍රණය කිරීම ආරම්භ කර ඇත. Job Number: {job_id}'},
  {event:'ready-to-print',name:'Ready to print',en:'Your order is ready to print. Job Number: {job_id}',si:'ඔබගේ ඇණවුම මුද්‍රණය කිරීමට සූදානම්. රැකියා අංකය: {job_id}'},
  {event:'print-queued',name:'Submitted to print queue',en:'Your order is in the print queue. Job Number: {job_id}',si:'ඔබගේ ඇණවුම මුද්‍රණ පෝලිමට එක් කර ඇත. රැකියා අංකය: {job_id}'},
  {event:'print-completed',name:'Printing confirmed complete',en:'Your printing is complete. Job Number: {job_id}. Total: Rs. {total_amount}',si:'ඔබගේ මුද්‍රණ කටයුතු අවසන් වී ඇත. රැකියා අංකය: {job_id}. මුළු මුදල: රු. {total_amount}'},
  {event:'pickup',name:'Ready for pickup',en:'Your order is ready for pickup. Job Number: {job_id}. Total: Rs. {total_amount}',si:'ඔබගේ ඇණවුම ලබාගැනීමට සූදානම්. Job Number: {job_id}. මුළු මුදල: රු. {total_amount}'},
  {event:'collected',name:'Order collected',en:'Your order collection is confirmed. Thank you for using our service!',si:'ඔබගේ ඇණවුම ලබාගැනීම තහවුරු කර ඇත. අපගේ සේවාව භාවිතා කළ ඔබට ස්තූතියි!'}
] as const;
