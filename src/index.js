// Файл: src/index.js
// To-Do List бот с интерфейсом на Inline-кнопках

import { Client } from '@neondatabase/serverless';

export default {
    async fetch(request, env, ctx) {
        if (request.method === 'POST') {
            try {
                const update = await request.json();

                // Обработка нажатий на Inline-кнопки
                if (update.callback_query) {
                    await handleCallbackQuery(update.callback_query, env);
                }
                // Обработка текстовых сообщений
                else if (update.message && update.message.text) {
                    const message = update.message;
                    const text = message.text;

                    // Единственная команда, которую мы оставим - /start
                    if (text === '/start') {
                        await handleStart(message, env);
                    } else {
                        // Любой другой текст - это новая задача
                        await handleAddTask(message, env);
                    }
                }
            } catch (e) {
                console.error("Fetch Error:", e);
            }
        }
        return new Response('OK');
    },
};

// --- Обработчики ---

async function handleStart(message, env) {
    const replyText = `Привет, ${message.from.first_name}!\n\nПросто отправь мне текст, и я добавлю его как задачу. Нажми кнопку ниже, чтобы увидеть свой список.`;
    await sendMessage(env.BOT_TOKEN, message.chat.id, replyText, {
        reply_markup: {
            inline_keyboard: [[{ text: '📋 Показать задачи', callback_data: 'list_tasks' }]]
        }
    });
}

// Теперь эта функция просто добавляет задачу
async function handleAddTask(message, env) {
    const chatId = message.chat.id;
    const taskText = message.text.trim();

    if (!taskText) {
        await sendMessage(env.BOT_TOKEN, chatId, "Пустая задача не может быть добавлена.");
        return;
    }

    const client = new Client(env.DB_URL);
    try {
        await client.connect();
        await client.query(`INSERT INTO tasks (chat_id, task_text) VALUES ($1, $2)`, [chatId, taskText]);
        
        await env.BOT_STATES_UNIVERSAL.delete(`tasks_${chatId}`); // Очищаем кэш

        // Отправляем подтверждение и сразу обновленный список задач
        await sendMessage(env.BOT_TOKEN, chatId, `✅ Задача добавлена: "${taskText}"`);
        await sendTaskList(chatId, env); // Показываем обновленный список
        
    } catch (e) {
        console.error("DB Error on add:", e);
        await sendMessage(env.BOT_TOKEN, chatId, "Произошла ошибка при добавлении задачи.");
    } finally {
        await client.end();
    }
}

// Основная функция для показа списка задач
// ИСПРАВЛЕННАЯ ВЕРСИЯ
async function sendTaskList(chatId, env) {
    let tasks = [];

    const cachedTasks = await env.BOT_STATES_UNIVERSAL.get(`tasks_${chatId}`, "json");
    if (cachedTasks) {
        console.log("Данные взяты из кэша!");
        tasks = cachedTasks;
    } else {
        console.log("Кэш пуст, читаю из БД...");
        const client = new Client(env.DB_URL);
        try {
            await client.connect();
            const res = await client.query('SELECT id, task_text FROM tasks WHERE chat_id = $1 AND is_done = FALSE ORDER BY created_at ASC', [chatId]);
            tasks = res.rows;
            await env.BOT_STATES_UNIVERSAL.put(`tasks_${chatId}`, JSON.stringify(tasks), { expirationTtl: 60 });
        } catch (e) {
            console.error("DB Error on list:", e);
            await sendMessage(env.BOT_TOKEN, chatId, "Произошла ошибка при получении списка задач.");
            return;
        } finally {
            await client.end();
        }
    }

    let replyText = "📝 *Ваш список задач:*\n\n";
    if (tasks.length === 0) {
        replyText = "🎉 У вас нет активных задач! Просто напишите мне что-нибудь, чтобы добавить первую.";
    } else {
        tasks.forEach((task, index) => {
            replyText += `${index + 1}. \`${task.task_text}\`\n`;
        });
    }

    // Создаем Inline-кнопки
    const keyboard = {
        inline_keyboard: [
            // ИСПРАВЛЕНИЕ: Добавили (task, index) в map
            ...tasks.map((task, index) => ([{
                text: `✅ Выполнить: "${task.task_text.substring(0, 20)}..."`, // Делаем текст кнопки короче
                callback_data: `delete_${task.id}`
            }])),
            // Вторая строка - кнопка обновления
            [{ text: '🔄 Обновить список', callback_data: 'list_tasks' }]
        ]
    };

    await sendMessage(env.BOT_TOKEN, chatId, replyText, {
        reply_markup: keyboard,
        parse_mode: 'Markdown'
    });
}


async function handleCallbackQuery(callbackQuery, env) {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;

    // Сразу отвечаем, чтобы убрать "часики"
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id);

    // Роутер для кнопок
    if (data === 'list_tasks') {
        // Редактируем существующее сообщение, чтобы показать обновленный список
        await editTaskList(chatId, callbackQuery.message.message_id, env);
    } 
    else if (data.startsWith('delete_')) {
        const taskId = parseInt(data.substring(7));
        
        const client = new Client(env.DB_URL);
        try {
            await client.connect();
            const res = await client.query(`UPDATE tasks SET is_done = TRUE WHERE id = $1 AND chat_id = $2`, [taskId, chatId]);
            
            if (res.rowCount > 0) {
                await env.BOT_STATES_UNIVERSAL.delete(`tasks_${chatId}`); // Очищаем кэш
                // Редактируем сообщение, чтобы обновить список после удаления
                await editTaskList(chatId, callbackQuery.message.message_id, env);
            }
        } catch (e) {
            console.error("DB Error on delete:", e);
            await sendMessage(env.BOT_TOKEN, chatId, "Произошла ошибка при удалении задачи.");
        } finally {
            await client.end();
        }
    }
}


// --- Вспомогательные функции ---
// (sendMessage, answerCallbackQuery, editMessageText - без изменений)
// Новая функция editTaskList
// ИСПРАВЛЕННАЯ ВЕРСИЯ
async function editTaskList(chatId, messageId, env) {
    let tasks = [];

    const cachedTasks = await env.BOT_STATES_UNIVERSAL.get(`tasks_${chatId}`, "json");
    if (cachedTasks) {
        tasks = cachedTasks;
    } else {
        const client = new Client(env.DB_URL);
        try {
            await client.connect();
            const res = await client.query('SELECT id, task_text FROM tasks WHERE chat_id = $1 AND is_done = FALSE ORDER BY created_at ASC', [chatId]);
            tasks = res.rows;
            await env.BOT_STATES_UNIVERSAL.put(`tasks_${chatId}`, JSON.stringify(tasks), { expirationTtl: 60 });
        } catch (e) { /* ... обработка ошибок ... */ } 
        finally { await client.end(); }
    }

    let replyText = "📝 *Ваш список задач:*\n\n";
    if (tasks.length === 0) {
        replyText = "🎉 У вас нет активных задач!";
    } else {
        tasks.forEach((task, index) => {
            replyText += `${index + 1}. \`${task.task_text}\`\n`;
        });
    }

    const keyboard = {
        inline_keyboard: [
             // ИСПРАВЛЕНИЕ: Добавили (task, index) в map
            ...tasks.map((task, index) => ([{
                text: `✅ Выполнить: "${task.task_text.substring(0, 20)}..."`,
                callback_data: `delete_${task.id}`
            }])),
            [{ text: '🔄 Обновить список', callback_data: 'list_tasks' }]
        ]
    };
    
    await editMessageText(env.BOT_TOKEN, chatId, messageId, replyText, {
        reply_markup: keyboard,
        parse_mode: 'Markdown'
    });
}
async function sendMessage(botToken, chatId, text, options = {}) {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const payload = { chat_id: chatId, text: text, ...options };
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    return response.json();
}

async function answerCallbackQuery(botToken, callbackQueryId) {
    const url = `https://api.telegram.org/bot${botToken}/answerCallbackQuery`;
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId }),
    });
}

async function editMessageText(botToken, chatId, messageId, text, options = {}) {
    const url = `https://api.telegram.org/bot${botToken}/editMessageText`;
    const payload = { chat_id: chatId, message_id: messageId, text: text, ...options };
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
}