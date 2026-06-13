CreateObject("Shell.Application").ShellExecute "netsh", "advfirewall firewall add rule name=""咪卡MiK 8080"" dir=in action=allow protocol=TCP localport=8080", "", "runas", 0
CreateObject("WScript.Shell").Popup "防火墙规则添加命令已发送！" & vbCrLf & vbCrLf & "现在请在另一台电脑访问：" & vbCrLf & "http://192.168.0.103:8080", 5, "咪卡MiK 一键放行", 64
