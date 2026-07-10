# PromptKit License 系统设计

Phase18 v5.1.0

---

## License Key 格式

```
个人版: PK-PERS-XXXXX-XXXXX-XXXXX-... (Base64 载荷 + 短签名)
团队版: PK-TEAM-XXXXX-XXXXX-XXXXX-... (Base64 载荷 + 短签名)

格式: PK-{TIER}-{Base64(payload)}.{ShortSig}
分组: 每5字符一组，用 "-" 分隔
```

## 验证机制对比

| | 个人版(买断) | 团队版(订阅) |
|---|---|---|
| 验证方式 | RSA 离线验签 | 在线 + 定期轮询 |
| 联网要求 | 仅激活时(可离线输Key) | 每7天需联网一次 |
| 过期策略 | 永不过期 | 到期降级只读 |
| 换机限制 | 2次/年 | 在线解绑 |
| 防篡改 | 机器指纹 + 加密存储 + 时间检测 | 服务器频控 + 设备数限制 |
| 离线宽限期 | N/A | 14天 |
| 超宽限期 | N/A | 降级只读 → 冻结 |

## 安全存储

- License Key 存储: `data/licenses/` + `plugin_licenses` 表 (AES-256-GCM 加密)
- AES 密钥: 从机器指纹 SHA256 派生
- RSA 密钥: `data/licenses/private.pem`(服务端) + `public.pem`(客户端嵌入)

## API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/plugins/{id}/activate` | POST | 激活 License |
| `/api/plugins/{id}/status` | GET | 查询状态 |
| `/api/plugins/{id}/deactivate` | POST | 解除激活(返回注销码) |
| `/api/plugin-system/licenses` | GET | 所有 License 状态 |

## 生成 Key

```bash
# 个人版
python scripts/generate_license_key.py --tier personal --order ORDER-001

# 团队版 (12月, 5席)
python scripts/generate_license_key.py --tier team --order ORDER-002 --months 12 --seats 5
```
