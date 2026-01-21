Окей, давай разберу проект и подумаю о потенциальных проблемах. Сначала посмотрю, что это за расширение.

[10 tools called]

Окей, изучил проект. Сейчас пройдусь по потенциальным проблемам, которые могут вызвать негатив после публикации, и предложу решения.

## Основные риски негативных отзывов:

### 1. **Конфликты с обновлениями ChatGPT UI**
**Проблема:** OpenAI часто меняет структуру DOM ChatGPT. Твое расширение завязано на селекторы `[data-message-id]`, `[data-message-author-role]`. После обновления UI навигация может перестать работать.

**Защита:**
- Добавь фоллбэк-стратегию с несколькими способами поиска сообщений (у тебя уже есть, но можно усилить)
- Добавь версионирование и логику определения версии ChatGPT UI
- Сделай graceful degradation: если навигация не работает, хотя бы снипеты остаются доступны

### 2. **"Расширение тормозит ChatGPT!"**
**Проблема:** В `content.js` строка 214 - слушаешь `mouseup` на всем документе. При длинных беседах это может вызывать лаги, особенно если каждый клик триггерит `buildSnippetFromSelection()`.

**Защита:**
- Добавь throttling/debouncing для `handleSelection`
- Добавь check на минимальную длину выделения (чтобы не обрабатывать случайные клики)
- Замерь performance и добавь в описание "lightweight" только если это правда

```javascript
// Пример debounce
const handleSelectionDebounced = debounce(handleSelection, 100);
document.addEventListener('mouseup', handleSelectionDebounced);
```

### 3. **"Снипеты исчезли после очистки кэша!"**
**Проблема:** Используешь `chrome.storage.local` - хорошо, но юзеры не всегда понимают, что это локально.

**Защита:**
- Добавь предупреждение при первом запуске: "Снипеты хранятся локально. Используйте Export для бэкапа"
- Добавь автоэкспорт периодический (опционально)
- В UI добавь индикатор последнего бэкапа

### 4. **"Навигация не работает в старых беседах!"**
**Проблема:** В длинных беседах сообщения могут не загружаться (lazy loading). Когда кликаешь на снипет, messageBlock может быть не в DOM.

**Защита:**
```javascript
// В navigation.js добавь проверку и скролл до загрузки
export function navigateToSource(snippet) {
  // ... existing code ...
  
  if (!messageBlock && anchor.conversationId === currentConversationId) {
    // Попробуй проскроллить вверх/вниз для trigger lazy load
    attemptScrollLoad(anchor);
    return false; // или показать toast "Scroll to load messages"
  }
}
```

### 5. **"Расширение ломает копирование текста!"**
**Проблема:** Автосохранение при каждом выделении может раздражать. Юзер хочет просто скопировать текст, а не сохранять его.

**Защита:**
- Добавь настройку: автосохранение ON/OFF
- Или используй Ctrl+S / кнопку для явного сохранения
- Добавь "Undo last save" функцию

### 6. **"UI блокирует контент ChatGPT!"**
**Проблема:** FAB кнопка справа может перекрывать контент на маленьких экранах или конфликтовать с другими расширениями.

**Защита:**
- Сделай FAB драггабл (можно перетаскивать)
- Добавь опцию скрыть FAB (hotkey)
- Добавь auto-hide при скроллинге

### 7. **"Не могу найти свои снипеты!"**
**Проблема:** В длинном списке снипетов (100+) искать сложно.

**Защита:**
- Добавь фильтры по дате, по беседам
- Добавь теги/категории
- Укажи количество результатов в списке

### 8. **"Экспорт/импорт не работает с другими браузерами!"**
**Проблема:** Юзер экспортирует JSON, меняет браузер, импортирует - а anchor'ы не работают из-за разных conversationId.

**Защита:**
- Добавь в экспорт metadata о версии расширения
- Валидация при импорте с понятными ошибками
- Предупреждение о cross-browser limitations

### 9. **"Privacy policy с placeholder email!"**
**Проблема:** В `PRIVACY_POLICY.md` строка 21 - `support@example.com` - выглядит непрофессионально.

**Защита:**
- Замени на реальный email или форму обратной связи
- Или укажи GitHub Issues

### 10. **"Расширение запрашивает подозрительные permissions!"**
**Проблема:** Юзеры параноят насчет privacy. Хотя у тебя только `storage`, некоторые могут бояться.

**Защита:**
- В описании Store подробно объясни зачем каждый permission
- Добавь бейдж "No analytics, No tracking"
- Open source это на GitHub и добавь ссылку

## Конкретные баги, которые я заметил:

### 1. **Duplicate snippet на быстром выделении**
В `content.js` строка 239-264: timeout 10ms может не хватить, и будут дубликаты при быстром двойном клике.

**Исправление:**
```javascript
let lastSnippetHash = null;
let lastSnippetTime = 0;

function handleSelection(e) {
  setTimeout(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return;
    }
    
    const snippet = buildSnippetFromSelection();
    if (snippet) {
      // Dedupe check
      const now = Date.now();
      const hash = hashText(snippet.text);
      if (hash === lastSnippetHash && now - lastSnippetTime < 1000) {
        return; // Skip duplicate
      }
      lastSnippetHash = hash;
      lastSnippetTime = now;
      
      addSnippet(snippet);
      // ...
    }
  }, 10);
}
```

### 2. **Navigation mutates DOM permanently**
В `navigation.js` строка 136: `range.deleteContents()` удаляет оригинальный контент и вставляет span. Если что-то пойдет не так, текст может пропасть.

**Исправление:**
```javascript
// Используй CSS class на родителе вместо мутации DOM
const highlight = document.createElement('mark');
highlight.className = 'ce-highlight-transient';
try {
  range.surroundContents(highlight); // Безопаснее чем deleteContents
  // ...
} catch {
  // Fallback
}
```

### 3. **No error boundary for storage failures**
Если `chrome.storage.local` заполнен (quota exceeded), юзер не узнает почему не сохраняется.

**Исправление:**
Добавь в `storage.js` обработку ошибок с понятными сообщениями.

## Рекомендации по Store Listing:

1. **Добавь скриншоты высокого качества** - без них conversion будет низкий
2. **Видео demo (опционально)** - показывает как работает, снижает негатив от непонятного UX
3. **FAQ в описании:**
   - "Где хранятся мои данные?" → Локально
   - "Работает ли офлайн?" → Да
   - "Совместимо с другими расширениями?" → Да
4. **Укажи ограничения честно:**
   - "Может не работать после обновлений ChatGPT UI"
   - "Навигация работает только в текущей беседе"

## Что добавить до публикации (по приоритету):

### High priority:
1. ✅ Исправить `support@example.com` в Privacy Policy
2. ✅ Добавить dedupe для быстрых кликов
3. ✅ Добавить минимальную длину выделения (например, 3 символа)
4. ✅ Добавить настройку автосохранения (ON/OFF)
5. ✅ Добавить обработку quota exceeded для storage

### Medium priority:
6. Добавить поиск по снипетам (у тебя уже есть UI для этого!)
7. Добавить undo last save
8. Улучшить performance (debounce на mouseup)
9. Сделать FAB draggable

### Low priority (но желательно):
10. Автоэкспорт/бэкап reminder
11. Теги для снипетов
12. Dark mode support
13. Keyboard shortcuts (Ctrl+S для save)
