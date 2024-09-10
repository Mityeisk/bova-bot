import dotenv from "dotenv";
import { Bot } from "grammy";
import axios from "axios";
import {
  getExternalID,
  handlePdfPngError,
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
    { command: "details", description: "Запрос реквизитов" },
    // { command: "message", description: "Отправить произвольное сообщение" },
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
  const parts = messageText.split(" ");
  if (parts.length !== 2 || !/^\d{14}$/.test(parts[1])) {
    // Неправильный формат запроса
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

  const orderID = parts[1];

  try {
    const response = await axios.get(
      "https://api-crm.bovapay.com/tables/get_id/590",
      {
        params: {
          direction: "m2b",
          id: orderID, // Отправляем ID в теле запроса
        },
      }
    );

    // Парсинг HTML
    const responseHtml = cheerio.load(response.data, { decodeEntities: false });

    // Извлечение значения h2 внутри div с классом "result"

    const externalId = responseHtml(".result h2").text();
    const requsit = responseHtml(".result tr:nth-child(2) td.pl").text();
    const bank = responseHtml(".result tr:nth-child(3) td.pl").text();
    const sum = responseHtml(".result tr:nth-child(4) td.pl").text();
    ctx.reply(
      `Реквизиты👀\nОрдер: \`${orderID}\`\nBova ID: \`${externalId}\`\nПолучатель: \`${requsit}\`\nБанк: \`${bank}\`\nСумма: \`${sum}\`
      `,

      {
        parse_mode: "Markdown",
        ...reply,
      }
    );
  } catch (error) {
    ctx.reply(
      "❗️Ошибка при выполнении запроса: данный айди не существует или произошел сбой.",
      reply
    );
    return;
  }
});

bot.command("kill", async (ctx) => {
  const recievedChatId = ctx.chat.id;

  if (recievedChatId.toString() !== senderChatId) {
    return; // Игнорируем сообщения из других чатов
  }

  const userId = ctx.from.id;

  try {
    // Получаем информацию о правах пользователя
    const chatMember = await ctx.getChatMember(userId);

    // Проверяем, является ли пользователь администратором или создателем
    if (
      chatMember.status === "administrator" ||
      chatMember.status === "creator"
    ) {
      // Если администратор, то останавливаем сервер
      await ctx.reply("Бот остановлен.");
      console.log("Бот остановлен администратором");
      process.exit(0); // Завершение процесса
    } else {
      // Если не администратор, отправляем сообщение об ошибцке!
      await ctx.reply("У вас нет прав для выполнения этой команды.");
    }
  } catch (error) {
    console.error("Ошибка получения информации о пользователе:", error);
    await ctx.reply("Произошла ошибка при проверке ваших прав.");
  }
});

const APPROVED_MESSAGE = "✅ Первичный спор одобрен. Платёж зачислен";
const DECLINED_MESSAGE_AGAIN = "❌ Повторный спор отклонён.";
const DECLINED_MESSAGE_FIRST = "❌ Первичный спор отклонён.";

bot.on("edit", async (ctx) => {
  console.log(ctx);
  console.log(ctx.update.edited_channel_post.caption);
  const editedMessage = ctx.editedChannelPost;
  // Проверяем, что сообщение отредактировано в нужном канале
  if (
    editedMessage.chat.id == destinationChatId &&
    ctx.update.edited_channel_post.caption
  ) {
    const messageText =
      editedMessage.text || ctx.update.edited_channel_post.caption;

    // Проверяем, содержит ли сообщение одну из нужных фраз
    if (
      messageText.includes(APPROVED_MESSAGE) ||
      messageText.includes(DECLINED_MESSAGE_FIRST) ||
      messageText.includes(DECLINED_MESSAGE_AGAIN)
    ) {
      // Убираем "-100" из CHANNEL_ID, чтобы использовать для ссылки
      const positiveChannelId = String(destinationChatId).replace("-100", ""); // Превращаем в положительное число

      // Формируем ссылку на сообщение
      const messageLink = `https://t.me/c/${positiveChannelId}/${editedMessage.message_id}`;

      // Формируем текст уведомления
      const notificationText = `${messageText}\n\nСсылка на сообщение: ${messageLink}`;

      // Отправляем уведомление (можно отправить в другой чат или администратору)
      await ctx.api.sendMessage(senderChatId, notificationText);
    }
  }
});

bot.on("message", async (ctx) => {
  const recievedChatId = ctx.chat.id;

  if (recievedChatId.toString() !== senderChatId) {
    return; // Игнорируем сообщения из других чатов
  }

  let messageToSend = "";

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
    console.log(order);
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

  if (message.media_group_id || message.document) {
    const groupId = message.media_group_id;

    // Если это часть альбома, добавляем сообщение в кеш
    if (!mediaGroupCache[groupId]) {
      mediaGroupCache[groupId] = [];
    }
    //message.document.mime_type === "application/pdf" ||
    if (
      message.document &&
      (message.document.mime_type === "image/png" ||
        message.document.mime_type === "image/png" ||
        message.document.mime_type === "image/jpeg")
    ) {
      await handlePdfPngError(ctx, groupId);
      return;
    }
    console.log("123");
    // Сохраняем фото в кешq
    mediaGroupCache[groupId].push({
      type: "photo",
      media: message.photo[message.photo.length - 1].file_id, // Самое большое фото
      caption: messageToSend || "", // Только одно сообщение может содержать подпись
    });

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
  } else {
    await ctx.reply("❗️Отправьте чек с запросом.", reply);
  }
});

bot.start({ drop_pending_updates: true });
