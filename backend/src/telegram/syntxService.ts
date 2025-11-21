import { TelegramClient, Api } from "telegram";
import * as fs from "fs";
import * as path from "path";
import { getTelegramClient } from "./client";
import { getAllJobs } from "../firebase/videoJobsService";

/**
 * Упрощённая реализация скачивания видео от Syntax-бота.
 * 
 * ПРИМЕЧАНИЕ: Мы сознательно используем простой подход вместо сложной привязки по jobId,
 * так как сложная логика с маркерами и poller приводила к нестабильной работе:
 * задачи оставались в статусе "Ожидаем видео", даже когда видео уже было в Telegram.
 * 
 * Текущий алгоритм:
 * 1. Отправляем промпт в Telegram
 * 2. Ищем видео по reply_to_message_id (приоритет 1)
 * 3. Если не найдено, берём самое новое видео новее нашего запроса (fallback)
 * 
 * В будущем можно улучшить обработку параллельных задач, но сейчас приоритет - стабильность.
 */

export interface SyntxResult {
  localPath: string;
  requestMessageId: number;
  videoMessageId: number; // ID сообщения с видео от бота
}

export async function sendPromptToSyntx(
  prompt: string,
  customFileName?: string,
  requestMessageId?: number // Если передан, используем существующий requestMessageId (для повторных попыток)
): Promise<SyntxResult> {
  const client = await getTelegramClient();
  const botUsername = process.env.SYNTX_BOT_USERNAME || "syntxaibot";

  try {
    // Проверяем, что клиент авторизован
    const isAuthorized = await client.checkAuthorization();
    if (!isAuthorized) {
      throw new Error("Telegram клиент не авторизован. Выполните авторизацию перед использованием.");
    }

    console.log(`[VideoJob] Start job: отправка промпта боту ${botUsername}...`);
    
    // Получаем чат бота
    const entity = await client.getEntity(botUsername);
    
    // Отправляем промпт
    let actualRequestMessageId: number;
    if (requestMessageId) {
      // Если передан requestMessageId, используем его (для повторных попыток)
      actualRequestMessageId = requestMessageId;
      console.log(`[VideoJob] Используем существующий requestMessageId: ${actualRequestMessageId}`);
    } else {
      // Иначе отправляем новое сообщение
      console.log(`[VideoJob] Отправляем промпт боту ${botUsername}...`);
      const sentMessage = await client.sendMessage(entity, { message: prompt });
      actualRequestMessageId = sentMessage.id;
      console.log(`[VideoJob] ✅ Промпт отправлен боту ${botUsername}, message ID: ${actualRequestMessageId}`);
    }

    console.log(`[VideoJob] Waiting for new Telegram video after message ${actualRequestMessageId} (таймаут: 15 минут)...`);

    // Получаем список уже использованных видео для предотвращения дубликатов
    const usedVideoMessageIds = await getUsedVideoMessageIds();

    // Ждём видеосообщение, связанное с нашим запросом
    const videoMessage = await waitForSyntxVideo(
      client,
      entity,
      actualRequestMessageId,
      15 * 60 * 1000, // 15 минут
      usedVideoMessageIds
    );

    console.log(`[VideoJob] Found video message: messageId=${videoMessage.id}`);

    // Подготавливаем директорию для загрузок с абсолютным путём
    const downloadRoot = process.env.DOWNLOAD_DIR || "./downloads";
    const downloadDir = path.resolve(downloadRoot);
    
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
      console.log(`[VideoJob] Создана директория для загрузок: ${downloadDir}`);
    }
    
    console.log(`[VideoJob] Download directory: ${downloadDir}`);

    // Генерируем имя файла (используем customFileName если указан, иначе дефолтное)
    const timestamp = Date.now();
    const fileName = customFileName || `syntx_${timestamp}.mp4`;
    const filePath = path.join(downloadDir, fileName);
    
    console.log(`[VideoJob] Target file path: ${filePath}`);

    // Логируем информацию о медиа перед скачиванием
    console.log("[VideoJob] Message media info:", {
      messageId: videoMessage.id,
      hasMedia: !!videoMessage.media,
      mediaType: videoMessage.media?.constructor?.name || "unknown",
    });

    // Скачиваем видео с проверкой результата
    console.log("[VideoJob] Starting download...");
    
    try {
      // Пробуем скачать через опцию file
      await client.downloadMedia(videoMessage, {
        outputFile: filePath,
      });

      // Проверяем, что файл реально появился
      await new Promise((resolve) => setTimeout(resolve, 500)); // Небольшая задержка для завершения записи
      
      if (!fs.existsSync(filePath)) {
        throw new Error(`File was not created at ${filePath}`);
      }

      const stat = fs.statSync(filePath);
      console.log(`[VideoJob] File downloaded, size: ${stat.size} bytes`);
      
      if (stat.size === 0) {
        throw new Error("Downloaded file has size 0 bytes");
      }

      console.log(`[VideoJob] ✅ Видео успешно скачано: ${filePath}`);
      return {
        localPath: filePath,
        requestMessageId: actualRequestMessageId,
        videoMessageId: videoMessage.id,
      };
    } catch (err: any) {
      console.error("[VideoJob] Error while downloading media (file mode):", err);
      
      // Если опция file не сработала, пробуем через Buffer
      console.log("[VideoJob] Trying buffer mode...");
      
      try {
        const buffer = (await client.downloadMedia(videoMessage, {})) as Buffer;
        
        if (!buffer || !buffer.length) {
          throw new Error("downloadMedia returned empty buffer");
        }

        fs.writeFileSync(filePath, buffer);
        const stat = fs.statSync(filePath);
        console.log(`[VideoJob] File saved (buffer mode), size: ${stat.size} bytes`);
        
        if (stat.size === 0) {
          throw new Error("Saved file has size 0 bytes");
        }

        console.log(`[VideoJob] ✅ Видео успешно скачано (buffer mode): ${filePath}`);
        return {
          localPath: filePath,
          requestMessageId: actualRequestMessageId,
          videoMessageId: videoMessage.id,
        };
      } catch (bufferErr: any) {
        console.error("[VideoJob] Error while downloading media (buffer mode):", bufferErr);
        throw new Error(`Failed to download media: ${err.message || err}. Buffer mode also failed: ${bufferErr.message || bufferErr}`);
      }
    }
  } catch (error: any) {
    console.error("[VideoJob] Ошибка в sendPromptToSyntx:", error);
    
    // Специальная обработка ошибки авторизации
    if (error.errorMessage === 'AUTH_KEY_UNREGISTERED' || error.message?.includes('AUTH_KEY_UNREGISTERED')) {
      throw new Error("Telegram клиент не авторизован. Выполните авторизацию в консоли backend сервера и перезапустите сервер.");
    }
    
    throw new Error(`Ошибка при работе с Telegram ботом: ${error.message || error}`);
  }
}

/**
 * Ожидает видео от Syntax-бота.
 * 
 * Алгоритм:
 * 1. Приоритет 1: Ищем видео с reply_to_message_id = requestMessageId (точное сопоставление)
 * 2. Приоритет 2: Если не найдено, берём самое новое видео новее нашего запроса (message.id > requestMessageId)
 *    и не старше 20 минут (защита от присвоения старых видео новым запросам)
 * 
 * Это простая, но стабильная логика, которая гарантирует, что каждое задание получит видео.
 */
async function waitForSyntxVideo(
  client: TelegramClient,
  chat: Api.TypeEntityLike,
  requestMessageId: number,
  timeoutMs: number,
  usedVideoMessageIds?: Set<number> // Множество уже использованных message_id видео
): Promise<Api.Message> {
  const startTime = Date.now();
  const pollInterval = 10000; // 10 секунд
  const botUsername = process.env.SYNTX_BOT_USERNAME || "syntxaibot";

  console.log(`[VideoJob] Ожидаем видео с reply_to_message_id = ${requestMessageId}`);
  if (usedVideoMessageIds && usedVideoMessageIds.size > 0) {
    console.log(`[VideoJob] Исключаем уже использованные видео: ${Array.from(usedVideoMessageIds).join(', ')}`);
  }

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Получаем последние сообщения из диалога с ботом
      const messages = await client.getMessages(chat, {
        limit: 50, // Увеличиваем лимит для надёжности
      });

      // Фильтруем сообщения с видео от бота
      const videoMessages: Api.Message[] = [];
      
      for (const message of messages) {
        // Проверяем, что сообщение от бота (не от нас)
        const fromId = message.fromId;
        if (fromId) {
          try {
            const sender = await client.getEntity(fromId);
            // Проверяем, что это сообщение от бота, а не от нас
            if (sender instanceof Api.User) {
              const senderUsername = sender.username?.toLowerCase();
              const expectedUsername = botUsername.toLowerCase().replace('@', '');
              if (senderUsername !== expectedUsername) {
                // Это не от нужного бота, пропускаем
                continue;
              }
            }
          } catch (e) {
            // Если не удалось получить информацию об отправителе, продолжаем проверку
          }
        }

        // Проверяем, есть ли видео
        if (message.media) {
          if (message.media instanceof Api.MessageMediaDocument) {
            const document = message.media.document;
            if (document instanceof Api.Document) {
              for (const attr of document.attributes) {
                if (attr instanceof Api.DocumentAttributeVideo) {
                  // Проверяем, что это видео не было уже использовано
                  if (usedVideoMessageIds && usedVideoMessageIds.has(message.id)) {
                    console.log(`[VideoJob] Пропускаем уже использованное видео с message ID: ${message.id}`);
                    continue;
                  }
                  videoMessages.push(message as Api.Message);
                  break;
                }
              }
            }
          } else if (message.media instanceof Api.MessageMediaPhoto) {
            // Пропускаем фото
            continue;
          }
        }
      }

      // Сортируем видео по ID (более новые первыми)
      videoMessages.sort((a, b) => b.id - a.id);

      // Приоритет 1: Ищем видео, которое является ответом на наш запрос через reply_to
      for (const message of videoMessages) {
        const replyTo = message.replyTo;
        
        if (replyTo && replyTo.replyToMsgId) {
          const replyToMsgId = replyTo.replyToMsgId;
          if (replyToMsgId === requestMessageId) {
            console.log(`[VideoJob] ✅ Видео найдено по reply_to: message ID: ${message.id}, reply_to: ${replyToMsgId}`);
            const document = (message.media as Api.MessageMediaDocument).document as Api.Document;
            for (const attr of document.attributes) {
              if (attr instanceof Api.DocumentAttributeVideo) {
                console.log(`[VideoJob] Video info: duration=${attr.duration}s, size=${document.size} bytes`);
                return message;
              }
            }
          }
        }
      }

      // Приоритет 2: Если не нашли по reply_to, используем fallback - берём самое новое видео новее нашего запроса
      // Это работает только если сообщение новее запроса (message.id > requestMessageId)
      for (const message of videoMessages) {
        if (message.id > requestMessageId) {
          // Проверяем, что это видео не слишком старое (не более 20 минут назад)
          // Это помогает избежать присвоения старых видео новым запросам
          // message.date - это Unix timestamp в секундах, умножаем на 1000 для миллисекунд
          const messageDate = message.date ? message.date * 1000 : 0;
          const maxAge = 20 * 60 * 1000; // 20 минут
          if (Date.now() - messageDate > maxAge) {
            console.log(`[VideoJob] Пропускаем слишком старое видео: message ID: ${message.id}, возраст: ${Math.round((Date.now() - messageDate) / 1000 / 60)} минут`);
            continue;
          }

          // Если у сообщения нет reply_to, но оно новее запроса и не использовано,
          // это может быть ответ на наш запрос (если бот не использует reply_to)
          console.log(`[VideoJob] ⚠️  Видео ${message.id} не имеет reply_to, но новее запроса ${requestMessageId}. Используем как fallback.`);
          const document = (message.media as Api.MessageMediaDocument).document as Api.Document;
          for (const attr of document.attributes) {
            if (attr instanceof Api.DocumentAttributeVideo) {
              console.log(`[VideoJob] Video info: duration=${attr.duration}s, size=${document.size} bytes`);
              return message;
            }
          }
        }
      }

      // Ждём перед следующей проверкой
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    } catch (error) {
      console.error("[VideoJob] Ошибка при ожидании видео:", error);
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }

  throw new Error(
    `Таймаут ожидания видео от бота ${botUsername} для запроса ${requestMessageId} (${timeoutMs / 1000} секунд)`
  );
}

/**
 * Получить множество уже использованных video message IDs из Firestore
 * Это предотвращает скачивание одного и того же видео для разных задач
 */
async function getUsedVideoMessageIds(): Promise<Set<number>> {
  try {
    const jobs = await getAllJobs();
    const usedIds = new Set<number>();
    
    for (const job of jobs) {
      if (job.telegramVideoMessageId) {
        usedIds.add(job.telegramVideoMessageId);
      }
    }
    
    console.log(`[VideoJob] Найдено ${usedIds.size} уже использованных video message IDs`);
    return usedIds;
  } catch (error) {
    console.error("[VideoJob] Ошибка при получении использованных video message IDs:", error);
    // В случае ошибки возвращаем пустое множество, чтобы не блокировать процесс
    return new Set<number>();
  }
}
