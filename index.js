const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const https = require('https');
const fs = require('fs');

const TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ZOE_PAGE_URL = "https://www.zoe.com.ua/%D0%B3%D1%80%D0%B0%D1%84%D1%96%D0%BA%D0%B8-%D0%BF%D0%BE%D0%B3%D0%BE%D0%B4%D0%B8%D0%BD%D0%BD%D0%B8%D1%85-%D1%81%D1%82%D0%B0%D0%B1%D1%96%D0%BB%D1%96%D0%B7%D0%B0%D1%86%D1%96%D0%B9%D0%BD%D0%B8%D1%85/";
const SAVE_FILE = 'last_header.txt'; 

// Проверка каждые 2 минуты
const CHECK_INTERVAL = 120000; 
const WORK_DURATION = (4 * 60 * 60 * 1000) + (50 * 60 * 1000);

const bot = new TelegramBot(TOKEN, { polling: false });
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let lastKnownHeader = '';

async function startLoop() {
    console.log("🚀 ЗАПУСК: Ориентация только на ЗАГОЛОВОК...");

    if (fs.existsSync(SAVE_FILE)) {
        lastKnownHeader = fs.readFileSync(SAVE_FILE, 'utf8').trim();
        console.log(`📂 В памяти: "${lastKnownHeader}"`);
    } else {
        console.log("📂 Память пуста. Первый найденный график будет считаться новым.");
    }

    const startTime = Date.now();

    while (true) {
        if (Date.now() - startTime > WORK_DURATION) {
            console.log("🛑 Смена окончена.");
            break; 
        }

        await checkSchedule();
        console.log(`⏳ Жду 2 минуты...`);
        await wait(CHECK_INTERVAL);
    }
}

async function checkSchedule() {
    const timeLabel = new Date().toLocaleTimeString('uk-UA', { timeZone: 'Europe/Kiev' });
    console.log(`[${timeLabel}] 🔄 Скачиваю...`);
    
    try {
        const response = await axios.get(ZOE_PAGE_URL + "?t=" + Date.now(), {
            timeout: 30000,
            httpsAgent: httpsAgent,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' }
        });

        if (response.status === 200) {
            const html = response.data;
            const plainText = convertHtmlToText(html);
            
            // Ищем заголовок и "тело" графика
            const result = findHeaderAndBody(plainText);

            if (result) {
                const currentHeader = result.header;
                const fullMessage = result.fullText;

                console.log(`🔍 Вижу заголовок на сайте: "${currentHeader}"`);

                // СРАВНИВАЕМ ТОЛЬКО ЗАГОЛОВКИ
                if (normalize(currentHeader) !== normalize(lastKnownHeader)) {
                    console.log(`🔥 ЗАГОЛОВОК ИЗМЕНИЛСЯ! \nБыло: "${lastKnownHeader}"\nСтало: "${currentHeader}"`);
                    console.log(`📤 Отправляю сообщение...`);
                    
                    await bot.sendMessage(CHAT_ID, fullMessage, { parse_mode: 'HTML', disable_web_page_preview: true });
                    
                    // Обновляем память и файл
                    lastKnownHeader = currentHeader;
                    fs.writeFileSync(SAVE_FILE, currentHeader); 
                } else {
                    console.log("💤 Заголовок совпадает с памятью. Молчу.");
                }
            } else {
                console.log("⚠️ Не смог найти строку с датой и словом ГПВ/ГРАФИК.");
                // Дебаг: показываем первые 5 строк, чтобы понять, что видит бот
                const debugLines = plainText.split('\n').slice(0, 5);
                console.log("👀 Первые строки текста:", debugLines);
            }
        }
    } catch (e) {
        console.log(`❌ Ошибка: ${e.message}`);
    }
}

// === УПРОЩЕННАЯ ЛОГИКА ===

function findHeaderAndBody(text) {
    const lines = text.split('\n');
    
    // Ищем строку, где есть ДАТА (число + месяц) И слово (ГПВ или ГРАФИК или ОНОВЛЕНО)
    // Пример: "26 ГРУДНЯ ПО ЗАПОРІЗЬКІЙ ОБЛАСТІ ДІЯТИМУТЬ ГПВ"
    const headerRegex = /(\d{1,2})[\s\.]+(СІЧНЯ|ЛЮТОГО|БЕРЕЗНЯ|КВІТНЯ|ТРАВНЯ|ЧЕРВНЯ|ЛИПНЯ|СЕРПНЯ|ВЕРЕСНЯ|ЖОВТНЯ|ЛИСТОПАДА|ГРУДНЯ|\d{2}).*(ГПВ|ГРАФІК|ОНОВЛЕНО|ДІЯТИМУТЬ)/i;

    let headerIndex = -1;
    let foundHeader = "";

    // 1. Находим строку заголовка
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.length < 5) continue;

        if (headerRegex.test(line)) {
            // Игнорируем строку, если это просто ссылка на схему
            if (line.includes("Орієнтовна схема")) continue;
            
            headerIndex = i;
            foundHeader = line;
            break; // Берем первый (самый верхний) найденный заголовок
        }
    }

    if (headerIndex === -1) return null; // Заголовок не найден

    // 2. Собираем сообщение: Заголовок + следующие 15 строк (чтобы захватить очереди)
    // Мы просто берем кусок текста после заголовка, не пытаясь его парсить.
    // Это гарантирует, что мы покажем очереди, даже если формат поменялся.
    
    let messageBody = lines.slice(headerIndex + 1, headerIndex + 25) // Берем с запасом 25 строк вниз
        .filter(l => l.trim().length > 0) // Убираем пустые
        .join('\n');

    const fullText = `⚡️ <b>${foundHeader}</b>\n\n${messageBody}`;

    return {
        header: foundHeader,
        fullText: fullText
    };
}

function normalize(text) {
    // Убираем пробелы и спецсимволы, оставляем только буквы/цифры для сравнения
    return text.replace(/[^a-zA-Zа-яА-Я0-9]/g, '').toLowerCase();
}

function convertHtmlToText(html) {
    let t = html;
    t = t.replace(/<style([\s\S]*?)<\/style>/gi, "").replace(/<script([\s\S]*?)<\/script>/gi, "");
    
    // Превращаем блоки в переносы строк
    t = t.replace(/<\/(div|p|tr|li|h[1-6])>/gi, "\n");
    t = t.replace(/<br\s*\/?>/gi, "\n");
    t = t.replace(/<\/td>/gi, " "); // Ячейки таблицы разделяем пробелом
    
    t = t.replace(/<[^>]+>/g, ""); // Удаляем теги
    
    // Чистим мусор
    t = t.replace(/&nbsp;/g, " ")
         .replace(/&#8211;/g, "-")
         .replace(/&ndash;/g, "-")
         .replace(/&#8217;/g, "'")
         .replace(/&quot;/g, '"');
         
    // Убираем лишние пробелы и пустые строки
    return t.split('\n').map(l => l.trim()).filter(l => l.length > 0).join('\n');
}

startLoop();
