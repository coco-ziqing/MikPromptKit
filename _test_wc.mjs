import http from 'http';
const BASE = 'http://127.0.0.1:8080';

function fetchJS(path) {
    return new Promise((resolve) => {
        http.get(BASE + path, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(data));
        });
    });
}

const App = { 
    wordCards: {},
    _escape: s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
    fetchJSON: async (url) => {
        return new Promise((resolve) => {
            http.get(BASE + url, res => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => resolve(JSON.parse(data)));
            });
        });
    },
    copyText: () => {},
    wordEditor: { open: () => {} }
};

const wcjs = await fetchJS('/static/js/word_card_manager.js');

try {
    new Function('App', wcjs)(App);
    console.log('word_card_manager.js: 执行成功');
} catch(e) {
    console.log('EXEC ERROR:', e.message);
    process.exit(1);
}

const groups = await App.fetchJSON('/api/v4/word-cards/groups');
console.log('分组API:', groups.groups.length, '组');
for (const g of groups.groups.slice(0,3)) {
    console.log('  [' + g.group_key + '] ' + g.name + ' - ' + g.card_count + '词卡');
}

const cards = await App.fetchJSON('/api/v4/word-cards?page=1&page_size=5&sort=sort_order&order=asc');
console.log('词卡API:', cards.ok, '-', cards.total, '条');
if (cards.items && cards.items.length > 0) {
    console.log('示例:', cards.items[0].content ? cards.items[0].content.substring(0,40) : '(空)');
}

console.log('\n=== 验证通过 ===');
