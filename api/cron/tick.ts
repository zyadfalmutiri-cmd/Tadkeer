import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../../lib/supabase';
import { sendMessage } from '../../lib/telegram';
import {
  AYAT,
  ADHKAR_SHORT,
  DUAA,
  SALAWAT,
  MORNING_EXTRA,
  EVENING_EXTRA,
  FRIDAY_GREETING,
  FRIDAY_DUA,
  KAHF_REMINDERS,
  IJABAH_REMINDERS,
  pickByDay,
} from '../../lib/content';

function localHour(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  });
  return parseInt(formatter.format(date), 10);
}

function isFriday(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' });
  return formatter.format(date) === 'Fri';
}

// أوقات ثابتة (بتوقيت كل مستخدم المحلي) لإرسال المحتوى التلقائي
const NORMAL_HOURS = { ayah: 10, dhikr: 13, dua: 16, salawat: 20 };
const FRIDAY_HOURS = { greeting: 7, kahf1: 9, dua: 12, ijabah: 15, salawat: 18, kahf2: 21 };

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

    const tz = user.timezone || 'Asia/Riyadh';
    const hour = localHour(now, tz);
    const friday = isFriday(now, tz);

    if (parseInt(settings.morning_adhkar_time?.slice(0, 2), 10) === hour) {
      const extra = pickByDay(MORNING_EXTRA, now);
      await sendMessage(user.id, `🌅 حان وقت أذكار الصباح\n\n${extra}`);
    }

    if (parseInt(settings.evening_adhkar_time?.slice(0, 2), 10) === hour) {
      const extra = pickByDay(EVENING_EXTRA, now);
      await sendMessage(user.id, `🌇 حان وقت أذكار المساء\n\n${extra}`);
    }

    if (parseInt(settings.wird_reminder_time?.slice(0, 2), 10) === hour) {
      await sendMessage(user.id, '📖 لا تنسَ ورد اليوم من القرآن. أرسل عدد الصفحات اللي بتقرأها.');
    }

    if (friday) {
      await sendFridayContent(user.id, hour, now);
    } else {
      await sendNormalContent(user.id, hour, now);
    }
  }

  res.status(200).send('done');
}

async function sendNormalContent(chatId: number, hour: number, now: Date) {
  if (hour === NORMAL_HOURS.ayah) {
    const item = pickByDay(AYAT, now);
    await sendMessage(chatId, `${item.emoji} ${item.title}\n\n${item.body}`);
  }
  if (hour === NORMAL_HOURS.dhikr) {
    const item = pickByDay(ADHKAR_SHORT, now, 3);
    await sendMessage(chatId, `${item.emoji} ${item.title}\n\n${item.body}`);
  }
  if (hour === NORMAL_HOURS.dua) {
    const item = pickByDay(DUAA, now, 5);
    await sendMessage(chatId, `${item.emoji} ${item.title}\n\n${item.body}`);
  }
  if (hour === NORMAL_HOURS.salawat) {
    const item = pickByDay(SALAWAT, now, 2);
    await sendMessage(chatId, `${item.emoji} ${item.title}\n\n${item.body}`);
  }
}

async function sendFridayContent(chatId: number, hour: number, now: Date) {
  if (hour === FRIDAY_HOURS.greeting) {
    const greeting = pickByDay(FRIDAY_GREETING, now);
    const salawat = pickByDay(SALAWAT, now);
    await sendMessage(chatId, `🕌 جمعة مباركة\n${greeting}\n\nأكثروا من الصلاة على النبي ﷺ\n\n«${salawat.body}»`);
  }
  if (hour === FRIDAY_HOURS.kahf1) {
    const item = pickByDay(KAHF_REMINDERS, now);
    await sendMessage(chatId, `📖 ورد الجمعة\n${item}`);
  }
  if (hour === FRIDAY_HOURS.dua) {
    const item = pickByDay(FRIDAY_DUA, now);
    await sendMessage(chatId, `${item.emoji} ${item.title}\n\n${item.body}`);
  }
  if (hour === FRIDAY_HOURS.ijabah) {
    const item = pickByDay(IJABAH_REMINDERS, now);
    await sendMessage(chatId, `🤲 تذكير بساعة الإجابة\n\n${item}`);
  }
  if (hour === FRIDAY_HOURS.salawat) {
    const item = pickByDay(SALAWAT, now, 4);
    await sendMessage(chatId, `🕌 أكثروا من الصلاة على النبي ﷺ\n\n${item.body}`);
  }
  if (hour === FRIDAY_HOURS.kahf2) {
    const item = pickByDay(KAHF_REMINDERS, now, 2);
    await sendMessage(chatId, `📖 ${item}`);
  }
}
