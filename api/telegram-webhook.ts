import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../lib/supabase';
import { sendMessage, answerCallbackQuery, inlineKeyboard } from '../lib/telegram';
import { bumpStreak } from '../lib/streaks';

const TOTAL_PAGES = 604;

const mainMenu = inlineKeyboard([
  [{ text: '📖 سجّل صفحات اليوم', callback_data: 'log_pages' }],
  [{ text: '🌅 أذكار الصباح', callback_data: 'adhkar_morning' }, { text: '🌇 أذكار المساء', callback_data: 'adhkar_evening' }],
  [{ text: '📊 إحصائياتي', callback_data: 'status' }],
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(200).send('ok');

  const update = req.body;

  try {
    if (update.message) {
      await handleMessage(update.message);
    } else if (update.callback_query) {
      await handleCallback(update.callback_query);
    }
  } catch (err) {
    console.error(err);
  }

  res.status(200).send('ok');
}

async function ensureUser(chatId: number, username?: string, firstName?: string) {
  const { data: user } = await supabase.from('bot_users').select('id').eq('id', chatId).maybeSingle();
  if (user) return;

  await supabase.from('bot_users').insert({ id: chatId, username, first_name: firstName });
  await supabase.from('user_settings').insert({ user_id: chatId });
  await supabase.from('khatms').insert({ user_id: chatId, khatm_number: 1 });
}

async function handleMessage(message: any) {
  const chatId = message.chat.id;
  const text: string = (message.text || '').trim();

  await ensureUser(chatId, message.from?.username, message.from?.first_name);

  if (text === '/start') {
    await sendMessage(chatId, 'أهلًا فيك في تذكير 🌙\nبوت يساعدك تحافظ على أذكارك ووردك اليومي من القرآن.', mainMenu);
    return;
  }

  if (text === '/pause') {
    await supabase.from('bot_users').update({ is_paused: true }).eq('id', chatId);
    await sendMessage(chatId, 'تم إيقاف التذكيرات مؤقتًا. أرسل /resume لما ترجع.');
    return;
  }

  if (text === '/resume') {
    await supabase.from('bot_users').update({ is_paused: false }).eq('id', chatId);
    await sendMessage(chatId, 'تم تفعيل التذكيرات ✅');
    return;
  }

  if (text.startsWith('/ramadan')) {
    const on = text.includes('on');
    await supabase.from('user_settings').update({ ramadan_mode: on }).eq('user_id', chatId);
    await sendMessage(chatId, on ? 'تم تفعيل وضع رمضان 🌙 هدفك الآن ختمة كاملة خلال الشهر.' : 'تم إيقاف وضع رمضان.');
    return;
  }

  if (text.startsWith('/settime')) {
    const parts = text.split(' ');
    const key = parts[1];
    const value = parts[2];
    const map: Record<string, string> = {
      morning: 'morning_adhkar_time',
      evening: 'evening_adhkar_time',
      wird: 'wird_reminder_time',
    };
    if (!map[key] || !/^\d{2}:\d{2}$/.test(value || '')) {
      await sendMessage(chatId, 'الصيغة: /settime morning 05:30 (أو evening / wird)');
      return;
    }
    await supabase.from('user_settings').update({ [map[key]]: value }).eq('user_id', chatId);
    await sendMessage(chatId, 'تم تحديث الوقت ✅');
    return;
  }

  if (/^\d+$/.test(text)) {
    await logPages(chatId, parseInt(text, 10));
    return;
  }

  await sendMessage(chatId, 'اختر من القائمة 👇', mainMenu);
}

async function logPages(chatId: number, pages: number) {
  const today = new Date().toISOString().slice(0, 10);

  const { data: khatm } = await supabase
    .from('khatms')
    .select('*')
    .eq('user_id', chatId)
    .is('completed_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!khatm) return;

  await supabase.from('reading_log').upsert(
    { user_id: chatId, khatm_id: khatm.id, log_date: today, pages_read: pages },
    { onConflict: 'user_id,log_date' }
  );

  const newPage = khatm.current_page + pages;

  if (newPage > TOTAL_PAGES) {
    await supabase.from('khatms').update({ current_page: TOTAL_PAGES, completed_at: new Date().toISOString() }).eq('id', khatm.id);
    await supabase.from('khatms').insert({ user_id: chatId, khatm_number: khatm.khatm_number + 1 });
    await sendMessage(chatId, `🎉 مبارك! أكملت الختمة رقم ${khatm.khatm_number}. بدأنا لك ختمة جديدة.`);
  } else {
    await supabase.from('khatms').update({ current_page: newPage }).eq('id', khatm.id);
    await sendMessage(chatId, `✅ تم تسجيل ${pages} صفحة. أنت الآن في صفحة ${newPage} من ${TOTAL_PAGES}.`);
  }

  await bumpStreak(chatId);
}

async function handleCallback(cb: any) {
  const chatId = cb.message.chat.id;
  const today = new Date().toISOString().slice(0, 10);

  await ensureUser(chatId, cb.from?.username, cb.from?.first_name);

  if (cb.data === 'log_pages') {
    await answerCallbackQuery(cb.id);
    await sendMessage(chatId, 'أرسل عدد الصفحات اللي قريتها اليوم كرقم بس (مثال: 4)');
    return;
  }

  if (cb.data === 'adhkar_morning' || cb.data === 'adhkar_evening') {
    const field = cb.data === 'adhkar_morning' ? 'morning_done' : 'evening_done';

    const { data: existing } = await supabase.from('adhkar_log').select('*').eq('user_id', chatId).eq('log_date', today).maybeSingle();

    if (existing) {
      await supabase.from('adhkar_log').update({ [field]: true }).eq('user_id', chatId).eq('log_date', today);
    } else {
      await supabase.from('adhkar_log').insert({ user_id: chatId, log_date: today, [field]: true });
    }

    await bumpStreak(chatId);
    await answerCallbackQuery(cb.id, 'تم تسجيلها ✅');
    return;
  }

  if (cb.data === 'status') {
    await answerCallbackQuery(cb.id);
    await sendStatus(chatId);
    return;
  }
}

async function sendStatus(chatId: number) {
  const { data: streak } = await supabase.from('streaks').select('*').eq('user_id', chatId).maybeSingle();
  const { data: khatm } = await supabase
    .from('khatms')
    .select('*')
    .eq('user_id', chatId)
    .is('completed_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const streakText = streak ? `🔥 سلسلتك: ${streak.current_streak} يوم (أطول سلسلة: ${streak.longest_streak})` : '🔥 ما بدأت سلسلة بعد';
  const khatmText = khatm ? `📖 الختمة رقم ${khatm.khatm_number}: صفحة ${khatm.current_page} من ${TOTAL_PAGES}` : '';

  await sendMessage(chatId, `${streakText}\n${khatmText}`);
}
