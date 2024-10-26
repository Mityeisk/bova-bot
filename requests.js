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
  const responseHtml = cheerio.load(response.data, {
    decodeEntities: false,
  });

  // Извлечение значения h2 внутри div с классом "result"
  const externalId = responseHtml(".result h2").text();
  const requsit = responseHtml(".result tr:nth-child(2) td.pl").text();
  const responseData = { externalId, requsit };
  // console.log(responseData);
  return responseData;
}

export async function handleDocumentError(ctx, groupId) {
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
        "❗️Более одного PDF или не сжатого файла не отправляем в одном сообщении по просьбе платежной системы.",
        reply
      );
      delete mediaGroupCache[groupId];
      delete mediaGroupTimers[groupId];
      delete pdfErrorTimers[groupId];
    }
  }, 3000); // Таймер в 1000 мс для ожидания загрузки всех PDF-файлов
}
