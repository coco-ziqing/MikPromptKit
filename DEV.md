# PromptKit 版本管理终端

## 常用命令速查

```powershell
# 查看版本历史
git log --oneline --decorate --graph

# 查 tag 列表
git tag -l

# 查看某个版本的改动
git show v3.0.0 --stat

# 切到主分支开始新迭代
git checkout dev

# 提交代码
git add -A
git commit -m "功能描述"

# 发布新版本
git checkout master
git merge dev
git tag -a v3.0.1 -m "v3.0.1 — 更新说明"
git push backup master --tags

# 回退到上一个版本
git checkout tags/v3.0.0
```

## 备份仓库位置
```
C:\Users\ASUS\.openclaw\workspace\.backup\prompt-tool-dev.git
```
