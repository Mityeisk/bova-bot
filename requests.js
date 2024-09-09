import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
export let pdfErrorTimers = {};
export let mediaGroupCache = {};
export let mediaGroupTimers = {};

dotenv.config();
const requestUrl = process.env.REQUEST_URL;
export async function getExternalID(orderId, ctx) {
  const response = await axios.get(requestUrl, {
    params: {
      direction: "m2b",
      id: orderId, // Отправляем ID в теле запроса
    },
  });

  // Парсинг HTML
  const responseHtml = cheerio.load(response.data);

  // Извлечение значения h2 внутри div с классом "result"
  const externalId = responseHtml(".result h2").text();
  return externalId;
}

export async function handlePdfError(ctx, groupId) {
  const userMessageId = ctx.message.message_id;
  const reply = {
    reply_to_message_id: userMessageId, // Указываем ID сообщения, на которое нужно ответить
  };
  if (pdfErrorTimers[groupId]) {
    clearTimeout(pdfErrorTimers[groupId]);
  }

  pdfErrorTimers[groupId] = setTimeout(async () => {
    if (mediaGroupCache[groupId]) {
      await ctx.reply(
        "❗️PDF-файлы не обрабатываются. Отправьте чек в виде изображения.",
        reply
      );
      delete mediaGroupCache[groupId];
      console.log(mediaGroupCache);
      delete mediaGroupTimers[groupId];
      console.log(mediaGroupTimers);
      delete pdfErrorTimers[groupId];
      console.log(pdfErrorTimers);
    }
  }, 3000); // Таймер в 1000 мс для ожидания загрузки всех PDF-файлов
}
