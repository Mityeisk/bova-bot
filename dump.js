import dotenv from "dotenv";
import { Bot } from "grammy";
import axios from "axios";
import * as cheerio from "cheerio";

dotenv.config();
const bot = new Bot(process.env.BOT_API_KEY);
const senderChatId = process.env.SENDER_CHAT_ID;
const destinationChatId = process.env.DESTINATION_CHAT_ID;
const processedMediaGroups = {};

const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 час в миллисекундах
setInterval(() => {
  console.log("Очистка памяти...");
  for (const mediaGroupId in processedMediaGroups) {
    delete processedMediaGroups[mediaGroupId];
  }
  console.log("Память очищена.");
}, CLEANUP_INTERVAL);

bot.api.setMyCommands(
  [
    { command: "details", description: "Запрос реквизитов" },
    { command: "message", description: "Отправить произвольное сообщение" },
  ],
  {
    scope: {
      type: "chat",
      chat_id: senderChatId,
    },
  }
);

// bot.command("start", (ctx) => console.log(ctx.chat.id)); // Выводит chat_id канала);

async function handleMessage(ctx) {
  const recievedChatId = ctx.chat.id;
  if (recievedChatId.toString() !== senderChatId) {
    return; // Игнорируем сообщения из других чатов
  }

  const userMessageId = ctx.message.message_id;
  const reply = {
    reply_to_message_id: userMessageId, // Указываем ID сообщения, на которое нужно ответить
  };

  if (ctx.message.new_chat_members) {
    return;
  }

  if (ctx.message.left_chat_member || ctx.message.left_chat_participant) {
    return; // Выходим из функции, не реагируя на такие сообщения
  }

  const messageText = ctx.message.text?.trim() || ctx.message.caption?.trim();
  const parts = messageText.split(" ");

  let secondPart = "";
  if (parts[1]) {
    secondPart = parts[1].split("\n")[0];
  }

  if (!/^\d{14}$/.test(parts[0]) || isNaN(secondPart)) {
    // Неправильный формат запросаы
    await ctx.reply(
      '❗️Неправильный запрос. Отсутвует ордер или логин"',
      reply
    );
    return;
  }

  const file = ctx.message.document || ctx.message.photo;

  // Проверка наличия текста и файла/изображения

  if (!file) {
    await ctx.reply(
      "❗️Неправильный запрос: отсутствует файл или изображение.",
      reply
    );
    return;
  }

  // Проверка, что текст содержит два числа, разделённых пробелом

  const order = parts[0];
  const login = parts[1];
  const messageAfter = parts.slice(2).join(" ");

  // получение externalID
  const externalID = await getExternalID(order, ctx);
  if (typeof externalID === "object") {
    ctx.reply(
      "❗️Ошибка при выполнении запроса: данный айди не существует или произошел сбой.",
      reply
    );
    return;
  }

  // Формирование сообщения для канала

  // Отправка сообщения в канал вместе с файлом/изображением
  const messageToSend = `${externalID}\n${order} ${login && `${login}`}${
    messageAfter && `${messageAfter}`
  }`;

  if (ctx.message.document) {
    await bot.api.sendDocument(
      destinationChatId,
      ctx.message.document.file_id,
      {
        caption: messageToSend,
      }
    );
  } else if (ctx.message.photo) {
    await bot.api.sendPhoto(destinationChatId, ctx.message.photo[0].file_id, {
      caption: messageToSend,
    });
  }
  // Уведомление пользователя о успешной отправке
  const messageSendNotification = `🟢Запрос отправлен.\nBova ID: \`${externalID}\`.`;
  await bot.api.sendMessage(senderChatId, messageSendNotification, {
    parse_mode: "Markdown",
    reply_to_message_id: userMessageId,
  });
}

async function getExternalID(orderId, ctx) {
  try {
    const response = await axios.get(
      "https://api-crm.bovapay.com/tables/get_id/590",
      {
        params: {
          direction: "m2b",
          id: orderId, // Отправляем ID в теле запроса
        },
      }
    );

    // Парсинг HTML
    const responseHtml = cheerio.load(response.data);

    // Извлечение значения h2 внутри div с классом "result"
    const externalId = responseHtml(".result h2").text();
    return externalId;
  } catch (error) {
    return error;
  }
}
bot.command("message", async (ctx) => {
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
  if (parts.length < 2) {
    // Неправильный формат запроса
    await ctx.reply(
      '❗️Неправильный запрос. Формат: "/details <ордер>".',
      reply
    );
    return;
  }

  try {
    const textAfterCommand = parts.slice(1).join(" ");
    console.log(textAfterCommand);
    const senderMessage = `✅ Сообщение отправлено.`;
    await bot.api.sendMessage(destinationChatId, textAfterCommand);
    await bot.api.sendMessage(senderChatId, senderMessage);
  } catch (error) {
    await bot.api.sendMessage(
      senderChatId,
      "Произошла ошибка при отправке сообщения"
    );
  }
});

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
    await ctx.reply(
      '❗️Неправильный запрос. Формат: "/details <ордер>".',
      reply
    );
    return;
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

bot.on("message", handleMessage);

bot.on([":photo", ":document"], async (ctx) => {
  // Проверяем, что сообщение является частью медиа-группы
  try {
    const userMessageId = ctx.message.message_id;
    const reply = {
      reply_to_message_id: userMessageId, // Указываем ID сообщения, на которое нужно ответить
    };
    const fileType = ctx.message.document || ctx.message.photo;

    if (ctx.message.media_group_id) {
      const mediaGroupId = ctx.message.media_group_id;

      // Проверяем, был ли уже обработан этот media_group_idq
      if (!processedMediaGroups[mediaGroupId]) {
        // Отметьте, что этот media_group_id был обработан
        processedMediaGroups[mediaGroupId] = true;

        // Ваш код обработки первого PDF в медиагруппе
        if (ctx.message.document)
          await ctx.reply(
            "❗️Отправлено 2 PDF документа. Сконвертируйте файлы командой /toImage и отправьте чеки изображением.",
            reply
          );
        if (ctx.message.photo)
          await ctx.reply("❗️Прикрепите к изображениям запрос.", reply);
        return;
      } else {
        delete processedMediaGroups[mediaGroupId];
        console.log(processedMediaGroups);
        return;
      }
    }

    await ctx.reply("❗️Прикрепите изображение/PDF к запросу.", reply);
  } catch (error) {
    return;
  }
});

bot.command("kill", async (ctx) => {
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
bot.command("get_value", async (ctx) => {
  const userInput = ctx.message?.text?.split(" ")[1];

  if (!userInput) {
    await ctx.reply("Пожалуйста, укажите ID в формате /get_value <ID>");
    return;
  }

  try {
    const response = await axios.get(
      "https://api-crm.bovapay.com/tables/get_id/590",
      {
        params: {
          direction: "m2b",
          id: userInput, // Отправляем ID в теле запроса
        },
      }
    );

    // Парсинг HTML
    const responseHtml = cheerio.load(response.data);

    // Извлечение значения h2 внутри div с классом "result"
    const externalId = responseHtml(".result h2").text();
    const senderMessage = `✅ Запрос отправлен.\n\nBova ID: \`${externalId}\``;
    await bot.api.sendMessage(destinationChatId, `External ID: ${externalId}`);
    await bot.api.sendMessage(senderChatId, senderMessage, {
      parse_mode: "Markdown",
    });

    console.log("Сообщение отправлено в канал!");
  } catch (error) {
    console.error("Ошибка при выполнении запроса:", error);
    await ctx.reply("Произошла ошибка при выполнении запроса.");
  }
});

bot.start({ drop_pending_updates: true });
