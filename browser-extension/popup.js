// PromptKit 收藏助手 — Popup
document.addEventListener('DOMContentLoaded', function() {
    var statusEl = document.getElementById('status');
    var toastEl = document.getElementById('toast');
    var serverInput = document.getElementById('serverUrl');
    var contentInput = document.getElementById('promptContent');
    var meaningInput = document.getElementById('promptMeaning');

    // 加载配置
    chrome.storage.sync.get({ serverUrl: 'http://192.168.0.103:8080' }, function(items) {
        serverInput.value = items.serverUrl;
    });

    // 检查服务状态
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, function(response) {
        if (response && response.ok) {
            statusEl.textContent = '✅ 已连接 · 词库 ' + response.total + ' 条';
            statusEl.className = 'status ok';
        } else {
            statusEl.textContent = '❌ 无法连接 PromptKit';
            statusEl.className = 'status err';
        }
    });

    // 获取当前标签页标题
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (tabs && tabs.length > 0) {
            meaningInput.value = tabs[0].title || '';
        }
    });

    // 获取选中文本
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (tabs && tabs.length > 0) {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_SELECTION' }, function(response) {
                if (response && response.text) {
                    contentInput.value = response.text;
                }
            });
        }
    });

    // 保存按钮
    document.getElementById('btnSave').addEventListener('click', function() {
        var content = contentInput.value.trim();
        if (!content) {
            showToast('请输入提示词内容', 'error');
            return;
        }
        var serverUrl = serverInput.value.trim();
        chrome.storage.sync.set({ serverUrl: serverUrl });

        chrome.runtime.sendMessage({
            type: 'SAVE_PROMPT',
            content: content,
            meaning: meaningInput.value.trim()
        }, function() {
            showToast('✅ 已保存到 PromptKit', 'success');
            contentInput.value = '';
        });
    });

    // 保存服务器地址
    serverInput.addEventListener('change', function() {
        chrome.storage.sync.set({ serverUrl: serverInput.value.trim() });
    });

    function showToast(msg, type) {
        toastEl.textContent = msg;
        toastEl.className = 'toast ' + type;
        setTimeout(function() { toastEl.className = 'toast'; }, 3000);
    }
});
