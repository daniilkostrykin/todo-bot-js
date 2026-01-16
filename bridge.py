import requests
import time
import os

# --- НАСТРОЙКИ ---
# Проверь, чтобы в URL было именно две буквы 'i' (daniilkostrykin1)
WORKER_URL = "https://todo-bot-js.daniilkostrykin1.workers.dev/update_qb"
QB_URL = "http://127.0.0.1:8080"
QB_USER = "admin"
QB_PASS = "admindanya" # Твой пароль от веб-интерфейса qBittorrent

def bridge():
    # Используем сессию, чтобы сохранять куки после входа
    session = requests.Session()
    
    try:
        print(f"🔑 Пытаюсь войти в qBittorrent на {QB_URL}...")
        login_res = session.post(f"{QB_URL}/api/v2/auth/login", data={'username': QB_USER, 'password': QB_PASS})
        if login_res.status_code != 200:
            print(f"❌ Ошибка входа! Проверь логин/пароль. Статус: {login_res.status_code}")
            return
        print("✅ Вход выполнен успешно.")
    except Exception as e:
        print(f"❌ Не удалось подключиться к qBittorrent: {e}")
        return

    print("🚀 Мост запущен. Теперь можно идти спать!")
    
    while True:
        try:
            # 1. Получаем инфо о торрентах
            q_res = session.get(f"{QB_URL}/api/v2/torrents/info")
            torrents = q_res.json()
            
            status_text = ""
            if not torrents:
                status_text = "Список торрентов пуст."
            else:
                for t in torrents:
                    # Округляем прогресс до одного знака
                    progress = round(t['progress'] * 100, 1)
                    status_text += f"🎬 {t['name'][:20]}..: {progress}%\n"

            # 2. Отправляем в Cloudflare KV
            r = requests.post(WORKER_URL, json={"status": status_text})
            resp = r.json()

            # 3. Проверяем команду на выключение
            if resp.get('cmd') == 'shutdown':
                print("🚨 ПОЛУЧЕНА КОМАНДА НА ВЫКЛЮЧЕНИЕ!")
                os.system("shutdown /s /t 60")
                break
            
            print(f"✅ Данные отправлены в Cloudflare. Торрентов в работе: {len(torrents)}")
            
        except Exception as e:
            print(f"⚠️ Ошибка в цикле: {e}")
        
        # Обновляем раз в 30 секунд
        time.sleep(300)

if __name__ == "__main__":
    bridge()