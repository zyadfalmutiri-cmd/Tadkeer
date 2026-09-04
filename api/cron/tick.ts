import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../../lib/supabase';
import { sendMessage } from '../../lib/telegram';

function localHour(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  });
  return parseInt(formatter.format(date), 10);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const now = new Date();

  const { data: users } = await supabase
    .from('bot_users')
    .select('id, timezone, is_paused, user_settings(morning_adhkar_time, evening_adhkar_time, wird_reminder_time)')
    .eq('is_paused', false);

  if (!users) return res.status(200).send('no users');

  for (const user of users as any[]) {
    const settings = user.user_settings;
    if (!settings) continue;

    const hour = localHour(now, user.timezone || 'Asia/Riyadh');

    if (parseInt(settings.morning_adhkar_time?.slice(0, 2), 10) === hour) {
      await sendMessage(user.id, '🌅 حان وقت أذكار الصباح');
    }
    if (parseInt(settings.evening_adhkar_time?.slice(0, 2), 10) === hour) {
      await sendMessage(user.id, '🌇 حان وقت أذكار المساء');
    }
    if (parseInt(settings.wird_reminder_time?.slice(0, 2), 10) === hour) {
      await sendMessage(user.id, '📖 لا تنسَ ورد اليوم من القرآن. أرسل عدد الصفحات اللي بتقرأها.');
    }
  }

  res.status(200).send('done');
}
