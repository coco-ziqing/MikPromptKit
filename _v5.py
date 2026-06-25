import ast, re
with open(r'C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\backend\api\word_cards.py','r',encoding='utf-8') as f:
    c = f.read()
ast.parse(c)  # verify syntax
new = re.findall(r'@router\.(post|get)\(["\']/(batch-create|suggest-group)', c)
print(f'New endpoints: {new}')
with open(r'C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\frontend\static\js\word_card_manager.js','r',encoding='utf-8') as f:
    js = f.read()
for ch in ['_showBatchCreate','_doBatchCreate','_confirmBatchCreate']:
    print(f'  {ch}: {"OK" if ch in js else "MISSING"}')
print('\nAll checks passed')
