// PromptKit 收藏助手 — Service Worker
let serverUrl = 'http://192.168.0.103:8080';

// 加载配置
chrome.storage.sync.get({ serverUrl: 'http://192.168.0.103:8080' }, function(items) {
    serverUrl = items.serverUrl;
});

// 监听配置变化
chrome.storage.onChanged.addListener(function(changes) {
    if (changes.serverUrl) {
        serverUrl = changes.serverUrl.newValue;
    }
});

// 创建右键菜单
chrome.runtime.onInstalled.addListener(function() {
    chrome.contextMenus.create({
        id: 'saveToPromptKit',
        title: '保存到 PromptKit',
        contexts: ['selection']
    });
    chrome.contextMenus.create({
        id: 'saveToPromptKitWithMeaning',
        title: '保存到 PromptKit（带释义）',
        contexts: ['selection']
    });
});

// 右键菜单点击处理
chrome.contextMenus.onClicked.addListener(function(info, tab) {
    const text = info.selectionText || '';
    if (!text.trim()) return;

    if (info.menuItemId === 'saveToPromptKit') {
        savePrompt(text, '', tab);
    } else if (info.menuItemId === 'saveToPromptKitWithMeaning') {
        // 从页面提取标题作为释义
        const meaning = tab ? tab.title || '' : '';
        savePrompt(text, meaning, tab);
    }
});

// 保存到 PromptKit
function savePrompt(content, meaning, tab) {
    const url = serverUrl + '/api/prompts';
    const data = {
        content: content,
        meaning: meaning || '',
        module: 'custom',
        category: '浏览器收藏',
        scene: tab ? tab.url || '' : '',
        tags: JSON.stringify(['浏览器', 'web'])
    };

    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    })
    .then(function(r) { return r.json(); })
    .then(function(result) {
        if (result && result.ok) {
            // 通知 popup
            chrome.runtime.sendMessage({
                type: 'SAVE_SUCCESS',
                promptId: result.id,
                content: content.substring(0, 60)
            });
            // 桌面通知
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icon128.png',
                title: '✅ 已保存到 PromptKit',
                message: content.substring(0, 100)
            });
        } else {
            chrome.runtime.sendMessage({
                type: 'SAVE_ERROR',
                error: result ? result.error : '请求失败'
            });
        }
    })
    .catch(function(err) {
        chrome.runtime.sendMessage({
            type: 'SAVE_ERROR',
            error: err.message
        });
    });
}

// 接收来自 popup 的消息
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.type === 'GET_SERVER_URL') {
        sendResponse({ serverUrl: serverUrl });
    } else if (request.type === 'SET_SERVER_URL') {
        serverUrl = request.serverUrl;
        chrome.storage.sync.set({ serverUrl: serverUrl });
        sendResponse({ ok: true });
    } else if (request.type === 'SAVE_PROMPT') {
        savePrompt(request.content, request.meaning || '', null);
        sendResponse({ ok: true });
    } else if (request.type === 'GET_STATUS') {
        fetch(serverUrl + '/api/status')
            .then(function(r) { return r.json(); })
            .then(function(d) {
                sendResponse({ ok: true, status: d.status, total: d.total_prompts });
            })
            .catch(function() {
                sendResponse({ ok: false, error: '无法连接' });
            });
        return true; // 异步响应
    }
    return true;
});
