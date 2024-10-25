import dotenv from "dotenv";
import { Bot } from "grammy";
import axios from "axios";
import {
  getExternalID,
  handleDocumentError,
  mediaGroupCache,
  mediaGroupTimers,
} from "./requests.js";
import * as cheerio from "cheerio";

dotenv.config();
export const bot = new Bot(process.env.BOT_API_KEY);
const senderChatId = process.env.SENDER_CHAT_ID;
const destinationChatId = process.env.DESTINATION_CHAT_ID;

let externalID = "";

bot.api.setMyCommands(
  [
    { command: "details", description: "Request payment details" },
    {
      command: "message",
      description: "Send any message. Command will not handle img/pdf.",
    },
  ],
  {
    scope: {
      type: "chat",
      chat_id: senderChatId,
    },
  }
);

bot.command("details", async (ctx) => {
  const recievedChatId = ctx.chat.id;
  if (recievedChatId.toString() !== senderChatId) {
    return; // Игнорируем сообщения из других чатов
  }

  const userMessageId = ctx.message.message_id;
  const reply = {
    reply_to_message_id: userMessageId, // Указываем ID сообщения, на которое нужно ответить
  };

  const messageText = ctx.message.text;
  console.log(messageText);
  const parts = messageText.split(/\s+/);
  if (parts.length <= 1) {
    try {
      await ctx.reply(
        '❗️Неправильный запрос. Формат: "/details <ордер>".',
        reply
      );
      return;
    } catch (error) {
      console.log(error);
      return;
    }
  }
  console.log(parts);

  const formattedParts = parts.slice(1);
  async function getOrdersDetails(formattedParts) {
    // console.log(formattedParts);
    const cleanedParts = formattedParts.map((part) => part.replace(/\n/g, ""));
    //console.log(cleanedParts);
    const responseObject = [];
    for (const order of cleanedParts) {
      try {
        const response = await axios.get(
          "https://api-crm.bovapay.com/tables/get_id/590",
          {
            params: {
              direction: "m2b",
              id: order,
            },
          }
        );

        const responseHtml = cheerio.load(response.data, {
          decodeEntities: false,
        });
        const externalId = responseHtml(".result h2").text();
        const requsit = responseHtml(".result tr:nth-child(2) td.pl").text();
        const bank = responseHtml(".result tr:nth-child(3) td.pl").text();
        const sum = responseHtml(".result tr:nth-child(4) td.pl").text();

        const object = `🟢Ордер: \`${order}\`\nBova ID: \`${externalId}\`\nПолучатель: \`${requsit}\`\nБанк: \`${bank}\`\nСумма: \`${sum}\`\n`;
        responseObject.push(object);
      } catch {
        const errObject = `❗️Ордер: \`${order}\`\nРеквизиты не выдавались или произошел сбой.\n`;
        responseObject.push(errObject);
      }
    }

    return responseObject;
  }

  const details = await getOrdersDetails(formattedParts);
  const detailsString = details.join("\n");

  ctx.reply(detailsString, {
    parse_mode: "Markdown",
    ...reply,
  });
});

bot.command("message", async (ctx) => {
  console.log(123123);
  const recievedChatId = ctx.chat.id;
  if (recievedChatId.toString() !== senderChatId) {
    return; // Игнорируем сообщения из других чатов
  }

  const message = ctx.message;
  const reply = {
    reply_to_message_id: message.message_id, // Указываем ID сообщения, на которое нужно ответить
  };

  const messageText = message.text || message.caption;
  const parts = messageText.split(" ");
  if (parts.length <= 1) {
    await ctx.reply(
      '❗️Неправильный запрос. Формат: "/message <text>".',
      reply
    );
    return;
  }
  const botCommand = parts[0];
  const text = messageText.replace(botCommand, "");

  try {
    await bot.api.sendMessage(destinationChatId, text);
    await ctx.reply("🟢Сообщение отправлено.", reply);
  } catch (err) {
    console.error("Ошибка при отправке фото:", error);
    await ctx.reply(
      "Произошла ошибка при пересылке. Пожалуйста, попробуйте снова.",
      reply
    );
    return;
  }
});

bot.on("message", async (ctx) => {
  const recievedChatId = ctx.chat.id;

  if (recievedChatId.toString() !== senderChatId) {
    return; // Игнорируем сообщения из других чатов
  }

  let messageToSend = "";
  let externalIdToSend = "";

  const message = ctx.message;
  const reply = {
    reply_to_message_id: message.message_id, // Указываем ID сообщения, на которое нужно ответить
  };

  if (
    ctx.message.new_chat_members ||
    ctx.message.left_chat_member ||
    ctx.message.left_chat_participant
  ) {
    return; // Выходим из функции, не реагируя на такие сообщения
  }
  const messageText = message.text || message.caption;

  if (messageText) {
    const parts = messageText.split(" ");
    let order = "";

    if (parts[0]) {
      order = parts[0].split("\n")[0];
    }
    if (isNaN(order)) {
      // Неправильный формат запросаы
      await ctx.reply(
        "❗️Неправильный запрос. Укажите ордер первым в запросе.",
        reply
      );
      return;
    }

    try {
      externalID = await getExternalID(order, ctx);

      messageToSend = `${externalID}\n${messageText}`;
    } catch (error) {
      console.log(error);
      await ctx.reply(
        "❗️Ордер не относится к данной платежной системе или произошел сбой на стороне ПС.",
        reply
      );
      return;
    }
  } // Проверяем, является ли сообщение частью альбома (media group)
  const groupId = message.media_group_id;

  if (!mediaGroupCache[groupId]) {
    mediaGroupCache[groupId] = [];
  }

  if (message.media_group_id && message.document) {
    await handleDocumentError(ctx, groupId);
    return;
  }
  if (message.media_group_id) {
    // Если это часть альбома, добавляем сообщение в кеш
    // Сохраняем фото в кеш
    mediaGroupCache[groupId].push({
      type: "photo",
      media: message.photo[message.photo.length - 1].file_id, // Самое большое фото
      caption: messageToSend || "", // Только одно сообщение может содержать подпись
    });
    console.log(mediaGroupCache[groupId][0].caption);

    // Сбрасываем предыдущий таймер, если он был
    if (mediaGroupTimers[groupId]) {
      clearTimeout(mediaGroupTimers[groupId]);
    }
    // Устанавливаем новый таймер для отправки всей группы фото
    mediaGroupTimers[groupId] = setTimeout(async () => {
      if (mediaGroupCache[groupId] && mediaGroupCache[groupId][0].caption) {
        try {
          // Отправляем все фотографии в канал как медиа-группу
          await ctx.api.sendMediaGroup(
            destinationChatId,
            mediaGroupCache[groupId]
          );
          const externalIDtosend = externalID;
          externalID = "";
          await ctx.reply(
            `🟢Запрос отправлен.\nBova ID: \`${externalIDtosend}\``,
            {
              ...reply,
              parse_mode: "Markdown",
            }
          );
        } catch (error) {
          console.error("Ошибка при отправке фото:", error);
          await ctx.reply(
            "Произошла ошибка при пересылке. Пожалуйста, попробуйте снова."
          );
        }

        // Очищаем кеш для этой группы
        delete mediaGroupCache[groupId];
        delete mediaGroupTimers[groupId];
      } else {
        await ctx.reply("❗️Прикрепите к чекам запрос.");
      }
    }, 1500); // Увеличили таймер до 1000 мс для более точной обработки всех фото
  } else if (message.photo && message.caption) {
    // Если это не альбом, а одно сообщение с фото и текстом
    const media = [
      {
        type: "photo",
        media: message.photo[message.photo.length - 1].file_id, // Берем последнее фото (наибольший размер)
        caption: messageToSend,
      },
    ];
    try {
      await ctx.api.sendMediaGroup(destinationChatId, media);
      await ctx.reply(`🟢Запрос отправлен.\nBova ID: \`${externalID}\``, {
        ...reply,
        parse_mode: "Markdown",
      });
    } catch (error) {
      console.error("Ошибка при отправке фото:", error);
      await ctx.reply(
        "Произошла ошибка при пересылке. Пожалуйста, попробуйте снова.",
        reply
      );
      return;
    }
  } else if (message.document && message.caption) {
    const media = [
      {
        type: "document",
        media: message.document.file_id, // Берем последнее фото (наибольший размер)
        caption: messageToSend,
      },
    ];
    try {
      await ctx.api.sendMediaGroup(destinationChatId, media);
      await ctx.reply(`🟢Запрос отправлен.\nBova ID: \`${externalID}\``, {
        ...reply,
        parse_mode: "Markdown",
      });
    } catch (error) {
      console.error("Ошибка при отправке фото:", error);
      await ctx.reply(
        "Произошла ошибка при пересылке. Пожалуйста, попробуйте снова.",
        reply
      );
      return;
    }
  } else {
    await ctx.reply("❗️Отправьте чек с запросом.", reply);
  }
});

bot.start({ drop_pending_updates: true });
