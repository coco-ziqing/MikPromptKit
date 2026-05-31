// 监听来自 popup 的选中文本请求
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.type === 'GET_SELECTION') {
        var text = window.getSelection ? window.getSelection().toString() : '';
        sendResponse({ text: text });
    }
    return true;
});
